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

  // ── Регистрация REST-роутов (после инициализации БД и бота) ──
  const sharedDeps = {
    db, io, onlineUsers, userActivity, userSocketMap, getUserSockets, emitToUser,
    upload, SERVER_URL, UPLOADS_PATH,
    encryptText, decryptText, isEncrypted,
    uuidv4, bcrypt, speakeasy, QRCode, webPush, admin, getMessaging,
    checkAdmin, checkWikiEditAccess, checkArticleAccess, checkCategoryEditor,
    checkRateLimit, registerAttempts, loginAttempts, userTotalUploadSize, DEFAULT_UPLOAD_QUOTA,
    getUserById, getChatById, getDirectChatBetweenUsers, getChatWithDetails,
    getUserChats, getChatMessages, getAllUsers, generateUserId, getClientIp, getClientHost,
    distributeChatMessage, sendPushNotification, sendFcmNotification, sendBotMessage,
    getBotResponse, ensureBotChat, deliverBotMessage, getChatDisplayName
  };
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
