/**
 * Сообщения: история, поиск, орфография, отправка, треды, пересылка. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const https = require('https');

module.exports = function register(app, deps) {
  const { db, emitToUser, encryptText, decryptText, uuidv4, checkAdmin, getChatById, getChatMessages, distributeChatMessage } = deps;
  // Сборка истории: сообщения с опросами требуют getPollWithVotes (общая фабрика из src/utils.js)
  const { createGetPollWithVotes } = require('../utils');
  const getPollWithVotes = createGetPollWithVotes(db);

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

// Полный список изображений чата (для галереи — независимо от загруженной порции истории)
app.get('/api/messages/:chatId/images', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.query;

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    // Уважаем «Очистить историю для меня»: изображения ≤ cleared_at не показываем
    const clearedRow = db.prepare('SELECT cleared_at FROM chat_user_settings WHERE user_id = ? AND chat_id = ?').get(userId, chatId);
    const clearedAt = clearedRow ? clearedRow.cleared_at : null;

    const rows = db.prepare(`
      SELECT m.id, m.timestamp, m.file_data
      FROM messages m
      WHERE m.chat_id = ?
        AND m.file_data IS NOT NULL
        AND JSON_EXTRACT(m.file_data, '$.mimetype') LIKE 'image/%'
        AND (? IS NULL OR m.timestamp > ?)
      ORDER BY m.timestamp ASC
      LIMIT 1000
    `).all(chatId, clearedAt, clearedAt);

    const images = [];
    for (const row of rows) {
      try {
        const f = JSON.parse(row.file_data);
        if (!f || !f.url) continue;
        images.push({
          id: row.id,
          url: f.url,
          filename: f.filename || 'image',
          timestamp: row.timestamp
        });
      } catch { /* битый file_data пропускаем */ }
    }

    res.json({ success: true, images });
  } catch (err) {
    console.error('Ошибка получения изображений чата:', err);
    res.status(500).json({ error: 'Ошибка получения изображений' });
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
};
