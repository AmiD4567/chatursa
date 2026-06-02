const knowledge = require('./knowledge');

// ============================================
// State Machine — контекст разговора с ботом
// ============================================

/**
 * Состояние одного пользователя (одного сокета).
 */
class ConversationState {
  constructor() {
    this.step = 'idle';       // idle → create_task → set_title → set_time → set_date → confirm_task
    this.context = {};        // данные текущего диалога
    this.timeoutId = null;    // таймаут очистки состояния (30 сек)
  }

  /** Сбросить состояние с задержкой 30 секунд */
  reset(delayMs = 30000) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.step = 'idle';
    this.context = {};
    this.timeoutId = setTimeout(() => {
      this.step = 'idle';
      this.context = {};
    }, delayMs);
  }

  /** Отменить таймаут */
  cancelReset() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

// ============================================
// Аналитика использования бота
// ============================================

class BotAnalytics {
  constructor() {
    // Команды: { '/помощь': 15, '/сегодня': 42, ... }
    this.commandCounts = new Map();
    // Fallback-фразы (когда бот не понял)
    this.fallbackPhrases = [];
    this.fallbackCount = 0;
    // Общее количество взаимодействий
    this.totalInteractions = 0;
    // Время последнего сброса статистики
    this.lastReset = Date.now();
  }

  /** Записать команду */
  recordCommand(command) {
    this.totalInteractions++;
    const key = command.toLowerCase().trim();
    this.commandCounts.set(key, (this.commandCounts.get(key) || 0) + 1);
  }

  /** Записать fallback-фразу */
  recordFallback(text) {
    this.fallbackCount++;
    this.totalInteractions++;
    // Храним последние 50 уникальных фраз
    if (!this.fallbackPhrases.includes(text)) {
      this.fallbackPhrases.push(text);
      if (this.fallbackPhrases.length > 50) {
        this.fallbackPhrases.shift();
      }
    }
  }

