const knowledge = require('./knowledge');

class ConversationState {
  constructor() {
    this.step = 'idle';
    this.context = {};
    this.timeoutId = null;
    this.lastActivity = Date.now();
  }

  reset(delayMs = 30000) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.step = 'idle';
    this.context = {};
    if (delayMs > 0) {
      this.timeoutId = setTimeout(() => {
        this.step = 'idle';
        this.context = {};
      }, delayMs);
    }
  }

  cancelReset() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

class BotAnalytics {
  constructor() {
    this.commandCounts = new Map();
    this.fallbackPhrases = [];
    this.fallbackCount = 0;
    this.totalInteractions = 0;
    this.lastReset = Date.now();
  }

  recordCommand(command) {
    this.totalInteractions++;
    const key = command.toLowerCase().trim();
    this.commandCounts.set(key, (this.commandCounts.get(key) || 0) + 1);
  }

  recordFallback(text) {
    this.fallbackCount++;
    this.totalInteractions++;
    if (!this.fallbackPhrases.includes(text)) {
      this.fallbackPhrases.push(text);
      if (this.fallbackPhrases.length > 50) {
        this.fallbackPhrases.shift();
      }
    }
  }

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

  reset() {
    this.commandCounts.clear();
    this.fallbackPhrases = [];
    this.fallbackCount = 0;
    this.totalInteractions = 0;
    this.lastReset = Date.now();
  }
}

