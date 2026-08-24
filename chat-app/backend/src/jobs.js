/**
 * Фоновые задачи: напоминания о задачах/встречах/днях рождения, «мысли дня».
 * Функции объявлены на верхнем уровне; зависимости присваиваются в setupJobs(deps)
 * до запуска первого таймера.
 */

let db, emitToUser, SERVER_URL, encryptText, uuidv4, ensureBotChat, deliverBotMessage;

// ============================================

// Map: taskId -> timeoutId для отмены при удалении/редактировании
const pendingReminders = new Map();

/**
 * Отправить напоминание пользователю через бота «Помощник»
 */
function sendTaskReminder(userId, username, taskTitle, taskDate, taskTime) {
  try {
    const botChatId = `bot-chat-${userId}`;
    const reminderText = `⏰ *Напоминание о задаче:*\n\n📅 **${taskTitle}**\n\nДата: ${new Date(taskDate).toLocaleDateString('ru-RU')}${taskTime ? `\nВремя: ${taskTime}` : ''}\n\n💡 *Совет:* Подготовьтесь заранее!`;

    const botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
    if (!botResult) return;

    const botId = botResult.id;
    const messageId = uuidv4();
    const encryptedText = encryptText(reminderText || '');

    db.run(`
      INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `, [messageId, botChatId, botId, encryptedText, new Date().toISOString()]);

    // Доставка: unread + realtime (все сессии) + push офлайн
    deliverBotMessage(userId, {
      id: messageId,
      chatId: botChatId,
      senderId: botId,
      senderName: 'Помощник',
      senderAvatar: 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff',
      text: reminderText,
      timestamp: new Date().toISOString(),
      isBotMessage: true,
      buttons: [
        { label: '📅 Календарь', action: '/календарь' },
        { label: '✅ Отметить выполненной', action: '/задача' }
      ]
    });

  } catch (err) {
    console.error('Ошибка отправки напоминания:', err);
  }
}

/**
 * Отправить напоминание о встрече/бронировании переговорной через бота «Помощник»
 */
function sendMeetingReminder(userId, reminder) {
  try {
    const botChatId = `bot-chat-${userId}`;
    const reminderText = `🔔 *Напоминание о встрече*\n\n📌 *${reminder.title}*\n📅 *Дата:* ${reminder.meeting_date}\n⏰ *Время:* ${reminder.start_time} – ${reminder.end_time}\n👤 *Организатор:* ${reminder.organizer_name}`;

    console.log(`[Reminder] Отправка напоминания пользователю ${userId} о брони #${reminder.id}: ${reminder.title}`);

    // Получаем или создаём бота Помощник
    let botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
    if (!botResult) {
      console.log('[Reminder] Бот Помощник не найден, создаём...');
      const botId = 'helper-bot-' + uuidv4().substring(0, 8);
      db.prepare("INSERT INTO users (id, username, avatar, status, is_admin) VALUES (?, 'Помощник', ?, 'online', 0)").run(botId, `${SERVER_URL}/uploads/ursa.jpg`);
      botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
      console.log('[Reminder] Бот Помощник создан:', botResult);
    }
    if (!botResult) {
      console.error('[Reminder] Не удалось создать или найти бота Помощник!');
      return;
    }

    const botId = botResult.id;
    const messageId = uuidv4();
    const encryptedText = encryptText(reminderText || '');

    // Убедимся что чат с ботом существует
    ensureBotChat(userId);

    db.run(`
      INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `, [messageId, botChatId, botId, encryptedText, new Date().toISOString()]);

    console.log(`[Reminder] Сообщение сохранено в БД: ${messageId}`);

    // Доставка: unread + realtime (все сессии) + push офлайн
    deliverBotMessage(userId, {
      id: messageId,
      chatId: botChatId,
      senderId: botId,
      senderName: 'Помощник',
      senderAvatar: 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff',
      text: reminderText,
      timestamp: new Date().toISOString(),
      isBotMessage: true
    });
    console.log(`[Reminder] Сообщение отправлено пользователю ${userId}`);

  } catch (err) {
    console.error('Ошибка отправки напоминания о встрече:', err);
    console.error('Stack:', err.stack);
  }
}

/**
 * Запланировать напоминание для задачи.
 * reminderTime — ISO timestamp, когда нужно отправить напоминание.
 */