  /** Получить отчёт */
  getReport() {
    return {
      totalInteractions: this.totalInteractions,
      fallbackCount: this.fallbackCount,
      fallbackRate: this.totalInteractions > 0
        ? ((this.fallbackCount / this.totalInteractions) * 100).toFixed(1) + '%'
        : '0%',
      topCommands: Array.from(this.commandCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      recentFallbacks: this.fallbackPhrases.slice(-20),
    };
  }

  /** Сбросить статистику */
  reset() {
    this.commandCounts.clear();
    this.fallbackPhrases = [];
    this.fallbackCount = 0;
    this.totalInteractions = 0;
    this.lastReset = Date.now();
  }
}

// ============================================
// State Machine — логика многошаговых диалогов
// ============================================

/**
 * Шаги для создания задачи.
 */
const TASK_CREATION_STEPS = {
  'create_task': {
    prompt: '📝 *Создание новой задачи*\n\nВведите название задачи:',
    nextStep: 'set_title',
    extract: (state, text) => ({ ...state.context, title: text.trim() }),
  },
  'set_time': {
    prompt: '⏰ Введите время выполнения (например: 14:30):\n\nИли отправьте *пропустить*, чтобы без времени:',
    nextStep: 'set_date',
    extract: (state, text) => {
      const lower = text.toLowerCase();
      if (lower.includes('пропуск') || lower.includes('нет')) {
        state.context.time = null;
        return state;
      }
      // Простая валидация времени HH:MM
      if (/^\d{1,2}:\d{2}$/.test(text)) {
        state.context.time = text.trim();
      } else {
        state.context.time = null;
      }
      return state;
    },
  },
  'set_date': {
    prompt: '📅 Введите дату (например: 2026-03-15):\n\nИли отправьте *сегодня* для сегодняшней даты:',
    nextStep: 'confirm_task',
    extract: (state, text) => {
      const lower = text.toLowerCase();
      if (lower.includes('сегодня')) {
        state.context.date = new Date().toISOString().split('T')[0];
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        state.context.date = text.trim();
      } else {
        // Если не распознали — используем сегодня
        state.context.date = new Date().toISOString().split('T')[0];
      }
      return state;
    },
  },
  'confirm_task': {
    prompt: (state) => `✅ *Подтверждение задачи*\n\n📌 ${state.context.title}\n⏰ ${state.context.time || '—'}\n📅 ${state.context.date}\n\nОтправить задачу? (да/нет):`,
    nextStep: null,
    extract: (state, text) => {
      const lower = text.toLowerCase();
      if (lower === 'да' || lower === 'yes') {
        // Задача подтверждена — вернём флаг для обработки в server.js
        state.context.confirmed = true;
      } else {
        state.context.confirmed = false;
      }
      return state;
    },
  },
};

/**
 * State Machine — обработка сообщения с учётом контекста.
 * @param {Map} conversationStates - Map<socketId, ConversationState>
 * @param {Function} sendBotMessage - отправка сообщения бота
 * @param {string} socketId - ID сокета пользователя
 * @param {string} text - текст сообщения
 * @returns {{ response: string | null, buttons: Array, isNewCommand: boolean }}
 */
function processConversationState(conversationStates, sendBotMessage, socketId, text) {
  const state = conversationStates.get(socketId);

  // Если в состоянии idle — проверяем команды
  if (!state || state.step === 'idle') {
    return { response: null, buttons: [], isNewCommand: true };
  }

  // В состоянии диалога — обрабатываем по шагам
  const stepConfig = TASK_CREATION_STEPS[state.step];
  if (!stepConfig) {
    state.reset();
    return { response: null, buttons: [], isNewCommand: false };
  }

  try {
    // Извлекаем данные из ответа пользователя
    let newState = stepConfig.extract(state, text);

    // Если это последний шаг (confirm_task) — обрабатываем результат
    if (!stepConfig.nextStep && state.step === 'confirm_task') {
      if (newState.context.confirmed) {
        sendBotMessage(socketId, `✅ *Задача создана!*\n\n📌 ${state.context.title}\n⏰ ${state.context.time || '—'}\n📅 ${state.context.date}`, []);
      } else {
        sendBotMessage(socketId, `❌ Создание задачи отменено.`, [
          { label: '🔄 Создать заново', action: '/создать задачу' },
          { label: '🔙 Назад', action: '/помощь' }
        ]);
      }
      state.reset();
      return { response: null, buttons: [], isNewCommand: false };
    }

    // Переходим к следующему шагу
    const nextState = stepConfig.nextStep;
    if (nextState) {
      sendBotMessage(socketId, TASK_CREATION_STEPS[nextState].prompt, []);
    }

    state.reset();
    return { response: null, buttons: [], isNewCommand: false };

  } catch (err) {
    console.error('Ошибка state machine:', err);
    sendBotMessage(socketId, '😕 Произошла ошибка. Попробуйте снова.', []);
    state.reset();
    return { response: null, buttons: [], isNewCommand: false };
  }
}

/**
 * Проверка, является ли сообщение командой для начала нового диалога.
 * @param {string} text - текст сообщения
 * @returns {boolean}
 */
function isDialogStartCommand(text) {
  const clean = text.trim().toLowerCase();
  return ['/создать задачу', '/новая задача'].includes(clean);
}

/**
 * Инициализация state machine для сокета.
 * @param {Map} conversationStates - Map<socketId, ConversationState>
 * @param {Function} sendBotMessage - отправка сообщения бота
 * @param {string} socketId - ID сокета
 */
function startConversation(conversationStates, sendBotMessage, socketId) {
  let state = conversationStates.get(socketId);
  if (!state) {
    state = new ConversationState();
    conversationStates.set(socketId, state);
  }

  // Начинаем с первого шага создания задачи
  state.cancelReset();
  state.step = 'create_task';
  state.context = {};
  sendBotMessage(socketId, TASK_CREATION_STEPS['create_task'].prompt, []);
}

/**
 * Очистка состояния сокета (при disconnect).
 * @param {Map} conversationStates - Map<socketId, ConversationState>
 * @param {string} socketId - ID сокета
 */
function clearConversation(conversationStates, socketId) {
  const state = conversationStates.get(socketId);
  if (state) {
    state.reset(0); // немедленная очистка
    conversationStates.delete(socketId);
  }
}

module.exports = {
  ConversationState,
  BotAnalytics,
  TASK_CREATION_STEPS,
  processConversationState,
  isDialogStartCommand,
  startConversation,
  clearConversation,
};
