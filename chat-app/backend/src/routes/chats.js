/**
 * Чаты: удаление/pin/mute/clear/hide/участники. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, emitToUser, checkAdmin, getChatById, getChatWithDetails } = deps;
  const { v4: uuidv4 } = require('uuid');

  // Возвращает роль участника в группе: 'creator' | 'admin' | 'member' | null
  const getRole = (chatId, userId) => {
    const row = db.prepare('SELECT role FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    return row ? row.role : null;
  };

  const getUsername = (userId) => {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    return row ? row.username : '';
  };

  const isManager = (role) => role === 'creator' || role === 'admin';

  // Обновляет участников у всех клиентов (универсальное событие с полным объектом чата)
  const broadcastChat = (event, chatId, details) => {
    if (!details || !details.participantsDetails) return;
    details.participantsDetails.forEach(p => emitToUser(p.id, event, { chatId, chat: details }));
  };

  // Системное сообщение в группе: сохраняется в БД (is_system=1) и рассылается участникам
  const addSystemMessage = (chatId, actorId, text) => {
    try {
      const id = uuidv4();
      const ts = new Date().toISOString();
      db.run('INSERT INTO messages (id, chat_id, sender_id, text, timestamp, is_system) VALUES (?, ?, ?, ?, ?, 1)',
        [id, chatId, actorId, text, ts]);
      const details = getChatWithDetails(chatId);
      const actorName = getUsername(actorId);
      if (details && details.participantsDetails) {
        details.participantsDetails.forEach(p => {
          emitToUser(p.id, 'group_event', { chatId, messageId: id, actorId, actorName, text, timestamp: ts, isSystem: true });
        });
      }
    } catch (e) {
      console.error('Ошибка системного сообщения:', e);
    }
  };

app.delete('/api/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  const userId = req.query.userId || (req.body || {}).userId;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId обязателен' });
  }

  const chat = getChatById(chatId);
  const isGlobalAdmin = userId && checkAdmin(userId);
  const isOwner = chat && chat.type === 'group' && chat.created_by === userId;

  // Полное удаление чата (у всех участников) — глобальный админ или владелец группы
  if (!userId || (!isGlobalAdmin && !isOwner)) {
    return res.status(403).json({ error: 'Удалить чат может только администратор или владелец группы' });
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

      if (getRole(chatId, userId) === 'creator') {
        return res.status(403).json({ error: 'Владелец не может просто выйти. Передайте владение другому участнику или удалите группу.' });
      }

      db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
      db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

      const details = getChatWithDetails(chatId);
      broadcastChat('participant_left', chatId, details);
      addSystemMessage(chatId, userId, 'вышел(ла) из группы');

      res.json({ success: true });
    } catch (err) {
      console.error('Ошибка выхода из чата:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

// Добавление участника в группу (создатель или админ)
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

    const requesterRole = getRole(chatId, requesterId);
    if (!isManager(requesterRole)) {
      return res.status(403).json({ error: 'Добавлять участников может только владелец или администратор группы' });
    }

    const existing = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь уже в чате' });
    }

    db.run('INSERT INTO chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)', [chatId, userId, 'member']);

    const details = getChatWithDetails(chatId);
    // Новому участнику — полный чат
    emitToUser(userId, 'chat_created', { chat: details });
    // Остальным — событие с обновлённым составом
    broadcastChat('participant_added', chatId, details);
    addSystemMessage(chatId, requesterId, `добавил(а) ${getUsername(userId)} в группу`);

    res.json({ success: true, chat: details });
  } catch (err) {
    console.error('Ошибка добавления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление участника из группы (создатель или админ; нельзя удалить владельца)
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

    const requesterRole = getRole(chatId, requesterId);
    if (!isManager(requesterRole)) {
      return res.status(403).json({ error: 'Удалять участников может только владелец или администратор группы' });
    }

    if (getRole(chatId, targetUserId) === 'creator') {
      return res.status(403).json({ error: 'Нельзя удалить владельца группы' });
    }

    if (targetUserId === requesterId) {
      return res.status(400).json({ error: 'Нельзя удалить себя. Используйте выход из группы.' });
    }

    db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);
    db.run('DELETE FROM unread_messages WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);

    // Уведомляем удалённого участника
    emitToUser(targetUserId, 'removed_from_chat', { chatId });

    const details = getChatWithDetails(chatId);
    broadcastChat('participant_left', chatId, details);
    addSystemMessage(chatId, requesterId, `удалил(а) ${getUsername(targetUserId)} из группы`);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления участника:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

  // Назначить участника администратором (только владелец)
  app.post('/api/chats/:chatId/admins', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, targetUserId } = req.body;
    if (!chatId || !requesterId || !targetUserId) {
      return res.status(400).json({ error: 'chatId, requesterId и targetUserId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (getRole(chatId, requesterId) !== 'creator') return res.status(403).json({ error: 'Назначать администраторов может только владелец группы' });
      const targetRole = getRole(chatId, targetUserId);
      if (targetRole == null) return res.status(400).json({ error: 'Участник не найден в группе' });
      if (targetRole === 'creator') return res.status(400).json({ error: 'Владелец уже обладает всеми правами' });

      db.run("UPDATE chat_participants SET role = 'admin' WHERE chat_id = ? AND user_id = ?", [chatId, targetUserId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('participant_role_changed', chatId, details);
      addSystemMessage(chatId, requesterId, `назначил(а) администратором ${getUsername(targetUserId)}`);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка назначения админа:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Снять полномочия администратора (только владелец)
  app.delete('/api/chats/:chatId/admins/:targetUserId', (req, res) => {
    const { chatId, targetUserId } = req.params;
    const { requesterId } = req.body;
    if (!chatId || !targetUserId || !requesterId) {
      return res.status(400).json({ error: 'chatId, targetUserId и requesterId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (getRole(chatId, requesterId) !== 'creator') return res.status(403).json({ error: 'Снимать полномочия администратора может только владелец группы' });
      const targetRole = getRole(chatId, targetUserId);
      if (targetRole !== 'admin') return res.status(400).json({ error: 'Участник не является администратором' });

      db.run("UPDATE chat_participants SET role = 'member' WHERE chat_id = ? AND user_id = ?", [chatId, targetUserId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('participant_role_changed', chatId, details);
      addSystemMessage(chatId, requesterId, `снял(а) полномочия администратора с ${getUsername(targetUserId)}`);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка снятия админа:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Передача владения группой (только владелец)
  app.post('/api/chats/:chatId/transfer', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, targetUserId } = req.body;
    if (!chatId || !requesterId || !targetUserId) {
      return res.status(400).json({ error: 'chatId, requesterId и targetUserId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (getRole(chatId, requesterId) !== 'creator') return res.status(403).json({ error: 'Передать владение может только владелец группы' });
      const targetRole = getRole(chatId, targetUserId);
      if (targetRole == null) return res.status(400).json({ error: 'Участник не найден в группе' });
      if (targetRole === 'creator') return res.status(400).json({ error: 'Участник уже является владельцем' });

      db.run("UPDATE chat_participants SET role = 'member' WHERE chat_id = ? AND user_id = ?", [chatId, requesterId]);
      db.run("UPDATE chat_participants SET role = 'creator' WHERE chat_id = ? AND user_id = ?", [chatId, targetUserId]);
      db.run('UPDATE chats SET created_by = ? WHERE id = ?', [targetUserId, chatId]);

      const details = getChatWithDetails(chatId);
      broadcastChat('ownership_transferred', chatId, details);
      addSystemMessage(chatId, requesterId, `передал(а) владение группой пользователю ${getUsername(targetUserId)}`);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка передачи владения:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Переименование группы (владелец или админ)
  app.patch('/api/chats/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, name } = req.body;
    if (!chatId || !requesterId || !name) {
      return res.status(400).json({ error: 'chatId, requesterId и name обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (!isManager(getRole(chatId, requesterId))) return res.status(403).json({ error: 'Переименовывать группу может только владелец или администратор' });
      const trimmed = String(name).trim().slice(0, 100);
      if (!trimmed) return res.status(400).json({ error: 'Имя группы не может быть пустым' });

      db.run('UPDATE chats SET name = ? WHERE id = ?', [trimmed, chatId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('group_settings_updated', chatId, details);
      addSystemMessage(chatId, requesterId, `переименовал(а) группу в «${trimmed}»`);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка переименования:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Изменение описания группы (владелец или админ)
  app.patch('/api/chats/:chatId/description', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, description } = req.body;
    if (!chatId || !requesterId) {
      return res.status(400).json({ error: 'chatId и requesterId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (!isManager(getRole(chatId, requesterId))) return res.status(403).json({ error: 'Менять описание может только владелец или администратор' });
      const desc = String(description || '').trim().slice(0, 500);

      db.run('UPDATE chats SET description = ? WHERE id = ?', [desc, chatId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('group_settings_updated', chatId, details);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка описания:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Режим «только администраторы могут писать» (владелец или админ)
  app.patch('/api/chats/:chatId/restricted', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, restricted } = req.body;
    if (!chatId || !requesterId) {
      return res.status(400).json({ error: 'chatId и requesterId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (!isManager(getRole(chatId, requesterId))) return res.status(403).json({ error: 'Менять режим может только владелец или администратор' });
      const value = restricted ? 1 : 0;

      db.run('UPDATE chats SET restricted = ? WHERE id = ?', [value, chatId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('group_settings_updated', chatId, details);
      addSystemMessage(chatId, requesterId, value
        ? 'включил(а) режим «только администраторы могут писать»'
        : 'выключил(а) режим «только администраторы могут писать»');
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка режима:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Объявление группы (владелец или админ)
  app.patch('/api/chats/:chatId/announcement', (req, res) => {
    const { chatId } = req.params;
    const { requesterId, announcement } = req.body;
    if (!chatId || !requesterId) {
      return res.status(400).json({ error: 'chatId и requesterId обязательны' });
    }
    try {
      const chat = getChatById(chatId);
      if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Чат не найден или это не группа' });
      if (!isManager(getRole(chatId, requesterId))) return res.status(403).json({ error: 'Менять объявление может только владелец или администратор' });
      const text = String(announcement || '').trim().slice(0, 1000);
      db.run('UPDATE chats SET announcement = ? WHERE id = ?', [text, chatId]);
      const details = getChatWithDetails(chatId);
      broadcastChat('group_settings_updated', chatId, details);
      res.json({ success: true, chat: details });
    } catch (err) {
      console.error('Ошибка объявления:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // API для загрузки аватара
};
