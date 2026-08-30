/**
 * Файлы: аватары, upload, скачивание. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const path = require('path');
const fs = require('fs');

module.exports = function register(app, deps) {
  const { db, io, upload, SERVER_URL, UPLOADS_PATH, getChatWithDetails } = deps;

app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;
  
  if (!userId || !req.file) {
    return res.status(400).json({ error: 'userId и файл обязательны' });
  }
  
  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  
  try {
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);

    io.emit('user_avatar_updated', { userId: Number(userId), avatar: avatarUrl });

    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

app.post('/api/remove-avatar', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
    if (user?.avatar) {
      try {
        const filePath = path.join(UPLOADS_PATH, path.basename(new URL(user.avatar).pathname));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    db.run('UPDATE users SET avatar = NULL WHERE id = ?', [userId]);
    io.emit('user_avatar_updated', { userId, avatar: '' });
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления аватара:', err);
    res.status(500).json({ error: 'Ошибка при удалении аватара' });
  }
});

// API для загрузки аватара помощника (только для админов)
app.post('/api/upload-helper-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Проверяем, является ли пользователь администратором
  const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  const isAdmin = userRow ? userRow.is_admin === 1 : false;

  if (!isAdmin) {
    return res.status(403).json({ error: 'Только администраторы могут менять аватар помощника' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Файл аватара обязателен' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    db.run('UPDATE users SET avatar = ? WHERE username = ?', [avatarUrl, 'Помощник']);


    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара помощника:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// API для загрузки аватара общего чата (только для админов)
app.post('/api/upload-general-chat-avatar', upload.single('avatar'), (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Проверяем, является ли пользователь администратором
  const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  const isAdmin = userRow ? userRow.is_admin === 1 : false;

  if (!isAdmin) {
    return res.status(403).json({ error: 'Только администраторы могут менять аватар общего чата' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Файл аватара обязателен' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    db.run('ALTER TABLE chats ADD COLUMN avatar TEXT');
  } catch (e) {
    // Колонка уже существует
  }

  try {
    db.run('UPDATE chats SET avatar = ? WHERE id = ?', [avatarUrl, 'general']);


    res.json({
      success: true,
      avatar: avatarUrl
    });
  } catch (err) {
    console.error('Ошибка загрузки аватара общего чата:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// API для загрузки аватара группового чата (только владелец или админ)
app.post('/api/upload-group-chat-avatar', upload.single('avatar'), (req, res) => {
  const { chatId, userId } = req.body;

  if (!chatId || !userId || !req.file) {
    return res.status(400).json({ error: 'chatId, userId и файл обязательны' });
  }

  const participant = db.prepare('SELECT role FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!participant) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Вы не являетесь участником чата' });
  }
  if (participant.role !== 'creator' && participant.role !== 'admin') {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Менять аватар группы может только владелец или администратор' });
  }

  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Можно загружать только изображения' });
  }

  const avatarUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

  try {
    const current = db.prepare('SELECT avatar FROM chats WHERE id = ?').get(chatId);
    if (current && current.avatar && current.avatar.startsWith(`${SERVER_URL}/uploads/`)) {
      const oldPath = path.join(UPLOADS_PATH, path.basename(current.avatar));
      fs.unlink(oldPath, () => {});
    }
    db.run('UPDATE chats SET avatar = ? WHERE id = ?', [avatarUrl, chatId]);
    const chat = getChatWithDetails(chatId);
    io.emit('chat_avatar_updated', { chatId, avatar: avatarUrl, chat });
    res.json({ success: true, avatar: avatarUrl });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error('Ошибка загрузки аватара группы:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// Белый список MIME-типов для загрузки
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
  'application/pdf', 'application/zip', 'application/x-rar-compressed',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/json'
];

// Минимальное свободное место на диске для загрузок (500MB)
const MIN_DISK_SPACE = 500 * 1024 * 1024;

function checkDiskSpace() {
  try {
    const stats = fs.statfsSync(UPLOADS_PATH);
    return stats.bfree * stats.bsize >= MIN_DISK_SPACE;
  } catch {
    // Если не удалось проверить — пропускаем проверку
    return true;
  }
}

// API для загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  // Проверка MIME-типа
  if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    // Удаляем загруженный файл
    fs.unlink(req.file.path, () => {});
    return res.status(415).json({ error: `Недопустимый тип файла: ${req.file.mimetype}` });
  }

  // Проверка свободного места
  if (!checkDiskSpace()) {
    fs.unlink(req.file.path, () => {});
    return res.status(507).json({ error: 'Недостаточно места на диске' });
  }

  // multer может испортить UTF-8 имена — пробуем восстановить
  let fileName = req.file.originalname;
  try {
    fileName = decodeURIComponent(escape(fileName));
  } catch (_) {}

  const fileUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({
    filename: fileName,
    url: fileUrl,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// ========================================
// Скачивание файлов с оригинальным именем (UTF-8)
// ========================================

// Кэш поиска оригинальных имён файлов по UUID (макс. 1000 записей)
const filenameCache = new Map(); // uuid -> originalFilename
const FILENAME_CACHE_MAX = 1000;

function trimFilenameCache() {
  if (filenameCache.size >= FILENAME_CACHE_MAX) {
    // Удаляем половину старых записей
    const keysToDelete = [...filenameCache.keys()].slice(0, FILENAME_CACHE_MAX / 2);
    for (const key of keysToDelete) filenameCache.delete(key);
  }
}

function findOriginalFilenameByUuid(uuid) {
  if (filenameCache.has(uuid)) return filenameCache.get(uuid);
  if (typeof uuid !== 'string') return null;

  // UUID может содержать расширение файла (например: 08f464a3-...-abc.docx)
  const baseUuid = uuid.replace(/\.[^.]+$/, '');
  if (!/^[0-9a-fA-F-]+$/.test(baseUuid)) return null;

  let originalFilename = null;

  try {
    // 1) Файлы базы знаний: оригинальное имя в wiki_article_files.file_name
    const wikiFile = db.prepare(
      'SELECT file_name FROM wiki_article_files WHERE file_path = ? LIMIT 1'
    ).get(uuid);
    if (wikiFile && wikiFile.file_name) {
      originalFilename = wikiFile.file_name;
    }
  } catch (err) {
    console.error('Ошибка поиска имени файла базы знаний:', err);
  }

  if (!originalFilename) {
    try {
      // 2) Файлы из чата: имя в messages.file_data (uuid — последний сегмент URL)
      const searchPattern = `%"url":"%${uuid}"%`;
      const row = db.prepare(
        "SELECT file_data FROM messages WHERE file_data LIKE ? LIMIT 1"
      ).get(searchPattern);

      if (row) {
        try {
          const parsed = JSON.parse(row.file_data);
          if (parsed && parsed.filename) {
            originalFilename = parsed.filename;
          }
        } catch (e) { /* skip invalid JSON */ }
      }
    } catch (err) {
      console.error('Ошибка поиска оригинального имени файла:', err);
    }
  }

  if (originalFilename) {
    // Старые записи могли испортить UTF-8 — пробуем восстановить (для чистых имён no-op)
    try {
      originalFilename = decodeURIComponent(escape(originalFilename));
    } catch (_) {}
    trimFilenameCache();
    filenameCache.set(uuid, originalFilename);
    return originalFilename;
  }

  trimFilenameCache();
  filenameCache.set(uuid, null);
  return null;
}

// Скачивание файла по UUID с правильным Content-Disposition для UTF-8 имён
app.get('/api/download/:uuid', (req, res) => {
  const uuid = req.params.uuid;
  const filePath = path.join(UPLOADS_PATH, uuid);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  // Ищем оригинальное имя файла в базе данных (с кэшированием)
  const originalFilename = findOriginalFilenameByUuid(uuid);
  const displayName = originalFilename || uuid;

  // RFC 5987 / 6266 — корректная кодировка UTF-8 для Content-Disposition
  const encodedName = encodeURIComponent(displayName)
    .replace(/%27/g, "%27")   // ' → %27
    .replace(/%28/g, "%28")   // ( → %28
    .replace(/%29/g, "%29")   // ) → %29
    .replace(/%2A/g, "%2A");  // * → %2A

  // Legacy filename должен быть ASCII (Node не принимает сырой UTF-8 в заголовках):
  // настоящая кириллица передаётся через filename* (RFC 5987)
  const legacyName = uuid;

  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodedName}; filename="${legacyName}";`
  );
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

// API для получения задач календаря
};
