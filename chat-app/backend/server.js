const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const webPush = require('web-push');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const cookieParser = require('cookie-parser');

// Загрузка .env файла
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) {}

// VAPID keys for Web Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHOqP4mk3F0J_T0HPrs3KfZINBiqgj--SKHK6axuY8YqMsA6_qOZnD01DS7Ou2KchkUOY51Oz5Fpwk5_oPG9yco';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'y4O_8-8mDdYR4Cw6sUJLKYB9SO2nMxOquGpfyFOqxY0';
webPush.setVapidDetails('mailto:admin@chatursa.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Настройки шифрования для конфиденциальности сообщений
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.error('⚠️  CHAT_ENCRYPTION_KEY не задан в .env! Используется insecure default!');
  console.error('⚠️  Создайте .env файл с CHAT_ENCRYPTION_KEY=<ваш-ключ>');
}
const FALLBACK_KEY = ENCRYPTION_KEY || 'my-super-secret-key-2026';
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
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(FALLBACK_KEY).digest(), iv);
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
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(FALLBACK_KEY).digest(), iv);
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
const LOG_MAX_SIZE = 50 * 1024 * 1024; // ротация при 50MB
const LOG_MAX_FILES = 5;               // хранить до 5 старых логов

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
 * rotateLogFile — ротация лог-файла при превышении LOG_MAX_SIZE.
 * server-runtime.log → server-runtime.1.log → ... → server-runtime.N.log
 */
function rotateLogFile() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_SIZE) return;
    // Удаляем самый старый файл
    const oldest = path.join(__dirname, `server-runtime.${LOG_MAX_FILES}.log`);
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    // Сдвигаем: N → N+1, ... , 1 → 2
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const oldName = path.join(__dirname, `server-runtime.${i}.log`);
      const newName = path.join(__dirname, `server-runtime.${i + 1}.log`);
      if (fs.existsSync(oldName)) fs.renameSync(oldName, newName);
    }
    // Текущий → .1
    fs.renameSync(LOG_FILE, path.join(__dirname, 'server-runtime.1.log'));
  } catch (err) {
    origConsoleError(`[logger] Ошибка ротации лога: ${err.message}`);
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
    rotateLogFile(); // проверяем размер перед записью
    await fs.promises.appendFile(LOG_FILE, data);
  } catch (err) {
    // Если файл-лог недоступен — выводим в консоль как ошибку
      origConsoleError(`[logger] Ошибка записи в лог-файл: ${err.message}`);
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

// Сохраняем оригинальный console.log для sql.js (WASM конфликтует с setImmediate)
const origConsoleLog = console.log.bind(console);
const origConsoleWarn = console.warn.bind(console);
const origConsoleError = console.error.bind(console);

// Переопределяем console.log / console.warn → полностью асинхронный логгер
console.log = (...args) => {
  origConsoleLog(...args);
  logEnqueue('INFO', ...args);
};

console.warn = (...args) => {
  origConsoleWarn(...args);
  logEnqueue('WARN', ...args);
};

// console.error тоже полностью асинхронный
console.error = (...args) => {
  origConsoleError(...args);
  logEnqueue('ERROR', ...args);
};

// Глобальный обработчик unhandledRejection → асинхронный лог + graceful shutdown
process.on('unhandledRejection', (reason, promise) => {
  const reasonStr = reason?.stack || reason;
  origConsoleError('[unhandledRejection]', reasonStr);
  logEnqueue('ERROR', '[unhandledRejection]', reasonStr);
});

// Глобальный обработчик uncaughtException — синхронное исключение, процесс умирает.
// Сохраняем БД + логи, потом выходим.
process.on('uncaughtException', (err) => {
  const errStr = err?.stack || err;
  origConsoleError('[uncaughtException]', errStr);
  logEnqueue('ERROR', '[uncaughtException]', errStr);
  flushLogsSync();
  if (db) {
    try {
      saveDatabaseSync();
    } catch (e) {
      origConsoleError('[uncaughtException] Ошибка сохранения БД:', e);
    }
    try {
      db.close();
    } catch (e) {
      // игнорируем
    }
  }
  process.exit(1);
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

// SSL опции — по умолчанию HTTPS выключен.
// Для включения установите HTTPS_ENABLED=true в .env
// и разместите сертификаты в ssl/server.key и ssl/server.crt (или укажите свои пути)
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, '../../ssl/server.key');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, '../../ssl/server.crt');
let httpsOptions = null;
let useHttps = false;
if (HTTPS_ENABLED) {
  if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
    try {
      httpsOptions = {
        key: fs.readFileSync(SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(SSL_CERT_PATH, 'utf8')
      };
      useHttps = true;
      console.log('SSL сертификаты загружены, включён HTTPS');
    } catch (err) {
      console.error('Ошибка загрузки SSL сертификатов:', err.message);
      console.log('Сервер работает по HTTP');
    }
  } else {
    console.log(`HTTPS_ENABLED=true, но сертификаты не найдены: ${SSL_KEY_PATH}, ${SSL_CERT_PATH}`);
    console.log('Сервер работает по HTTP');
  }
} else {
  console.log('Сервер работает по HTTP (для включения HTTPS установите HTTPS_ENABLED=true)');
}

const server = useHttps ? https.createServer(httpsOptions, app) : http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

startIdleChecker();

let db = null;

// Вспомогательная функция для проверки прав админа
function checkAdmin(userId) {
  try {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
    return row ? row.is_admin === 1 : false;
  } catch (e) {
    console.error('Ошибка проверки прав админа:', e.message);
    return false;
  }
}

// Инициализация базы данных
function initDatabase() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Обёртка совместимости: db.run(sql, params) → db.prepare(sql).run(...params)
  db.run = function(sql, params) {
    if (params) {
      return db.prepare(sql).run(...params);
    }
    return db.prepare(sql).run();
  };

  console.log('База данных загружена (better-sqlite3, WAL mode)');
  console.log(`Путь к БД: ${DB_PATH}`);

  // Создание таблиц
  db.exec(`
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

  // Миграции для добавления колонок
  const migrations = [
    { table: 'users', column: 'mobile_phone', type: 'TEXT' },
    { table: 'users', column: 'work_phone', type: 'TEXT' },
    { table: 'users', column: 'status_text', type: 'TEXT' },
    { table: 'users', column: 'is_admin', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'has_seen_welcome', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'can_book_meeting_room', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'upload_quota', type: 'INTEGER DEFAULT 524288000' },
    { table: 'users', column: 'totp_secret', type: 'TEXT' },
    { table: 'users', column: 'totp_enabled', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'read_at', type: 'TEXT' },
    { table: 'messages', column: 'forwarded_from', type: 'TEXT' },
    { table: 'messages', column: 'reply_to', type: 'TEXT' },
    { table: 'messages', column: 'is_pinned', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'pinned_by', type: 'TEXT' },
    { table: 'messages', column: 'pinned_at', type: 'TEXT' },
    { table: 'messages', column: 'edited', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'edited_at', type: 'TEXT' },
    { table: 'users', column: 'e2ee_public_key', type: 'TEXT' },
    { table: 'messages', column: 'e2ee', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'e2ee_nonce', type: 'TEXT' },
    { table: 'messages', column: 'e2ee_ephemeral', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'task_time', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'task_end_time', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'reminder_time', type: 'TEXT' },
    { table: 'chats', column: 'avatar', type: 'TEXT' },
    { table: 'user_sessions', column: 'last_seen', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'user_device_sessions', column: 'device_id', type: 'TEXT' },
    { table: 'user_device_sessions', column: 'device_name', type: 'TEXT DEFAULT \'\'' },
    { table: 'user_device_sessions', column: 'ip_address', type: 'TEXT DEFAULT \'\'' },
    { table: 'user_device_sessions', column: 'socket_ids', type: 'TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'user_device_sessions', column: 'login_time', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'user_device_sessions', column: 'last_seen', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'user_device_sessions', column: 'is_current', type: 'INTEGER DEFAULT 0' }
  ];

  migrations.forEach(({ table, column, type }) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Колонка уже существует
    }
  });

  // Таблица сессий для восстановления после рестарта (legacy, per-user)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id TEXT PRIMARY KEY,
      socket_ids TEXT NOT NULL DEFAULT '[]',
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Таблица устройств/сессий (multi-device support, per-device)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_device_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      socket_ids TEXT NOT NULL DEFAULT '[]',
      login_time TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      is_current INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Таблица бронирования переговорной
  db.exec(`
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
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      task_date TEXT NOT NULL,
      task_time TEXT,
      task_end_time TEXT,
      color TEXT DEFAULT '#667eea',
      reminder_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_user ON calendar_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_date ON calendar_tasks(task_date);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('general', 'direct', 'group')),
      name TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id)
    );

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

    CREATE TABLE IF NOT EXISTS unread_messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      socket_id TEXT,
      ip_address TEXT,
      browser TEXT,
      login_time TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS ui_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

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
  const generalChat = db.prepare("SELECT id FROM chats WHERE id = ?").get('general');
  if (!generalChat) {
    db.prepare("INSERT INTO chats (id, type, name, created_by) VALUES (?, 'general', 'Общий чат', 'system')").run('general');
  }

  // Создание помощника если не существует
  const botCheck = db.prepare("SELECT id FROM users WHERE username = ?").get('Помощник');
  if (!botCheck) {
    const botId = 'helper-bot-' + uuidv4().substring(0, 8);
    db.prepare("INSERT INTO users (id, username, avatar, status, is_admin) VALUES (?, ?, ?, 'online', 0)").run(botId, 'Помощник', `${SERVER_URL}/uploads/ursa.jpg`);
    console.log('Создан помощник');
  }

  // Установим админа для Root
  try {
    db.prepare("UPDATE users SET is_admin = 1 WHERE username = ?").run('Root');
  } catch (e) {
    // Пользователь ещё не создан
  }

  // Миграции данных
  try {
    db.exec("UPDATE users SET mobile_phone = NULL WHERE TRIM(mobile_phone) = '' OR mobile_phone = ' '");
    db.exec("UPDATE users SET work_phone = NULL WHERE TRIM(work_phone) = '' OR work_phone = ' '");
    console.log('Миграция телефонов выполнена');
  } catch (e) { /* игнорируем */ }

  try {
    db.exec("UPDATE chats SET name = 'Помощник' WHERE name = '🤖 Помощник'");
    console.log('Миграция имени помощника выполнена');
  } catch (e) { /* игнорируем */ }

  // Миграция: добавляем socket_ids если колонка отсутствует (обратная совместимость)
  try {
    db.exec('ALTER TABLE user_sessions ADD COLUMN socket_ids TEXT NOT NULL DEFAULT \'[]\'');
  } catch (e) {
    // Колонка уже существует
  }

  console.log('База данных инициализирована');
}

// Сохранение базы данных (better-sqlite3 в WAL mode сохраняет автоматически)
function markDbActivity() {
  // better-sqlite3 в WAL mode не нуждается в ручном сохранении
}

function saveDatabaseSync() {
  // better-sqlite3 синхронизирует данные через WAL, но для гарантии вызываем checkpoint
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // игнорируем
    }
  }
}

// ============================================
// Автоматическое резервное копирование БД
// ============================================

const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL || '60', 10) * 60 * 1000; // мс
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const BACKUP_RETENTION = parseInt(process.env.BACKUP_RETENTION || '24', 10);

function performBackup() {
  if (!db || !BACKUP_ENABLED) return;

  try {
    // Создаём папку если нет
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // Делаем checkpoint WAL перед копированием
    db.pragma('wal_checkpoint(PASSIVE)');

    // Формируем имя файла: chat-backup-YYYY-MM-DD-HHmmss.db
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const backupFile = path.join(BACKUP_DIR, `chat-backup-${ts}.db`);

    // Копируем файл БД
    fs.copyFileSync(DB_PATH, backupFile);

    // Копируем WAL и SHM если существуют
    const walPath = DB_PATH + '-wal';
    const shmPath = DB_PATH + '-shm';
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, backupFile + '-wal');
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, backupFile + '-shm');
    }

    console.log(`✅ Резервная копия: ${backupFile} (${(fs.statSync(backupFile).size / 1024 / 1024).toFixed(2)} MB)`);

    // Ротация: удаляем старые бэкапы, оставляя только BACKUP_RETENTION последних
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('chat-backup-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (files.length > BACKUP_RETENTION) {
      const toDelete = files.slice(BACKUP_RETENTION);
      for (const file of toDelete) {
        const basePath = path.join(BACKUP_DIR, file.name);
        fs.unlinkSync(basePath);
        // Удаляем сопутствующие WAL/SHM
        try { fs.unlinkSync(basePath + '-wal'); } catch {}
        try { fs.unlinkSync(basePath + '-shm'); } catch {}
        console.log(`🗑️ Удалён старый бэкап: ${file.name}`);
      }
    }
  } catch (err) {
    console.error('❌ Ошибка резервного копирования:', err.message);
  }
}

function startBackupScheduler() {
  if (!BACKUP_ENABLED) {
    console.log('⏭️ Резервное копирование отключено (BACKUP_ENABLED=false)');
    return;
  }

  // Выполняем первый бэкап через 30 секунд после старта сервера
  setTimeout(() => {
    performBackup();
    // Затем по расписанию
    setInterval(performBackup, BACKUP_INTERVAL);
    console.log(`💾 Авто-бэкап запущен: каждые ${BACKUP_INTERVAL / 60000} мин, хранить ${BACKUP_RETENTION} копий`);
  }, 30000);
}

// Проверка бездействия: раз в 30 секунд ищем пользователей, неактивных >10 минут
function startIdleChecker() {
  setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 минут
    for (const [socketId, user] of onlineUsers.entries()) {
      if (user.status !== 'online') continue;
      const lastActive = userActivity.get(user.id);
      if (lastActive && (now - lastActive) > timeout) {
        user.status = 'idle';
        onlineUsers.set(socketId, { ...user, status: 'idle' });
        io.emit('user_status_changed', {
          userId: user.id,
          username: user.username,
          status: 'idle'
        });
        console.log(`${user.username} переведён в idle`);
      }
    }
  }, 30000);
}

// Хранилище онлайн пользователей в памяти
const onlineUsers = new Map(); // socketId -> { id, username, socketId, status }

// Обратный индекс: userId -> Set<socketId> (один пользователь на нескольких вкладках/устройствах)
const userSocketMap = new Map(); // userId -> Set<socketId>

// Возвращает ВСЕ socketId для userId (multi-device support)
function getUserSockets(userId) {
  const sockets = userSocketMap.get(userId);
  if (!sockets) return [];
  return Array.from(sockets);
}

// Отправляет событие ВСЕМ сокетам пользователя
function emitToUser(userId, event, data) {
  const socketIds = getUserSockets(userId);
  socketIds.forEach(sid => io.to(sid).emit(event, data));
}

// Время последней активности каждого пользователя (userId -> timestamp)
const userActivity = new Map();

// Общий объём загруженных файлов на пользователя (userId -> bytes)
const userTotalUploadSize = new Map(); // загружается из БД при старте
const DEFAULT_UPLOAD_QUOTA = 500 * 1024 * 1024; // 500MB

// Rate-limiting для бота-помощника: 2 секунды между командами на один сокет
const botRateLimit = new Map(); // socketId -> timestamp последнего запроса

// State machine — контекст разговора с ботом (socketId -> ConversationState)
let conversationStates; // будет инициализирован в initDatabase().then()

// Аналитика использования бота
let botAnalytics; // будет инициализирован в initDatabase().then()

// Rate-limiting для регистрации и входа
const registerAttempts = new Map();
const loginAttempts = new Map();

function checkRateLimit(map, key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry) {
    map.set(key, { count: 1, startTime: now });
    return true;
  }

  if (entry.blockedUntil) {
    if (now < entry.blockedUntil) return false;
    // Разблокируем по истечении времени
    entry.blockedUntil = null;
    entry.count = 1;
    entry.startTime = now;
    return true;
  }

  if (now - entry.startTime > windowMs) {
    map.set(key, { count: 1, startTime: now });
    return true;
  }

  if (entry.count > maxAttempts) {
    entry.blockedUntil = now + windowMs;
    return false;
  }

  entry.count++;
  return true;
}

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

// Принудительный редирект HTTP → HTTPS (код 301)
app.use((req, res, next) => {
  if (useHttps && !req.secure && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Helmet с настройками, совместимыми с WebSocket и стикерами
const PROTOCOL = useHttps ? 'https' : 'http';
const WS_PROTOCOL = useHttps ? 'wss:' : 'ws:';
const CSP_ORIGINS = process.env.CHAT_APP_SERVER_URL || `${PROTOCOL}://localhost:${PORT}`;
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://ui-avatars.com', 'https://cdn.jsdelivr.net', CSP_ORIGINS],
      connectSrc: ["'self'", WS_PROTOCOL, 'wss:', 'https://api.github.com', CSP_ORIGINS, 'capacitor://localhost', `${PROTOCOL}://localhost`],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      mediaSrc: ["'self'", CSP_ORIGINS],
      workerSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// HSTS (HTTP Strict Transport Security)
app.use((req, res, next) => {
  if (useHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// Дополнительные заголовки безопасности
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS — разрешаем только наш фронтенд
const ALLOWED_ORIGINS = [CSP_ORIGINS, `${PROTOCOL}://localhost:3000`, `${PROTOCOL}://localhost:3001`, 'capacitor://localhost', `${PROTOCOL}://localhost`]; 
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://192.168.') || origin.startsWith('https://192.168.') || origin.startsWith('capacitor://')) return cb(null, true);
    cb(null, true); // в локальной сети разрешаем все
  },
  credentials: true
}));

// Cookie parser для CSRF
app.use(cookieParser());

// CSRF защита: генерация токена (опционально для SPA с токеновой аутентификацией)
const csrfTokens = new Set();
app.get('/api/csrf-token', (req, res) => {
  const token = uuidv4();
  csrfTokens.add(token);
  if (csrfTokens.size > 1000) csrfTokens.clear();
  res.cookie('X-CSRF-Token', token, { httpOnly: true, sameSite: 'strict', maxAge: 3600000, secure: useHttps });
  res.json({ csrfToken: token });
});

// Общий rate-limiter для всех API-эндпоинтов: 100 запросов/мин на IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api/', apiLimiter);

// Регистрируем MIME-тип для .avif (стикеры)
express.static.mime.define({ 'image/avif': ['avif'] });
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/stickers', express.static(path.join(__dirname, '../frontend/build/stickers')));
app.use(express.static(path.join(__dirname, '../frontend/build')));

// ============================================
// API для проверки версии и обновлений
// ============================================

// Получение текущей версии приложения из package.json
app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    res.json({ version: pkg.version || '1.0.0' });
  } catch (err) {
    res.json({ version: '1.0.0' });
  }
});

// Проверка новой версии на GitHub
app.get('/api/check-update', async (req, res) => {
  try {
    const response = await fetch('https://api.github.com/repos/AmiD4567/chatursa/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'chat-app'
      }
    });
    if (!response.ok) {
      return res.json({ hasUpdate: false, error: 'GitHub API error' });
    }
    const data = await response.json();
    const latestTag = data.tag_name || '';
    // tag_name может быть "v1.2.3" или "1.2.3"
    const latestVersion = latestTag.replace(/^v/i, '');

    // Получаем текущую версию
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const currentVersion = pkg.version || '1.0.0';

    // Сравниваем версии
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    res.json({
      hasUpdate,
      currentVersion,
      latestVersion,
      latestTag,
      releaseUrl: data.html_url || `https://github.com/AmiD4567/chatursa/releases/tag/${latestTag}`,
      publishedAt: data.published_at,
      releaseName: data.name || latestTag
    });
  } catch (err) {
    res.json({ hasUpdate: false, error: err.message });
  }
});

