/**
 * Календарь задач и переговорки (вкл. шеринг задач). Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */

module.exports = function register(app, deps) {
  const { db, io, onlineUsers, uuidv4, checkAdmin, getUserById, scheduleTaskReminder, pendingReminders } = deps;

app.get('/api/calendar/tasks', (req, res) => {
  const { userId, startDate, endDate } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  let query = 'SELECT * FROM calendar_tasks WHERE user_id = ?';
  const params = [userId];

  if (startDate && endDate) {
    query += ' AND task_date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (startDate) {
    query += ' AND task_date >= ?';
    params.push(startDate);
  }

  query += ' ORDER BY task_date ASC';

  const tasks = db.prepare(query).all(params);

  res.json({ tasks });
});

// ========================================
// API для бронирования переговорной
// ========================================

// Получить бронирования переговорной
app.get('/api/meeting-room/bookings', (req, res) => {
  const { startDate, endDate } = req.query;

  let query = 'SELECT * FROM meeting_room_bookings WHERE 1=1';
  const params = [];

  if (startDate && endDate) {
    query += ' AND meeting_date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (startDate) {
    query += ' AND meeting_date >= ?';
    params.push(startDate);
  }

  query += ' ORDER BY meeting_date ASC, start_time ASC';

  const bookings = db.prepare(query).all(params);

  // Добавляем участников к каждому бронированию
  const getParticipants = db.prepare('SELECT user_id, username FROM meeting_room_booking_participants WHERE booking_id = ?');
  const enriched = bookings.map(b => ({
    ...b,
    participants_list: getParticipants.all(b.id)
  }));

  res.json({ bookings: enriched });
});

// Создать бронирование переговорной
app.post('/api/meeting-room/bookings', (req, res) => {
  const { organizerId, organizerName, title, description, meetingDate, startTime, endTime, participants, reminderMinutes } = req.body;

  if (!organizerId || !title || !meetingDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'organizerId, title, meetingDate, startTime и endTime обязательны' });
  }

  // Проверка права на бронирование
  const userCheck = db.prepare('SELECT can_book_meeting_room, username FROM users WHERE id = ?').get(organizerId);
  if (!userCheck) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const canBook = userCheck.can_book_meeting_room === 1 || userCheck.username === 'Root';
  if (!canBook) {
    return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
  }

  // Проверка пересечений по времени
  const overlapCheck = db.prepare(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = ? AND (
      (start_time < ? AND end_time > ?)
    )
  `).get(meetingDate, endTime, startTime);
  
  if (overlapCheck) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  // Рассчитываем reminder_time если выбрано напоминание
  let reminderTime = null;
  if (reminderMinutes && parseInt(reminderMinutes) > 0) {
    const baseDate = new Date(`${meetingDate}T${startTime}`);
    reminderTime = new Date(baseDate.getTime() - parseInt(reminderMinutes) * 60 * 1000).toISOString().slice(0, 19);
  }

  try {
    const insertResult = db.run(`
      INSERT INTO meeting_room_bookings (organizer_id, organizer_name, title, description, meeting_date, start_time, end_time, reminder_minutes, reminder_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [organizerId, organizerName || 'Аноним', title, description || null, meetingDate, startTime, endTime, reminderMinutes || null, reminderTime]);
    
    const newId = insertResult.lastInsertRowid;
    
    // Добавляем участников
    if (participants && Array.isArray(participants) && participants.length > 0) {
      const insertParticipant = db.prepare('INSERT INTO meeting_room_booking_participants (booking_id, user_id, username) VALUES (?, ?, ?)');
      const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
      for (const userId of participants) {
        const userRow = getUser.get(userId);
        if (userRow) {
          insertParticipant.run(newId, userId, userRow.username);
        }
      }
    }
    
    const newBooking = db.prepare('SELECT * FROM meeting_room_bookings WHERE id = ?').get(newId);
    
    res.json({ 
      success: true, 
      booking: newBooking ? {
        id: newBooking.id,
        title: newBooking.title,
        description: newBooking.description,
        meeting_date: newBooking.meeting_date,
        start_time: newBooking.start_time,
        end_time: newBooking.end_time,
        organizer_id: newBooking.organizer_id,
        organizer_name: newBooking.organizer_name
      } : null
    });
  } catch (err) {
    console.error('Ошибка создания бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить бронирование
app.delete('/api/meeting-room/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { adminId } = req.query;

  if (!adminId || !checkAdmin(adminId)) {
    return res.status(403).json({ error: 'Только для админов' });
  }

  try {
    // Удаляем связанных участников
    db.run(`DELETE FROM meeting_room_booking_participants WHERE booking_id = ?`, [id]);
    db.run(`DELETE FROM meeting_room_bookings WHERE id = ?`, [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить бронирование
app.put('/api/meeting-room/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, meetingDate, startTime, endTime, participants, reminderMinutes } = req.body;
  const organizerId = req.body.organizerId || req.query.organizerId;

  if (!title || !meetingDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'title, meetingDate, startTime и endTime обязательны' });
  }

  // Проверка права на бронирование
  if (organizerId) {
    const userCheck = db.prepare('SELECT can_book_meeting_room, username FROM users WHERE id = ?').get(organizerId);
    if (!userCheck) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const canBook = userCheck.can_book_meeting_room === 1 || userCheck.username === 'Root';
    if (!canBook) {
      return res.status(403).json({ error: 'Нет права на бронирование переговорной' });
    }
  }

  // Проверка пересечений по времени (исключая текущее бронирование)
  const overlapCheck = db.prepare(`
    SELECT id FROM meeting_room_bookings 
    WHERE meeting_date = ? AND id != ? AND (
      (start_time < ? AND end_time > ?)
    )
  `).get(meetingDate, id, endTime, startTime);
  
  if (overlapCheck) {
    return res.status(409).json({ error: 'Это время уже забронировано' });
  }

  // Рассчитываем reminder_time если выбрано напоминание
  let reminderTime = null;
  if (reminderMinutes && parseInt(reminderMinutes) > 0) {
    const baseDate = new Date(`${meetingDate}T${startTime}`);
    reminderTime = new Date(baseDate.getTime() - parseInt(reminderMinutes) * 60 * 1000).toISOString().slice(0, 19);
  }

  try {
    db.run(`
      UPDATE meeting_room_bookings 
      SET title = ?, description = ?, meeting_date = ?, start_time = ?, end_time = ?, reminder_minutes = ?, reminder_time = ?, reminder_sent = 0
      WHERE id = ?
    `, [title, description || null, meetingDate, startTime, endTime, reminderMinutes || null, reminderTime, id]);
    
    // Синхронизируем участников
    const participantsList = req.body.participants;
    if (participantsList && Array.isArray(participantsList)) {
      // Удаляем старых участников
      db.run('DELETE FROM meeting_room_booking_participants WHERE booking_id = ?', [id]);
      // Добавляем новых
      if (participantsList.length > 0) {
        const insertParticipant = db.prepare('INSERT INTO meeting_room_booking_participants (booking_id, user_id, username) VALUES (?, ?, ?)');
        const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
        for (const userId of participantsList) {
          const userRow = getUser.get(userId);
          if (userRow) {
            insertParticipant.run(id, userId, userRow.username);
          }
        }
      }
    }
    
    const updatedBooking = db.prepare('SELECT * FROM meeting_room_bookings WHERE id = ?').get(id);
    
    res.json({ 
      success: true, 
      booking: updatedBooking ? {
        id: updatedBooking.id,
        title: updatedBooking.title,
        description: updatedBooking.description,
        meeting_date: updatedBooking.meeting_date,
        start_time: updatedBooking.start_time,
        end_time: updatedBooking.end_time,
        organizer_id: updatedBooking.organizer_id,
        organizer_name: updatedBooking.organizer_name,
        reminder_minutes: updatedBooking.reminder_minutes,
        reminder_time: updatedBooking.reminder_time
      } : null
    });
  } catch (err) {
    console.error('Ошибка обновления бронирования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для создания задачи
app.post('/api/calendar/tasks', (req, res) => {
  const { userId, title, description, taskDate, taskTime, taskEndTime, color, reminderType, sourceChatId, sourceMessageId } = req.body;

  if (!userId || !title || !taskDate) {
    return res.status(400).json({ error: 'userId, title и taskDate обязательны' });
  }

  const taskId = uuidv4();

  try {
    // Рассчитываем время напоминания если выбран reminderType
    let reminderTime = null;
    if (reminderType && reminderType !== 'none') {
      const baseDate = new Date(`${taskDate}${taskTime ? 'T' + taskTime : 'T09:00'}`);

      // Получаем имя пользователя для логирования
      const user = getUserById(userId);

      if (reminderType === '1h') {
        reminderTime = new Date(baseDate.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '3h') {
        reminderTime = new Date(baseDate.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '6h') {
        reminderTime = new Date(baseDate.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === 'custom' && req.body.reminderCustomTime) {
        // reminderCustomTime — строка времени HH:MM
        reminderTime = new Date(`${taskDate}T${req.body.reminderCustomTime}`).toISOString().slice(0, 19);
      }

      if (reminderTime && user) {
        scheduleTaskReminder(taskId, userId, user.username, title, taskDate, taskTime || null, reminderTime);
      }
    }

    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, task_end_time, color, reminder_time, source_chat_id, source_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [taskId, userId, title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', reminderTime, sourceChatId || null, sourceMessageId || null]);


    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);

    // Уведомляем все подключенные клиенты о создании задачи
    io.emit('task_created', { task, userId });

    res.json({ success: true, task });
  } catch (err) {
    console.error('Ошибка создания задачи:', err);
    res.status(500).json({ error: 'Ошибка при создании задачи' });
  }
});

// API для обновления задачи
app.put('/api/calendar/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { title, description, taskDate, taskTime, taskEndTime, color, reminderType, reminderCustomTime } = req.body;

  if (!title || !taskDate) {
    return res.status(400).json({ error: 'title и taskDate обязательны' });
  }

  try {
    // Получаем текущую задачу для расчёта напоминания
    const existingTask = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    let reminderTime = null;

    if (reminderType && reminderType !== 'none' && existingTask) {
      const baseDate = new Date(`${taskDate}${taskTime ? 'T' + taskTime : 'T09:00'}`);
      const user = getUserById(existingTask.user_id);

      if (reminderType === '1h') {
        reminderTime = new Date(baseDate.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '3h') {
        reminderTime = new Date(baseDate.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === '6h') {
        reminderTime = new Date(baseDate.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
      } else if (reminderType === 'custom' && reminderCustomTime) {
        reminderTime = new Date(`${taskDate}T${reminderCustomTime}`).toISOString().slice(0, 19);
      }

      if (reminderTime && user) {
        scheduleTaskReminder(taskId, existingTask.user_id, user.username, title, taskDate, taskTime || null, reminderTime);
      }
    } else if (reminderType === 'none') {
      // Убираем напоминание
      pendingReminders.delete(taskId);
    }

    db.run(`
      UPDATE calendar_tasks
      SET title = ?, description = ?, task_date = ?, task_time = ?, task_end_time = ?, color = ?, reminder_time = ?
      WHERE id = ?
    `, [title, description || null, taskDate, taskTime || null, taskEndTime || null, color || '#667eea', reminderTime, taskId]);


    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);

    // Уведомляем все подключенные клиенты об обновлении задачи
    io.emit('task_updated', { task, taskId });

    res.json({ success: true, task });
  } catch (err) {
    console.error('Ошибка обновления задачи:', err);
    res.status(500).json({ error: 'Ошибка при обновлении задачи' });
  }
});
app.delete('/api/calendar/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;

  try {
    // Сначала получаем задачу для уведомления
    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    // Удаляем связанные записи
    db.run('DELETE FROM task_shares WHERE task_id = ?', [taskId]);
    // Удаляем задачу
    db.run('DELETE FROM calendar_tasks WHERE id = ?', [taskId]);

    // Отменяем запланированное напоминание если есть
    const oldTimeout = pendingReminders.get(taskId);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
      pendingReminders.delete(taskId);
    }


    // Уведомляем все подключенные клиенты об удалении задачи
    io.emit('task_deleted', { taskId, userId: task.user_id });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления задачи:', err);
    res.status(500).json({ error: 'Ошибка при удалении задачи' });
  }
});

// API для получения списка пользователей

app.post('/api/calendar/tasks/:taskId/share', (req, res) => {
  const { taskId } = req.params;
  const { fromUserId, toUserIds } = req.body;

  if (!taskId || !fromUserId || !toUserIds || !Array.isArray(toUserIds)) {
    return res.status(400).json({ error: 'taskId, fromUserId и toUserIds обязательны' });
  }

  try {
    const task = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    const shareIds = [];
    toUserIds.forEach(toUserId => {
      const shareId = uuidv4();
      db.run(`
        INSERT INTO task_shares (id, task_id, from_user_id, to_user_id, status)
        VALUES (?, ?, ?, ?, 'pending')
      `, [shareId, taskId, fromUserId, toUserId]);
      shareIds.push(shareId);

      // Уведомляем получателя о новой общей задаче через WebSocket
      const recipientEntry = Array.from(onlineUsers.entries()).find(([sid, u]) => u.id === toUserId);
      if (recipientEntry) {
        io.to(recipientEntry[0]).emit('shared_task_received', {
          shareId,
          task_id: taskId,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          task_date: task.task_date,
          task_time: task.task_time,
          color: task.color || '#667eea'
        });
      }
    });


    res.json({ success: true, shareIds });
  } catch (err) {
    console.error('Ошибка отправки задачи:', err);
    res.status(500).json({ error: 'Ошибка при отправке задачи' });
  }
});

// API для получения полученных задач
app.get('/api/calendar/tasks/shared/received', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  try {
    const rows = db.prepare(`
      SELECT ts.*, ct.title, ct.description, ct.task_date, ct.task_time, ct.color,
             u.username as from_username, u.avatar as from_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.from_user_id = u.id
      WHERE ts.to_user_id = ?
      ORDER BY ts.created_at DESC
    `).all(userId);

    const shares = rows.map(row => ({
      id: row.id,
      task_id: row.task_id,
      from_user_id: row.from_user_id,
      from_username: row.from_username,
      from_avatar: row.from_avatar,
      to_user_id: row.to_user_id,
      status: row.status,
      created_at: row.created_at,
      task: {
        id: row.task_id,
        title: row.title,
        description: row.description,
        task_date: row.task_date,
        task_time: row.task_time,
        color: row.color
      }
    }));

    res.json({ shares });
  } catch (err) {
    console.error('Ошибка получения задач:', err);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});

// API для получения отправленных задач
app.get('/api/calendar/tasks/shared/sent', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  try {
    const rows = db.prepare(`
      SELECT ts.*, ct.title, ct.task_date,
             u.username as to_username, u.avatar as to_avatar
      FROM task_shares ts
      JOIN calendar_tasks ct ON ts.task_id = ct.id
      JOIN users u ON ts.to_user_id = u.id
      WHERE ts.from_user_id = ?
      ORDER BY ts.created_at DESC
    `).all(userId);

    const shares = rows.map(row => ({
      id: row.id,
      task_id: row.task_id,
      to_user_id: row.to_user_id,
      to_username: row.to_username,
      to_avatar: row.to_avatar,
      status: row.status,
      created_at: row.created_at,
      task: {
        id: row.task_id,
        title: row.title,
        task_date: row.task_date
      }
    }));

    res.json({ shares });
  } catch (err) {
    console.error('Ошибка получения задач:', err);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});

// API для принятия задачи
app.post('/api/calendar/tasks/shared/:shareId/accept', (req, res) => {
  const { shareId } = req.params;
  const { userId } = req.body;

  if (!shareId || !userId) {
    return res.status(400).json({ error: 'shareId и userId обязательны' });
  }

  try {
    // Используем прямой запрос вместо prepared statement
    const share = db.prepare('SELECT * FROM task_shares WHERE id = ?').get(shareId);
    
    if (!share) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (share.to_user_id !== userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const originalTask = db.prepare('SELECT * FROM calendar_tasks WHERE id = ?').get(share.task_id);
    
    if (!originalTask) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    const newTaskId = uuidv4();
    const values = [
      newTaskId, 
      userId, 
      originalTask.title || 'Без названия',
      originalTask.description !== undefined && originalTask.description !== null ? originalTask.description : null,
      originalTask.task_date || new Date().toISOString().split('T')[0],
      originalTask.task_time !== undefined && originalTask.task_time !== null ? originalTask.task_time : null, 
      originalTask.color !== undefined && originalTask.color !== null ? originalTask.color : '#667eea'
    ];
    
    db.run(`
      INSERT INTO calendar_tasks (id, user_id, title, description, task_date, task_time, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, values);


    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['accepted', shareId]);


    // Уведомляем о принятии задачи (отправителю и получателю)
    io.emit('shared_task_accepted', { shareId, user_id: userId, new_task_id: newTaskId });

    res.json({ success: true, taskId: newTaskId });
  } catch (err) {
    console.error('Ошибка принятия задачи:', err);
    res.status(500).json({ error: 'Ошибка при принятии задачи' });
  }
});

// API для отклонения задачи
app.post('/api/calendar/tasks/shared/:shareId/decline', (req, res) => {
  const { shareId } = req.params;
  const { userId } = req.body;

  if (!shareId || !userId) {
    return res.status(400).json({ error: 'shareId и userId обязательны' });
  }

  try {
    const share = db.prepare('SELECT * FROM task_shares WHERE id = ?').get(shareId);
    if (!share) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    if (share.to_user_id !== userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    db.run('UPDATE task_shares SET status = ? WHERE id = ?', ['declined', shareId]);


    // Уведомляем об отклонении задачи
    io.emit('shared_task_declined', { shareId, user_id: userId });

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отклонения задачи:', err);
    res.status(500).json({ error: 'Ошибка при отклонении задачи' });
  }
});

// API для получения сообщений чата
};
