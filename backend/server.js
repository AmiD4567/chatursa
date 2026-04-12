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
const HOST = process.env.CHAT_APP_HOST || config.server?.host || '0.0.0.0';
const PORT = process.env.CHAT_APP_PORT || config.server?.port || 3001;
const DATA_PATH = process.env.CHAT_APP_DATA_PATH || __dirname;
const DB_PATH = process.env.CHAT_APP_DB_PATH || path.join(__dirname, 'chat.db');
const UPLOADS_PATH = process.env.CHAT_APP_UPLOADS_PATH || config.uploads?.path || path.join(__dirname, 'uploads');

// URL сервера для доступа из локальной сети
const SERVER_URL = process.env.CHAT_APP_SERVER_URL || config.server?.url || `http://${getLocalIP()}:${PORT}`;

// Функция для получения локального IP
function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

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

  // Миграция для добавления task_end_time
  try {
    db.run('ALTER TABLE calendar_tasks ADD COLUMN task_end_time TEXT');
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

  // Миграция для добавления has_seen_welcome
  try {
    db.run('ALTER TABLE users ADD COLUMN has_seen_welcome INTEGER DEFAULT 0');
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

  // Миграция для добавления task_end_time
  try {
    db.run('ALTER TABLE calendar_tasks ADD COLUMN task_end_time TEXT');
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
      task_end_time TEXT,
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

    -- Таблица реакций на сообщения
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

  // Создание помощника если не существует
  const botCheck = db.exec("SELECT * FROM users WHERE username = 'Помощник'");
  if (botCheck.length === 0 || botCheck[0].values.length === 0) {
    const botId = 'helper-bot-' + uuidv4().substring(0, 8);
    db.run(`
      INSERT INTO users (id, username, avatar, status, is_admin)
      VALUES (?, ?, ?, 'online', 0)
    `, [botId, 'Помощник', `${SERVER_URL}/uploads/ursa.jpg`]);
    saveDatabase();
    console.log('Создан помощник');
  }

  // Миграция: очищаем пустые номера телефонов
  try {
    db.run("UPDATE users SET mobile_phone = NULL WHERE TRIM(mobile_phone) = '' OR mobile_phone = ' '");
    db.run("UPDATE users SET work_phone = NULL WHERE TRIM(work_phone) = '' OR work_phone = ' '");
    saveDatabase();
    console.log('Миграция телефонов выполнена');
  } catch (e) {
    // Игнорируем ошибки миграции
  }

  // Миграция: убираем эмодзи из имени помощника
  try {
    db.run("UPDATE chats SET name = 'Помощник' WHERE name = '🤖 Помощник'");
    saveDatabase();
    console.log('Миграция имени помощника выполнена');
  } catch (e) {
    // Игнорируем ошибки миграции
  }

  console.log('База данных инициализирована');
  return Promise.resolve();
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

  const users = db.exec('SELECT id, username, email, full_name, status, is_admin, created_at, last_seen, host, ip_address, can_book_meeting_room FROM users ORDER BY username');
  const userList = users[0]?.values.map(row => ({
    id: row[0],
    username: row[1],
    email: row[2],
    full_name: row[3],
    status: row[4],
    is_admin: row[5],
    created_at: row[6],
    last_seen: row[7],
    host: row[8] || 'unknown',
    ip_address: row[9] || 'unknown',
    can_book_meeting_room: row[10] || 0
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

// ============================================
// API для удаления сообщений администратором
// ============================================

// Удаление сообщения администратором
app.delete('/api/admin/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { adminId } = req.query;

  if (!adminId) {
    return res.status(400).json({ error: 'adminId обязателен' });
  }

  // Проверяем админа
  const isAdmin = checkAdmin(adminId);

  if (!isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  if (!messageId) {
    return res.status(400).json({ error: 'messageId обязателен' });
  }

  try {
    // Получаем информацию о сообщении для логирования
    const messageData = db.exec(`
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.timestamp,
             u.username as sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = '${messageId.replace(/'/g, "''")}'
    `);

    if (!messageData[0] || messageData[0].values.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    const row = messageData[0].values[0];
    const chatId = row[1];
    const senderId = row[2];
    const text = row[3] || '';
    const fileData = row[4];
    const senderUsername = row[6];

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
    saveDatabase();

    // Логируем событие удаления
    const logId = uuidv4();
    const adminUser = db.exec(`SELECT username FROM users WHERE id = '${adminId.replace(/'/g, "''")}'`);
    const adminName = adminUser[0]?.values[0][0] || 'Admin';
    db.run(`INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, 'message_deleted', `Сообщение от ${senderUsername} удалено администратором ${adminName}`, senderId, senderUsername, 'warning']);
    saveDatabase();

    // Уведомляем клиентов через socket о удалении сообщения
    const deletedMessage = {
      id: messageId,
      chat_id: chatId,
      sender_id: senderId,
      text: text,
      file_data: fileData,
      deleted_by: adminId,
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
app.post('/api/register', (req, res) => {
  const { username, email, password, confirmPassword, birthDate } = req.body;

  if (!username || !email || !password || !birthDate) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  // Проверка совпадения паролей
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
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
      INSERT INTO users (id, username, email, password_hash, avatar, status, birth_date)
      VALUES (?, ?, ?, ?, ?, 'offline', ?)
    `, [userId, username, emailLower, passwordHash, avatar, birthDate]);
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
  const userStmt = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text, is_admin FROM users WHERE id = ?');
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
  
  // Обработка телефонов: если не переданы - оставляем null (не меняем)
  // Если переданы пустые - сохраняем NULL в БД
  // Если переданы с значением - сохраняем значение
  const safeMobilePhone = mobilePhone === undefined ? undefined : (mobilePhone === '' ? null : mobilePhone);
  const safeWorkPhone = workPhone === undefined ? undefined : (workPhone === '' ? null : workPhone);

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
    // Получаем текущие номера из БД, если они не были переданы
    let finalMobilePhone = safeMobilePhone;
    let finalWorkPhone = safeWorkPhone;
    
    if (safeMobilePhone === undefined) {
      // Номер не передан, оставляем текущий
      const currentStmt = db.prepare('SELECT mobile_phone FROM users WHERE id = ?');
      currentStmt.bind([userId]);
      if (currentStmt.step()) {
        finalMobilePhone = currentStmt.getAsObject().mobile_phone;
      }
      currentStmt.free();
    }
    
    if (safeWorkPhone === undefined) {
      // Номер не передан, оставляем текущий
      const currentStmt = db.prepare('SELECT work_phone FROM users WHERE id = ?');
      currentStmt.bind([userId]);
      if (currentStmt.step()) {
        finalWorkPhone = currentStmt.getAsObject().work_phone;
      }
      currentStmt.free();
    }
    
    // Очищаем пустые значения
    const mobilePhoneValue = finalMobilePhone && String(finalMobilePhone).trim() !== '' ? finalMobilePhone : null;
    const workPhoneValue = finalWorkPhone && String(finalWorkPhone).trim() !== '' ? finalWorkPhone : null;

    db.run(`
      UPDATE users
      SET username = COALESCE(?, username),
          full_name = COALESCE(?, full_name),
          birth_date = COALESCE(?, birth_date),
          about = COALESCE(?, about),
          mobile_phone = ?,
          work_phone = ?,
          status_text = COALESCE(?, status_text)
      WHERE id = ?
    `, [safeUsername, safeFullName, safeBirthDate, safeAbout, mobilePhoneValue, workPhoneValue, safeStatusText, userId]);
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

    // Уведомляем всех об изменении текстового статуса (для отображения в реальном времени)
    io.emit('user_status_changed', {
      userId: updatedUser.id,
      username: updatedUser.username,
      status: 'online', // Статус подключения не изменился
      statusText: decodedStatusText // Добавляем текстовый статус
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
  
  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  
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

// API для загрузки аватара помощника (только для админов)
app.post('/api/upload-helper-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Проверяем, является ли пользователь администратором
  const userStmt = db.prepare('SELECT is_admin FROM users WHERE id = ?');
  userStmt.bind([userId]);
  let isAdmin = false;
  if (userStmt.step()) {
    const row = userStmt.getAsObject();
    isAdmin = row['is_admin'] === 1;
  }
  userStmt.free();

  if (!isAdmin) {
    return res.status(403).json({ error: 'Только администраторы могут менять аватар помощника' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Файл аватара обязателен' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    db.run('UPDATE users SET avatar = ? WHERE username = ?', [avatarUrl, 'Помощник']);
    saveDatabase();

    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара помощника:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// API для загрузки аватара общего чата (только для админов)
app.post('/api/upload-general-chat-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Проверяем, является ли пользователь администратором
  const userStmt = db.prepare('SELECT is_admin FROM users WHERE id = ?');
  userStmt.bind([userId]);
  let isAdmin = false;
  if (userStmt.step()) {
    const row = userStmt.getAsObject();
    isAdmin = row['is_admin'] === 1;
  }
  userStmt.free();

  if (!isAdmin) {
    return res.status(403).json({ error: 'Только администраторы могут менять аватар общего чата' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Файл аватара обязателен' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    db.run('ALTER TABLE chats ADD COLUMN avatar TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  try {
    db.run('UPDATE chats SET avatar = ? WHERE id = ?', [avatarUrl, 'general']);
    saveDatabase();

    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара общего чата:', err);
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
  const { userId, title, description, taskDate, taskTime, taskEndTime, color } = req.body;

  if (!userId || !title || !taskDate) {
    return res.status(400).json({ error: 'userId, title и taskDate обязательны' });
  }

  const taskId = uuidv4();

  try {
    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, task_end_time, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [taskId, userId, title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea']);
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
  const { title, description, taskDate, taskTime, taskEndTime, color } = req.body;

  if (!title || !taskDate) {
    return res.status(400).json({ error: 'title и taskDate обязательны' });
  }

  try {
    db.run(`
      UPDATE calendar_tasks
      SET title = ?, description = ?, task_date = ?, task_time = ?, task_end_time = ?, color = ?
      WHERE id = ?
    `, [title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', taskId]);
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

// ============================================
// API для бота-помощника
// ============================================

// Статистика пользователя
app.get('/api/bot/stats/:userId', (req, res) => {
  const { userId } = req.params;

  try {
    // Количество сообщений
    const messagesCount = db.exec(`SELECT COUNT(*) as count FROM messages WHERE sender_id = '${userId}'`);
    const totalMessages = messagesCount[0]?.values[0][0] || 0;

    // Количество файлов
    const filesCount = db.exec(`SELECT COUNT(*) as count FROM messages WHERE sender_id = '${userId}' AND file_data IS NOT NULL`);
    const totalFiles = filesCount[0]?.values[0][0] || 0;

    // Количество задач
    const tasksCount = db.exec(`SELECT COUNT(*) as count FROM calendar_tasks WHERE user_id = '${userId}'`);
    const totalTasks = tasksCount[0]?.values[0][0] || 0;

    // Дата регистрации
    const userDate = db.exec(`SELECT created_at FROM users WHERE id = '${userId}'`);
    const createdAt = userDate[0]?.values[0][0] || new Date().toISOString();

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
    const users = db.exec(`
      SELECT id, username, email, full_name, mobile_phone, work_phone, avatar, status
      FROM users
      WHERE username != 'Помощник'
        AND (
          (mobile_phone IS NOT NULL AND TRIM(mobile_phone) != '')
          OR
          (work_phone IS NOT NULL AND TRIM(work_phone) != '')
        )
      ORDER BY username
    `);

    const contacts = users[0]?.values.map(row => ({
      id: row[0],
      username: row[1],
      email: row[2],
      full_name: row[3],
      mobile_phone: row[4],
      work_phone: row[5],
      avatar: row[6],
      status: row[7]
    })) || [];

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
    const tasksToday = db.exec(`
      SELECT id, title, description, task_date, task_time, color
      FROM calendar_tasks
      WHERE user_id = '${userId}' AND task_date LIKE '${todayStr}%'
    `);

    const tasks = tasksToday[0]?.values.map(row => ({
      id: row[0],
      title: row[1],
      description: row[2],
      task_date: row[3],
      task_time: row[4],
      color: row[5]
    })) || [];

    // Дни рождения сегодня
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;

    const birthdays = db.exec(`
      SELECT id, username, avatar, birth_date
      FROM users
      WHERE birth_date IS NOT NULL
    `);

    const birthdaysToday = birthdays[0]?.values
      .filter(row => {
        const birthDate = new Date(row[3]);
        return birthDate.getDate() === todayDay && (birthDate.getMonth() + 1) === todayMonth;
      })
      .map(row => ({
        id: row[0],
        username: row[1],
        avatar: row[2],
        birth_date: row[3]
      })) || [];

    // Встречи сегодня
    const meetingsToday = db.exec(`
      SELECT id, title, description, meeting_date, start_time, end_time
      FROM meeting_room_bookings
      WHERE meeting_date LIKE '${todayStr}%'
    `);

    const meetings = meetingsToday[0]?.values.map(row => ({
      id: row[0],
      title: row[1],
      description: row[2],
      meeting_date: row[3],
      start_time: row[4],
      end_time: row[5]
    })) || [];

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

// Получение IP адреса клиента
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         (req.request?.connection?.remoteAddress) ||
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
           (SELECT COUNT(*) FROM unread_messages WHERE chat_id = c.id AND user_id = ?) as unreadCount,
           (SELECT MAX(timestamp) FROM messages WHERE chat_id = c.id) as last_msg_time
    FROM chats c
    JOIN chat_participants cp ON c.id = cp.chat_id
    WHERE cp.user_id = ?
    ORDER BY last_msg_time DESC, c.created_at DESC
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
  // Сначала получаем последние N сообщений в обратном порядке (новые первые)
  const stmt = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.timestamp DESC
    LIMIT ?
  `);
  stmt.bind([chatId, limit]);
  const messagesReversed = [];
  while (stmt.step()) {
    messagesReversed.push(stmt.getAsObject());
  }
  stmt.free();
  
  // Переворачиваем чтобы получить в правильном порядке (старые первые)
  const messages = [];
  for (let i = messagesReversed.length - 1; i >= 0; i--) {
    const row = messagesReversed[i];

    // Проверяем, есть ли кнопки в file_data
    let buttons = [];
    let isBotMessage = false;

    if (row.file_data) {
      try {
        const fileData = JSON.parse(row.file_data);
        // Проверяем, это кнопки бота
        if (fileData.type === 'bot_buttons' && fileData.buttons) {
          buttons = fileData.buttons;
          isBotMessage = true;
        } else {
          // Это обычный файл
          buttons = [];
        }
      } catch (e) {
        buttons = [];
      }
    }

    // Загружаем реакции для сообщения
    const reactionsStmt = db.prepare(`
      SELECT mr.emoji, mr.user_id, u.username, u.avatar
      FROM message_reactions mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.message_id = ?
    `);
    reactionsStmt.bind([row.id]);
    const reactions = {};
    while (reactionsStmt.step()) {
      const reactionRow = reactionsStmt.getAsObject();
      const emoji = reactionRow.emoji;
      if (!reactions[emoji]) {
        reactions[emoji] = [];
      }
      reactions[emoji].push({
        userId: reactionRow.user_id,
        username: reactionRow.username,
        avatar: reactionRow.avatar
      });
    }
    reactionsStmt.free();

    messages.push({
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName: row.senderName,
      senderAvatar: row.senderAvatar,
      text: row.text || '',
      file: row.file_data && !isBotMessage ? JSON.parse(row.file_data) : null,
      timestamp: row.timestamp,
      read_at: row.read_at,
      forwarded_from: row.forwarded_from ? JSON.parse(row.forwarded_from) : null,
      readBy: [],
      buttons: buttons,
      isBotMessage: isBotMessage,
      reactions: Object.keys(reactions).length > 0 ? reactions : undefined
    });
  }
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

// ============================================
// База знаний бота-помощника (УЛУЧШЕННАЯ ВЕРСИЯ 2026)
// ============================================

const botKnowledge = {
  commands: {
    '/помощь': {
      text: '🤖 *Я помогу вам разобраться с чатом!*\n\nВыберите тему или введите команду:',
      buttons: [
        { label: '📱 Создать чат', action: '/чат' },
        { label: '📅 Задача', action: '/задача' },
        { label: '📅 Сегодня', action: '/сегодня' },
        { label: '📞 Контакты', action: '/контакты' },
        { label: '🔔 Уведомления', action: '/уведомления' }
      ]
    },

    '/чат': {
      text: '📱 *Как создать чат:*\n\n1. Нажмите кнопку ✏️ в разделе "Чаты"\n2. Выберите тип чата:\n   • 🌐 Общий — доступен всем\n   • 👤 Личный — чат с одним пользователем\n   • 👥 Групповой — чат с несколькими участниками\n3. Выберите участников из списка\n4. Нажмите "Создать"\n\n💡 *Совет:* В личном чате имя автоматически подставляется из выбранного пользователя',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '📅 Задачи', action: '/задача' },
        { label: '👥 Групповой чат', action: '/групповой_чат' }
      ]
    },

    '/задача': {
      text: '📅 *Как создать задачу:*\n\n1. Откройте раздел 📅 Календарь\n2. Переключитесь на вкладку "Задачи"\n3. Нажмите "+ Добавить задачу"\n4. Заполните:\n   • Название задачи\n   • Описание (необязательно)\n   • Дату выполнения\n   • Время (необязательно)\n   • Цвет для визуального выделения\n5. Нажмите "Сохранить"\n\n💡 *Совет:* Задачи отображаются в календаре выбранным цветом',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '📅 Календарь', action: '/календарь' },
        { label: '👥 Поделиться', action: '/поделиться_задачей' }
      ]
    },

    '/календарь': {
      text: '📅 *Календарь:*\n\nКалендарь показывает задачи в виде сетки месяца.\n\n*Управление:*\n• ← → — переключение месяцев\n• Клик на день — показать задачи за этот день\n• Клик на задачу — редактировать/удалить\n• Фильтр по цвету — показать задачи определённого цвета\n\n*Виды отображения:*\n• Задачи — личные задачи\n• Переговорка — бронирование комнат',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '🏢 Переговорка', action: '/переговорка' },
        { label: '📅 Мои задачи', action: '/задача' }
      ]
    },

    '/переговорка': {
      text: '🏢 *Бронирование переговорной:*\n\n1. Откройте 📅 Календарь\n2. Переключитесь на вкладку "Переговорка"\n3. Нажмите "Забронировать"\n4. Заполните:\n   • Название встречи\n   • Описание (необязательно)\n   • Дата и время начала/окончания\n5. Нажмите "Сохранить"\n\n⚠️ *Важно:* Право на бронирование выдаётся ответственным лицом',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '📅 Календарь', action: '/календарь' },
        { label: '📋 Мои брони', action: '/мои_брони' }
      ]
    },

    '/файлы': {
      text: '📎 *Загрузка файлов:*\n\n1. В поле ввода сообщения нажмите 📎\n2. Выберите файл (до 50 МБ)\n3. Отправьте сообщение\n\n*Поддерживаемые файлы:*\n• Изображения — показываются с превью\n• Документы — PDF, DOC, XLS и др.\n• Видео и аудио\n\n💡 *Совет:* Кликните на изображение для просмотра в полном размере',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '📁 Мои файлы', action: '/мои_файлы' },
        { label: '🔍 Поиск файлов', action: '/поиск_файлов' }
      ]
    },

    '/статус': {
      text: '🟢 *Статусы:*\n\n*Как изменить:*\n1. Нажмите на свой аватар внизу слева\n2. Выберите статус:\n   • 🟢 Онлайн\n   • 🌙 Не беспокоить\n   • ⛔ Занят\n   • 🔴 Офлайн\n\n*Статус текста:*\nМожно добавить текстовый статус (например, "На обеде до 14:00")',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '👤 Профиль', action: '/профиль' }
      ]
    },

    '/профиль': {
      text: '👤 *Редактирование профиля:*\n\n1. Нажмите на свой аватар\n2. Выберите "Профиль"\n3. Можно изменить:\n   • Фото профиля\n   • ФИО\n   • Дату рождения\n   • О себе\n   • Мобильный телефон\n   • Рабочий телефон\n   • Статус\n4. Нажмите "Сохранить"',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '🟢 Статусы', action: '/статус' },
        { label: '📞 Телефоны', action: '/телефоны' }
      ]
    },

    '/уведомления': {
      text: '🔔 *Уведомления:*\n\n*Типы уведомлений:*\n• Новые сообщения — push-уведомления\n• Дни рождения — напоминания о днях рождениях коллег\n• Задачи — напоминания о предстоящих задачах\n• Общие задачи — уведомления о задачах, которыми поделились\n\n*Настройки:*\nОткройте Настройки → Уведомления для включения/отключения',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '⚙️ Настройки', action: '/настройки' }
      ]
    },

    '/поиск': {
      text: '🔍 *Поиск:*\n\n*Поиск сообщений:*\n1. Откройте чат\n2. Нажмите 🔍 вверху\n3. Введите поисковый запрос\n4. Используйте ↑ ↓ для навигации по результатам\n\n*Поиск пользователей:*\nВведите имя в поле поиска в разделе "Чаты"',
      buttons: [
        { label: '🔙 Назад', action: '/помощь' },
        { label: '📁 Поиск файлов', action: '/поиск_файлов' }
      ]
    },

    '/сегодня': {
      text: '📅 *Сегодня в календаре:*\n\nЭта команда покажет:\n• Задачи на сегодня\n• Дни рождения коллег\n• Запланированные встречи\n\n*Использование:*\nПросто введите /сегодня и бот покажет все события на текущий день.\n\n💡 *Совет:* Используйте команду каждое утро для планирования!',
      buttons: [
        { label: '📅 Календарь', action: '/календарь' },
        { label: '🔔 Уведомления', action: '/уведомления' },
        { label: '🔙 Назад', action: '/помощь' }
      ]
    },

    '/контакты': {
      text: '📞 *Телефонная книга:*\n\nБыстрый доступ к контактам коллег:\n• Мобильные телефоны\n• Рабочие телефоны\n• Email\n\n*Использование:*\nВведите /контакты для просмотра всех контактов или начните вводить имя для поиска.\n\n💡 *Совет:* Контакты синхронизируются с профилями пользователей',
      buttons: [
        { label: '👤 Профиль', action: '/профиль' },
        { label: '🔙 Назад', action: '/помощь' }
      ]
    },

    '/онбординг': {
      text: '🎯 *Добро пожаловать в корпоративный чат!*\n\nДавайте быстро освоим основные функции:',
      steps: [
        { title: '📱 Чаты', desc: 'Создавайте личные и групповые чаты с коллегами' },
        { title: '📅 Календарь', desc: 'Планируйте задачи и бронируйте переговорки' },
        { title: '📎 Файлы', desc: 'Обменивайтесь документами и изображениями' },
        { title: '🔔 Уведомления', desc: 'Получайте важные уведомления вовремя' },
        { title: '👤 Профиль', desc: 'Настройте информацию о себе' }
      ],
      buttons: [
        { label: '🚀 Начать обучение', action: '/онбординг_шаг1' },
        { label: '⏭️ Пропустить', action: '/помощь' }
      ]
    },

    '/онбординг_шаг1': {
      text: '📱 *Шаг 1: Чаты*\n\nВы можете создавать:\n• 👤 Личные чаты — для общения один на один\n• 👥 Групповые чаты — для командной работы\n• 🌐 Общий чат — доступен всем сотрудникам\n\n*Как создать:*\nНажмите ✏️ в разделе "Чаты"',
      buttons: [
        { label: '➡️ Далее: Календарь', action: '/онбординг_шаг2' },
        { label: '🔙 Назад', action: '/онбординг' }
      ]
    },

    '/онбординг_шаг2': {
      text: '📅 *Шаг 2: Календарь*\n\nПланируйте задачи и встречи:\n• Создавайте задачи с дедлайнами\n• Бронируйте переговорные комнаты\n• Отслеживайте дни рождения коллег\n\n*Совет:* Используйте цвета для приоритетов!',
      buttons: [
        { label: '➡️ Далее: Файлы', action: '/онбординг_шаг3' },
        { label: '🔙 Назад', action: '/онбординг_шаг1' }
      ]
    },

    '/онбординг_шаг3': {
      text: '📎 *Шаг 3: Файлы*\n\nЗагружайте и делитесь файлами:\n• Изображения с превью\n• Документы (PDF, DOC, XLS)\n• Видео и аудио до 50 МБ\n\n*Как:* Нажмите 📎 в поле ввода',
      buttons: [
        { label: '➡️ Далее: Профиль', action: '/онбординг_шаг4' },
        { label: '🔙 Назад', action: '/онбординг_шаг2' }
      ]
    },

    '/онбординг_шаг4': {
      text: '👤 *Шаг 4: Профиль*\n\nНастройте информацию о себе:\n• Фото профиля\n• ФИО и дата рождения\n• Контактные телефоны\n• Статус (онлайн/занят/офлайн)\n\n*Где:* Нажмите на аватар внизу',
      buttons: [
        { label: '✅ Завершить', action: '/онбординг_финиш' },
        { label: '🔙 Назад', action: '/онбординг_шаг3' }
      ]
    },

    '/онбординг_финиш': {
      text: '🎉 *Поздравляем!*\n\nВы освоили основы работы с чатом!\n\n*Что дальше:*\n• Начните с создания первого чата\n• Добавьте задачу в календарь\n• Загрузите файл\n\nЯ всегда на связи! Введите /помощь в любой момент.',
      buttons: [
        { label: '📱 Создать чат', action: '/чат' },
        { label: '📅 Добавить задачу', action: '/задача' },
        { label: '🔙 Главное меню', action: '/помощь' }
      ]
    },

    'по умолчанию': {
      text: '🤖 Привет! Я бот-помощник.\n\nЯ помогу вам разобраться с функциями чата.\n\n*Быстрые команды:*\n/помощь — все команды\n/онбординг — обучение для новых\n/чат — как создать чат\n/задача — как создать задачу',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '📱 Чаты', action: '/чат' },
        { label: '📅 Задачи', action: '/задача' },
        { label: '🔙 Главное', action: '/помощь' }
      ]
    }
  },

  // Ответы на вопросы (ключевые слова)
  responses: {
    'привет': {
      text: '👋 Здравствуйте! Я бот-помощник.\n\nЧем могу помочь сегодня?',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'здравствуй': {
      text: '👋 Здравствуйте! Я бот-помощник.\n\nЧем могу помочь сегодня?',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'как дела': {
      text: 'У меня всё отлично! Готов помочь вам с вопросами по чату.',
      buttons: [
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'кто ты': {
      text: '🤖 Я бот-помощник! Моя задача — помогать пользователям разбираться с функциями этого чата.',
      buttons: [
        { label: '📚 Что ты умеешь?', action: '/что_ты_умеешь' },
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'что ты умеешь': {
      text: 'Я умею:\n• Рассказывать о функциях чата\n• Помогать с созданием чатов и задач\n• Объяснять как загружать файлы\n• Подсказывать по настройкам\n• Проводить обучение для новых пользователей',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '❓ Все команды', action: '/помощь' }
      ]
    },
    'спасибо': {
      text: 'Пожалуйста! 😊 Обращайтесь ещё!',
      buttons: [
        { label: '⭐ Оценить помощь', action: '/оценить' }
      ]
    },
    'пока': {
      text: 'До свидания! Если будут вопросы — я всегда на связи! 👋',
      buttons: []
    },
    'до свидания': {
      text: 'До свидания! Хорошего дня! 👋',
      buttons: []
    },
    'как создать чат': {
      text: '📱 Чтобы создать чат:\n1. Нажмите ✏️ в разделе "Чаты"\n2. Выберите тип чата\n3. Выберите участников\n4. Нажмите "Создать"',
      buttons: [
        { label: '📱 Подробнее', action: '/чат' },
        { label: '👥 Групповой чат', action: '/групповой_чат' }
      ]
    },
    'как создать задачу': {
      text: '📅 Чтобы создать задачу:\n1. Откройте 📅 Календарь\n2. Вкладка "Задачи"\n3. Нажмите "+ Добавить задачу"\n4. Заполните поля и сохраните',
      buttons: [
        { label: '📅 Подробнее', action: '/задача' }
      ]
    },
    'как загрузить файл': {
      text: '📎 Чтобы загрузить файл:\n1. В поле ввода нажмите 📎\n2. Выберите файл (до 50 МБ)\n3. Отправьте сообщение',
      buttons: [
        { label: '📎 Подробнее', action: '/файлы' }
      ]
    },
    'как изменить статус': {
      text: '🟢 Чтобы изменить статус:\n1. Нажмите на свой аватар внизу\n2. Выберите нужный статус',
      buttons: [
        { label: '🟢 Подробнее', action: '/статус' }
      ]
    },
    'как забронировать': {
      text: '🏢 Чтобы забронировать переговорку:\n1. Откройте 📅 Календарь\n2. Вкладка "Переговорка"\n3. Нажмите "Забронировать"\n4. Заполните форму',
      buttons: [
        { label: '🏢 Подробнее', action: '/переговорка' }
      ]
    },
    'не работает': {
      text: '😕 Что именно не работает? Опишите проблему подробнее.\n\nЕсли проблема техническая — обратитесь в службу технической поддержки.',
      buttons: [
        { label: '🔙 Помощь', action: '/помощь' },
        { label: '📞 Поддержка', action: '/поддержка' }
      ]
    },
    'ошибка': {
      text: '😕 Какую ошибку вы видите? Опишите подробнее.\n\nДля технических проблем обратитесь в службу технической поддержки.',
      buttons: [
        { label: '📞 Поддержка', action: '/поддержка' }
      ]
    },
    'помощь': {
      text: '🤖 Введите /помощь чтобы увидеть все доступные команды!',
      buttons: [
        { label: '❓ Все команды', action: '/помощь' }
      ]
    },
    'команда': {
      text: '🤖 Все команды начинаются с /. Введите /помощь для полного списка!',
      buttons: [
        { label: '❓ Все команды', action: '/помощь' }
      ]
    },
    'бот': {
      text: '🤖 Да, я здесь! Чем могу помочь?',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'как пользоваться': {
      text: '🤖 Я помогу! Пройдите быстрое обучение или выберите тему:',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '📱 Чаты', action: '/чат' },
        { label: '📅 Задачи', action: '/задача' }
      ]
    },
    'функции': {
      text: '🤖 *Функции чата:*\n\n• 💬 Личные и групповые чаты\n• 📎 Обмен файлами\n• 📅 Календарь задач\n• 🏢 Бронирование переговорок\n• 🔔 Уведомления\n• 👤 Профили пользователей',
      buttons: [
        { label: '📚 Обучение', action: '/онбординг' },
        { label: '❓ Все команды', action: '/помощь' }
      ]
    },
    'обучение': {
      text: '🎯 Отлично! Давайте пройдём быстрое обучение.',
      buttons: [
        { label: '🚀 Начать', action: '/онбординг' },
        { label: '❓ Помощь', action: '/помощь' }
      ]
    },
    'оценить': {
      text: '⭐ *Оцените мою помощь:*\n\nНажмите на оценку:',
      buttons: [
        { label: '😞 1', action: '/оценка_1' },
        { label: '😐 2', action: '/оценка_2' },
        { label: '😐 3', action: '/оценка_3' },
        { label: '😊 4', action: '/оценка_4' },
        { label: '🤩 5', action: '/оценка_5' }
      ]
    },
    'оценка_1': 'Спасибо за оценку! Я стараюсь стать лучше. 😊',
    'оценка_2': 'Спасибо за оценку! Буду работать над ошибками. 😊',
    'оценка_3': 'Спасибо! Стараюсь быть полезным! 😊',
    'оценка_4': 'Рад, что смог помочь! 😊',
    'оценка_5': 'Спасибо за высокую оценку! 🎉',
    'мои_файлы': '📁 *Мои файлы:*\n\nВсе загруженные вами файлы сохраняются в сообщениях. Для поиска используйте 🔍 в чате.',
    'поиск_файлов': '🔍 *Поиск файлов:*\n\nВведите название файла в поиске по чату.',
    'мои_брони': '📋 *Мои брони:*\n\nВсе ваши бронирования переговорки отображаются во вкладке "Переговорка" в календаре.',
    'групповой_чат': '👥 *Групповой чат:*\n\n1. Нажмите ✏️ в "Чаты"\n2. Выберите "Групповой"\n3. Назовите чат\n4. Добавьте участников\n5. Нажмите "Создать"',
    'поделиться_задачей': '👥 *Как поделиться задачей:*\n\n1. Откройте 📅 Календарь\n2. Найдите нужную задачу в списке\n3. Нажмите на иконку "📤" рядом с задачей\n4. Выберите коллегу из списка\n5. Нажмите "Поделиться"\n\n*Что произойдёт:*\n• Задача появится у коллеги в списке "Полученные задачи"\n• Коллега сможет принять или отклонить задачу\n• После принятия задача будет в календаре коллеги\n\n💡 *Совет:* Так можно делегировать задачи коллегам',
    'телефоны': '📞 *Телефоны в профиле:*\n\n• Мобильный — для связи\n• Рабочий — офисный номер\n\nДобавьте в разделе Профиль → Телефоны',
    'настройки': '⚙️ *Настройки:*\n\nОткройте ⚙️ внизу слева для настройки:\n• Тема оформления\n• Уведомления\n• Язык\n• Приватность',
    'поддержка': '📞 *Техническая поддержка:*\n\nПо вопросам работы чата обратитесь:\n• К ответственному за чат в вашей организации\n• В IT-отдел',
    'помощь_по_чату': '📚 *Помощь по чату:*\n\nВоспользуйтесь командами:\n/помощь — все команды\n/онбординг — обучение\n/чат, /задача, /файлы — по функциям'
  },

  // Поиск по функциям
  searchIndex: {
    'чат': ['/чат', '/групповой_чат'],
    'задач': ['/задача', '/календарь'],
    'календар': ['/календарь', '/задача'],
    'файл': ['/файлы', '/мои_файлы', '/поиск_файлов'],
    'статус': ['/статус', '/профиль'],
    'профил': ['/профиль', '/статус'],
    'уведомлен': ['/уведомления', '/настройки'],
    'поиск': ['/поиск', '/поиск_файлов'],
    'переговор': ['/переговорка', '/календарь'],
    'брон': ['/переговорка', '/мои_брони'],
    'обучен': ['/онбординг'],
    'оцен': ['/оценить'],
    'настрой': ['/настройки', '/уведомления'],
    'поддерж': ['/поддержка'],
    'помощ': ['/помощь', '/помощь_по_чату'],
    'техническ': ['/поддержка'],
    'ошибк': ['/поддержка'],
    'не работ': ['/поддержка']
  }
};

// Функция для получения ответа бота (ПОЛНОСТЬЮ КНОПОЧНАЯ)
function getBotResponse(message) {
  const text = message.trim().toLowerCase();

  // Проверка команд (с / или без)
  const cleanCommand = text.replace('/', '').split(' ')[0];
  
  if (text.startsWith('/') || botKnowledge.commands['/' + cleanCommand]) {
    const command = '/' + cleanCommand;
    if (botKnowledge.commands[command]) {
      const cmd = botKnowledge.commands[command];
      return {
        text: cmd.text,
        buttons: cmd.buttons || [],
        steps: cmd.steps || null
      };
    }
  }

  // Расширенный поиск по ключевым словам
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
    'слом': '/поддержка'
  };

  // Поиск по ключевым словам
  for (const [keyword, command] of Object.entries(keywordMap)) {
    if (text.includes(keyword)) {
      const cmd = botKnowledge.commands[command];
      if (cmd) {
        return {
          text: cmd.text,
          buttons: cmd.buttons || [],
          steps: cmd.steps || null
        };
      }
    }
  }

  // Проверка ответов на вопросы
  for (const [keyword, response] of Object.entries(botKnowledge.responses)) {
    if (text.includes(keyword)) {
      if (typeof response === 'object') {
        return response;
      }
      return { text: response, buttons: [] };
    }
  }

  // Ответ по умолчанию с кнопками
  const defaultCmd = botKnowledge.commands['по умолчанию'];
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
}

// Отправка сообщения от имени помощника (ОБНОВЛЁННАЯ — с сохранением кнопок в БД)
function sendBotMessage(socket, chatId, text, buttons = []) {
  // Находим помощника в базе по имени
  const botResult = db.exec("SELECT id, username, avatar FROM users WHERE username = 'Помощник'");
  if (!botResult || botResult.length === 0 || botResult[0].values.length === 0) {
    console.error('Помощник не найден в базе');
    return;
  }

  const botId = botResult[0].values[0][0];
  const botUsername = botResult[0].values[0][1];
  const botAvatar = botResult[0].values[0][2];

  const messageId = uuidv4();
  const timestamp = new Date().toISOString();

  // Сохраняем кнопки в file_data (как JSON)
  const buttonsData = buttons.length > 0 ? JSON.stringify({ type: 'bot_buttons', buttons: buttons }) : null;

  try {
    // Вставляем сообщение в БД с кнопками в file_data
    db.run(`
      INSERT INTO messages (id, chat_id, sender_id, text, timestamp, file_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [messageId, chatId, botId, text, timestamp, buttonsData]);
    saveDatabase();

    // Отправляем сообщение клиенту с кнопками
    socket.emit('new_message', {
      message: {
        id: messageId,
        chatId: chatId,
        senderId: botId,
        senderName: botUsername,
        senderAvatar: botAvatar,
        text: text,
        timestamp: timestamp,
        isBotMessage: true,
        buttons: buttons
      },
      chat: { id: chatId }
    });

    console.log(`Бот отправил сообщение в чат ${chatId}: ${text.substring(0, 50)}...`);
  } catch (err) {
    console.error('Ошибка отправки сообщения ботом:', err);
  }
}

// Socket.IO подключение
io.on('connection', (socket) => {
  // Получаем IP из socket.handshake.address (работает для Socket.IO)
  const clientIp = socket.handshake?.address?.replace(/^::ffff:/, '') || 'unknown';
  const clientHost = socket.handshake?.headers?.host || 'unknown';
  const userAgent = socket.handshake?.headers?.['user-agent'] || 'unknown';

  console.log(`Подключение: ${socket.id} с IP: ${clientIp}, Host: ${clientHost}`);

  // Функция для обновления имени компьютера в БД
  const updateComputerName = (userId, name) => {
    if (userId && name && name !== 'unknown') {
      db.run('UPDATE users SET host = ? WHERE id = ?', [name, userId]);
      saveDatabase();
    }
  };

  // Пытаемся получить имя компьютера через reverse DNS lookup
  if (clientIp !== 'unknown' && clientIp !== '127.0.0.1' && !clientIp.startsWith('::')) {
    const dns = require('dns');
    dns.reverse(clientIp, (err, hostnames) => {
      if (!err && hostnames && hostnames.length > 0) {
        // Берём первое имя хоста и убираем доменную часть
        const computerName = hostnames[0].split('.')[0];
        console.log(`Reverse DNS для ${clientIp}: ${computerName}`);
        // Обновляем для текущего пользователя если он уже подключился
        const currentUser = onlineUsers.get(socket.id);
        if (currentUser) {
          updateComputerName(currentUser.id, computerName);
        }
      } else {
        console.log(`Reverse DNS не удался для ${clientIp}: ${err?.message || 'no hostname'}`);
      }
    });
  }

  // Пользователь присоединяется
  socket.on('join', (data) => {
    const { username, userId: existingUserId } = data;

    let user = null;

    // Проверяем, есть ли существующий пользователь с таким ID
    if (existingUserId) {
      user = getUserById(existingUserId);
      if (user) {
        // Обновляем статус, last_seen и ip_address (host обновится позже через reverse DNS)
        db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP, ip_address = ? WHERE id = ?', ['online', clientIp, existingUserId]);
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
        `, [newUserId, username, avatar, 'unknown', clientIp]);
        saveDatabase();
        user = getUserById(newUserId);
        console.log(`Создан новый пользователь: ${username} (${newUserId})`);
      } catch (err) {
        // Если username уже существует, генерируем уникальный
        const uniqueUsername = `${username}_${Math.floor(Math.random() * 1000)}`;
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, uniqueUsername, avatar, 'unknown', clientIp]);
        saveDatabase();
        user = getUserById(newUserId);
        console.log(`Создан новый пользователь с уникальным именем: ${uniqueUsername}`);
      }
    }

    // Добавляем пользователя в онлайн
    onlineUsers.set(socket.id, {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      socketId: socket.id
    });

    // После добавления в onlineUsers, обновляем имя компьютера если оно уже получено
    const dns = require('dns');
    if (clientIp !== 'unknown' && clientIp !== '127.0.0.1' && !clientIp.startsWith('::')) {
      dns.reverse(clientIp, (err, hostnames) => {
        if (!err && hostnames && hostnames.length > 0) {
          const computerName = hostnames[0].split('.')[0];
          console.log(`Reverse DNS для ${clientIp}: ${computerName}`);
          updateComputerName(user.id, computerName);
        }
      });
    }
    
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
    let userChats = getUserChats(user.id);
    
    // Создаём чат с помощником если не существует
    const botResult = db.exec("SELECT id FROM users WHERE username = 'Помощник'");
    const botId = botResult && botResult.length > 0 && botResult[0].values.length > 0 ? botResult[0].values[0][0] : null;
    const botChatId = `bot-chat-${user.id}`;
    const botChatCheck = db.exec(`SELECT * FROM chats WHERE id = '${botChatId}'`);
    if (botChatCheck.length === 0 || botChatCheck[0].values.length === 0) {
      // Создаём чат с помощником
      db.run(`
        INSERT INTO chats (id, type, name, created_by, created_at)
        VALUES (?, 'direct', 'Помощник', ?, CURRENT_TIMESTAMP)
      `, [botChatId, user.id]);

      // Добавляем пользователя в чат с помощником
      db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, user.id]);

      // Добавляем помощника в чат
      if (botId) {
        db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, botId]);
      }
      saveDatabase();

      // Обновляем список чатов
      userChats = getUserChats(user.id);

      console.log(`Создан чат с помощником для пользователя ${user.username}`);
    }

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

    // Проверяем, первый ли это вход пользователя (по полю has_seen_welcome)
    const userWelcomeCheck = db.exec(`SELECT has_seen_welcome FROM users WHERE id = '${user.id}'`);
    const hasSeenWelcome = userWelcomeCheck && userWelcomeCheck.length > 0 && userWelcomeCheck[0].values.length > 0 && userWelcomeCheck[0].values[0][0] === 1;
    const isFirstJoin = !hasSeenWelcome;

    // Отправляем приветственное сообщение от бота при первом входе
    if (isFirstJoin) {
      // Помечаем, что пользователь видел приветствие
      db.run('UPDATE users SET has_seen_welcome = 1 WHERE id = ?', [user.id]);
      saveDatabase();

      setTimeout(() => {
        const welcomeMessage = `👋 Здравствуйте, ${user.username}!

Я 🤖 Помощник. Рад видеть вас в нашей команде!

🎯 *Рекомендую начать с обучения!*
Это займёт всего 2 минуты и поможет быстро освоиться в чате.

*Что вы узнаете:*
• Как создавать чаты
• Как управлять задачами
• Как загружать файлы
• Как настроить профиль

*Начните обучение или выберите тему:*
/онбординг — пошаговое обучение
/помощь — все команды`;

        const welcomeButtons = [
          { label: '🎯 Пройти обучение', action: '/онбординг' },
          { label: '❓ Помощь', action: '/помощь' },
          { label: '📱 Чаты', action: '/чат' },
          { label: '📅 Задачи', action: '/задача' }
        ];

        sendBotMessage(socket, botChatId, welcomeMessage, welcomeButtons);
      }, 1000);
    }

    // Уведомляем остальных о новом пользователе
    socket.broadcast.emit('user_status_changed', {
      userId: user.id,
      username: user.username,
      status: 'online'
    });

    // Приветствие нового пользователя в общем чате (только при первом входе)
    if (isFirstJoin) {
      setTimeout(() => {
        const welcomeText = `👋 Коллеги, поприветствуйте нового участника — **${user.username}**!

Рады видеть вас в нашей команде! 🎉`;

        // Отправляем сообщение в общий чат от имени помощника
        const botResult = db.exec("SELECT id FROM users WHERE username = 'Помощник'");
        if (botResult && botResult.length > 0) {
          const botId = botResult[0].values[0][0];
          const messageId = uuidv4();

          db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
            VALUES (?, 'general', ?, ?, ?)
          `, [messageId, botId, welcomeText, new Date().toISOString()]);
          saveDatabase();

          // Отправляем всем в общий чат
          io.to('general').emit('new_message', {
            message: {
              id: messageId,
              chatId: 'general',
              senderId: botId,
              senderName: 'Помощник',
              senderAvatar: 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff',
              text: welcomeText,
              timestamp: new Date().toISOString(),
              isBotMessage: true,
              buttons: []
            },
            chat: { id: 'general' }
          });

          console.log(`Помощник приветствовал ${user.username} в общем чате`);
        }
      }, 2000);
    }

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

      // Автоматически присоединяем всех онлайн-участников к комнате чата
      participants.forEach(pUserId => {
        const participantSocket = Array.from(onlineUsers.values()).find(u => u.id === pUserId);
        if (participantSocket) {
          // Присоединяем к комнате, если ещё не присоединён
          // participantSocket.socketId - это ID сокета, используем io.sockets
          const sock = io.sockets.sockets.get(participantSocket.socketId);
          if (sock && !sock.rooms.has(chatId)) {
            sock.join(chatId);
            console.log(`✓ Участник ${participantSocket.username} присоединён к комнате ${chatId}`);
          }
        }
      });

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

    // Присоединяем отправителя к комнате чата если ещё не присоединён
    if (!socket.rooms.has(chatId)) {
      socket.join(chatId);
      console.log('✓ Отправитель присоединён к комнате', chatId);
    }

    // Отправляем сообщение всем в чате (включая отправителя)
    io.to(chatId).emit('new_message', {
      message: formattedMessage,
      chat: { ...chat, unreadCount: 0 }
    });

    console.log('✓ Сообщение отправлено');
    
    // ============================================
    // Обработка сообщений для бота-помощника
    // ============================================
    // Проверяем, является ли чат чатом с ботом
    const isBotChat = chatId.startsWith('bot-chat-');

    if (isBotChat && text && !file) {
      const command = text.trim().toLowerCase().split(' ')[0];

      // Обработка специальных команд с данными
      if (command === '/сегодня') {
        // Команда /сегодня
        setTimeout(async () => {
          try {
            const today = new Date();
            const todayStr = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
            const todayIso = today.toISOString().split('T')[0];

            // Задачи на сегодня
            const tasksToday = db.exec(`
              SELECT id, title, task_time FROM calendar_tasks
              WHERE user_id = '${onlineUser.id}' AND task_date LIKE '${todayIso}%'
            `);
            const tasks = tasksToday[0]?.values.map(row => ({
              title: row[1],
              time: row[2]
            })) || [];

            // Дни рождения сегодня
            const todayDay = today.getDate();
            const todayMonth = today.getMonth() + 1;
            const birthdays = db.exec(`SELECT username, avatar FROM users WHERE birth_date IS NOT NULL`);
            const birthdaysToday = birthdays[0]?.values
              .filter(row => {
                const bd = new Date(row[1]);
                return bd.getDate() === todayDay && (bd.getMonth() + 1) === todayMonth;
              })
              .map(row => row[0]) || [];

            // Встречи сегодня
            const meetings = db.exec(`
              SELECT title, start_time, end_time FROM meeting_room_bookings
              WHERE meeting_date LIKE '${todayIso}%' AND organizer_id = '${onlineUser.id}'
            `);
            const meetingsList = meetings[0]?.values.map(row => ({
              title: row[0],
              time: `${row[1]} - ${row[2]}`
            })) || [];

            // Формируем ответ
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
        return;
      }

      if (command === '/контакты') {
        // Команда /контакты - показываем только пользователей с номерами телефонов
        setTimeout(() => {
          try {
            const users = db.exec(`
              SELECT username, mobile_phone, work_phone, email, status
              FROM users
              WHERE username != 'Помощник'
                AND (
                  (mobile_phone IS NOT NULL AND TRIM(mobile_phone) != '')
                  OR
                  (work_phone IS NOT NULL AND TRIM(work_phone) != '')
                )
              ORDER BY username
            `);

            const contacts = users[0]?.values || [];

            if (contacts.length === 0) {
              sendBotMessage(socket, chatId, '📞 *Контакты:*\n\nСписок контактов пуст.', []);
              return;
            }

            let responseText = `📞 *Телефонная книга (${contacts.length}):*\n\n`;
            contacts.forEach(row => {
              const status = row[4] === 'online' ? '🟢' : '⚫';
              responseText += `${status} *${row[0]}*\n`;
              if (row[1]) responseText += `  📱 Моб: ${row[1]}\n`;
              if (row[2]) responseText += `  📞 Раб: ${row[2]}\n`;
              if (row[3]) responseText += `  ✉️ ${row[3]}\n`;
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
        return;
      }

      // Обычные команды через базу знаний
      const botResponse = getBotResponse(text);

      // Отправляем ответ с небольшой задержкой для естественности
      setTimeout(() => {
        sendBotMessage(socket, chatId, botResponse.text, botResponse.buttons || []);
      }, 500);
    }
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
        file_data: String(row['file_data'] || ''),
        timestamp: String(row['timestamp'] || '')
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
    const timestamp = new Date().toISOString(); // Используем текущее время клиента

    // Используем прямой SQL для надёжности
    const sql = `INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from)
      VALUES ('${newMessageId}', '${chat.id}', '${onlineUser.id}', '${textVal}', '${fileVal}', '${timestamp}', '${fromVal}');`;
    
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
        // Отправляем сообщение получателю напрямую
        targetSocket.emit('new_message', {
          message: formattedMessage,
          chat: { id: chat.id, type: chat.type, unreadCount: 1 }
        });

        // Отправляем обновление чата получателю
        const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
        console.log('Отправляем chat_updated получателю:', {
          chatId: chat.id,
          chatName: chatWithUnread?.name,
          participants: chatWithUnread?.participants,
          lastMessage: chatWithUnread?.lastMessage
        });
        if (chatWithUnread) {
          targetSocket.emit('chat_updated', {
            chatId: chat.id,
            chat: chatWithUnread
          });
        }
      }

      // Отправляем подтверждение отправителю
      socket.emit('new_message', {
        message: formattedMessage,
        chat: { id: chat.id, type: chat.type, unreadCount: 0 },
        isOwnMessage: true
      });

      // Отправляем обновление чата отправителю
      const senderChatWithUnread = getChatWithDetails(chat.id, onlineUser.id);
      if (senderChatWithUnread) {
        socket.emit('chat_updated', {
          chatId: chat.id,
          chat: senderChatWithUnread
        });
      }

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

  // === ОБРАБОТКА РЕАКЦИЙ ===
  
  // Добавление реакции
  socket.on('add_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      console.log('Реакция отменена: нет данных', { onlineUser: !!onlineUser, messageId, emoji });
      return;
    }

    console.log('Добавление реакции:', { messageId, emoji, userId: onlineUser.id, username: onlineUser.username });

    try {
      // Проверяем, существует ли сообщение и получаем chat_id
      const msgStmt = db.prepare(`SELECT id, chat_id FROM messages WHERE id = ?`);
      msgStmt.bind([messageId]);
      if (!msgStmt.step()) {
        msgStmt.free();
        console.log('Сообщение не найдено:', messageId);
        return;
      }
      const messageRow = msgStmt.getAsObject();
      msgStmt.free();

      const chatId = messageRow.chat_id;
      console.log('Найден chat_id для сообщения:', chatId);

      if (!chatId) {
        console.log('chatId не найден для сообщения:', messageId);
        return;
      }

      // Сначала удаляем все существующие реакции этого пользователя на данное сообщение
      db.run(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_id = ?
      `, [messageId, onlineUser.id]);

      // Добавляем новую реакцию в базу
      db.run(`
        INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [messageId, onlineUser.id, emoji]);

      saveDatabase();

      console.log('Отправка события reaction_added в чат:', chatId);

      // Уведомляем всех в чате о добавлении реакции с аватаркой
      io.to(chatId).emit('reaction_added', {
        messageId,
        emoji,
        userId: onlineUser.id,
        username: onlineUser.username,
        avatar: onlineUser.avatar
      });

      console.log(`Реакция ${emoji} добавлена пользователем ${onlineUser.username}`);
    } catch (err) {
      console.error('Ошибка при добавлении реакции:', err);
    }
  });

  // Удаление реакции
  socket.on('remove_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      console.log('Удаление реакции отменено: нет данных', { onlineUser: !!onlineUser, messageId, emoji });
      return;
    }

    console.log('Удаление реакции:', { messageId, emoji, userId: onlineUser.id });

    try {
      // Получаем chat_id сообщения
      const msgStmt = db.prepare(`SELECT chat_id FROM messages WHERE id = ?`);
      msgStmt.bind([messageId]);
      const messageData = msgStmt.step() ? msgStmt.getAsObject() : null;
      msgStmt.free();

      if (!messageData) {
        console.log('Сообщение не найдено:', messageId);
        return;
      }

      const chatId = messageData.chat_id;

      // Удаляем реакцию из базы
      db.run(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_id = ? AND emoji = ?
      `, [messageId, onlineUser.id, emoji]);

      saveDatabase();

      // Уведомляем всех в чате об удалении реакции
      io.to(chatId).emit('reaction_removed', {
        messageId,
        emoji,
        userId: onlineUser.id
      });

      console.log(`Реакция ${emoji} удалена пользователем ${onlineUser.username}`);
    } catch (err) {
      console.error('Ошибка при удалении реакции:', err);
    }
  });
});

// ============================================
// Напоминания о задачах (интервальная проверка)
// ============================================

// Проверка каждые 15 минут
const REMINDER_INTERVAL = 15 * 60 * 1000;

function checkTaskReminders() {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Находим задачи на завтра
    const tasksTomorrow = db.exec(`
      SELECT ct.id, ct.title, ct.task_date, ct.task_time, ct.user_id, u.username
      FROM calendar_tasks ct
      JOIN users u ON ct.user_id = u.id
      WHERE ct.task_date LIKE '${tomorrowStr}%'
    `);

    if (!tasksTomorrow || tasksTomorrow.length === 0) return;

    // Отправляем напоминания
    tasksTomorrow[0].values.forEach(row => {
      const taskId = row[0];
      const taskTitle = row[1];
      const taskDate = row[2];
      const taskTime = row[3];
      const userId = row[4];
      const username = row[5];

      // Проверяем, онлайн ли пользователь
      let isOnline = false;
      onlineUsers.forEach(user => {
        if (user.id === userId) isOnline = true;
      });

      if (isOnline) {
        // Находим чат с ботом
        const botChatId = `bot-chat-${userId}`;
        const reminderText = `⏰ *Напоминание о задаче:*\n\n📅 **${taskTitle}**\n\nДата: ${new Date(taskDate).toLocaleDateString('ru-RU')}${taskTime ? `\nВремя: ${taskTime}` : ''}\n\n💡 *Совет:* Подготовьтесь заранее!`;

        // Отправляем сообщение
        const botResult = db.exec("SELECT id FROM users WHERE username = 'Помощник'");
        if (botResult && botResult.length > 0) {
          const botId = botResult[0].values[0][0];
          const messageId = uuidv4();

          db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
            VALUES (?, ?, ?, ?, ?)
          `, [messageId, botChatId, botId, reminderText, new Date().toISOString()]);
          saveDatabase();

          // Находим сокет пользователя
          let userSocket = null;
          onlineUsers.forEach((user, socketId) => {
            if (user.id === userId) userSocket = socketId;
          });

          const socketItem = Array.from(onlineUsers.entries()).find(([sid, u]) => u.id === userId);
          if (socketItem) {
            const userSocket = io.sockets.sockets.get(socketItem[0]);
            if (userSocket) {
              userSocket.emit('new_message', {
                message: {
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
                },
                chat: { id: botChatId }
              });
            }
          }

          console.log(`Напоминание отправлено ${username} о задаче "${taskTitle}"`);
        }
      }
    });
  } catch (err) {
    console.error('Ошибка проверки напоминаний:', err);
  }
}

// Запускаем проверку после старта сервера
setTimeout(() => {
  checkTaskReminders();
  // Затем проверяем каждые 15 минут
  setInterval(checkTaskReminders, REMINDER_INTERVAL);
  console.log('Напоминания о задачах активированы (проверка каждые 15 минут)');
}, 5000);

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
console.log('Начало инициализации БД...');
initDatabase().then(() => {
  console.log('initDatabase завершено успешно, запуск сервера...');
  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? getLocalIP() : HOST;
    console.log(`Сервер запущен на http://${displayHost}:${PORT}`);
    console.log(`URL для клиентов: ${SERVER_URL}`);
    console.log(`База данных: ${DB_PATH}`);
    console.log(`Путь загрузок: ${UPLOADS_PATH}`);
  });
}).catch(err => {
  console.error('Ошибка инициализации БД:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});
