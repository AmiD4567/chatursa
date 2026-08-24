/**
 * Объявления. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, io, uuidv4, checkAdmin, sendFcmNotification } = deps;

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
};
