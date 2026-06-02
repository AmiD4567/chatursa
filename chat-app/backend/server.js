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
const crypto = require('crypto');

// Настройки шифрования для конфиденциальности сообщений
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY || 'my-super-secret-key-2026';
console.log('Ключ шифрования:', ENCRYPTION_KEY);
const IV_LENGTH = 16;

// Проверка: строка уже зашифрована? (формат: hexIV:hexCiphertext)
function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const parts = text.split(':');
  if (parts.length < 2) return false;
  try {
    Buffer.from(parts[0], 'hex');
    return true;
  } catch {
    return false;
  }
}

// Функция шифрования текста
function encryptText(text) {
  if (!text || text.length === 0) return null;
  // Если уже зашифровано — не шифруем повторно
  if (isEncrypted(text)) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Сохраняем IV вместе с зашифрованным текстом (IV нужен для расшифровки)
  return iv.toString('hex') + ':' + encrypted;
}

// Функция расшифровки текста
function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;
  // Если не зашифровано — вернуть как есть (для обратной совместимости с существующими данными)
  if (!isEncrypted(encryptedText)) return encryptedText;

  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    // Проверяем, что оба значения не пустые
    if (!ivHex || !encryptedHex) {
      // Не логгируем — бот может отправлять plaintext-сообщения, которые
      // корректно возвращаются как есть (см. issue: console spam on bot usage)
      return encryptedText;
    }

    const iv = Buffer.from(ivHex, 'hex');
    // Проверяем длину IV (должна быть 16 байт для aes-256-cbc)
    if (iv.length !== 16) {
      // Не логгируем — см. выше
      return encryptedText;
    }
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Ошибка расшифровки:', err.message);
    // При ошибке возвращаем оригинальный текст для предотвращения потери данных
    return encryptedText;
  }
}

// Функция для получения локального IP

// ============================================
// Асинхронный буферизированный логгер
// Полностью неблокирующий: ни один console.* вызов не происходит синхронно
// ============================================
const LOG_FILE = path.join(__dirname, 'server-runtime.log');
const LOG_FLUSH_INTERVAL = 3000; // flush каждые 3 сек (было 2с)
const LOG_MAX_BATCH_SIZE = 100;  // макс. строк в одном write (было 50)

const logQueue = [];             // очередь сообщений
let logFlushTimer = null;        // таймер периодического сброса
let isFlushing = false;          // флаг: идёт запись в файл

/**
 * emitLog — асинхронный вывод строки в консоль (через setImmediate).
 * Не блокирует event loop даже при выводе в stdout/stderr.
 */
function emitLog(line) {
  setImmediate((() => {
    // eslint-disable-next-line no-console
    process.stdout.write(line);
  })());
}

/**
 * enqueue — добавить сообщение в очередь логирования.
 * Не блокирует event loop, запись происходит асинхронно.
 */
