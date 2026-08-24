/**
 * Админ-панель. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const path = require('path');
const fs = require('fs');

module.exports = function register(app, deps) {
  const { db, io, onlineUsers, UPLOADS_PATH, decryptText, uuidv4, bcrypt, speakeasy, QRCode, admin, checkAdmin } = deps;

app.get('/api/admin/check', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  const isAdmin = checkAdmin(userId);
  res.json({ isAdmin });
});

// Получение статистики системы
app.get('/api/admin/stats', (req, res) => {
  const { userId } = req.query;

  // Проверяем админа
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get()?.count || 0;
  const totalFiles = db.prepare('SELECT COUNT(*) as count FROM messages WHERE file_data IS NOT NULL').get()?.count || 0;
  const onlineUsersCount = Array.from(onlineUsers).length;
  
  // Размер папки uploads
  let uploadsSize = 0;
  try {
    if (fs.existsSync(UPLOADS_PATH)) {
      const files = fs.readdirSync(UPLOADS_PATH);
      files.forEach(file => {
        const filePath = path.join(UPLOADS_PATH, file);
        uploadsSize += fs.statSync(filePath).size;
      });
    }
  } catch (e) {}
  
  res.json({
    totalUsers,
    totalMessages,
    totalFiles,
    onlineUsers: onlineUsersCount,
    uploadsSize
  });
});

// Получение списка всех пользователей
app.get('/api/admin/users', (req, res) => {
  const { userId } = req.query;

  // Проверяем админа
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const userList = db.prepare('SELECT id, username, email, full_name, status, is_admin, created_at, last_seen, host, ip_address, can_book_meeting_room, can_edit_wiki, can_view_kpi, app_version FROM users ORDER BY username').all().map(row => ({
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    status: row.status,
    is_admin: row.is_admin,
    created_at: row.created_at,
    last_seen: row.last_seen,
    host: row.host || 'unknown',
    ip_address: row.ip_address || 'unknown',
    can_book_meeting_room: row.can_book_meeting_room || 0,
    can_edit_wiki: row.can_edit_wiki || 0,
    can_view_kpi: row.can_view_kpi || 0,
    app_version: row.app_version || null
  }));

  // Версия сервера для бейджей «актуальная/устарела» — читаем безопасно
  let serverVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    serverVersion = pkg.version || '1.0.0';
  } catch (e) { /* package.json недоступен — используем дефолт */ }

  res.json({ users: userList, serverVersion });
});

// Блокировка/разблокировка пользователя
app.put('/api/admin/users/:userId/status', (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  const { adminId } = req.query;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  
  db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);

  
  res.json({ success: true });
});

// Удаление пользователя
app.delete('/api/admin/users/:userId', (req, res) => {
  const { userId } = req.params;
  const { adminId } = req.query;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  
  // Удаляем сообщения
  db.run('DELETE FROM messages WHERE sender_id = ?', [userId]);
  // Удаляем участников
  db.run('DELETE FROM chat_participants WHERE user_id = ?', [userId]);
  // Удаляем задачи
  db.run('DELETE FROM calendar_tasks WHERE user_id = ?', [userId]);
  // Удаляем шаринги
  db.run('DELETE FROM task_shares WHERE from_user_id = ? OR to_user_id = ?', [userId, userId]);
  // Удаляем пользователя
  db.run('DELETE FROM users WHERE id = ?', [userId]);


  res.json({ success: true });
});

// API для создания пользователя администратором
app.post('/api/admin/users', (req, res) => {
  const { username, email, password, is_admin, adminId } = req.body;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  // Проверка существующего пользователя
  const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, emailLower);
  if (existingUser) {
    return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
  }

  // Хеширование пароля
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = uuidv4();
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

  try {
    db.run(`
      INSERT INTO users (id, username, email, password_hash, avatar, status, is_admin)
      VALUES (?, ?, ?, ?, ?, 'offline', ?)
    `, [userId, username, emailLower, passwordHash, avatar, is_admin || 0]);


    res.json({
      success: true,
      user: {
        id: userId,
        username,
        email: emailLower,
        avatar,
        is_admin: is_admin || 0
      }
    });
  } catch (err) {
    console.error('Ошибка создания пользователя:', err);
    res.status(500).json({ error: 'Ошибка при создании пользователя' });
  }
});

