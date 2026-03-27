const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

// Настройка логирования в файл
const logFile = path.join(__dirname, 'server-runtime.log');
const originalLog = console.log;
console.log = (...args) => {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.join(' ')}\n`;
  fs.appendFileSync(logFile, message);
  originalLog(...args);
};

// Загрузка конфигурации
let config = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('Конфигурация загружена из config.json');
}

// Используем переменные окружения от Electron или значения из config
const PORT = process.env.CHAT_APP_PORT || config.server?.port || 3001;
const DATA_PATH = process.env.CHAT_APP_DATA_PATH || __dirname;
const DB_PATH = process.env.CHAT_APP_DB_PATH || path.join(__dirname, 'chat.db');
const UPLOADS_PATH = process.env.CHAT_APP_UPLOADS_PATH || config.uploads?.path || path.join(__dirname, 'uploads');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let db = null;

// Вспомогательная функция для проверки прав админа
function checkAdmin(userId) {
  const result = db.exec(`SELECT is_admin FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
  if (!result[0] || result[0].values.length === 0) return false;
  return result[0].values[0][0] === 1;
}

// Инициализация базы данных
async function initDatabase() {
  const SQL = await initSqlJs();

  // Загружаем или создаем базу
  try {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('База данных загружена из файла');
    console.log(`Путь к БД: ${DB_PATH}`);
    // Проверка is_admin для Root сразу после загрузки
    const rootCheck = db.exec("SELECT is_admin FROM users WHERE username = 'Root'");
    console.log('is_admin для Root после загрузки:', rootCheck[0]?.values[0][0]);
  } catch (err) {
    db = new SQL.Database();
    console.log('Создана новая база данных');
    console.log(`Путь к БД: ${DB_PATH}`);
  }

  // Создание таблиц
  db.run(`
    -- Таблица пользователей
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      avatar TEXT,
      full_name TEXT,
      birth_date TEXT,
      about TEXT,
      mobile_phone TEXT,
      work_phone TEXT,
      status_text TEXT,
      host TEXT,
      ip_address TEXT,
      status TEXT DEFAULT 'offline',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Добавление новых колонок если они не существуют (миграция)
  try {
    db.run('ALTER TABLE users ADD COLUMN mobile_phone TEXT');
  } catch (e) {
    // Колонка уже существует
  }
  try {
    db.run('ALTER TABLE users ADD COLUMN work_phone TEXT');
  } catch (e) {
    // Колонка уже существует
  }
  try {
    db.run('ALTER TABLE users ADD COLUMN status_text TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления task_time
  try {
    db.run('ALTER TABLE calendar_tasks ADD COLUMN task_time TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления read_at в сообщения
  try {
    db.run('ALTER TABLE messages ADD COLUMN read_at TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления status_text
  try {
    db.run('ALTER TABLE users ADD COLUMN status_text TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления is_admin
  try {
    db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
  } catch (e) {
    // Колонка уже существует
  }

  // Установим админа для первого пользователя (Root)
  try {
    db.run("UPDATE users SET is_admin = 1 WHERE username = 'Root'");
    saveDatabase();
  } catch (e) {
    // Пользователь ещё не создан
  }

  // Миграция для добавления task_time
  try {
    db.run('ALTER TABLE calendar_tasks ADD COLUMN task_time TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления read_at в сообщения
  try {
    db.run('ALTER TABLE messages ADD COLUMN read_at TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления read_at в сообщения
  try {
    db.run('ALTER TABLE messages ADD COLUMN read_at TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления forwarded_from в сообщения
  try {
    db.run('ALTER TABLE messages ADD COLUMN forwarded_from TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция для добавления can_book_meeting_room в users
  try {
    db.run('ALTER TABLE users ADD COLUMN can_book_meeting_room INTEGER DEFAULT 0');
  } catch (e) {
    // Колонка уже существует
  }

  // Таблица бронирования переговорной
  db.run(`
    CREATE TABLE IF NOT EXISTS meeting_room_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      meeting_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      organizer_id TEXT,
      organizer_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizer_id) REFERENCES users(id)
    );
  `);

  // Таблица общих задач
  db.run(`
    CREATE TABLE IF NOT EXISTS task_shares (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_task_shares_from ON task_shares(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_task_shares_to ON task_shares(to_user_id);
  `);

  // Таблица задач календаря
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      task_date TEXT NOT NULL,
      task_time TEXT,
      color TEXT DEFAULT '#667eea',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_user ON calendar_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_date ON calendar_tasks(task_date);
  `);

  db.run(`
    -- Таблица чатов
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('general', 'direct', 'group')),
      name TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Таблица участников чата
    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id)
    );

    -- Таблица сообщений
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT,
      file_data TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT
    );

    -- Таблица непрочитанных сообщений
    CREATE TABLE IF NOT EXISTS unread_messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, message_id)
    );

    -- Таблица сессий пользователей
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      socket_id TEXT,
      ip_address TEXT,
      browser TEXT,
      login_time TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Таблица логов безопасности
    CREATE TABLE IF NOT EXISTS security_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      event TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      ip_address TEXT,
      status TEXT DEFAULT 'info',
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Таблица настроек интерфейса
    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Индексы для ускорения поиска
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_unread_user ON unread_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON security_logs(timestamp);
  `);
  
  // Проверка и создание общего чата
  const generalChat = db.exec("SELECT * FROM chats WHERE id = 'general'");
  if (generalChat.length === 0 || generalChat[0].values.length === 0) {
    db.run(`
      INSERT INTO chats (id, type, name, created_by)
      VALUES ('general', 'general', 'Общий чат', 'system')
    `);
    saveDatabase();
  }
  
  console.log('База данных инициализирована');
}

// Сохранение базы данных на диск
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Хранилище онлайн пользователей в памяти
const onlineUsers = new Map(); // socketId -> { id, username, socketId }

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_PATH)) {
      fs.mkdirSync(UPLOADS_PATH, { recursive: true });
    }
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads?.maxFileSize || 50 * 1024 * 1024 } // 50MB лимит
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_PATH));

// ============================================
// API для администраторов
// ============================================

// Проверка статуса админа
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
  
  const totalUsers = db.exec('SELECT COUNT(*) as count FROM users')[0]?.values[0][0] || 0;
  const totalMessages = db.exec('SELECT COUNT(*) as count FROM messages')[0]?.values[0][0] || 0;
  const totalFiles = db.exec('SELECT COUNT(*) as count FROM messages WHERE file_data IS NOT NULL')[0]?.values[0][0] || 0;
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
  
  const users = db.exec('SELECT id, username, email, full_name, status, is_admin, created_at, last_seen FROM users ORDER BY username');
  const userList = users[0]?.values.map(row => ({
    id: row[0],
    username: row[1],
    email: row[2],
    full_name: row[3],
    status: row[4],
    is_admin: row[5],
    created_at: row[6],
    last_seen: row[7]
  })) || [];
  
  res.json({ users: userList });
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
  saveDatabase();
  
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
  saveDatabase();

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
  const existingUser = db.exec(`SELECT * FROM users WHERE username = '${username.replace(/'/g, "''")}' OR email = '${emailLower}'`);
  if (existingUser.length > 0 && existingUser[0].values.length > 0) {
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
    saveDatabase();

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
    saveDatabase();

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
  const userCheck = db.exec(`SELECT username FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
  if (userCheck[0] && userCheck[0].values.length > 0 && userCheck[0].values[0][0] === 'Root') {
    return res.status(400).json({ error: 'Нельзя изменить права Root' });
  }

  try {
    db.run('UPDATE users SET can_book_meeting_room = ? WHERE id = ?', [can_book_meeting_room ? 1 : 0, userId]);
    saveDatabase();

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения права на бронирование:', err);
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
    saveDatabase();

    // Логируем событие
    const logId = uuidv4();
    const adminUser = db.exec(`SELECT username FROM users WHERE id = '${adminId}'`);
    const adminName = adminUser[0]?.values[0][0] || 'Admin';
    db.run(`INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, 'password_reset', `Пароль сброшен администратором ${adminName}`, userId, null, 'success']);
    saveDatabase();

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сброса пароля:', err);
    res.status(500).json({ error: 'Ошибка при сбросе пароля' });
  }
});

