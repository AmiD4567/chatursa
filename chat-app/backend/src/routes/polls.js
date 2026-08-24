/**
 * Опросы. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, io, uuidv4, getChatById, distributeChatMessage } = deps;
  const { createGetPollWithVotes } = require('../utils');
  const getPollWithVotes = createGetPollWithVotes(db);


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
};