// API для изменения прав администратора
app.put('/api/admin/users/:userId/rights', (req, res) => {
  const { userId } = req.params;
  const { is_admin, adminId } = req.body;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    db.run('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin ? 1 : 0, userId]);


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения прав:', err);
    res.status(500).json({ error: 'Ошибка при изменении прав' });
  }
});

// API для изменения права на бронирование переговорной
app.put('/api/admin/users/:userId/meeting-room-rights', (req, res) => {
  const { userId } = req.params;
  const { can_book_meeting_room, adminId } = req.body;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  // Root всегда имеет право на бронирование
  const userCheck = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (userCheck && userCheck.username === 'Root') {
    return res.status(400).json({ error: 'Нельзя изменить права Root' });
  }

  try {
    db.run('UPDATE users SET can_book_meeting_room = ? WHERE id = ?', [can_book_meeting_room ? 1 : 0, userId]);


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения права на бронирование:', err);
    res.status(500).json({ error: 'Ошибка при изменении права' });
  }
});

// API для изменения права на редактирование wiki
app.put('/api/admin/users/:userId/wiki-rights', (req, res) => {
  const { userId } = req.params;
  const { can_edit_wiki, adminId } = req.body;

  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const userCheck = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (userCheck && userCheck.username === 'Root') {
    return res.status(400).json({ error: 'Нельзя изменить права Root' });
  }

  try {
    db.run('UPDATE users SET can_edit_wiki = ? WHERE id = ?', [can_edit_wiki ? 1 : 0, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения права на wiki:', err);
    res.status(500).json({ error: 'Ошибка при изменении права' });
  }
});

app.put('/api/admin/users/:userId/kpi-rights', (req, res) => {
  const { userId } = req.params;
  const { can_view_kpi, adminId } = req.body;

  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const userCheck = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (userCheck && userCheck.username === 'Root') {
    return res.status(400).json({ error: 'Нельзя изменить права Root' });
  }

  try {
    db.run('UPDATE users SET can_view_kpi = ? WHERE id = ?', [can_view_kpi ? 1 : 0, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения права на KPI:', err);
    res.status(500).json({ error: 'Ошибка при изменении права' });
  }
});

// API для сброса пароля пользователя
app.put('/api/admin/users/:userId/reset-password', (req, res) => {
  const { userId } = req.params;
  const { newPassword, adminId } = req.body;

  // Проверяем админа
  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
  }

  try {
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);


    // Логируем событие
    const logId = uuidv4();
    const adminUser = db.prepare('SELECT username FROM users WHERE id = ?').get(adminId);
    const adminName = adminUser?.username || 'Admin';
    db.run(`INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, 'password_reset', `Пароль сброшен администратором ${adminName}`, userId, null, 'success']);


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сброса пароля:', err);
    res.status(500).json({ error: 'Ошибка при сбросе пароля' });
  }
});

// ============================================
// 2FA (TOTP) для администраторов
// ============================================

// Генерация TOTP секрета и QR-кода
app.post('/api/admin/2fa/generate', (req, res) => {
  const { userId } = req.body;
  if (!checkAdmin(userId)) return res.status(403).json({ error: 'Доступ запрещён' });

  try {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const secret = speakeasy.generateSecret({ name: `Чат УРСА (${user.username})` });
    // Сохраняем секрет временно (до верификации)
    db.run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret.base32, userId]);

    QRCode.toDataURL(secret.otpauth_url, (err, qrUrl) => {
      if (err) return res.status(500).json({ error: 'Ошибка генерации QR' });
      res.json({ secret: secret.base32, qrCode: qrUrl });
    });
  } catch (err) {
    console.error('Ошибка генерации 2FA:', err);
    res.status(500).json({ error: 'Ошибка генерации 2FA' });
  }
});

// Верификация TOTP и включение 2FA
app.post('/api/admin/2fa/verify', (req, res) => {
  const { userId, token } = req.body;
  if (!checkAdmin(userId)) return res.status(403).json({ error: 'Доступ запрещён' });

  try {
    const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId);
    if (!user || !user.totp_secret) return res.status(400).json({ error: 'Секрет не найден. Сгенерируйте ключ сначала.' });

    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token });
    if (!verified) return res.status(400).json({ error: 'Неверный код. Попробуйте снова.' });

    db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', [userId]);
    res.json({ success: true, message: '2FA включена' });
  } catch (err) {
    console.error('Ошибка верификации 2FA:', err);
    res.status(500).json({ error: 'Ошибка верификации 2FA' });
  }
});

// Отключение 2FA
app.post('/api/admin/2fa/disable', (req, res) => {
  const { userId } = req.body;
  if (!checkAdmin(userId)) return res.status(403).json({ error: 'Доступ запрещён' });

  try {
    db.run('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [userId]);
    res.json({ success: true, message: '2FA отключена' });
  } catch (err) {
    console.error('Ошибка отключения 2FA:', err);
    res.status(500).json({ error: 'Ошибка отключения 2FA' });
  }
});

// API для получения активных сессий
app.get('/api/admin/sessions', (req, res) => {
  const { userId } = req.query;

  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    const sessionsList = db.prepare(`
      SELECT s.id, s.user_id, s.ip_address, s.browser, s.login_time, s.last_activity,
             u.username, u.avatar
      FROM admin_user_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.last_activity DESC
    `).all().map(row => ({
      id: row.id,
      user_id: row.user_id,
      ip: row.ip_address,
      browser: row.browser,
      loginTime: row.login_time,
      lastActivity: row.last_activity,
      username: row.username,
      avatar: row.avatar
    }));

    res.json({ sessions: sessionsList });
  } catch (err) {
    console.error('Ошибка получения сессий:', err);
    res.status(500).json({ error: 'Ошибка при получении сессий' });
  }
});

// API для завершения сессии
app.delete('/api/admin/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { adminId } = req.body;

  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    db.run('DELETE FROM admin_user_sessions WHERE id = ?', [sessionId]);


    // Логируем событие
    const logId = uuidv4();
    db.run(`INSERT INTO security_logs (id, event_type, event, status) VALUES (?, ?, ?, ?)`,
      [logId, 'session_terminated', 'Сессия завершена администратором', 'success']);


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка завершения сессии:', err);
    res.status(500).json({ error: 'Ошибка при завершении сессии' });
  }
});

// API для получения списка файлов
app.get('/api/admin/files', (req, res) => {
  const { userId } = req.query;

  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    const filesList = db.prepare(`
      SELECT id, file_data, timestamp
      FROM messages
      WHERE file_data IS NOT NULL
      ORDER BY timestamp DESC
    `).all().map(row => {
      let fileData;
      try {
        fileData = JSON.parse(row.file_data);
      } catch {
        return null;
      }
      return {
        id: row.id,
        name: fileData.name || 'Без имени',
        url: fileData.url || '',
        size: fileData.size || 0,
        mime_type: fileData.mimetype || '',
        created_at: row.timestamp
      };
    }).filter(Boolean);

    res.json({ files: filesList });
  } catch (err) {
    console.error('Ошибка получения файлов:', err);
    res.status(500).json({ error: 'Ошибка при получении файлов' });
  }
});

// API для удаления файла
app.delete('/api/admin/files/:fileId', (req, res) => {
  const { fileId } = req.params;
  const { adminId } = req.body;

  if (!checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    // Получаем информацию о файле перед удалением
    const fileData = db.prepare('SELECT file_data FROM messages WHERE id = ?').get(fileId);
    const fileUrl = fileData?.file_data;
    
    if (fileUrl) {
      const parsedFileData = JSON.parse(fileUrl);
      const fileName = parsedFileData.url?.split('/').pop();
      if (fileName) {
        const filePath = path.join(UPLOADS_PATH, fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Удаляем запись из БД
    db.run('UPDATE messages SET file_data = NULL WHERE id = ?', [fileId]);


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления файла:', err);
    res.status(500).json({ error: 'Ошибка при удалении файла' });
  }
});

// API для получения логов безопасности
app.get('/api/admin/security-logs', (req, res) => {
  const { userId } = req.query;

  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    const logsList = db.prepare(`
      SELECT id, event_type, event, user_id, username, ip_address, status, timestamp
      FROM security_logs
      ORDER BY timestamp DESC
      LIMIT 100
    `).all().map(row => ({
      id: row.id,
      event_type: row.event_type,
      event: row.event,
      user_id: row.user_id,
      username: row.username,
      ip_address: row.ip_address,
      status: row.status,
      timestamp: row.timestamp
    }));

    res.json({ logs: logsList });
  } catch (err) {
    console.error('Ошибка получения логов:', err);
    res.status(500).json({ error: 'Ошибка при получении логов' });
  }
});

// API для получения настроек интерфейса
app.get('/api/admin/ui-settings', (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM ui_settings').all();
    const settingsObj = {};
    settingsRows.forEach(row => {
      settingsObj[row.key] = row.value;
    });

    res.json({ 
      settings: {
        siteName: settingsObj.siteName || 'Чат',
        logoUrl: settingsObj.logoUrl || '',
        primaryColor: settingsObj.primaryColor || '#667eea',
        secondaryColor: settingsObj.secondaryColor || '#764ba2'
      }
    });
  } catch (err) {
    console.error('Ошибка получения настроек:', err);
    res.status(500).json({ error: 'Ошибка при получении настроек' });
  }
});

// API для сохранения настроек интерфейса
app.put('/api/admin/ui-settings', (req, res) => {
  const { siteName, logoUrl, primaryColor, secondaryColor } = req.body;

  try {
    const settings = [
      { key: 'siteName', value: siteName },
      { key: 'logoUrl', value: logoUrl },
      { key: 'primaryColor', value: primaryColor },
      { key: 'secondaryColor', value: secondaryColor }
    ];

    settings.forEach(({ key, value }) => {
      db.run(`INSERT OR REPLACE INTO ui_settings (key, value) VALUES (?, ?)`, [key, value]);
    });


    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
    res.status(500).json({ error: 'Ошибка при сохранении настроек' });
  }
});

// ============================================
// API для удаления сообщений администратором
// ============================================

// Удаление сообщения
app.delete('/api/admin/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { adminId, userId } = req.query;

  // Если передан userId вместо adminId, проверяем существование пользователя
  const userIdToCheck = userId || adminId;
  if (!userIdToCheck) {
    return res.status(400).json({ error: 'userId или adminId обязателен' });
  }

  // Проверяем что userId не является строкой "undefined" (результат интерполяции undefined в URL)
  if (userIdToCheck === 'undefined' || userIdToCheck === 'null') {
    return res.status(400).json({ error: 'Некорректный userId' });
  }

  // Проверяем существование пользователя
  const userData = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(userIdToCheck);

  if (!userData) {
    return res.status(403).json({ error: 'Пользователь не найден' });
  }

  if (!messageId || messageId === 'undefined' || messageId === 'null') {
    return res.status(400).json({ error: 'messageId обязателен и должен быть валидным' });
  }

  try {
    // Получаем информацию о сообщении для проверки
    const messageData = db.prepare(`
      SELECT m.id, m.chat_id, m.sender_id, m.text as text, m.file_data, m.timestamp,
             u.username as sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);

    if (!messageData) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    const chatId = messageData.chat_id;
    const senderId = messageData.sender_id;
    const text = decryptText(messageData.text || '') || '';
    const fileData = messageData.file_data;
    const senderUsername = messageData.sender_username;

    // Проверяем права на удаление
    // В общем чате (chatId = 'general') могут удалять только администраторы или автор сообщения
    // В других чатах могут удалять все пользователи
    if (chatId === 'general' && userData.is_admin !== 1 && senderId !== userIdToCheck) {
      return res.status(403).json({ error: 'В общем чате сообщения могут удалять только администраторы или автор сообщения' });
    }

    // Удаляем файл если он есть
    if (fileData) {
      try {
        const parsedFileData = JSON.parse(fileData);
        const fileName = parsedFileData.url?.split('/').pop();
        if (fileName) {
          const filePath = path.join(UPLOADS_PATH, fileName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (e) {
        console.error('Ошибка удаления файла:', e);
      }
    }

    // Удаляем сообщение из БД
    db.run('DELETE FROM messages WHERE id = ?', [messageId]);


    // Логируем событие удаления
    const logId = uuidv4();
    const userNameRow = db.prepare('SELECT username FROM users WHERE id = ?').get(userIdToCheck);
    const userName = userNameRow?.username || 'User';
    
    db.run(`INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, 'message_deleted', `Сообщение от ${senderUsername} удалено пользователем ${userName}`, senderId, senderUsername, 'warning']);


    // Уведомляем клиентов через socket о удалении сообщения
    const deletedMessage = {
      id: messageId,
      chat_id: chatId,
      sender_id: senderId,
      text: text,
      file_data: fileData,
      deleted_by: userIdToCheck,
      deleted_at: new Date().toISOString()
    };

    // Отправляем событие всем подключенным клиентам в этом чате
    io.to(chatId).emit('message_deleted', deletedMessage);

    res.json({
      success: true,
      messageId,
      chatId,
      deletedMessage: deletedMessage
    });
  } catch (err) {
    console.error('Ошибка удаления сообщения:', err);
    res.status(500).json({ error: 'Ошибка при удалении сообщения' });
  }
});

// API для регистрации
};