// API для получения активных сессий
app.get('/api/admin/sessions', (req, res) => {
  const { userId } = req.query;

  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    const sessions = db.exec(`
      SELECT s.id, s.user_id, s.ip_address, s.browser, s.login_time, s.last_activity,
             u.username, u.avatar
      FROM user_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.last_activity DESC
    `);

    const sessionsList = sessions[0]?.values.map(row => ({
      id: row[0],
      user_id: row[1],
      ip: row[2],
      browser: row[3],
      loginTime: row[4],
      lastActivity: row[5],
      username: row[6],
      avatar: row[7]
    })) || [];

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
    db.run('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
    saveDatabase();

    // Логируем событие
    const logId = uuidv4();
    db.run(`INSERT INTO security_logs (id, event_type, event, status) VALUES (?, ?, ?, ?)`,
      [logId, 'session_terminated', 'Сессия завершена администратором', 'success']);
    saveDatabase();

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
    const messages = db.exec(`
      SELECT id, file_data, timestamp
      FROM messages
      WHERE file_data IS NOT NULL
      ORDER BY timestamp DESC
    `);

    const filesList = messages[0]?.values.map(row => {
      const fileData = JSON.parse(row[1]);
      return {
        id: row[0],
        name: fileData.name || 'Без имени',
        url: fileData.url || '',
        size: fileData.size || 0,
        mime_type: fileData.mimetype || '',
        created_at: row[2]
      };
    }) || [];

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
    const fileData = db.exec(`SELECT file_data FROM messages WHERE id = '${fileId}'`);
    const fileUrl = fileData[0]?.values[0][0];
    
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
    saveDatabase();

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
    const logs = db.exec(`
      SELECT id, event_type, event, user_id, username, ip_address, status, timestamp
      FROM security_logs
      ORDER BY timestamp DESC
      LIMIT 100
    `);

    const logsList = logs[0]?.values.map(row => ({
      id: row[0],
      event_type: row[1],
      event: row[2],
      user_id: row[3],
      username: row[4],
      ip_address: row[5],
      status: row[6],
      timestamp: row[7]
    })) || [];

    res.json({ logs: logsList });
  } catch (err) {
    console.error('Ошибка получения логов:', err);
    res.status(500).json({ error: 'Ошибка при получении логов' });
  }
});

// API для получения настроек интерфейса
app.get('/api/admin/ui-settings', (req, res) => {
  try {
    const settings = db.exec('SELECT key, value FROM ui_settings');
    const settingsObj = {};
    settings[0]?.values.forEach(row => {
      settingsObj[row[0]] = row[1];
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
    saveDatabase();

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
    res.status(500).json({ error: 'Ошибка при сохранении настроек' });
  }
});

// API для регистрации
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  // Проверка существующего пользователя
  const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR LOWER(email) = ?');
  existingUser.bind([username, emailLower]);
  if (existingUser.step()) {
    existingUser.free();
    return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
  }
  existingUser.free();

  // Хеширование пароля
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = uuidv4();
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

  try {
    db.run(`
      INSERT INTO users (id, username, email, password_hash, avatar, status)
      VALUES (?, ?, ?, ?, ?, 'offline')
    `, [userId, username, emailLower, passwordHash, avatar]);
    saveDatabase();

    res.json({
      success: true,
      user: {
        id: userId,
        username,
        email: emailLower,
        avatar
      }
    });
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Ошибка при регистрации' });
  }
});

// API для входа
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  const userStmt = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?');
  userStmt.bind([emailLower]);
  if (!userStmt.step()) {
    userStmt.free();
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const user = userStmt.getAsObject();
  userStmt.free();
  
  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar
    }
  });
});

// API для получения профиля пользователя
app.get('/api/profile/:userId', (req, res) => {
  const userStmt = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text FROM users WHERE id = ?');
  userStmt.bind([req.params.userId]);
  if (!userStmt.step()) {
    userStmt.free();
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  const user = userStmt.getAsObject();
  userStmt.free();

  // Декодируем статус из JSON (если это JSON)
  let decodedStatusText = '';
  if (user.status_text) {
    try {
      // Проверяем, начинается ли строка с { или [
      const trimmed = user.status_text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        decodedStatusText = JSON.parse(user.status_text);
      } else {
        decodedStatusText = user.status_text;
      }
    } catch (e) {
      // Если парсинг не удался, используем как есть
      decodedStatusText = user.status_text || '';
    }
  }

  res.json({ 
    user: {
      ...user,
      status_text: decodedStatusText
    }
  });
});

// API для обновления профиля
app.put('/api/profile', (req, res) => {
  const { userId, username, fullName, birthDate, about, mobilePhone, workPhone, statusText } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Сохраняем статус как есть (SQLite поддерживает UTF-8)
  const safeStatusText = statusText === null || statusText === '' ? null : statusText;

  const safeUsername = username === undefined || username === '' ? null : username;
  const safeFullName = fullName === undefined || fullName === '' ? null : fullName;
  const safeBirthDate = birthDate === undefined || birthDate === '' ? null : birthDate;
  const safeAbout = about === undefined || about === '' ? null : about;
  const safeMobilePhone = mobilePhone === undefined || mobilePhone === '' ? null : mobilePhone;
  const safeWorkPhone = workPhone === undefined || workPhone === '' ? null : workPhone;

  // Проверка существования пользователя
  const userStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  userStmt.bind([userId]);
  if (!userStmt.step()) {
    userStmt.free();
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  const existingUser = userStmt.getAsObject();
  console.log('Существующий статус в БД:', existingUser.status_text);
  userStmt.free();

  try {
    db.run(`
      UPDATE users
      SET username = COALESCE(?, username),
          full_name = COALESCE(?, full_name),
          birth_date = COALESCE(?, birth_date),
          about = COALESCE(?, about),
          mobile_phone = COALESCE(?, mobile_phone),
          work_phone = COALESCE(?, work_phone),
          status_text = COALESCE(?, status_text)
      WHERE id = ?
    `, [safeUsername, safeFullName, safeBirthDate, safeAbout, safeMobilePhone, safeWorkPhone, safeStatusText, userId]);
    saveDatabase();

    const updatedUser = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text FROM users WHERE id = ?')
      .get(userId);

    // Статус уже в UTF-8, декодирование не нужно
    const decodedStatusText = updatedUser.status_text || '';

    // Уведомляем всех пользователей об обновлении профиля
    io.emit('user_profile_updated', {
      userId: updatedUser.id,
      username: updatedUser.username,
      full_name: updatedUser.full_name || '',
      work_phone: updatedUser.work_phone || '',
      mobile_phone: updatedUser.mobile_phone || '',
      status_text: decodedStatusText
    });

    res.json({
      success: true,
      user: {
        ...updatedUser,
        status_text: decodedStatusText
      }
    });
  } catch (err) {
    console.error('Ошибка обновления профиля:', err);
    res.status(500).json({ error: 'Ошибка при обновлении профиля' });
  }
});

// API для удаления чата
app.delete('/api/chats/:chatId', (req, res) => {
  const { chatId } = req.params;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId обязателен' });
  }

  try {
    // Удаляем непрочитанные сообщения
    db.run('DELETE FROM unread_messages WHERE chat_id = ?', [chatId]);
    
    // Удаляем сообщения чата
    db.run('DELETE FROM messages WHERE chat_id = ?', [chatId]);
    
    // Удаляем участников чата
    db.run('DELETE FROM chat_participants WHERE chat_id = ?', [chatId]);
    
    // Удаляем чат
    db.run('DELETE FROM chats WHERE id = ?', [chatId]);
    
    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления чата:', err);
    res.status(500).json({ error: 'Ошибка при удалении чата' });
  }
});