// Простое сравнение семантических версий
function compareVersions(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

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

  const userList = db.prepare('SELECT id, username, email, full_name, status, is_admin, created_at, last_seen, host, ip_address, can_book_meeting_room FROM users ORDER BY username').all().map(row => ({
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
    can_book_meeting_room: row.can_book_meeting_room || 0
  }));

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
      FROM user_sessions s
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
    const filesList = db.prepare(`
      SELECT id, file_data, timestamp
      FROM messages
      WHERE file_data IS NOT NULL
      ORDER BY timestamp DESC
    `).all().map(row => {
      const fileData = JSON.parse(row.file_data);
      return {
        id: row.id,
        name: fileData.name || 'Без имени',
        url: fileData.url || '',
        size: fileData.size || 0,
        mime_type: fileData.mimetype || '',
        created_at: row.timestamp
      };
    });

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
app.post('/api/register', (req, res) => {
  const { username, email, password, confirmPassword, birthDate } = req.body;

  if (!username || !email || !password || !birthDate) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  // Rate limiting: не более 3 регистраций в час с одного IP
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(registerAttempts, clientIp, 3, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много попыток регистрации. Попробуйте позже.' });
  }

  // Проверка совпадения паролей
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
  }

  // Проверка сложности пароля
  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов, одну заглавную букву, одну цифру и один спецсимвол' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  // Проверка существующего пользователя
  const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR LOWER(email) = ?').get(username, emailLower);
  if (existingUser) {
    return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
  }

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

  // Rate limiting: не более 10 попыток за 15 минут с одного IP
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(loginAttempts, clientIp, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте позже.' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(emailLower);
  if (!user) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  
  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  // Проверка 2FA (TOTP) для админов
  if (user.totp_enabled) {
    const { totpCode } = req.body;
    if (!totpCode) {
      return res.json({ success: true, require2FA: true, userId: user.id, message: 'Введите код из аутентификатора' });
    }
    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });
    if (!verified) {
      return res.status(401).json({ error: 'Неверный код аутентификатора' });
    }
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
  const user = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text, is_admin FROM users WHERE id = ?').get(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

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
  const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existingUser) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  try {
    // Получаем текущие номера из БД, если они не были переданы
    let finalMobilePhone = safeMobilePhone;
    let finalWorkPhone = safeWorkPhone;
    
    if (safeMobilePhone === undefined) {
      const currentRow = db.prepare('SELECT mobile_phone FROM users WHERE id = ?').get(userId);
      if (currentRow) {
        finalMobilePhone = currentRow.mobile_phone;
      }
    }
    
    if (safeWorkPhone === undefined) {
      const currentRow = db.prepare('SELECT work_phone FROM users WHERE id = ?').get(userId);
      if (currentRow) {
        finalWorkPhone = currentRow.work_phone;
      }
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


    const updatedUser = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text FROM users WHERE id = ?').get(userId);

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

// ============================================
// E2EE API
// ============================================

// Получение публичного ключа E2EE пользователя
app.get('/api/e2ee/key/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  try {
    const row = db.prepare('SELECT e2ee_public_key FROM users WHERE id = ?').get(userId);
    if (row && row.e2ee_public_key) {
      res.json({ publicKey: row.e2ee_public_key });
    } else {
      res.status(404).json({ error: 'Ключ не найден' });
    }
  } catch (err) {
    console.error('Ошибка получения E2EE ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка публичного ключа E2EE
app.put('/api/e2ee/key', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!userId || !publicKey) {
    return res.status(400).json({ error: 'userId и publicKey обязательны' });
  }

  try {
    db.run('UPDATE users SET e2ee_public_key = ? WHERE id = ?', [publicKey, userId]);
    console.log(`[E2EE] Ключ сохранён для пользователя ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения E2EE ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Проверка, есть ли у пользователя E2EE ключ
app.get('/api/e2ee/status/:userId', (req, res) => {
  const { userId } = req.params;
  try {
    const row = db.prepare('SELECT e2ee_public_key FROM users WHERE id = ?').get(userId);
    res.json({ hasKey: !!(row && row.e2ee_public_key) });
  } catch (err) {
    res.json({ hasKey: false });
  }
});

// Получение списка активных сессий пользователя (multi-device)
app.get('/api/sessions/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const rows = db.prepare(`
      SELECT id, device_id, device_name, ip_address, login_time, last_seen, is_current,
             json_array_length(socket_ids) as socket_count
      FROM user_device_sessions WHERE user_id = ?
      ORDER BY last_seen DESC
    `).all(userId);
    res.json({ sessions: rows.map(r => ({ ...r, socket_count: Number(r.socket_count || 0) })) });
  } catch (err) {
    console.error('Ошибка получения сессий:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Принудительное завершение сессии (logout device)
app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { userId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId обязателен' });
  try {
    const session = db.prepare('SELECT * FROM user_device_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
    if (userId && session.user_id !== userId) return res.status(403).json({ error: 'Нет доступа' });
    if (session.is_current) return res.status(400).json({ error: 'Нельзя завершить текущую сессию' });

    // Отключаем все сокеты этой сессии
    let devSockets = [];
    try { devSockets = JSON.parse(session.socket_ids); } catch {}
    devSockets.forEach(sid => {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.disconnect(true);
    });

    db.run('DELETE FROM user_device_sessions WHERE id = ?', [sessionId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления сессии:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
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
  const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  const isAdmin = userRow ? userRow.is_admin === 1 : false;

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
  const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  const isAdmin = userRow ? userRow.is_admin === 1 : false;

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

// Белый список MIME-типов для загрузки
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
  'application/pdf', 'application/zip', 'application/x-rar-compressed',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/json'
];

// Минимальное свободное место на диске для загрузок (500MB)
const MIN_DISK_SPACE = 500 * 1024 * 1024;

function checkDiskSpace() {
  try {
    const stats = fs.statfsSync(UPLOADS_PATH);
    return stats.bfree * stats.bsize >= MIN_DISK_SPACE;
  } catch {
    // Если не удалось проверить — пропускаем проверку
    return true;
  }
}

// API для загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  // Проверка MIME-типа
  if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    // Удаляем загруженный файл
    fs.unlink(req.file.path, () => {});
    return res.status(415).json({ error: `Недопустимый тип файла: ${req.file.mimetype}` });
  }

  // Проверка свободного места
  if (!checkDiskSpace()) {
    fs.unlink(req.file.path, () => {});
    return res.status(507).json({ error: 'Недостаточно места на диске' });
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

// Кэш поиска оригинальных имён файлов по UUID (макс. 1000 записей)
const filenameCache = new Map(); // uuid -> originalFilename
const FILENAME_CACHE_MAX = 1000;

function trimFilenameCache() {
  if (filenameCache.size >= FILENAME_CACHE_MAX) {
    // Удаляем половину старых записей
    const keysToDelete = [...filenameCache.keys()].slice(0, FILENAME_CACHE_MAX / 2);
    for (const key of keysToDelete) filenameCache.delete(key);
  }
}

function findOriginalFilenameByUuid(uuid) {
  // Проверяем кэш
  if (filenameCache.has(uuid)) return filenameCache.get(uuid);

  try {
    const fileDataRows = db.prepare('SELECT file_data FROM messages WHERE file_data IS NOT NULL').all();
    for (const row of fileDataRows) {
      const fd = row.file_data;
      if (fd && typeof fd === 'string') {
        try {
          const parsed = JSON.parse(fd);
          if (parsed && parsed.url) {
            const urlFilename = parsed.url.split('/').pop();
            if (urlFilename === uuid) {
              trimFilenameCache();
              filenameCache.set(uuid, parsed.filename);
              return parsed.filename;
            }
          }
        } catch (e) {
          // skip invalid JSON
        }
      }
    }
  } catch (err) {
    console.error('Ошибка поиска оригинального имени файла:', err);
  }

  trimFilenameCache();
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

  const tasks = db.prepare(query).all(params);

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

  const bookings = db.prepare(query).all(params);

  res.json({ bookings });
});

// Создать бронирование переговорной
app.post('/api/meeting-room/bookings', (req, res) => {
  const { organizerId, organizerName, title, description, meetingDate, startTime, endTime } = req.body;

  if (!organizerId || !title || !meetingDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'organizerId, title, meetingDate, startTime и endTime обязательны' });
  }

  // Проверка права на бронирование
  const userCheck = db.prepare('SELECT can_book_meeting_room, username FROM users WHERE id = ?').get(organizerId);
  if (!userCheck) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const canBook = userCheck.can_book_meeting_room === 1 || userCheck.username === 'Root';
  if (!canBook) {
    return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
  }

  // Проверка пересечений по времени
  const overlapCheck = db.prepare(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = ? AND (
      (start_time < ? AND end_time > ?)
    )
  `).get(meetingDate, endTime, startTime);
  
  if (overlapCheck) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  try {
    const insertResult = db.run(`
      INSERT INTO meeting_room_bookings (organizer_id, organizer_name, title, description, meeting_date, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [organizerId, organizerName || 'Аноним', title, description || null, meetingDate, startTime, endTime]);
    
    const newId = insertResult.lastInsertRowid;
    
    const newBooking = db.prepare('SELECT * FROM meeting_room_bookings WHERE id = ?').get(newId);
    
    res.json({ 
      success: true, 
      booking: newBooking ? {
        id: newBooking.id,
        title: newBooking.title,
        description: newBooking.description,
        meeting_date: newBooking.meeting_date,
        start_time: newBooking.start_time,
        end_time: newBooking.end_time,
        organizer_id: newBooking.organizer_id,
        organizer_name: newBooking.organizer_name
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
    const userCheck = db.prepare('SELECT can_book_meeting_room, username FROM users WHERE id = ?').get(organizerId);
    if (!userCheck) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const canBook = userCheck.can_book_meeting_room === 1 || userCheck.username === 'Root';
    if (!canBook) {
      return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
    }
  }

  // Проверка пересечений по времени (исключая текущее бронирование)
  const overlapCheck = db.prepare(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = ? AND id != ? AND (
      (start_time < ? AND end_time > ?)
    )
  `).get(meetingDate, id, endTime, startTime);
  
  if (overlapCheck) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  try {
    db.run(`
      UPDATE meeting_room_bookings 
      SET title = ?, description = ?, meeting_date = ?, start_time = ?, end_time = ?
      WHERE id = ?
    `, [title, description || null, meetingDate, startTime, endTime, id]);
    
    const updatedBooking = db.prepare('SELECT * FROM meeting_room_bookings WHERE id = ?').get(id);
    
    res.json({ 
      success: true, 
      booking: updatedBooking ? {
        id: updatedBooking.id,
        title: updatedBooking.title,
        description: updatedBooking.description,
        meeting_date: updatedBooking.meeting_date,
        start_time: updatedBooking.start_time,
        end_time: updatedBooking.end_time,
        organizer_id: updatedBooking.organizer_id,
        organizer_name: updatedBooking.organizer_name
      } : null
    });
  } catch (err) {
    console.error('Ошибка обновления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для создания задачи
app.post('/api/calendar/tasks', (req, res) => {
  const { userId, title, description, taskDate, taskTime, taskEndTime, color, reminderType } = req.body;

  if (!userId || !title || !taskDate) {
    return res.status(400).json({ error: 'userId, title и taskDate обязательны' });
  }

  const taskId = uuidv4();

  try {
    // Рассчитываем время напоминания если выбран reminderType
    let reminderTime = null;
    if (reminderType && reminderType !== 'none') {
      const baseDate = new Date(`${taskDate}${taskTime ? 'T' + taskTime : 'T09:00'}`);

      // Получаем имя пользователя для логирования
      const user = getUserById(userId);

      if (reminderType === '1h') {
        reminderTime = new Date(baseDate.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '3h') {
        reminderTime = new Date(baseDate.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '6h') {
        reminderTime = new Date(baseDate.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === 'custom' && req.body.reminderCustomTime) {
        // reminderCustomTime — строка времени HH:MM
        reminderTime = `${taskDate}T${req.body.reminderCustomTime}:00`;
      }

      if (reminderTime && user) {
        scheduleTaskReminder(taskId, userId, user.username, title, taskDate, taskTime || null, reminderTime);
      }
    }

    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, task_end_time, color, reminder_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [taskId, userId, title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', reminderTime]);


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
  const { title, description, taskDate, taskTime, taskEndTime, color, reminderType, reminderCustomTime } = req.body;

  if (!title || !taskDate) {
    return res.status(400).json({ error: 'title и taskDate обязательны' });
  }

  try {
    // Получаем текущую задачу для расчёта напоминания
    const existingTask = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    let reminderTime = null;

    if (reminderType && reminderType !== 'none' && existingTask) {
      const baseDate = new Date(`${taskDate}${taskTime ? 'T' + taskTime : 'T09:00'}`);
      const user = getUserById(existingTask.user_id);

      if (reminderType === '1h') {
        reminderTime = new Date(baseDate.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '3h') {
        reminderTime = new Date(baseDate.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '6h') {
        reminderTime = new Date(baseDate.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === 'custom' && reminderCustomTime) {
        reminderTime = `${taskDate}T${reminderCustomTime}:00`;
      }

      if (reminderTime && user) {
        scheduleTaskReminder(taskId, existingTask.user_id, user.username, title, taskDate, taskTime || null, reminderTime);
      }
    } else if (reminderType === 'none') {
      // Убираем напоминание
      pendingReminders.delete(taskId);
    }

    db.run(`
      UPDATE calendar_tasks
      SET title = ?, description = ?, task_date = ?, task_time = ?, task_end_time = ?, color = ?, reminder_time = ?
      WHERE id = ?
    `, [title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', reminderTime, taskId]);


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

    // Отменяем запланированное напоминание если есть
    const oldTimeout = pendingReminders.get(taskId);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
      pendingReminders.delete(taskId);
    }


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
    const users = db.prepare('SELECT id, username, avatar FROM users').all();
    res.json({ users });
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

// ============================================
// Web Push API для push-уведомлений
// ============================================

// Получение VAPID public key
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Сохранение подписки на push-уведомления
app.post('/api/push/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'userId и subscription обязательны' });
  }
  try {
    const id = uuidv4();
    db.run('INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString()]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения push-подписки:', err);
    res.status(500).json({ error: 'Ошибка сохранения подписки' });
  }
});

// Удаление подписки на push-уведомления
app.delete('/api/push/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });
  try {
    db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления push-подписки:', err);
    res.status(500).json({ error: 'Ошибка удаления подписки' });
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

      // Уведомляем получателя о новой общей задаче через WebSocket
      const recipientEntry = Array.from(onlineUsers.entries()).find(([sid, u]) => u.id === toUserId);
      if (recipientEntry) {
        io.to(recipientEntry[0]).emit('shared_task_received', {
          shareId,
          task_id: taskId,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          task_date: task.task_date,
          task_time: task.task_time,
          color: task.color || '#667eea'
        });
      }
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
    const rows = db.prepare(`
      SELECT ts.*, ct.title, ct.description, ct.task_date, ct.task_time, ct.color,
             u.username as from_username, u.avatar as from_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.from_user_id = u.id
      WHERE ts.to_user_id = ?
      ORDER BY ts.created_at DESC
    `).all(userId);

    const shares = rows.map(row => ({
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
    }));

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
    const rows = db.prepare(`
      SELECT ts.*, ct.title, ct.task_date,
             u.username as to_username, u.avatar as to_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.to_user_id = u.id
      WHERE ts.from_user_id = ?
      ORDER BY ts.created_at DESC
    `).all(userId);

    const shares = rows.map(row => ({
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
    }));

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

  if (!shareId || !userId) {
    return res.status(400).json({ error: 'shareId и userId обязательны' });
  }

  try {
    // Используем прямой запрос вместо prepared statement
    const share = db.prepare('SELECT * FROM task_shares WHERE id = ?').get(shareId);
    
    if (!share) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (share.to_user_id !== userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const originalTask = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(share.task_id);
    
    if (!originalTask) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

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
    
    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, values);


    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['accepted', shareId]);


    // Уведомляем о принятии задачи (отправителю и получателю)
    io.emit('shared_task_accepted', { shareId, user_id: userId, new_task_id: newTaskId });

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


    // Уведомляем об отклонении задачи
    io.emit('shared_task_declined', { shareId, user_id: userId });

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
    const rows = db.prepare(`
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.read_at,
             m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral,
             u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.timestamp ASC
    `).all(chatId);

    const messages = rows.map(row => {
      const isE2EE = row.e2ee === 1 || row.e2ee === true;
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
        text: isE2EE ? (row.text || '') : (decryptText(row.text) || ''),
        file: file,
        reply_to: row.reply_to ? (() => { try { return JSON.parse(row.reply_to); } catch { return null; } })() : null,
        timestamp: row.timestamp,
        read_at: row.read_at || null,
        senderName: row.senderName,
        senderAvatar: row.senderAvatar,
        e2ee: isE2EE ? 1 : 0,
        e2ee_nonce: isE2EE ? (row.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: isE2EE ? (row.e2ee_ephemeral || '') : undefined
      };
    });

    const replyCounts = {};
    for (const msg of messages) {
      if (msg.reply_to && msg.reply_to.messageId) {
        replyCounts[msg.reply_to.messageId] = (replyCounts[msg.reply_to.messageId] || 0) + 1;
      }
    }
    for (const msg of messages) {
      msg.replyCount = replyCounts[msg.id] || 0;
    }

    res.json({ messages });
  } catch (err) {
    console.error('Ошибка загрузки сообщений:', err);
    res.status(500).json({ error: 'Ошибка при загрузке сообщений' });
  }
});

// API для отправки сообщения (через REST, для тредов)
app.post('/api/messages', (req, res) => {
  const { chatId, senderId, text, replyTo } = req.body;
  if (!chatId || !senderId || !text) {
    return res.status(400).json({ error: 'chatId, senderId и text обязательны' });
  }

  const messageId = uuidv4();
  const timestamp = new Date().toISOString();
  const replyToStr = replyTo ? JSON.stringify(replyTo) : null;

  try {
    db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, text, reply_to, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, chatId, senderId, text, replyToStr, timestamp);

    const messageRow = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);

    const newMessage = {
      id: messageRow.id,
      chatId: messageRow.chat_id,
      senderId: messageRow.sender_id,
      senderName: messageRow.senderName,
      senderAvatar: messageRow.senderAvatar,
      text: messageRow.text || '',
      file: null,
      reply_to: messageRow.reply_to ? JSON.parse(messageRow.reply_to) : null,
      replyCount: 0,
      timestamp: messageRow.timestamp,
      read_at: null,
      readBy: [],
      edited: false,
      reactions: undefined
    };

    io.to(chatId).emit('new_message', {
      message: newMessage,
      chat: { id: chatId, unreadCount: 0 }
    });

    res.json({ success: true, message: newMessage });
  } catch (err) {
    console.error('Ошибка отправки сообщения:', err);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

// API для получения сообщений треда (все ответы на конкретное сообщение)
app.get('/api/thread/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { userId } = req.query;

  if (!messageId || !userId) {
    return res.status(400).json({ error: 'messageId и userId обязательны' });
  }

  try {
    const original = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);

    if (!original) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    const replies = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ? AND m.reply_to IS NOT NULL AND m.id != ?
      ORDER BY m.timestamp ASC
    `).all(original.chat_id, messageId);

    const threadReplies = replies.filter(r => {
      try {
        const rt = JSON.parse(r.reply_to);
        return rt.messageId === messageId;
      } catch { return false; }
    }).map(row => {
      const rIsE2EE = row.e2ee === 1 || row.e2ee === true;
      return {
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        senderName: row.senderName,
        senderAvatar: row.senderAvatar,
        text: rIsE2EE ? (row.text || '') : (decryptText(row.text) || ''),
        file: row.file_data ? (() => { try { return JSON.parse(row.file_data); } catch { return null; } })() : null,
        timestamp: row.timestamp,
        reply_to: row.reply_to ? (() => { try { return JSON.parse(row.reply_to); } catch { return null; } })() : null,
        edited: row.edited === 1 || row.edited === true,
        editedAt: row.edited_at || null,
        e2ee: rIsE2EE ? 1 : 0,
        e2ee_nonce: rIsE2EE ? (row.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: rIsE2EE ? (row.e2ee_ephemeral || '') : undefined
      };
    });

    const oIsE2EE = original.e2ee === 1 || original.e2ee === true;
    res.json({
      original: {
        id: original.id,
        chatId: original.chat_id,
        senderId: original.sender_id,
        senderName: original.senderName,
        senderAvatar: original.senderAvatar,
        text: oIsE2EE ? (original.text || '') : (decryptText(original.text) || ''),
        file: original.file_data ? (() => { try { return JSON.parse(original.file_data); } catch { return null; } })() : null,
        timestamp: original.timestamp,
        edited: original.edited === 1 || original.edited === true,
        editedAt: original.edited_at || null,
        e2ee: oIsE2EE ? 1 : 0,
        e2ee_nonce: oIsE2EE ? (original.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: oIsE2EE ? (original.e2ee_ephemeral || '') : undefined
      },
      replies: threadReplies
    });
  } catch (err) {
    console.error('Ошибка загрузки треда:', err);
    res.status(500).json({ error: 'Ошибка при загрузке треда' });
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
    const originalMsg = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);
    
    if (!originalMsg) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

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
// API для извлечения превью ссылок (Open Graph)
// ============================================

/**
 * Извлекает Open Graph метаданные из HTML страницы.
 * Использует regex-парсинг вместо тяжёлых библиотек для минимальных зависимостей.
 */
function extractOpenGraph(html, url) {
  const result = {};

  // og:title
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (titleMatch) result.title = titleMatch[1];

  // og:description
  const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) result.description = descMatch[1];

  // og:image
  const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (imageMatch) result.image = imageMatch[1];

  // og:url
  const urlMatch = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  if (urlMatch) result.ogUrl = urlMatch[1];

  // twitter:card
  const cardMatch = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i);
  if (cardMatch) result.cardType = cardMatch[1];

  // twitter:title (fallback)
  if (!result.title) {
    const twTitle = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
    if (twTitle) result.title = twTitle[1];
  }

  // twitter:description (fallback)
  if (!result.description) {
    const twDesc = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
    if (twDesc) result.description = twDesc[1];
  }

  // twitter:image (fallback)
  if (!result.image) {
    const twImage = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (twImage) result.image = twImage[1];
  }

  // <title> tag as last fallback for title
  if (!result.title) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) result.title = titleTag[1].trim();
  }

  // Extract domain and build favicon URL
  try {
    const parsedUrl = new URL(url);
    result.domain = parsedUrl.hostname;
    result.favicon = `${parsedUrl.protocol}//${parsedUrl.hostname}/favicon.ico`;
  } catch {
    result.domain = url;
  }

  return result;
}

/**
 * Fetches HTML from a URL using http/https with timeout.
 */
function fetchHtml(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: timeoutMs }, (res) => {
      // Follow redirects manually up to 3 times
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectCount = 0;
        const followRedirect = (redirectUrl) => {
          redirectCount++;
          if (redirectCount > 3) return reject(new Error('Too many redirects'));
          fetchHtml(redirectUrl, timeoutMs).then(resolve).catch(reject);
        };

        // Handle relative redirects
        let location = res.headers.location;
        if (!location.startsWith('http')) {
          try {
            location = new URL(location, url).href;
          } catch {
            return reject(new Error('Invalid redirect URL'));
          }
        }
        followRedirect(location);
        return;
      }

      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => resolve(html));
      res.on('error', reject);
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
    request.on('error', reject);
  });
}

// GET /api/link-preview?url=...
const linkPreviewCache = new Map();
const LINK_PREVIEW_CACHE_TTL = 60 * 60 * 1000; // 1 час

app.get('/api/link-preview', async (req, res) => {
  const rawUrl = (req.query.url || '').trim();

  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate URL format
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(url.protocol)) {
    return res.status(400).json({ error: 'Only http and https protocols allowed' });
  }

  // Проверка кэша
  const cacheKey = rawUrl.toLowerCase();
  if (linkPreviewCache.has(cacheKey)) {
    const cached = linkPreviewCache.get(cacheKey);
    if (Date.now() - cached.ts < LINK_PREVIEW_CACHE_TTL) {
      return res.json(cached.data);
    }
    linkPreviewCache.delete(cacheKey);
  }

  try {
    const html = await fetchHtml(rawUrl, 5000);
    const preview = extractOpenGraph(html, rawUrl);

    // Normalize image URL (handle relative URLs)
    if (preview.image && !preview.image.startsWith('http')) {
      try {
        preview.image = new URL(preview.image, url).href;
      } catch { /* keep as-is */ }
    }

    const responseData = { success: true, ...preview };
    linkPreviewCache.set(cacheKey, { ts: Date.now(), data: responseData });
    res.json(responseData);
  } catch (err) {
    console.warn(`Link preview failed for ${rawUrl}:`, err.message);
    // Return minimal preview from the URL itself
    let domain = '';
    try { domain = new URL(rawUrl).hostname; } catch {}
    res.json({ success: false, title: domain || rawUrl, url: rawUrl });
  }
});

// ============================================
// Health check endpoint
// ============================================

const startTime = Date.now();

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  let dbSize = 0;
  try {
    if (fs.existsSync(DB_PATH)) dbSize = fs.statSync(DB_PATH).size;
  } catch {}
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '2.0.0',
    usersOnline: onlineUsers.size,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    },
    dbSize,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// API для бота-помощника
// ============================================

// Статистика пользователя
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
    const row = db.prepare('SELECT id, username, email, avatar, status, status_text FROM users WHERE id = ?').get(id);
    if (row) {
      return {
        id: String(row.id || ''),
        username: String(row.username || ''),
        email: String(row.email || ''),
        avatar: String(row.avatar || ''),
        status: String(row.status || 'offline'),
        status_text: row.status_text || ''
      };
    }
    return null;
  } catch (e) {
    console.error('Ошибка получения пользователя по ID:', e.message);
    return null;
  }
}

function getUserByUsername(username) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row || null;
}

function getChatById(chatId) {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  return row || null;
}

// Получение чата между двумя пользователями
function getDirectChatBetweenUsers(userId1, userId2) {
  const row = db.prepare(`
    SELECT c.id, c.type FROM chats c
    JOIN chat_participants cp1 ON c.id = cp1.chat_id
    JOIN chat_participants cp2 ON c.id = cp2.chat_id
    WHERE c.type = 'direct'
      AND cp1.user_id = ? AND cp2.user_id = ?
  `).get(userId1, userId2);
  if (row) {
    return { 
      id: String(row.id || ''), 
      type: String(row.type || 'direct') 
    };
  }
  return null;
}

function getChatWithDetails(chatId, userId = null) {
  const chat = getChatById(chatId);
  if (!chat) return null;

  // Получаем участников с полными данными
  const participantsRows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.status, u.status_text
    FROM users u
    JOIN chat_participants cp ON u.id = cp.user_id
    WHERE cp.chat_id = ?
  `).all(chatId);
  const participants = participantsRows.map(row => ({
    id: String(row.id || ''),
    username: String(row.username || ''),
    avatar: String(row.avatar || ''),
    status: String(row.status || 'offline'),
    status_text: row.status_text || ''
  }));

  // Получаем непрочитанные
  let unreadCount = 0;
  if (userId) {
    const unreadRow = db.prepare('SELECT COUNT(*) as count FROM unread_messages WHERE user_id = ? AND chat_id = ?').get(userId, chatId);
    if (unreadRow) {
      unreadCount = Number(unreadRow.count || 0);
    }
  }

  // Получаем последнее сообщение с аватаром
  const msg = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.timestamp DESC
    LIMIT 1
  `).get(chatId);
  let lastMessage = null;
  if (msg) {
    lastMessage = {
      text: String(msg.text || (msg.file_data ? '📎 Файл' : '')),
      timestamp: String(msg.timestamp || ''),
      senderName: String(msg.senderName || ''),
      senderAvatar: String(msg.senderAvatar || '')
    };
  }

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
  const chats = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM unread_messages WHERE chat_id = c.id AND user_id = ?) as unreadCount,
           (SELECT MAX(timestamp) FROM messages WHERE chat_id = c.id) as last_msg_time
    FROM chats c
    JOIN chat_participants cp ON c.id = cp.chat_id
    WHERE cp.user_id = ?
    ORDER BY last_msg_time DESC, c.created_at DESC
  `).all(userId, userId);
  
  return chats.map(chat => {
    // Получаем участников с полными данными
    const participants = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.status, u.status_text, u.full_name, u.birth_date, u.position
      FROM users u
      JOIN chat_participants cp ON u.id = cp.user_id
      WHERE cp.chat_id = ?
    `).all(chat.id);

    // Получаем последнее сообщение с аватаром отправителя
    const msg = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.timestamp DESC
      LIMIT 1
    `).get(chat.id);
    let lastMessage = null;
    if (msg) {
      const msgIsE2EE = msg.e2ee === 1 || msg.e2ee === true;
    lastMessage = {
        text: msgIsE2EE ? '🔒 Encrypted message' : (decryptText(msg.text) || (msg.file_data ? '📎 Файл' : '')),
        timestamp: msg.timestamp,
        senderName: msg.senderName,
        senderAvatar: msg.senderAvatar
      };
    }

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
    const messagesReversed = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(chatId, limit);

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
      const reactionRows = db.prepare(`
        SELECT mr.emoji, mr.user_id, u.username, u.avatar
        FROM message_reactions mr
        JOIN users u ON mr.user_id = u.id
        WHERE mr.message_id = ?
      `).all(row.id);
      const reactions = {};
      for (const reactionRow of reactionRows) {
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

      const isE2EE = row.e2ee === 1 || row.e2ee === true;
      messages.push({
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        senderName: row.senderName,
        senderAvatar: row.senderAvatar,
        text: isE2EE ? (row.text || '') : (decryptText(row.text) || ''),
        file: row.file_data && !isBotMessage ? (() => { try { return JSON.parse(row.file_data); } catch { return null; } })() : null,
        reply_to: row.reply_to ? (() => { try { return JSON.parse(row.reply_to); } catch { return null; } })() : null,
        timestamp: row.timestamp,
        read_at: row.read_at,
        forwarded_from: row.forwarded_from ? (() => { try { return JSON.parse(row.forwarded_from); } catch { return null; } })() : null,
        readBy: [],
        buttons: buttons,
        isBotMessage: isBotMessage,
        edited: row.edited === 1 || row.edited === true,
        editedAt: row.edited_at || null,
        reactions: Object.keys(reactions).length > 0 ? reactions : undefined,
        e2ee: isE2EE ? 1 : 0,
        e2ee_nonce: isE2EE ? (row.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: isE2EE ? (row.e2ee_ephemeral || '') : undefined
      });
    }
    const replyCounts = {};
    for (const msg of messages) {
      if (msg.reply_to && msg.reply_to.messageId) {
        replyCounts[msg.reply_to.messageId] = (replyCounts[msg.reply_to.messageId] || 0) + 1;
      }
    }
    for (const msg of messages) {
      msg.replyCount = replyCounts[msg.id] || 0;
    }
    return messages;
  } catch (e) {
    console.error('Ошибка получения сообщений чата:', e.message);
    return [];
  }
}

function getAllUsers() {
  return db.prepare('SELECT id, username, avatar, status, full_name, birth_date, work_phone, mobile_phone, status_text, about FROM users').all();
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
// Отправка push-уведомления пользователю
function sendPushNotification(userId, title, body, icon, data) {
  try {
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
    for (const sub of subs) {
      const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      webPush.sendNotification(pushSub, JSON.stringify({ title, body, icon, data, tag: 'chat-message' }))
        .catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
          }
        });
    }
  } catch (err) {
    console.error('Ошибка отправки push-уведомления:', err.message);
  }
}

// WebSocket rate-limiter: не более N событий в секунду на сокет
const WS_RATE_LIMIT = 30; // макс. событий в секунду
const wsRateMap = new Map(); // socketId -> { count, resetAt }

function checkWsRateLimit(socketId) {
  const now = Date.now();
  let entry = wsRateMap.get(socketId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + 1000 };
    wsRateMap.set(socketId, entry);
    return true;
  }
  entry.count++;
  if (entry.count > WS_RATE_LIMIT) {
    return false;
  }
  return true;
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

  // Пользователь присоединяется (первичное подключение с данными из localStorage)
  // Сервер ищет пользователя в БД по userId и добавляет в onlineUsers.
  // socket.id используется как ключ в onlineUsers Map.
  // Поддерживается несколько сокетов на одного пользователя (несколько вкладок).
  socket.on('user_joined', (data) => {
    const { userId, email, username, deviceId, deviceName } = data || {};

    if (!userId && !email && !username) {
      console.error('user_joined: нет userId/email/username');
      return;
    }

    // Ищем пользователя в БД
    try {
      let user = null;

      // Пытаемся найти пользователя по userId
      if (userId) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE id = ?').get(userId);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      // Если не нашли по userId, ищем по email
      if (!user && email) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE email = ?').get(email);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      // Если не нашли, ищем по username
      if (!user && username) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE username = ?').get(username);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      if (!user) {
        console.error('user_joined: пользователь не найден в БД', { userId, email, username });
        return;
      }

      // Добавляем сокет в onlineUsers (не удаляем старые — поддерживаем несколько вкладок)
      onlineUsers.set(socket.id, {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        socketId: socket.id,
        status: 'online'
      });

      // Добавляем в userSocketMap
      if (!userSocketMap.has(user.id)) {
        userSocketMap.set(user.id, new Set());
      }
      userSocketMap.get(user.id).add(socket.id);

      // Сохраняем сессию в БД (legacy)
      try {
        const existingRow = db.prepare('SELECT socket_ids FROM user_sessions WHERE user_id = ?').get(user.id);
        let sockets = [];
        if (existingRow) {
          try { sockets = JSON.parse(existingRow.socket_ids); } catch {}
        }
        if (!sockets.includes(socket.id)) sockets.push(socket.id);
        db.run('INSERT OR REPLACE INTO user_sessions (user_id, socket_ids, last_seen) VALUES (?, ?, ?)',
          [user.id, JSON.stringify(sockets), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения сессии:', e.message);
      }

      // Сохраняем устройство/сессию (multi-device)
      const resolvedDeviceId = deviceId || `unknown-${socket.id}`;
      const resolvedDeviceName = deviceName || 'Unknown Device';
      const clientIp = socket.handshake?.address || '';
      try {
        const existingDevice = db.prepare('SELECT id, socket_ids FROM user_device_sessions WHERE user_id = ? AND device_id = ?').get(user.id, resolvedDeviceId);
        if (existingDevice) {
          let devSockets = [];
          try { devSockets = JSON.parse(existingDevice.socket_ids); } catch {}
          if (!devSockets.includes(socket.id)) devSockets.push(socket.id);
          db.run('UPDATE user_device_sessions SET socket_ids = ?, last_seen = ?, is_current = 1 WHERE id = ?',
            [JSON.stringify(devSockets), new Date().toISOString(), existingDevice.id]);
        } else {
          const sessionId = uuidv4();
          db.run(`INSERT INTO user_device_sessions (id, user_id, device_id, device_name, ip_address, socket_ids, login_time, last_seen, is_current)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sessionId, user.id, resolvedDeviceId, resolvedDeviceName, clientIp, JSON.stringify([socket.id]), new Date().toISOString(), new Date().toISOString()]);
        }
      } catch (e) {
        console.error('Ошибка сохранения устройства:', e.message);
      }

      // Обновляем статус в БД
      db.run('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
      markDbActivity();

      // Отправляем пользователю его чаты
      let userChats = getUserChats(user.id);

      // Создаём чат с помощником если не существует
      const botRow = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
      const botId = botRow ? botRow.id : null;
      const botChatId = `bot-chat-${user.id}`;
      const botChatCheck = db.prepare('SELECT * FROM chats WHERE id = ?').get(botChatId);
      if (!botChatCheck) {
        db.run(`INSERT INTO chats (id, type, name, created_by, created_at) VALUES (?, 'direct', 'Помощник', ?, CURRENT_TIMESTAMP)`, [botChatId, user.id]);
        db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, user.id]);
        if (botId) {
          db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, botId]);
        }
        markDbActivity();
        userChats = getUserChats(user.id);
      }

      socket.emit('user_joined_success', {
        user: { id: user.id, username: user.username, avatar: user.avatar, userId: user.id },
        chats: userChats
      });

      // Уведомляем остальных
      socket.broadcast.emit('user_status_changed', {
        userId: user.id,
        username: user.username,
        status: 'online'
      });
    } catch (err) {
      console.error('user_joined error:', err);
    }
  });

  // Пользователь присоединяется (альтернативный путь: через /api/login → join)
  socket.on('join', (data) => {
    const { username, userId: existingUserId } = data;

    let user = null;

    // Проверяем, есть ли уже пользователь в onlineUsers (от user_joined) — если да, не перезаписываем
    const existingEntry = onlineUsers.get(socket.id);
    if (!existingEntry || existingEntry.id === 'pending' || !userActivity.has(existingEntry.id)) {
      // Нет записи или временная — добавляем temp-запись ЧТОБЫ НЕ ПОТЕРЯТЬ пользователя при быстрых запросах
      const tempAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
      onlineUsers.set(socket.id, {
        id: existingUserId || 'pending',
        username: username,
        avatar: tempAvatar,
        socketId: socket.id,
        status: 'online'
      });
    }

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

    // Обновляем данные в onlineUsers (теперь с реальным ID из БД)
    if (user) {
      onlineUsers.set(socket.id, {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        socketId: socket.id,
        status: 'online'
      });
      userActivity.set(user.id, Date.now());
    }

    // Добавляем пользователя в общий чат если еще не там
    const inGeneralChat = db.prepare("SELECT * FROM chat_participants WHERE chat_id = 'general' AND user_id = ?").get(user.id);

    if (!inGeneralChat) {
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', ['general', user.id]);
    }

    // Автоматически присоединяем к комнате общего чата
    socket.join('general');

    // Получаем список чатов пользователя
    let userChats = getUserChats(user.id);

    // Создаём чат с помощником если не существует
    const botRow = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
    const botId = botRow ? botRow.id : null;
    const botChatId = `bot-chat-${user.id}`;
    const botChatCheck = db.prepare('SELECT * FROM chats WHERE id = ?').get(botChatId);
    if (!botChatCheck) {
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
    const userWelcomeCheck = db.prepare('SELECT has_seen_welcome FROM users WHERE id = ?').get(user.id);
    const hasSeenWelcome = userWelcomeCheck && userWelcomeCheck.has_seen_welcome === 1;
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
        const botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
        if (botResult) {
          const botId = botResult.id;
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
      chat = db.prepare(`
        SELECT c.* FROM chats c
        JOIN chat_participants cp1 ON c.id = cp1.chat_id
        JOIN chat_participants cp2 ON c.id = cp2.chat_id
        WHERE c.type = 'direct'
        AND cp1.user_id = ? AND cp2.user_id = ?
      `).get(onlineUser.id, targetUser.id);

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

    // Отправляем информацию о чате всем участникам (все сессии)
    const chatWithParticipants = getChatWithDetails(chat.id);

    if (chatWithParticipants.participantsDetails) {
      chatWithParticipants.participantsDetails.forEach((participant) => {
        emitToUser(participant.id, 'chat_created', { chat: chatWithParticipants });
      });
    }

    // Также отправляем создателю через его текущий сокет (чтобы сразу присоединиться к комнате)
    socket.emit('chat_created', { chat: chatWithParticipants });
  });

  // Присоединение к чату
  socket.on('join_chat', (chatId) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    
    socket.join(chatId);
    
    // Проверяем, является ли пользователь участником
    const isParticipant = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, onlineUser.id);
    
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

  // Возвращает отображаемое имя чата (для direct — имя собеседника)
  function getChatDisplayName(chat) {
    if (!chat) return 'Чат';
    if (chat.type !== 'direct' && chat.name) return chat.name;
    if (chat.participantsDetails && chat.participantsDetails.length > 0) {
      return chat.participantsDetails[0].username || 'Чат';
    }
    if (chat.participants && chat.participants.length > 0) {
      return chat.participants[0] || 'Чат';
    }
    return chat.name || 'Чат';
  }

  // Отправка сообщения
  socket.on('send_message', (data) => {
    if (!checkWsRateLimit(socket.id)) {
      socket.emit('error', { message: 'Слишком много запросов. Подождите.' });
      return;
    }
    const { chatId, text, file, forwardedFrom, replyTo, e2ee, e2ee_nonce, e2ee_ephemeral } = data;
    let onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser) {
      console.error('[send_message] нет пользователя (onlineUser не найден), socket:', socket.id);
      // Пытаемся восстановить из localStorage данных сокета
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

    // Проверка квоты загрузок
    if (file && file.size) {
      const currentTotal = userTotalUploadSize.get(onlineUser.id) || 0;
      const quota = DEFAULT_UPLOAD_QUOTA;
      if (currentTotal + Number(file.size) > quota) {
        console.warn(`[send_message] Квота превышена для ${onlineUser.username}: ${currentTotal}/${quota}`);
        socket.emit('upload_error', { error: 'Превышена квота загрузок (500MB)', code: 'QUOTA_EXCEEDED' });
        return;
      }
    }

    const messageId = uuidv4();
    const fileDataStr = file ? JSON.stringify(file) : null;
    const forwardedFromStr = forwardedFrom ? JSON.stringify(forwardedFrom) : null;
    const replyToStr = replyTo ? JSON.stringify(replyTo) : null;
    const timestamp = new Date().toISOString(); // Используем локальное время клиента

    try {
      let storedText, storedE2EE, storedNonce, storedEphemeral;

      if (e2ee) {
        // E2EE: храним ciphertext как есть (сервер не расшифровывает)
        storedText = text || '';
        storedE2EE = 1;
        storedNonce = e2ee_nonce || null;
        storedEphemeral = e2ee_ephemeral || null;
      } else {
        // Обычное серверное шифрование
        storedText = encryptText(text || '');
        storedE2EE = 0;
        storedNonce = null;
        storedEphemeral = null;
      }

      // Вставляем сообщение с временем клиента
      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, file_data, reply_to, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral)
        VALUES (?, ?, ?, ?, ${fileDataStr ? `'${fileDataStr}'` : 'NULL'}, ${replyToStr ? `'${replyToStr.replace(/'/g, "''")}'` : 'NULL'}, ?, ${forwardedFromStr ? `'${forwardedFromStr}'` : 'NULL'}, ?, ?, ?)
      `, [messageId, chatId, onlineUser.id, storedText, timestamp, storedE2EE, storedNonce, storedEphemeral]);

      // Помечаем активность БД — перезапускает таймер автосохранения
      markDbActivity();

      // Получаем информацию о сообщении
      const msgRow = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,
               m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(messageId);
      let messageRow = null;
      if (msgRow) {
        const isE2EE = msgRow.e2ee === 1 || msgRow.e2ee === true;
        messageRow = {
          id: String(msgRow.id || ''),
          chat_id: String(msgRow.chat_id || ''),
          sender_id: String(msgRow.sender_id || ''),
          text: isE2EE ? String(msgRow.text || '') : decryptText(String(msgRow.text || '')),
          file_data: String(msgRow.file_data || ''),
          reply_to: msgRow.reply_to,
          timestamp: String(msgRow.timestamp || ''),
          forwarded_from: msgRow.forwarded_from,
          senderName: String(msgRow.senderName || msgRow.username || ''),
          senderAvatar: String(msgRow.senderAvatar || msgRow.avatar || ''),
          e2ee: isE2EE ? 1 : 0,
          e2ee_nonce: isE2EE ? String(msgRow.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: isE2EE ? String(msgRow.e2ee_ephemeral || '') : undefined
        };
      }

      if (!messageRow) {
        console.error('[send_message] не удалось получить сообщение после вставки, messageId:', messageId);
        return;
      }

      // Получаем участников чата
      const partRows = db.prepare('SELECT user_id FROM chat_participants WHERE chat_id = ?').all(chatId);
      const participants = partRows.map(row => String(row.user_id || ''));

      // Автоматически присоединяем все сессии участников к комнате чата
      participants.forEach((pUserId) => {
        const socketIds = getUserSockets(pUserId);
        socketIds.forEach((sid) => {
          const sock = io.sockets.sockets.get(sid);
          if (sock && !sock.rooms.has(chatId)) {
            sock.join(chatId);
          }
        });
      });

      // Добавляем непрочитанные для всех кроме отправителя
      participants.forEach((pUserId) => {
        if (pUserId !== onlineUser.id) {
          db.prepare('INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)').run(pUserId, messageId, chatId);
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
        replyCount: 0,
        timestamp: messageRow.timestamp,
        read_at: messageRow.read_at,
        forwarded_from: messageRow.forwarded_from ? JSON.parse(messageRow.forwarded_from) : null,
        readBy: [onlineUser.username],
        e2ee: messageRow.e2ee || 0,
        e2ee_nonce: messageRow.e2ee_nonce,
        e2ee_ephemeral: messageRow.e2ee_ephemeral
      };

      // Обновляем квоту загрузок
      if (file && file.size) {
        const currentTotal = userTotalUploadSize.get(onlineUser.id) || 0;
        userTotalUploadSize.set(onlineUser.id, currentTotal + Number(file.size));
      }

      // Присоединяем отправителя к комнате чата если ещё не присоединён
      if (!socket.rooms.has(chatId)) {
        socket.join(chatId);
      }

      // Отправляем сообщение всем в чате (включая отправителя)
      io.to(chatId).emit('new_message', {
        message: formattedMessage,
        chat: { ...chat, unreadCount: 0 }
      });

      // Push-уведомления для офлайн-участников
      const onlineUserIds = new Set(Array.from(onlineUsers.values()).map(u => u.id));
      const chatName = getChatDisplayName ? getChatDisplayName(chat) : (chat.name || 'Чат');
      participants.forEach(pUserId => {
        if (pUserId !== onlineUser.id && !onlineUserIds.has(pUserId)) {
          sendPushNotification(pUserId, chatName, formattedMessage.text || '📎 Файл', formattedMessage.senderAvatar, { chatId, messageId });
        }
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

    if (!onlineUser || !messageId || !targetUserId) {
      return;
    }

    // Получаем исходное сообщение
    const msgRow = db.prepare(`
      SELECT id, chat_id, sender_id,
             COALESCE(text, '') as text,
             COALESCE(file_data, '') as file_data,
             timestamp, forwarded_from,
             e2ee, e2ee_nonce, e2ee_ephemeral
      FROM messages
      WHERE id = ?
    `).get(messageId);
    let originalMessage = null;
    if (msgRow) {
      originalMessage = {
        id: String(msgRow.id || ''),
        chat_id: String(msgRow.chat_id || ''),
        sender_id: String(msgRow.sender_id || ''),
        text: String(msgRow.text || ''),
        file_data: String(msgRow.file_data || ''),
        timestamp: String(msgRow.timestamp || ''),
        e2ee: msgRow.e2ee,
        e2ee_nonce: msgRow.e2ee_nonce,
        e2ee_ephemeral: msgRow.e2ee_ephemeral
      };
    }

    if (!originalMessage || !originalMessage.sender_id) {
      return;
    }

    // Получаем или создаём чат между отправителем и получателем
    let chat = getDirectChatBetweenUsers(onlineUser.id, targetUserId);

    if (!chat) {
      // Создаём новый чат
      const chatId = uuidv4();
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      markDbActivity();
      chat = { id: chatId, type: 'direct' };
    }

    if (!chat || !chat.id) {
      return;
    }

    if (!originalMessage.sender_id) {
      return;
    }

    // Создаём пересланное сообщение
    const newMessageId = uuidv4();
    
    // Получаем отправителя оригинального сообщения
    let senderUsername = 'Unknown';
    try {
      const sender = getUserById(originalMessage.sender_id);
      senderUsername = sender ? sender.username : 'Unknown';
    } catch (e) {
      console.error('Ошибка получения отправителя:', e.message);
    }
    
    const forwardedFrom = {
      message_id: originalMessage.id,
      sender_id: originalMessage.sender_id,
      sender_name: senderUsername
    };

    if (!chat.id) {
      return;
    }

    // Подготавливаем значения
    const isForwardE2EE = originalMessage.e2ee === 1 || originalMessage.e2ee === true;
    const timestamp = new Date().toISOString(); // Используем текущее время клиента
    let forwardText, forwardE2EE, forwardNonce, forwardEphemeral;

    if (isForwardE2EE) {
      forwardText = originalMessage.text || '';
      forwardE2EE = 1;
      forwardNonce = originalMessage.e2ee_nonce || null;
      forwardEphemeral = originalMessage.e2ee_ephemeral || null;
    } else {
      forwardText = encryptText(originalMessage.text || '');
      forwardE2EE = 0;
      forwardNonce = null;
      forwardEphemeral = null;
    }

    try {
      db.run(
        `INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newMessageId, chat.id, onlineUser.id, forwardText, originalMessage.file_data || null, timestamp, JSON.stringify(forwardedFrom), forwardE2EE, forwardNonce, forwardEphemeral]
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
               m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(newMessageId);

      if (!forwardedMessage) return;

      const fwdIsE2EE = forwardedMessage.e2ee === 1 || forwardedMessage.e2ee === true;
      const formattedMessage = {
        id: forwardedMessage.id,
        chatId: forwardedMessage.chat_id,
        senderId: forwardedMessage.sender_id,
        senderName: forwardedMessage.senderName,
        senderAvatar: forwardedMessage.senderAvatar,
        text: fwdIsE2EE ? (forwardedMessage.text || '') : (decryptText(forwardedMessage.text || '') || ''),
        file: forwardedMessage.file_data ? JSON.parse(forwardedMessage.file_data) : null,
        timestamp: forwardedMessage.timestamp,
        forwarded_from: forwardedMessage.forwarded_from ? JSON.parse(forwardedMessage.forwarded_from) : null,
        readBy: [onlineUser.username],
        e2ee: fwdIsE2EE ? 1 : 0,
        e2ee_nonce: fwdIsE2EE ? (forwardedMessage.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: fwdIsE2EE ? (forwardedMessage.e2ee_ephemeral || '') : undefined
      };

      // Уведомляем получателя о новом сообщении
      // Отправляем сообщение получателю (все сессии)
      emitToUser(targetUserId, 'new_message', {
        message: formattedMessage,
        chat: { id: chat.id, type: chat.type, unreadCount: 1 }
      });

      // Отправляем обновление чата получателю (все сессии)
      const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
      if (chatWithUnread) {
        emitToUser(targetUserId, 'chat_updated', {
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

      // Отправляем обновление чата отправителю
      const senderChatWithUnread = getChatWithDetails(chat.id, onlineUser.id);
      if (senderChatWithUnread) {
        socket.emit('chat_updated', {
          chatId: chat.id,
          chat: senderChatWithUnread
        });
      }

  });

  // Редактирование сообщения
  socket.on('edit_message', (data) => {
    const { messageId, newText, e2ee, e2ee_nonce } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !newText) {
      return;
    }

    // Проверяем, что сообщение принадлежит текущему пользователю
    const message = db.prepare('SELECT sender_id, chat_id, text, e2ee FROM messages WHERE id = ?').get(messageId);

    if (!message || message.sender_id !== onlineUser.id) {
      return;
    }

    // Обновляем текст сообщения (и нонс для E2EE)
    const isEditE2EE = e2ee || (message.e2ee === 1 || message.e2ee === true);
    const editedAt = new Date().toISOString();
    let storedEditText, storedNonce;
    if (isEditE2EE) {
      storedEditText = newText;
      storedNonce = e2ee_nonce || null;
    } else {
      storedEditText = encryptText(newText);
      storedNonce = null;
    }
    db.run('UPDATE messages SET text = ?, edited = 1, edited_at = ?, e2ee_nonce = COALESCE(?, e2ee_nonce) WHERE id = ?',
      [storedEditText, editedAt, storedNonce, messageId]);

    // Уведомляем всех участников чата об изменении сообщения
    const chatId = message.chat_id;
    io.to(chatId).emit('message_edited', {
      messageId,
      newText: storedEditText,
      editedBy: onlineUser.id,
      editedAt,
      e2ee: isEditE2EE ? 1 : 0,
      e2ee_nonce: storedNonce
    });
  });

  // Удаление сообщения (через правую кнопку мыши)
  socket.on('delete_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || messageId === 'undefined' || messageId === 'null') {
      return;
    }

    try {
      // Проверяем, что сообщение принадлежит текущему пользователю или он администратор
      const message = db.prepare('SELECT sender_id, chat_id FROM messages WHERE id = ?').get(messageId);

      if (!message) {
        return;
      }

      // Проверяем, что пользователь является автором сообщения или администратором
      const isAuthor = message.sender_id === onlineUser.id;

      if (!isAuthor) {
        return;
      }

      const chatId = message.chat_id;

      // Удаляем само сообщение из базы данных
      db.run('DELETE FROM messages WHERE id = ?', [messageId]);

      // Удаляем все реакции на это сообщение
      db.run('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);

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

  // Активность пользователя (сбрасывает idle-таймер)
  socket.on('user_activity', () => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    userActivity.set(onlineUser.id, Date.now());
    if (onlineUser.status === 'idle') {
      onlineUser.status = 'online';
      onlineUsers.set(socket.id, { ...onlineUser });
      io.emit('user_status_changed', {
        userId: onlineUser.id,
        username: onlineUser.username,
        status: 'online'
      });
    }
  });

  // Получение списка пользователей
  socket.on('get_users', () => {
    const allUsers = getAllUsers();

    // Обновляем статусы онлайн
    const onlineUserMap = {};
    for (const [sId, u] of onlineUsers.entries()) {
      onlineUserMap[u.id] = u.status || 'online';
    }
    const usersWithStatus = allUsers.map(u => ({
      ...u,
      status: onlineUserMap[u.id] || 'offline'
    }));

    socket.emit('users_list', usersWithStatus);
  });

  // Статус пользователя (печатает...)
  socket.on('typing', (data) => {
    if (!checkWsRateLimit(socket.id)) return;
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    const { chatId, isTyping } = data;
    if (!chatId) return;

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
    


    // Уведомляем отправителей о прочтении (все сессии)
    const senderRows = db.prepare(`
      SELECT DISTINCT sender_id FROM messages WHERE chat_id = ? AND sender_id != ?
    `).all(chatId, onlineUser.id);
    const senderIds = senderRows.map(row => row.sender_id);

    senderIds.forEach(senderId => {
      emitToUser(senderId, 'messages_read', {
        chatId,
        readBy: onlineUser.id,
        readAt: now
      });
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    wsRateMap.delete(socket.id);
    const onlineUser = onlineUsers.get(socket.id);
    if (onlineUser) {
      // Удаляем из userSocketMap
      const userSockets = userSocketMap.get(onlineUser.id);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) userSocketMap.delete(onlineUser.id);
      }

      // Обновляем сессию в БД (legacy)
      try {
        const existingRow = db.prepare('SELECT socket_ids FROM user_sessions WHERE user_id = ?').get(onlineUser.id);
        if (existingRow) {
          let sockets = [];
          try { sockets = JSON.parse(existingRow.socket_ids); } catch {}
          sockets = sockets.filter(sid => sid !== socket.id);
          if (sockets.length > 0) {
            db.run('INSERT OR REPLACE INTO user_sessions (user_id, socket_ids, last_seen) VALUES (?, ?, ?)',
              [onlineUser.id, JSON.stringify(sockets), new Date().toISOString()]);
          } else {
            db.run('DELETE FROM user_sessions WHERE user_id = ?', [onlineUser.id]);
          }
        }
      } catch (e) {
        console.error('Ошибка обновления сессии при отключении:', e.message);
      }

      // Обновляем устройство (удаляем socket.id из device_sessions)
      try {
        const deviceRows = db.prepare('SELECT id, device_id, socket_ids FROM user_device_sessions WHERE user_id = ?').all(onlineUser.id);
        for (const dev of deviceRows) {
          let devSockets = [];
          try { devSockets = JSON.parse(dev.socket_ids); } catch {}
          const filtered = devSockets.filter(sid => sid !== socket.id);
          if (filtered.length === 0) {
            db.run('DELETE FROM user_device_sessions WHERE id = ?', [dev.id]);
          } else {
            db.run('UPDATE user_device_sessions SET socket_ids = ?, last_seen = ? WHERE id = ?',
              [JSON.stringify(filtered), new Date().toISOString(), dev.id]);
          }
        }
      } catch (e) {
        console.error('Ошибка обновления устройства при отключении:', e.message);
      }

      // Проверяем, есть ли у пользователя другие активные сокеты
      const remainingSockets = userSocketMap.get(onlineUser.id);
      if (!remainingSockets || remainingSockets.size === 0) {
        db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['offline', onlineUser.id]);
        io.emit('user_status_changed', {
          userId: onlineUser.id,
          username: onlineUser.username,
          status: 'offline'
        });
        userActivity.delete(onlineUser.id);
      }

      onlineUsers.delete(socket.id);
      botRateLimit.delete(socket.id); // Очистка rate-limiting при отключении
      clearConversation(conversationStates, socket.id); // Очистка контекста разговора
    }
  });

  // === ОБРАБОТКА РЕАКЦИЙ ===
  
  // Добавление реакции
  socket.on('add_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение и получаем chat_id
      const messageRow = db.prepare('SELECT id, chat_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        return;
      }

      const chatId = messageRow.chat_id;

      if (!chatId) {
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

      // Уведомляем всех в чате о добавлении реакции с аватаркой
      io.to(chatId).emit('reaction_added', {
        messageId,
        emoji,
        userId: onlineUser.id,
        username: onlineUser.username,
        avatar: onlineUser.avatar
      });

    } catch (err) {
      console.error('Ошибка при добавлении реакции:', err);
    }
  });

  // Удаление реакции
  socket.on('remove_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      return;
    }

    try {
      // Получаем chat_id сообщения
      const messageData = db.prepare('SELECT chat_id FROM messages WHERE id = ?').get(messageId);

      if (!messageData) {
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
      const messageRow = db.prepare('SELECT id, chat_id, sender_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        socket.emit('pin_error', { error: 'Сообщение не найдено' });
        return;
      }

      const chatId = messageRow.chat_id;
      const now = new Date().toISOString();

      // Закрепляем сообщение
      db.run('UPDATE messages SET is_pinned = 1, pinned_by = ?, pinned_at = ? WHERE id = ?',
        [onlineUser.id, now, messageId]);
      // Получаем полные данные сообщения для рассылки (с camelCase ключами)
      const row = db.prepare(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(messageId);
      let fullMessage = null;
      if (row) {
        const pinIsE2EE = row.e2ee === 1 || row.e2ee === true;
        fullMessage = {
          id: String(row.id || ''),
          chatId: String(row.chat_id || ''),
          senderId: String(row.sender_id || ''),
          text: pinIsE2EE ? String(row.text || '') : decryptText(String(row.text || '')),
          file_data: String(row.file_data || ''),
          timestamp: String(row.timestamp || ''),
          senderName: String(row.sender_name || row.username || ''),
          senderAvatar: String(row.sender_avatar || row.avatar || ''),
          e2ee: pinIsE2EE ? 1 : 0,
          e2ee_nonce: pinIsE2EE ? String(row.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: pinIsE2EE ? String(row.e2ee_ephemeral || '') : undefined
        };
      }

      if (!fullMessage) {
        console.error('Не удалось получить данные сообщения для закрепления:', messageId);
        socket.emit('pin_error', { error: 'Не удалось закрепить сообщение' });
        return;
      }

      // Уведомляем всех участников чата
      io.to(chatId).emit('message_pinned', {
        chatId,
        messageId,
        message: fullMessage,
        pinnedBy: onlineUser.id,
        pinnedByName: onlineUser.username,
        pinnedAt: now
      });

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
      const messageRow = db.prepare('SELECT id, chat_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        socket.emit('unpin_error', { error: 'Сообщение не найдено' });
        return;
      }

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
      const resultRows = db.prepare(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chat_id = ? AND m.is_pinned = 1
        ORDER BY m.pinned_at DESC
        LIMIT 50
      `).all(chatId);

      const pinnedMessages = resultRows.map(obj => {
        const pinListIsE2EE = obj.e2ee === 1 || obj.e2ee === true;
        return {
          id: String(obj.id || ''),
          chatId: String(obj.chat_id || ''),
          senderId: String(obj.sender_id || ''),
          text: pinListIsE2EE ? String(obj.text || '') : decryptText(String(obj.text || '')),
          file_data: String(obj.file_data || ''),
          timestamp: String(obj.timestamp || ''),
          senderName: String(obj.sender_name || obj.username || ''),
          senderAvatar: String(obj.sender_avatar || obj.avatar || ''),
          e2ee: pinListIsE2EE ? 1 : 0,
          e2ee_nonce: pinListIsE2EE ? (obj.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: pinListIsE2EE ? (obj.e2ee_ephemeral || '') : undefined
        };
      });

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
// Напоминания о задачах (по расписанию, при создании задачи)
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

    // Находим сокет пользователя и отправляем через WebSocket
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

  } catch (err) {
    console.error('Ошибка отправки напоминания:', err);
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
    flushLogsSync(); // Сбрасываем логи перед выходом
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
try {
  initDatabase();
  console.log('initDatabase завершено успешно, запуск сервера...');

  // State machine + аналитика бота
  const { BotAnalytics } = require('./bot/state');
  conversationStates = new Map();
  botAnalytics = new BotAnalytics();

  // Инициализация бота-помощника (после того как db готов)
  bot = initBotEngine({ db, io, uuidv4, encryptText });
  console.log('🤖 Бот-помощник инициализирован');

  // Загружаем квоты загрузок из БД
  try {
    const quotaRows = db.prepare(`
      SELECT u.id, COALESCE(SUM(LENGTH(m.file_data)), 0) as total
      FROM users u
      LEFT JOIN messages m ON m.sender_id = u.id AND m.file_data IS NOT NULL
      GROUP BY u.id
    `).all();
    for (const row of quotaRows) {
      userTotalUploadSize.set(String(row.id), Number(row.total) || 0);
    }
  } catch (e) {
    console.error('Ошибка загрузки квот:', e.message);
  }

  // Запускаем планировщик бэкапов
  startBackupScheduler();

  // Восстанавливаем сессии
  try {
    const sessions = db.prepare('SELECT user_id, last_seen FROM user_sessions').all();
    const twoMinAgo = Date.now() - 120000;
    for (const row of sessions) {
      const lastSeen = new Date(row.last_seen).getTime();
      if (lastSeen > twoMinAgo) {
        console.log(`Сессия пользователя ${row.user_id} будет восстановлена при reconnect`);
      }
    }
  } catch (e) {
    console.error('Ошибка восстановления сессий:', e.message);
  }

  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? getLocalIP() : HOST;
    console.log(`Сервер запущен на ${PROTOCOL}://${displayHost}:${PORT}`);
    console.log(`URL для клиентов: ${SERVER_URL}`);
    console.log(`База данных: ${DB_PATH}`);
    console.log(`Путь загрузок: ${UPLOADS_PATH}`);
  });
} catch (err) {
  console.error('Ошибка инициализации БД:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
}
