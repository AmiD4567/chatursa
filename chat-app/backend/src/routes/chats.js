/**
 * Чаты: удаление/pin/mute/clear/hide/участники. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, emitToUser, checkAdmin, getChatById, getChatWithDetails } = deps;

app.delete('/api/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  const userId = req.query.userId || (req.body || {}).userId;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId обязателен' });
  }

  // Полное удаление чата (у всех участников) — только администратор
  if (!userId || !checkAdmin(userId)) {
    return res.status(403).json({ error: 'Удалять чат у всех участников может только администратор' });
  }

  try {
    // Удаляем непрочитанные сообщения
    db.run('DELETE FROM unread_messages WHERE chat_id = ?', [chatId]);
    
    // Удаляем сообщения чата
    db.run('DELETE FROM messages WHERE chat_id = ?', [chatId]);
    
    // Удаляем участников чата
    db.run('DELETE FROM chat_participants WHERE chat_id = ?', [chatId]);
    
    // Удаляем чат
    db.run('DELETE FROM chats WHERE id = ?', [chatId]);
    

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления чата:', err);
    res.status(500).json({ error: 'Ошибка при удалении чата' });
  }
});

// Закрепить / открепить чат для пользователя
app.put('/api/chats/:chatId/pin', (req, res) => {
  const { chatId } = req.params;
  const { userId, pinned } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, ?, 0, 0, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET pinned = ?
    `, [userId, chatId, pinned ? 1 : 0, pinned ? 1 : 0]);
    res.json({ success: true, pinned: !!pinned });
  } catch (err) {
    console.error('Ошибка закрепа чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Выключить / включить уведомления для чата
app.put('/api/chats/:chatId/mute', (req, res) => {
  const { chatId } = req.params;
  const { userId, muted } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, ?, 0, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET muted = ?
    `, [userId, chatId, muted ? 1 : 0, muted ? 1 : 0]);
    res.json({ success: true, muted: !!muted });
  } catch (err) {
    console.error('Ошибка изменения уведомлений чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Пометить чат как прочитанный / непрочитанный
app.put('/api/chats/:chatId/unread', (req, res) => {
  const { chatId } = req.params;
  const { userId, forceUnread } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, 0, ?, NULL)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET force_unread = ?
    `, [userId, chatId, forceUnread ? 1 : 0, forceUnread ? 1 : 0]);
    res.json({ success: true, forceUnread: !!forceUnread });
  } catch (err) {
    console.error('Ошибка отметки непрочитанного:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистить историю чата (только для этого пользователя)
app.post('/api/chats/:chatId/clear', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    const now = new Date().toISOString();
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at)
      VALUES (?, ?, 0, 0, 0, ?)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET cleared_at = ?, force_unread = 0
    `, [userId, chatId, now, now]);
    // Сбрасываем непрочитанные для пользователя в этом чате
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
    res.json({ success: true, clearedAt: now });
  } catch (err) {
    console.error('Ошибка очистки истории:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить чат только у себя (собеседника не затрагивает).
// Чат скрыт до нового сообщения от собеседника — тогда возвращается в список (без старой истории за счёт cleared_at)
app.post('/api/chats/:chatId/hide', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }
  try {
    const now = new Date().toISOString();
    db.run(`
      INSERT INTO chat_user_settings (user_id, chat_id, pinned, muted, force_unread, cleared_at, deleted_at)
      VALUES (?, ?, 0, 0, 0, ?, ?)
      ON CONFLICT(user_id, chat_id)
      DO UPDATE SET cleared_at = ?, deleted_at = ?, force_unread = 0
    `, [userId, chatId, now, now, now, now]);
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления чата у себя:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Выход из группового чата
app.post('/api/chats/:chatId/leave', (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  if (!chatId || !userId) {
    return res.status(400).json({ error: 'chatId и userId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
    db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

    // Уведомляем остальных участников
    const chatWithDetails = getChatWithDetails(chatId);
    if (chatWithDetails) {
      chatWithDetails.participantsDetails.forEach(p => {
        emitToUser(p.id, 'participant_left', { chatId, userId });
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка выхода из чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавление участника в группу (только создатель)
app.post('/api/chats/:chatId/participants', (req, res) => {
  const { chatId } = req.params;
  const { userId, requesterId } = req.body;

  if (!chatId || !userId || !requesterId) {
    return res.status(400).json({ error: 'chatId, userId и requesterId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    if (chat.created_by !== requesterId) {
      return res.status(403).json({ error: 'Только создатель группы может добавлять участников' });
    }

    const existing = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь уже в чате' });
    }

    db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, userId]);

    // Уведомляем нового участника
    const chatWithDetails = getChatWithDetails(chatId);
    emitToUser(userId, 'chat_created', { chat: chatWithDetails });

    // Уведомляем остальных
    chatWithDetails.participantsDetails.forEach(p => {
      if (p.id !== userId) {
        emitToUser(p.id, 'participant_added', { chatId, userId });
      }
    });

    res.json({ success: true, chat: chatWithDetails });
  } catch (err) {
    console.error('Ошибка добавления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление участника из группы (только создатель)
app.delete('/api/chats/:chatId/participants/:targetUserId', (req, res) => {
  const { chatId, targetUserId } = req.params;
  const { requesterId } = req.body;

  if (!chatId || !targetUserId || !requesterId) {
    return res.status(400).json({ error: 'chatId, targetUserId и requesterId обязательны' });
  }

  try {
    const chat = getChatById(chatId);
    if (!chat || chat.type !== 'group') {
      return res.status(400).json({ error: 'Чат не найден или это не группа' });
    }

    if (chat.created_by !== requesterId) {
      return res.status(403).json({ error: 'Только создатель группы может удалять участников' });
    }

    if (targetUserId === requesterId) {
      return res.status(400).json({ error: 'Нельзя удалить себя. Используйте выход из группы.' });
    }

    db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);
    db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);

    // Уведомляем удалённого участника
    emitToUser(targetUserId, 'removed_from_chat', { chatId });

    // Уведомляем остальных
    const chatWithDetails = getChatWithDetails(chatId);
    if (chatWithDetails) {
      chatWithDetails.participantsDetails.forEach(p => {
        emitToUser(p.id, 'participant_left', { chatId, userId: targetUserId });
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для загрузки аватара
};
