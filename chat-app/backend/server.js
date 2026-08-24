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

// Middleware-цепочка вынесена в src/middleware.js
require('./src/middleware').setupMiddleware(app);


// ============================================
// API для проверки версии и обновлений
// ============================================

// Получение текущей версии приложения из package.json

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
      -- Пустые direct-чаты (созданные без единого сообщения) не показываем.
      -- Исключение: чат бота-помощника (создаётся без приветствия).
      AND (
        c.type != 'direct'
        OR c.id LIKE 'bot-chat-%'
        OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id)
      )
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
const { compareVersions, createGetPollWithVotes } = require('./src/utils');

// Инициализация движка бота (после определения db, uuidv4, encryptText)
let bot; // будет инициализирован ниже после определения send_message handler

// Привязывается к db после initDatabase(); используется в getChatMessages
let getPollWithVotes = null;

// Функция напоминаний о встречах из jobs.js (заполняется после setupJobs)
let sendMeetingReminder = null;

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

// Socket-обработчики вынесены в src/socket.js

// Закрытие и сохранение БД при завершении
process.on('SIGINT', () => {
  console.log('Остановка сервера...');
  
  // Сначала закрываем все socket.io соединения
  if (io) {
    io.close();
  }
  
  // Небольшая задержка перед закрытием БД
  setTimeout(() => {
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
  getPollWithVotes = createGetPollWithVotes(db);

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

  // ── Регистрация REST-роутов (после инициализации БД и бота) ──
  const sharedDeps = {
    db, io, onlineUsers, userActivity, userSocketMap, getUserSockets, emitToUser,
    upload, SERVER_URL, UPLOADS_PATH,
    encryptText, decryptText, isEncrypted,
    uuidv4, bcrypt, speakeasy, QRCode, webPush, admin, getMessaging,
    checkAdmin, checkWikiEditAccess, checkArticleAccess, checkCategoryEditor,
    checkRateLimit, registerAttempts, loginAttempts, userTotalUploadSize, DEFAULT_UPLOAD_QUOTA,
    botRateLimit, wsRateMap, checkWsRateLimit, conversationStates, botAnalytics,
    getUserById, getUserByUsername, getChatById, getDirectChatBetweenUsers, getChatWithDetails,
    getUserChats, getChatMessages, getAllUsers, generateUserId, getClientIp, getClientHost,
    distributeChatMessage, sendPushNotification, sendFcmNotification, sendBotMessage,
    getBotResponse, ensureBotChat, deliverBotMessage, getChatDisplayName
  };
  // ── Socket-обработчики и фоновые задачи ──
  require('./src/socket')(sharedDeps);
  const jobsApi = require('./src/jobs');
  jobsApi.setupJobs(sharedDeps);
  sharedDeps.scheduleTaskReminder = jobsApi.scheduleTaskReminder;

  // Функции из jobs.js, нужные остальным частям server.js
  sendMeetingReminder = jobsApi.sendMeetingReminder;
  // Восстановить незавершённые напоминания задач после рестарта
  if (typeof jobsApi.restorePendingReminders === 'function') {
    try { jobsApi.restorePendingReminders(); } catch (e) { console.error('restorePendingReminders:', e.message); }
  }
  // Ежедневная проверка дней рождения (уважает настройку бота birthday_notifications_enabled)
  if (typeof jobsApi.scheduleBirthdayChecker === 'function') {
    try { jobsApi.scheduleBirthdayChecker(); } catch (e) { console.error('scheduleBirthdayChecker:', e.message); }
  }

  require('./src/routes/admin')(app, sharedDeps);
  require('./src/routes/auth')(app, sharedDeps);
  require('./src/routes/chats')(app, sharedDeps);
  require('./src/routes/files')(app, sharedDeps);
  require('./src/routes/calendar')(app, sharedDeps);
  require('./src/routes/push')(app, sharedDeps);
  require('./src/routes/messages')(app, sharedDeps);
  require('./src/routes/misc')(app, sharedDeps);
  require('./src/routes/bot-api')(app, sharedDeps);
  require('./src/routes/wiki')(app, sharedDeps);
  require('./src/routes/hr')(app, sharedDeps);
  require('./src/routes/announcements')(app, sharedDeps);
  require('./src/routes/polls')(app, sharedDeps);
  require('./src/routes/calls')(app, sharedDeps);

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
            if (typeof sendMeetingReminder === 'function') {
              sendMeetingReminder(userId, reminder);
            }
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