// API для загрузки аватара
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;
  
  if (!userId || !req.file) {
    return res.status(400).json({ error: 'userId и файл обязательны' });
  }
  
  const avatarUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  
  try {
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);
    saveDatabase();
    
    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// API для загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  res.json({
    filename: req.file.originalname,
    url: fileUrl,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// API для получения задач календаря
app.get('/api/calendar/tasks', (req, res) => {
  const { userId, startDate, endDate } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  let query = 'SELECT * FROM calendar_tasks WHERE user_id = ?';
  const params = [userId];

  if (startDate && endDate) {
    query += ' AND task_date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (startDate) {
    query += ' AND task_date >= ?';
    params.push(startDate);
  }

  query += ' ORDER BY task_date ASC';

  const stmt = db.prepare(query);
  stmt.bind(params);
  const tasks = [];
  while (stmt.step()) {
    tasks.push(stmt.getAsObject());
  }
  stmt.free();

  res.json({ tasks });
});

// ========================================
// API для бронирования переговорной
// ========================================

// Получить бронирования переговорной
app.get('/api/meeting-room/bookings', (req, res) => {
  const { startDate, endDate } = req.query;

  let query = 'SELECT * FROM meeting_room_bookings WHERE 1=1';
  const params = [];

  if (startDate && endDate) {
    query += ' AND meeting_date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (startDate) {
    query += ' AND meeting_date >= ?';
    params.push(startDate);
  }

  query += ' ORDER BY meeting_date ASC, start_time ASC';

  const stmt = db.prepare(query);
  stmt.bind(params);
  const bookings = [];
  while (stmt.step()) {
    bookings.push(stmt.getAsObject());
  }
  stmt.free();

  res.json({ bookings });
});

