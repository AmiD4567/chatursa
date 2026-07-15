const KPI_DEFINITIONS = [
  { id: 'sales_today', group_name: 'Продажи', name: 'Продажи сегодня', unit: '₽' },
  { id: 'sales_yesterday', group_name: 'Продажи', name: 'Продажи вчера', unit: '₽' },
  { id: 'sales_plan_day', group_name: 'Продажи', name: 'План на день', unit: '₽' },
  { id: 'sales_month', group_name: 'Продажи', name: 'Продажи за месяц', unit: '₽' },
  { id: 'sales_plan_month', group_name: 'Продажи', name: 'План на месяц', unit: '₽' },
  { id: 'sales_wholesale', group_name: 'Продажи', name: 'ОПТ', unit: '₽' },
  { id: 'sales_retail', group_name: 'Продажи', name: 'Розница', unit: '₽' },
  { id: 'sales_external_retail', group_name: 'Продажи', name: 'Сторонняя розница', unit: '₽' },
  { id: 'frs_cash', group_name: 'ФРС Контур', name: 'Наличные', unit: '₽' },
  { id: 'frs_card', group_name: 'ФРС Контур', name: 'Карта', unit: '₽' },
  { id: 'frs_transfer', group_name: 'ФРС Контур', name: 'Безналичный расчёт', unit: '₽' },
  { id: 'frs_other', group_name: 'ФРС Контур', name: 'Прочие', unit: '₽' },
  { id: 'opt_2025', group_name: 'Опт (PBI)', name: '2025', unit: '₽' },
  { id: 'opt_2026', group_name: 'Опт (PBI)', name: '2026', unit: '₽' },
  { id: 'opt_growth', group_name: 'Опт (PBI)', name: '26/25', unit: '%' },
  { id: 'retail_2025', group_name: 'Розница (PBI)', name: '2025', unit: '₽' },
  { id: 'retail_2026', group_name: 'Розница (PBI)', name: '2026', unit: '₽' },
  { id: 'retail_growth', group_name: 'Розница (PBI)', name: '26/25', unit: '%' },
  { id: 'cheque_count_2025', group_name: 'Чеки (PBI)', name: '2025', unit: 'шт' },
  { id: 'cheque_count_2026', group_name: 'Чеки (PBI)', name: '2026', unit: 'шт' },
];

function checkAdmin(userId, db) {
  try {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
    return row ? row.is_admin === 1 : false;
  } catch (e) {
    return false;
  }
}

function registerKpiRoutes(app, db) {
  db.run(`CREATE TABLE IF NOT EXISTS kpi_definitions (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS kpi_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kpi_id TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT (date('now')),
    plan_value REAL,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (kpi_id) REFERENCES kpi_definitions(id)
  )`);

  const validIds = KPI_DEFINITIONS.map(k => k.id);
  db.prepare(`DELETE FROM kpi_definitions WHERE id NOT IN (${validIds.map(() => '?').join(',')})`).run(...validIds);
  const upsertDef = db.prepare('INSERT OR IGNORE INTO kpi_definitions (id, group_name, name, unit) VALUES (?, ?, ?, ?)');
  for (const k of KPI_DEFINITIONS) {
    upsertDef.run(k.id, k.group_name, k.name, k.unit);
  }

  app.get('/api/kpi', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    try {
      const defs = db.prepare('SELECT * FROM kpi_definitions ORDER BY id').all();
      const today = new Date().toISOString().split('T')[0];
      const vals = db.prepare('SELECT * FROM kpi_values WHERE date = ?').all(today);
      const valMap = {};
      for (const v of vals) {
        valMap[v.kpi_id] = { value: v.value, plan_value: v.plan_value, updated_at: v.updated_at };
      }
      const groups = {};
      for (const d of defs) {
        if (!groups[d.group_name]) groups[d.group_name] = [];
        groups[d.group_name].push({
          id: d.id,
          name: d.name,
          unit: d.unit,
          ...(valMap[d.id] || { value: null, plan_value: null })
        });
      }
      res.json({ groups, date: today });
    } catch (e) {
      console.error('KPI error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/kpi', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    if (!checkAdmin(userId, db)) return res.status(403).json({ error: 'Только админ' });
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries должен быть массивом' });
    const today = new Date().toISOString().split('T')[0];
    const upsert = db.prepare(`INSERT INTO kpi_values (kpi_id, value, plan_value, date, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
    const txn = db.transaction(() => {
      for (const e of entries) {
        upsert.run(e.kpi_id, e.value ?? 0, e.plan_value ?? null, today, userId);
      }
    });
    txn();
    res.json({ success: true, date: today });
  });

  app.post('/api/kpi/refresh', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    if (!checkAdmin(userId, db)) return res.status(403).json({ error: 'Только админ' });
    try {
      const kpiDb = require('./kpi-db.js');
      const data = await kpiDb.refreshKpiFromSource();
      if (data.error) return res.status(500).json({ error: data.error });
      const today = new Date().toISOString().split('T')[0];
      const upsert = db.prepare(`INSERT INTO kpi_values (kpi_id, value, plan_value, date, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
      const txn = db.transaction(() => {
        upsert.run('frs_cash', data.yesterdayCash, null, today, userId);
        upsert.run('frs_card', 0, null, today, userId);
        upsert.run('frs_transfer', data.yesterdayCard, null, today, userId);
        upsert.run('frs_other', data.yesterdayOther || 0, null, today, userId);
        upsert.run('sales_today', data.todayTotal, null, today, userId);
        upsert.run('sales_yesterday', data.yesterdayTotal, null, today, userId);
        upsert.run('sales_month', data.monthTotal, null, today, userId);
      });
      txn();

      try {
        const kpiPbi = require('./kpi-pbi.js');
        const pbiData = await kpiPbi.getKpiData();
        if (pbiData) {
          const pbiTxn = db.transaction(() => {
            upsert.run('opt_2025', pbiData.wholesale2025, null, today, userId);
            upsert.run('opt_2026', pbiData.wholesale2026, null, today, userId);
            upsert.run('opt_growth', pbiData.wholesaleGrowth, null, today, userId);
            upsert.run('retail_2025', pbiData.retail2025, null, today, userId);
            upsert.run('retail_2026', pbiData.retail2026, null, today, userId);
            upsert.run('retail_growth', pbiData.retailGrowth, null, today, userId);
            upsert.run('cheque_count_2025', pbiData.chequeCount2025, null, today, userId);
            upsert.run('cheque_count_2026', pbiData.chequeCount2026, null, today, userId);
          });
          pbiTxn();
          data.pbi = pbiData;
        }
      } catch (pbiErr) {
        console.error('PBI refresh error (non-fatal):', pbiErr.message);
        data.pbiError = pbiErr.message;
      }

      res.json({ success: true, date: today, source: data });
    } catch (e) {
      console.error('KPI refresh error:', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerKpiRoutes };
