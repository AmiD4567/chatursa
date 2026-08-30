/**
 * Слой базы данных SQLite (better-sqlite3, WAL).
 * Схема, миграции колонок, сидинг, резервное копирование.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const cfg = require('./config');

let db = null;

// Инициализация базы данных
function initDatabase() {
  db = new Database(cfg.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Обёртка совместимости: db.run(sql, params) → db.prepare(sql).run(...params)
  db.run = function(sql, params) {
    if (params) {
      return db.prepare(sql).run(...params);
    }
    return db.prepare(sql).run();
  };

  console.log('База данных загружена (better-sqlite3, WAL mode)');
  console.log(`Путь к БД: ${cfg.DB_PATH}`);

  // Создание таблиц
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      avatar TEXT,
      full_name TEXT,
      birth_date TEXT,
      about TEXT,
      mobile_phone TEXT,
      work_phone TEXT,
      status_text TEXT,
      host TEXT,
      ip_address TEXT,
      status TEXT DEFAULT 'offline',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_birth_date ON users(birth_date);
  `);

  // Миграции для добавления колонок


  // Таблица сессий для восстановления после рестарта (legacy, per-user)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id TEXT PRIMARY KEY,
      socket_ids TEXT NOT NULL DEFAULT '[]',
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Таблица устройств/сессий (multi-device support, per-device)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_device_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      socket_ids TEXT NOT NULL DEFAULT '[]',
      login_time TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      is_current INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Таблица бронирования переговорной
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_room_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      meeting_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      organizer_id TEXT,
      organizer_name TEXT,
      reminder_minutes INTEGER DEFAULT NULL,
      reminder_time TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizer_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_room_organizer_date ON meeting_room_bookings(organizer_id, meeting_date);
  `);

  // Таблица участников бронирования переговорной
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meeting_room_booking_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        FOREIGN KEY (booking_id) REFERENCES meeting_room_bookings(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_booking_participants_booking ON meeting_room_booking_participants(booking_id);
    `);
  } catch (e) {
    console.log('Таблица участников бронирования уже существует');
  }

  // Добавляем колонки reminder, если их нет (миграция)
  try {
    db.exec(`ALTER TABLE meeting_room_bookings ADD COLUMN reminder_minutes INTEGER DEFAULT NULL`);
  } catch (e) {
    // колонка уже существует — игнорируем
  }
  try {
    db.exec(`ALTER TABLE meeting_room_bookings ADD COLUMN reminder_time TEXT DEFAULT NULL`);
  } catch (e) {
    // колонка уже существует — игнорируем
  }
  try {
    db.exec(`ALTER TABLE meeting_room_bookings ADD COLUMN reminder_sent INTEGER DEFAULT 0`);
  } catch (e) {
    // колонка уже существует — игнорируем
  }

  // Таблица общих задач
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_shares (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_task_shares_from ON task_shares(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_task_shares_to ON task_shares(to_user_id);
  `);

  // Таблица задач календаря
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      task_date TEXT NOT NULL,
      task_time TEXT,
      task_end_time TEXT,
      color TEXT DEFAULT '#667eea',
      reminder_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_user ON calendar_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_tasks_date ON calendar_tasks(task_date);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('general', 'direct', 'group')),
      name TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_e2ee_keys (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      rotated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT,
      file_data TEXT,
      reply_to TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS unread_messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS admin_user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      socket_id TEXT,
      ip_address TEXT,
      browser TEXT,
      login_time TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      event TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      ip_address TEXT,
      status TEXT DEFAULT 'info',
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS chat_user_settings (
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      force_unread INTEGER DEFAULT 0,
      cleared_at TEXT,
      PRIMARY KEY (user_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_user_settings_user ON chat_user_settings(user_id);

    CREATE TABLE IF NOT EXISTS hr_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('vacation', 'sick', 'day_off')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hr_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      approver_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('approved', 'rejected')),
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fcm_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);

    CREATE TABLE IF NOT EXISTS wiki_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_articles (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_article_files (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_article_allowed_users (
      article_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (article_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS wiki_category_editors (
      category_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (category_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(announcement_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ann_read_user ON announcement_reads(user_id);

    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      is_anonymous INTEGER DEFAULT 0,
      allows_multiple INTEGER DEFAULT 0,
      closes_at TEXT,
      hide_results_until_close INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(poll_id, user_id, option_index),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);

    CREATE TABLE IF NOT EXISTS bot_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT NOT NULL DEFAULT '1',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('wiki_search_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('file_search_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('task_creation_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('booking_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('poll_creation_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('support_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('birthday_notifications_enabled', '1');
    INSERT OR IGNORE INTO bot_settings (setting_key, setting_value) VALUES ('daily_thought_notifications_enabled', '1');

    CREATE TABLE IF NOT EXISTS sent_daily_thoughts (
      user_id TEXT NOT NULL,
      thought_index INTEGER NOT NULL,
      sent_date TEXT NOT NULL,
      PRIMARY KEY (user_id, thought_index)
    );

    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      problem TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_unread_user ON unread_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON security_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at);
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('audio', 'video')),
      initiator_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      status TEXT DEFAULT 'ringing',
      created_at TEXT,
      answered_at TEXT,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calls_initiator ON calls(initiator_id);
    CREATE INDEX IF NOT EXISTS idx_calls_peer ON calls(peer_id);
  `);

  // Миграции колонок — ПОСЛЕ создания всех таблиц
  const migrations = [
    { table: 'users', column: 'mobile_phone', type: 'TEXT' },
    { table: 'users', column: 'work_phone', type: 'TEXT' },
    { table: 'users', column: 'status_text', type: 'TEXT' },
    { table: 'users', column: 'is_admin', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'has_seen_welcome', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'can_book_meeting_room', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'can_edit_wiki', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'upload_quota', type: 'INTEGER DEFAULT 524288000' },
    { table: 'users', column: 'totp_secret', type: 'TEXT' },
    { table: 'users', column: 'totp_enabled', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'read_at', type: 'TEXT' },
    { table: 'messages', column: 'forwarded_from', type: 'TEXT' },
    { table: 'messages', column: 'reply_to', type: 'TEXT' },
    { table: 'messages', column: 'is_pinned', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'pinned_by', type: 'TEXT' },
    { table: 'messages', column: 'pinned_at', type: 'TEXT' },
    { table: 'messages', column: 'edited', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'edited_at', type: 'TEXT' },
    { table: 'users', column: 'e2ee_public_key', type: 'TEXT' },
    { table: 'messages', column: 'e2ee', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'e2ee_nonce', type: 'TEXT' },
    { table: 'messages', column: 'e2ee_ephemeral', type: 'TEXT' },
    { table: 'messages', column: 'expires_at', type: 'TEXT' },
    { table: 'chats', column: 'e2ee', type: 'INTEGER DEFAULT 0' },
    { table: 'calendar_tasks', column: 'task_time', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'task_end_time', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'reminder_time', type: 'TEXT' },
    { table: 'chats', column: 'avatar', type: 'TEXT' },
    { table: 'chats', column: 'announcement', type: 'TEXT' },
    { table: 'user_sessions', column: 'last_seen', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'messages', column: 'poll_id', type: 'TEXT' },
    { table: 'polls', column: 'is_anonymous', type: 'INTEGER DEFAULT 0' },
    { table: 'polls', column: 'allows_multiple', type: 'INTEGER DEFAULT 0' },
    { table: 'polls', column: 'closes_at', type: 'TEXT' },
    { table: 'polls', column: 'hide_results_until_close', type: 'INTEGER DEFAULT 0' },
    { table: 'announcements', column: 'priority', type: 'TEXT DEFAULT \'normal\'' },
    { table: 'user_device_sessions', column: 'device_id', type: 'TEXT' },
    { table: 'user_device_sessions', column: 'device_name', type: 'TEXT DEFAULT \'\'' },
    { table: 'user_device_sessions', column: 'ip_address', type: 'TEXT DEFAULT \'\'' },
    { table: 'user_device_sessions', column: 'socket_ids', type: 'TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'user_device_sessions', column: 'login_time', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'user_device_sessions', column: 'last_seen', type: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
    { table: 'user_device_sessions', column: 'is_current', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'button_data', type: 'TEXT' },
    { table: 'users', column: 'onboarding_completed', type: 'INTEGER DEFAULT 0' },
    { table: 'wiki_articles', column: 'views', type: 'INTEGER DEFAULT 0' },
    { table: 'wiki_articles', column: 'access_level', type: 'TEXT DEFAULT \'public\'' },
    { table: 'users', column: 'can_view_kpi', type: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'app_version', type: 'TEXT DEFAULT \'\'' },
    { table: 'chat_user_settings', column: 'deleted_at', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'source_chat_id', type: 'TEXT' },
    { table: 'calendar_tasks', column: 'source_message_id', type: 'TEXT' },
    { table: 'chat_participants', column: 'role', type: "TEXT NOT NULL DEFAULT 'member'" },
    { table: 'chats', column: 'description', type: 'TEXT' },
    { table: 'chats', column: 'restricted', type: 'INTEGER DEFAULT 0' },
    { table: 'messages', column: 'is_system', type: 'INTEGER DEFAULT 0' }
  ];

  migrations.forEach(({ table, column, type }) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Колонка уже существует
    }
  });

  // Миграция данных: назначаем роль 'creator' создателям существующих групп
  try {
    db.exec(`
      UPDATE chat_participants
      SET role = 'creator'
      WHERE EXISTS (
        SELECT 1 FROM chats c
        WHERE c.id = chat_participants.chat_id
          AND c.type = 'group'
          AND c.created_by = chat_participants.user_id
      )
    `);
    console.log('Миграция ролей групп выполнена');
  } catch (e) {
    // игнорируем
  }

  // Проверка и создание общего чата
  const generalChat = db.prepare("SELECT id FROM chats WHERE id = ?").get('general');
  if (!generalChat) {
    db.prepare("INSERT INTO chats (id, type, name, created_by) VALUES (?, 'general', 'Общий чат', 'system')").run('general');
  }

  // Создание помощника если не существует
  const botCheck = db.prepare("SELECT id FROM users WHERE username = ?").get('Помощник');
  if (!botCheck) {
    const botId = 'helper-bot-' + uuidv4().substring(0, 8);
    db.prepare("INSERT INTO users (id, username, avatar, status, is_admin) VALUES (?, ?, ?, 'online', 0)").run(botId, 'Помощник', `${cfg.SERVER_URL}/uploads/ursa.jpg`);
    console.log('Создан помощник');
  }

  // Установим админа для Root
  try {
    db.prepare("UPDATE users SET is_admin = 1 WHERE username = ?").run('Root');
  } catch (e) {
    // Пользователь ещё не создан
  }

  // Миграции данных
  try {
    db.exec("UPDATE users SET mobile_phone = NULL WHERE TRIM(mobile_phone) = '' OR mobile_phone = ' '");
    db.exec("UPDATE users SET work_phone = NULL WHERE TRIM(work_phone) = '' OR work_phone = ' '");
    console.log('Миграция телефонов выполнена');
  } catch (e) { /* игнорируем */ }

  try {
    db.exec("UPDATE chats SET name = 'Помощник' WHERE name = '🤖 Помощник'");
    console.log('Миграция имени помощника выполнена');
  } catch (e) { /* игнорируем */ }

  // Миграция: добавляем socket_ids если колонка отсутствует (обратная совместимость)
  try {
    db.exec('ALTER TABLE user_sessions ADD COLUMN socket_ids TEXT NOT NULL DEFAULT \'[]\'');
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция: переписываем старые http:// URL файлов и аватаров на текущий HTTPS-адрес.
  // Приложение работает по HTTPS, поэтому http:// ссылки блокируются браузером (mixed content).
  const migrateHttpUrl = (value) => {
    if (typeof value !== 'string' || !value.startsWith('http://')) return value;
    try {
      const u = new URL(value);
      return cfg.SERVER_URL + u.pathname + u.search;
    } catch (e) {
      return value;
    }
  };

  try {
    const fileRows = db.prepare("SELECT id, file_data FROM messages WHERE file_data LIKE '%http://%'").all();
    let filesFixed = 0;
    const fixFileStmt = db.prepare('UPDATE messages SET file_data = ? WHERE id = ?');
    for (const row of fileRows) {
      let parsed;
      try {
        parsed = JSON.parse(row.file_data);
      } catch (e) {
        continue;
      }
      let changed = false;
      for (const key of Object.keys(parsed)) {
        if ((key === 'url' || key === 'path') && typeof parsed[key] === 'string') {
          const fixed = migrateHttpUrl(parsed[key]);
          if (fixed !== parsed[key]) {
            parsed[key] = fixed;
            changed = true;
          }
        }
      }
      if (changed) {
        fixFileStmt.run(JSON.stringify(parsed), row.id);
        filesFixed++;
      }
    }

    const avatarRows = db.prepare("SELECT id, avatar FROM users WHERE avatar LIKE 'http://%'").all();
    let avatarsFixed = 0;
    const fixAvatarStmt = db.prepare('UPDATE users SET avatar = ? WHERE id = ?');
    for (const row of avatarRows) {
      const fixed = migrateHttpUrl(row.avatar);
      if (fixed !== row.avatar) {
        fixAvatarStmt.run(fixed, row.id);
        avatarsFixed++;
      }
    }

    console.log(`Миграция http→https URL: сообщений=${filesFixed}, аватаров=${avatarsFixed}`);
  } catch (e) {
    console.error('Ошибка миграции http→https URL:', e.message);
  }

  console.log('База данных инициализирована');
}