// Создать бронирование переговорной
app.post('/api/meeting-room/bookings', (req, res) => {
  const { organizerId, organizerName, title, description, meetingDate, startTime, endTime } = req.body;

  if (!organizerId || !title || !meetingDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'organizerId, title, meetingDate, startTime и endTime обязательны' });
  }

  // Проверка права на бронирование
  const userCheck = db.exec(`SELECT can_book_meeting_room, username FROM users WHERE id = '${organizerId.replace(/'/g, "''")}'`);
  if (!userCheck[0] || userCheck[0].values.length === 0) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const canBook = userCheck[0].values[0][0] === 1 || userCheck[0].values[0][1] === 'Root';
  if (!canBook) {
    return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
  }

  // Проверка пересечений по времени
  const overlapCheck = db.exec(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = '${meetingDate}'
    AND (
      (start_time < '${endTime}' AND end_time > '${startTime}')
    )
  `);
  
  if (overlapCheck[0] && overlapCheck[0].values.length > 0) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  try {
    db.run(`
      INSERT INTO meeting_room_bookings (organizer_id, organizer_name, title, description, meeting_date, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [organizerId, organizerName || 'Аноним', title, description || null, meetingDate, startTime, endTime]);
    
    saveDatabase();
    
    const lastBooking = db.exec('SELECT last_insert_rowid() as id');
    const newId = lastBooking[0].values[0][0];
    
    const newBooking = db.exec(`SELECT * FROM meeting_room_bookings WHERE id = ${newId}`);
    
    res.json({ 
      success: true, 
      booking: newBooking[0] ? {
        id: newBooking[0].values[0][0],
        title: newBooking[0].values[0][1],
        description: newBooking[0].values[0][2],
        meeting_date: newBooking[0].values[0][3],
        start_time: newBooking[0].values[0][4],
        end_time: newBooking[0].values[0][5],
        organizer_id: newBooking[0].values[0][6],
        organizer_name: newBooking[0].values[0][7]
      } : null
    });
  } catch (err) {
    console.error('Ошибка создания бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить бронирование
app.delete('/api/meeting-room/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { adminId } = req.query;

  if (!adminId || !checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Только для админов' });
  }

  try {
    db.run(`DELETE FROM meeting_room_bookings WHERE id = ?`, [id]);
    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить бронирование
app.put('/api/meeting-room/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, meetingDate, startTime, endTime } = req.body;
  const organizerId = req.body.organizerId || req.query.organizerId;

  if (!title || !meetingDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'title, meetingDate, startTime и endTime обязательны' });
  }

  // Проверка права на бронирование
  if (organizerId) {
    const userCheck = db.exec(`SELECT can_book_meeting_room, username FROM users WHERE id = '${organizerId.replace(/'/g, "''")}'`);
    if (!userCheck[0] || userCheck[0].values.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const canBook = userCheck[0].values[0][0] === 1 || userCheck[0].values[0][1] === 'Root';
    if (!canBook) {
      return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
    }
  }

  // Проверка пересечений по времени (исключая текущее бронирование)
  const overlapCheck = db.exec(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = '${meetingDate}'
    AND id != ${id}
    AND (
      (start_time < '${endTime}' AND end_time > '${startTime}')
    )
  `);
  
  if (overlapCheck[0] && overlapCheck[0].values.length > 0) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  try {
    db.run(`
      UPDATE meeting_room_bookings 
      SET title = ?, description = ?, meeting_date = ?, start_time = ?, end_time = ?
      WHERE id = ?
    `, [title, description || null, meetingDate, startTime, endTime, id]);
    
    saveDatabase();
    
    const updatedBooking = db.exec(`SELECT * FROM meeting_room_bookings WHERE id = ${id}`);
    
    res.json({ 
      success: true, 
      booking: updatedBooking[0] ? {
        id: updatedBooking[0].values[0][0],
        title: updatedBooking[0].values[0][1],
        description: updatedBooking[0].values[0][2],
        meeting_date: updatedBooking[0].values[0][3],
        start_time: updatedBooking[0].values[0][4],
        end_time: updatedBooking[0].values[0][5],
        organizer_id: updatedBooking[0].values[0][6],
        organizer_name: updatedBooking[0].values[0][7]
      } : null
    });
  } catch (err) {
    console.error('Ошибка обновления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для создания задачи
app.post('/api/calendar/tasks', (req, res) => {
  const { userId, title, description, taskDate, taskTime, color } = req.body;

  if (!userId || !title || !taskDate) {
    return res.status(400).json({ error: 'userId, title и taskDate обязательны' });
  }

  const taskId = uuidv4();

  try {
    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [taskId, userId, title, description || null, taskDate, taskTime || null, color || '#667eea']);
    saveDatabase();

    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    
    // Уведомляем все подключенные клиенты о создании задачи
    io.emit('task_created', { task, userId });
    
    res.json({ success: true, task });
  } catch (err) {
    console.error('Ошибка создания задачи:', err);
    res.status(500).json({ error: 'Ошибка при создании задачи' });
  }
});

// API для обновления задачи
app.put('/api/calendar/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { title, description, taskDate, taskTime, color } = req.body;

  if (!title || !taskDate) {
    return res.status(400).json({ error: 'title и taskDate обязательны' });
  }

  try {
    db.run(`
      UPDATE calendar_tasks
      SET title = ?, description = ?, task_date = ?, task_time = ?, color = ?
      WHERE id = ?
    `, [title, description || null, taskDate, taskTime || null, color || '#667eea', taskId]);
    saveDatabase();

    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    
    // Уведомляем все подключенные клиенты об обновлении задачи
    io.emit('task_updated', { task, taskId });
    
    res.json({ success: true, task });
  } catch (err) {
    console.error('Ошибка обновления задачи:', err);
    res.status(500).json({ error: 'Ошибка при обновлении задачи' });
  }
});

// API для удаления задачи
app.delete('/api/calendar/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;

  try {
    // Сначала получаем задачу для уведомления
    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    // Удаляем связанные записи
    db.run('DELETE FROM task_shares WHERE task_id = ?', [taskId]);
    // Удаляем задачу
    db.run('DELETE FROM calendar_tasks WHERE id = ?', [taskId]);
    saveDatabase();
    
    // Уведомляем все подключенные клиенты об удалении задачи
    io.emit('task_deleted', { taskId, userId: task.user_id });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления задачи:', err);
    res.status(500).json({ error: 'Ошибка при удалении задачи' });
  }
});

// API для получения списка пользователей
app.get('/api/users', (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, username, avatar FROM users');
    const users = [];
    stmt.bind([]);
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    stmt.free();
    res.json({ users });
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

// API для отправки задачи другому пользователю
app.post('/api/calendar/tasks/:taskId/share', (req, res) => {
  const { taskId } = req.params;
  const { fromUserId, toUserIds } = req.body;

  if (!taskId || !fromUserId || !toUserIds || !Array.isArray(toUserIds)) {
    return res.status(400).json({ error: 'taskId, fromUserId и toUserIds обязательны' });
  }

  try {
    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    const shareIds = [];
    toUserIds.forEach(toUserId => {
      const shareId = uuidv4();
      db.run(`
        INSERT INTO task_shares (id, task_id, from_user_id, to_user_id, status)
        VALUES (?, ?, ?, ?, 'pending')
      `, [shareId, taskId, fromUserId, toUserId]);
      shareIds.push(shareId);
    });
    saveDatabase();

    res.json({ success: true, shareIds });
  } catch (err) {
    console.error('Ошибка отправки задачи:', err);
    res.status(500).json({ error: 'Ошибка при отправке задачи' });
  }
});

// API для получения полученных задач
app.get('/api/calendar/tasks/shared/received', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  try {
    const stmt = db.prepare(`
      SELECT ts.*, ct.title, ct.description, ct.task_date, ct.task_time, ct.color,
             u.username as from_username, u.avatar as from_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.from_user_id = u.id
      WHERE ts.to_user_id = ?
      ORDER BY ts.created_at DESC
    `);
    stmt.bind([userId]);

    const shares = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      shares.push({
        id: row.id,
        task_id: row.task_id,
        from_user_id: row.from_user_id,
        from_username: row.from_username,
        from_avatar: row.from_avatar,
        to_user_id: row.to_user_id,
        status: row.status,
        created_at: row.created_at,
        task: {
          id: row.task_id,
          title: row.title,
          description: row.description,
          task_date: row.task_date,
          task_time: row.task_time,
          color: row.color
        }
      });
    }
    stmt.free();

    res.json({ shares });
  } catch (err) {
    console.error('Ошибка получения задач:', err);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});

// API для получения отправленных задач
app.get('/api/calendar/tasks/shared/sent', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  try {
    const stmt = db.prepare(`
      SELECT ts.*, ct.title, ct.task_date,
             u.username as to_username, u.avatar as to_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.to_user_id = u.id
      WHERE ts.from_user_id = ?
      ORDER BY ts.created_at DESC
    `);
    stmt.bind([userId]);

    const shares = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      shares.push({
        id: row.id,
        task_id: row.task_id,
        to_user_id: row.to_user_id,
        to_username: row.to_username,
        to_avatar: row.to_avatar,
        status: row.status,
        created_at: row.created_at,
        task: {
          id: row.task_id,
          title: row.title,
          task_date: row.task_date
        }
      });
    }
    stmt.free();

    res.json({ shares });
  } catch (err) {
    console.error('Ошибка получения задач:', err);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});

// API для принятия задачи
app.post('/api/calendar/tasks/shared/:shareId/accept', (req, res) => {
  const { shareId } = req.params;
  const { userId } = req.body;

  console.log('Принятие задачи:', { shareId, userId });

  if (!shareId || !userId) {
    console.log('Ошибка: нет shareId или userId');
    return res.status(400).json({ error: 'shareId и userId обязательны' });
  }

  try {
    // Используем прямой запрос вместо prepared statement
    const shareStmt = db.prepare('SELECT * FROM task_shares WHERE id = ?');
    shareStmt.bind([shareId]);
    
    if (!shareStmt.step()) {
      console.log('Запись не найдена в БД:', shareId);
      shareStmt.free();
      return res.status(404).json({ error: 'Запись не найдена' });
    }
    
    const share = shareStmt.getAsObject();
    shareStmt.free();
    
    console.log('Найдена запись:', share);

    if (share.to_user_id !== userId) {
      console.log('Нет доступа:', { to: share.to_user_id, user: userId });
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const originalTaskStmt = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?');
    originalTaskStmt.bind([share.task_id]);
    
    if (!originalTaskStmt.step()) {
      console.log('Задача не найдена в БД:', share.task_id);
      originalTaskStmt.free();
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const originalTask = originalTaskStmt.getAsObject();
    originalTaskStmt.free();
    
    console.log('Найдена задача:', originalTask);

    console.log('Создаю копию задачи для пользователя:', userId);
    
    const newTaskId = uuidv4();
    const values = [
      newTaskId, 
      userId, 
      originalTask.title || 'Без названия',
      originalTask.description !== undefined && originalTask.description !== null ? originalTask.description : null,
      originalTask.task_date || new Date().toISOString().split('T')[0],
      originalTask.task_time !== undefined && originalTask.task_time !== null ? originalTask.task_time : null, 
      originalTask.color !== undefined && originalTask.color !== null ? originalTask.color : '#667eea'
    ];
    console.log('Values для вставки:', values);
    
    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, values);
    saveDatabase();

    console.log('Обновляю статус шаринга:', shareId);
    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['accepted', shareId]);
    saveDatabase();

    console.log('Задача принята успешно');
    res.json({ success: true, taskId: newTaskId });
  } catch (err) {
    console.error('Ошибка принятия задачи:', err);
    res.status(500).json({ error: 'Ошибка при принятии задачи' });
  }
});

// API для отклонения задачи
app.post('/api/calendar/tasks/shared/:shareId/decline', (req, res) => {
  const { shareId } = req.params;
  const { userId } = req.body;

  if (!shareId || !userId) {
    return res.status(400).json({ error: 'shareId и userId обязательны' });
  }

  try {
    const share = db.prepare('SELECT * FROM task_shares WHERE id = ?').get(shareId);
    if (!share) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (share.to_user_id !== userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['declined', shareId]);
    saveDatabase();

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отклонения задачи:', err);
    res.status(500).json({ error: 'Ошибка при отклонении задачи' });
  }
});

// API для обновления задачи
app.put('/api/calendar/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { title, description, taskDate, taskTime, color } = req.body;

  if (!title || !taskDate) {
    return res.status(400).json({ error: 'title и taskDate обязательны' });
  }

  try {
    db.run(`
      UPDATE calendar_tasks
      SET title = ?, description = ?, task_date = ?, task_time = ?, color = ?
      WHERE id = ?
    `, [title, description || null, taskDate, taskTime || null, color || '#667eea', taskId]);
    saveDatabase();

    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    res.json({ success: true, task });
  } catch (err) {
    console.error('Ошибка обновления задачи:', err);
    res.status(500).json({ error: 'Ошибка при обновлении задачи' });
  }
});

// API для получения сообщений чата
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.query;

  console.log('📩 Запрос сообщений для чата:', chatId, 'user:', userId);

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  db.all(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.timestamp ASC
  `, [chatId], (err, rows) => {
    if (err) {
      console.error('Ошибка загрузки сообщений:', err);
      return res.status(500).json({ error: 'Ошибка при загрузке сообщений' });
    }
    
    const messages = (rows || []).map(row => {
      let file = null;
      if (row.file_data) {
        try {
          file = JSON.parse(row.file_data);
        } catch (e) {
          file = null;
        }
      }
      
      return {
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        text: row.text,
        file: file,
        timestamp: row.timestamp,
        senderName: row.senderName,
        senderAvatar: row.senderAvatar
      };
    });

    console.log(`✅ Найдено ${messages.length} сообщений для чата ${chatId}`);
    res.json({ messages });
  });
});

// API для пересылки сообщения
app.post('/api/messages/:messageId/forward', (req, res) => {
  const { messageId } = req.params;
  const { targetChatId, userId } = req.body;

  if (!messageId || !targetChatId || !userId) {
    return res.status(400).json({ error: 'messageId, targetChatId и userId обязательны' });
  }

  try {
    // Получаем оригинальное сообщение
    const originalMsgStmt = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `);
    originalMsgStmt.bind([messageId]);
    
    if (!originalMsgStmt.step()) {
      originalMsgStmt.free();
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    
    const originalMsg = originalMsgStmt.getAsObject();
    originalMsgStmt.free();

    // Создаём новое сообщение с пометкой о пересылке
    const newMessageId = uuidv4();
    const forwardedContent = {
      original: {
        text: originalMsg.text,
        file: originalMsg.file_data ? JSON.parse(originalMsg.file_data) : null,
        senderName: originalMsg.senderName,
        senderAvatar: originalMsg.senderAvatar,
        timestamp: originalMsg.timestamp
      }
    };

    db.run(`
      INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `, [
      newMessageId,
      targetChatId,
      userId,
      originalMsg.text || null,
      originalMsg.file_data,
      JSON.stringify({
        sender_id: originalMsg.sender_id,
        sender_name: originalMsg.senderName,
        message_id: originalMsg.id
      })
    ]);
    saveDatabase();

    const newMessage = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(newMessageId);

    res.json({
      success: true,
      message: {
        id: newMessage.id,
        chatId: newMessage.chat_id,
        senderId: newMessage.sender_id,
        senderName: newMessage.senderName,
        senderAvatar: newMessage.senderAvatar,
        text: newMessage.text || '',
        file: newMessage.file_data ? JSON.parse(newMessage.file_data) : null,
        timestamp: newMessage.timestamp,
        forwarded_from: JSON.parse(newMessage.forwarded_from)
      }
    });
  } catch (err) {
    console.error('Ошибка пересылки сообщения:', err);
    res.status(500).json({ error: 'Ошибка при пересылке сообщения' });
  }
});

// Получение IP адреса клиента
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         'unknown';
}

// Получение host из заголовков
function getClientHost(req) {
  return req.headers['host'] || 'unknown';
}

// Генерация уникального ID для пользователя на основе IP и User-Agent
function generateUserId(ip, userAgent) {
  const hash = bcrypt.hashSync(`${ip}-${userAgent}-${Date.now()}`, 10);
  return hash.substring(0, 20).replace(/[^a-zA-Z0-9]/g, 'x');
}

// Вспомогательные функции для работы с БД

function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, email, avatar, status, status_text FROM users WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      id: String(row['id'] || ''),
      username: String(row['username'] || ''),
      email: String(row['email'] || ''),
      avatar: String(row['avatar'] || ''),
      status: String(row['status'] || 'offline'),
      status_text: row['status_text'] || ''
    };
  }
  stmt.free();
  return null;
}

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  stmt.bind([username]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getChatById(chatId) {
  const stmt = db.prepare('SELECT * FROM chats WHERE id = ?');
  stmt.bind([chatId]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Получение чата между двумя пользователями
function getDirectChatBetweenUsers(userId1, userId2) {
  const stmt = db.prepare(`
    SELECT c.id, c.type FROM chats c
    JOIN chat_participants cp1 ON c.id = cp1.chat_id
    JOIN chat_participants cp2 ON c.id = cp2.chat_id
    WHERE c.type = 'direct'
      AND cp1.user_id = ? AND cp2.user_id = ?
  `);
  stmt.bind([userId1, userId2]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return { 
      id: String(row.id || ''), 
      type: String(row.type || 'direct') 
    };
  }
  stmt.free();
  return null;
}

function getChatWithDetails(chatId, userId = null) {
  const chat = getChatById(chatId);
  if (!chat) return null;

  // Получаем участников с полными данными
  const participantsStmt = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.status, u.status_text
    FROM users u
    JOIN chat_participants cp ON u.id = cp.user_id
    WHERE cp.chat_id = ?
  `);
  participantsStmt.bind([chatId]);
  const participants = [];
  while (participantsStmt.step()) {
    const row = participantsStmt.getAsObject();
    participants.push({
      id: String(row['id'] || ''),
      username: String(row['username'] || ''),
      avatar: String(row['avatar'] || ''),
      status: String(row['status'] || 'offline'),
      status_text: row['status_text'] || ''
    });
  }
  participantsStmt.free();

  // Получаем непрочитанные
  let unreadCount = 0;
  if (userId) {
    const unreadStmt = db.prepare(`
      SELECT COUNT(*) as count FROM unread_messages WHERE user_id = ? AND chat_id = ?
    `);
    unreadStmt.bind([userId, chatId]);
    if (unreadStmt.step()) {
      const row = unreadStmt.getAsObject();
      unreadCount = Number(row['count'] || 0);
    }
    unreadStmt.free();
  }

  // Получаем последнее сообщение с аватаром
  const lastMsgStmt = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.timestamp DESC
    LIMIT 1
  `);
  lastMsgStmt.bind([chatId]);
  let lastMessage = null;
  if (lastMsgStmt.step()) {
    const msg = lastMsgStmt.getAsObject();
    lastMessage = {
      text: String(msg['text'] || (msg['file_data'] ? '📎 Файл' : '')),
      timestamp: String(msg['timestamp'] || ''),
      senderName: String(msg['senderName'] || ''),
      senderAvatar: String(msg['senderAvatar'] || '')
    };
  }
  lastMsgStmt.free();

  return {
    id: String(chat.id || ''),
    type: String(chat.type || ''),
    name: String(chat.name || ''),
    participants: participants.map(p => p.username),
    participantsDetails: participants,
    unreadCount,
    lastMessage
  };
}

function getUserChats(userId) {
  const chatsStmt = db.prepare(`
    SELECT c.*, 
           (SELECT COUNT(*) FROM unread_messages WHERE chat_id = c.id AND user_id = ?) as unreadCount
    FROM chats c
    JOIN chat_participants cp ON c.id = cp.chat_id
    WHERE cp.user_id = ?
    ORDER BY c.created_at DESC
  `);
  chatsStmt.bind([userId, userId]);
  const chats = [];
  while (chatsStmt.step()) {
    chats.push(chatsStmt.getAsObject());
  }
  chatsStmt.free();
  
  return chats.map(chat => {
    // Получаем участников с полными данными
    const participantsStmt = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.status, u.status_text, u.full_name, u.birth_date
      FROM users u
      JOIN chat_participants cp ON u.id = cp.user_id
      WHERE cp.chat_id = ?
    `);
    participantsStmt.bind([chat.id]);
    const participants = [];
    while (participantsStmt.step()) {
      participants.push(participantsStmt.getAsObject());
    }
    participantsStmt.free();

    // Получаем последнее сообщение с аватаром отправителя
    const lastMsgStmt = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.timestamp DESC
      LIMIT 1
    `);
    lastMsgStmt.bind([chat.id]);
    let lastMessage = null;
    if (lastMsgStmt.step()) {
      const msg = lastMsgStmt.getAsObject();
      lastMessage = {
        text: msg.text || (msg.file_data ? '📎 Файл' : ''),
        timestamp: msg.timestamp,
        senderName: msg.senderName,
        senderAvatar: msg.senderAvatar
      };
    }
    lastMsgStmt.free();

    return {
      ...chat,
      participants: participants.map(p => p.username),
      participantsDetails: participants,
      lastMessage
    };
  });
}

function getChatMessages(chatId, limit = 100) {
  const stmt = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.timestamp ASC
    LIMIT ?
  `);
  stmt.bind([chatId, limit]);
  const messages = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    messages.push({
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName: row.senderName,
      senderAvatar: row.senderAvatar,
      text: row.text || '',
      file: row.file_data ? JSON.parse(row.file_data) : null,
      timestamp: row.timestamp,
      read_at: row.read_at,
      forwarded_from: row.forwarded_from ? JSON.parse(row.forwarded_from) : null,
      readBy: []
    });
  }
  stmt.free();
  return messages;
}

