const httpntlm = require('httpntlm');

const PBI_HOST = 'm149';
const PBI_AUTH = {
  username: 'amid',
  password: 'Pan1309Kris',
  domain: 'vladice',
  workstation: ''
};
const PBI_BASE = `http://${PBI_HOST}`;

const PBI_REPORTS = [
  { id: 'debitorskaya', name: 'Дебиторская и кредиторская задолженность', folder: 'Производство и продажи', path: '/Фабрика Мороженого/Производство и продажи/Дебиторская и кредиторская задолженность' },
  { id: 'sales-2026', name: 'Продажи и Производство 2026', folder: 'Производство и продажи', path: '/Фабрика Мороженого/Производство и продажи/Продажи и Производство 2026' },
  { id: 'sales-2025', name: 'Продажи и Производство 2025', folder: 'Производство и продажи', path: '/Фабрика Мороженого/Производство и продажи/Продажи и Производство 2025' },
  { id: 'sales-2024', name: 'Продажи и Производство 2024', folder: 'Производство и продажи', path: '/Фабрика Мороженого/Производство и продажи/Продажи и Производство 2024' },
  { id: 'ostanki', name: 'Производство (Остатки)', folder: 'Производство и продажи', path: '/Фабрика Мороженого/Производство и продажи/Производство (Остатки)' },
  { id: 'frs-2026', name: 'ФРС Контур 2026', folder: 'ФРС', path: '/Фабрика Мороженого/ФРС/ФРС Контур 2026' },
  { id: 'frs-2025', name: 'ФРС Контур 2025', folder: 'ФРС', path: '/Фабрика Мороженого/ФРС/ФРС Контур 2025' },
  { id: 'frs-2024', name: 'ФРС Контур 2024', folder: 'ФРС', path: '/Фабрика Мороженого/ФРС/ФРС Контур 2024' },
  { id: 'frs-oplaty', name: 'ФРС Контур по типам оплат', folder: 'ФРС', path: '/Фабрика Мороженого/ФРС/ФРС Контур по типам оплат' }
];

function checkAdmin(userId, db) {
  try {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
    return row ? row.is_admin === 1 : false;
  } catch (e) {
    return false;
  }
}

function proxyRequest(pbiPath, callback) {
  const url = PBI_BASE + pbiPath;
  httpntlm.get({ url, ...PBI_AUTH }, (err, res) => {
    if (err) return callback(err);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let loc = res.headers.location;
      if (loc.startsWith(PBI_BASE)) loc = loc.slice(PBI_BASE.length);
      if (loc.startsWith('/')) return proxyRequest(loc, callback);
    }
    callback(null, res);
  });
}

