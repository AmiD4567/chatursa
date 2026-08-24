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
const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const cookieParser = require('cookie-parser');

// Асинхронный логгер: переопределяет console.* и ставит process-обработчики
const { registerFatalSaveHook, flushLogsSync } = require('./src/logger');

// Конфигурация (.env/config.json/пути/SSL)
const {
  config, HOST, PORT, HTTPS_PORT, DB_PATH, UPLOADS_PATH,
  SERVER_URL, useHttps, httpsOptions, getLocalIP
} = require('./src/config');

// Шифрование конфиденциальных полей БД
const { encryptText, decryptText, isEncrypted } = require('./src/crypto');

// Firebase Admin SDK (FCM)
const FCM_SERVICE_ACCOUNT_PATH = process.env.FCM_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'firebase-service-account.json');
if (fs.existsSync(FCM_SERVICE_ACCOUNT_PATH)) {
  try {
    const serviceAccount = require(FCM_SERVICE_ACCOUNT_PATH);
    admin.initializeApp({ credential: admin.cert(serviceAccount) });
    console.log('✅ Firebase Admin SDK инициализирован (FCM)');
  } catch (e) {
    console.warn('⚠️ Ошибка инициализации Firebase:', e.message);
  }
} else {
  console.warn('⚠️ Firebase service account не найден, FCM недоступен');
}

// VAPID keys for Web Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHOqP4mk3F0J_T0HPrs3KfZINBiqgj--SKHK6axuY8YqMsA6_qOZnD01DS7Ou2KchkUOY51Oz5Fpwk5_oPG9yco';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'y4O_8-8mDdYR4Cw6sUJLKYB9SO2nMxOquGpfyFOqxY0';
webPush.setVapidDetails('mailto:admin@chatursa.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Функция для получения локального IP

// ============================================
// Конец асинхронного логгера
// ============================================

const app = express();

// Dual-mode: HTTP-сервер всегда активен (для Electron/Android/web по http),
// HTTPS-сервер поднимается дополнительно при HTTPS_ENABLED=true (для iOS/веб).
const httpServer = http.createServer(app);
const httpsServer = useHttps ? https.createServer(httpsOptions, app) : null;
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
io.attach(httpServer);
if (httpsServer) io.attach(httpsServer);

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

// Вспомогательная функция для проверки прав на редактирование wiki
function checkWikiEditAccess(userId) {
  try {
    const row = db.prepare('SELECT is_admin, can_edit_wiki FROM users WHERE id = ?').get(userId);
    return row ? (row.is_admin === 1 || row.can_edit_wiki === 1) : false;
  } catch (e) {
    console.error('Ошибка проверки прав wiki:', e.message);
    return false;
  }
}

function checkArticleAccess(userId, article) {
  if (!article) return false;
  if (!userId) return article.access_level === 'public' || !article.access_level;
  if (checkAdmin(userId)) return true;
  if (article.created_by === userId) return true;
  if (article.access_level === 'public' || !article.access_level) return true;
  if (article.access_level === 'private') return false;
  if (article.access_level === 'selected') {
    const allowed = db.prepare('SELECT 1 FROM wiki_article_allowed_users WHERE article_id = ? AND user_id = ?').get(article.id, userId);
    return !!allowed;
  }
  return false;
}

function checkCategoryEditor(userId, categoryId) {
  if (!userId) return false;
  if (checkAdmin(userId)) return true;
  try {
    let currentId = categoryId;
    while (currentId) {
      const row = db.prepare('SELECT 1 FROM wiki_category_editors WHERE category_id = ? AND user_id = ?').get(currentId, userId);
      if (row) return true;
      const parent = db.prepare('SELECT parent_id FROM wiki_categories WHERE id = ?').get(currentId);
      currentId = parent ? parent.parent_id : null;
    }
    return false;
  } catch (e) {
    console.error('Ошибка проверки прав редактора категории:', e.message);
    return false;
  }
}

// БД: схема/миграции/бэкапы вынесены в src/db.js
const { initDatabase, getDb, saveDatabaseSync, startBackupScheduler } = require('./src/db');

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

startIdleChecker();

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

// Принудительный редирект HTTP → HTTPS (код 301).
// Отключён по умолчанию: в dual-mode HTTP-порт нужен десктопу/Android.
// Включается только явно через HTTPS_REDIRECT=true в .env.
app.use((req, res, next) => {
  if (process.env.HTTPS_REDIRECT === 'true' && useHttps && !req.secure && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Helmet с настройками, совместимыми с WebSocket и стикерами
const PROTOCOL = useHttps ? 'https' : 'http';
const WS_PROTOCOL = useHttps ? 'wss:' : 'ws:';
const LAN_HTTP_ORIGIN = `http://${getLocalIP()}:${PORT}`;
const CSP_ORIGINS = process.env.CHAT_APP_SERVER_URL || `${PROTOCOL}://localhost:${PORT}`;
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://ui-avatars.com', 'https://cdn.jsdelivr.net', CSP_ORIGINS, LAN_HTTP_ORIGIN],
      connectSrc: ["'self'", WS_PROTOCOL, 'wss:', 'https://api.github.com', CSP_ORIGINS, LAN_HTTP_ORIGIN, 'capacitor://localhost', `${PROTOCOL}://localhost`],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      mediaSrc: ["'self'", CSP_ORIGINS, LAN_HTTP_ORIGIN],
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
const ALLOWED_ORIGINS = [CSP_ORIGINS, LAN_HTTP_ORIGIN, `${PROTOCOL}://localhost:3000`, `${PROTOCOL}://localhost:3001`, 'capacitor://localhost', `${PROTOCOL}://localhost`]; 
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://192.168.') || origin.startsWith('https://192.168.') || origin.startsWith('capacitor://')) return cb(null, true);
    cb(null, true); // в локальной сети разрешаем все
  },
  credentials: true
}));

// Cookie parser (используется в др.местах, не для CSRF)
app.use(cookieParser());

// CSRF защита: Single-header pattern (Same Origin Policy не даёт атакующему
// установить кастомный заголовок X-CSRF-Token на跨доменный запрос).
// Фронтенд читает токен из JSON-ответа и добавляет его в заголовок всех мутирующих запросов.
// Не используем cookie из-за sameSite-ограничений в Electron (file:// origin).
app.get('/api/csrf-token', (req, res) => {
  const token = uuidv4();
  res.json({ csrfToken: token });
});

// Проверка CSRF для всех мутирующих запросов к API
function csrfMiddleware(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const headerToken = req.headers['x-csrf-token'];
    if (!headerToken || headerToken === '') {
      console.warn(`[CSRF] Отсутствует или пустой X-CSRF-Token: ${req.method} ${req.path}, IP: ${req.ip}`);
      return res.status(403).json({ error: 'Недействительный CSRF-токен' });
    }
  }
  next();
}

app.use('/api/', csrfMiddleware);

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
  const user = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text, is_admin, can_edit_wiki, can_book_meeting_room, can_view_kpi FROM users WHERE id = ?').get(req.params.userId);
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
  const safeStatusText = statusText === null || statusText === undefined ? null : statusText;

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

// ============================================
// Group E2EE API
// ============================================

