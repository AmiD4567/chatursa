/**
 * Отложенная отправка сообщений.
 *
 * Пользователь планирует отправку на будущее время; даже если приложение
 * закрыто — сообщение уйдёт в назначенный момент. Планировщик опрашивает
 * таблицу scheduled_messages, поэтому переживает рестарт сервера (в отличие
 * от хрупких setTimeout в памяти).
 *
 * Отправка идёт тем же путём, что и обычный send_message:
 * вставка в messages + distributeChatMessage (realtime, unread, push).
 */

let db, emitToUser, encryptText, uuidv4, getChatById, getChatWithDetails, distributeChatMessage;

const POLL_INTERVAL = 20000;   // период опроса БД
const BATCH_LIMIT = 50;        // максимум сообщений за один проход
let pollTimer = null;
let processing = false;

/**
 * Инициализация планировщика. Вызывается один раз после initDatabase()
 * и регистрации сокетов (нужны distributeChatMessage/emitToUser).
 */
function setupScheduled(deps) {
  ({ db, emitToUser, encryptText, uuidv4, getChatById, getChatWithDetails, distributeChatMessage } = deps);

  pollTimer = setInterval(processDueScheduled, POLL_INTERVAL);
  if (pollTimer.unref) pollTimer.unref();
  // Первый проход — с небольшой задержкой, чтобы БД и сокеты были готовы
  setTimeout(processDueScheduled, 15000);
  console.log(`⏳ Планировщик отложенных сообщений запущен (каждые ${POLL_INTERVAL / 1000}с)`);
}

/**
 * Обработать все просроченные отложенные сообщения.
 */
function processDueScheduled() {
  if (processing) return;
  processing = true;
  try {
    const now = Date.now();
    const due = db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE status = 'pending' AND scheduled_at_ms <= ?
      ORDER BY scheduled_at_ms ASC
      LIMIT ?
    `).all(now, BATCH_LIMIT);

    for (const row of due) {
      try {
        sendScheduled(row);
      } catch (err) {
        // sendScheduled сам помечает запись как failed; здесь только лог
        console.error(`[scheduled] ошибка записи ${row.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Ошибка обработки отложенных сообщений:', err.message);
  } finally {
    processing = false;
  }
}

/**
 * Отправить одно отложенное сообщение.
 * Идемпотентность: запись атомарно «захватывается» (pending → processing),
 * поэтому при нескольких инстансах/проходах отправка не задублируется.
 */
function sendScheduled(row) {
  const claim = db.prepare(
    "UPDATE scheduled_messages SET status = 'processing' WHERE id = ? AND status = 'pending'"
  ).run(row.id);
  if (claim.changes === 0) return;

  const chatId = row.chat_id;
  const senderId = row.user_id;

  try {
    const payload = JSON.parse(row.payload || '{}');

    const chat = getChatById(chatId);
    if (!chat) throw new Error('chat_not_found');

    const sender = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(senderId);
    if (!sender) throw new Error('user_not_found');

    const text = typeof payload.text === 'string' ? payload.text : '';
    const isE2EE = !!payload.e2ee;
    // E2EE: храним ciphertext как есть; обычное — серверное шифрование
    const storedText = isE2EE ? text : encryptText(text);

    const messageId = uuidv4();
    const timestamp = new Date().toISOString();
    const fileDataStr = payload.file ? JSON.stringify(payload.file) : null;
    const replyToStr = payload.replyTo ? JSON.stringify(payload.replyTo) : null;
    const forwardedFromStr = payload.forwardedFrom ? JSON.stringify(payload.forwardedFrom) : null;

    db.run(`
      INSERT INTO messages (id, chat_id, sender_id, text, file_data, reply_to, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      messageId, chatId, senderId, storedText, fileDataStr, replyToStr, timestamp, forwardedFromStr,
      isE2EE ? 1 : 0, payload.e2ee_nonce || null, payload.e2ee_ephemeral || null, payload.expiresAt || null
    ]);

    const formattedMessage = {
      id: messageId,
      chatId,
      senderId,
      senderName: sender.username,
      senderAvatar: sender.avatar || '',
      // E2EE — ciphertext (клиент расшифрует), обычное — plaintext
      text,
      file: payload.file || null,
      reply_to: payload.replyTo || null,
      replyCount: 0,
      timestamp,
      forwarded_from: payload.forwardedFrom || null,
      readBy: [sender.username],
      e2ee: isE2EE ? 1 : 0,
      e2ee_nonce: payload.e2ee_nonce,
      e2ee_ephemeral: payload.e2ee_ephemeral,
      expires_at: payload.expiresAt || null
    };

    distributeChatMessage(chatId, formattedMessage, getChatWithDetails(chatId, senderId));

    db.run(
      "UPDATE scheduled_messages SET status = 'sent', sent_message_id = ?, error = NULL WHERE id = ?",
      [messageId, row.id]
    );
    emitToUser(senderId, 'scheduled_message_sent', { id: row.id, chatId, messageId });
    console.log(`[scheduled] Отправлено отложенное сообщение ${row.id} в чат ${chatId}`);
  } catch (err) {
    console.error(`[scheduled] Не удалось отправить ${row.id}:`, err.message);
    db.run(
      "UPDATE scheduled_messages SET status = 'failed', error = ? WHERE id = ?",
      [String(err.message || 'error').slice(0, 500), row.id]
    );
    emitToUser(senderId, 'scheduled_message_failed', { id: row.id, chatId, error: err.message });
  }
}

module.exports = { setupScheduled, processDueScheduled };
