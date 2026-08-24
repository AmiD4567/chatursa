/**
 * Регистрация/вход/профиль/E2EE/сессии. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, io, uuidv4, bcrypt, speakeasy, checkRateLimit, registerAttempts, loginAttempts } = deps;

app.post('/api/register', (req, res) => {
  const { username, email, password, confirmPassword, birthDate } = req.body;

  if (!username || !email || !password || !birthDate) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  // Rate limiting: не более 3 регистраций в час с одного IP
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(registerAttempts, clientIp, 3, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много попыток регистрации. Попробуйте позже.' });
  }

  // Проверка совпадения паролей
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
  }

  // Проверка сложности пароля
  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов, одну заглавную букву, одну цифру и один спецсимвол' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  // Проверка существующего пользователя
  const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR LOWER(email) = ?').get(username, emailLower);
  if (existingUser) {
    return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
  }

  // Хеширование пароля
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = uuidv4();
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

  try {
    db.run(`
      INSERT INTO users (id, username, email, password_hash, avatar, status, birth_date)
      VALUES (?, ?, ?, ?, ?, 'offline', ?)
    `, [userId, username, emailLower, passwordHash, avatar, birthDate]);

    res.json({
      success: true,
      user: {
        id: userId,
        username,
        email: emailLower,
        avatar
      }
    });
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Ошибка при регистрации' });
  }
});

// API для входа
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }

  // Rate limiting: не более 10 попыток за 15 минут с одного IP
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(loginAttempts, clientIp, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте позже.' });
  }

  // Приводим email к нижнему регистру для сравнения
  const emailLower = email.toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(emailLower);
  if (!user) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  
  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  // Проверка 2FA (TOTP) для админов
  if (user.totp_enabled) {
    const { totpCode } = req.body;
    if (!totpCode) {
      return res.json({ success: true, require2FA: true, userId: user.id, message: 'Введите код из аутентификатора' });
    }
    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });
    if (!verified) {
      return res.status(401).json({ error: 'Неверный код аутентификатора' });
    }
  }
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar
    }
  });
});

// API для получения профиля пользователя
app.get('/api/profile/:userId', (req, res) => {
  const user = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text, is_admin, can_edit_wiki, can_book_meeting_room, can_view_kpi FROM users WHERE id = ?').get(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  // Декодируем статус из JSON (если это JSON)
  let decodedStatusText = '';
  if (user.status_text) {
    try {
      // Проверяем, начинается ли строка с { или [
      const trimmed = user.status_text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        decodedStatusText = JSON.parse(user.status_text);
      } else {
        decodedStatusText = user.status_text;
      }
    } catch (e) {
      // Если парсинг не удался, используем как есть
      decodedStatusText = user.status_text || '';
    }
  }

  res.json({ 
    user: {
      ...user,
      status_text: decodedStatusText
    }
  });
});

// API для обновления профиля
app.put('/api/profile', (req, res) => {
  const { userId, username, fullName, birthDate, about, mobilePhone, workPhone, statusText } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Сохраняем статус как есть (SQLite поддерживает UTF-8)
  const safeStatusText = statusText === null || statusText === undefined ? null : statusText;

  const safeUsername = username === undefined || username === '' ? null : username;
  const safeFullName = fullName === undefined || fullName === '' ? null : fullName;
  const safeBirthDate = birthDate === undefined || birthDate === '' ? null : birthDate;
  const safeAbout = about === undefined || about === '' ? null : about;
  
  // Обработка телефонов: если не переданы - оставляем null (не меняем)
  // Если переданы пустые - сохраняем NULL в БД
  // Если переданы с значением - сохраняем значение
  const safeMobilePhone = mobilePhone === undefined ? undefined : (mobilePhone === '' ? null : mobilePhone);
  const safeWorkPhone = workPhone === undefined ? undefined : (workPhone === '' ? null : workPhone);

  // Проверка существования пользователя
  const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existingUser) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  try {
    // Получаем текущие номера из БД, если они не были переданы
    let finalMobilePhone = safeMobilePhone;
    let finalWorkPhone = safeWorkPhone;
    
    if (safeMobilePhone === undefined) {
      const currentRow = db.prepare('SELECT mobile_phone FROM users WHERE id = ?').get(userId);
      if (currentRow) {
        finalMobilePhone = currentRow.mobile_phone;
      }
    }
    
    if (safeWorkPhone === undefined) {
      const currentRow = db.prepare('SELECT work_phone FROM users WHERE id = ?').get(userId);
      if (currentRow) {
        finalWorkPhone = currentRow.work_phone;
      }
    }
    
    // Очищаем пустые значения
    const mobilePhoneValue = finalMobilePhone && String(finalMobilePhone).trim() !== '' ? finalMobilePhone : null;
    const workPhoneValue = finalWorkPhone && String(finalWorkPhone).trim() !== '' ? finalWorkPhone : null;

    db.run(`
      UPDATE users
      SET username = COALESCE(?, username),
          full_name = COALESCE(?, full_name),
          birth_date = COALESCE(?, birth_date),
          about = COALESCE(?, about),
          mobile_phone = ?,
          work_phone = ?,
          status_text = COALESCE(?, status_text)
      WHERE id = ?
    `, [safeUsername, safeFullName, safeBirthDate, safeAbout, mobilePhoneValue, workPhoneValue, safeStatusText, userId]);


    const updatedUser = db.prepare('SELECT id, username, email, avatar, full_name, birth_date, about, mobile_phone, work_phone, status_text FROM users WHERE id = ?').get(userId);

    if (!updatedUser) {
      return res.status(500).json({ error: 'Ошибка при обновлении профиля' });
    }

    // Статус уже в UTF-8, декодирование не нужно
    const decodedStatusText = updatedUser.status_text || '';

    // Уведомляем всех пользователей об обновлении профиля
    io.emit('user_profile_updated', {
      userId: updatedUser.id,
      username: updatedUser.username,
      full_name: updatedUser.full_name || '',
      work_phone: updatedUser.work_phone || '',
      mobile_phone: updatedUser.mobile_phone || '',
      status_text: decodedStatusText
    });

    // Уведомляем всех об изменении текстового статуса (для отображения в реальном времени)
    io.emit('user_status_changed', {
      userId: updatedUser.id,
      username: updatedUser.username,
      status: 'online',
      statusText: decodedStatusText
    });

    res.json({
      success: true,
      user: {
        ...updatedUser,
        status_text: decodedStatusText
      }
    });
  } catch (err) {
    console.error('Ошибка обновления профиля:', err);
    res.status(500).json({ error: 'Ошибка при обновлении профиля' });
  }
});

// ============================================
// E2EE API
// ============================================

// Получение публичного ключа E2EE пользователя
app.get('/api/e2ee/key/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  try {
    const row = db.prepare('SELECT e2ee_public_key FROM users WHERE id = ?').get(userId);
    if (row && row.e2ee_public_key) {
      res.json({ publicKey: row.e2ee_public_key });
    } else {
      res.status(404).json({ error: 'Ключ не найден' });
    }
  } catch (err) {
    console.error('Ошибка получения E2EE ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка публичного ключа E2EE
app.put('/api/e2ee/key', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!userId || !publicKey) {
    return res.status(400).json({ error: 'userId и publicKey обязательны' });
  }

  try {
    db.run('UPDATE users SET e2ee_public_key = ? WHERE id = ?', [publicKey, userId]);
    console.log(`[E2EE] Ключ сохранён для пользователя ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения E2EE ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Проверка, есть ли у пользователя E2EE ключ
app.get('/api/e2ee/status/:userId', (req, res) => {
  const { userId } = req.params;
  try {
    const row = db.prepare('SELECT e2ee_public_key FROM users WHERE id = ?').get(userId);
    res.json({ hasKey: !!(row && row.e2ee_public_key) });
  } catch (err) {
    res.json({ hasKey: false });
  }
});

// ============================================
// Group E2EE API
// ============================================

// Получить зашифрованный групповой ключ для участника
app.get('/api/e2ee/group-key/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.query;
  if (!chatId || !userId) return res.status(400).json({ error: 'chatId и userId обязательны' });
  try {
    const row = db.prepare('SELECT encrypted_key FROM group_e2ee_keys WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (row) {
      res.json({ encryptedKey: row.encrypted_key });
    } else {
      res.status(404).json({ error: 'Ключ не найден' });
    }
  } catch (err) {
    console.error('Ошибка получения группового ключа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузить зашифрованные групповые ключи для всех участников
app.put('/api/e2ee/group-key', (req, res) => {
  const { chatId, keys } = req.body; // keys: [{ userId, encryptedKey }]
  if (!chatId || !keys || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'chatId и keys обязательны' });
  }
  try {
    const insert = db.prepare('INSERT OR REPLACE INTO group_e2ee_keys (chat_id, user_id, encrypted_key) VALUES (?, ?, ?)');
    const tx = db.transaction((keysData) => {
      for (const k of keysData) {
        insert.run(chatId, k.userId, k.encryptedKey);
      }
    });
    tx(keys);
    db.run('UPDATE chats SET e2ee = 1 WHERE id = ?', [chatId]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения групповых ключей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить групповые ключи (при отключении E2EE или смене состава)
app.delete('/api/e2ee/group-key/:chatId', (req, res) => {
  const { chatId } = req.params;
  try {
    db.run('DELETE FROM group_e2ee_keys WHERE chat_id = ?', [chatId]);
    db.run('UPDATE chats SET e2ee = 0 WHERE id = ?', [chatId]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления групповых ключей:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить список участников, у кого есть ключ (для проверки статуса)
app.get('/api/e2ee/group-key/:chatId/members', (req, res) => {
  const { chatId } = req.params;
  try {
    const rows = db.prepare('SELECT user_id FROM group_e2ee_keys WHERE chat_id = ?').all(chatId);
    res.json({ members: rows.map(r => r.user_id) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение списка активных сессий пользователя (multi-device)
app.get('/api/sessions/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const rows = db.prepare(`
      SELECT id, device_id, device_name, ip_address, login_time, last_seen, is_current,
             json_array_length(socket_ids) as socket_count
      FROM user_device_sessions WHERE user_id = ?
      ORDER BY last_seen DESC
    `).all(userId);
    res.json({ sessions: rows.map(r => ({ ...r, socket_count: Number(r.socket_count || 0) })) });
  } catch (err) {
    console.error('Ошибка получения сессий:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Принудительное завершение сессии (logout device)
app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { userId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId обязателен' });
  try {
    const session = db.prepare('SELECT * FROM user_device_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
    if (userId && session.user_id !== userId) return res.status(403).json({ error: 'Нет доступа' });
    if (session.is_current) return res.status(400).json({ error: 'Нельзя завершить текущую сессию' });

    // Отключаем все сокеты этой сессии
    let devSockets = [];
    try { devSockets = JSON.parse(session.socket_ids); } catch {}
    devSockets.forEach(sid => {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.disconnect(true);
    });

    db.run('DELETE FROM user_device_sessions WHERE id = ?', [sessionId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления сессии:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для удаления чата
};
