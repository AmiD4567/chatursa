/**
 * REST API бота-помощника. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, admin, checkAdmin, botAnalytics, uuidv4, encryptText, ensureBotChat, deliverBotMessage } = deps;

  // Рассылку от Помощника может отправлять ТОЛЬКО пользователь Root
  function checkRoot(userId) {
    if (!userId) return false;
    try {
      const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      return row ? row.username === 'Root' : false;
    } catch (e) { return false; }
  }

app.get('/api/bot/stats/:userId', (req, res) => {
  const { userId } = req.params;

  try {
    // Количество сообщений
    const messagesCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sender_id = ?').get(userId);
    const totalMessages = messagesCount?.count || 0;

    // Количество файлов
    const filesCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sender_id = ? AND file_data IS NOT NULL').get(userId);
    const totalFiles = filesCount?.count || 0;

    // Количество задач
    const tasksCount = db.prepare('SELECT COUNT(*) as count FROM calendar_tasks WHERE user_id = ?').get(userId);
    const totalTasks = tasksCount?.count || 0;

    // Дата регистрации
    const userDate = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
    const createdAt = userDate?.created_at || new Date().toISOString();

    // Дней в чате
    const daysInChat = Math.floor((new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      stats: {
        messages: totalMessages,
        files: totalFiles,
        tasks: totalTasks,
        daysInChat: daysInChat,
        createdAt: createdAt
      }
    });
  } catch (err) {
    console.error('Ошибка получения статистики:', err);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

// Контакты пользователей
app.get('/api/bot/contacts', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, username, email, full_name, mobile_phone, work_phone, avatar, status
      FROM users
      WHERE username != 'Помощник'
        AND (
          (mobile_phone IS NOT NULL AND TRIM(mobile_phone) != '')
          OR
          (work_phone IS NOT NULL AND TRIM(work_phone) != '')
        )
      ORDER BY username
    `).all();

    const contacts = rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      full_name: row.full_name,
      mobile_phone: row.mobile_phone,
      work_phone: row.work_phone,
      avatar: row.avatar,
      status: row.status
    }));

    res.json({ success: true, contacts });
  } catch (err) {
    console.error('Ошибка получения контактов:', err);
    res.status(500).json({ error: 'Ошибка при получении контактов' });
  }
});

// События на сегодня
app.get('/api/bot/today/:userId', (req, res) => {
  const { userId } = req.params;

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Задачи на сегодня
    const tasksRows = db.prepare(`
      SELECT id, title, description, task_date, task_time, color
      FROM calendar_tasks
      WHERE user_id = ? AND task_date LIKE ?
    `).all(userId, `${todayStr}%`);

    const tasks = tasksRows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      task_date: row.task_date,
      task_time: row.task_time,
      color: row.color
    }));

    // Дни рождения сегодня
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;

    const birthdaysRows = db.prepare(`
      SELECT id, username, avatar, birth_date
      FROM users
      WHERE birth_date IS NOT NULL
    `).all();

    const birthdaysToday = birthdaysRows
      .filter(row => {
        const birthDate = new Date(row.birth_date);
        return birthDate.getDate() === todayDay && (birthDate.getMonth() + 1) === todayMonth;
      })
      .map(row => ({
        id: row.id,
        username: row.username,
        avatar: row.avatar,
        birth_date: row.birth_date
      }));

    // Встречи сегодня
    const meetingsRows = db.prepare(`
      SELECT id, title, description, meeting_date, start_time, end_time
      FROM meeting_room_bookings
      WHERE meeting_date LIKE ?
    `).all(`${todayStr}%`);

    const meetings = meetingsRows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      meeting_date: row.meeting_date,
      start_time: row.start_time,
      end_time: row.end_time
    }));

    res.json({
      success: true,
      today: {
        date: todayStr,
        tasks,
        birthdays: birthdaysToday,
        meetings
      }
    });
  } catch (err) {
    console.error('Ошибка получения событий на сегодня:', err);
    res.status(500).json({ error: 'Ошибка при получении событий' });
  }
});

// Аналитика бота (для админа)
app.get('/api/bot/analytics', (req, res) => {
  const { userId } = req.query;
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  try {
    const report = botAnalytics.getReport();
    res.json({ success: true, analytics: report });
  } catch (err) {
    console.error('Ошибка получения аналитики бота:', err);
    res.status(500).json({ error: 'Ошибка при получении аналитики' });
  }
});

// Сброс аналитики бота (для админа)
app.post('/api/bot/analytics/reset', (req, res) => {
  const { userId } = req.body;
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  try {
    botAnalytics.reset();
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сброса аналитики:', err);
    res.status(500).json({ error: 'Ошибка при сбросе' });
  }
});

// Получение настроек бота
app.get('/api/bot/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT setting_key, setting_value FROM bot_settings').all();
    const result = {};
    settings.forEach(s => { result[s.setting_key] = s.setting_value === '1'; });
    res.json({ success: true, settings: result });
  } catch (err) {
    console.error('Ошибка получения настроек бота:', err);
    res.status(500).json({ error: 'Ошибка при получении настроек' });
  }
});

// Обновление настроек бота (админ)
app.post('/api/bot/settings', (req, res) => {
  const { userId, settings } = req.body;
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  try {
    const stmt = db.prepare('UPDATE bot_settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?');
    const now = new Date().toISOString();
    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(value ? '1' : '0', now, key);
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка обновления настроек бота:', err);
    res.status(500).json({ error: 'Ошибка при обновлении настроек' });
  }
});

// ============================================
// Рассылка от имени Помощника (только Root)
// ============================================

// Сколько получателей у рассылки (для подтверждения в UI)
app.get('/api/bot/broadcast/recipients', (req, res) => {
  const { userId } = req.query;
  if (!checkRoot(userId)) {
    return res.status(403).json({ error: 'Только Root может делать рассылку' });
  }
  try {
    const total = db.prepare("SELECT COUNT(*) as c FROM users WHERE username != 'Помощник' AND id != 'ai-agent'").get()?.c || 0;
    res.json({ success: true, total });
  } catch (err) {
    console.error('Ошибка подсчёта получателей:', err);
    res.status(500).json({ error: 'Ошибка при подсчёте получателей' });
  }
});

// Отправить сообщение от Помощника всем пользователям.
// Использует тот же путь доставки, что и напоминания/«мысль дня» (deliverBotMessage),
// поэтому не затрагивает движок бота (команды, онбординг, поддержку и т.д.).
app.post('/api/bot/broadcast', (req, res) => {
  const { userId, text, buttons } = req.body || {};

  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  if (!checkRoot(userId)) {
    return res.status(403).json({ error: 'Только Root может делать рассылку' });
  }

  const messageText = String(text || '').trim();
  if (!messageText) return res.status(400).json({ error: 'Текст рассылки пуст' });
  if (messageText.length > 4000) {
    return res.status(400).json({ error: 'Текст слишком длинный (макс. 4000 символов)' });
  }

  // Санитайз кнопок: не более 6, обрезаем длины
  let safeButtons = [];
  if (Array.isArray(buttons)) {
    safeButtons = buttons
      .filter(b => b && typeof b.label === 'string' && typeof b.action === 'string')
      .slice(0, 6)
      .map(b => ({ label: b.label.trim().slice(0, 40), action: b.action.trim().slice(0, 200) }))
      .filter(b => b.label && b.action);
  }

  try {
    const botUser = db.prepare("SELECT id, username, avatar FROM users WHERE username = 'Помощник'").get();
    if (!botUser) return res.status(500).json({ error: 'Помощник не найден' });

    const recipients = db.prepare("SELECT id FROM users WHERE username != 'Помощник' AND id != 'ai-agent'").all();
    let sent = 0;

    for (const u of recipients) {
      try {
        ensureBotChat(u.id);
        const botChatId = `bot-chat-${u.id}`;
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();

        db.run(
          `INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
          [messageId, botChatId, botUser.id, encryptText(messageText), timestamp]
        );
        if (safeButtons.length) {
          try {
            db.run(`UPDATE messages SET button_data = ? WHERE id = ?`, [JSON.stringify(safeButtons), messageId]);
          } catch (e) { /* колонка может отсутствовать в старых схемах */ }
        }

        // unread + realtime во все сессии + push офлайн делает deliverBotMessage
        deliverBotMessage(u.id, {
          id: messageId,
          chatId: botChatId,
          senderId: botUser.id,
          senderName: 'Помощник',
          senderAvatar: botUser.avatar || 'https://ui-avatars.com/api/?name=🤖&background=667eea&color=fff',
          text: messageText,
          timestamp,
          isBotMessage: true,
          buttons: safeButtons
        });
        sent++;
      } catch (e) {
        console.error(`[Broadcast] Ошибка отправки пользователю ${u.id}:`, e.message);
      }
    }

    // Аудит в журнале безопасности
    try {
      const rootName = db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username || 'Root';
      db.run(
        `INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), 'broadcast', `Рассылка от Помощника (${sent}/${recipients.length}): ${messageText.slice(0, 120)}`, userId, rootName, 'success']
      );
    } catch (e) { /* аудит не должен ломать рассылку */ }

    console.log(`[Broadcast] Сообщение от Помощника отправлено ${sent}/${recipients.length} пользователям`);
    res.json({ success: true, sent, total: recipients.length });
  } catch (err) {
    console.error('Ошибка рассылки от Помощника:', err);
    res.status(500).json({ error: 'Ошибка при рассылке' });
  }
});

// Список обращений в поддержку (для админа)
app.get('/api/admin/support-requests', (req, res) => {
  const { userId, status } = req.query;
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  try {
    let query = 'SELECT * FROM support_requests';
    const params = [];
    if (status && status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const requests = db.prepare(query).all(...params);
    res.json({ success: true, requests });
  } catch (err) {
    console.error('Ошибка получения обращений:', err);
    res.status(500).json({ error: 'Ошибка при получении обращений' });
  }
});

// Закрыть обращение в поддержку
app.post('/api/admin/support-requests/:id/close', (req, res) => {
  const { userId } = req.body;
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  try {
    const { id } = req.params;
    db.run("UPDATE support_requests SET status = 'closed' WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка закрытия обращения:', err);
    res.status(500).json({ error: 'Ошибка при закрытии обращения' });
  }
});

// Поиск по wiki-статьям (для бота и пользователей)
};
