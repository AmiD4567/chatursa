/**
 * Все обработчики Socket.IO (io.on('connection')).
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
module.exports = function registerSocketHandlers(deps) {
  const { db, io, onlineUsers, userActivity, userSocketMap, emitToUser,
          encryptText, decryptText, uuidv4, checkAdmin,
          getUserById, getUserByUsername, getChatById, getDirectChatBetweenUsers,
          getChatWithDetails, getUserChats, getChatMessages, getAllUsers, generateUserId,
          distributeChatMessage, sendBotMessage, getBotResponse, ensureBotChat, getChatDisplayName,
          botRateLimit, wsRateMap, checkWsRateLimit,
          userTotalUploadSize, DEFAULT_UPLOAD_QUOTA, conversationStates, botAnalytics,
          processConversationState, isDialogStartCommand, startConversation,
          clearConversation, handleTodayCommand, handleContactsCommand } = deps;



  // ══════════════════════════════════════════
  // Звонки 1:1 — сигналинг WebRTC
  // ══════════════════════════════════════════
  const CALL_RING_TIMEOUT = parseInt(process.env.CALL_RING_TIMEOUT_MS || '45000', 10);
  const callRings = new Map();   // callId -> timeout гудков
  const callPeers  = new Map();  // callId -> { initiatorId, peerId, status, callType }
  const callBusy   = new Map();  // userId -> callId (занят существующим звонком)

  const endRingTimer = (callId) => {
    const t = callRings.get(callId);
    if (t) { clearTimeout(t); callRings.delete(callId); }
  };
  const releaseBusy = (callId) => {
    for (const [uid, cid] of Array.from(callBusy.entries())) {
      if (cid === callId) callBusy.delete(uid);
    }
  };

  // Системное сообщение о пропущенном звонке (создаёт direct-чат при необходимости)
  const insertMissedCallMessage = (fromInfo, toUserId, callType) => {
    try {
      let chat = getDirectChatBetweenUsers(fromInfo.id, toUserId);
      if (!chat || !chat.id) {
        const chatId = uuidv4();
        db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
        db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, fromInfo.id]);
        db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, toUserId]);
        chat = { id: chatId };
      }
      const label = callType === 'video' ? 'видеозвонок' : 'аудиозвонок';
      const msg = {
        id: uuidv4(), chatId: chat.id, senderId: fromInfo.id,
        text: `📞 Пропущенный ${label}`, timestamp: new Date().toISOString()
      };
      db.prepare(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`)
        .run(msg.id, chat.id, msg.senderId, msg.text, msg.timestamp);
      distributeChatMessage(chat.id, {
        ...msg, file: null, reply_to: null,
        senderName: fromInfo.username, senderAvatar: fromInfo.avatar
      }, getChatById(chat.id));
    } catch (e) {
      console.error('insertMissedCallMessage:', e.message);
    }
  };

  // Зачистка при обрыве соединения пользователя
  const cleanupCallsFor = (userId) => {
    const callId = callBusy.get(userId);
    if (!callId) return;
    const meta = callPeers.get(callId);
    callBusy.delete(userId);
    if (!meta) return;
    const otherId = userId === meta.initiatorId ? meta.peerId : meta.initiatorId;
    endRingTimer(callId);

    if (meta.status === 'ringing') {
      if (userId === meta.initiatorId) {
        meta.status = 'cancelled';
        db.run(`UPDATE calls SET status='cancelled', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
        releaseBusy(callId);
        emitToUser(otherId, 'call_cancelled', { callId });
      } else {
        meta.status = 'missed';
        db.run(`UPDATE calls SET status='missed', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
        releaseBusy(callId);
        const initiator = getUserById(meta.initiatorId);
        if (initiator) insertMissedCallMessage(initiator, meta.peerId, meta.callType);
        emitToUser(otherId, 'call_missed', { callId });
      }
      return;
    }

    // активный звонок — вторая сторона видит разрыв
    meta.status = 'ended';
    db.run(`UPDATE calls SET status='ended', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
    emitToUser(otherId, 'call_ended', { callId });
  };

io.on('connection', (socket) => {
  const clientIp = socket.handshake?.address?.replace(/^::ffff:/, '') || 'unknown';
  const userAgent = socket.handshake?.headers?.['user-agent'] || 'unknown';

  // Middleware: проверка членства в чате для отправки сообщений
  socket.use(([event, data], next) => {
    if (event === 'send_message' && data && data.chatId) {
      const onlineUser = onlineUsers.get(socket.id);
      if (onlineUser) {
        const isParticipant = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(data.chatId, onlineUser.id);
        if (!isParticipant) {
          console.warn(`WS middleware: socket ${socket.id} пытается отправить сообщение в чат ${data.chatId} без членства`);
          socket.emit('error', { message: 'Вы не являетесь участником этого чата. Попробуйте переподключиться.' });
          return;
        }
      }
    }
    next();
  });

  // Пытаемся получить имя компьютера через reverse DNS lookup
  if (clientIp !== 'unknown' && clientIp !== '127.0.0.1' && !clientIp.startsWith('::')) {
    const dns = require('dns');
    dns.reverse(clientIp, (err, hostnames) => {
      if (!err && hostnames && hostnames.length > 0) {
        const computerName = hostnames[0].split('.')[0];
        const currentUser = onlineUsers.get(socket.id);
        if (currentUser) {
          db.run('UPDATE users SET host = ? WHERE id = ?', [computerName, currentUser.id]);
        }
      }
    });
  }

  // Пользователь присоединяется (первичное подключение с данными из localStorage)
  // Сервер ищет пользователя в БД по userId и добавляет в onlineUsers.
  // socket.id используется как ключ в onlineUsers Map.
  // Поддерживается несколько сокетов на одного пользователя (несколько вкладок).
  socket.on('user_joined', (data) => {
    const { userId, email, username, deviceId, deviceName, appVersion } = data || {};

    if (!userId && !email && !username) {
      console.error('user_joined: нет userId/email/username');
      return;
    }

    // Ищем пользователя в БД
    try {
      let user = null;

      // Пытаемся найти пользователя по userId
      if (userId) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE id = ?').get(userId);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      // Если не нашли по userId, ищем по email
      if (!user && email) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE email = ?').get(email);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      // Если не нашли, ищем по username
      if (!user && username) {
        const row = db.prepare('SELECT id, username, avatar, email, status_text FROM users WHERE username = ?').get(username);
        if (row) {
          user = { id: String(row.id), username: String(row.username), avatar: String(row.avatar || ''), email: String(row.email || ''), statusText: String(row.status_text || '') };
        }
      }

      if (!user) {
        console.error('user_joined: пользователь не найден в БД', { userId, email, username });
        return;
      }

      // Добавляем сокет в onlineUsers (не удаляем старые — поддерживаем несколько вкладок)
      onlineUsers.set(socket.id, {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        socketId: socket.id,
        status: 'online'
      });

      // Добавляем в userSocketMap
      if (!userSocketMap.has(user.id)) {
        userSocketMap.set(user.id, new Set());
      }
      userSocketMap.get(user.id).add(socket.id);

      // Сохраняем сессию в БД (legacy)
      try {
        const existingRow = db.prepare('SELECT socket_ids FROM user_sessions WHERE user_id = ?').get(user.id);
        let sockets = [];
        if (existingRow) {
          try { sockets = JSON.parse(existingRow.socket_ids); } catch {}
        }
        if (!sockets.includes(socket.id)) sockets.push(socket.id);
        db.run('INSERT OR REPLACE INTO user_sessions (user_id, socket_ids, last_seen) VALUES (?, ?, ?)',
          [user.id, JSON.stringify(sockets), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения сессии:', e.message);
      }

      // Сохраняем запись для админ-панели сессий
      try {
        const adminSessionId = uuidv4();
        const ipAddr = socket.handshake?.address || '';
        const browserInfo = socket.handshake?.headers?.['user-agent'] || '';
        db.run(`INSERT OR IGNORE INTO admin_user_sessions (id, user_id, socket_id, ip_address, browser, login_time, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [adminSessionId, user.id, socket.id, ipAddr, browserInfo, new Date().toISOString(), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения админ-сессии:', e.message);
      }

      // Сохраняем устройство/сессию (multi-device)
      const resolvedDeviceId = deviceId || `unknown-${socket.id}`;
      const resolvedDeviceName = deviceName || 'Unknown Device';
      const clientIp = socket.handshake?.address || '';
      try {
        const existingDevice = db.prepare('SELECT id, socket_ids FROM user_device_sessions WHERE user_id = ? AND device_id = ?').get(user.id, resolvedDeviceId);
        if (existingDevice) {
          let devSockets = [];
          try { devSockets = JSON.parse(existingDevice.socket_ids); } catch {}
          if (!devSockets.includes(socket.id)) devSockets.push(socket.id);
          db.run('UPDATE user_device_sessions SET socket_ids = ?, last_seen = ?, is_current = 1 WHERE id = ?',
            [JSON.stringify(devSockets), new Date().toISOString(), existingDevice.id]);
        } else {
          const sessionId = uuidv4();
          db.run(`INSERT INTO user_device_sessions (id, user_id, device_id, device_name, ip_address, socket_ids, login_time, last_seen, is_current)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sessionId, user.id, resolvedDeviceId, resolvedDeviceName, clientIp, JSON.stringify([socket.id]), new Date().toISOString(), new Date().toISOString()]);
        }
      } catch (e) {
        console.error('Ошибка сохранения устройства:', e.message);
      }

      // Обновляем статус в БД
      db.run('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);

      // Сохраняем версию клиента
      if (appVersion) {
        db.run('UPDATE users SET app_version = ? WHERE id = ?', [String(appVersion).slice(0, 50), user.id]);
      }
      

      // Отправляем пользователю его чаты
      let userChats = getUserChats(user.id);

      // Создаём чат с помощником если не существует
      if (ensureBotChat(user.id)) {
        userChats = getUserChats(user.id);
      }

      socket.emit('user_joined_success', {
        user: { id: user.id, username: user.username, avatar: user.avatar, userId: user.id },
        chats: userChats
      });

      // Уведомляем остальных
      socket.broadcast.emit('user_status_changed', {
        userId: user.id,
        username: user.username,
        status: 'online'
      });
    } catch (err) {
      console.error('user_joined error:', err);
    }
  });

  // Пользователь присоединяется (альтернативный путь: через /api/login → join)
  socket.on('join', (data) => {
    const { username, userId: existingUserId, appVersion } = data;

    let user = null;

    // Проверяем, есть ли уже пользователь в onlineUsers (от user_joined) — если да, не перезаписываем
    const existingEntry = onlineUsers.get(socket.id);
    if (!existingEntry || existingEntry.id === 'pending' || !userActivity.has(existingEntry.id)) {
      // Нет записи или временная — добавляем temp-запись ЧТОБЫ НЕ ПОТЕРЯТЬ пользователя при быстрых запросах
      const tempAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
      onlineUsers.set(socket.id, {
        id: existingUserId || 'pending',
        username: username,
        avatar: tempAvatar,
        socketId: socket.id,
        status: 'online'
      });
    }

    // Проверяем, есть ли существующий пользователь с таким ID
    if (existingUserId) {
      user = getUserById(existingUserId);
      if (user) {
        db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP, ip_address = ? WHERE id = ?', ['online', clientIp, existingUserId]);
      }
    }

    // Если пользователь не найден, ищем по username
    if (!user) {
      user = getUserByUsername(username);
    }

    // Создаем нового пользователя если не найден
    if (!user) {
      const newUserId = existingUserId || generateUserId(clientIp, userAgent);
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

      try {
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, username, avatar, 'unknown', clientIp]);

        user = getUserById(newUserId);
      } catch (err) {
        // Если username уже существует, генерируем уникальный
        const uniqueUsername = `${username}_${Math.floor(Math.random() * 1000)}`;
        db.run(`
          INSERT INTO users (id, username, avatar, host, ip_address, status)
          VALUES (?, ?, ?, ?, ?, 'online')
        `, [newUserId, uniqueUsername, avatar, 'unknown', clientIp]);

        user = getUserById(newUserId);
      }
    }

    // Обновляем данные в onlineUsers (теперь с реальным ID из БД)
    if (user) {
      onlineUsers.set(socket.id, {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        socketId: socket.id,
        status: 'online'
      });
      userActivity.set(user.id, Date.now());

      // Сохраняем версию клиента
      if (appVersion) {
        db.run('UPDATE users SET app_version = ? WHERE id = ?', [String(appVersion).slice(0, 50), user.id]);
      }

      // Сохраняем запись для админ-панели сессий
      try {
        const adminSessionId = uuidv4();
        const ipAddr = socket.handshake?.address || '';
        const browserInfo = socket.handshake?.headers?.['user-agent'] || '';
        db.run(`INSERT OR IGNORE INTO admin_user_sessions (id, user_id, socket_id, ip_address, browser, login_time, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [adminSessionId, user.id, socket.id, ipAddr, browserInfo, new Date().toISOString(), new Date().toISOString()]);
      } catch (e) {
        console.error('Ошибка сохранения админ-сессии:', e.message);
      }
    }

    // Добавляем пользователя в общий чат если еще не там
    const inGeneralChat = db.prepare("SELECT * FROM chat_participants WHERE chat_id = 'general' AND user_id = ?").get(user.id);

    if (!inGeneralChat) {
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', ['general', user.id]);
    }

    // Автоматически присоединяем к комнате общего чата
    socket.join('general');

    // Получаем список чатов пользователя
    let userChats = getUserChats(user.id);

    // Создаём чат с помощником если не существует
    if (ensureBotChat(user.id)) {
      userChats = getUserChats(user.id);
    }

    // Отправляем пользователю его данные
    socket.emit('user_joined_success', {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        userId: user.id
      },
      chats: userChats
    });

    // Проверяем, первый ли это вход пользователя (по полю has_seen_welcome)
    const userWelcomeCheck = db.prepare('SELECT has_seen_welcome FROM users WHERE id = ?').get(user.id);
    const hasSeenWelcome = userWelcomeCheck && userWelcomeCheck.has_seen_welcome === 1;
    const isFirstJoin = !hasSeenWelcome;

    // Отправляем приветственное сообщение от бота при первом входе
    if (isFirstJoin) {
      // Помечаем, что пользователь видел приветствие
      db.run('UPDATE users SET has_seen_welcome = 1 WHERE id = ?', [user.id]);
      const botChatId = `bot-chat-${user.id}`;
      setTimeout(() => {
        try {
          const welcomeMessage = `👋 Здравствуйте, ${user.username}!

Я 🤖 Помощник. Рад видеть вас в команде!

💡 *Совет:* Начните с обучения — это займёт 2 минуты.`;

          const welcomeButtons = [
            { label: '🎯 Пройти обучение', action: '/онбординг' },
            { label: '❓ Все команды', action: '/помощь' }
          ];

          sendBotMessage(socket, botChatId, welcomeMessage, welcomeButtons);
        } catch (e) {
          console.error('Ошибка отправки личного приветствия:', e.message);
        }
      }, 1000);
    }

    // Уведомляем остальных о новом пользователе
    socket.broadcast.emit('user_status_changed', {
      userId: user.id,
      username: user.username,
      status: 'online'
    });

    // Приветствие нового пользователя в общем чате (только при первом входе)
    if (isFirstJoin) {
      setTimeout(() => {
        try {
          const welcomeText = `👋 Коллеги, поприветствуйте нового участника — **[${user.username}](user:${user.username})**!

Рады видеть вас в нашей команде! 🎉`;

          // Отправляем сообщение в общий чат от имени помощника
          const botResult = db.prepare("SELECT id FROM users WHERE username = 'Помощник'").get();
          if (botResult) {
            const botId = botResult.id;
            const messageId = uuidv4();
            const encryptedText = encryptText(welcomeText || '');
            const timestamp = new Date().toISOString();

            db.run(`
              INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
              VALUES (?, 'general', ?, ?, ?)
            `, [messageId, botId, encryptedText, timestamp]);

            // Отправляем всем в общий чат через единый конвейер доставки:
            // unread_messages + realtime-рассылка + push для офлайн-участников
            distributeChatMessage('general', {
              id: messageId,
              chatId: 'general',
              senderId: botId,
              senderName: 'Помощник',
              senderAvatar: 'https://ui-avatars.com/api/?name=🤖+Бот&background=667eea&color=fff',
              text: welcomeText,
              timestamp,
              isBotMessage: true,
              buttons: []
            }, null, { skipUserId: botId, skipPush: false });
          }
        } catch (e) {
          console.error('Ошибка отправки объявления о новом пользователе:', e.message);
        }
      }, 2000);
    }
  });

  // Создание нового чата
  socket.on('create_chat', (data) => {
    const { type, name, participants } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser) return;

    let chat = null;

    if (type === 'direct') {
      const targetUser = getUserByUsername(participants[0]);
      if (!targetUser) return;

      // Проверяем, существует ли уже чат
      chat = db.prepare(`
        SELECT c.* FROM chats c
        JOIN chat_participants cp1 ON c.id = cp1.chat_id
        JOIN chat_participants cp2 ON c.id = cp2.chat_id
        WHERE c.type = 'direct'
        AND cp1.user_id = ? AND cp2.user_id = ?
      `).get(onlineUser.id, targetUser.id);

      if (!chat) {
        const chatId = uuidv4();
        db.run(`
          INSERT INTO chats (id, type, name, created_by)
          VALUES (?, 'direct', ?, ?)
        `, [chatId, targetUser.username, onlineUser.id]);

        db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);
        db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, targetUser.id]);


        chat = getChatById(chatId);
      }
    } else if (type === 'group') {
      const chatId = uuidv4();
      db.run(`
        INSERT INTO chats (id, type, name, created_by)
        VALUES (?, 'group', ?, ?)
      `, [chatId, name || 'Групповой чат', onlineUser.id]);

      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);

      participants.forEach((pUsername) => {
        const pUser = getUserByUsername(pUsername);
        if (pUser) {
          db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, pUser.id]);
        }
      });


      chat = getChatById(chatId);
    }

    // Рассылка события о новом чате
    const chatWithParticipants = getChatWithDetails(chat.id);

    if (chatWithParticipants.participantsDetails) {
      chatWithParticipants.participantsDetails.forEach((participant) => {
        // Direct-чат: событие уходит только инициатору — иначе пустой чат мгновенно
        // появляется в списке у получателя. Получатель узнает о чате с первым
        // сообщением через chat_updated из distributeChatMessage.
        if (type === 'direct' && participant.id !== onlineUser.id) return;
        emitToUser(participant.id, 'chat_created', { chat: chatWithParticipants });
      });
    }
  });

  // Присоединение к чату
  socket.on('join_chat', (chatId) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    
    socket.join(chatId);
    
    // Проверяем, является ли пользователь участником
    const isParticipant = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, onlineUser.id);
    
    if (!isParticipant) {
      db.run('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, onlineUser.id]);
      
    }

    // Очищаем непрочитанные
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    db.run('UPDATE chat_user_settings SET force_unread = 0 WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    

    
    // Отправляем историю сообщений
    const chatMessages = getChatMessages(chatId, 100, onlineUser.id);
    const hasMoreHistory = chatMessages.length >= 100;
    const chat = getChatWithDetails(chatId);

    socket.emit('chat_history', {
      chatId,
      messages: chatMessages,
      hasMore: hasMoreHistory,
      chat
    });
  });

  // Пагинация истории: порция сообщений СТАРШЕ курсора before (timestamp)
  socket.on('get_messages_before', ({ chatId, before, limit = 50 }, callback) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser || !chatId || !before) return;
    if (typeof callback !== 'function') return;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const older = getChatMessages(chatId, lim + 1, onlineUser.id, String(before));
    const hasMore = older.length > lim;
    const batch = hasMore ? older.slice(0, lim) : older;

    callback({ messages: batch, hasMore });
  });

  // Свежий список чатов (используется при открытии чата из системного уведомления)
  socket.on('get_chats', () => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    socket.emit('chats_list', { chats: getUserChats(onlineUser.id) });
  });

  // Возврат скрытого чата в список (клик по уведомлению скрытого чата)
  socket.on('unhide_chat', ({ chatId } = {}) => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser || !chatId) return;
    try {
      db.run('UPDATE chat_user_settings SET deleted_at = NULL WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    } catch (err) {
      console.error('unhide_chat:', err.message);
    }
  });

  // Возвращает отображаемое имя чата (для direct — имя собеседника)
  // (определение вынесено на модульный уровень: getChatDisplayName)


  socket.on('call_invite', ({ targetUserId, callType } = {}, callback) => {
    const me = onlineUsers.get(socket.id);
    if (!me || !targetUserId || !['audio', 'video'].includes(callType)) return;
    if (targetUserId === me.id) return;
    if (typeof callback !== 'function') return;

    if (callBusy.has(me.id)) return callback({ ok: false, reason: 'you_busy' });
    if (callBusy.has(targetUserId)) return callback({ ok: false, reason: 'peer_busy' });

    const callId = uuidv4();
    const now = new Date().toISOString();
    db.run(`INSERT INTO calls (id, type, initiator_id, peer_id, status, created_at) VALUES (?, ?, ?, ?, 'ringing', ?)`,
      [callId, callType, me.id, targetUserId, now]);
    callPeers.set(callId, { initiatorId: me.id, peerId: targetUserId, status: 'ringing', callType });
    callBusy.set(me.id, callId);
    callBusy.set(targetUserId, callId);

    emitToUser(targetUserId, 'call_incoming', {
      callId, callType,
      from: { id: me.id, username: me.username, avatar: me.avatar }
    });

    callRings.set(callId, setTimeout(() => {
      const meta = callPeers.get(callId);
      if (!meta || meta.status !== 'ringing') return;
      meta.status = 'missed';
      db.run(`UPDATE calls SET status='missed', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
      releaseBusy(callId);
      emitToUser(meta.initiatorId, 'call_missed', { callId });
      emitToUser(meta.peerId, 'call_cancelled', { callId });
      insertMissedCallMessage(me, targetUserId, callType);
    }, CALL_RING_TIMEOUT));

    callback({ ok: true, callId });
  });

  socket.on('call_accept', ({ callId } = {}) => {
    const me = onlineUsers.get(socket.id);
    const meta = callPeers.get(callId);
    if (!me || !meta || meta.peerId !== me.id || meta.status !== 'ringing') return;
    endRingTimer(callId);
    meta.status = 'active';
    db.run(`UPDATE calls SET status='active', answered_at=? WHERE id=?`, [new Date().toISOString(), callId]);
    emitToUser(meta.initiatorId, 'call_accepted', { callId });
  });

  socket.on('call_decline', ({ callId } = {}) => {
    const me = onlineUsers.get(socket.id);
    const meta = callPeers.get(callId);
    if (!me || !meta || meta.peerId !== me.id || meta.status !== 'ringing') return;
    endRingTimer(callId);
    meta.status = 'declined';
    releaseBusy(callId);
    db.run(`UPDATE calls SET status='declined', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
    emitToUser(meta.initiatorId, 'call_declined', { callId });
  });

  socket.on('call_cancel', ({ callId } = {}) => {
    const me = onlineUsers.get(socket.id);
    const meta = callPeers.get(callId);
    if (!me || !meta || meta.initiatorId !== me.id || meta.status !== 'ringing') return;
    endRingTimer(callId);
    meta.status = 'cancelled';
    releaseBusy(callId);
    db.run(`UPDATE calls SET status='cancelled', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
    emitToUser(meta.peerId, 'call_cancelled', { callId });
  });

  socket.on('call_hangup', ({ callId } = {}) => {
    const me = onlineUsers.get(socket.id);
    const meta = callPeers.get(callId);
    if (!me || !meta) return;
    if (me.id !== meta.initiatorId && me.id !== meta.peerId) return;
    endRingTimer(callId);
    meta.status = 'ended';
    releaseBusy(callId);
    db.run(`UPDATE calls SET status='ended', ended_at=? WHERE id=?`, [new Date().toISOString(), callId]);
    const otherId = me.id === meta.initiatorId ? meta.peerId : meta.initiatorId;
    emitToUser(otherId, 'call_ended', { callId });
  });

  // Ретрансляция SDP/ICE между участниками звонка
  socket.on('rtc_relay', ({ toUserId, payload } = {}) => {
    const me = onlineUsers.get(socket.id);
    const callId = payload && payload.callId;
    const meta = callPeers.get(callId);
    if (!me || !meta || !toUserId || !payload) return;
    if (me.id !== meta.initiatorId && me.id !== meta.peerId) return;
    if (toUserId !== meta.initiatorId && toUserId !== meta.peerId) return;
    emitToUser(toUserId, 'rtc_signal', { fromUserId: me.id, payload });
  });


  // Отправка сообщения
  socket.on('send_message', (data, callback) => {
    if (!checkWsRateLimit(socket.id)) {
      if (typeof callback === 'function') callback({ ok: false, error: 'rate_limited' });
      socket.emit('error', { message: 'Слишком много запросов. Подождите.' });
      return;
    }
    const { chatId, text, file, forwardedFrom, replyTo, e2ee, e2ee_nonce, e2ee_ephemeral, expiresAt } = data;
    let onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser) {
      console.error('[send_message] нет пользователя (onlineUser не найден), socket:', socket.id);
      if (typeof callback === 'function') callback({ ok: false, error: 'no_session' });
      // Пытаемся восстановить из localStorage данных сокета
      return;
    }

    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      console.error('[send_message] неверный chatId:', chatId, 'от', onlineUser.username);
      if (typeof callback === 'function') callback({ ok: false, error: 'bad_chat' });
      return;
    }

    const chat = getChatById(chatId);
    if (!chat) {
      console.error('[send_message] чат не найден:', chatId, 'от', onlineUser.username);
      if (typeof callback === 'function') callback({ ok: false, error: 'chat_not_found' });
      return;
    }

    // Проверка квоты загрузок
    if (file && file.size) {
      const currentTotal = userTotalUploadSize.get(onlineUser.id) || 0;
      const quota = DEFAULT_UPLOAD_QUOTA;
      if (currentTotal + Number(file.size) > quota) {
        console.warn(`[send_message] Квота превышена для ${onlineUser.username}: ${currentTotal}/${quota}`);
        if (typeof callback === 'function') callback({ ok: false, error: 'quota_exceeded' });
        socket.emit('upload_error', { error: 'Превышена квота загрузок (500MB)', code: 'QUOTA_EXCEEDED' });
        return;
      }
    }

    const messageId = uuidv4();
    const fileDataStr = file ? JSON.stringify(file) : null;
    const forwardedFromStr = forwardedFrom ? JSON.stringify(forwardedFrom) : null;
    const replyToStr = replyTo ? JSON.stringify(replyTo) : null;
    const timestamp = new Date().toISOString(); // Используем локальное время клиента

    try {
      let storedText, storedE2EE, storedNonce, storedEphemeral;

      if (e2ee) {
        // E2EE: храним ciphertext как есть (сервер не расшифровывает)
        storedText = text || '';
        storedE2EE = 1;
        storedNonce = e2ee_nonce || null;
        storedEphemeral = e2ee_ephemeral || null;
      } else {
        // Обычное серверное шифрование
        storedText = encryptText(text || '');
        storedE2EE = 0;
        storedNonce = null;
        storedEphemeral = null;
      }

      // Вставляем сообщение с временем клиента
      const expiresAtStr = expiresAt || null;
      db.run(`
        INSERT INTO messages (id, chat_id, sender_id, text, file_data, reply_to, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [messageId, chatId, onlineUser.id, storedText, fileDataStr, replyToStr, timestamp, forwardedFromStr, storedE2EE, storedNonce, storedEphemeral, expiresAtStr]);

      // Помечаем активность БД — перезапускает таймер автосохранения
      

      // Получаем информацию о сообщении
      const msgRow = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,
               m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral, m.expires_at,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(messageId);
      let messageRow = null;
      let isE2EE = false;
      if (msgRow) {
        isE2EE = msgRow.e2ee === 1 || msgRow.e2ee === true;
        messageRow = {
          id: String(msgRow.id || ''),
          chat_id: String(msgRow.chat_id || ''),
          sender_id: String(msgRow.sender_id || ''),
          text: isE2EE ? String(msgRow.text || '') : decryptText(String(msgRow.text || '')),
          file_data: String(msgRow.file_data || ''),
          reply_to: msgRow.reply_to,
          timestamp: String(msgRow.timestamp || ''),
          forwarded_from: msgRow.forwarded_from,
          senderName: String(msgRow.senderName || msgRow.username || ''),
          senderAvatar: String(msgRow.senderAvatar || msgRow.avatar || ''),
          e2ee: isE2EE ? 1 : 0,
          e2ee_nonce: isE2EE ? String(msgRow.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: isE2EE ? String(msgRow.e2ee_ephemeral || '') : undefined,
          expires_at: msgRow.expires_at || null
        };
      }

      if (!messageRow) {
        console.error('[send_message] не удалось получить сообщение после вставки, messageId:', messageId);
        if (typeof callback === 'function') callback({ ok: false, error: 'save_failed' });
        return;
      }

      // Форматируем сообщение
      const formattedMessage = {
        id: messageRow.id,
        chatId: messageRow.chatId || messageRow.chat_id,
        senderId: messageRow.sender_id,
        senderName: messageRow.senderName,
        senderAvatar: messageRow.senderAvatar,
        text: messageRow.text || '',
        file: messageRow.file_data ? JSON.parse(messageRow.file_data) : null,
        reply_to: messageRow.reply_to ? JSON.parse(messageRow.reply_to) : null,
        replyCount: 0,
        timestamp: messageRow.timestamp,
        read_at: messageRow.read_at,
        forwarded_from: messageRow.forwarded_from ? JSON.parse(messageRow.forwarded_from) : null,
        readBy: [onlineUser.username],
        e2ee: messageRow.e2ee || 0,
        e2ee_nonce: messageRow.e2ee_nonce,
        e2ee_ephemeral: messageRow.e2ee_ephemeral,
        expires_at: messageRow.expires_at || null
      };

      // Обновляем квоту загрузок
      if (file && file.size) {
        const currentTotal = userTotalUploadSize.get(onlineUser.id) || 0;
        userTotalUploadSize.set(onlineUser.id, currentTotal + Number(file.size));
      }

      // Присоединяем отправителя к комнате чата если ещё не присоединён
      if (!socket.rooms.has(chatId)) {
        socket.join(chatId);
      }

      // Отправляем сообщение всем в чате (включая отправителя):
      // unread_messages для непрочитанных, realtime-рассылка и push офлайн-участникам
      distributeChatMessage(chatId, formattedMessage, chat, { skipUserId: onlineUser.id });

      // Подтверждаем доставку клиенту (после вставки в БД и рассылки)
      if (typeof callback === 'function') callback({ ok: true, messageId });

      // @mentions: уведомляем упомянутых пользователей
      if (formattedMessage.text && !isE2EE) {
        const mentionRegex = /@(\S+)/g;
        let match;
        const participantsWithUsers = db.prepare(`
          SELECT u.id, u.username FROM chat_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.chat_id = ?
        `).all(chatId);
        while ((match = mentionRegex.exec(formattedMessage.text)) !== null) {
          const mentionedUsername = match[1];
          const mentionedUser = participantsWithUsers.find(p => p.username === mentionedUsername);
          if (mentionedUser && mentionedUser.id !== onlineUser.id) {
            emitToUser(mentionedUser.id, 'user_mentioned', {
              chatId,
              messageId,
              senderName: onlineUser.username,
              senderAvatar: onlineUser.avatar || '',
              text: formattedMessage.text
            });
          }
        }
      }
      
    // ============================================
    // Обработка сообщений для бота-помощника
    // ============================================
    // Проверяем, является ли чат чатом с ботом
    const isBotChat = chatId.startsWith('bot-chat-');

    if (isBotChat && text && !file) {
      // Rate-limiting: 2 секунды между командами на один сокет
      const now = Date.now();
      const lastRequest = botRateLimit.get(socket.id);
      if (lastRequest && now - lastRequest < 2000) {
        sendBotMessage(socket, chatId, '⏳ Пожалуйста, подождите пару секунд перед следующей командой.', []);
        return;
      }
      botRateLimit.set(socket.id, now);

      const command = text.trim().toLowerCase().split(' ')[0];

      // Проверяем настройки бота
      const getBotSetting = (key) => {
        try {
          const row = db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?').get(key);
          return row ? row.setting_value === '1' : true;
        } catch (e) { return true; }
      };

      // State machine: проверяем контекст разговора
      const stateResult = processConversationState(conversationStates, sendBotMessage, socket, chatId, text, { db, uuidv4, io });

      if (stateResult.handled) {
        return;
      }

      // Если это команда начала нового диалога
      if (isDialogStartCommand(text)) {
        const cleanCommand = text.trim().toLowerCase();
        // Проверяем, включена ли функция
        let featureEnabled = true;
        if (cleanCommand === '/создать задачу') featureEnabled = getBotSetting('task_creation_enabled');
        else if (cleanCommand === '/забронировать переговорку') featureEnabled = getBotSetting('booking_enabled');
        else if (cleanCommand === '/создать опрос') featureEnabled = getBotSetting('poll_creation_enabled');
        else if (cleanCommand === '/обратиться в поддержку') featureEnabled = getBotSetting('support_enabled');
        if (!featureEnabled) {
          sendBotMessage(socket, chatId, '😕 Эта функция временно отключена администратором.', []);
          return;
        }
        startConversation(conversationStates, sendBotMessage, socket, chatId, cleanCommand);
        botAnalytics.recordCommand(cleanCommand);
        return;
      }

      // Обычные команды с данными
      if (command === '/сегодня') {
        handleTodayCommand({ db, sendBotMessage, socket, chatId }, onlineUser);
        botAnalytics.recordCommand('/сегодня');
        return;
      }

      if (command === '/контакты') {
        handleContactsCommand({ db, sendBotMessage, socket, chatId });
        botAnalytics.recordCommand('/контакты');
        return;
      }

      // Поиск по wiki
      if ((command === '/поиск_вики' || text.toLowerCase().includes('поиск вики') || text.toLowerCase().includes('найди в базе знаний')) && getBotSetting('wiki_search_enabled')) {
        const query = text.replace(/\/\w+\s*/, '').trim();
        if (query.length < 2) {
          sendBotMessage(socket, chatId, '🔍 *Поиск по базе знаний*\n\nНапишите, что ищете, после команды.\n\nНапример: *найди в базе знаний как создать чат*', []);
        } else {
          try {
            const onlineUser = onlineUsers.get(socket.id);
            const botUserId = onlineUser ? onlineUser.id : null;
            let botSql = `
              SELECT id, title, content, category_id, access_level, created_by,
                     (SELECT name FROM wiki_categories WHERE id = wiki_articles.category_id) as category_name
              FROM wiki_articles
              WHERE (title LIKE ? OR content LIKE ?)`;
            const botParams = [`%${query}%`, `%${query}%`];

            if (botUserId) {
              const isBotAdmin = checkAdmin(botUserId);
              if (!isBotAdmin) {
                botSql += ` AND (
                  access_level IS NULL OR
                  access_level = 'public' OR
                  created_by = ? OR
                  (access_level = 'selected' AND id IN (
                    SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
                  ))
                )`;
                botParams.push(botUserId, botUserId);
              }
            }

            botSql += ' ORDER BY views DESC LIMIT 5';
            const results = db.prepare(botSql).all(...botParams);
            if (results.length === 0) {
              sendBotMessage(socket, chatId, `🔍 По запросу "${query}" ничего не найдено в базе знаний.`, []);
            } else {
              let response = `🔍 *Результаты поиска по запросу:* "${query}"\n\n`;
              results.forEach((r, i) => {
                const snippet = r.content.replace(/<[^>]*>/g, '').substring(0, 100);
                response += `${i+1}. *${r.title}*${r.category_name ? ` (${r.category_name})` : ''}\n   ${snippet}...\n\n`;
              });
              sendBotMessage(socket, chatId, response, [{ label: '📚 База знаний', action: '/база_знаний' }]);
            }
          } catch (e) {
            sendBotMessage(socket, chatId, '😕 Ошибка поиска по базе знаний.', []);
          }
        }
        botAnalytics.recordCommand('/поиск_вики');
        return;
      }

      // Поиск файлов
      if ((command === '/поиск_файлов' || text.toLowerCase().includes('поиск файл') || text.toLowerCase().includes('найди файл')) && getBotSetting('file_search_enabled')) {
        const query = text.replace(/\/\w+\s*/, '').trim();
        if (query.length < 2) {
          sendBotMessage(socket, chatId, '🔍 *Поиск файлов*\n\nНапишите название файла после команды.\n\nНапример: *найди файл отчёт*', []);
        } else {
          try {
            const results = db.prepare(`
              SELECT m.id, m.chat_id, m.file_data, m.timestamp, m.sender_id, u.username as sender_name,
                     c.name as chat_name
              FROM messages m
              JOIN users u ON m.sender_id = u.id
              LEFT JOIN chats c ON m.chat_id = c.id
              WHERE m.file_data IS NOT NULL AND m.file_data LIKE ?
              ORDER BY m.timestamp DESC LIMIT 10
            `).all(`%${query}%`);
            if (results.length === 0) {
              sendBotMessage(socket, chatId, `🔍 Файлы по запросу "${query}" не найдены.`, []);
            } else {
              let response = `🔍 *Найдено файлов:* ${results.length}\n\n`;
              results.forEach((r, i) => {
                let fileName = r.file_data;
                try {
                  const parsed = JSON.parse(r.file_data);
                  fileName = parsed.name || parsed.fileName || r.file_data;
                } catch (e) {}
                response += `${i+1}. 📎 ${fileName}\n   Отправил: ${r.sender_name}\n   Чат: ${r.chat_name || '—'}\n   ${new Date(r.timestamp).toLocaleString('ru-RU')}\n\n`;
              });
              sendBotMessage(socket, chatId, response, []);
            }
          } catch (e) {
            sendBotMessage(socket, chatId, '😕 Ошибка поиска файлов.', []);
          }
        }
        botAnalytics.recordCommand('/поиск_файлов');
        return;
      }

      // Обычные команды через базу знаний
      const botResponse = getBotResponse(text);

      // Аналитика: если это fallback (ответ по умолчанию) — записываем фразу
      const isFallback = botResponse.text.includes('Я вас не совсем понял');
      if (isFallback) {
        botAnalytics.recordFallback(text);
      } else {
        botAnalytics.recordCommand(command);
      }

      // Показываем индикатор печати бота
      socket.emit('bot_typing', { chatId, isTyping: true });

      // Отправляем ответ с небольшой задержкой для естественности
      setTimeout(() => {
        socket.emit('bot_typing', { chatId, isTyping: false });
        sendBotMessage(socket, chatId, botResponse.text, botResponse.buttons || []);
      }, 500);
      // Онбординг: отмечаем завершение
      if (command === '/онбординг_финиш') {
        try {
          const userId = chatId.replace('bot-chat-', '');
          db.run('UPDATE users SET onboarding_completed = 1 WHERE id = ?', [userId]);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('=== ОШИБКА ПРИ ОТПРАВКЕ СООБЩЕНИЯ ===', err);
    console.error('Stack:', err.stack);
  }
  });

  // Пересылка сообщения
  socket.on('forward_message', (data) => {
    const { messageId, targetUserId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !targetUserId) {
      return;
    }

    // Получаем исходное сообщение
    const msgRow = db.prepare(`
      SELECT id, chat_id, sender_id,
             COALESCE(text, '') as text,
             COALESCE(file_data, '') as file_data,
             timestamp, forwarded_from,
             e2ee, e2ee_nonce, e2ee_ephemeral
      FROM messages
      WHERE id = ?
    `).get(messageId);
    let originalMessage = null;
    if (msgRow) {
      originalMessage = {
        id: String(msgRow.id || ''),
        chat_id: String(msgRow.chat_id || ''),
        sender_id: String(msgRow.sender_id || ''),
        text: String(msgRow.text || ''),
        file_data: String(msgRow.file_data || ''),
        timestamp: String(msgRow.timestamp || ''),
        e2ee: msgRow.e2ee,
        e2ee_nonce: msgRow.e2ee_nonce,
        e2ee_ephemeral: msgRow.e2ee_ephemeral
      };
    }

    if (!originalMessage || !originalMessage.sender_id) {
      return;
    }

    // Получаем или создаём чат между отправителем и получателем
    let chat = getDirectChatBetweenUsers(onlineUser.id, targetUserId);

    if (!chat) {
      // Создаём новый чат
      const chatId = uuidv4();
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      
      chat = { id: chatId, type: 'direct' };
    }

    if (!chat || !chat.id) {
      return;
    }

    if (!originalMessage.sender_id) {
      return;
    }

    // Создаём пересланное сообщение
    const newMessageId = uuidv4();
    
    // Получаем отправителя оригинального сообщения
    let senderUsername = 'Unknown';
    try {
      const sender = getUserById(originalMessage.sender_id);
      senderUsername = sender ? sender.username : 'Unknown';
    } catch (e) {
      console.error('Ошибка получения отправителя:', e.message);
    }
    
    const forwardedFrom = {
      message_id: originalMessage.id,
      sender_id: originalMessage.sender_id,
      sender_name: senderUsername
    };

    if (!chat.id) {
      return;
    }

    // Подготавливаем значения
    const isForwardE2EE = originalMessage.e2ee === 1 || originalMessage.e2ee === true;
    const timestamp = new Date().toISOString(); // Используем текущее время клиента
    let forwardText, forwardE2EE, forwardNonce, forwardEphemeral;

    if (isForwardE2EE) {
      forwardText = originalMessage.text || '';
      forwardE2EE = 1;
      forwardNonce = originalMessage.e2ee_nonce || null;
      forwardEphemeral = originalMessage.e2ee_ephemeral || null;
    } else {
      forwardText = encryptText(originalMessage.text || '');
      forwardE2EE = 0;
      forwardNonce = null;
      forwardEphemeral = null;
    }

    try {
      db.run(
        `INSERT INTO messages (id, chat_id, sender_id, text, file_data, timestamp, forwarded_from, e2ee, e2ee_nonce, e2ee_ephemeral)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newMessageId, chat.id, onlineUser.id, forwardText, originalMessage.file_data || null, timestamp, JSON.stringify(forwardedFrom), forwardE2EE, forwardNonce, forwardEphemeral]
      );
      
    } catch (insertErr) {
      console.error('Ошибка вставки пересланного сообщения:', insertErr.message);
      return;
    }


    // Добавляем непрочитанное для получателя
    db.prepare('INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)')
      .run(targetUserId, newMessageId, chat.id);
    const forwardedMessage = db.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.timestamp, m.forwarded_from,
               m.e2ee, m.e2ee_nonce, m.e2ee_ephemeral,
               u.username as senderName, u.avatar as senderAvatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(newMessageId);

      if (!forwardedMessage) return;

      const fwdIsE2EE = forwardedMessage.e2ee === 1 || forwardedMessage.e2ee === true;
      const formattedMessage = {
        id: forwardedMessage.id,
        chatId: forwardedMessage.chat_id,
        senderId: forwardedMessage.sender_id,
        senderName: forwardedMessage.senderName,
        senderAvatar: forwardedMessage.senderAvatar,
        text: fwdIsE2EE ? (forwardedMessage.text || '') : (decryptText(forwardedMessage.text || '') || ''),
        file: forwardedMessage.file_data ? JSON.parse(forwardedMessage.file_data) : null,
        timestamp: forwardedMessage.timestamp,
        forwarded_from: forwardedMessage.forwarded_from ? JSON.parse(forwardedMessage.forwarded_from) : null,
        readBy: [onlineUser.username],
        e2ee: fwdIsE2EE ? 1 : 0,
        e2ee_nonce: fwdIsE2EE ? (forwardedMessage.e2ee_nonce || '') : undefined,
        e2ee_ephemeral: fwdIsE2EE ? (forwardedMessage.e2ee_ephemeral || '') : undefined
      };

      // Уведомляем получателя о новом сообщении
      // Отправляем сообщение получателю (все сессии)
      db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`, [targetUserId, formattedMessage.id, chat.id]);
      emitToUser(targetUserId, 'new_message', {
        message: formattedMessage,
        chat: { id: chat.id, type: chat.type, unreadCount: 1 }
      });

      // Отправляем обновление чата получателю (все сессии)
      const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
      if (chatWithUnread) {
        emitToUser(targetUserId, 'chat_updated', {
          chatId: chat.id,
          chat: chatWithUnread
        });
      }

      // Отправляем подтверждение отправителю
      socket.emit('new_message', {
        message: formattedMessage,
        chat: { id: chat.id, type: chat.type, unreadCount: 0 },
        isOwnMessage: true
      });

      // Отправляем обновление чата отправителю
      const senderChatWithUnread = getChatWithDetails(chat.id, onlineUser.id);
      if (senderChatWithUnread) {
        socket.emit('chat_updated', {
          chatId: chat.id,
          chat: senderChatWithUnread
        });
      }

  });

  // Отправка статьи из базы знаний
  socket.on('wiki_share', (data) => {
    const { articleId, articleTitle, targetUserId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !articleId || !articleTitle || !targetUserId) return;

    let chat = getDirectChatBetweenUsers(onlineUser.id, targetUserId);

    if (!chat) {
      const chatId = uuidv4();
      db.run(`INSERT INTO chats (id, type, created_at) VALUES (?, 'direct', CURRENT_TIMESTAMP)`, [chatId]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, onlineUser.id]);
      db.run(`INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);
      
      chat = { id: chatId, type: 'direct' };
    }

    if (!chat || !chat.id) return;

    const newMessageId = uuidv4();
    const timestamp = new Date().toISOString();
    const text = `📖 Статья в базе знаний: ${articleTitle}\nwiki://${articleId}`;

    db.prepare(`INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES (?, ?, ?, ?, ?)`)
      .run(newMessageId, chat.id, onlineUser.id, text, timestamp);
    

    const formattedMessage = {
      id: newMessageId,
      chatId: chat.id,
      senderId: onlineUser.id,
      senderName: onlineUser.username,
      text,
      timestamp,
      file: null
    };

    db.run(`INSERT OR IGNORE INTO unread_messages (user_id, message_id, chat_id) VALUES (?, ?, ?)`, [targetUserId, newMessageId, chat.id]);
    emitToUser(targetUserId, 'new_message', {
      message: formattedMessage,
      chat: { id: chat.id, type: chat.type, unreadCount: 1 }
    });

    const chatWithUnread = getChatWithDetails(chat.id, targetUserId);
    if (chatWithUnread) {
      emitToUser(targetUserId, 'chat_updated', {
        chatId: chat.id,
        chat: chatWithUnread
      });
    }

    socket.emit('new_message', {
      message: formattedMessage,
      chat: { id: chat.id, type: chat.type, unreadCount: 0 },
      isOwnMessage: true
    });

    const senderChatWithUnread = getChatWithDetails(chat.id, onlineUser.id);
    if (senderChatWithUnread) {
      socket.emit('chat_updated', {
        chatId: chat.id,
        chat: senderChatWithUnread
      });
    }
  });

  // Редактирование сообщения
  socket.on('edit_message', (data) => {
    const { messageId, newText, e2ee, e2ee_nonce } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !newText) {
      return;
    }

    // Проверяем, что сообщение принадлежит текущему пользователю
    const message = db.prepare('SELECT sender_id, chat_id, text, e2ee FROM messages WHERE id = ?').get(messageId);

    if (!message || message.sender_id !== onlineUser.id) {
      return;
    }

    // Обновляем текст сообщения (и нонс для E2EE)
    const isEditE2EE = e2ee || (message.e2ee === 1 || message.e2ee === true);
    const editedAt = new Date().toISOString();
    let storedEditText, storedNonce;
    if (isEditE2EE) {
      storedEditText = newText;
      storedNonce = e2ee_nonce || null;
    } else {
      storedEditText = encryptText(newText);
      storedNonce = null;
    }
    db.run('UPDATE messages SET text = ?, edited = 1, edited_at = ?, e2ee_nonce = COALESCE(?, e2ee_nonce) WHERE id = ?',
      [storedEditText, editedAt, storedNonce, messageId]);

    // Уведомляем всех участников чата об изменении сообщения
    const chatId = message.chat_id;
    // Для не-E2EE сообщений расшифровываем перед отправкой (как в send_message)
    const emitText = isEditE2EE ? storedEditText : decryptText(storedEditText);
    io.to(chatId).emit('message_edited', {
      messageId,
      newText: emitText,
      editedBy: onlineUser.id,
      editedAt,
      e2ee: isEditE2EE ? 1 : 0,
      e2ee_nonce: storedNonce
    });
  });

  // Удаление сообщения (через правую кнопку мыши)
  socket.on('delete_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || messageId === 'undefined' || messageId === 'null') {
      return;
    }

    try {
      // Проверяем, что сообщение принадлежит текущему пользователю или он администратор
      const message = db.prepare('SELECT sender_id, chat_id FROM messages WHERE id = ?').get(messageId);

      if (!message) {
        return;
      }

      // Проверяем, что пользователь является автором сообщения или администратором
      const isAuthor = message.sender_id === onlineUser.id;

      if (!isAuthor) {
        return;
      }

      const chatId = message.chat_id;

      // Удаляем само сообщение из базы данных
      db.run('DELETE FROM messages WHERE id = ?', [messageId]);

      // Удаляем все реакции на это сообщение
      db.run('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);

      // Отправляем уведомление всем участникам чата о удалении сообщения
      io.to(chatId).emit('message_deleted', {
        messageId,
        deletedBy: onlineUser.id,
        chatId
      });
    } catch (err) {
      console.error('Ошибка при удалении сообщения:', err);
    }
  });

  // Активность пользователя (сбрасывает idle-таймер)
  socket.on('user_activity', () => {
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    userActivity.set(onlineUser.id, Date.now());
    if (onlineUser.status === 'idle') {
      onlineUser.status = 'online';
      onlineUsers.set(socket.id, { ...onlineUser });
      io.emit('user_status_changed', {
        userId: onlineUser.id,
        username: onlineUser.username,
        status: 'online'
      });
    }
  });

  // Получение списка пользователей
  socket.on('get_users', () => {
    const allUsers = getAllUsers();

    // Обновляем статусы онлайн
    const onlineUserMap = {};
    for (const [sId, u] of onlineUsers.entries()) {
      onlineUserMap[u.id] = u.status || 'online';
    }
    const usersWithStatus = allUsers.map(u => ({
      ...u,
      status: onlineUserMap[u.id] || 'offline'
    }));

    socket.emit('users_list', usersWithStatus);
  });

  // Статус пользователя (печатает...)
  socket.on('typing', (data) => {
    if (!checkWsRateLimit(socket.id)) return;
    const onlineUser = onlineUsers.get(socket.id);
    if (!onlineUser) return;
    const { chatId, isTyping } = data;
    if (!chatId) return;

    socket.to(chatId).emit('user_typing', {
      chatId,
      username: onlineUser.username,
      isTyping
    });
  });

  // Отметка сообщений как прочитанные
  socket.on('mark_read', (data) => {
    const { chatId } = data;
    const onlineUser = onlineUsers.get(socket.id);
    
    if (!onlineUser || !chatId) return;

    // Удаляем непрочитанные для этого пользователя в этом чате
    db.run('DELETE FROM unread_messages WHERE user_id = ? AND chat_id = ?', [onlineUser.id, chatId]);
    
    // Обновляем read_at для всех сообщений в чате от других пользователей
    const now = new Date().toISOString();

    // Сначала получаем ID сообщений, которые будут отмечены как прочитанные
    const affectedMessages = db.prepare(`
      SELECT id, sender_id FROM messages WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
    `).all(chatId, onlineUser.id);

    if (affectedMessages.length > 0) {
      db.run(`
        UPDATE messages 
        SET read_at = ? 
        WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL
      `, [now, chatId, onlineUser.id]);

      // Сохраняем факт прочтения для каждого сообщения
      const insertRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)');
      const batchInsert = db.transaction((msgs) => {
        for (const msg of msgs) {
          insertRead.run(msg.id, onlineUser.id, now);
        }
      });
      batchInsert(affectedMessages);
    }

    // Уведомляем отправителей о прочтении (все сессии)
    const senderRows = db.prepare(`
      SELECT DISTINCT sender_id FROM messages WHERE chat_id = ? AND sender_id != ?
    `).all(chatId, onlineUser.id);
    const senderIds = senderRows.map(row => row.sender_id);

    senderIds.forEach(senderId => {
      emitToUser(senderId, 'messages_read', {
        chatId,
        readBy: onlineUser.id,
        readAt: now
      });
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    wsRateMap.delete(socket.id);
    const disconnectingUser = onlineUsers.get(socket.id);
    if (disconnectingUser) cleanupCallsFor(disconnectingUser.id);
    const now = new Date().toISOString();
    const onlineUser = onlineUsers.get(socket.id);
    if (onlineUser) {
      // Удаляем из userSocketMap
      const userSockets = userSocketMap.get(onlineUser.id);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) userSocketMap.delete(onlineUser.id);
      }

      // Обновляем сессию в БД (legacy)
      try {
        const existingRow = db.prepare('SELECT socket_ids FROM user_sessions WHERE user_id = ?').get(onlineUser.id);
        if (existingRow) {
          let sockets = [];
          try { sockets = JSON.parse(existingRow.socket_ids); } catch {}
          sockets = sockets.filter(sid => sid !== socket.id);
          if (sockets.length > 0) {
            db.run('INSERT OR REPLACE INTO user_sessions (user_id, socket_ids, last_seen) VALUES (?, ?, ?)',
              [onlineUser.id, JSON.stringify(sockets), new Date().toISOString()]);
          } else {
            db.run('DELETE FROM user_sessions WHERE user_id = ?', [onlineUser.id]);
          }
        }
      } catch (e) {
        console.error('Ошибка обновления сессии при отключении:', e.message);
      }

      // Обновляем устройство (удаляем socket.id из device_sessions)
      try {
        const deviceRows = db.prepare('SELECT id, device_id, socket_ids FROM user_device_sessions WHERE user_id = ?').all(onlineUser.id);
        for (const dev of deviceRows) {
          let devSockets = [];
          try { devSockets = JSON.parse(dev.socket_ids); } catch {}
          const filtered = devSockets.filter(sid => sid !== socket.id);
          if (filtered.length === 0) {
            db.run('DELETE FROM user_device_sessions WHERE id = ?', [dev.id]);
          } else {
            db.run('UPDATE user_device_sessions SET socket_ids = ?, last_seen = ? WHERE id = ?',
              [JSON.stringify(filtered), new Date().toISOString(), dev.id]);
          }
        }
      } catch (e) {
        console.error('Ошибка обновления устройства при отключении:', e.message);
      }

      // Проверяем, есть ли у пользователя другие активные сокеты
      const remainingSockets = userSocketMap.get(onlineUser.id);
      if (!remainingSockets || remainingSockets.size === 0) {
        db.run("UPDATE users SET status = 'offline', last_seen = ? WHERE id = ?", [now, onlineUser.id]);
        io.emit('user_status_changed', {
          userId: onlineUser.id,
          username: onlineUser.username,
          status: 'offline',
          last_seen: now
        });
        userActivity.delete(onlineUser.id);
      }

      onlineUsers.delete(socket.id);
      botRateLimit.delete(socket.id); // Очистка rate-limiting при отключении
    }
  });

  // === ОБРАБОТКА РЕАКЦИЙ ===
  
  // Добавление реакции
  socket.on('add_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение и получаем chat_id
      const messageRow = db.prepare('SELECT id, chat_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        return;
      }

      const chatId = messageRow.chat_id;

      if (!chatId) {
        return;
      }

      // Сначала удаляем все существующие реакции этого пользователя на данное сообщение
      db.run(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_id = ?
      `, [messageId, onlineUser.id]);

      // Добавляем новую реакцию в базу
      db.run(`
        INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [messageId, onlineUser.id, emoji]);

      // Уведомляем всех в чате о добавлении реакции с аватаркой
      io.to(chatId).emit('reaction_added', {
        messageId,
        emoji,
        userId: onlineUser.id,
        username: onlineUser.username,
        avatar: onlineUser.avatar
      });

    } catch (err) {
      console.error('Ошибка при добавлении реакции:', err);
    }
  });

  // Удаление реакции
  socket.on('remove_reaction', (data) => {
    const { messageId, emoji } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId || !emoji) {
      return;
    }

    try {
      // Получаем chat_id сообщения
      const messageData = db.prepare('SELECT chat_id FROM messages WHERE id = ?').get(messageId);

      if (!messageData) {
        return;
      }

      const chatId = messageData.chat_id;

      // Удаляем реакцию из базы
      db.run(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_id = ? AND emoji = ?
      `, [messageId, onlineUser.id, emoji]);

      // Уведомляем всех в чате об удалении реакции
      io.to(chatId).emit('reaction_removed', {
        messageId,
        emoji,
        userId: onlineUser.id
      });

    } catch (err) {
      console.error('Ошибка при удалении реакции:', err);
    }
  });

  // === ЗАКРЕПЛЕНИЕ СООБЩЕНИЙ ===

  // Закрепить сообщение
  socket.on('pin_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение и получаем chat_id
      const messageRow = db.prepare('SELECT id, chat_id, sender_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        socket.emit('pin_error', { error: 'Сообщение не найдено' });
        return;
      }

      const chatId = messageRow.chat_id;
      const now = new Date().toISOString();

      // Закрепляем сообщение
      db.run('UPDATE messages SET is_pinned = 1, pinned_by = ?, pinned_at = ? WHERE id = ?',
        [onlineUser.id, now, messageId]);
      // Получаем полные данные сообщения для рассылки (с camelCase ключами)
      const row = db.prepare(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(messageId);
      let fullMessage = null;
      if (row) {
        const pinIsE2EE = row.e2ee === 1 || row.e2ee === true;
        fullMessage = {
          id: String(row.id || ''),
          chatId: String(row.chat_id || ''),
          senderId: String(row.sender_id || ''),
          text: pinIsE2EE ? String(row.text || '') : decryptText(String(row.text || '')),
          file_data: String(row.file_data || ''),
          timestamp: String(row.timestamp || ''),
          senderName: String(row.sender_name || row.username || ''),
          senderAvatar: String(row.sender_avatar || row.avatar || ''),
          e2ee: pinIsE2EE ? 1 : 0,
          e2ee_nonce: pinIsE2EE ? String(row.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: pinIsE2EE ? String(row.e2ee_ephemeral || '') : undefined
        };
      }

      if (!fullMessage) {
        console.error('Не удалось получить данные сообщения для закрепления:', messageId);
        socket.emit('pin_error', { error: 'Не удалось закрепить сообщение' });
        return;
      }

      // Уведомляем всех участников чата
      io.to(chatId).emit('message_pinned', {
        chatId,
        messageId,
        message: fullMessage,
        pinnedBy: onlineUser.id,
        pinnedByName: onlineUser.username,
        pinnedAt: now
      });

    } catch (err) {
      console.error('Ошибка при закреплении сообщения:', err);
      socket.emit('pin_error', { error: 'Ошибка при закреплении сообщения' });
    }
  });

  // Открепить сообщение
  socket.on('unpin_message', (data) => {
    const { messageId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !messageId) {
      return;
    }

    try {
      // Проверяем, существует ли сообщение
      const messageRow = db.prepare('SELECT id, chat_id FROM messages WHERE id = ?').get(messageId);
      if (!messageRow) {
        socket.emit('unpin_error', { error: 'Сообщение не найдено' });
        return;
      }

      const chatId = messageRow.chat_id;

      // Открепляем сообщение
      db.run('UPDATE messages SET is_pinned = 0, pinned_by = NULL, pinned_at = NULL WHERE id = ?',
        [messageId]);
      // Уведомляем всех участников чата
      io.to(chatId).emit('message_unpinned', {
        chatId,
        messageId,
        unpinnedBy: onlineUser.id,
        unpinnedByName: onlineUser.username
      });

    } catch (err) {
      console.error('Ошибка при откреплении сообщения:', err);
      socket.emit('unpin_error', { error: 'Ошибка при откреплении сообщения' });
    }
  });

  // Получение закреплённых сообщений для чата
  socket.on('get_pinned_messages', (data) => {
    const { chatId } = data;
    const onlineUser = onlineUsers.get(socket.id);

    if (!onlineUser || !chatId) {
      return;
    }

    try {
      const resultRows = db.prepare(`
        SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chat_id = ? AND m.is_pinned = 1
        ORDER BY m.pinned_at DESC
        LIMIT 50
      `).all(chatId);

      const pinnedMessages = resultRows.map(obj => {
        const pinListIsE2EE = obj.e2ee === 1 || obj.e2ee === true;
        return {
          id: String(obj.id || ''),
          chatId: String(obj.chat_id || ''),
          senderId: String(obj.sender_id || ''),
          text: pinListIsE2EE ? String(obj.text || '') : decryptText(String(obj.text || '')),
          file_data: String(obj.file_data || ''),
          timestamp: String(obj.timestamp || ''),
          senderName: String(obj.sender_name || obj.username || ''),
          senderAvatar: String(obj.sender_avatar || obj.avatar || ''),
          e2ee: pinListIsE2EE ? 1 : 0,
          e2ee_nonce: pinListIsE2EE ? (obj.e2ee_nonce || '') : undefined,
          e2ee_ephemeral: pinListIsE2EE ? (obj.e2ee_ephemeral || '') : undefined
        };
      });

      socket.emit('pinned_messages_list', {
        chatId,
        messages: pinnedMessages
      });
    } catch (err) {
      console.error('Ошибка при получении закреплённых сообщений:', err);
    }
  });
});

// ============================================
// Напоминания о задачах (по расписанию, при создании задачи)
};