// Получить зашифрованный групповой ключ для участника
app.get('/api/e2ee/group-key/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.query;
  if (!chatId || !userId) return res.status(400).json({ error: 'chatId и userId обязательны' });
  try {
    const row = db.prepare('SELECT encrypted_key FROM group_e2ee_keys WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (row) {
      res.json({ encryptedKey: row.encrypted_key });
    } else {
      res.status(404).json({ error: 'Ключ не найден' });
    }
  } catch (err) {
    console.error('Ошибка получения группового ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузить зашифрованные групповые ключи для всех участников
app.put('/api/e2ee/group-key', (req, res) => {
  const { chatId, keys } = req.body; // keys: [{ userId, encryptedKey }]
  if (!chatId || !keys || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'chatId и keys обязательны' });
  }
  try {
    const insert = db.prepare('INSERT OR REPLACE INTO group_e2ee_keys (chat_id, user_id, encrypted_key) VALUES (?, ?, ?)');
    const tx = db.transaction((keysData) => {
      for (const k of keysData) {
        insert.run(chatId, k.userId, k.encryptedKey);
      }
    });
    tx(keys);
    db.run('UPDATE chats SET e2ee = 1 WHERE id = ?', [chatId]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения групповых ключей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить групповые ключи (при отключении E2EE или смене состава)
app.delete('/api/e2ee/group-key/:chatId', (req, res) => {
  const { chatId } = req.params;
  try {
    db.run('DELETE FROM group_e2ee_keys WHERE chat_id = ?', [chatId]);
    db.run('UPDATE chats SET e2ee = 0 WHERE id = ?', [chatId]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления групповых ключей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить список участников, у кого есть ключ (для проверки статуса)
app.get('/api/e2ee/group-key/:chatId/members', (req, res) => {
  const { chatId } = req.params;
  try {
    const rows = db.prepare('SELECT user_id FROM group_e2ee_keys WHERE chat_id = ?').all(chatId);
    res.json({ members: rows.map(r => r.user_id) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
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
  const userId = req.query.userId || (req.body || {}).userId;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId обязателен' });
  }

  // Полное удаление чата (у всех участников) — только администратор
  if (!userId || !checkAdmin(userId)) {
    return res.status(403).json({ error: 'Удалять чат у всех участников может только администратор' });
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

// Закрепить / открепить чат для пользователя
app.put('/api/chats/:chatId/pin', (req, res) => {
  const { chatId } = req.params;
  const { userId, pinned } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, ?, 0, 0, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET pinned = ?
    `, [userId, chatId, pinned ? 1 : 0, pinned ? 1 : 0]);
    res.json({ success: true, pinned: !!pinned });
  } catch (err) {
    console.error('Ошибка закрепа чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Выключить / включить уведомления для чата
app.put('/api/chats/:chatId/mute', (req, res) => {
  const { chatId } = req.params;
  const { userId, muted } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, ?, 0, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET muted = ?
    `, [userId, chatId, muted ? 1 : 0, muted ? 1 : 0]);
    res.json({ success: true, muted: !!muted });
  } catch (err) {
    console.error('Ошибка изменения уведомлений чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Пометить чат как прочитанный / непрочитанный
app.put('/api/chats/:chatId/unread', (req, res) => {
  const { chatId } = req.params;
  const { userId, forceUnread } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, 0, ?, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET force_unread = ?
    `, [userId, chatId, forceUnread ? 1 : 0, forceUnread ? 1 : 0]);
    res.json({ success: true, forceUnread: !!forceUnread });
  } catch (err) {
    console.error('Ошибка отметки непрочитанного:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистить историю чата (только для этого пользователя)
app.post('/api/chats/:chatId/clear', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    const now = new Date().toISOString();
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, 0, 0, ?)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET cleared_at = ?, force_unread = 0
    `, [userId, chatId, now, now]);
    // Сбрасываем непрочитанные для пользователя в этом чате
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
    res.json({ success: true, clearedAt: now });
  } catch (err) {
    console.error('Ошибка очистки истории:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить чат только у себя (собеседника не затрагивает).
// Чат скрыт до нового сообщения от собеседника — тогда возвращается в список (без старой истории за счёт cleared_at)
app.post('/api/chats/:chatId/hide', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    const now = new Date().toISOString();
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at, deleted_at)
      VALUES (?, ?, 0, 0, 0, ?, ?)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET cleared_at = ?, deleted_at = ?, force_unread = 0
    `, [userId, chatId, now, now, now, now]);
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления чата у себя:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Выход из группового чата
app.post('/api/chats/:chatId/leave', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
    db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

    // Уведомляем остальных участников
    const chatWithDetails = getChatWithDetails(chatId);
    if (chatWithDetails) {
      chatWithDetails.participantsDetails.forEach(p => {
        emitToUser(p.id, 'participant_left', { chatId, userId });
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка выхода из чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавление участника в группу (только создатель)
app.post('/api/chats/:chatId/participants', (req, res) => {
  const { chatId } = req.params;
  const { userId, requesterId } = req.body;

  if (!chatId || !userId || !requesterId) {
    return res.status(400).json({ error: 'chatId, userId и requesterId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    if (chat.created_by !== requesterId) {
      return res.status(403).json({ error: 'Только создатель группы может добавлять участников' });
    }

    const existing = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь уже в чате' });
    }

    db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, userId]);

    // Уведомляем нового участника
    const chatWithDetails = getChatWithDetails(chatId);
    emitToUser(userId, 'chat_created', { chat: chatWithDetails });

    // Уведомляем остальных
    chatWithDetails.participantsDetails.forEach(p => {
      if (p.id !== userId) {
        emitToUser(p.id, 'participant_added', { chatId, userId });
      }
    });

    res.json({ success: true, chat: chatWithDetails });
  } catch (err) {
    console.error('Ошибка добавления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление участника из группы (только создатель)
app.delete('/api/chats/:chatId/participants/:targetUserId', (req, res) => {
  const { chatId, targetUserId } = req.params;
  const { requesterId } = req.body;

  if (!chatId || !targetUserId || !requesterId) {
    return res.status(400).json({ error: 'chatId, targetUserId и requesterId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    if (chat.created_by !== requesterId) {
      return res.status(403).json({ error: 'Только создатель группы может удалять участников' });
    }

    if (targetUserId === requesterId) {
      return res.status(400).json({ error: 'Нельзя удалить себя. Используйте выход из группы.' });
    }

    db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);
    db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);

    // Уведомляем удалённого участника
    emitToUser(targetUserId, 'removed_from_chat', { chatId });

    // Уведомляем остальных
    const chatWithDetails = getChatWithDetails(chatId);
    if (chatWithDetails) {
      chatWithDetails.participantsDetails.forEach(p => {
        emitToUser(p.id, 'participant_left', { chatId, userId: targetUserId });
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
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

    io.emit('user_avatar_updated', { userId: Number(userId), avatar: avatarUrl });

    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

app.post('/api/remove-avatar', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
    if (user?.avatar) {
      try {
        const filePath = path.join(UPLOADS_PATH, path.basename(new URL(user.avatar).pathname));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    db.run('UPDATE users SET avatar = NULL WHERE id = ?', [userId]);
    io.emit('user_avatar_updated', { userId, avatar: '' });
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления аватара:', err);
    res.status(500).json({ error: 'Ошибка при удалении аватара' });
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

// API для загрузки аватара группового чата (любой участник)
app.post('/api/upload-group-chat-avatar', upload.single('avatar'), (req, res) => {
  const { chatId, userId } = req.body;

  if (!chatId || !userId || !req.file) {
    return res.status(400).json({ error: 'chatId, userId и файл обязательны' });
  }

  const isParticipant = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isParticipant) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Вы не являетесь участником чата' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    db.run('UPDATE chats SET avatar = ? WHERE id = ?', [avatarUrl, chatId]);
    const chat = getChatWithDetails(chatId);
    io.emit('chat_avatar_updated', { chatId, avatar: avatarUrl, chat });
    res.json({ success: true, avatar: avatarUrl });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error('Ошибка загрузки аватара группы:', err);
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

  // multer может испортить UTF-8 имена — пробуем восстановить
  let fileName = req.file.originalname;
  try {
    fileName = decodeURIComponent(escape(fileName));
  } catch (_) {}

  const fileUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({
    filename: fileName,
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
  if (filenameCache.has(uuid)) return filenameCache.get(uuid);
  if (typeof uuid !== 'string') return null;

  // UUID может содержать расширение файла (например: 08f464a3-...-abc.docx)
  const baseUuid = uuid.replace(/\.[^.]+$/, '');
  if (!/^[0-9a-fA-F-]+$/.test(baseUuid)) return null;

  let originalFilename = null;

  try {
    // 1) Файлы базы знаний: оригинальное имя в wiki_article_files.file_name
    const wikiFile = db.prepare(
      'SELECT file_name FROM wiki_article_files WHERE file_path = ? LIMIT 1'
    ).get(uuid);
    if (wikiFile && wikiFile.file_name) {
      originalFilename = wikiFile.file_name;
    }
  } catch (err) {
    console.error('Ошибка поиска имени файла базы знаний:', err);
  }

  if (!originalFilename) {
    try {
      // 2) Файлы из чата: имя в messages.file_data (uuid — последний сегмент URL)
      const searchPattern = `%"url":"%${uuid}"%`;
      const row = db.prepare(
        "SELECT file_data FROM messages WHERE file_data LIKE ? LIMIT 1"
      ).get(searchPattern);

      if (row) {
        try {
          const parsed = JSON.parse(row.file_data);
          if (parsed && parsed.filename) {
            originalFilename = parsed.filename;
          }
        } catch (e) { /* skip invalid JSON */ }
      }
    } catch (err) {
      console.error('Ошибка поиска оригинального имени файла:', err);
    }
  }

  if (originalFilename) {
    // Старые записи могли испортить UTF-8 — пробуем восстановить (для чистых имён no-op)
    try {
      originalFilename = decodeURIComponent(escape(originalFilename));
    } catch (_) {}
    trimFilenameCache();
    filenameCache.set(uuid, originalFilename);
    return originalFilename;
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

  // Legacy filename должен быть ASCII (Node не принимает сырой UTF-8 в заголовках):
  // настоящая кириллица передаётся через filename* (RFC 5987)
  const legacyName = uuid;

  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodedName}; filename="${legacyName}";`
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

  // Добавляем участников к каждому бронированию
  const getParticipants = db.prepare('SELECT user_id, username FROM meeting_room_booking_participants WHERE booking_id = ?');
  const enriched = bookings.map(b => ({
    ...b,
    participants_list: getParticipants.all(b.id)
  }));

  res.json({ bookings: enriched });
});

// Создать бронирование переговорной
app.post('/api/meeting-room/bookings', (req, res) => {
  const { organizerId, organizerName, title, description, meetingDate, startTime, endTime, participants, reminderMinutes } = req.body;

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

  // Рассчитываем reminder_time если выбрано напоминание
  let reminderTime = null;
  if (reminderMinutes && parseInt(reminderMinutes) > 0) {
    const baseDate = new Date(`${meetingDate}T${startTime}`);
    reminderTime = new Date(baseDate.getTime() - parseInt(reminderMinutes) * 60 * 1000).toISOString().slice(0, 19);
  }

  try {
    const insertResult = db.run(`
      INSERT INTO meeting_room_bookings (organizer_id, organizer_name, title, description, meeting_date, start_time, end_time, reminder_minutes, reminder_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [organizerId, organizerName || 'Аноним', title, description || null, meetingDate, startTime, endTime, reminderMinutes || null, reminderTime]);
    
    const newId = insertResult.lastInsertRowid;
    
    // Добавляем участников
    if (participants && Array.isArray(participants) && participants.length > 0) {
      const insertParticipant = db.prepare('INSERT INTO meeting_room_booking_participants (booking_id, user_id, username) VALUES (?, ?, ?)');
      const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
      for (const userId of participants) {
        const userRow = getUser.get(userId);
        if (userRow) {
          insertParticipant.run(newId, userId, userRow.username);
        }
      }
    }
    
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
    // Удаляем связанных участников
    db.run(`DELETE FROM meeting_room_booking_participants WHERE booking_id = ?`, [id]);
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
  const { title, description, meetingDate, startTime, endTime, participants, reminderMinutes } = req.body;
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

  // Рассчитываем reminder_time если выбрано напоминание
  let reminderTime = null;
  if (reminderMinutes && parseInt(reminderMinutes) > 0) {
    const baseDate = new Date(`${meetingDate}T${startTime}`);
    reminderTime = new Date(baseDate.getTime() - parseInt(reminderMinutes) * 60 * 1000).toISOString().slice(0, 19);
  }

  try {
    db.run(`
      UPDATE meeting_room_bookings 
      SET title = ?, description = ?, meeting_date = ?, start_time = ?, end_time = ?, reminder_minutes = ?, reminder_time = ?, reminder_sent = 0
      WHERE id = ?
    `, [title, description || null, meetingDate, startTime, endTime, reminderMinutes || null, reminderTime, id]);
    
    // Синхронизируем участников
    const participantsList = req.body.participants;
    if (participantsList && Array.isArray(participantsList)) {
      // Удаляем старых участников
      db.run('DELETE FROM meeting_room_booking_participants WHERE booking_id = ?', [id]);
      // Добавляем новых
      if (participantsList.length > 0) {
        const insertParticipant = db.prepare('INSERT INTO meeting_room_booking_participants (booking_id, user_id, username) VALUES (?, ?, ?)');
        const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
        for (const userId of participantsList) {
          const userRow = getUser.get(userId);
          if (userRow) {
            insertParticipant.run(id, userId, userRow.username);
          }
        }
      }
    }
    
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
        organizer_name: updatedBooking.organizer_name,
        reminder_minutes: updatedBooking.reminder_minutes,
        reminder_time: updatedBooking.reminder_time
      } : null
    });
  } catch (err) {
    console.error('Ошибка обновления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для создания задачи
app.post('/api/calendar/tasks', (req, res) => {
  const { userId, title, description, taskDate, taskTime, taskEndTime, color, reminderType, sourceChatId, sourceMessageId } = req.body;

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
        reminderTime = new Date(`${taskDate}T${req.body.reminderCustomTime}`).toISOString().slice(0, 19);
      }

      if (reminderTime && user) {
        scheduleTaskReminder(taskId, userId, user.username, title, taskDate, taskTime || null, reminderTime);
      }
    }

    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, task_end_time, color, reminder_time, source_chat_id, source_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [taskId, userId, title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', reminderTime, sourceChatId || null, sourceMessageId || null]);


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
        reminderTime = new Date(`${taskDate}T${reminderCustomTime}`).toISOString().slice(0, 19);
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

// ============================================
// FCM API для Android push-уведомлений
// ============================================

// Регистрация FCM-токена
app.post('/api/push/fcm/register', (req, res) => {
  const { userId, token, unregister } = req.body;
  if (unregister === 'true') {
    try {
      db.run('DELETE FROM fcm_tokens WHERE token = ?', [token]);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Ошибка удаления FCM-токена' });
    }
  }
  if (!userId || !token) {
    return res.status(400).json({ error: 'userId и token обязательны' });
  }
  try {
    const id = uuidv4();
    db.run('INSERT OR REPLACE INTO fcm_tokens (id, user_id, token, created_at) VALUES (?, ?, ?, ?)',
      [id, userId, token, new Date().toISOString()]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения FCM-токена:', err);
    res.status(500).json({ error: 'Ошибка сохранения токена' });
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

// API для получения сообщений чата
app.get('/api/messages/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { userId, before, limit } = req.query;

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    // Пагинация: при наличии before/limit отдаём порцию старых сообщений
    if (before) {
      const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const older = getChatMessages(chatId, lim + 1, userId, String(before));
      const hasMore = older.length > lim;
      return res.json({ messages: hasMore ? older.slice(0, lim) : older, hasMore });
    }

    const clearedRow = db.prepare('SELECT cleared_at FROM chat_user_settings WHERE user_id = ? AND chat_id = ?').get(userId, chatId);
    const clearedAt = clearedRow ? clearedRow.cleared_at : null;

    const rows = db.prepare(`
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.read_at,
             m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral, m.poll_id,
             u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
        AND (? IS NULL OR m.timestamp > ?)
      ORDER BY m.timestamp ASC
    `).all(chatId, clearedAt, clearedAt);

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

      let poll = null;
      if (row.poll_id) {
        poll = getPollWithVotes(row.poll_id, userId);
      }

      return {
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        text: isE2EE ? (row.text || '') : (decryptText(row.text) || ''),
        file: file,
        poll: poll,
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

// API: кто прочитал сообщение
app.get('/api/messages/:messageId/read-by', (req, res) => {
  const { messageId } = req.params;
  try {
    const readers = db.prepare(`
      SELECT mr.user_id, u.username, u.avatar, mr.read_at
      FROM message_reads mr
      JOIN users u ON u.id = mr.user_id
      WHERE mr.message_id = ?
      ORDER BY mr.read_at ASC
    `).all(messageId);
    res.json({ readers });
  } catch (err) {
    console.error('Ошибка получения читателей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для поиска сообщений
app.get('/api/search/messages', (req, res) => {
  const { userId, query, chatId } = req.query;
  if (!userId || !query || !query.trim()) {
    return res.status(400).json({ error: 'userId и query обязательны' });
  }

  try {
    const searchLower = query.trim().toLowerCase();

    // Загружаем сообщения из чатов пользователя (без LIKE — текст зашифрован)
    let sql = `
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.read_at,
             m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral, m.poll_id,
             u.username as senderName, u.avatar as senderAvatar,
             c.name as chatName
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      LEFT JOIN chats c ON m.chat_id = c.id
      WHERE m.chat_id IN (
        SELECT chat_id FROM chat_participants WHERE user_id = ?
      )
    `;
    const params = [userId];

    if (chatId) {
      sql += ` AND m.chat_id = ?`;
      params.push(chatId);
    }

    sql += ` ORDER BY m.timestamp DESC LIMIT 500`;

    const rows = db.prepare(sql).all(...params);

    // Расшифровываем и фильтруем на уровне JS
    const messages = rows
      .map(row => {
        let file = null;
        if (row.file_data) {
          try { file = JSON.parse(row.file_data); } catch (e) { file = null; }
        }
        let poll = null;
        if (row.poll_id) {
          poll = getPollWithVotes(row.poll_id, userId);
        }
        let reply_to = null;
        if (row.reply_to) {
          try { reply_to = JSON.parse(row.reply_to); } catch { reply_to = null; }
        }
        const decryptedText = decryptText(row.text) || '';
        return {
          id: row.id,
          chatId: row.chat_id,
          senderId: row.sender_id,
          text: decryptedText,
          file,
          poll,
          reply_to,
          timestamp: row.timestamp,
          read_at: row.read_at || null,
          senderName: row.senderName,
          senderAvatar: row.senderAvatar,
          chatName: row.chatName || 'Чат',
          e2ee: row.e2ee === 1 ? 1 : 0
        };
      })
      .filter(msg => msg.text.toLowerCase().includes(searchLower));

    res.json({ messages });
  } catch (err) {
    console.error('Ошибка поиска сообщений:', err);
    res.status(500).json({ error: 'Ошибка при поиске сообщений' });
  }
});

// Единый поиск файлов: вложения чатов пользователя + файлы базы знаний (по именам файлов)
app.get('/api/search/files', (req, res) => {
  const { userId, query } = req.query;
  if (!userId || !query || !query.trim()) {
    return res.status(400).json({ error: 'userId и query обязательны' });
  }

  try {
    const searchLower = query.trim().toLowerCase();

    // ── 1. Вложения в сообщениях чатов пользователя ──
    let chatFiles = [];
    try {
      const rows = db.prepare(`
        SELECT m.id AS messageId, m.chat_id AS chatId, m.file_data, m.timestamp,
               u.username AS senderName, c.name AS chatName,
               cus.cleared_at AS clearedAt
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        LEFT JOIN chats c ON m.chat_id = c.id
        LEFT JOIN chat_user_settings cus ON cus.chat_id = m.chat_id AND cus.user_id = ?
        WHERE m.chat_id IN (SELECT chat_id FROM chat_participants WHERE user_id = ?)
          AND m.file_data IS NOT NULL AND m.file_data != ''
        ORDER BY m.timestamp DESC
        LIMIT 300
      `).all(userId, userId);

      chatFiles = rows
        .map(row => {
          let file = null;
          try { file = JSON.parse(row.file_data); } catch (e) { file = null; }
          if (!file || !file.filename) return null;
          // Уважаем персональную очистку истории: вложения из неё не показываем
          if (row.clearedAt && row.timestamp <= row.clearedAt) return null;
          return {
            type: 'chatFile',
            messageId: row.messageId,
            chatId: row.chatId,
            chatName: row.chatName || 'Чат',
            senderName: row.senderName || '',
            filename: String(file.filename),
            url: file.url || '',
            mimetype: file.mimetype || '',
            size: file.size || 0,
            timestamp: row.timestamp
          };
        })
        .filter(f => f && f.filename.toLowerCase().includes(searchLower))
        .slice(0, 30);
    } catch (err) {
      console.error('Ошибка поиска вложений чатов:', err);
    }

    // ── 2. Файлы базы знаний (с учётом прав доступа к статьям) ──
    let wikiFiles = [];
    try {
      const isAdmin = checkAdmin(userId);
      let sql = `
        SELECT f.id, f.article_id AS articleId, f.file_name AS fileName,
               f.file_size AS fileSize, f.mime_type AS mimeType, f.created_at AS createdAt,
               a.title AS articleTitle
        FROM wiki_article_files f
        JOIN wiki_articles a ON f.article_id = a.id
      `;
      const params = [];
      if (!isAdmin) {
        sql += ` WHERE (
          a.access_level = 'public' OR
          a.access_level IS NULL OR
          a.created_by = ? OR
          (a.access_level = 'selected' AND a.id IN (
            SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
          ))
        )`;
        params.push(userId, userId);
      }
      sql += ` ORDER BY f.created_at DESC`;
      const rows = db.prepare(sql).all(...params);
      wikiFiles = rows
        .map(row => ({
          type: 'wikiFile',
          id: row.id,
          articleId: row.articleId,
          articleTitle: row.articleTitle || 'Статья',
          filename: row.fileName || 'Файл',
          mimeType: row.mimeType || '',
          size: row.fileSize || 0,
          createdAt: row.createdAt
        }))
        .filter(f => f.filename.toLowerCase().includes(searchLower))
        .slice(0, 30);
    } catch (err) {
      console.error('Ошибка поиска файлов wiki:', err);
    }

    res.json({ chatFiles, wikiFiles });
  } catch (err) {
    console.error('Ошибка поиска файлов:', err);
    res.status(500).json({ error: 'Ошибка при поиске файлов' });
  }
});

// Проверка орфографии через Яндекс.Спеллер (прокси без CORS-проблем + кэш)
const spellCache = new Map(); // ключ: lang|текст-lower → { ts, errors }
const SPELL_CACHE_TTL = 10 * 60 * 1000;
const SPELL_CACHE_MAX = 500;

function fetchYandexSpell(text, lang) {
  return new Promise((resolve) => {
    const url = `https://speller.yandex.net/services/spellservice.json/checkText?options=6&lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
    try {
      const req = https.get(url, { timeout: 4000 }, (apiRes) => {
        let raw = '';
        apiRes.on('data', (chunk) => { raw += chunk; });
        apiRes.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (e) {
            resolve([]);
          }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.on('error', () => resolve([]));
    } catch (e) {
      resolve([]);
    }
  });
}

app.get('/api/spellcheck', async (req, res) => {
  const text = String(req.query.text || '');
  const langSafe = ['ru', 'en', 'uk', 'kk'].includes(req.query.lang) ? req.query.lang : 'ru,en';
  if (!text.trim()) return res.json({ errors: [] });

  const cacheKey = `${langSafe}|${text.toLowerCase()}`;
  const cached = spellCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SPELL_CACHE_TTL) {
    return res.json({ errors: cached.errors });
  }

  const rawErrors = await fetchYandexSpell(text, langSafe);
  // Оставляем только ошибки с вариантами исправления
  const errors = rawErrors
    .filter(e => e && e.word && Array.isArray(e.s))
    .map(e => ({ word: String(e.word), s: e.s.slice(0, 5).map(String) }));

  // Вытеснение старейшей записи при переполнении (Map хранит порядок вставки)
  if (!spellCache.has(cacheKey)) {
    if (spellCache.size >= SPELL_CACHE_MAX) {
      const oldestKey = spellCache.keys().next().value;
      spellCache.delete(oldestKey);
    }
    spellCache.set(cacheKey, { ts: Date.now(), errors });
  }

  res.json({ errors });
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

    // Полная доставка: unread_messages, realtime-рассылка, push офлайн-участникам
    distributeChatMessage(chatId, newMessage, getChatById(chatId) || { id: chatId });

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

// API для отметки сообщений как прочитанных (из push-уведомления)
app.post('/api/messages/read', (req, res) => {
  const { chatId, userId } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
    db.run('UPDATE chat_user_settings SET force_unread = 0 WHERE user_id = ? AND chat_id = ?', [userId, chatId]);

    const now = new Date().toISOString();
    db.run(`
      UPDATE messages
      SET read_at = ?
      WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
    `, [now, chatId, userId]);

    const senderRows = db.prepare(`
      SELECT DISTINCT sender_id FROM messages WHERE chat_id = ? AND sender_id != ?
    `).all(chatId, userId);
    const senderIds = senderRows.map(row => row.sender_id);

    senderIds.forEach(senderId => {
      emitToUser(senderId, 'messages_read', { chatId, readBy: userId, readAt: now });
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отметки прочитанных:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
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
const LINK_PREVIEW_CACHE_MAX = 500; // макс. записей

// Фоновая очистка просроченных и лишних записей linkPreviewCache
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of linkPreviewCache) {
    if (now - cached.ts > LINK_PREVIEW_CACHE_TTL) {
      linkPreviewCache.delete(key);
    }
  }
  if (linkPreviewCache.size > LINK_PREVIEW_CACHE_MAX) {
    const toRemove = [...linkPreviewCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, linkPreviewCache.size - LINK_PREVIEW_CACHE_MAX);
    for (const [key] of toRemove) linkPreviewCache.delete(key);
  }
}, 10 * 60 * 1000);

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
app.get('/api/wiki/search', (req, res) => {
  const { q, limit = 5, userId } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ success: true, results: [] });
  }
  try {
    let sql = `
      SELECT id, title, content, category_id, access_level, created_by,
             (SELECT name FROM wiki_categories WHERE id = wiki_articles.category_id) as category_name
      FROM wiki_articles
      WHERE (title LIKE ? OR content LIKE ?)`;
    const params = [`%${q}%`, `%${q}%`];

    if (userId) {
      const isAdmin = checkAdmin(userId);
      if (!isAdmin) {
        sql += ` AND (
          access_level IS NULL OR
          access_level = 'public' OR
          created_by = ? OR
          (access_level = 'selected' AND id IN (
            SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
          ))
        )`;
        params.push(userId, userId);
      }
    }

    sql += ' ORDER BY views DESC LIMIT ?';
    params.push(parseInt(limit) || 5);

    const results = db.prepare(sql).all(...params);
    res.json({ success: true, results });
  } catch (err) {
    console.error('Ошибка поиска wiki:', err);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Поиск файлов
app.get('/api/search/files', (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ success: true, results: [] });
  }
  try {
    const results = db.prepare(`
      SELECT m.id, m.chat_id, m.file_data, m.timestamp, m.sender_id, u.username as sender_name,
             c.name as chat_name, c.type as chat_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN chats c ON m.chat_id = c.id
      WHERE m.file_data IS NOT NULL AND (m.file_data LIKE ? OR m.text LIKE ?)
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, parseInt(limit) || 20);

    const files = results.map(row => {
      try {
        const parsed = JSON.parse(row.file_data);
        return { ...row, file_info: parsed, file_data: undefined };
      } catch {
        return { ...row, file_info: null, file_data: undefined };
      }
    });

    res.json({ success: true, results: files });
  } catch (err) {
    console.error('Ошибка поиска файлов:', err);
    res.status(500).json({ error: 'Ошибка поиска файлов' });
  }
});

// Получение wiki-статьи (для бота)
app.get('/api/wiki/article/:id', (req, res) => {
  try {
    const { id } = req.params;
    const article = db.prepare('SELECT * FROM wiki_articles WHERE id = ?').get(id);
    if (!article) {
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    res.json({ success: true, article });
  } catch (err) {
    console.error('Ошибка получения статьи:', err);
    res.status(500).json({ error: 'Ошибка получения статьи' });
  }
});

// ============================================
// Wiki API
// ============================================

// Categories

app.get('/api/wiki/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM wiki_categories ORDER BY sort_order ASC, name ASC').all();
    const allEditors = db.prepare('SELECT * FROM wiki_category_editors').all();
    const editorsByCat = {};
    for (const e of allEditors) {
      if (!editorsByCat[e.category_id]) editorsByCat[e.category_id] = [];
      editorsByCat[e.category_id].push(e.user_id);
    }
    for (const cat of rows) {
      cat.editors = editorsByCat[cat.id] || [];
    }
    res.json({ success: true, categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/categories', (req, res) => {
  const { name, description, parentId, userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && (!parentId || !checkCategoryEditor(userId, parentId))) {
    return res.status(403).json({ error: 'Недостаточно прав для создания раздела' });
  }
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO wiki_categories (id, name, description, parent_id) VALUES (?, ?, ?, ?)')
      .run(id, name, description || '', parentId || null);
    const cat = db.prepare('SELECT * FROM wiki_categories WHERE id = ?').get(id);
    cat.editors = [];
    res.json({ success: true, category: cat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/categories/:id', (req, res) => {
  const { name, description, parentId, sortOrder, userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && !checkCategoryEditor(userId, req.params.id)) {
    return res.status(403).json({ error: 'Недостаточно прав для редактирования раздела' });
  }
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    db.prepare('UPDATE wiki_categories SET name = ?, description = ?, parent_id = ?, sort_order = ? WHERE id = ?')
      .run(name, description || '', parentId || null, sortOrder || 0, req.params.id);
    if (checkAdmin(userId) && req.body.editorIds) {
      const { editorIds } = req.body;
      db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(req.params.id);
      const insert = db.prepare('INSERT OR IGNORE INTO wiki_category_editors (category_id, user_id) VALUES (?, ?)');
      for (const editorId of (editorIds || [])) {
        insert.run(req.params.id, String(editorId));
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка PUT категории:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/categories/:id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && !checkCategoryEditor(userId, req.params.id)) {
    return res.status(403).json({ error: 'Недостаточно прав для удаления раздела' });
  }
  try {
    const deleteRecursive = (catId) => {
      const children = db.prepare('SELECT id FROM wiki_categories WHERE parent_id = ?').all(catId);
      for (const child of children) {
        deleteRecursive(child.id);
      }
      const files = db.prepare('SELECT f.file_path FROM wiki_article_files f JOIN wiki_articles a ON f.article_id = a.id WHERE a.category_id = ?').all(catId);
      for (const f of files) {
        const fullPath = path.join(UPLOADS_PATH, f.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      db.prepare('DELETE FROM wiki_article_files WHERE article_id IN (SELECT id FROM wiki_articles WHERE category_id = ?)').run(catId);
      db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id IN (SELECT id FROM wiki_articles WHERE category_id = ?)').run(catId);
      db.prepare('DELETE FROM wiki_articles WHERE category_id = ?').run(catId);
      db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(catId);
      db.prepare('DELETE FROM wiki_categories WHERE id = ?').run(catId);
    };
    deleteRecursive(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki/categories/:id/editors', (req, res) => {
  try {
    const editors = db.prepare('SELECT user_id FROM wiki_category_editors WHERE category_id = ?').all(String(req.params.id));
    res.json({ success: true, editorIds: editors.map(e => e.user_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/categories/:id/editors', (req, res) => {
  const { userId, editorIds } = req.body;
  if (!userId || !checkAdmin(userId)) return res.status(403).json({ error: 'Только для администраторов' });
  try {
    db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO wiki_category_editors (category_id, user_id) VALUES (?, ?)');
    for (const editorId of (editorIds || [])) {
      insert.run(req.params.id, editorId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Articles

app.get('/api/wiki/articles', (req, res) => {
  const { categoryId, userId } = req.query;
  try {
    let sql = `SELECT a.*, u1.username as creatorName, u2.username as updaterName
               FROM wiki_articles a
               LEFT JOIN users u1 ON a.created_by = u1.id
               LEFT JOIN users u2 ON a.updated_by = u2.id`;
    const params = [];
    const conditions = [];

    if (categoryId) {
      conditions.push('a.category_id = ?');
      params.push(categoryId);
    }

    // Filter by access level if userId is provided
    if (userId) {
      const isAdmin = checkAdmin(userId);
      if (!isAdmin) {
        conditions.push(`(
          a.access_level = 'public' OR
          a.access_level IS NULL OR
          a.created_by = ? OR
          (a.access_level = 'selected' AND a.id IN (
            SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
          ))
        )`);
        params.push(userId, userId);
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY a.updated_at DESC';
    const rows = db.prepare(sql).all(...params);

    // Add allowedUsers for admin
    if (userId && checkAdmin(userId)) {
      for (const row of rows) {
        const allowedUsers = db.prepare('SELECT user_id FROM wiki_article_allowed_users WHERE article_id = ?').all(row.id);
        row.allowedUsers = allowedUsers.map(u => u.user_id);
      }
    }

    res.json({ success: true, articles: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki/articles/:id', (req, res) => {
  try {
    const row = db.prepare(`SELECT a.*, u1.username as creatorName, u2.username as updaterName
      FROM wiki_articles a
      LEFT JOIN users u1 ON a.created_by = u1.id
      LEFT JOIN users u2 ON a.updated_by = u2.id
      WHERE a.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Статья не найдена' });

    const userId = req.query.userId;
    if (!checkArticleAccess(userId, row)) {
      return res.status(403).json({ error: 'Нет доступа к статье' });
    }

    const files = db.prepare('SELECT * FROM wiki_article_files WHERE article_id = ? ORDER BY created_at').all(req.params.id);

    if (userId && checkAdmin(userId)) {
      const allowedUsers = db.prepare('SELECT user_id FROM wiki_article_allowed_users WHERE article_id = ?').all(req.params.id);
      row.allowedUsers = allowedUsers.map(u => u.user_id);
    }

    res.json({ success: true, article: { ...row, files } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/articles', (req, res) => {
  const { categoryId, title, content, userId, accessLevel, allowedUsers } = req.body;
  if (!title || !userId) return res.status(400).json({ error: 'title и userId обязательны' });
  if (!checkWikiEditAccess(userId) && !(categoryId && checkCategoryEditor(userId, categoryId)))
    return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    let finalAccessLevel = 'public';
    if (checkAdmin(userId) && accessLevel) {
      finalAccessLevel = accessLevel;
    }

    db.prepare('INSERT INTO wiki_articles (id, category_id, title, content, created_by, updated_by, created_at, updated_at, access_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, categoryId || null, title, content || '', userId, userId, now, now, finalAccessLevel);

    if (finalAccessLevel === 'selected' && Array.isArray(allowedUsers) && checkAdmin(userId)) {
      const insert = db.prepare('INSERT OR IGNORE INTO wiki_article_allowed_users (article_id, user_id) VALUES (?, ?)');
      for (const uid of allowedUsers) {
        insert.run(id, uid);
      }
    }

    const article = db.prepare('SELECT * FROM wiki_articles WHERE id = ?').get(id);
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/articles/:id', (req, res) => {
  const { title, content, categoryId, userId, accessLevel, allowedUsers } = req.body;
  if (!title || !userId) return res.status(400).json({ error: 'title и userId обязательны' });
  try {
    const article = db.prepare('SELECT created_by, category_id FROM wiki_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });
    if (!checkWikiEditAccess(userId) && !checkCategoryEditor(userId, categoryId || article.category_id))
      return res.status(403).json({ error: 'Доступ запрещён' });
    const isAdmin = checkAdmin(userId);
    const isEditor = checkCategoryEditor(userId, categoryId || article.category_id);
    if (!isAdmin && !isEditor && article.created_by !== userId) return res.status(403).json({ error: 'Нельзя редактировать чужие статьи' });
    const now = new Date().toISOString();

    let finalAccessLevel = undefined;
    if (isAdmin && accessLevel) {
      finalAccessLevel = accessLevel;
    }

    if (finalAccessLevel) {
      db.prepare('UPDATE wiki_articles SET title = ?, content = ?, category_id = ?, access_level = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(title, content || '', categoryId || null, finalAccessLevel, userId, now, req.params.id);
    } else {
      db.prepare('UPDATE wiki_articles SET title = ?, content = ?, category_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(title, content || '', categoryId || null, userId, now, req.params.id);
    }

    // Update allowed users if admin changed access level
    if (isAdmin && accessLevel) {
      db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id = ?').run(req.params.id);
      if (accessLevel === 'selected' && Array.isArray(allowedUsers)) {
        const insert = db.prepare('INSERT OR IGNORE INTO wiki_article_allowed_users (article_id, user_id) VALUES (?, ?)');
        for (const uid of allowedUsers) {
          insert.run(req.params.id, uid);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/articles/:id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  try {
    const article = db.prepare('SELECT created_by, category_id FROM wiki_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });

    const isAdminCheck = checkAdmin(userId);
    const isOwnerEditor = article.created_by === userId && article.category_id && checkCategoryEditor(userId, article.category_id);

    if (!isAdminCheck && !isOwnerEditor) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const files = db.prepare('SELECT file_path FROM wiki_article_files WHERE article_id = ?').all(req.params.id);
    for (const f of files) {
      const fullPath = path.join(UPLOADS_PATH, f.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    db.prepare('DELETE FROM wiki_article_files WHERE article_id = ?').run(req.params.id);
    db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id = ?').run(req.params.id);
    db.prepare('DELETE FROM wiki_articles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wiki article files
app.get('/api/wiki/articles/:id/files', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM wiki_article_files WHERE article_id = ? ORDER BY created_at').all(req.params.id);
    res.json({ success: true, files: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/articles/:id/files', upload.single('file'), (req, res) => {
  const articleId = req.params.id;
  const userId = req.body.userId;
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  try {
    const article = db.prepare('SELECT id, category_id FROM wiki_articles WHERE id = ?').get(articleId);
    if (!article) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    if (!checkWikiEditAccess(userId) && !checkCategoryEditor(userId, article.category_id))
      return res.status(403).json({ error: 'Доступ запрещён' });
    // multer может испорпить UTF-8 имена — пробуем восстановить
    let fileName = req.file.originalname;
    try {
      // escape() кодирует Latin-1 байты как %XX, decodeURIComponent декодирует их как UTF-8
      // Если строка уже корректный UTF-8 — escape выдаст %uXXXX, decodeURIComponent кинет ошибку
      fileName = decodeURIComponent(escape(fileName));
    } catch (_) {}
    const id = uuidv4();
    db.prepare('INSERT INTO wiki_article_files (id, article_id, file_name, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, articleId, fileName, req.file.filename, req.file.size, req.file.mimetype);
    const row = db.prepare('SELECT * FROM wiki_article_files WHERE id = ?').get(id);
    res.json({ success: true, file: row });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/articles/:id/files/:fileId', (req, res) => {
  const { userId } = req.body;
  if (!userId || !checkAdmin(userId)) return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const file = db.prepare('SELECT * FROM wiki_article_files WHERE id = ? AND article_id = ?').get(req.params.fileId, req.params.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });
    const fullPath = path.join(UPLOADS_PATH, file.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    db.prepare('DELETE FROM wiki_article_files WHERE id = ?').run(req.params.fileId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HR API
// ============================================

app.post('/api/hr/requests', (req, res) => {
  const { userId, type, startDate, endDate, reason } = req.body;
  if (!userId || !type || !startDate || !endDate) {
    return res.status(400).json({ error: 'userId, type, startDate, endDate обязательны' });
  }
  if (!['vacation', 'sick', 'day_off'].includes(type)) {
    return res.status(400).json({ error: 'Неверный тип заявления' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO hr_requests (id, user_id, type, start_date, end_date, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, type, startDate, endDate, reason || '', now, now);
    const request = db.prepare('SELECT * FROM hr_requests WHERE id = ?').get(id);
    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hr/requests', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const isAdmin = checkAdmin(userId);
    let rows;
    if (isAdmin) {
      rows = db.prepare(`SELECT r.*, u.username as userName FROM hr_requests r LEFT JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC`).all();
    } else {
      rows = db.prepare(`SELECT r.*, u.username as userName FROM hr_requests r LEFT JOIN users u ON r.user_id = u.id WHERE r.user_id = ? ORDER BY r.created_at DESC`).all(userId);
    }
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hr/requests/pending', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  if (!checkAdmin(userId)) return res.status(403).json({ error: 'Только для администраторов' });
  try {
    const rows = db.prepare(`SELECT r.*, u.username as userName FROM hr_requests r LEFT JOIN users u ON r.user_id = u.id WHERE r.status = 'pending' ORDER BY r.created_at ASC`).all();
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hr/requests/:id/approve', (req, res) => {
  const { id } = req.params;
  const { userId, status, comment } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'userId и status обязательны' });
  if (!checkAdmin(userId)) return res.status(403).json({ error: 'Только для администраторов' });
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Статус должен быть approved или rejected' });
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE hr_requests SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    db.prepare("INSERT INTO hr_approvals (request_id, approver_id, status, comment) VALUES (?, ?, ?, ?)")
      .run(id, userId, status, comment || '');

    // Уведомление автору
    const request = db.prepare('SELECT * FROM hr_requests WHERE id = ?').get(id);
    if (request) {
      const label = status === 'approved' ? '✅ Заявление одобрено' : '❌ Заявление отклонено';
      sendFcmNotification(request.user_id, label, `${request.type}: ${request.start_date} - ${request.end_date}`, { requestId: id, type: 'hr_approval' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Announcements API
// ============================================

// Создать объявление (admin only)
app.post('/api/announcements', (req, res) => {
  const { userId, title, content, priority } = req.body;
  if (!userId || !title || !content) {
    return res.status(400).json({ error: 'userId, title и content обязательны' });
  }
  if (!checkAdmin(userId)) {
    return res.status(403).json({ error: 'Только администратор может создавать объявления' });
  }
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const prio = ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
    db.prepare('INSERT INTO announcements (id, title, content, created_by, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, title, content, userId, prio, timestamp);

    // Отправляем push-уведомление всем
    const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    const allUsers = db.prepare('SELECT id FROM users WHERE id != ?').all(userId);
    allUsers.forEach(row => {
      const label = prio === 'urgent' ? '🔴 СРОЧНО' : prio === 'high' ? '🟡 Важно' : '📢 Объявление';
      sendFcmNotification(row.id, label, title, { announcementId: id, type: 'announcement' });
    });

    const announcement = { id, title, content, createdBy: userId, creatorName: sender?.username || '', priority: prio, createdAt: timestamp };

    // Broadcast to all online users
    io.emit('new_announcement', { announcement });

    res.json({ success: true, announcement });
  } catch (err) {
    console.error('Ошибка создания объявления:', err);
    res.status(500).json({ error: 'Ошибка при создании объявления' });
  }
});

// Получить список объявлений (с статусом прочтения для пользователя)
app.get('/api/announcements', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const rows = db.prepare(`
      SELECT a.*, u.username as creatorName,
             (SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = a.id) as readCount,
             (SELECT read_at FROM announcement_reads WHERE announcement_id = a.id AND user_id = ?) as myReadAt
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.created_at DESC
    `).all(userId);

    const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    const announcements = rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      createdBy: row.created_by,
      creatorName: row.creatorName || '',
      priority: row.priority || 'normal',
      readCount: row.readCount || 0,
      totalUsers,
      isRead: !!row.myReadAt,
      myReadAt: row.myReadAt || null,
      createdAt: row.created_at
    }));

    res.json({ success: true, announcements });
  } catch (err) {
    console.error('Ошибка получения объявлений:', err);
    res.status(500).json({ error: 'Ошибка при получении объявлений' });
  }
});

// Отметить объявление как прочитанное
app.post('/api/announcements/:id/read', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    db.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)')
      .run(id, userId, new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отметки прочтения:', err);
    res.status(500).json({ error: 'Ошибка при отметке прочтения' });
  }
});

// ============================================
// Polls API
// ============================================

function getPollWithVotes(pollId, userId) {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return null;
  const votes = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ?').all(pollId);
  const options = JSON.parse(poll.options);
  const totalVotes = votes.length;
  const optionVotes = options.map((_, idx) => votes.filter(v => v.option_index === idx).length);
  const userVotes = db.prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?').all(pollId, userId);

  const isClosed = poll.closes_at && new Date(poll.closes_at) < new Date();
  const hideResults = poll.hide_results_until_close && !isClosed;

  return {
    id: poll.id,
    chatId: poll.chat_id,
    creatorId: poll.creator_id,
    question: poll.question,
    options,
    isAnonymous: !!poll.is_anonymous,
    allowsMultiple: !!poll.allows_multiple,
    totalVotes: isClosed || !hideResults ? totalVotes : 0,
    optionVotes: isClosed || !hideResults ? optionVotes : options.map(() => 0),
    votedIndices: userVotes.map(v => v.option_index),
    createdAt: poll.created_at,
    closesAt: poll.closes_at || null,
    isClosed,
    hideResultsUntilClose: !!poll.hide_results_until_close,
    votesHidden: hideResults
  };
}

// Создать опрос
app.post('/api/polls', (req, res) => {
  const { chatId, userId, question, options, isAnonymous, allowsMultiple, closesAt, hideResultsUntilClose } = req.body;
  if (!chatId || !userId || !question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'chatId, userId, question и options (min 2) обязательны' });
  }
  if (options.length > 10) {
    return res.status(400).json({ error: 'Максимум 10 вариантов ответа' });
  }
  try {
    const pollId = uuidv4();
    db.prepare(`
      INSERT INTO polls (id, chat_id, creator_id, question, options, is_anonymous, allows_multiple, closes_at, hide_results_until_close)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pollId, chatId, userId, question, JSON.stringify(options), isAnonymous ? 1 : 0, allowsMultiple ? 1 : 0, closesAt || null, hideResultsUntilClose ? 1 : 0);

    // Создаём сообщение в чате с poll_id
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, text, poll_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, chatId, userId, '📊 ' + question, pollId, timestamp);

    // Unread for all except creator
    const partRows = db.prepare('SELECT user_id FROM chat_participants WHERE chat_id = ?').all(chatId);
    partRows.forEach(row => {
      if (row.user_id !== userId) {
        db.prepare('INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)').run(row.user_id, messageId, chatId);
      }
    });

    

    const pollData = getPollWithVotes(pollId, userId);

    // Get sender info for broadcast
    const sender = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(userId);

    // Broadcast to chat room (без votedIndices — каждый клиент получает свои через getPollWithVotes)
    const broadcastPoll = { ...pollData };
    delete broadcastPoll.votedIndices;
    const newMessage = {
      id: messageId,
      chatId,
      senderId: userId,
      senderName: sender?.username || '',
      senderAvatar: sender?.avatar || '',
      text: '📊 ' + question,
      file: null,
      reply_to: null,
      replyCount: 0,
      timestamp,
      read_at: null,
      readBy: [],
      forwarded_from: null,
      e2ee: 0,
      poll: broadcastPoll,
      expires_at: null
    };

    // Полная доставка: unread_messages, realtime-рассылка, push офлайн-участникам
    distributeChatMessage(chatId, newMessage, getChatById(chatId) || { id: chatId });

    res.json({ success: true, poll: pollData, messageId, message: newMessage });
  } catch (err) {
    console.error('Ошибка создания опроса:', err);
    res.status(500).json({ error: 'Ошибка при создании опроса' });
  }
});

// Получить опрос
app.get('/api/polls/:pollId', (req, res) => {
  const { pollId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const pollData = getPollWithVotes(pollId, userId);
    if (!pollData) return res.status(404).json({ error: 'Опрос не найден' });
    res.json({ success: true, poll: pollData });
  } catch (err) {
    console.error('Ошибка получения опроса:', err);
    res.status(500).json({ error: 'Ошибка при получении опроса' });
  }
});

// Проголосовать в опросе
app.post('/api/polls/:pollId/vote', (req, res) => {
  const { pollId } = req.params;
  const { userId, optionIndex } = req.body;
  if (!userId || optionIndex === undefined || optionIndex === null) {
    return res.status(400).json({ error: 'userId и optionIndex обязательны' });
  }
  try {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return res.status(404).json({ error: 'Опрос не найден' });
    const options = JSON.parse(poll.options);
    if (optionIndex < 0 || optionIndex >= options.length) {
      return res.status(400).json({ error: 'Неверный индекс варианта' });
    }

    if (!poll.allows_multiple) {
      // Single choice: remove previous votes, insert new one
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
    }
    db.prepare('INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)').run(pollId, userId, optionIndex);

    const pollData = getPollWithVotes(pollId, userId);

    // Broadcast to chat room (без votedIndices — каждый клиент получает свои при загрузке)
    const broadcastPoll = { ...pollData };
    delete broadcastPoll.votedIndices;
    io.to(poll.chat_id).emit('poll_vote', { poll: broadcastPoll });

    res.json({ success: true, poll: pollData });
  } catch (err) {
    console.error('Ошибка голосования:', err);
    res.status(500).json({ error: 'Ошибка при голосовании' });
  }
});

// Отменить голос (снять все голоса пользователя в опросе)
app.post('/api/polls/:pollId/revoke', (req, res) => {
  const { pollId } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return res.status(404).json({ error: 'Опрос не найден' });
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
    const pollData = getPollWithVotes(pollId, userId);
    io.to(poll.chat_id).emit('poll_vote', { poll: pollData });
    res.json({ success: true, poll: pollData });
  } catch (err) {
    console.error('Ошибка отзыва голоса:', err);
    res.status(500).json({ error: 'Ошибка при отзыве голоса' });
  }
});

// Получить опросы чата
app.get('/api/chats/:chatId/polls', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const pollRows = db.prepare('SELECT id FROM polls WHERE chat_id = ? ORDER BY created_at DESC').all(chatId);
    const polls = pollRows.map(r => getPollWithVotes(r.id, userId)).filter(Boolean);
    res.json({ success: true, polls });
  } catch (err) {
    console.error('Ошибка получения опросов чата:', err);
    res.status(500).json({ error: 'Ошибка при получении опросов' });
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
    SELECT u.id, u.username, u.avatar, u.status, u.status_text, u.last_seen
    FROM users u
    JOIN chat_participants cp ON u.id = cp.user_id
    WHERE cp.chat_id = ?
  `).all(chatId);
  const participants = participantsRows.map(row => ({
    id: String(row.id || ''),
    username: String(row.username || ''),
    avatar: String(row.avatar || ''),
    status: String(row.status || 'offline'),
    status_text: row.status_text || '',
    last_seen: row.last_seen || null
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
    avatar: chat.avatar || '',
    created_by: chat.created_by || null,
    participants: participants.map(p => p.username),
    participantsDetails: participants,
    unreadCount,
    lastMessage,
    e2ee: chat.e2ee || 0
  };
}

function getUserChats(userId) {
  const chats = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM unread_messages WHERE chat_id = c.id AND user_id = ?) as unreadCount,
           (SELECT MAX(timestamp) FROM messages WHERE chat_id = c.id) as last_msg_time,
           cs.pinned, cs.muted, cs.force_unread, cs.cleared_at
    FROM chats c
    JOIN chat_participants cp ON c.id = cp.chat_id
    LEFT JOIN chat_user_settings cs ON c.id = cs.chat_id AND cs.user_id = ?
    WHERE cp.user_id = ?
      AND (cs.deleted_at IS NULL OR EXISTS (
        SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.timestamp > cs.deleted_at
      ))
    ORDER BY (cs.pinned = 1) DESC, last_msg_time DESC, c.created_at DESC
  `).all(userId, userId, userId);
  
  return chats.map(chat => {
    // Получаем участников с полными данными
    const participants = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.status, u.status_text, u.full_name, u.birth_date, u.last_seen
      FROM users u
      JOIN chat_participants cp ON u.id = cp.user_id
      WHERE cp.chat_id = ?
    `).all(chat.id);

    const clearedAt = chat.cleared_at || null;

    // Получаем последнее сообщение с аватаром отправителя (после очистки — только новые)
    const msg = db.prepare(`
      SELECT m.*, u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
        AND (m.timestamp > ? OR ? IS NULL)
      ORDER BY m.timestamp DESC
      LIMIT 1
    `).get(chat.id, clearedAt, clearedAt);
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
      id: String(chat.id),
      participants: participants.map(p => p.username),
      participantsDetails: participants,
      unreadCount: chat.unreadCount || 0,
      pinned: !!chat.pinned,
      muted: !!chat.muted,
      forceUnread: !!chat.force_unread,
      lastMessage
    };
  });
}

function getChatMessages(chatId, limit = 100, userId = null, beforeTs = null) {
  try {
    // Учитываем "очистить историю для меня": скрываем сообщения старше cleared_at
    let clearedAt = null;
    if (userId) {
      const clearedRow = db.prepare('SELECT cleared_at FROM chat_user_settings WHERE user_id = ? AND chat_id = ?').get(userId, chatId);
      clearedAt = clearedRow ? clearedRow.cleared_at : null;
    }

    // Сначала получаем последние N сообщений в обратном порядке (новые первые)
    // beforeTs — курсор пагинации: берём сообщения СТАРШЕ указанного timestamp
    // Исключаем просроченные self-destruct сообщения
    const messagesReversed = db.prepare(`
      SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.read_at,
             m.forwarded_from, m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral, m.expires_at, m.edited, m.edited_at,
             m.poll_id,
             u.username as senderName, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
        AND (m.expires_at IS NULL OR m.expires_at > ?)
        AND (? IS NULL OR m.timestamp > ?)
        AND (? IS NULL OR m.timestamp < ?)
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(chatId, new Date().toISOString(), clearedAt, clearedAt, beforeTs, beforeTs, limit);

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
      let poll = null;
      if (row.poll_id) {
        poll = getPollWithVotes(row.poll_id, userId || '');
      }
      messages.push({
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        senderName: row.senderName,
        senderAvatar: row.senderAvatar,
        text: isE2EE ? (row.text || '') : (decryptText(row.text) || ''),
        file: row.file_data && !isBotMessage ? (() => { try { return JSON.parse(row.file_data); } catch { return null; } })() : null,
        poll: poll,
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
        e2ee_ephemeral: isE2EE ? (row.e2ee_ephemeral || '') : undefined,
        expires_at: row.expires_at || null
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
  return db.prepare('SELECT id, username, avatar, status, full_name, birth_date, work_phone, mobile_phone, status_text, about, last_seen FROM users').all();
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
    console.error('Ошибка отправки Web Push:', err.message);
  }
}

function sendFcmNotification(userId, title, body, data) {
  if (typeof admin.getApps !== 'function' || !admin.getApps().length) return;
  try {
    const rows = db.prepare('SELECT token FROM fcm_tokens WHERE user_id = ?').all(userId);
    if (!rows.length) return;
    const message = {
      tokens: rows.map(r => r.token),
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', ttl: 86400000 }
    };
    getMessaging().sendEachForMulticast(message).then(response => {
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
          db.run('DELETE FROM fcm_tokens WHERE token = ?', [rows[idx].token]);
        }
      });
    }).catch(err => console.error('Ошибка отправки FCM:', err.message));
  } catch (err) {
    console.error('Ошибка отправки FCM:', err.message);
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

// Создаёт чат с ботом-помощником для пользователя, если ещё не существует
function ensureBotChat(userId) {
  let botRow = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
  if (!botRow) {
    // Создаём бота если его нет
    const newBotId = 'helper-bot-' + uuidv4().substring(0, 8);
    db.prepare("INSERT INTO users (id, username, avatar, status, is_admin) VALUES (?, 'Помощник', ?, 'online', 0)").run(newBotId, `${SERVER_URL}/uploads/ursa.jpg`);
    botRow = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
    console.log('Создан бот Помощник:', botRow?.id);
  }
  const botId = botRow ? botRow.id : null;
  const botChatId = `bot-chat-${userId}`;
  const botChatCheck = db.prepare('SELECT * FROM chats WHERE id = ?').get(botChatId);
  if (!botChatCheck) {
    db.run(`INSERT INTO chats (id, type, name, created_by, created_at) VALUES (?, 'direct', 'Помощник', ?, CURRENT_TIMESTAMP)`, [botChatId, userId]);
    db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, userId]);
    if (botId) {
      db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, botId]);
    }
    return true;
  }
  // Гарантируем, что пользователь есть в участниках (даже если чат уже существовал)
  const memberCheck = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(botChatId, userId);
  if (!memberCheck) {
    db.run(`INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [botChatId, userId]);
    console.log(`ensureBotChat: участник ${userId} добавлен в существующий чат ${botChatId}`);
  }
  return false;
}

// Фоновая очистка устаревших записей wsRateMap
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [key, entry] of wsRateMap) {
    if (entry.resetAt < cutoff) wsRateMap.delete(key);
  }
}, 60000);

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

/**
 * Единая доставка сообщения в чат: авто-join сокетов участников,
 * простановка unread_messages, realtime-рассылка и push-уведомления (web + FCM)
 * для офлайн-участников. Используется для обычных сообщений и системных
 * (приветствия нового участника, опросы, REST-отправка), чтобы любое
 * сообщение гарантированно отражалось как «новое».
 * @param {string} chatId
 * @param {Object} formattedMessage - готовое сообщение для клиента (text в plaintext)
 * @param {Object|null} chat - объект чата (по умолчанию из БД)
 * @param {Object} opts
 * @param {string} [opts.skipUserId] - участник, которому НЕ ставим unread (отправитель)
 * @param {boolean} [opts.skipPush] - не отправлять push-уведомления
 */
function distributeChatMessage(chatId, formattedMessage, chat = null, opts = {}) {
  if (!chatId || !formattedMessage) return;
  const chatData = chat || getChatById(chatId) || { id: chatId };
  const skipUserId = opts.skipUserId || formattedMessage.senderId;

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

  // Добавляем непрочитанные для всех кроме отправителя (батч)
  const unreadValues = participants
    .filter(pUserId => pUserId !== skipUserId)
    .map(pUserId => `('${pUserId.replace(/'/g, "''")}', '${formattedMessage.id}', '${chatId}')`)
    .join(',');
  if (unreadValues) {
    db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES ${unreadValues}`);
  }

  // Отправляем сообщение всем в чате (включая отправителя)
  io.to(chatId).emit('new_message', {
    message: formattedMessage,
    chat: { ...chatData, unreadCount: 0 }
  });

  if (opts.skipPush) return;

  // Push-уведомления для офлайн-участников
  const onlineUserIds = new Set(Array.from(onlineUsers.values()).map(u => u.id));
  const chatName = getChatDisplayName(chatData);
  participants.forEach(pUserId => {
    if (pUserId === skipUserId || onlineUserIds.has(pUserId)) return;
    // Пропускаем push, если пользователь приглушил чат
    const mutedRow = db.prepare('SELECT muted FROM chat_user_settings WHERE user_id = ? AND chat_id = ?').get(pUserId, chatId);
    if (mutedRow && Number(mutedRow.muted) === 1) return;
    sendPushNotification(pUserId, chatName, formattedMessage.text || '📎 Файл', formattedMessage.senderAvatar, { chatId, messageId: formattedMessage.id });
    sendFcmNotification(pUserId, chatName, (formattedMessage.senderName || '') + ': ' + (formattedMessage.text || '📎 Файл'), { chatId, messageId: formattedMessage.id, senderId: formattedMessage.senderId });
  });
}

/**
 * Доставка сообщения бота в личный чат пользователя (bot-chat-*):
 * простановка unread_messages, realtime-рассылка во все сессии и push офлайн.
 * @param {string} userId - получатель
 * @param {Object} payload - { id, chatId, senderId, senderName, senderAvatar, text, timestamp, isBotMessage, buttons }
 */
function deliverBotMessage(userId, payload) {
  if (!userId || !payload || !payload.chatId || !payload.text) return;

  const messageId = payload.id || uuidv4();
  const ts = payload.timestamp || new Date().toISOString();
  const chatId = payload.chatId;
  const senderName = payload.senderName || 'Помощник';
  const senderAvatar = payload.senderAvatar || 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff';

  db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`, [userId, messageId, chatId]);

  emitToUser(userId, 'new_message', {
    message: {
      id: messageId,
      chatId,
      senderId: payload.senderId,
      senderName,
      senderAvatar,
      text: payload.text,
      timestamp: ts,
      isBotMessage: payload.isBotMessage !== false,
      buttons: payload.buttons || []
    },
    chat: { id: chatId, name: senderName, type: 'direct' }
  });

  const onlineUserIds = new Set(Array.from(onlineUsers.values()).map(u => u.id));
  if (!onlineUserIds.has(userId)) {
    sendPushNotification(userId, senderName, payload.text, senderAvatar, { chatId, messageId });
    sendFcmNotification(userId, senderName, payload.text, { chatId, messageId, senderId: payload.senderId });
  }
}

// Socket.IO подключение
io.on('connection', (socket) => {
  const clientIp = socket.handshake?.address?.replace(/^::ffff:/, '') || 'unknown';
  const userAgent = socket.handshake?.headers?.['user-agent'] || 'unknown';

  // Middleware: проверка членства в чате для отправки сообщений
  socket.use(([event, data], next) => {
    if (event === 'send_message' && data && data.chatId) {
      const onlineUser = onlineUsers.get(socket.id);
      if (onlineUser) {
        const isParticipant = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(data.chatId, onlineUser.id);
        if (!isParticipant) {
          console.warn(`WS middleware: socket ${socket.id} пытается отправить сообщение в чат ${data.chatId} без членства`);
          socket.emit('error', { message: 'Вы не являетесь участником этого чата. Попробуйте переподключиться.' });
          return;
        }
      }
    }
    next();
  });

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
    const { userId, email, username, deviceId, deviceName, appVersion } = data || {};

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

      // Сохраняем запись для админ-панели сессий
      try {
        const adminSessionId = uuidv4();
        const ipAddr = socket.handshake?.address || '';
        const browserInfo = socket.handshake?.headers?.['user-agent'] || '';
        db.run(`INSERT OR IGNORE INTO admin_user_sessions (id, user_id, socket_id, ip_address, browser, login_time, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [adminSessionId, user.id, socket.id, ipAddr, browserInfo, new Date().toISOString(), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения админ-сессии:', e.message);
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

      // Сохраняем версию клиента
      if (appVersion) {
        db.run('UPDATE users SET app_version = ? WHERE id = ?', [String(appVersion).slice(0, 50), user.id]);
      }
      

      // Отправляем пользователю его чаты
      let userChats = getUserChats(user.id);

      // Создаём чат с помощником если не существует
      if (ensureBotChat(user.id)) {
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
    const { username, userId: existingUserId, appVersion } = data;

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

      // Сохраняем версию клиента
      if (appVersion) {
        db.run('UPDATE users SET app_version = ? WHERE id = ?', [String(appVersion).slice(0, 50), user.id]);
      }

      // Сохраняем запись для админ-панели сессий
      try {
        const adminSessionId = uuidv4();
        const ipAddr = socket.handshake?.address || '';
        const browserInfo = socket.handshake?.headers?.['user-agent'] || '';
        db.run(`INSERT OR IGNORE INTO admin_user_sessions (id, user_id, socket_id, ip_address, browser, login_time, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [adminSessionId, user.id, socket.id, ipAddr, browserInfo, new Date().toISOString(), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения админ-сессии:', e.message);
      }
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
    if (ensureBotChat(user.id)) {
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
      const botChatId = `bot-chat-${user.id}`;
      setTimeout(() => {
        try {
          const welcomeMessage = `👋 Здравствуйте, ${user.username}!

Я 🤖 Помощник. Рад видеть вас в команде!

💡 *Совет:* Начните с обучения — это займёт 2 минуты.`;

          const welcomeButtons = [
            { label: '🎯 Пройти обучение', action: '/онбординг' },
            { label: '❓ Все команды', action: '/помощь' }
          ];

          sendBotMessage(socket, botChatId, welcomeMessage, welcomeButtons);
        } catch (e) {
          console.error('Ошибка отправки личного приветствия:', e.message);
        }
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
        try {
          const welcomeText = `👋 Коллеги, поприветствуйте нового участника — **[${user.username}](user:${user.username})**!

Рады видеть вас в нашей команде! 🎉`;

          // Отправляем сообщение в общий чат от имени помощника
          const botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
          if (botResult) {
            const botId = botResult.id;
            const messageId = uuidv4();
            const encryptedText = encryptText(welcomeText || '');
            const timestamp = new Date().toISOString();

            db.run(`
              INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
              VALUES (?, 'general', ?, ?, ?)
            `, [messageId, botId, encryptedText, timestamp]);

            // Отправляем всем в общий чат через единый конвейер доставки:
            // unread_messages + realtime-рассылка + push для офлайн-участников
            distributeChatMessage('general', {
              id: messageId,
              chatId: 'general',
              senderId: botId,
              senderName: 'Помощник',
              senderAvatar: 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff',
              text: welcomeText,
              timestamp,
              isBotMessage: true,
              buttons: []
            }, null, { skipUserId: botId, skipPush: false });
          }
        } catch (e) {
          console.error('Ошибка отправки объявления о новом пользователе:', e.message);
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
      
    }

    // Очищаем непрочитанные
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    db.run('UPDATE chat_user_settings SET force_unread = 0 WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    

    
    // Отправляем историю сообщений
    const chatMessages = getChatMessages(chatId, 100, onlineUser.id);
    const hasMoreHistory = chatMessages.length >= 100;
    const chat = getChatWithDetails(chatId);

    socket.emit('chat_history', {
      chatId,
      messages: chatMessages,
      hasMore: hasMoreHistory,
      chat
    });
  });

  // Пагинация истории: порция сообщений СТАРШЕ курсора before (timestamp)
  socket.on('get_messages_before', ({ chatId, before, limit = 50 }, callback) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser || !chatId || !before) return;
    if (typeof callback !== 'function') return;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const older = getChatMessages(chatId, lim + 1, onlineUser.id, String(before));
    const hasMore = older.length > lim;
    const batch = hasMore ? older.slice(0, lim) : older;

    callback({ messages: batch, hasMore });
  });

  // Возвращает отображаемое имя чата (для direct — имя собеседника)
  // (определение вынесено на модульный уровень: getChatDisplayName)

  // Отправка сообщения
  socket.on('send_message', (data) => {
    if (!checkWsRateLimit(socket.id)) {
      socket.emit('error', { message: 'Слишком много запросов. Подождите.' });
      return;
    }
    const { chatId, text, file, forwardedFrom, replyTo, e2ee, e2ee_nonce, e2ee_ephemeral, expiresAt } = data;
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
      const expiresAtStr = expiresAt || null;
      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, file_data, reply_to, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [messageId, chatId, onlineUser.id, storedText, fileDataStr, replyToStr, timestamp, forwardedFromStr, storedE2EE, storedNonce, storedEphemeral, expiresAtStr]);

      // Помечаем активность БД — перезапускает таймер автосохранения
      

      // Получаем информацию о сообщении
      const msgRow = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,
               m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral, m.expires_at,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(messageId);
      let messageRow = null;
      let isE2EE = false;
      if (msgRow) {
        isE2EE = msgRow.e2ee === 1 || msgRow.e2ee === true;
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
          e2ee_ephemeral: isE2EE ? String(msgRow.e2ee_ephemeral || '') : undefined,
          expires_at: msgRow.expires_at || null
        };
      }

      if (!messageRow) {
        console.error('[send_message] не удалось получить сообщение после вставки, messageId:', messageId);
        return;
      }

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
        e2ee_ephemeral: messageRow.e2ee_ephemeral,
        expires_at: messageRow.expires_at || null
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

      // Отправляем сообщение всем в чате (включая отправителя):
      // unread_messages для непрочитанных, realtime-рассылка и push офлайн-участникам
      distributeChatMessage(chatId, formattedMessage, chat, { skipUserId: onlineUser.id });

      // @mentions: уведомляем упомянутых пользователей
      if (formattedMessage.text && !isE2EE) {
        const mentionRegex = /@(\S+)/g;
        let match;
        const participantsWithUsers = db.prepare(`
          SELECT u.id, u.username FROM chat_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.chat_id = ?
        `).all(chatId);
        while ((match = mentionRegex.exec(formattedMessage.text)) !== null) {
          const mentionedUsername = match[1];
          const mentionedUser = participantsWithUsers.find(p => p.username === mentionedUsername);
          if (mentionedUser && mentionedUser.id !== onlineUser.id) {
            emitToUser(mentionedUser.id, 'user_mentioned', {
              chatId,
              messageId,
              senderName: onlineUser.username,
              senderAvatar: onlineUser.avatar || '',
              text: formattedMessage.text
            });
          }
        }
      }
      
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

      // Проверяем настройки бота
      const getBotSetting = (key) => {
        try {
          const row = db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?').get(key);
          return row ? row.setting_value === '1' : true;
        } catch (e) { return true; }
      };

      // State machine: проверяем контекст разговора
      const stateResult = processConversationState(conversationStates, sendBotMessage, socket, chatId, text, { db, uuidv4, io });

      if (stateResult.handled) {
        return;
      }

      // Если это команда начала нового диалога
      if (isDialogStartCommand(text)) {
        const cleanCommand = text.trim().toLowerCase();
        // Проверяем, включена ли функция
        let featureEnabled = true;
        if (cleanCommand === '/создать задачу') featureEnabled = getBotSetting('task_creation_enabled');
        else if (cleanCommand === '/забронировать переговорку') featureEnabled = getBotSetting('booking_enabled');
        else if (cleanCommand === '/создать опрос') featureEnabled = getBotSetting('poll_creation_enabled');
        else if (cleanCommand === '/обратиться в поддержку') featureEnabled = getBotSetting('support_enabled');
        if (!featureEnabled) {
          sendBotMessage(socket, chatId, '😕 Эта функция временно отключена администратором.', []);
          return;
        }
        startConversation(conversationStates, sendBotMessage, socket, chatId, cleanCommand);
        botAnalytics.recordCommand(cleanCommand);
        return;
      }

      // Обычные команды с данными
      if (command === '/сегодня') {
        handleTodayCommand({ db, sendBotMessage, socket, chatId }, onlineUser);
        botAnalytics.recordCommand('/сегодня');
        return;
      }

      if (command === '/контакты') {
        handleContactsCommand({ db, sendBotMessage, socket, chatId });
        botAnalytics.recordCommand('/контакты');
        return;
      }

      // Поиск по wiki
      if ((command === '/поиск_вики' || text.toLowerCase().includes('поиск вики') || text.toLowerCase().includes('найди в базе знаний')) && getBotSetting('wiki_search_enabled')) {
        const query = text.replace(/\/\w+\s*/, '').trim();
        if (query.length < 2) {
          sendBotMessage(socket, chatId, '🔍 *Поиск по базе знаний*\n\nНапишите, что ищете, после команды.\n\nНапример: *найди в базе знаний как создать чат*', []);
        } else {
          try {
            const onlineUser = onlineUsers.get(socket.id);
            const botUserId = onlineUser ? onlineUser.id : null;
            let botSql = `
              SELECT id, title, content, category_id, access_level, created_by,
                     (SELECT name FROM wiki_categories WHERE id = wiki_articles.category_id) as category_name
              FROM wiki_articles
              WHERE (title LIKE ? OR content LIKE ?)`;
            const botParams = [`%${query}%`, `%${query}%`];

            if (botUserId) {
              const isBotAdmin = checkAdmin(botUserId);
              if (!isBotAdmin) {
                botSql += ` AND (
                  access_level IS NULL OR
                  access_level = 'public' OR
                  created_by = ? OR
                  (access_level = 'selected' AND id IN (
                    SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
                  ))
                )`;
                botParams.push(botUserId, botUserId);
              }
            }

            botSql += ' ORDER BY views DESC LIMIT 5';
            const results = db.prepare(botSql).all(...botParams);
            if (results.length === 0) {
              sendBotMessage(socket, chatId, `🔍 По запросу "${query}" ничего не найдено в базе знаний.`, []);
            } else {
              let response = `🔍 *Результаты поиска по запросу:* "${query}"\n\n`;
              results.forEach((r, i) => {
                const snippet = r.content.replace(/<[^>]*>/g, '').substring(0, 100);
                response += `${i+1}. *${r.title}*${r.category_name ? ` (${r.category_name})` : ''}\n   ${snippet}...\n\n`;
              });
              sendBotMessage(socket, chatId, response, [{ label: '📚 База знаний', action: '/база_знаний' }]);
            }
          } catch (e) {
            sendBotMessage(socket, chatId, '😕 Ошибка поиска по базе знаний.', []);
          }
        }
        botAnalytics.recordCommand('/поиск_вики');
        return;
      }

      // Поиск файлов
      if ((command === '/поиск_файлов' || text.toLowerCase().includes('поиск файл') || text.toLowerCase().includes('найди файл')) && getBotSetting('file_search_enabled')) {
        const query = text.replace(/\/\w+\s*/, '').trim();
        if (query.length < 2) {
          sendBotMessage(socket, chatId, '🔍 *Поиск файлов*\n\nНапишите название файла после команды.\n\nНапример: *найди файл отчёт*', []);
        } else {
          try {
            const results = db.prepare(`
              SELECT m.id, m.chat_id, m.file_data, m.timestamp, m.sender_id, u.username as sender_name,
                     c.name as chat_name
              FROM messages m
              JOIN users u ON m.sender_id = u.id
              LEFT JOIN chats c ON m.chat_id = c.id
              WHERE m.file_data IS NOT NULL AND m.file_data LIKE ?
              ORDER BY m.timestamp DESC LIMIT 10
            `).all(`%${query}%`);
            if (results.length === 0) {
              sendBotMessage(socket, chatId, `🔍 Файлы по запросу "${query}" не найдены.`, []);
            } else {
              let response = `🔍 *Найдено файлов:* ${results.length}\n\n`;
              results.forEach((r, i) => {
                let fileName = r.file_data;
                try {
                  const parsed = JSON.parse(r.file_data);
                  fileName = parsed.name || parsed.fileName || r.file_data;
                } catch (e) {}
                response += `${i+1}. 📎 ${fileName}\n   Отправил: ${r.sender_name}\n   Чат: ${r.chat_name || '—'}\n   ${new Date(r.timestamp).toLocaleString('ru-RU')}\n\n`;
              });
              sendBotMessage(socket, chatId, response, []);
            }
          } catch (e) {
            sendBotMessage(socket, chatId, '😕 Ошибка поиска файлов.', []);
          }
        }
        botAnalytics.recordCommand('/поиск_файлов');
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

      // Показываем индикатор печати бота
      socket.emit('bot_typing', { chatId, isTyping: true });

      // Отправляем ответ с небольшой задержкой для естественности
      setTimeout(() => {
        socket.emit('bot_typing', { chatId, isTyping: false });
        sendBotMessage(socket, chatId, botResponse.text, botResponse.buttons || []);
      }, 500);
      // Онбординг: отмечаем завершение
      if (command === '/онбординг_финиш') {
        try {
          const userId = chatId.replace('bot-chat-', '');
          db.run('UPDATE users SET onboarding_completed = 1 WHERE id = ?', [userId]);
        } catch (e) {}
      }
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
      db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`, [targetUserId, formattedMessage.id, chat.id]);
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

  // Отправка статьи из базы знаний
  socket.on('wiki_share', (data) => {
    const { articleId, articleTitle, targetUserId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !articleId || !articleTitle || !targetUserId) return;

    let chat = getDirectChatBetweenUsers(onlineUser.id, targetUserId);

    if (!chat) {
      const chatId = uuidv4();
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      
      chat = { id: chatId, type: 'direct' };
    }

    if (!chat || !chat.id) return;

    const newMessageId = uuidv4();
    const timestamp = new Date().toISOString();
    const text = `📖 Статья в базе знаний: ${articleTitle}\nwiki://${articleId}`;

    db.prepare(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`)
      .run(newMessageId, chat.id, onlineUser.id, text, timestamp);
    

    const formattedMessage = {
      id: newMessageId,
      chatId: chat.id,
      senderId: onlineUser.id,
      senderName: onlineUser.username,
      text,
      timestamp,
      file: null
    };

    db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`, [targetUserId, newMessageId, chat.id]);
    emitToUser(targetUserId, 'new_message', {
      message: formattedMessage,
      chat: { id: chat.id, type: chat.type, unreadCount: 1 }
    });

    const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
    if (chatWithUnread) {
      emitToUser(targetUserId, 'chat_updated', {
        chatId: chat.id,
        chat: chatWithUnread
      });
    }

    socket.emit('new_message', {
      message: formattedMessage,
      chat: { id: chat.id, type: chat.type, unreadCount: 0 },
      isOwnMessage: true
    });

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
    // Для не-E2EE сообщений расшифровываем перед отправкой (как в send_message)
    const emitText = isEditE2EE ? storedEditText : decryptText(storedEditText);
    io.to(chatId).emit('message_edited', {
      messageId,
      newText: emitText,
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

    // Сначала получаем ID сообщений, которые будут отмечены как прочитанные
    const affectedMessages = db.prepare(`
      SELECT id, sender_id FROM messages WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
    `).all(chatId, onlineUser.id);

    if (affectedMessages.length > 0) {
      db.run(`
        UPDATE messages 
        SET read_at = ? 
        WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
      `, [now, chatId, onlineUser.id]);

      // Сохраняем факт прочтения для каждого сообщения
      const insertRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)');
      const batchInsert = db.transaction((msgs) => {
        for (const msg of msgs) {
          insertRead.run(msg.id, onlineUser.id, now);
        }
      });
      batchInsert(affectedMessages);
    }

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
    const now = new Date().toISOString();
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
        db.run("UPDATE users SET status = 'offline', last_seen = ? WHERE id = ?", [now, onlineUser.id]);
        io.emit('user_status_changed', {
          userId: onlineUser.id,
          username: onlineUser.username,
          status: 'offline',
          last_seen: now
        });
        userActivity.delete(onlineUser.id);
      }

      onlineUsers.delete(socket.id);
      botRateLimit.delete(socket.id); // Очистка rate-limiting при отключении
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
    const thoughts = require('./daily-thoughts.json');
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

setTimeout(scheduleDailyThoughtChecker, 12000);

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
  db = getDb();

  // Сохранение БД при фатальной ошибке (см. src/logger.js → uncaughtException)
  registerFatalSaveHook(() => {
    if (db) {
      try { saveDatabaseSync(); } catch (e) {}
      try { db.close(); } catch (e) {}
    }
  });

  console.log('initDatabase завершено успешно, запуск сервера...');

  // State machine + аналитика бота
  const { BotAnalytics } = require('./bot/state');
  conversationStates = new Map();
  // Фоновая очистка заброшенных диалогов с ботом (каждые 5 мин)
  setInterval(() => {
    const now = Date.now();
    for (const [key, state] of conversationStates) {
      const age = state.lastActivity ? now - state.lastActivity : 0;
      if (age > 60 * 60 * 1000) {
        conversationStates.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  botAnalytics = new BotAnalytics();

  // Инициализация бота-помощника (после того как db готов)
  bot = initBotEngine({ db, io, uuidv4, encryptText });
  console.log('🤖 Бот-помощник инициализирован');

  // ─── Анонс новых версий ботом «Помощник» ───
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  } catch (e) {
    console.error('Ошибка создания app_meta:', e.message);
  }

  function getMeta(key) {
    try {
      const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (e) { return null; }
  }

  function setMeta(key, value) {
    try {
      db.run(`INSERT INTO app_meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
    } catch (e) {
      console.error('Ошибка записи app_meta:', e.message);
    }
  }

  async function fetchLatestReleaseInfo() {
    const response = await fetch('https://api.github.com/repos/AmiD4567/chatursa/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'chat-app'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const version = (data.tag_name || '').replace(/^v/i, '');
    if (!version) return null;
    return {
      version,
      notes: String(data.body || ''),
      releaseUrl: data.html_url || ''
    };
  }

  async function announceNewRelease() {
    try {
      const release = await fetchLatestReleaseInfo();
      if (!release) return;

      const announced = getMeta('announcedVersion');
      if (announced === release.version) return;
      if (announced && compareVersions(release.version, announced) <= 0) {
        setMeta('announcedVersion', release.version);
        return;
      }

      // Готовим текст в формате бота (**жирный**, • списки, ссылки кликабельны)
      let body = release.notes
        .split('\n')
        .map(line => {
          const t = line.trim();
          if (t.startsWith('- ')) return '• ' + t.slice(2);
          if (t.startsWith('### ')) return '**' + t.slice(4) + '**';
          if (t.startsWith('## ')) return '**' + t.slice(3) + '**';
          return line;
        })
        .join('\n')
        .trim();
      if (body.length > 1200) body = body.slice(0, 1197) + '...';

      let text = `🚀 **Вышла новая версия ChatApp v${release.version}!**`;
      if (body) text += `\n\n**Что нового:**\n${body}`;
      if (release.releaseUrl) text += `\n\n🔗 Полный список изменений: ${release.releaseUrl}`;
      text += `\n\n🔄 Обновление установится автоматически при перезапуске приложения.`;

      const botUser = db.prepare("SELECT id, username, avatar FROM users WHERE username = 'Помощник'").get();
      if (!botUser) {
        console.error('[ReleaseAnnounce] Бот Помощник не найден в базе');
        return;
      }

      const usersList = db.prepare("SELECT id FROM users WHERE username != 'Помощник'").all();
      let sent = 0;
      for (const user of usersList) {
        try {
          // Гарантируем, что диалог с ботом есть в списке чатов пользователя
          ensureBotChat(user.id);
          const botChatId = `bot-chat-${user.id}`;
          const messageId = uuidv4();
          const timestamp = new Date().toISOString();

          db.run(
            `INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
            [messageId, botChatId, botUser.id, encryptText(text), timestamp]
          );
          db.run(
            'INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)',
            [user.id, messageId, botChatId]
          );

          // Живая доставка во ВСЕ сессии пользователя (не через комнаты сокетов)
          emitToUser(user.id, 'new_message', {
            message: {
              id: messageId,
              chatId: botChatId,
              senderId: botUser.id,
              senderName: 'Помощник',
              senderAvatar: botUser.avatar || 'https://ui-avatars.com/api/?name=🤖&background=667eea&color=fff',
              text,
              file: null,
              reply_to: null,
              timestamp
            },
            chat: { id: botChatId, name: 'Помощник', type: 'direct' }
          });
          sent++;
        } catch (err) {
          console.error(`[ReleaseAnnounce] Ошибка отправки пользователю ${user.id}:`, err.message);
        }
      }

      setMeta('announcedVersion', release.version);
      console.log(`[ReleaseAnnounce] Анонс v${release.version} отправлен ${sent} пользователям`);
    } catch (err) {
      console.error('[ReleaseAnnounce] Ошибка анонса релиза:', err.message);
    }
  }

  // Проверка релизов: через 30с после старта сервера и далее раз в час
  setTimeout(() => {
    announceNewRelease();
    setInterval(announceNewRelease, 60 * 60 * 1000);
  }, 30 * 1000);

  // Загружаем квоты загрузок из БД
  try {
    const quotaRows = db.prepare(`
      SELECT u.id,       COALESCE(SUM(JSON_EXTRACT(m.file_data, '$.size')), 0) as total
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

  const { registerPbiRoutes } = require('./pbi-proxy.js');
  registerPbiRoutes(app, db);

  const { registerKpiRoutes } = require('./kpi.js');
  registerKpiRoutes(app, db);

  // Global error handler — returns JSON instead of HTML
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Ошибка загрузки файла: ${err.message}` });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  httpServer.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? getLocalIP() : HOST;
    console.log(`HTTP сервер запущен на http://${displayHost}:${PORT}`);
    console.log(`URL для клиентов: ${SERVER_URL}`);
    console.log(`База данных: ${DB_PATH}`);
    console.log(`Путь загрузок: ${UPLOADS_PATH}`);

    // Очистка self-destruct сообщений каждые 10 секунд
    setInterval(() => {
      try {
        const now = new Date().toISOString();
        const expiredMessages = db.prepare(`
          SELECT id, chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?
        `).all(now);
        for (const msg of expiredMessages) {
          db.run('DELETE FROM messages WHERE id = ?', [msg.id]);
          db.run('DELETE FROM message_reactions WHERE message_id = ?', [msg.id]);
          io.to(msg.chat_id).emit('message_deleted', {
            messageId: msg.id,
            deletedBy: 'system',
            chatId: msg.chat_id
          });
        }
        if (expiredMessages.length > 0) {
          
        }
      } catch (e) {
        console.error('Ошибка очистки self-destruct сообщений:', e.message);
      }
    }, 10000);

    // Проверка напоминаний о встречах каждые 30 секунд
    setInterval(() => {
      try {
        const now = new Date().toISOString().slice(0, 19);
        const dueReminders = db.prepare(`
          SELECT id, organizer_id, organizer_name, title, meeting_date, start_time, end_time, reminder_minutes
          FROM meeting_room_bookings
          WHERE reminder_time IS NOT NULL
            AND reminder_time <= ?
            AND (reminder_sent IS NULL OR reminder_sent = 0)
        `).all(now);

        if (dueReminders.length > 0) {
          console.log(`[Reminder] Найдено ${dueReminders.length} просроченных напоминаний`);
        }

        for (const reminder of dueReminders) {
          console.log(`[Reminder] Обработка напоминания #${reminder.id}: ${reminder.title}, встреча ${reminder.meeting_date} ${reminder.start_time}`);
          
          // Получаем участников встречи
          const participants = db.prepare(`
            SELECT user_id, username FROM meeting_room_booking_participants WHERE booking_id = ?
          `).all(reminder.id);

          // Собираем всех, кому отправить уведомление (организатор + участники)
          const notifyUserIds = new Set();
          notifyUserIds.add(reminder.organizer_id);
          for (const p of participants) {
            notifyUserIds.add(p.user_id);
          }

          console.log(`[Reminder] Получатели:`, Array.from(notifyUserIds));

          for (const userId of notifyUserIds) {
            sendMeetingReminder(userId, reminder);
          }

          // Помечаем напоминание как отправленное
          db.run('UPDATE meeting_room_bookings SET reminder_sent = 1 WHERE id = ?', [reminder.id]);
          console.log(`[Reminder] Напоминание #${reminder.id} помечено как отправленное`);
        }
      } catch (e) {
        console.error('Ошибка проверки напоминаний о встречах:', e.message);
      }
    }, 30000);
  });

  if (httpsServer) {
    httpsServer.on('error', (err) => {
      console.error(`HTTPS сервер не смог запуститься на порту ${HTTPS_PORT}: ${err.message}`);
    });
    httpsServer.listen(HTTPS_PORT, HOST, () => {
      const displayHost = HOST === '0.0.0.0' ? getLocalIP() : HOST;
      console.log(`HTTPS сервер запущен на https://${displayHost}:${HTTPS_PORT}`);
    });
  }
} catch (err) {
  console.error('Ошибка инициализации БД:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
}