function scheduleTaskReminder(taskId, userId, username, taskTitle, taskDate, taskTime, reminderTime) {
  // Отменяем старый таймер если есть
  const existing = pendingReminders.get(taskId);
  if (existing) {
    clearTimeout(existing);
    pendingReminders.delete(taskId);
  }

  const now = Date.now();
  const remindAt = new Date(reminderTime + '+00:00').getTime();

  if (remindAt <= now) return;

  const delay = remindAt - now;

  pendingReminders.set(taskId, setTimeout(() => {
    sendTaskReminder(userId, username, taskTitle, taskDate, taskTime);
    pendingReminders.delete(taskId);
  }, delay));

}

/**
 * Восстановить все pending reminders из БД при старте сервера.
 */
function restorePendingReminders() {
  try {
    // SQLite datetime comparison: we store ISO like '2026-06-05T10:00:00'
    // Replace 'T' with space for comparison, or use strftime for consistency
    const tasksRows = db.prepare(`
      SELECT ct.id, ct.title, ct.task_date, ct.task_time, ct.user_id, u.username, ct.reminder_time
      FROM calendar_tasks ct
      JOIN users u ON ct.user_id = u.id
      WHERE ct.reminder_time IS NOT NULL AND REPLACE(ct.reminder_time, 'T', ' ') > datetime('now')
    `).all();

    if (!tasksRows || tasksRows.length === 0) return;

    tasksRows.forEach(row => {
      const taskId = row.id;
      const taskTitle = row.title;
      const taskDate = row.task_date;
      const taskTime = row.task_time;
      const userId = row.user_id;
      const username = row.username;
      const reminderTime = row.reminder_time; // ISO string from DB

      scheduleTaskReminder(taskId, userId, username, taskTitle, taskDate, taskTime, reminderTime);
    });

  } catch (err) {
    // При первом запуске колонка может ещё не существовать — игнорируем
    if (!err.message.includes('no such column')) {
      console.error('Ошибка восстановления напоминаний:', err);
    }
  }
}

// Запускаем восстановление напоминаний после старта сервера
setTimeout(restorePendingReminders, 8000);

/**
 * Планировщик уведомлений о днях рождения
 * Проверяет каждое утро в 8:00 и отправляет поздравления через бота
 */
function scheduleBirthdayChecker() {
  const checkBirthdays = () => {
    try {
      // Проверяем, включены ли уведомления
      const bdSetting = db.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'birthday_notifications_enabled'").get();
      if (bdSetting && bdSetting.setting_value !== '1') return;

      const today = new Date();
      const todayDay = today.getDate();
      const todayMonth = today.getMonth() + 1;

      const birthdayUsers = db.prepare(`
        SELECT id, username, birth_date FROM users
        WHERE birth_date IS NOT NULL
      `).all().filter(row => {
        const bd = new Date(row.birth_date);
        return bd.getDate() === todayDay && (bd.getMonth() + 1) === todayMonth;
      });

      if (birthdayUsers.length === 0) return;

      const botUser = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
      if (!botUser) return;

      // Отправляем каждому пользователю уведомление о сегодняшних именинниках
      const allUsers = db.prepare("SELECT id FROM users WHERE username != 'Помощник'").all();
      allUsers.forEach(user => {
        const botChatId = `bot-chat-${user.id}`;
        const names = birthdayUsers.map(u => `  • ${u.username}`).join('\n');
        const messageId = uuidv4();
        const text = `🎉 *Сегодня день рождения!*\n\nПоздравляем:\n${names}\n\nНе забудьте поздравить коллег! 🎂`;
        const encryptedText = encryptText(text);
        db.run(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
          [messageId, botChatId, botUser.id, encryptedText, new Date().toISOString()]);
        emitToUser(user.id, 'new_message', {
          message: {
            id: messageId, chatId: botChatId, senderId: botUser.id,
            senderName: 'Помощник',
            senderAvatar: 'https://ui-avatars.com/api/?name=🤖&background=667eea&color=fff',
            text, timestamp: new Date().toISOString()
          },
          chat: { id: botChatId, name: 'Помощник', type: 'direct' }
        });
      });
    } catch (err) {
      console.error('Ошибка проверки дней рождений:', err);
    }
  };

  // Рассчитываем задержку до следующего 8:00 утра
  const now = new Date();
  const next8am = new Date(now);
  next8am.setHours(8, 0, 0, 0);
  if (next8am <= now) {
    next8am.setDate(next8am.getDate() + 1);
  }
  const delay = next8am.getTime() - now.getTime();

  setTimeout(() => {
    checkBirthdays();
    setInterval(checkBirthdays, 24 * 60 * 60 * 1000);
  }, delay);
}

setTimeout(scheduleBirthdayChecker, 10000);

// ============================================
// Мысль дня — рассылка от помощника по будням
// ============================================

