/**
 * HR-заявки. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, uuidv4, admin, checkAdmin, sendFcmNotification } = deps;

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
};