const PBI_PROXY_BASE = '/api/pbi-proxy/fm/';

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rewritePbiUrls(html) {
  return html
    .replace(/<base\s+href="[^"]*"\s*\/?>/gi, '<base href="' + PBI_PROXY_BASE + '">')
    .replace(new RegExp(PBI_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    .replace(/(["'\s])\/fm\//g, '$1' + PBI_PROXY_BASE)
    .replace(/(["'\s])\/ReportServer\//g, '$1' + PBI_PROXY_BASE.replace('/fm/', '/ReportServer/'))
    .replace(/action="([^"]*)"/gi, (m, a) => {
      if (a.startsWith('/')) return 'action="' + PBI_PROXY_BASE + a.slice(1) + '"';
      return m;
    });
}

function shouldRewriteContentType(contentType) {
  if (!contentType) return false;
  return contentType.includes('text/html') || contentType.includes('application/xhtml');
}

function checkReportAccess(db, userId, reportId) {
  const row = db.prepare('SELECT 1 FROM report_permissions WHERE report_id = ? AND user_id = ?').get(reportId, userId);
  return !!row;
}

let reportsCache = null;
function getReport(id) {
  if (!reportsCache) {
    reportsCache = {};
    for (const r of PBI_REPORTS) reportsCache[r.id] = r;
  }
  return reportsCache[id] || null;
}

function doProxy(pbiPath, req, res, db) {
  proxyRequest(pbiPath, (err, pbiRes) => {
    if (err) return res.status(502).json({ error: 'Ошибка соединения с PBIRS: ' + err.message });
    const contentType = pbiRes.headers['content-type'] || '';
    if (shouldRewriteContentType(contentType)) {
      let body = pbiRes.body.toString();
      body = rewritePbiUrls(body);
      res.set('Content-Type', contentType);
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      return res.send(body);
    }
    if (contentType) res.set('Content-Type', contentType);
    for (const key of ['cache-control', 'expires', 'pragma', 'set-cookie']) {
      if (pbiRes.headers[key]) res.set(key, pbiRes.headers[key]);
    }
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.status(pbiRes.statusCode);
    if (Buffer.isBuffer(pbiRes.body)) {
      res.send(pbiRes.body);
    } else {
      res.send(Buffer.from(pbiRes.body, 'binary'));
    }
  });
}

function registerPbiRoutes(app, db) {
  db.run(`CREATE TABLE IF NOT EXISTS report_permissions (
    report_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (report_id, user_id)
  )`);

  app.get('/api/pbi-reports', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    const isAdmin = checkAdmin(userId, db);
    let list = PBI_REPORTS.map(r => ({ id: r.id, name: r.name, folder: r.folder }));
    if (!isAdmin) list = list.filter(r => checkReportAccess(db, userId, r.id));
    res.json(list);
  });

  app.get('/api/pbi-reports/:id', (req, res) => {
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    const isAdmin = checkAdmin(userId, db);
    if (!isAdmin && !checkReportAccess(db, userId, report.id))
      return res.status(403).json({ error: 'Нет доступа' });
    res.json({ id: report.id, name: report.name, folder: report.folder, path: report.path });
  });

  app.get('/api/pbi-reports/:id/image', (req, res) => {
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    const userId = req.headers['x-user-id'];
    if (userId) {
      const isAdmin = checkAdmin(userId, db);
      if (!isAdmin && !checkReportAccess(db, userId, report.id))
        return res.status(403).json({ error: 'Нет доступа' });
    }
    const pbiPath = '/ReportServer?' + encodeURIComponent(report.path) + '&rs:Command=Render&rs:Format=IMAGE';
    proxyRequest(pbiPath, (err, pbiRes) => {
      if (err || pbiRes.statusCode !== 200) {
        res.set('Content-Type', 'image/svg+xml');
        return res.send('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#eee" width="400" height="300"/><text x="200" y="150" text-anchor="middle" fill="#999" font-size="16">' + escapeXml(report.name) + '</text><text x="200" y="175" text-anchor="middle" fill="#bbb" font-size="12">Нет превью</text></svg>');
      }
      res.set('Content-Type', pbiRes.headers['content-type'] || 'image/png');
      res.send(pbiRes.body);
    });
  });

  app.get('/api/pbi-reports/:id/pdf', (req, res) => {
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    const userId = req.headers['x-user-id'];
    if (userId) {
      const isAdmin = checkAdmin(userId, db);
      if (!isAdmin && !checkReportAccess(db, userId, report.id))
        return res.status(403).json({ error: 'Нет доступа' });
    }
    const pbiPath = '/ReportServer?' + encodeURIComponent(report.path) + '&rs:Command=Render&rs:Format=PDF';
    proxyRequest(pbiPath, (err, pbiRes) => {
      if (err || pbiRes.statusCode !== 200 || !pbiRes.body || pbiRes.body.length < 100) {
        return res.status(501).json({ error: 'PDF экспорт недоступен для этого отчета' });
      }
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'attachment; filename="' + escapeXml(report.name) + '.pdf"');
      res.send(pbiRes.body);
    });
  });

  app.get('/api/pbi-reports/:id/view', (req, res) => {
    try {
      const report = getReport(req.params.id);
      if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
      const userId = req.headers['x-user-id'];
      if (userId) {
        const isAdmin = checkAdmin(userId, db);
        if (!isAdmin && !checkReportAccess(db, userId, report.id))
          return res.status(403).json({ error: 'Нет доступа' });
      }
      const reportPortalPath = encodeURI('/fm/Reports/powerbi' + report.path);
      proxyRequest(reportPortalPath, (err, pbiRes) => {
        if (err) return res.status(502).json({ error: 'Ошибка соединения с PBIRS: ' + err.message });
        let body = pbiRes.body ? pbiRes.body.toString() : '';
      body = rewritePbiUrls(body);
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Content-Security-Policy');
        res.send(body);
      });
    } catch (e) {
      console.error('PBI view error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.all('/api/pbi-proxy/:path(*)', (req, res) => {
    const pbiPath = req.params.path ? encodeURI('/' + req.params.path) : '/';
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    doProxy(pbiPath + query, req, res, db);
  });

  app.all('/fm/:path(*)', (req, res) => {
    const pbiPath = '/fm/' + (req.params.path ? encodeURI(req.params.path) : '');
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    doProxy(pbiPath + query, req, res, db);
  });

  app.all('/ReportServer/:path(*)', (req, res) => {
    const pbiPath = '/ReportServer/' + (req.params.path ? encodeURI(req.params.path) : '');
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    doProxy(pbiPath + query, req, res, db);
  });

  app.get('/api/pbi-reports/:id/permissions', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId || !checkAdmin(userId, db)) return res.status(403).json({ error: 'Только админ' });
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    const rows = db.prepare('SELECT user_id FROM report_permissions WHERE report_id = ?').all(report.id);
    res.json(rows.map(r => r.user_id));
  });

  app.put('/api/pbi-reports/:id/permissions', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId || !checkAdmin(userId, db)) return res.status(403).json({ error: 'Только админ' });
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds должен быть массивом' });
    const txn = db.transaction(() => {
      db.run('DELETE FROM report_permissions WHERE report_id = ?', [report.id]);
      const insert = db.prepare('INSERT OR IGNORE INTO report_permissions (report_id, user_id) VALUES (?, ?)');
      for (const uid of userIds) insert.run(report.id, uid);
    });
    txn();
    res.json({ success: true });
  });
}

module.exports = { registerPbiRoutes, rewritePbiUrls };