function saveDatabaseSync() {
  // better-sqlite3 синхронизирует данные через WAL, но для гарантии вызываем checkpoint
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // игнорируем
    }
  }
}

// ============================================
// Автоматическое резервное копирование БД
// ============================================

const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL || '60', 10) * 60 * 1000; // мс
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(cfg.BACKEND_ROOT, 'backups');
const BACKUP_RETENTION = parseInt(process.env.BACKUP_RETENTION || '24', 10);

function performBackup() {
  if (!db || !BACKUP_ENABLED) return;

  try {
    // Создаём папку если нет
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // Делаем checkpoint WAL перед копированием
    db.pragma('wal_checkpoint(PASSIVE)');

    // Формируем имя файла: chat-backup-YYYY-MM-DD-HHmmss.db
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const backupFile = path.join(BACKUP_DIR, `chat-backup-${ts}.db`);

    // Копируем файл БД
    fs.copyFileSync(cfg.DB_PATH, backupFile);

    // Копируем WAL и SHM если существуют
    const walPath = cfg.DB_PATH + '-wal';
    const shmPath = cfg.DB_PATH + '-shm';
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, backupFile + '-wal');
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, backupFile + '-shm');
    }

    console.log(`✅ Резервная копия: ${backupFile} (${(fs.statSync(backupFile).size / 1024 / 1024).toFixed(2)} MB)`);

    // Ротация: удаляем старые бэкапы, оставляя только BACKUP_RETENTION последних
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('chat-backup-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (files.length > BACKUP_RETENTION) {
      const toDelete = files.slice(BACKUP_RETENTION);
      for (const file of toDelete) {
        const basePath = path.join(BACKUP_DIR, file.name);
        fs.unlinkSync(basePath);
        // Удаляем сопутствующие WAL/SHM
        try { fs.unlinkSync(basePath + '-wal'); } catch {}
        try { fs.unlinkSync(basePath + '-shm'); } catch {}
        console.log(`🗑️ Удалён старый бэкап: ${file.name}`);
      }
    }
  } catch (err) {
    console.error('❌ Ошибка резервного копирования:', err.message);
  }
}

function startBackupScheduler() {
  if (!BACKUP_ENABLED) {
    console.log('⏭️ Резервное копирование отключено (BACKUP_ENABLED=false)');
    return;
  }

  // Выполняем первый бэкап через 30 секунд после старта сервера
  setTimeout(() => {
    performBackup();
    // Затем по расписанию
    setInterval(performBackup, BACKUP_INTERVAL);
    console.log(`💾 Авто-бэкап запущен: каждые ${BACKUP_INTERVAL / 60000} мин, хранить ${BACKUP_RETENTION} копий`);
  }, 30000);
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb, saveDatabaseSync, startBackupScheduler };