const DIALOG_DEFINITIONS = {
  '/создать задачу': {
    startStep: 'ask_title',
    steps: {
      ask_title: {
        prompt: '📝 *Создание новой задачи*\n\nВведите название задачи:',
        nextStep: 'ask_time',
        extract: (state, text) => { state.context.title = text.trim(); }
      },
      ask_time: {
        prompt: '⏰ Введите время выполнения (например: 14:30):\n\nИли отправьте *пропустить*:',
        nextStep: 'ask_date',
        extract: (state, text) => {
          const lower = text.toLowerCase();
          if (lower.includes('пропуск') || lower.includes('нет')) {
            state.context.time = null;
          } else if (/^\d{1,2}:\d{2}$/.test(text)) {
            state.context.time = text.trim();
          } else {
            state.context.time = null;
          }
        }
      },
      ask_date: {
        prompt: '📅 Введите дату (например: 2026-06-20):\n\nИли *сегодня*:',
        nextStep: 'confirm',
        extract: (state, text) => {
          const lower = text.toLowerCase();
          if (lower.includes('сегодня')) {
            state.context.date = new Date().toISOString().split('T')[0];
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            state.context.date = text.trim();
          } else {
            state.context.date = new Date().toISOString().split('T')[0];
          }
        }
      },
      confirm: {
        prompt: (state) => `✅ *Подтверждение задачи*\n\n📌 ${state.context.title}\n⏰ ${state.context.time || '—'}\n📅 ${state.context.date}\n\nОтправить? (да/нет):`,
        nextStep: null,
        extract: (state, text) => {
          state.context.confirmed = text.toLowerCase() === 'да' || text.toLowerCase() === 'yes';
        },
        onConfirm: (state, sendBotMessage, socket, chatId, deps) => {
          const { db, uuidv4 } = deps;
          try {
            const taskId = uuidv4();
            const userId = chatId.replace('bot-chat-', '');
            db.run(`
              INSERT INTO calendar_tasks (id, user_id, title, task_date, task_time, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [taskId, userId, state.context.title, state.context.date, state.context.time || null, new Date().toISOString()]);
            sendBotMessage(socket, chatId,
              `✅ *Задача создана!*\n\n📌 ${state.context.title}\n⏰ ${state.context.time || '—'}\n📅 ${state.context.date}`,
              [{ label: '📅 Календарь', action: '/календарь' }]
            );
          } catch (err) {
            console.error('Ошибка создания задачи через бота:', err);
            sendBotMessage(socket, chatId, '😕 Не удалось создать задачу. Попробуйте позже.', []);
          }
        },
        onCancel: (state, sendBotMessage, socket, chatId) => {
          sendBotMessage(socket, chatId, '❌ Создание задачи отменено.', [
            { label: '🔄 Создать заново', action: '/создать задачу' },
            { label: '🔙 Назад', action: '/помощь' }
          ]);
        }
      }
    }
  },

  '/забронировать переговорку': {
    startStep: 'ask_title',
    steps: {
      ask_title: {
        prompt: '🏢 *Бронирование переговорки*\n\nВведите название встречи:',
        nextStep: 'ask_date',
        extract: (state, text) => { state.context.title = text.trim(); }
      },
      ask_date: {
        prompt: '📅 Введите дату (например: 2026-06-20):\n\nИли *сегодня*:',
        nextStep: 'ask_time_start',
        extract: (state, text) => {
          const lower = text.toLowerCase();
          state.context.date = lower.includes('сегодня')
            ? new Date().toISOString().split('T')[0]
            : (/^\d{4}-\d{2}-\d{2}$/.test(text) ? text.trim() : new Date().toISOString().split('T')[0]);
        }
      },
      ask_time_start: {
        prompt: '⏰ Введите время начала (например: 14:00):',
        nextStep: 'ask_time_end',
        extract: (state, text) => { state.context.timeStart = text.trim(); }
      },
      ask_time_end: {
        prompt: '⏰ Введите время окончания (например: 15:00):',
        nextStep: 'confirm',
        extract: (state, text) => { state.context.timeEnd = text.trim(); }
      },
      confirm: {
        prompt: (state) => `✅ *Подтверждение бронирования*\n\n🏢 ${state.context.title}\n📅 ${state.context.date}\n⏰ ${state.context.timeStart} — ${state.context.timeEnd}\n\nОтправить? (да/нет):`,
        nextStep: null,
        extract: (state, text) => {
          state.context.confirmed = text.toLowerCase() === 'да' || text.toLowerCase() === 'yes';
        },
        onConfirm: (state, sendBotMessage, socket, chatId, deps) => {
          const { db } = deps;
          try {
            const userId = chatId.replace('bot-chat-', '');
            const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
            db.run(`
              INSERT INTO meeting_room_bookings (title, meeting_date, start_time, end_time, organizer_id, organizer_name, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [state.context.title, state.context.date, state.context.timeStart, state.context.timeEnd, userId, user?.username || 'Пользователь', new Date().toISOString()]);
            sendBotMessage(socket, chatId,
              `✅ *Бронирование создано!*\n\n🏢 ${state.context.title}\n📅 ${state.context.date}\n⏰ ${state.context.timeStart} — ${state.context.timeEnd}\n\nОткройте Календарь → Переговорка, чтобы увидеть бронь.`,
              [{ label: '📅 Календарь', action: '/календарь' }]
            );
          } catch (err) {
            console.error('Ошибка бронирования через бота:', err);
            sendBotMessage(socket, chatId, '😕 Не удалось забронировать. Попробуйте позже.', []);
          }
        },
        onCancel: (state, sendBotMessage, socket, chatId) => {
          sendBotMessage(socket, chatId, '❌ Бронирование отменено.', [
            { label: '🔄 Заново', action: '/забронировать переговорку' },
            { label: '🔙 Назад', action: '/помощь' }
          ]);
        }
      }
    }
  },

  '/создать опрос': {
    startStep: 'ask_question',
    steps: {
      ask_question: {
        prompt: '📊 *Создание опроса*\n\nВведите вопрос для опроса:',
        nextStep: 'ask_options',
        extract: (state, text) => { state.context.question = text.trim(); }
      },
      ask_options: {
        prompt: '📋 Введите варианты ответа, разделённые запятой (минимум 2, максимум 10):\n\nНапример: *Да, Нет, Воздержусь*',
        nextStep: 'confirm',
        extract: (state, text) => {
          const opts = text.split(',').map(o => o.trim()).filter(Boolean);
          state.context.options = opts.slice(0, 10);
        }
      },
      confirm: {
        prompt: (state) => `✅ *Подтверждение опроса*\n\n📊 ${state.context.question}\n\nВарианты:\n${state.context.options.map((o, i) => `  ${i+1}. ${o}`).join('\n')}\n\nОтправить опрос в текущий чат? (да/нет):`,
        nextStep: null,
        extract: (state, text) => {
          state.context.confirmed = text.toLowerCase() === 'да' || text.toLowerCase() === 'yes';
        },
        onConfirm: (state, sendBotMessage, socket, chatId, deps) => {
          const { db, uuidv4 } = deps;
          try {
            const pollId = uuidv4();
            const userId = chatId.replace('bot-chat-', '');
            db.run(`
              INSERT INTO polls (id, chat_id, creator_id, question, options, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [pollId, chatId, userId, state.context.question, JSON.stringify(state.context.options), new Date().toISOString()]);
            sendBotMessage(socket, chatId,
              `✅ *Опрос создан!*\n\n📊 ${state.context.question}\n\nВарианты: ${state.context.options.join(', ')}\n\n💡 Вы можете поделиться этим опросом с коллегами, отправив ссылку в групповой чат.`,
              [{ label: '📊 К опросу', action: `/опрос_${pollId}` }]
            );
          } catch (err) {
            console.error('Ошибка создания опроса через бота:', err);
            sendBotMessage(socket, chatId, '😕 Не удалось создать опрос. Попробуйте позже.', []);
          }
        },
        onCancel: (state, sendBotMessage, socket, chatId) => {
          sendBotMessage(socket, chatId, '❌ Создание опроса отменено.', [
            { label: '🔄 Создать заново', action: '/создать опрос' },
            { label: '🔙 Назад', action: '/помощь' }
          ]);
        }
      }
    }
  },

  '/обратиться в поддержку': {
    startStep: 'ask_problem',
    steps: {
      ask_problem: {
        prompt: '📞 *Обращение в поддержку*\n\nОпишите вашу проблему одним сообщением:',
        nextStep: 'confirm',
        extract: (state, text) => { state.context.problem = text.trim(); }
      },
      confirm: {
        prompt: (state) => `📞 *Подтверждение обращения*\n\nПроблема: "${state.context.problem}"\n\nОтправить? (да/нет):`,
        nextStep: null,
        extract: (state, text) => {
          state.context.confirmed = text.toLowerCase() === 'да' || text.toLowerCase() === 'yes';
        },
        onConfirm: (state, sendBotMessage, socket, chatId, deps) => {
          const { db, uuidv4 } = deps;
          try {
            const requestId = uuidv4();
            const userId = chatId.replace('bot-chat-', '');
            const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
            db.run(`
              INSERT INTO support_requests (id, user_id, username, problem, status, created_at)
              VALUES (?, ?, ?, ?, 'open', ?)
            `, [requestId, userId, user?.username || 'Пользователь', state.context.problem, new Date().toISOString()]);
            sendBotMessage(socket, chatId,
              `✅ *Обращение отправлено!*\n\nНомер обращения: #${requestId.substring(0, 8)}\n\nСлужба поддержки рассмотрит ваш запрос и ответит в ближайшее время.\n\nВаш запрос: "${state.context.problem}"`,
              [{ label: '🔙 Назад', action: '/помощь' }]
            );
            // Уведомляем всех админов
            try {
              const admins = db.prepare("SELECT id FROM users WHERE is_admin = 1").all();
              admins.forEach(admin => {
                const adminSocketEntry = Array.from(io?.sockets?.sockets?.entries() || []).find(([_, s]) => s.userId === admin.id);
                if (adminSocketEntry) {
                  adminSocketEntry[1].emit('admin_notification', {
                    type: 'support_request',
                    title: 'Новое обращение в поддержку',
                    message: `${user?.username || 'Пользователь'}: "${state.context.problem}"`,
                    requestId
                  });
                }
              });
            } catch (e) {}
          } catch (err) {
            console.error('Ошибка создания обращения:', err);
            sendBotMessage(socket, chatId, '😕 Не удалось отправить обращение. Попробуйте позже.', []);
          }
        },
        onCancel: (state, sendBotMessage, socket, chatId) => {
          sendBotMessage(socket, chatId, '❌ Обращение отменено.', [
            { label: '🔄 Написать заново', action: '/обратиться в поддержку' },
            { label: '🔙 Назад', action: '/помощь' }
          ]);
        }
      }
    }
  }
};

function processConversationState(conversationStates, sendBotMessage, socket, chatId, text, deps = {}) {
  const state = conversationStates.get(chatId);

  if (!state || state.step === 'idle') {
    return { handled: false };
  }

  state.lastActivity = Date.now();

  const dialogName = state.context._dialog;
  const dialog = DIALOG_DEFINITIONS[dialogName];
  if (!dialog) {
    state.reset();
    return { handled: false };
  }

  const stepConfig = dialog.steps[state.step];
  if (!stepConfig) {
    state.reset();
    return { handled: true };
  }

  try {
    stepConfig.extract(state, text);

    if (!stepConfig.nextStep) {
      if (state.context.confirmed && stepConfig.onConfirm) {
        stepConfig.onConfirm(state, sendBotMessage, socket, chatId, deps);
      } else if (!state.context.confirmed && stepConfig.onCancel) {
        stepConfig.onCancel(state, sendBotMessage, socket, chatId);
      }
      state.reset();
      return { handled: true };
    }

    state.cancelReset();
    state.step = stepConfig.nextStep;
    const nextStepConfig = dialog.steps[stepConfig.nextStep];
    const promptText = typeof nextStepConfig.prompt === 'function'
      ? nextStepConfig.prompt(state)
      : nextStepConfig.prompt;
    sendBotMessage(socket, chatId, promptText, []);
    state.reset(30000);

    return { handled: true };
  } catch (err) {
    console.error('Ошибка state machine:', err);
    sendBotMessage(socket, chatId, '😕 Произошла ошибка. Попробуйте снова.', []);
    state.reset();
    return { handled: true };
  }
}

function isDialogStartCommand(text) {
  const clean = text.trim().toLowerCase();
  const dialogCommands = Object.keys(DIALOG_DEFINITIONS);
  return dialogCommands.includes(clean);
}

function startConversation(conversationStates, sendBotMessage, socket, chatId, command) {
  let state = conversationStates.get(chatId);
  if (!state) {
    state = new ConversationState();
    conversationStates.set(chatId, state);
  }

  state.lastActivity = Date.now();

  const dialog = DIALOG_DEFINITIONS[command];
  if (!dialog) return;

  state.cancelReset();
  state.step = dialog.startStep;
  state.context = { _dialog: command };
  const startStepConfig = dialog.steps[dialog.startStep];
  const promptText = typeof startStepConfig.prompt === 'function'
    ? startStepConfig.prompt(state)
    : startStepConfig.prompt;
  sendBotMessage(socket, chatId, promptText, []);
  state.reset(30000);
}

function clearConversation(conversationStates, chatId) {
  const state = conversationStates.get(chatId);
  if (state) {
    state.reset(0);
    conversationStates.delete(chatId);
  }
}

module.exports = {
  ConversationState,
  BotAnalytics,
  DIALOG_DEFINITIONS,
  processConversationState,
  isDialogStartCommand,
  startConversation,
  clearConversation,
};