function getAllUsers() {
  const stmt = db.prepare('SELECT id, username, avatar, status, full_name, birth_date, work_phone, mobile_phone, status_text FROM users');
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  return users;
}

// Socket.IO подключение
io.on('connection', (socket) => {
  const clientIp = getClientIp(socket.handshake);
  const clientHost = getClientHost(socket.handshake);
  const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
  
  console.log(`Подключение: ${socket.id} с IP: ${clientIp}`);

  // Пользователь присоединяется
  socket.on('join', (data) => {
    const { username, userId: existingUserId } = data;
    
    let user = null;
    
    // Проверяем, есть ли существующий пользователь с таким ID
    if (existingUserId) {
      user = getUserById(existingUserId);
      if (user) {
        // Обновляем статус и last_seen
        db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['online', existingUserId]);
        saveDatabase();
        console.log(`Пользователь ${user.username} вошел повторно`);
      }
    }
    
    // Если пользователь не найден, ищем по username
    if (!user) {
      user = getUserByUsername(username);
    }
    
    // Создаем нового пользователя если не найден
    if (!user) {
      const newUserId = existingUserId || generateUserId(clientIp, userAgent);
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
      
      try {
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, username, avatar, clientHost, clientIp]);
        saveDatabase();
        user = getUserById(newUserId);
        console.log(`Создан новый пользователь: ${username} (${newUserId})`);
      } catch (err) {
        // Если username уже существует, генерируем уникальный
        const uniqueUsername = `${username}_${Math.floor(Math.random() * 1000)}`;
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, uniqueUsername, avatar, clientHost, clientIp]);
        saveDatabase();
        user = getUserById(newUserId);
        console.log(`Создан новый пользователь с уникальным именем: ${uniqueUsername}`);
      }
    }
    
    // Добавляем пользователя в онлайн
    onlineUsers.set(socket.id, { 
      id: user.id, 
      username: user.username, 
      socketId: socket.id 
    });
    
    // Добавляем пользователя в общий чат если еще не там
    const inGeneralChatStmt = db.prepare(`
      SELECT * FROM chat_participants WHERE chat_id = 'general' AND user_id = ?
    `);
    inGeneralChatStmt.bind([user.id]);
    const inGeneralChat = inGeneralChatStmt.step();
    inGeneralChatStmt.free();

    if (!inGeneralChat) {
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', ['general', user.id]);
      saveDatabase();
    }
    
    // Автоматически присоединяем к комнате общего чата
    socket.join('general');
    
    // Получаем список чатов пользователя
    const userChats = getUserChats(user.id);
    
    // Отправляем пользователю его данные
    socket.emit('user_joined_success', {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        userId: user.id
      },
      chats: userChats
    });
    
    // Уведомляем остальных о новом пользователе
    socket.broadcast.emit('user_status_changed', {
      userId: user.id,
      username: user.username,
      status: 'online'
    });
    
    console.log(`${user.username} присоединился`);
  });

  // Создание нового чата
  socket.on('create_chat', (data) => {
    const { type, name, participants } = data;
    const onlineUser = onlineUsers.get(socket.id);
    
    if (!onlineUser) return;
    
    let chat = null;
    
    if (type === 'direct') {
      const targetUser = getUserByUsername(participants[0]);
      if (!targetUser) return;
      
      // Проверяем, существует ли уже чат
      const existingStmt = db.prepare(`
        SELECT c.* FROM chats c
        JOIN chat_participants cp1 ON c.id = cp1.chat_id
        JOIN chat_participants cp2 ON c.id = cp2.chat_id
        WHERE c.type = 'direct'
        AND cp1.user_id = ? AND cp2.user_id = ?
      `);
      existingStmt.bind([onlineUser.id, targetUser.id]);
      if (existingStmt.step()) {
        const row = existingStmt.getAsObject();
        chat = row;
      }
      existingStmt.free();
      
      if (!chat) {
        const chatId = uuidv4();
        db.run(`
          INSERT INTO chats (id, type, name, created_by)
          VALUES (?, 'direct', ?, ?)
        `, [chatId, targetUser.username, onlineUser.id]);
        
        db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);
        db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, targetUser.id]);
        saveDatabase();
        
        chat = getChatById(chatId);
      }
    } else if (type === 'group') {
      const chatId = uuidv4();
      db.run(`
        INSERT INTO chats (id, type, name, created_by)
        VALUES (?, 'group', ?, ?)
      `, [chatId, name || 'Групповой чат', onlineUser.id]);
      
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);
      
      participants.forEach(pUsername => {
        const pUser = getUserByUsername(pUsername);
        if (pUser) {
          db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, pUser.id]);
        }
      });
      saveDatabase();
      
      chat = getChatById(chatId);
    }
    
    // Отправляем информацию о чате всем участникам
    const chatWithParticipants = getChatWithDetails(chat.id);
    
    console.log('Чат создан:', chat.id, 'участники:', chatWithParticipants.participants);

    chatWithParticipants.participants.forEach(p => {
      const pSocket = Array.from(onlineUsers.values()).find(u => u.username === p.username);
      if (pSocket) {
        console.log('Отправляем chat_created пользователю:', p.username);
        io.to(pSocket.socketId).emit('chat_created', { chat: chatWithParticipants });
      }
    });
    
    // Также отправляем создателю напрямую (если он онлайн)
    const creatorSocket = onlineUsers.get(socket.id);
    if (creatorSocket) {
      socket.emit('chat_created', { chat: chatWithParticipants });
    }
  });

  // Присоединение к чату
  socket.on('join_chat', (chatId) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    
    socket.join(chatId);
    
    // Проверяем, является ли пользователь участником
    const isParticipantStmt = db.prepare(`
      SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?
    `);
    isParticipantStmt.bind([chatId, onlineUser.id]);
    const isParticipant = isParticipantStmt.step();
    isParticipantStmt.free();
    
    if (!isParticipant) {
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);
      saveDatabase();
    }
    
    // Очищаем непрочитанные
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    saveDatabase();
    
    // Отправляем историю сообщений
    const chatMessages = getChatMessages(chatId);
    const chat = getChatWithDetails(chatId);
    
    socket.emit('chat_history', {
      chatId,
      messages: chatMessages,
      chat
    });
  });

  // Отправка сообщения
  socket.on('send_message', (data) => {
    const { chatId, text, file, forwardedFrom } = data;
    const onlineUser = onlineUsers.get(socket.id);

    console.log('=== send_message ===', {
      chatId,
      text,
      file: !!file,
      forwardedFrom,
      onlineUser: onlineUser ? onlineUser.username : null,
      socketId: socket.id
    });

    if (!onlineUser) {
      console.error('Отмена: нет пользователя (onlineUser не найден)');
      return;
    }

    if (!chatId) {
      console.error('Отмена: нет chatId в данных');
      return;
    }

    // Проверка: chatId должен быть непустой строкой
    if (typeof chatId !== 'string' || chatId.trim() === '') {
      console.error('Отмена: chatId пустой или не строка');
      return;
    }

    const chat = getChatById(chatId);
    if (!chat) {
      console.error('Отмена: чат не найден', chatId);
      return;
    }

    console.log('✓ Отправка сообщения в чат:', chatId, 'от:', onlineUser.username, 'текст:', text || '(файл)');

    const messageId = uuidv4();
    const fileDataStr = file ? JSON.stringify(file) : null;
    const forwardedFromStr = forwardedFrom ? JSON.stringify(forwardedFrom) : null;
    const timestamp = new Date().toISOString(); // Используем локальное время клиента

    try {
      // Вставляем сообщение с временем клиента
      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from)
        VALUES ('${messageId}', '${chatId}', '${onlineUser.id}', '${(text || '').replace(/'/g, "''")}', ${fileDataStr ? `'${fileDataStr}'` : 'NULL'}, ?, ${forwardedFromStr ? `'${forwardedFromStr}'` : 'NULL'})
      `, [timestamp]);
      
      console.log('✓ Сообщение вставлено в БД, messageId:', messageId);

      // Получаем информацию о сообщении
      const msgStmt = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.timestamp, m.forwarded_from,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `);
      msgStmt.bind([messageId]);
      let messageRow = null;
      if (msgStmt.step()) {
        const row = msgStmt.getAsObject();
        console.log('Raw row from DB:', JSON.stringify(row, null, 2));
        messageRow = {
          id: String(row['id'] || ''),
          chat_id: String(row['chat_id'] || ''),
          sender_id: String(row['sender_id'] || ''),
          text: String(row['text'] || ''),
          file_data: String(row['file_data'] || ''),
          timestamp: String(row['timestamp'] || ''),
          forwarded_from: row['forwarded_from'],
          senderName: String(row['senderName'] || row['username'] || ''),
          senderAvatar: String(row['senderAvatar'] || row['avatar'] || '')
        };
        console.log('Processed messageRow:', JSON.stringify(messageRow, null, 2));
      }
      msgStmt.free();

      if (!messageRow) {
        console.error('Не удалось получить сообщение после вставки');
        return;
      }

      console.log('✓ Сообщение получено из БД:', messageRow);

      // Получаем участников чата
      const partStmt = db.prepare(`SELECT user_id FROM chat_participants WHERE chat_id = ?`);
      partStmt.bind([chatId]);
      const participants = [];
      while (partStmt.step()) {
        const row = partStmt.getAsObject();
        participants.push(String(row['user_id'] || ''));
      }
      partStmt.free();

      console.log('Участники чата:', participants);

      // Добавляем непрочитанные для всех кроме отправителя
      participants.forEach(pUserId => {
        if (pUserId !== onlineUser.id) {
          const unreadStmt = db.prepare(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`);
          unreadStmt.run(pUserId, messageId, chatId);
          unreadStmt.free();
        }
      });
      
      console.log('Сохранение БД...');
      saveDatabase();
      console.log('✓ БД сохранена');

      // Форматируем сообщение
      const formattedMessage = {
        id: messageRow.id,
        chatId: messageRow.chatId || messageRow.chat_id,
        senderId: messageRow.sender_id,
        senderName: messageRow.senderName,
        senderAvatar: messageRow.senderAvatar,
        text: messageRow.text || '',
        file: messageRow.file_data ? JSON.parse(messageRow.file_data) : null,
        timestamp: messageRow.timestamp,
        read_at: messageRow.read_at,
        forwarded_from: messageRow.forwarded_from ? JSON.parse(messageRow.forwarded_from) : null,
        readBy: [onlineUser.username]
      };

      console.log('Отправляем сообщение всем в чате...', JSON.stringify(formattedMessage, null, 2));

    // Отправляем сообщение всем в чате (включая отправителя)
    io.to(chatId).emit('new_message', {
      message: formattedMessage,
      chat: { ...chat, unreadCount: 0 }
    });

    console.log('✓ Сообщение отправлено');
  } catch (err) {
    console.error('=== ОШИБКА ПРИ ОТПРАВКЕ СООБЩЕНИЯ ===', err);
    console.error('Stack:', err.stack);
  }
  });

  // Пересылка сообщения
  socket.on('forward_message', (data) => {
    const { messageId, targetUserId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    console.log('=== ПЕРЕСЫЛКА СООБЩЕНИЯ ===', {
      messageId,
      targetUserId,
      onlineUser: onlineUser ? onlineUser.username : null,
      socketId: socket.id
    });

    if (!onlineUser || !messageId || !targetUserId) {
      console.log('Пересылка отменена: нет данных', { onlineUser: !!onlineUser, messageId, targetUserId });
      return;
    }

    // Получаем исходное сообщение
    const msgStmt = db.prepare(`
      SELECT id, chat_id, sender_id, 
             COALESCE(text, '') as text, 
             COALESCE(file_data, '') as file_data, 
             timestamp, forwarded_from
      FROM messages
      WHERE id = ?
    `);
    msgStmt.bind([messageId]);
    let originalMessage = null;
    if (msgStmt.step()) {
      const row = msgStmt.getAsObject();
      originalMessage = {
        id: String(row['id'] || ''),
        chat_id: String(row['chat_id'] || ''),
        sender_id: String(row['sender_id'] || ''),
        text: String(row['text'] || ''),
        file_data: String(row['file_data'] || '')
      };
      console.log('row:', row);
      console.log('originalMessage:', originalMessage);
    }
    msgStmt.free();

    console.log('Поиск сообщения по ID:', messageId);
    console.log('Исходное сообщение:', originalMessage ? 'найдено' : 'не найдено');

    if (!originalMessage || !originalMessage.sender_id) {
      console.error('Пересылка отменена: сообщение не найдено или sender_id пуст', messageId);
      return;
    }

    // Получаем или создаём чат между отправителем и получателем
    let chat = getDirectChatBetweenUsers(onlineUser.id, targetUserId);

    console.log('Чат:', chat ? `найден ${chat.id}` : 'не найден, создаём новый');

    if (!chat) {
      // Создаём новый чат
      const chatId = uuidv4();
      console.log('Создаю чат с ID:', chatId);
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      saveDatabase();

      chat = { id: chatId, type: 'direct' };
      console.log('Создан новый чат:', chatId);
    } else {
      console.log('Используем существующий чат:', chat.id, 'type:', chat.type);
    }

    // Проверяем что chat.id существует
    if (!chat || !chat.id) {
      console.error('Ошибка: chat или chat.id не определён!', chat);
      return;
    }

    // Проверяем originalMessage.sender_id
    console.log('Проверка originalMessage:', {
      id: originalMessage.id,
      sender_id: originalMessage.sender_id,
      text: originalMessage.text
    });

    if (!originalMessage.sender_id) {
      console.error('Ошибка: originalMessage.sender_id не определён!');
      return;
    }

    // Создаём пересланное сообщение
    const newMessageId = uuidv4();
    
    console.log('newMessageId:', newMessageId);
    
    // Получаем отправителя оригинального сообщения
    let senderUsername = 'Unknown';
    try {
      const sender = getUserById(originalMessage.sender_id);
      senderUsername = sender ? sender.username : 'Unknown';
      console.log('Отправитель оригинала:', senderUsername);
    } catch (e) {
      console.error('Ошибка получения отправителя:', e.message);
    }
    
    const forwardedFrom = {
      message_id: originalMessage.id,
      sender_id: originalMessage.sender_id,
      sender_name: senderUsername
    };

    console.log('forwardedFrom:', forwardedFrom);

    // Проверяем что chat.id не пустой
    if (!chat.id) {
      console.error('Ошибка: chat.id пустой!', chat);
      return;
    }

    console.log('Вставка сообщения...');

    // Подготавливаем значения
    const textVal = String(originalMessage.text || '').replace(/'/g, "''");
    const fileVal = String(originalMessage.file_data || '').replace(/'/g, "''");
    const fromVal = String(JSON.stringify(forwardedFrom)).replace(/'/g, "''");

    // Используем прямой SQL для надёжности
    const sql = `INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from)
      VALUES ('${newMessageId}', '${chat.id}', '${onlineUser.id}', '${textVal}', '${fileVal}', CURRENT_TIMESTAMP, '${fromVal}');`;
    
    console.log('SQL:', sql.substring(0, 200));

    try {
      db.run(sql);
      console.log('✓ Сообщение вставлено в БД');
    } catch (insertErr) {
      console.error('Ошибка вставки:', insertErr.message);
      return;
    }
    saveDatabase();

    // Добавляем непрочитанное для получателя
    db.prepare('INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)')
      .run(targetUserId, newMessageId, chat.id);
    
    console.log('✓ Добавлено в непрочитанные');
    const forwardedMessage = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.timestamp, m.forwarded_from,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(newMessageId);

      if (!forwardedMessage) return;

      const formattedMessage = {
        id: forwardedMessage.id,
        chatId: forwardedMessage.chat_id,
        senderId: forwardedMessage.sender_id,
        senderName: forwardedMessage.senderName,
        senderAvatar: forwardedMessage.senderAvatar,
        text: forwardedMessage.text || '',
        file: forwardedMessage.file_data ? JSON.parse(forwardedMessage.file_data) : null,
        timestamp: forwardedMessage.timestamp,
        forwarded_from: forwardedMessage.forwarded_from ? JSON.parse(forwardedMessage.forwarded_from) : null,
        readBy: [onlineUser.username]
      };

      // Уведомляем получателя о новом сообщении
      const targetSocket = Array.from(onlineUsers.values()).find(u => u.id === targetUserId);
      if (targetSocket) {
        // Отправляем сообщение в чат
        targetSocket.to(chat.id).emit('new_message', {
          message: formattedMessage,
          chat: { id: chat.id, type: chat.type, unreadCount: 1 }
        });

        // Отправляем обновление чата
        const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
        console.log('Отправляем chat_updated получателю:', {
          chatId: chat.id,
          chatName: chatWithUnread?.name,
          participants: chatWithUnread?.participants,
          lastMessage: chatWithUnread?.lastMessage
        });
        targetSocket.emit('chat_updated', {
          chatId: chat.id,
          chat: chatWithUnread
        });
      }

      // Отправляем подтверждение отправителю
      socket.emit('new_message', {
        message: formattedMessage,
        chat: { id: chat.id, type: chat.type, unreadCount: 0 },
        isOwnMessage: true
      });

      console.log(`Сообщение переслано от ${onlineUser.username} пользователю ${targetUserId}`);
  });

  // Получение списка пользователей
  socket.on('get_users', () => {
    const allUsers = getAllUsers();

    // Обновляем статусы онлайн
    const onlineIds = Array.from(onlineUsers.values()).map(u => u.id);
    const usersWithStatus = allUsers.map(u => ({
      ...u,
      status: onlineIds.includes(u.id) ? 'online' : 'offline'
    }));

    socket.emit('users_list', usersWithStatus);
  });

  // Статус пользователя (печатает...)
  socket.on('typing', (data) => {
    const { chatId, isTyping } = data;
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;

    socket.to(chatId).emit('user_typing', {
      chatId,
      username: onlineUser.username,
      isTyping
    });
  });

  // Отметка сообщений как прочитанные
  socket.on('mark_read', (data) => {
    const { chatId } = data;
    const onlineUser = onlineUsers.get(socket.id);
    
    if (!onlineUser || !chatId) return;

    // Удаляем непрочитанные для этого пользователя в этом чате
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    
    // Обновляем read_at для всех сообщений в чате от других пользователей
    const now = new Date().toISOString();
    db.run(`
      UPDATE messages 
      SET read_at = ? 
      WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
    `, [now, chatId, onlineUser.id]);
    
    saveDatabase();

    // Уведомляем отправителей о прочтении
    const messagesStmt = db.prepare(`
      SELECT DISTINCT sender_id FROM messages WHERE chat_id = ? AND sender_id != ?
    `);
    messagesStmt.bind([chatId, onlineUser.id]);
    const senderIds = [];
    while (messagesStmt.step()) {
      senderIds.push(messagesStmt.get()[0]);
    }
    messagesStmt.free();

    senderIds.forEach(senderId => {
      const senderSocket = Array.from(onlineUsers.values()).find(u => u.id === senderId);
      if (senderSocket) {
        io.to(senderSocket.socketId).emit('messages_read', {
          chatId,
          readBy: onlineUser.id,
          readAt: now
        });
      }
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    const onlineUser = onlineUsers.get(socket.id);
    if (onlineUser) {
      db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['offline', onlineUser.id]);
      saveDatabase();
      
      io.emit('user_status_changed', {
        userId: onlineUser.id,
        username: onlineUser.username,
        status: 'offline'
      });
      
      onlineUsers.delete(socket.id);
      console.log(`${onlineUser.username} отключился`);
    }
  });
});

// Закрытие и сохранение БД при завершении
process.on('SIGINT', () => {
  console.log('Остановка сервера...');
  
  // Сначала закрываем все socket.io соединения
  if (io) {
    io.close();
  }
  
  // Небольшая задержка перед закрытием БД
  setTimeout(() => {
    if (db) {
      saveDatabase();
      db.close();
      console.log('База данных закрыта');
    }
    process.exit();
  }, 500);
});

// Инициализация и запуск
initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`База данных: ${DB_PATH}`);
    console.log(`Путь загрузок: ${UPLOADS_PATH}`);
  });
}).catch(err => {
  console.error('Ошибка инициализации БД:', err);
  process.exit(1);
});
