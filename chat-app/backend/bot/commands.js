/**
 * Bot Commands — обработчики специальных команд бота с запросами к БД.
 */

// Кэш дней рождения: { data: [...], expires: timestamp } — обновляется раз в 60 сек
let birthdaysCache = { data: [], expires: 0 };

/**
 * Обработка команды /сегодня — задачи, дни рождения, встречи на сегодня.
 * @param {Object} deps - зависимости
 * @param {Object} deps.db - SQLite database (better-sqlite3)
 * @param {Function} deps.sendBotMessage - отправка сообщения бота
 * @param {Object} onlineUser - объект пользователя из onlineUsers Map
 * @param {string} chatId - ID чата с ботом
 */
function handleTodayCommand({ db, sendBotMessage, socket, chatId }, onlineUser) {
  setTimeout(() => {
    try {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      const todayIso = today.toISOString().split('T')[0];

      const tasksRows = db.prepare(`
        SELECT title, task_time FROM calendar_tasks
        WHERE user_id = ? AND task_date LIKE ?
      `).all(onlineUser.id, todayIso + '%');
      const tasks = tasksRows.map(row => ({ title: row.title, time: row.task_time }));

      const now = Date.now();
      if (now - birthdaysCache.expires > 60000) {
        const allBirthdays = db.prepare('SELECT username, birth_date FROM users WHERE birth_date IS NOT NULL').all();
        birthdaysCache.data = allBirthdays;
        birthdaysCache.expires = now;
      }
      const todayDay = today.getDate();
      const todayMonth = today.getMonth() + 1;
      const birthdaysToday = birthdaysCache.data
        .filter(row => {
          const bd = new Date(row.birth_date);
          return bd.getDate() === todayDay && (bd.getMonth() + 1) === todayMonth;
        })
        .map(row => row.username) || [];

      const meetingsRows = db.prepare(`
        SELECT title, start_time, end_time FROM meeting_room_bookings
        WHERE meeting_date LIKE ? AND organizer_id = ?
      `).all(todayIso + '%', onlineUser.id);
      const meetingsList = meetingsRows.map(row => ({
        title: row.title,
        time: `${row.start_time} - ${row.end_time}`
      }));

      let responseText = `📅 *${todayStr}*\n\n`;

      if (tasks.length > 0) {
        responseText += `✅ *Задачи (${tasks.length}):*\n`;
        tasks.forEach((t, i) => {
          responseText += `${i + 1}. ${t.title}${t.time ? ` ⏰ ${t.time}` : ''}\n`;
        });
        responseText += '\n';
      } else {
        responseText += `✅ *Задачи:* Нет на сегодня\n\n`;
      }

      if (birthdaysToday.length > 0) {
        responseText += `🎂 *Дни рождения:*\n`;
        birthdaysToday.forEach(name => {
          responseText += `• ${name}\n`;
        });
        responseText += '\n';
      }

      if (meetingsList.length > 0) {
        responseText += `🏢 *Встречи (${meetingsList.length}):*\n`;
        meetingsList.forEach((m, i) => {
          responseText += `${i + 1}. ${m.title} ⏰ ${m.time}\n`;
        });
      } else {
        responseText += `🏢 *Встречи:* Нет на сегодня\n`;
      }

      responseText += '\n💡 *Совет:* Начинайте день с проверки этой команды!';

      sendBotMessage(socket, chatId, responseText, [
        { label: '📅 Календарь', action: '/календарь' },
        { label: '🔔 Напоминания', action: '/уведомления' }
      ]);
    } catch (err) {
      console.error('Ошибка команды /сегодня:', err);
      sendBotMessage(socket, chatId, '😕 Произошла ошибка при получении данных. Попробуйте позже.', []);
    }
  }, 500);
};

/**
 * Обработка команды /контакты — телефонная книга с номерами телефонов.
 * @param {Object} deps - зависимости
 * @param {Object} deps.db - SQLite database (better-sqlite3)
 * @param {Function} deps.sendBotMessage - отправка сообщения бота
 * @param {string} chatId - ID чата с ботом
 */
function handleContactsCommand({ db, sendBotMessage, socket, chatId }) {
  setTimeout(() => {
    try {
      const users = db.prepare(`
        SELECT username, mobile_phone, work_phone, email, status
        FROM users
        WHERE username != 'Помощник'
          AND (
            (mobile_phone IS NOT NULL AND TRIM(mobile_phone) != '')
            OR
            (work_phone IS NOT NULL AND TRIM(work_phone) != '')
          )
        ORDER BY username
      `).all();

      const contacts = users;

      if (contacts.length === 0) {
        sendBotMessage(socket, chatId, '📞 *Контакты:*\n\nСписок контактов пуст.', []);
        return;
      }

      let responseText = `📞 *Телефонная книга (${contacts.length}):*\n\n`;
      contacts.forEach(row => {
        const status = row.status === 'online' ? '🟢' : '⚫';
        responseText += `${status} *${row.username}*\n`;
        if (row.mobile_phone) responseText += `  📱 Моб: ${row.mobile_phone}\n`;
        if (row.work_phone) responseText += `  📞 Раб: ${row.work_phone}\n`;
        if (row.email) responseText += `  ✉️ ${row.email}\n`;
        responseText += '\n';
      });

      sendBotMessage(socket, chatId, responseText, [
        { label: '👤 Профиль', action: '/профиль' },
        { label: '🔙 Назад', action: '/помощь' }
      ]);
    } catch (err) {
      console.error('Ошибка команды /контакты:', err);
      sendBotMessage(socket, chatId, '😕 Произошла ошибка при получении контактов.', []);
    }
  }, 500);
};

module.exports = { handleTodayCommand, handleContactsCommand };