function logEnqueue(level, ...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${args.join(' ')}\n`;

  // ERROR — приоритетная очередь (в начало), но выводим асинхронно
  if (level === 'ERROR') {
    logQueue.unshift(line);
    flushLogs();
    return;
  }

  // Обычные логи — в очередь
  logQueue.push(line);

  // Если таймер ещё не запущен — запускаем debounce
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(() => {
      flushLogs();
    }, LOG_FLUSH_INTERVAL);
  }
}

/**
 * flushLogs — записать накопленные логи в файл И вывести в консоль.
 * Вызывается по таймеру или при переполнении буфера.
 */
async function flushLogs() {
  if (isFlushing) return;
  isFlushing = true;

  // Собираем батч из очереди
  const batch = logQueue.splice(0, LOG_MAX_BATCH_SIZE);
  if (batch.length === 0) {
    isFlushing = false;
    // Если очередь ещё есть — планируем следующий flush
    if (logQueue.length > 0) {
      logFlushTimer = setTimeout(flushLogs, 100);
    }
    return;
  }

  const data = batch.join('');

  try {
    await fs.promises.appendFile(LOG_FILE, data);
  } catch (err) {
    // Если файл-лог недоступен — выводим в консоль как ошибку
    setImmediate(() => {
      process.stderr.write(`[logger] Ошибка записи в лог-файл: ${err.message}\n`);
    });
  }

  isFlushing = false;

  // Если остались сообщения — продолжаем flush
  if (logQueue.length > 0) {
    logFlushTimer = setTimeout(flushLogs, 100);
  } else {
    logFlushTimer = null;
  }
}

/**
 * flushLogsSync — синхронный сброс (только для graceful shutdown).
 */
function flushLogsSync() {
  if (logQueue.length === 0) return;
  try {
    const data = logQueue.join('');
    fs.appendFileSync(LOG_FILE, data);
  } catch (err) {
    process.stderr.write(`[logger] Ошибка синхронной записи в лог: ${err.message}\n`);
  }
  logQueue.length = 0;
}

// Переопределяем console.log / console.warn → полностью асинхронный логгер
console.log = (...args) => {
  setImmediate(() => {
    process.stdout.write(args.join(' ') + '\n');
  });
  logEnqueue('INFO', ...args);
};

console.warn = (...args) => {
  setImmediate(() => {
    process.stderr.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
  });
  logEnqueue('WARN', ...args);
};

// console.error тоже полностью асинхронный
console.error = (...args) => {
  setImmediate(() => {
    process.stderr.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
  });
  logEnqueue('ERROR', ...args);
};

// Глобальный обработчик unhandledRejection → асинхронный лог
process.on('unhandledRejection', (reason, promise) => {
  const reasonStr = reason?.stack || reason;
  setImmediate(() => {
    process.stderr.write(`[unhandledRejection] ${reasonStr}\n`);
  });
  logEnqueue('ERROR', '[unhandledRejection]', reasonStr);
});

// Запускаем первый flush-таймер при старте
logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL);


// ============================================
// Конец асинхронного логгера
// ============================================

// Загрузка конфигурации
let config = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const configFileContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configFileContent);
    console.log('Конфигурация загружена из config.json');
  } catch (err) {
    console.error('Ошибка чтения конфигурации:', err.message);
  }
} else {
  console.log('Файл config.json не найден, используем настройки по умолчанию');
}

// Используем переменные окружения от Electron или значения из config
const HOST = process.env.CHAT_APP_HOST || config.server?.host || '0.0.0.0';
const PORT = process.env.CHAT_APP_PORT || config.server?.port || 3001;
const DATA_PATH = process.env.CHAT_APP_DATA_PATH || __dirname;
const DB_PATH = process.env.CHAT_APP_DB_PATH || path.join(__dirname, 'chat.db');
const UPLOADS_PATH = process.env.CHAT_APP_UPLOADS_PATH || config.uploads?.path || path.join(__dirname, 'uploads');

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

// URL сервера для доступа клиентам к файлам: по умолчанию localhost (для Electron), можно переопределить через env
// Если SERVER_URL не задан в окружении или конфиге, используем локальный IP для доступности в сети
let SERVER_URL = process.env.CHAT_APP_SERVER_URL || config.server?.url;
if (!SERVER_URL) {
  const localIP = getLocalIP();
  SERVER_URL = `http://${localIP}:${PORT}`;
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
  try {
    const result = db.exec(`SELECT is_admin FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
    if (!result[0] || result[0].values.length === 0) return false;
    return result[0].values[0][0] === 1;
  } catch (e) {
    console.error('Ошибка проверки прав админа:', e.message);
    return false;
  }
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
    CREATE INDEX IF NOT EXISTS idx_users_birth_date ON users(birth_date);
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
    const rootCheck = db.exec("SELECT id FROM users WHERE username = 'Root'");
    if (rootCheck && rootCheck.length > 0 && rootCheck[0].values.length > 0) {
      db.run("UPDATE users SET is_admin = 1 WHERE username = 'Root'");

    }
  } catch (e) {
    // Пользователь ещё не создан или ошибка при установке админа
    console.log('Ошибка установки admin для Root:', e.message);
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

  // Миграции для добавления колонок (убраны дубликаты)
  const migrations = [
    { table: 'users', column: 'mobile_phone', type: 'TEXT' },
    { table: 'users', column: 'work_phone', type: 'TEXT' },
    { table: 'users', column: 'status_text', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'task_time', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'task_end_time', type: 'TEXT' },
    { table: 'messages', column: 'read_at', type: 'TEXT' },
    { table: 'users', column: 'is_admin', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'has_seen_welcome', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'forwarded_from', type: 'TEXT' },
    { table: 'users', column: 'can_book_meeting_room', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'reply_to', type: 'TEXT' },
    { table: 'messages', column: 'is_pinned', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'pinned_by', type: 'TEXT' },
    { table: 'messages', column: 'pinned_at', type: 'TEXT' }
  ];

  // Выполняем миграции
  migrations.forEach(({ table, column, type }) => {
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Колонка уже существует
    }
  });

  // Проверка и создание общего чата

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
    CREATE INDEX IF NOT EXISTS idx_meeting_room_organizer_date ON meeting_room_bookings(organizer_id, meeting_date);
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
      reply_to TEXT,
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

  // Миграция: добавление колонок edited и edited_at в messages
  try {
    db.run('ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0');
  } catch (e) {
    // Колонка уже существует
  }
  try {
    db.run('ALTER TABLE messages ADD COLUMN edited_at TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  // Проверка и создание общего чата
  const generalChat = db.exec("SELECT * FROM chats WHERE id = 'general'");
  if (generalChat.length === 0 || generalChat[0].values.length === 0) {
    db.run(`
      INSERT INTO chats (id, type, name, created_by)
      VALUES ('general', 'general', 'Общий чат', 'system')
    `);

  }

  // Создание помощника если не существует
  const botCheck = db.exec("SELECT * FROM users WHERE username = 'Помощник'");
  if (botCheck.length === 0 || botCheck[0].values.length === 0) {
    const botId = 'helper-bot-' + uuidv4().substring(0, 8);
    db.run(`
      INSERT INTO users (id, username, avatar, status, is_admin)
      VALUES (?, ?, ?, 'online', 0)
    `, [botId, 'Помощник', `${SERVER_URL}/uploads/ursa.jpg`]);

    console.log('Создан помощник');
  }

  // Миграция: очищаем пустые номера телефонов
  try {
    db.run("UPDATE users SET mobile_phone = NULL WHERE TRIM(mobile_phone) = '' OR mobile_phone = ' '");
    db.run("UPDATE users SET work_phone = NULL WHERE TRIM(work_phone) = '' OR work_phone = ' '");

    console.log('Миграция телефонов выполнена');
  } catch (e) {
    // Игнорируем ошибки миграции
  }

  // Миграция: убираем эмодзи из имени помощника
  try {
    db.run("UPDATE chats SET name = 'Помощник' WHERE name = '🤖 Помощник'");

    console.log('Миграция имени помощника выполнена');
  } catch (e) {
    // Игнорируем ошибки миграции
  }

  console.log('База данных инициализирована');
  return Promise.resolve();
}

// Сохранение базы данных на диск (асинхронное, неблокирующее)
let saveDatabaseTimer = null;
let lastDbActivity = 0;          // timestamp последней активности БД
const AUTO_SAVE_DELAY = 60000;   // автосохранение через 60с после последней активности (было 30с фиксировано)
const MIN_AUTO_SAVE_INTERVAL = 15000; // минимальный интервал между сохранениями — 15с

function startAutoSave() {
  // Автосохранение: ждём 60с после последней активности БД
  scheduleAutoSave();
}

function scheduleAutoSave() {
  if (saveDatabaseTimer) clearTimeout(saveDatabaseTimer);
  saveDatabaseTimer = setTimeout(() => {
    const now = Date.now();
    // Не сохраняем чаще чем раз в MIN_AUTO_SAVE_INTERVAL
    if (now - lastDbActivity < MIN_AUTO_SAVE_INTERVAL) return;
    performAutoSave();
  }, AUTO_SAVE_DELAY);
}

function performAutoSave() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFile(DB_PATH, buffer, (err) => {
      if (err) console.error('Ошибка автосохранения БД:', err.message);
    });
  } catch (err) {
    console.error('Ошибка экспорта БД при автосохранении:', err.message);
  }
}

// Вызывать из критических путей после изменения БД
function markDbActivity() {
  lastDbActivity = Date.now();
  scheduleAutoSave(); // перезапускаем таймер
}

function saveDatabaseSync() {
  // Синхронное сохранение — только при shutdown или критических операциях
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Остановка автосохранения
function stopAutoSave() {
  if (saveDatabaseTimer) {
    clearInterval(saveDatabaseTimer);
    saveDatabaseTimer = null;
  }
}

// Хранилище онлайн пользователей в памяти
const onlineUsers = new Map(); // socketId -> { id, username, socketId }

// Rate-limiting для бота-помощника: 2 секунды между командами на один сокет
const botRateLimit = new Map(); // socketId -> timestamp последнего запроса

// State machine — контекст разговора с ботом (socketId -> ConversationState)
let conversationStates; // будет инициализирован в initDatabase().then()

// Аналитика использования бота
let botAnalytics; // будет инициализирован в initDatabase().then()

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
app.use('/stickers', express.static(path.join(__dirname, '../frontend/build/stickers')));
app.use(express.static(path.join(__dirname, '../frontend/build')));

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
  const userCheck = db.exec(`SELECT username FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
  if (userCheck[0] && userCheck[0].values.length > 0 && userCheck[0].values[0][0] === 'Root') {
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
    const adminUser = db.exec(`SELECT username FROM users WHERE id = '${adminId}'`);
    const adminName = adminUser[0]?.values[0][0] || 'Admin';
    db.run(`INSERT INTO security_logs (id, event_type, event, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, 'password_reset', `Пароль сброшен администратором ${adminName}`, userId, null, 'success']);


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
  const userStmt = db.prepare('SELECT id, is_admin FROM users WHERE id = ?');
  userStmt.bind([userIdToCheck]);
  let userData = null;
  if (userStmt.step()) {
    userData = userStmt.getAsObject();
  }
  userStmt.free();

  if (!userData) {
    return res.status(403).json({ error: 'Пользователь не найден' });
  }

  if (!messageId || messageId === 'undefined' || messageId === 'null') {
    return res.status(400).json({ error: 'messageId обязателен и должен быть валидным' });
  }

  try {
    // Получаем информацию о сообщении для проверки
    const messageData = db.exec(`
      SELECT m.id, m.chat_id, m.sender_id, m.text as text, m.file_data, m.timestamp,
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
    const text = decryptText(row[3] || '') || '';
    const fileData = row[4];
    const senderUsername = row[6];

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
    const userStmt = db.prepare('SELECT username FROM users WHERE id = ?');
    userStmt.bind([userIdToCheck]);
    let userName = 'User';
    if (userStmt.step()) {
      userName = userStmt.getAsObject().username || 'User';
    }
    userStmt.free();
    
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


    const userStmt = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text FROM users WHERE id = ?');
    userStmt.bind([userId]);
    const updatedUser = userStmt.step() ? userStmt.getAsObject() : null;
    userStmt.free();

    if (!updatedUser) {
      return res.status(500).json({ error: 'Ошибка при обновлении профиля' });
    }

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
      status: 'online',
      statusText: decodedStatusText
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

  const fileUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({
    filename: req.file.originalname,
    url: fileUrl,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// ========================================
// Скачивание файлов с оригинальным именем (UTF-8)
// ========================================

// Кэш поиска оригинальных имён файлов по UUID
const filenameCache = new Map(); // uuid -> originalFilename

function findOriginalFilenameByUuid(uuid) {
  // Проверяем кэш
  if (filenameCache.has(uuid)) return filenameCache.get(uuid);

  try {
    const fileDataResult = db.exec(`SELECT file_data FROM messages WHERE file_data IS NOT NULL`);
    if (fileDataResult.length > 0) {
      const rows = fileDataResult[0].values;
      for (const row of rows) {
        const fd = row[0];
        if (fd && typeof fd === 'string') {
          try {
            const parsed = JSON.parse(fd);
            if (parsed && parsed.url) {
              const urlFilename = parsed.url.split('/').pop();
              if (urlFilename === uuid) {
                filenameCache.set(uuid, parsed.filename);
                return parsed.filename;
              }
            }
          } catch (e) {
            // skip invalid JSON
          }
        }
      }
    }
  } catch (err) {
    console.error('Ошибка поиска оригинального имени файла:', err);
  }

  filenameCache.set(uuid, null);
  return null;
}

// Скачивание файла по UUID с правильным Content-Disposition для UTF-8 имён
app.get('/api/download/:uuid', (req, res) => {
  const uuid = req.params.uuid;
  const filePath = path.join(UPLOADS_PATH, uuid);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  // Ищем оригинальное имя файла в базе данных (с кэшированием)
  const originalFilename = findOriginalFilenameByUuid(uuid);
  const displayName = originalFilename || uuid;

  // RFC 5987 / 6266 — корректная кодировка UTF-8 для Content-Disposition
  const encodedName = encodeURIComponent(displayName)
    .replace(/%27/g, "%27")   // ' → %27
    .replace(/%28/g, "%28")   // ( → %28
    .replace(/%29/g, "%29")   // ) → %29
    .replace(/%2A/g, "%2A");  // * → %2A

  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodedName}; filename="${displayName}";`
  );
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
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


    console.log('Обновляю статус шаринга:', shareId);
    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['accepted', shareId]);


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

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    const safeChatId = chatId.replace(/'/g, "''");
    const result = db.exec(`
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.read_at,
             u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = '${safeChatId}'
      ORDER BY m.timestamp ASC
    `);

    const rows = result[0]?.values || [];
    const messages = rows.map(row => {
      let file = null;
      if (row[4]) {
        try {
          file = JSON.parse(row[4]);
        } catch (e) {
          file = null;
        }
      }

      return {
        id: row[0],
        chatId: row[1],
        senderId: row[2],
        text: decryptText(row[3]),
        file: file,
        timestamp: row[6],
        read_at: row[7] || null,
        senderName: row[8],
        senderAvatar: row[9]
      };
    });

    res.json({ messages });
  } catch (err) {
    console.error('Ошибка загрузки сообщений:', err);
    res.status(500).json({ error: 'Ошибка при загрузке сообщений' });
  }
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
      encryptText(originalMsg.text) || null,
      originalMsg.file_data,
      JSON.stringify({
        sender_id: originalMsg.sender_id,
        sender_name: originalMsg.senderName,
        message_id: originalMsg.id
      })
    ]);


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

// Получение пользователя по ID
function getUserById(id) {
  try {
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
  } catch (e) {
    console.error('Ошибка получения пользователя по ID:', e.message);
    return null;
  }
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
      SELECT u.id, u.username, u.avatar, u.status, u.status_text, u.full_name, u.birth_date, u.position
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
        text: decryptText(msg.text) || (msg.file_data ? '📎 Файл' : ''),
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
  try {
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
        text: decryptText(row.text) || '',
        file: row.file_data && !isBotMessage ? JSON.parse(row.file_data) : null,
        reply_to: row.reply_to ? JSON.parse(row.reply_to) : null,
        timestamp: row.timestamp,
        read_at: row.read_at,
        forwarded_from: row.forwarded_from ? JSON.parse(row.forwarded_from) : null,
        readBy: [],
        buttons: buttons,
        isBotMessage: isBotMessage,
        edited: row.edited === 1 || row.edited === true,
        editedAt: row.edited_at || null,
        reactions: Object.keys(reactions).length > 0 ? reactions : undefined
      });
    }
    return messages;
  } catch (e) {
    console.error('Ошибка получения сообщений чата:', e.message);
    return [];
  }
}

function getAllUsers() {
  const stmt = db.prepare('SELECT id, username, avatar, status, full_name, birth_date, work_phone, mobile_phone, status_text, about FROM users');
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  return users;
}

// ============================================
// Модули бота-помощника
// ============================================
const { initBotEngine } = require('./bot/engine');
const { handleTodayCommand, handleContactsCommand } = require('./bot/commands');
const { processConversationState, isDialogStartCommand, startConversation, clearConversation } = require('./bot/state');

// Инициализация движка бота (после определения db, uuidv4, encryptText)
let bot; // будет инициализирован ниже после определения send_message handler

// ============================================
// Функция для получения ответа бота (ПОЛНОСТЬЮ КНОПОЧНАЯ)
function getBotResponse(message) {
  if (!bot) return { text: '🤖 Бот ещё не инициализирован.', buttons: [] };
  // getBotResponse делегируется через bot.getBotResponse() в send_message handler
  return bot.getBotResponse(message);
}

// Отправка сообщения от имени помощника (ОБНОВЛЁННАЯ — с сохранением кнопок в БД)
function sendBotMessage(socket, chatId, text, buttons = []) {
  if (!bot) {
    console.error('🤖 Бот не инициализирован');
    return;
  }
  bot.sendBotMessage(socket, chatId, text, buttons);
}
// Socket.IO подключение
io.on('connection', (socket) => {
  const clientIp = socket.handshake?.address?.replace(/^::ffff:/, '') || 'unknown';
  const userAgent = socket.handshake?.headers?.['user-agent'] || 'unknown';

  // Пытаемся получить имя компьютера через reverse DNS lookup
  if (clientIp !== 'unknown' && clientIp !== '127.0.0.1' && !clientIp.startsWith('::')) {
    const dns = require('dns');
    dns.reverse(clientIp, (err, hostnames) => {
      if (!err && hostnames && hostnames.length > 0) {
        const computerName = hostnames[0].split('.')[0];
        const currentUser = onlineUsers.get(socket.id);
        if (currentUser) {
          db.run('UPDATE users SET host = ? WHERE id = ?', [computerName, currentUser.id]);
        }
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
        db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP, ip_address = ? WHERE id = ?', ['online', clientIp, existingUserId]);
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

        user = getUserById(newUserId);
      } catch (err) {
        // Если username уже существует, генерируем уникальный
        const uniqueUsername = `${username}_${Math.floor(Math.random() * 1000)}`;
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, uniqueUsername, avatar, 'unknown', clientIp]);

        user = getUserById(newUserId);
      }
    }

    // Добавляем пользователя в онлайн
    onlineUsers.set(socket.id, {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
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
      db.run(`
        INSERT INTO chats (id, type, name, created_by, created_at)
        VALUES (?, 'direct', 'Помощник', ?, CURRENT_TIMESTAMP)
      `, [botChatId, user.id]);

      db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, user.id]);
      if (botId) {
        db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, botId]);
      }
      userChats = getUserChats(user.id);
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
      setTimeout(() => {
        const welcomeMessage = `👋 Здравствуйте, ${user.username}!

Я 🤖 Помощник. Рад видеть вас в команде!

💡 *Совет:* Начните с обучения — это займёт 2 минуты.`;

        const welcomeButtons = [
          { label: '🎯 Пройти обучение', action: '/онбординг' },
          { label: '❓ Все команды', action: '/помощь' }
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
          const encryptedText = encryptText(welcomeText || '');

          db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
            VALUES (?, 'general', ?, ?, ?)
          `, [messageId, botId, encryptedText, new Date().toISOString()]);
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


        chat = getChatById(chatId);
      }
    } else if (type === 'group') {
      const chatId = uuidv4();
      db.run(`
        INSERT INTO chats (id, type, name, created_by)
        VALUES (?, 'group', ?, ?)
      `, [chatId, name || 'Групповой чат', onlineUser.id]);

      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);

      participants.forEach((pUsername) => {
        const pUser = getUserByUsername(pUsername);
        if (pUser) {
          db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, pUser.id]);
        }
      });


      chat = getChatById(chatId);
    }

    // Отправляем информацию о чате всем участникам
    const chatWithParticipants = getChatWithDetails(chat.id);

    chatWithParticipants.participants.forEach((p) => {
      const pSocket = Array.from(onlineUsers.values()).find((u) => u.username === p.username);
      if (pSocket) {
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
      markDbActivity();
    }

    // Очищаем непрочитанные
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    markDbActivity();

    
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
    const { chatId, text, file, forwardedFrom, replyTo } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser) {
      console.error('[send_message] нет пользователя (onlineUser не найден), socket:', socket.id);
      return;
    }

    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      console.error('[send_message] неверный chatId:', chatId, 'от', onlineUser.username);
      return;
    }

    const chat = getChatById(chatId);
    if (!chat) {
      console.error('[send_message] чат не найден:', chatId, 'от', onlineUser.username);
      return;
    }

    const messageId = uuidv4();
    const fileDataStr = file ? JSON.stringify(file) : null;
    const forwardedFromStr = forwardedFrom ? JSON.stringify(forwardedFrom) : null;
    const replyToStr = replyTo ? JSON.stringify(replyTo) : null;
    const timestamp = new Date().toISOString(); // Используем локальное время клиента

    try {
      // Шифруем текст в JS перед сохранением
      const encryptedText = encryptText(text || '');

      // Вставляем сообщение с временем клиента
      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, file_data, reply_to, timestamp, forwarded_from)
        VALUES (?, ?, ?, ?, ${fileDataStr ? `'${fileDataStr}'` : 'NULL'}, ${replyToStr ? `'${replyToStr.replace(/'/g, "''")}'` : 'NULL'}, ?, ${forwardedFromStr ? `'${forwardedFromStr}'` : 'NULL'})
      `, [messageId, chatId, onlineUser.id, encryptedText, timestamp]);

      // Помечаем активность БД — перезапускает таймер автосохранения
      markDbActivity();

      // Получаем информацию о сообщении
      const msgStmt = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `);
      msgStmt.bind([messageId]);
      let messageRow = null;
      if (msgStmt.step()) {
        const row = msgStmt.getAsObject();
        messageRow = {
          id: String(row['id'] || ''),
          chat_id: String(row['chat_id'] || ''),
          sender_id: String(row['sender_id'] || ''),
          text: decryptText(String(row['text'] || '')),
          file_data: String(row['file_data'] || ''),
          reply_to: row['reply_to'],
          timestamp: String(row['timestamp'] || ''),
          forwarded_from: row['forwarded_from'],
          senderName: String(row['senderName'] || row['username'] || ''),
          senderAvatar: String(row['senderAvatar'] || row['avatar'] || '')
        };
      }
      msgStmt.free();

      if (!messageRow) {
        console.error('[send_message] не удалось получить сообщение после вставки, messageId:', messageId);
        return;
      }

      // Получаем участников чата
      const partStmt = db.prepare(`SELECT user_id FROM chat_participants WHERE chat_id = ?`);
      partStmt.bind([chatId]);
      const participants = [];
      while (partStmt.step()) {
        const row = partStmt.getAsObject();
        participants.push(String(row['user_id'] || ''));
      }
      partStmt.free();

      // Автоматически присоединяем всех онлайн-участников к комнате чата
      participants.forEach((pUserId) => {
        const participantSocket = Array.from(onlineUsers.values()).find((u) => u.id === pUserId);
        if (participantSocket) {
          const sock = io.sockets.sockets.get(participantSocket.socketId);
          if (sock && !sock.rooms.has(chatId)) {
            sock.join(chatId);
          }
        }
      });

      // Добавляем непрочитанные для всех кроме отправителя
      participants.forEach((pUserId) => {
        if (pUserId !== onlineUser.id) {
          const unreadStmt = db.prepare(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`);
          unreadStmt.run(pUserId, messageId, chatId);
          unreadStmt.free();
        }
      });
      markDbActivity();

      // Форматируем сообщение
      const formattedMessage = {
        id: messageRow.id,
        chatId: messageRow.chatId || messageRow.chat_id,
        senderId: messageRow.sender_id,
        senderName: messageRow.senderName,
        senderAvatar: messageRow.senderAvatar,
        text: messageRow.text || '',
        file: messageRow.file_data ? JSON.parse(messageRow.file_data) : null,
        reply_to: messageRow.reply_to ? JSON.parse(messageRow.reply_to) : null,
        timestamp: messageRow.timestamp,
        read_at: messageRow.read_at,
        forwarded_from: messageRow.forwarded_from ? JSON.parse(messageRow.forwarded_from) : null,
        readBy: [onlineUser.username]
      };

      // Присоединяем отправителя к комнате чата если ещё не присоединён
      if (!socket.rooms.has(chatId)) {
        socket.join(chatId);
      }

      // Отправляем сообщение всем в чате (включая отправителя)
      io.to(chatId).emit('new_message', {
        message: formattedMessage,
        chat: { ...chat, unreadCount: 0 }
      });
    
    // ============================================
    // Обработка сообщений для бота-помощника
    // ============================================
    // Проверяем, является ли чат чатом с ботом
    const isBotChat = chatId.startsWith('bot-chat-');

    if (isBotChat && text && !file) {
      // Rate-limiting: 2 секунды между командами на один сокет
      const now = Date.now();
      const lastRequest = botRateLimit.get(socket.id);
      if (lastRequest && now - lastRequest < 2000) {
        sendBotMessage(socket, chatId, '⏳ Пожалуйста, подождите пару секунд перед следующей командой.', []);
        return;
      }
      botRateLimit.set(socket.id, now);

      const command = text.trim().toLowerCase().split(' ')[0];

      // State machine: проверяем контекст разговора
      const stateResult = processConversationState(conversationStates, sendBotMessage, socket.id, text);

      if (stateResult.response !== null) {
        // State machine вернул ответ — отправляем и выходим
        return;
      }

      // Если это команда начала нового диалога (/создать задачу)
      if (isDialogStartCommand(text)) {
        startConversation(conversationStates, sendBotMessage, socket.id);
        botAnalytics.recordCommand('/создать задачу');
        return;
      }

      // Обычные команды с данными
      if (command === '/сегодня') {
        handleTodayCommand({ db, sendBotMessage }, onlineUser, chatId);
        botAnalytics.recordCommand('/сегодня');
        return;
      }

      if (command === '/контакты') {
        handleContactsCommand({ db, sendBotMessage }, chatId);
        botAnalytics.recordCommand('/контакты');
        return;
      }

      // Обычные команды через базу знаний
      const botResponse = getBotResponse(text);

      // Аналитика: если это fallback (ответ по умолчанию) — записываем фразу
      const isFallback = botResponse.text.includes('Я вас не совсем понял');
      if (isFallback) {
        botAnalytics.recordFallback(text);
      } else {
        botAnalytics.recordCommand(command);
      }

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
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      markDbActivity();
      chat = { id: chatId, type: 'direct' };
    } else {
      // Чат найден — используем существующий
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
    const encryptedText = encryptText(originalMessage.text || '');
    const timestamp = new Date().toISOString(); // Используем текущее время клиента

    try {
      db.run(
        `INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newMessageId, chat.id, onlineUser.id, encryptedText, originalMessage.file_data || null, timestamp, JSON.stringify(forwardedFrom)]
      );
      markDbActivity();
    } catch (insertErr) {
      console.error('Ошибка вставки пересланного сообщения:', insertErr.message);
      return;
    }


    // Добавляем непрочитанное для получателя
    db.prepare('INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)')
      .run(targetUserId, newMessageId, chat.id);
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
        text: decryptText(forwardedMessage.text || '') || '',
        file: forwardedMessage.file_data ? JSON.parse(forwardedMessage.file_data) : null,
        timestamp: forwardedMessage.timestamp,
        forwarded_from: forwardedMessage.forwarded_from ? JSON.parse(forwardedMessage.forwarded_from) : null,
        readBy: [onlineUser.username]
      };

      // Уведомляем получателя о новом сообщении
      const targetUser = Array.from(onlineUsers.values()).find(u => u.id === targetUserId);
      if (targetUser) {
        // Отправляем сообщение получателю напрямую
        io.to(targetUser.socketId).emit('new_message', {
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
          io.to(targetUser.socketId).emit('chat_updated', {
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

  // Редактирование сообщения
  socket.on('edit_message', (data) => {
    const { messageId, newText } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !newText) {
      return;
    }

    // Проверяем, что сообщение принадлежит текущему пользователю
    const msgStmt = db.prepare('SELECT sender_id, chat_id, text FROM messages WHERE id = ?');
    msgStmt.bind([messageId]);
    let message = null;
    if (msgStmt.step()) {
      message = msgStmt.getAsObject();
    }
    msgStmt.free();

    if (!message || message.sender_id !== onlineUser.id) {
      console.log(`Пользователь ${onlineUser.username} попытался редактировать чужое сообщение ${messageId}`);
      return;
    }

    // Обновляем текст сообщения
    const editedAt = new Date().toISOString();
    db.run('UPDATE messages SET text = ?, edited = 1, edited_at = ? WHERE id = ?', [newText, editedAt, messageId]);


    console.log(`Сообщение ${messageId} отредактировано пользователем ${onlineUser.username}`);

    // Уведомляем всех участников чата об изменении сообщения
    const chatId = message.chat_id;
    io.to(chatId).emit('message_edited', {
      messageId,
      newText,
      editedBy: onlineUser.id,
      editedAt
    });
  });

  // Удаление сообщения (через правую кнопку мыши)
  socket.on('delete_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || messageId === 'undefined' || messageId === 'null') {
      console.log('Удаление сообщения отменено: нет данных');
      return;
    }

    try {
      // Проверяем, что сообщение принадлежит текущему пользователю или он администратор
      const msgStmt = db.prepare('SELECT sender_id, chat_id FROM messages WHERE id = ?');
      msgStmt.bind([messageId]);
      let message = null;
      if (msgStmt.step()) {
        message = msgStmt.getAsObject();
      }
      msgStmt.free();

      if (!message) {
        console.log(`Сообщение ${messageId} не найдено для удаления`);
        return;
      }

      // Проверяем, что пользователь является автором сообщения или администратором
      const isAuthor = message.sender_id === onlineUser.id;
      
      // Дополнительная проверка - если пользователь администратор (в будущем можно расширить)
      let isAdmin = false;
      if (!isAuthor) {
        // Здесь можно добавить проверку роли пользователя, например:
        // const userStmt = db.prepare('SELECT role FROM users WHERE id = ?');
        // userStmt.bind([onlineUser.id]);
        // if (userStmt.step()) {
        //   const userData = userStmt.getAsObject();
        //   isAdmin = userData.role === 'admin';
        // }
      }

      if (!isAuthor && !isAdmin) {
        console.log(`Пользователь ${onlineUser.username} попытался удалить чужое сообщение ${messageId}`);
        return;
      }

      const chatId = message.chat_id;

      // Удаляем само сообщение из базы данных
      db.run('DELETE FROM messages WHERE id = ?', [messageId]);
      
      // Удаляем все реакции на это сообщение
      db.run('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);
      
      console.log(`Сообщение ${messageId} удалено пользователем ${onlineUser.username}`);

      // Отправляем уведомление всем участникам чата о удалении сообщения
      io.to(chatId).emit('message_deleted', {
        messageId,
        deletedBy: onlineUser.id,
        chatId
      });
    } catch (err) {
      console.error('Ошибка при удалении сообщения:', err);
    }
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
      io.emit('user_status_changed', {
        userId: onlineUser.id,
        username: onlineUser.username,
        status: 'offline'
      });

      onlineUsers.delete(socket.id);
      botRateLimit.delete(socket.id); // Очистка rate-limiting при отключении
      clearConversation(conversationStates, socket.id); // Очистка контекста разговора
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

  // === ЗАКРЕПЛЕНИЕ СООБЩЕНИЙ ===

  // Закрепить сообщение
  socket.on('pin_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение и получаем chat_id
      const msgStmt = db.prepare(`SELECT id, chat_id, sender_id FROM messages WHERE id = ?`);
      msgStmt.bind([messageId]);
      if (!msgStmt.step()) {
        msgStmt.free();
        console.log('Сообщение не найдено для закрепления:', messageId);
        socket.emit('pin_error', { error: 'Сообщение не найдено' });
        return;
      }
      const messageRow = msgStmt.getAsObject();
      msgStmt.free();

      const chatId = messageRow.chat_id;
      const now = new Date().toISOString();

      // Закрепляем сообщение
      db.run('UPDATE messages SET is_pinned = 1, pinned_by = ?, pinned_at = ? WHERE id = ?',
        [onlineUser.id, now, messageId]);
      // Получаем полные данные сообщения для рассылки (с camelCase ключами)
      const fullMsgStmt = db.prepare(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `);
      fullMsgStmt.bind([messageId]);
      let fullMessage = null;
      if (fullMsgStmt.step()) {
        const row = fullMsgStmt.getAsObject();
        fullMessage = {
          id: String(row['id'] || ''),
          chatId: String(row['chat_id'] || ''),
          senderId: String(row['sender_id'] || ''),
          text: decryptText(String(row['text'] || '')),
          file_data: String(row['file_data'] || ''),
          timestamp: String(row['timestamp'] || ''),
          senderName: String(row['sender_name'] || row['username'] || ''),
          senderAvatar: String(row['sender_avatar'] || row['avatar'] || '')
        };
      }
      fullMsgStmt.free();

      if (!fullMessage) {
        console.error('Не удалось получить данные сообщения для закрепления:', messageId);
        socket.emit('pin_error', { error: 'Не удалось закрепить сообщение' });
        return;
      }

      // Уведомляем всех участников чата
      console.log(`📌 Отправляем message_pinned в комнату ${chatId}:`, { chatId, messageId, fullMessageId: fullMessage.id });
      const rooms = io.sockets.adapter.rooms;
      console.log(`📌 Комнат в сокет-адаптере:`, Array.from(rooms.keys()));
      io.to(chatId).emit('message_pinned', {
        chatId,
        messageId,
        message: fullMessage,
        pinnedBy: onlineUser.id,
        pinnedByName: onlineUser.username,
        pinnedAt: now
      });

      console.log(`✅ Сообщение ${messageId} закреплено пользователем ${onlineUser.username}`);
    } catch (err) {
      console.error('Ошибка при закреплении сообщения:', err);
      socket.emit('pin_error', { error: 'Ошибка при закреплении сообщения' });
    }
  });

  // Открепить сообщение
  socket.on('unpin_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение
      const msgStmt = db.prepare(`SELECT id, chat_id FROM messages WHERE id = ?`);
      msgStmt.bind([messageId]);
      if (!msgStmt.step()) {
        msgStmt.free();
        console.log('Сообщение не найдено для открепления:', messageId);
        socket.emit('unpin_error', { error: 'Сообщение не найдено' });
        return;
      }
      const messageRow = msgStmt.getAsObject();
      msgStmt.free();

      const chatId = messageRow.chat_id;

      // Открепляем сообщение
      db.run('UPDATE messages SET is_pinned = 0, pinned_by = NULL, pinned_at = NULL WHERE id = ?',
        [messageId]);
      // Уведомляем всех участников чата
      io.to(chatId).emit('message_unpinned', {
        chatId,
        messageId,
        unpinnedBy: onlineUser.id,
        unpinnedByName: onlineUser.username
      });

      console.log(`Сообщение ${messageId} откреплено пользователем ${onlineUser.username}`);
    } catch (err) {
      console.error('Ошибка при откреплении сообщения:', err);
      socket.emit('unpin_error', { error: 'Ошибка при откреплении сообщения' });
    }
  });

  // Получение закреплённых сообщений для чата
  socket.on('get_pinned_messages', (data) => {
    const { chatId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !chatId) {
      return;
    }

    try {
      const result = db.exec(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chat_id = ? AND m.is_pinned = 1
        ORDER BY m.pinned_at DESC
        LIMIT 50
      `, [chatId]);

      const pinnedMessages = result && result.length > 0 ? result[0].values.map(row => {
        const cols = result[0].columns;
        const obj = {};
        cols.forEach((col, i) => obj[col] = row[i]);
        // Преобразуем snake_case в camelCase для фронтенда
        return {
          id: String(obj['id'] || ''),
          chatId: String(obj['chat_id'] || ''),
          senderId: String(obj['sender_id'] || ''),
          text: decryptText(String(obj['text'] || '')),
          file_data: String(obj['file_data'] || ''),
          timestamp: String(obj['timestamp'] || ''),
          senderName: String(obj['sender_name'] || obj['username'] || ''),
          senderAvatar: String(obj['sender_avatar'] || obj['avatar'] || '')
        };
      }) : [];

      socket.emit('pinned_messages_list', {
        chatId,
        messages: pinnedMessages
      });
    } catch (err) {
      console.error('Ошибка при получении закреплённых сообщений:', err);
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
          const encryptedText = encryptText(reminderText || '');

          db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
            VALUES (?, ?, ?, ?, ?)
          `, [messageId, botChatId, botId, encryptedText, new Date().toISOString()]);
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
    stopAutoSave(); // Останавливаем автосохранение
    if (db) {
      saveDatabaseSync(); // Финальное синхронное сохранение
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

  // State machine + аналитика бота
  const { BotAnalytics } = require('./bot/state');
  conversationStates = new Map();
  botAnalytics = new BotAnalytics();

  // Инициализация бота-помощника (после того как db готов)
  bot = initBotEngine({ db, io, uuidv4, encryptText });
  console.log('🤖 Бот-помощник инициализирован');

  startAutoSave(); // Запускаем автосохранение каждые 30 секунд
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