// Стартовый набор мыслей — если файл не найден, рассылка не запускается
function loadDailyThoughts() {
  try {
    const thoughts = require('../daily-thoughts.json');
    return Array.isArray(thoughts) ? thoughts : [];
  } catch (e) {
    console.error('Ошибка загрузки daily-thoughts.json:', e.message);
    return [];
  }
}
const dailyThoughts = loadDailyThoughts();

/**
 * Отправить «мысль дня» каждому пользователю через бота «Помощник».
 * Каждому — случайную мысль без повторов, пока не будет исчерпан весь список.
 */
function sendDailyThought(targetUserId = null) {
  try {
    if (dailyThoughts.length === 0) return;

    const now = new Date();
    const day = now.getDay(); // 0 = вск, 6 = сб
    if (day === 6 || day === 0) return; // только будни

    const setting = db.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'daily_thought_notifications_enabled'").get();
    if (setting && setting.setting_value !== '1') return;

    const botUser = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
    if (!botUser) return;

    const pad = n => String(n).padStart(2, '0');
    const sentDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const usedStmt = db.prepare('SELECT thought_index FROM sent_daily_thoughts WHERE user_id = ?');
    const insertStmt = db.prepare('INSERT INTO sent_daily_thoughts (user_id, thought_index, sent_date) VALUES (?, ?, ?)');
    const deleteUserStmt = db.prepare('DELETE FROM sent_daily_thoughts WHERE user_id = ?');

    const users = targetUserId
      ? (() => {
          const u = db.prepare("SELECT id, username FROM users WHERE username != 'Помощник' AND id = ?").get(targetUserId);
          return u ? [u] : [];
        })()
      : db.prepare("SELECT id, username FROM users WHERE username != 'Помощник'").all();

    users.forEach(user => {
      try {
        // Дудедуп: если мысль сегодня уже отправлена пользователю (например, после рестарта сервера)
        const alreadyToday = db.prepare('SELECT 1 FROM sent_daily_thoughts WHERE user_id = ? AND sent_date = ?').get(user.id, sentDate);
        if (alreadyToday) return;

        // Кандидаты — индексы из списка, которые пользователь ещё не получал
        const usedRows = usedStmt.all(user.id);
        const usedSet = new Set(usedRows.map(r => r.thought_index));
        let candidates = [];
        for (let i = 0; i < dailyThoughts.length; i++) {
          if (!usedSet.has(i)) candidates.push(i);
        }
        if (candidates.length === 0) {
          // Весь список просмотрен — начинаем новый цикл
          deleteUserStmt.run(user.id);
          candidates = dailyThoughts.map((_, i) => i);
        }

        const idx = candidates[Math.floor(Math.random() * candidates.length)];
        const thought = dailyThoughts[idx];
        insertStmt.run(user.id, idx, sentDate);

        const botChatId = `bot-chat-${user.id}`;
        ensureBotChat(user.id);
        const text = `💡 *Мысль дня*\n\nДоброе утро, ${user.username}!\n\n«${thought.text}»${thought.author ? `\n\n— ${thought.author}` : ''}`;
        const messageId = uuidv4();
        const encryptedText = encryptText(text);

        db.run(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
          [messageId, botChatId, botUser.id, encryptedText, new Date().toISOString()]);
        deliverBotMessage(user.id, {
          id: messageId,
          chatId: botChatId,
          senderId: botUser.id,
          senderName: 'Помощник',
          senderAvatar: 'https://ui-avatars.com/api/?name=🤖&background=667eea&color=fff',
          text,
          timestamp: new Date().toISOString(),
          isBotMessage: true,
          buttons: []
        });
      } catch (err) {
        console.error(`Ошибка отправки мысли дня пользователю ${user.id}:`, err);
      }
    });
  } catch (err) {
    console.error('Ошибка рассылки мысли дня:', err);
  }
}

/**
 * Планировщик: рассылка каждый будний день в 9:00 по времени сервера.
 */
function scheduleDailyThoughtChecker() {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (next9am <= now) {
    next9am.setDate(next9am.getDate() + 1);
  }
  const delay = next9am.getTime() - now.getTime();

  setTimeout(() => {
    sendDailyThought();
    setInterval(sendDailyThought, 24 * 60 * 60 * 1000);
  }, delay);
}

/**
 * Инициализация фоновых задач. Вызывается один раз после initDatabase().
 * Планировщик «мысли дня» запускается через 12с после старта (как ранее).
 */
function setupJobs(deps) {
  ({ db, emitToUser, SERVER_URL, encryptText, uuidv4, ensureBotChat, deliverBotMessage } = deps);
  setTimeout(scheduleDailyThoughtChecker, 12000);
}

module.exports = { setupJobs, scheduleTaskReminder, restorePendingReminders, sendMeetingReminder };
