const knowledge = require('./knowledge');

// ============================================
// Bot Engine — ядро бота-помощника
// ============================================

/**
 * Карта ключевых слов — маппинг на команды бота.
 */
const keywordMap = {
  'привет': '/помощь',
  'здравствуй': '/помощь',
  'помощь': '/помощь',
  'помоги': '/помощь',
  'команда': '/помощь',
  'меню': '/помощь',
  'главное': '/помощь',

  'чат': '/чат',
  'сообщение': '/чат',
  'беседа': '/чат',
  'разговор': '/чат',
  'создать чат': '/чат',

  'задач': '/задача',
  'задание': '/задача',
  'дело': '/задача',
  'план': '/задача',
  'создать задачу': '/задача',

  'календар': '/календарь',
  'дата': '/календарь',
  'планер': '/календарь',
  'расписани': '/календарь',

  'переговор': '/переговорка',
  'встреч': '/переговорка',
  'комнат': '/переговорка',
  'брон': '/переговорка',
  'забронировать': '/переговорка',

  'файл': '/файлы',
  'документ': '/файлы',
  'загрузить': '/файлы',
  'отправить файл': '/файлы',
  'картинк': '/файлы',
  'фото': '/файлы',

  'статус': '/статус',
  'онлайн': '/статус',
  'офлайн': '/статус',
  'занят': '/статус',

  'профил': '/профиль',
  'аватар': '/профиль',
  'настройк': '/профиль',
  'данные': '/профиль',
  'информация': '/профиль',

  'уведомлен': '/уведомления',
  'уведомить': '/уведомления',
  'звонок': '/уведомления',
  'оповещен': '/уведомления',

  'сегодня': '/сегодня',
  'сейчас': '/сегодня',
  'текущий': '/сегодня',
  'день': '/сегодня',
  'события': '/сегодня',
  'план на день': '/сегодня',

  'контакт': '/контакты',
  'телефон': '/контакты',
  'сотрудник': '/контакты',
  'коллега': '/контакты',
  'список сотрудников': '/контакты',

  'обучен': '/онбординг',
  'обучи': '/онбординг',
  'начать': '/онбординг',
  'урок': '/онбординг',
  'инструкц': '/онбординг',

  'поиск': '/поиск',
  'найти': '/поиск',
  'искать': '/поиск',

  'оцен': '/оценить',
  'рейтинг': '/оценить',

  'поддерж': '/поддержка',
  'помощь поддержка': '/поддержка',
  'ошибка': '/поддержка',
  'не работ': '/поддержка',
  'проблем': '/поддержка',
  'слом': '/поддержка',

  'морожен': '/помощь',
  'урса': '/помощь'
};

/**
 * Инициализация движка бота.
 * @param {Object} deps - зависимости из server.js
 * @param {Object} deps.db - SQLite database (sql.js)
 * @param {Object} deps.io - Socket.IO server instance
 * @param {Function} deps.uuidv4 - генератор UUID
 * @param {Function} deps.encryptText - функция шифрования текста
 * @returns {Object} методы бота
 */
function initBotEngine({ db, io, uuidv4, encryptText }) {

  /**
   * Отправка сообщения от имени помощника.
   * @param {Object} socket - Socket.IO socket
   * @param {string} chatId - ID чата (bot-chat-*)
   * @param {string} text - текст сообщения
   * @param {Array} buttons - массив кнопок [{label, action}]
   */
  function sendBotMessage(socket, chatId, text, buttons = []) {
    try {
      const botResult = db.prepare("SELECT id, username, avatar FROM users WHERE username = ?").get('Помощник');
      if (!botResult) {
        console.error('Помощник не найден в базе');
        return;
      }

      const botId = botResult.id;
      const botUsername = botResult.username;
      const botAvatar = botResult.avatar;

      if (!chatId || typeof chatId !== 'string') {
        console.error('Некорректный ID чата:', chatId);
        return;
      }

      const messageId = uuidv4();
      const encryptedText = encryptText(text || '');

      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `, [messageId, chatId, botId, encryptedText, new Date().toISOString()]);

      // Сохраняем кнопки в БД (JSON) — если колонка существует
      const buttonsJson = JSON.stringify(buttons);
      try {
        db.run(`UPDATE messages SET button_data = ? WHERE id = ?`, [buttonsJson, messageId]);
      } catch (e) {
        // Колонка button_data может не существовать в старых схемах
      }

      io.to(chatId).emit('new_message', {
        message: {
          id: messageId,
          chatId: chatId,
          senderId: botId,
          senderName: botUsername,
          senderAvatar: botAvatar || 'https://ui-avatars.com/api/?name=🤖&background=667eea&color=fff',
          text: text,
          file: null,
          reply_to: null,
          timestamp: new Date().toISOString(),
          read_at: null,
          forwarded_from: null,
          buttons: buttons
        },
        chat: { id: chatId, name: 'Помощник', type: 'direct' }
      });

    } catch (err) {
      console.error('Ошибка sendBotMessage:', err);
    }
  };

  /**
   * Получение ответа бота на сообщение пользователя.
   * @param {string} message - текст сообщения
   * @returns {Object} { text, buttons, steps }
   */
  function getBotResponse(message) {
    const text = message.trim().toLowerCase();

    // Проверка команд (с / или без)
    const cleanCommand = text.replace('/', '').split(' ')[0];

    if (text.startsWith('/') || knowledge.commands['/' + cleanCommand]) {
      const command = '/' + cleanCommand;
      if (knowledge.commands[command]) {
        const cmd = knowledge.commands[command];
        return {
          text: cmd.text,
          buttons: cmd.buttons || [],
          steps: cmd.steps || null
        };
      }
    }

    // Умный поиск по ключевым словам (приоритет: фразы → stem слова)
    const inputWords = text.split(/\s+/).filter(w => w.length > 2);

    // Сначала ищем точные совпадения многофразовых ключей (2+ слов)
    for (const [keyword, command] of Object.entries(keywordMap)) {
      if (keyword.includes(' ')) {
        if (text.includes(keyword)) {
          const cmd = knowledge.commands[command];
          if (cmd) {
            return { text: cmd.text, buttons: cmd.buttons || [], steps: cmd.steps || null };
          }
        }
      }
    }

    // Затем ищем по однословным ключам с проверкой начала слова (stem match)
    for (const [keyword, command] of Object.entries(keywordMap)) {
      if (!keyword.includes(' ')) {
        for (const word of inputWords) {
          if (word.startsWith(keyword)) {
            const cmd = knowledge.commands[command];
            if (cmd) {
              return { text: cmd.text, buttons: cmd.buttons || [], steps: cmd.steps || null };
            }
          }
        }
      }
    }

    // Проверка ответов на вопросы
    for (const [keyword, response] of Object.entries(knowledge.responses)) {
      if (text.includes(keyword)) {
        if (typeof response === 'object') {
          return response;
        }
        return { text: response, buttons: [] };
      }
    }

    // Ответ по умолчанию с кнопками
    const defaultCmd = knowledge.commands['по умолчанию'];
    return {
      text: '🤖 *Я вас не совсем понял.*\n\nВыберите раздел, который вас интересует:',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '📱 Чаты', action: '/чат' },
        { label: '📅 Задачи', action: '/задача' },
        { label: '📞 Контакты', action: '/контакты' },
        { label: '❓ Помощь', action: '/помощь' }
      ],
      steps: null
    };
  };

  return { sendBotMessage, getBotResponse };
};

module.exports = { initBotEngine, keywordMap };
