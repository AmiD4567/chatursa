const Database = require('better-sqlite3');
const path = require('path');

const DB_PMNT = '\\\\m149\\C$\\api\\api_data_cheque_pmnts.sqlite';
const DB_NOM = '\\\\m149\\C$\\api\\nom.sqlite';
const CACHE_DB = path.join(__dirname, 'kpi-cache.db');

function dayRange(dateStr) {
  return { start: dateStr + 'T00:00:00', end: dateStr + 'T23:59:59' };
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function monthStartStr() {
  return todayStr().slice(0, 7) + '-01';
}

function initCache() {
  const db = new Database(CACHE_DB);
  db.pragma('journal_mode=WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS daily_payments (
    day TEXT NOT NULL,
    type TEXT NOT NULL,
    total REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (day, type)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_daily_payments_day ON daily_payments(day)');
  return db;
}

async function refreshCache() {
  const cacheDb = initCache();
  const lastDay = cacheDb.prepare('SELECT MAX(day) as m FROM daily_payments').get()?.m;

  let remoteDb;
  try {
    remoteDb = new Database(DB_PMNT, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('KPI-DB: cannot open remote payments DB:', e.message);
    cacheDb.close();
    return { error: 'cannot open remote payments DB: ' + e.message };
  }

  if (!lastDay) {
    // first run: batch sync all data with one grouped query
    console.log('KPI-DB: full sync from remote...');
    const rows = remoteDb.prepare(
      `SELECT substr(open_time,1,10) as day, type, SUM(value) as total
       FROM api_data_cheque_pmnts
       GROUP BY day, type ORDER BY day`
    ).all();
    const upsert = cacheDb.prepare(
      'INSERT OR REPLACE INTO daily_payments (day, type, total) VALUES (?, ?, ?)'
    );
    const tx = cacheDb.transaction(() => {
      for (const r of rows) {
        upsert.run(r.day, r.type, r.total);
      }
    });
    tx();
    console.log('KPI-DB: full sync complete,', rows.length, 'rows cached');
  } else {
    // incremental: only sync days after last cached day
    const days = remoteDb.prepare(
      `SELECT DISTINCT substr(open_time,1,10) as day
       FROM api_data_cheque_pmnts
       WHERE substr(open_time,1,10) > ?
       ORDER BY day`
    ).all(lastDay);

    if (days.length === 0) {
      cacheDb.close();
      remoteDb.close();
      return;
    }

    console.log('KPI-DB: incremental sync,', days.length, 'days since', lastDay);
    const upsert = cacheDb.prepare(
      'INSERT OR REPLACE INTO daily_payments (day, type, total) VALUES (?, ?, ?)'
    );
    const tx = cacheDb.transaction(() => {
      for (const d of days) {
        const rows = remoteDb.prepare(
          `SELECT type, SUM(value) as total FROM api_data_cheque_pmnts
           WHERE open_time >= ? AND open_time < ?
           GROUP BY type`
        ).all(d.day + 'T00:00:00', d.day + 'T23:59:59');
        for (const r of rows) {
          upsert.run(d.day, r.type, r.total);
        }
      }
    });
    tx();
    console.log('KPI-DB: incremental sync complete');
  }

  cacheDb.close();
  remoteDb.close();
}

async function queryDailyPayments(dateStr) {
  const cacheDb = initCache();
  const rows = cacheDb.prepare(
    'SELECT type, total FROM daily_payments WHERE day = ?'
  ).all(dateStr);
  cacheDb.close();
  return rows;
}

async function queryMonthlyPayments(monthStartDate, endDate) {
  const cacheDb = initCache();
  const endDay = endDate.slice(0, 10);
  const rows = cacheDb.prepare(
    `SELECT type, SUM(total) as total FROM daily_payments
     WHERE day >= ? AND day <= ?
     GROUP BY type`
  ).all(monthStartDate, endDay);
  cacheDb.close();
  return rows;
}

async function refreshKpiFromSource() {
  await refreshCache();

  const today = todayStr();
  const yesterday = yesterdayStr();

  const todayPayments = await queryDailyPayments(today);
  const yesterdayPayments = await queryDailyPayments(yesterday);
  const monthPayments = await queryMonthlyPayments(monthStartStr(), today);

  const data = {};

  data.todayTotal = 0;
  data.todayCash = 0;
  data.todayCard = 0;
  data.todayOther = 0;
  if (Array.isArray(todayPayments)) {
    todayPayments.forEach(r => {
      if (r.type === 'Cash') data.todayCash = r.total;
      else if (r.type === 'Card') data.todayCard = r.total;
      else data.todayOther = (data.todayOther || 0) + (r.total || 0);
    });
    data.todayTotal = (data.todayCash || 0) + (data.todayCard || 0) + (data.todayOther || 0);
  }

  data.yesterdayTotal = 0;
  data.yesterdayCash = 0;
  data.yesterdayCard = 0;
  data.yesterdayOther = 0;
  if (Array.isArray(yesterdayPayments)) {
    yesterdayPayments.forEach(r => {
      if (r.type === 'Cash') data.yesterdayCash = r.total;
      else if (r.type === 'Card') data.yesterdayCard = r.total;
      else data.yesterdayOther = (data.yesterdayOther || 0) + (r.total || 0);
    });
    data.yesterdayTotal = (data.yesterdayCash || 0) + (data.yesterdayCard || 0) + (data.yesterdayOther || 0);
  }

  data.monthTotal = 0;
  data.monthCash = 0;
  data.monthCard = 0;
  data.monthOther = 0;
  if (Array.isArray(monthPayments)) {
    monthPayments.forEach(r => {
      if (r.type === 'Cash') data.monthCash = r.total;
      else if (r.type === 'Card') data.monthCard = r.total;
      else data.monthOther = (data.monthOther || 0) + (r.total || 0);
    });
    data.monthTotal = (data.monthCash || 0) + (data.monthCard || 0) + (data.monthOther || 0);
  }

  return data;
}

function close() {}

module.exports = { refreshKpiFromSource, refreshCache, queryDailyPayments, queryMonthlyPayments, close };
