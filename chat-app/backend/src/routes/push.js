/**
 * Push-уведомления: Web Push VAPID + FCM. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, uuidv4 } = deps;

app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Сохранение подписки на push-уведомления
app.post('/api/push/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'userId и subscription обязательны' });
  }
  try {
    const id = uuidv4();
    db.run('INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString()]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения push-подписки:', err);
    res.status(500).json({ error: 'Ошибка сохранения подписки' });
  }
});

// Удаление подписки на push-уведомления
app.delete('/api/push/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });
  try {
    db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления push-подписки:', err);
    res.status(500).json({ error: 'Ошибка удаления подписки' });
  }
});

// ============================================
// FCM API для Android push-уведомлений
// ============================================

// Регистрация FCM-токена
app.post('/api/push/fcm/register', (req, res) => {
  const { userId, token, unregister } = req.body;
  if (unregister === 'true') {
    try {
      db.run('DELETE FROM fcm_tokens WHERE token = ?', [token]);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Ошибка удаления FCM-токена' });
    }
  }
  if (!userId || !token) {
    return res.status(400).json({ error: 'userId и token обязательны' });
  }
  try {
    const id = uuidv4();
    db.run('INSERT OR REPLACE INTO fcm_tokens (id, user_id, token, created_at) VALUES (?, ?, ?, ?)',
      [id, userId, token, new Date().toISOString()]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения FCM-токена:', err);
    res.status(500).json({ error: 'Ошибка сохранения токена' });
  }
});

// API для отправки задачи другому пользователю
};
