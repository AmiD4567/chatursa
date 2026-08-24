/**
 * Wiki: категории, статьи, файлы. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const path = require('path');
const fs = require('fs');

module.exports = function register(app, deps) {
  const { db, upload, UPLOADS_PATH, uuidv4, admin, checkAdmin, checkWikiEditAccess, checkArticleAccess, checkCategoryEditor } = deps;

app.get('/api/wiki/search', (req, res) => {
  const { q, limit = 5, userId } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ success: true, results: [] });
  }
  try {
    let sql = `
      SELECT id, title, content, category_id, access_level, created_by,
             (SELECT name FROM wiki_categories WHERE id = wiki_articles.category_id) as category_name
      FROM wiki_articles
      WHERE (title LIKE ? OR content LIKE ?)`;
    const params = [`%${q}%`, `%${q}%`];

    if (userId) {
      const isAdmin = checkAdmin(userId);
      if (!isAdmin) {
        sql += ` AND (
          access_level IS NULL OR
          access_level = 'public' OR
          created_by = ? OR
          (access_level = 'selected' AND id IN (
            SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
          ))
        )`;
        params.push(userId, userId);
      }
    }

    sql += ' ORDER BY views DESC LIMIT ?';
    params.push(parseInt(limit) || 5);

    const results = db.prepare(sql).all(...params);
    res.json({ success: true, results });
  } catch (err) {
    console.error('Ошибка поиска wiki:', err);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Поиск файлов
app.get('/api/search/files', (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ success: true, results: [] });
  }
  try {
    const results = db.prepare(`
      SELECT m.id, m.chat_id, m.file_data, m.timestamp, m.sender_id, u.username as sender_name,
             c.name as chat_name, c.type as chat_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN chats c ON m.chat_id = c.id
      WHERE m.file_data IS NOT NULL AND (m.file_data LIKE ? OR m.text LIKE ?)
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, parseInt(limit) || 20);

    const files = results.map(row => {
      try {
        const parsed = JSON.parse(row.file_data);
        return { ...row, file_info: parsed, file_data: undefined };
      } catch {
        return { ...row, file_info: null, file_data: undefined };
      }
    });

    res.json({ success: true, results: files });
  } catch (err) {
    console.error('Ошибка поиска файлов:', err);
    res.status(500).json({ error: 'Ошибка поиска файлов' });
  }
});

// Получение wiki-статьи (для бота)
app.get('/api/wiki/article/:id', (req, res) => {
  try {
    const { id } = req.params;
    const article = db.prepare('SELECT * FROM wiki_articles WHERE id = ?').get(id);
    if (!article) {
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    res.json({ success: true, article });
  } catch (err) {
    console.error('Ошибка получения статьи:', err);
    res.status(500).json({ error: 'Ошибка получения статьи' });
  }
});

// ============================================
// Wiki API
// ============================================

// Categories

app.get('/api/wiki/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM wiki_categories ORDER BY sort_order ASC, name ASC').all();
    const allEditors = db.prepare('SELECT * FROM wiki_category_editors').all();
    const editorsByCat = {};
    for (const e of allEditors) {
      if (!editorsByCat[e.category_id]) editorsByCat[e.category_id] = [];
      editorsByCat[e.category_id].push(e.user_id);
    }
    for (const cat of rows) {
      cat.editors = editorsByCat[cat.id] || [];
    }
    res.json({ success: true, categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/categories', (req, res) => {
  const { name, description, parentId, userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && (!parentId || !checkCategoryEditor(userId, parentId))) {
    return res.status(403).json({ error: 'Недостаточно прав для создания раздела' });
  }
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO wiki_categories (id, name, description, parent_id) VALUES (?, ?, ?, ?)')
      .run(id, name, description || '', parentId || null);
    const cat = db.prepare('SELECT * FROM wiki_categories WHERE id = ?').get(id);
    cat.editors = [];
    res.json({ success: true, category: cat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/categories/:id', (req, res) => {
  const { name, description, parentId, sortOrder, userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && !checkCategoryEditor(userId, req.params.id)) {
    return res.status(403).json({ error: 'Недостаточно прав для редактирования раздела' });
  }
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    db.prepare('UPDATE wiki_categories SET name = ?, description = ?, parent_id = ?, sort_order = ? WHERE id = ?')
      .run(name, description || '', parentId || null, sortOrder || 0, req.params.id);
    if (checkAdmin(userId) && req.body.editorIds) {
      const { editorIds } = req.body;
      db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(req.params.id);
      const insert = db.prepare('INSERT OR IGNORE INTO wiki_category_editors (category_id, user_id) VALUES (?, ?)');
      for (const editorId of (editorIds || [])) {
        insert.run(req.params.id, String(editorId));
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка PUT категории:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/categories/:id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  if (!checkAdmin(userId) && !checkCategoryEditor(userId, req.params.id)) {
    return res.status(403).json({ error: 'Недостаточно прав для удаления раздела' });
  }
  try {
    const deleteRecursive = (catId) => {
      const children = db.prepare('SELECT id FROM wiki_categories WHERE parent_id = ?').all(catId);
      for (const child of children) {
        deleteRecursive(child.id);
      }
      const files = db.prepare('SELECT f.file_path FROM wiki_article_files f JOIN wiki_articles a ON f.article_id = a.id WHERE a.category_id = ?').all(catId);
      for (const f of files) {
        const fullPath = path.join(UPLOADS_PATH, f.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      db.prepare('DELETE FROM wiki_article_files WHERE article_id IN (SELECT id FROM wiki_articles WHERE category_id = ?)').run(catId);
      db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id IN (SELECT id FROM wiki_articles WHERE category_id = ?)').run(catId);
      db.prepare('DELETE FROM wiki_articles WHERE category_id = ?').run(catId);
      db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(catId);
      db.prepare('DELETE FROM wiki_categories WHERE id = ?').run(catId);
    };
    deleteRecursive(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki/categories/:id/editors', (req, res) => {
  try {
    const editors = db.prepare('SELECT user_id FROM wiki_category_editors WHERE category_id = ?').all(String(req.params.id));
    res.json({ success: true, editorIds: editors.map(e => e.user_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/categories/:id/editors', (req, res) => {
  const { userId, editorIds } = req.body;
  if (!userId || !checkAdmin(userId)) return res.status(403).json({ error: 'Только для администраторов' });
  try {
    db.prepare('DELETE FROM wiki_category_editors WHERE category_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT OR IGNORE INTO wiki_category_editors (category_id, user_id) VALUES (?, ?)');
    for (const editorId of (editorIds || [])) {
      insert.run(req.params.id, editorId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Articles

app.get('/api/wiki/articles', (req, res) => {
  const { categoryId, userId } = req.query;
  try {
    let sql = `SELECT a.*, u1.username as creatorName, u2.username as updaterName
               FROM wiki_articles a
               LEFT JOIN users u1 ON a.created_by = u1.id
               LEFT JOIN users u2 ON a.updated_by = u2.id`;
    const params = [];
    const conditions = [];

    if (categoryId) {
      conditions.push('a.category_id = ?');
      params.push(categoryId);
    }

    // Filter by access level if userId is provided
    if (userId) {
      const isAdmin = checkAdmin(userId);
      if (!isAdmin) {
        conditions.push(`(
          a.access_level = 'public' OR
          a.access_level IS NULL OR
          a.created_by = ? OR
          (a.access_level = 'selected' AND a.id IN (
            SELECT article_id FROM wiki_article_allowed_users WHERE user_id = ?
          ))
        )`);
        params.push(userId, userId);
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY a.updated_at DESC';
    const rows = db.prepare(sql).all(...params);

    // Add allowedUsers for admin
    if (userId && checkAdmin(userId)) {
      for (const row of rows) {
        const allowedUsers = db.prepare('SELECT user_id FROM wiki_article_allowed_users WHERE article_id = ?').all(row.id);
        row.allowedUsers = allowedUsers.map(u => u.user_id);
      }
    }

    res.json({ success: true, articles: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki/articles/:id', (req, res) => {
  try {
    const row = db.prepare(`SELECT a.*, u1.username as creatorName, u2.username as updaterName
      FROM wiki_articles a
      LEFT JOIN users u1 ON a.created_by = u1.id
      LEFT JOIN users u2 ON a.updated_by = u2.id
      WHERE a.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Статья не найдена' });

    const userId = req.query.userId;
    if (!checkArticleAccess(userId, row)) {
      return res.status(403).json({ error: 'Нет доступа к статье' });
    }

    const files = db.prepare('SELECT * FROM wiki_article_files WHERE article_id = ? ORDER BY created_at').all(req.params.id);

    if (userId && checkAdmin(userId)) {
      const allowedUsers = db.prepare('SELECT user_id FROM wiki_article_allowed_users WHERE article_id = ?').all(req.params.id);
      row.allowedUsers = allowedUsers.map(u => u.user_id);
    }

    res.json({ success: true, article: { ...row, files } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/articles', (req, res) => {
  const { categoryId, title, content, userId, accessLevel, allowedUsers } = req.body;
  if (!title || !userId) return res.status(400).json({ error: 'title и userId обязательны' });
  if (!checkWikiEditAccess(userId) && !(categoryId && checkCategoryEditor(userId, categoryId)))
    return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    let finalAccessLevel = 'public';
    if (checkAdmin(userId) && accessLevel) {
      finalAccessLevel = accessLevel;
    }

    db.prepare('INSERT INTO wiki_articles (id, category_id, title, content, created_by, updated_by, created_at, updated_at, access_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, categoryId || null, title, content || '', userId, userId, now, now, finalAccessLevel);

    if (finalAccessLevel === 'selected' && Array.isArray(allowedUsers) && checkAdmin(userId)) {
      const insert = db.prepare('INSERT OR IGNORE INTO wiki_article_allowed_users (article_id, user_id) VALUES (?, ?)');
      for (const uid of allowedUsers) {
        insert.run(id, uid);
      }
    }

    const article = db.prepare('SELECT * FROM wiki_articles WHERE id = ?').get(id);
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/articles/:id', (req, res) => {
  const { title, content, categoryId, userId, accessLevel, allowedUsers } = req.body;
  if (!title || !userId) return res.status(400).json({ error: 'title и userId обязательны' });
  try {
    const article = db.prepare('SELECT created_by, category_id FROM wiki_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });
    if (!checkWikiEditAccess(userId) && !checkCategoryEditor(userId, categoryId || article.category_id))
      return res.status(403).json({ error: 'Доступ запрещён' });
    const isAdmin = checkAdmin(userId);
    const isEditor = checkCategoryEditor(userId, categoryId || article.category_id);
    if (!isAdmin && !isEditor && article.created_by !== userId) return res.status(403).json({ error: 'Нельзя редактировать чужие статьи' });
    const now = new Date().toISOString();

    let finalAccessLevel = undefined;
    if (isAdmin && accessLevel) {
      finalAccessLevel = accessLevel;
    }

    if (finalAccessLevel) {
      db.prepare('UPDATE wiki_articles SET title = ?, content = ?, category_id = ?, access_level = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(title, content || '', categoryId || null, finalAccessLevel, userId, now, req.params.id);
    } else {
      db.prepare('UPDATE wiki_articles SET title = ?, content = ?, category_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(title, content || '', categoryId || null, userId, now, req.params.id);
    }

    // Update allowed users if admin changed access level
    if (isAdmin && accessLevel) {
      db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id = ?').run(req.params.id);
      if (accessLevel === 'selected' && Array.isArray(allowedUsers)) {
        const insert = db.prepare('INSERT OR IGNORE INTO wiki_article_allowed_users (article_id, user_id) VALUES (?, ?)');
        for (const uid of allowedUsers) {
          insert.run(req.params.id, uid);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/articles/:id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  try {
    const article = db.prepare('SELECT created_by, category_id FROM wiki_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });

    const isAdminCheck = checkAdmin(userId);
    const isOwnerEditor = article.created_by === userId && article.category_id && checkCategoryEditor(userId, article.category_id);

    if (!isAdminCheck && !isOwnerEditor) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const files = db.prepare('SELECT file_path FROM wiki_article_files WHERE article_id = ?').all(req.params.id);
    for (const f of files) {
      const fullPath = path.join(UPLOADS_PATH, f.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    db.prepare('DELETE FROM wiki_article_files WHERE article_id = ?').run(req.params.id);
    db.prepare('DELETE FROM wiki_article_allowed_users WHERE article_id = ?').run(req.params.id);
    db.prepare('DELETE FROM wiki_articles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wiki article files
app.get('/api/wiki/articles/:id/files', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM wiki_article_files WHERE article_id = ? ORDER BY created_at').all(req.params.id);
    res.json({ success: true, files: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/articles/:id/files', upload.single('file'), (req, res) => {
  const articleId = req.params.id;
  const userId = req.body.userId;
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  if (!userId) return res.status(403).json({ error: 'Требуется авторизация' });
  try {
    const article = db.prepare('SELECT id, category_id FROM wiki_articles WHERE id = ?').get(articleId);
    if (!article) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    if (!checkWikiEditAccess(userId) && !checkCategoryEditor(userId, article.category_id))
      return res.status(403).json({ error: 'Доступ запрещён' });
    // multer может испорпить UTF-8 имена — пробуем восстановить
    let fileName = req.file.originalname;
    try {
      // escape() кодирует Latin-1 байты как %XX, decodeURIComponent декодирует их как UTF-8
      // Если строка уже корректный UTF-8 — escape выдаст %uXXXX, decodeURIComponent кинет ошибку
      fileName = decodeURIComponent(escape(fileName));
    } catch (_) {}
    const id = uuidv4();
    db.prepare('INSERT INTO wiki_article_files (id, article_id, file_name, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, articleId, fileName, req.file.filename, req.file.size, req.file.mimetype);
    const row = db.prepare('SELECT * FROM wiki_article_files WHERE id = ?').get(id);
    res.json({ success: true, file: row });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/articles/:id/files/:fileId', (req, res) => {
  const { userId } = req.body;
  if (!userId || !checkAdmin(userId)) return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const file = db.prepare('SELECT * FROM wiki_article_files WHERE id = ? AND article_id = ?').get(req.params.fileId, req.params.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });
    const fullPath = path.join(UPLOADS_PATH, file.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    db.prepare('DELETE FROM wiki_article_files WHERE id = ?').run(req.params.fileId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HR API
// ============================================
};
