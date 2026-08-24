/**
 * История звонков. Извлечено по deps-паттерну; регистрация после initDatabase().
 */
module.exports = function register(app, deps) {
  const { db } = deps;

  app.get('/api/calls/history/:userId', (req, res) => {
    const { userId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    if (!userId) {
      return res.status(400).json({ error: 'userId обязателен' });
    }

    try {
      const rows = db.prepare(`
        SELECT c.id, c.type, c.status, c.created_at, c.answered_at, c.ended_at,
               c.initiator_id, c.peer_id,
             u1.username AS initiator_name, u1.avatar AS initiator_avatar,
             u2.username AS peer_name,     u2.avatar AS peer_avatar
        FROM calls c
        LEFT JOIN users u1 ON u1.id = c.initiator_id
        LEFT JOIN users u2 ON u2.id = c.peer_id
        WHERE c.initiator_id = ? OR c.peer_id = ?
        ORDER BY c.created_at DESC
        LIMIT ?
      `).all(userId, userId, limit);

      const calls = rows.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        createdAt: r.created_at,
        answeredAt: r.answered_at,
        endedAt: r.ended_at,
        outgoing: r.initiator_id === userId,
        partner: r.initiator_id === userId
          ? { id: r.peer_id, username: r.peer_name, avatar: r.peer_avatar }
          : { id: r.initiator_id, username: r.initiator_name, avatar: r.initiator_avatar }
      }));

      res.json({ success: true, calls });
    } catch (err) {
      console.error('Ошибка истории звонков:', err);
      res.status(500).json({ error: 'Ошибка истории звонков' });
    }
  });
};
