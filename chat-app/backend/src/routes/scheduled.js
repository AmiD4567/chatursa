/**
 * REST API отложенных сообщений.
 * Планирование, список и отмена. Саму отправку выполняет src/scheduled.js.
 * Регистрация после initDatabase() — зависимости передаются через deps.
 */
module.exports = function register(app, deps) {
  const { db, emitToUser, uuidv4 } = deps;

  // Проверка, что пользователь состоит в чате
  function isParticipant(chatId, userId) {
    if (chatId === 'general') return true;
    const row = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    return !!row;
  }

  // Создать отложенное сообщение
  app.post('/api/scheduled-messages', (req, res) => {
    const { userId, chatId, text, scheduledAt, replyTo, e2ee, e2ee_nonce, e2ee_ephemeral } = req.body || {};

    if (!userId || !chatId || !scheduledAt) {
      return res.status(400).json({ error: 'userId, chatId и scheduledAt обязательны' });
    }
    if (!text && !e2ee) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    const when = new Date(scheduledAt);
    if (isNaN(when.getTime())) {
      return res.status(400).json({ error: 'Некорректное время отправки' });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Время отправки уже прошло' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (!isParticipant(chatId, userId)) {
      return res.status(403).json({ error: 'Нет доступа к чату' });
    }

    try {
      const id = uuidv4();
      const payload = {
        text: typeof text === 'string' ? text : '',
        ...(replyTo ? { replyTo } : {}),
        ...(e2ee ? { e2ee: true, e2ee_nonce: e2ee_nonce || '', e2ee_ephemeral: e2ee_ephemeral || '' } : {})
      };
      const preview = (typeof text === 'string' ? text : '').slice(0, 200);

      db.run(`
        INSERT INTO scheduled_messages (id, user_id, chat_id, payload, preview, scheduled_at, scheduled_at_ms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `, [id, userId, chatId, JSON.stringify(payload), preview, when.toISOString(), when.getTime()]);

      const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id);
      const item = {
        id: row.id,
        userId: row.user_id,
        chatId: row.chat_id,
        preview: row.preview || '',
        scheduledAt: row.scheduled_at,
        scheduledAtMs: row.scheduled_at_ms,
        status: row.status,
        replyTo: payload.replyTo || null
      };

      emitToUser(userId, 'scheduled_message_created', { item });
      res.json({ success: true, item });
    } catch (err) {
      console.error('Ошибка создания отложенного сообщения:', err);
      res.status(500).json({ error: 'Не удалось запланировать сообщение' });
    }
  });

  // Список отложенных сообщений пользователя (опционально — по чату)
  app.get('/api/scheduled-messages', (req, res) => {
    const { userId, chatId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId обязателен' });

    try {
      let sql = "SELECT * FROM scheduled_messages WHERE user_id = ? AND status = 'pending'";
      const params = [userId];
      if (chatId) {
        sql += ' AND chat_id = ?';
        params.push(chatId);
      }
      sql += ' ORDER BY scheduled_at_ms ASC';

      const items = db.prepare(sql).all(...params).map(row => ({
        id: row.id,
        userId: row.user_id,
        chatId: row.chat_id,
        preview: row.preview || '',
        scheduledAt: row.scheduled_at,
        scheduledAtMs: row.scheduled_at_ms,
        status: row.status
      }));

      res.json({ items });
    } catch (err) {
      console.error('Ошибка получения отложенных сообщений:', err);
      res.status(500).json({ error: 'Ошибка при получении списка' });
    }
  });

  // Отменить отложенное сообщение
  app.delete('/api/scheduled-messages/:id', (req, res) => {
    const { id } = req.params;
    const userId = req.query.userId || req.body?.userId;

    if (!userId) return res.status(400).json({ error: 'userId обязателен' });

    try {
      const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id);
      if (!row || row.user_id !== userId) {
        return res.status(404).json({ error: 'Сообщение не найдено' });
      }
      if (row.status !== 'pending') {
        return res.status(400).json({ error: 'Сообщение уже отправлено или отменено' });
      }

      db.run("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?", [id]);
      emitToUser(userId, 'scheduled_message_cancelled', { id, chatId: row.chat_id });
      res.json({ success: true });
    } catch (err) {
      console.error('Ошибка отмены отложенного сообщения:', err);
      res.status(500).json({ error: 'Не удалось отменить' });
    }
  });
};
