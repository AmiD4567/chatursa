/**
 * ИИ-Агент: отдельный пользователь чата, отвечающий через локальную модель
 * (Ollama). Диалог пользователя: ai-chat-{userId}.
 *
 * Инициализация: init(deps) вызывается из server.js после initDatabase().
 * Сообщения в этот чат из send_message маршрутизируются напрямую в
 * handleUserMessage (модуль-синглтон, без sharedDeps-рассинхрона).
 */

const AGENT_ID = 'ai-agent';
const CHAT_PREFIX = 'ai-chat-';

const CFG = {
  enabled: process.env.AI_AGENT_ENABLED !== 'false',
  maintenance: process.env.AI_AGENT_MAINTENANCE === 'true',
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model: process.env.LLM_MODEL || 'qwen2.5:3b',
  name: process.env.AI_AGENT_NAME || 'ИИ-Агент',
  avatar: process.env.AI_AGENT_AVATAR || 'https://ui-avatars.com/api/?name=AI&background=10b981&color=fff',
  contextMessages: parseInt(process.env.AI_CONTEXT_MESSAGES || '10', 10),
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '90000', 10)
};

const MAINTENANCE_REPLY =
  '🚧 ИИ-Агент сейчас в разработке и скоро станет доступен. ' +
  'Мы дорабатываем его возможности — следите за обновлениями!';

let D = null;        // deps: db, io, uuidv4, encryptText, decryptText, deliverBotMessage
let chain = Promise.resolve(); // семафор: одна генерация одновременно

function sdbg(...a) {
  try { if (process.env.AI_AGENT_DEBUG === '1') console.log('[ai-agent]', ...a); } catch (e) {}
}

function init(deps) {
  D = deps;
  try {
    if (!CFG.enabled) { console.log('[ai-agent] отключён (AI_AGENT_ENABLED=false)'); return; }
    ensureAgentUser();
    console.log(`🧠 ИИ-Агент инициализирован (${CFG.model} @ ${CFG.ollamaUrl})`);
  } catch (e) {
    console.error('[ai-agent] init:', e.message);
  }
}

function ensureAgentUser() {
  const exists = D.db.prepare('SELECT id FROM users WHERE id = ?').get(AGENT_ID);
  if (!exists) {
    D.db.prepare(`INSERT INTO users (id, username, avatar, status, is_admin)
                  VALUES (?, ?, ?, 'online', 0)`).run(AGENT_ID, CFG.name, CFG.avatar);
  }
}

// Создаёт диалог пользователя с агентом; true — если чат создан сейчас
function ensureAiChat(userId) {
  if (!CFG.enabled || !D || !userId) return false;
  const chatId = CHAT_PREFIX + userId;
  const exists = D.db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId);
  if (!exists) {
    D.db.run(`INSERT INTO chats (id, type, name, created_by, created_at)
              VALUES (?, 'direct', ?, ?, CURRENT_TIMESTAMP)`, [chatId, CFG.name, userId]);
    D.db.run('INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, userId]);
    D.db.run('INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, AGENT_ID]);
    return true;
  }
  D.db.run('INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, userId]);
  return false;
}

// Контекст: последние N сообщений диалога (расшифрованные), роли user/assistant
function buildContext(chatId) {
  const rows = D.db.prepare(`
    SELECT sender_id, text FROM messages
    WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
  `).all(chatId, CFG.contextMessages);

  return rows.reverse().map(r => ({
    role: r.sender_id === AGENT_ID ? 'assistant' : 'user',
    content: D.decryptText(r.text) || ''
  })).filter(m => m.content);
}

async function askOllama(messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(CFG.ollamaUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CFG.model,
        messages,
        stream: false,
        options: { num_ctx: 4096, temperature: 0.7 }
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
    const j = await res.json();
    return (j.message && j.message.content ? j.message.content : '').trim();
  } finally {
    clearTimeout(timer);
  }
}

const FALLBACK_TEXT = '🧠 Сервис ИИ сейчас занят или недоступен — попробуйте чуть позже.';

// Обработка сообщения пользователя агенту (вызывается из send_message)
async function handleUserMessage(socket, onlineUser, chatId, text, callback) {
  const userId = onlineUser.id;

  if (!CFG.enabled) {
    if (typeof callback === 'function') callback({ ok: false, error: 'disabled' });
    return;
  }

  ensureAiChat(userId);

  // Режим обслуживания: отвечаем заглушкой вместо вызова Ollama
  if (CFG.maintenance) {
    const answerId = D.uuidv4();
    const ts = new Date().toISOString();
    D.db.run(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
              VALUES (?, ?, ?, ?, ?)`,
      [answerId, chatId, AGENT_ID, D.encryptText(MAINTENANCE_REPLY), ts]);

    if (typeof callback === 'function') callback({ ok: true });
    D.deliverBotMessage(userId, {
      id: answerId,
      chatId,
      senderId: AGENT_ID,
      senderName: CFG.name,
      senderAvatar: CFG.avatar,
      text: MAINTENANCE_REPLY
    });
    return;
  }

  // 1. Сохраняем сообщение пользователя (в общем зашифрованном формате)
  const userMsgId = D.uuidv4();
  const ts = new Date().toISOString();
  D.db.run(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
            VALUES (?, ?, ?, ?, ?)`,
    [userMsgId, chatId, userId, D.encryptText(text), ts]);

  if (typeof callback === 'function') callback({ ok: true });

  // 2. Индикатор набора + генерация вне обработчика сокета
  D.emitToUser(userId, 'bot_typing', { chatId, isTyping: true });

  const task = async () => {
    let answer;
    try {
      sdbg && console.log('[ai-agent] запрос от', onlineUser.username);
      const messages = [
        { role: 'system', content:
          `Ты — ИИ-Агент корпоративного мессенджера ChatUrsa (сегодня ${new Date().toLocaleDateString('ru-RU')}). ` +
          'Отвечай на русском языке: кратко, по делу и дружелюбно. ' +
          'Если вопрос не по теме — всё равно помоги чем можешь.' },
        ...buildContext(chatId)
      ];
      answer = await askOllama(messages);
    } catch (e) {
      console.error('[ai-agent] ошибка генерации:', e.message);
      answer = FALLBACK_TEXT;
    }

    try {
      // Сохраняем ответ в БД (deliverBotMessage не пишет в messages,
      // а контекст диалога строится из таблицы)
      const answerId = D.uuidv4();
      const ts = new Date().toISOString();
      D.db.run(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
                VALUES (?, ?, ?, ?, ?)`,
        [answerId, chatId, AGENT_ID, D.encryptText(answer), ts]);

      D.deliverBotMessage(userId, {
        id: answerId,
        chatId,
        senderId: AGENT_ID,
        senderName: CFG.name,
        senderAvatar: CFG.avatar,
        text: answer
      });
    } catch (e) {
      console.error('[ai-agent] доставка ответа:', e.message);
    }

    D.emitToUser(userId, 'bot_typing', { chatId, isTyping: false });
  };

  // Семафор: одна генерация одновременно, остальные ждут очереди
  chain = chain.then(task).catch(e => console.error('[ai-agent] queue:', e.message));
}

module.exports = { init, ensureAiChat, handleUserMessage, AGENT_ID, CHAT_PREFIX };
