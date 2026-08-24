#!/usr/bin/env node
/**
 * Smoke-тест ключевых эндпоинтов перед сборкой релиза.
 *
 * Поднимает ИЗОЛИРОВАННЫЙ сервер (временная БД + случайный порт),
 * создаёт тестового администратора, проверяет GET-эндпоинты (фаза B)
 * и write-сценарии: регистрация → логин → профиль → сообщение → файл (фаза C).
 *
 * Запуск:  node backend/smoke-test.js   (или npm run smoke из корня)
 * Код выхода: 0 — всё прошло, 1 — есть падения.
 */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_FILE = path.join(__dirname, 'server.js');
const READY_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

// ─── Утилиты ───

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (e) { /* игнорируем */ }
  } else {
    try { child.kill('SIGKILL'); } catch (e) {}
  }
}

function httpGet(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: encodeURI(urlPath), timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { json = null; }
          resolve({ status: res.statusCode, body: raw.slice(0, 400), json });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout', json: null }); });
    req.on('error', (e) => resolve({ status: 0, body: e.message, json: null }));
  });
}

function httpRequest(port, method, urlPath, body, headers) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: encodeURI(urlPath),
        method,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          'X-CSRF-Token': 'smoke-test-csrf',
          ...(headers || {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { json = null; }
          resolve({ status: res.statusCode, body: raw.slice(0, 400), json });
        });
      }
    );
    if (payload !== null) req.write(payload);
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout', json: null }); });
    req.on('error', (e) => resolve({ status: 0, body: e.message, json: null }));
    req.end();
  });
}

const httpPost = (port, urlPath, body) => httpRequest(port, 'POST', urlPath, body);
const httpPut = (port, urlPath, body) => httpRequest(port, 'PUT', urlPath, body);

// Multipart-загрузка без внешних зависимостей
function httpUpload(port, urlPath, filename, content, mimetype) {
  return new Promise((resolve) => {
    const boundary = '----smoketest' + Date.now();
    const part = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([part, Buffer.from(content, 'utf8'), tail]);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: encodeURI(urlPath),
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          'X-CSRF-Token': 'smoke-test-csrf'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { json = null; }
          resolve({ status: res.statusCode, body: raw.slice(0, 400), json });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout', json: null }); });
    req.on('error', (e) => resolve({ status: 0, body: e.message, json: null }));
    req.write(body);
    req.end();
  });
}

function spawnServer(port, dbPath, uploadsDir) {
  const child = spawn(process.execPath, [SERVER_FILE], {
    cwd: __dirname,
    env: {
      ...process.env,
      CHAT_APP_PORT: String(port),
      CHAT_APP_HOST: '127.0.0.1',
      CHAT_APP_DB_PATH: dbPath,
      CHAT_APP_UPLOADS_PATH: uploadsDir,
      NODE_ENV: 'production'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logTail = [];
  const onLog = (chunk) => {
    logTail.push(String(chunk));
    if (logTail.length > 40) logTail.shift();
  };
  child.stdout.on('data', onLog);
  child.stderr.on('data', onLog);
  child.logTail = () => logTail.join('');
  return child;
}

async function waitForServer(child, port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Сервер завершился до готовности.\nЛог:\n' + child.logTail());
    }
    const res = await httpGet(port, '/api/version');
    if (res.status === 200) return;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Сервер не поднялся за ' + READY_TIMEOUT_MS / 1000 + 'с.\nЛог:\n' + child.logTail());
}

// ─── Проверки ───
// expectStatus: точный код ИЛИ '<500' (не падение сервера; 4xx авторизации допускаются)

async function runChecks(port, adminId) {
  const results = [];
  const check = async (name, urlPath, expectStatus) => {
    const res = await httpGet(port, urlPath);
    let pass;
    let extra = '';
    if (expectStatus === '<500') {
      pass = res.status > 0 && res.status < 500;
    } else {
      pass = res.status === expectStatus;
    }

    // Спец-проверка главного виновника: список пользователей реально приходит
    if (pass && urlPath.startsWith('/api/admin/users')) {
      if (!res.json || !Array.isArray(res.json.users)) {
        pass = false;
        extra = ' в ответе нет массива users';
      } else if (!res.json.serverVersion) {
        pass = false;
        extra = ' нет serverVersion';
      }
    }

    results.push({
      name,
      status: res.status,
      pass,
      detail: (pass ? '' : ' ← ' + String(res.body).slice(0, 160)) + extra
    });
  };

  await check('GET  /api/version', '/api/version', 200);
  await check('GET  /api/check-update', '/api/check-update', '<500');

  // Админские (выполняют тело обработчика под валидным админом)
  await check('GET  /api/admin/users', `/api/admin/users?userId=${adminId}`, 200);
  await check('GET  /api/admin/stats', `/api/admin/stats?userId=${adminId}`, '<500');

  // Поиск (сообщения + единый поиск файлов) и орфография
  await check('GET  /api/search/messages', '/api/search/messages?userId=' + adminId + '&query=test', '<500');
  await check('GET  /api/search/files', '/api/search/files?userId=' + adminId + '&query=test', '<500');
  await check('GET  /api/spellcheck', '/api/spellcheck?text=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82&lang=ru,en', '<500');

  return results;
}

// ─── Write-сценарии (фаза C): регистрация → логин → профиль → сообщение → файл ───

async function runWriteChecks(port, adminId) {
  const results = [];
  const record = (name, pass, res, extra) => {
    results.push({
      name,
      status: res ? res.status : 0,
      pass,
      detail: pass ? '' : ` ← ${extra || String(res && res.body).slice(0, 160)}`
    });
  };

  // 1. Регистрация нового пользователя
  const reg = await httpPost(port, '/api/register', {
    username: 'smoke-user',
    email: 'smoke-user@test.local',
    password: 'Passw0rd!',
    confirmPassword: 'Passw0rd!',
    birthDate: '1990-01-01'
  });
  const newUserId = reg.json && reg.json.user && reg.json.user.id;
  record('POST /api/register', reg.status === 200 && !!newUserId, reg);

  // Повторная регистрация того же email должна дать 400
  const dupReg = await httpPost(port, '/api/register', {
    username: 'smoke-user',
    email: 'smoke-user@test.local',
    password: 'Passw0rd!',
    confirmPassword: 'Passw0rd!',
    birthDate: '1990-01-01'
  });
  record('POST /api/register (дубль → 400)', dupReg.status === 400, dupReg);

  // 2. Логин
  const login = await httpPost(port, '/api/login', { email: 'smoke-user@test.local', password: 'Passw0rd!' });
  record('POST /api/login', login.status === 200 && login.json && login.json.success === true, login);

  // Неверный пароль → 401
  const badLogin = await httpPost(port, '/api/login', { email: 'smoke-user@test.local', password: 'wrong' });
  record('POST /api/login (неверный пароль → 401)', badLogin.status === 401, badLogin);

  // 3. Обновление профиля
  const upd = await httpPut(port, '/api/profile', {
    userId: newUserId,
    fullName: 'Смоук Тестовый',
    about: 'создан smoke-тестом'
  });
  record('PUT  /api/profile', upd.status === 200 && upd.json && upd.json.user && upd.json.user.full_name === 'Смоук Тестовый', upd);

  // 4. Отправка сообщения в общий чат от админа
  const sentText = 'smoke-message-' + Date.now();
  const send = await httpPost(port, '/api/messages', { chatId: 'general', senderId: adminId, text: sentText });
  const messageId = send.json && send.json.message && send.json.message.id;
  record('POST /api/messages', send.status === 200 && !!messageId, send);

  // 5. История чата содержит отправленное сообщение
  const history = await httpGet(port, `/api/messages/general?userId=${encodeURIComponent(adminId)}`);
  const foundInHistory = !!(history.json && Array.isArray(history.json.messages) &&
    history.json.messages.some((m) => m.id === messageId));
  record('GET  /api/messages/:chatId (есть новое)', history.status === 200 && foundInHistory, history);

  // 6. Загрузка файла + доступность по URL
  const up = await httpUpload(port, '/upload', 'smoke-test.txt', 'привет от smoke-теста', 'text/plain');
  const uploadedFile = up.json && up.json.url ? up.json.url.split('/uploads/')[1] : null;
  record('POST /upload', up.status === 200 && !!uploadedFile, up);

  if (uploadedFile) {
    const dl = await httpGet(port, `/uploads/${uploadedFile}`);
    record('GET  /uploads/:file', dl.status === 200, dl);
  }

  // 7. Запрещённый MIME-тип → 415
  const badUp = await httpUpload(port, '/upload', 'smoke-test.exe', 'MZ...', 'application/x-msdownload');
  record('POST /upload (exe → 415)', badUp.status === 415, badUp);

  return results;
}

// ─── Основной сценарий ───

(async () => {
  console.log(' Smoke-тест ChatApp '.padStart(40, '=').padEnd(78, '='));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-smoke-'));
  const dbPath = path.join(tmpDir, 'smoke.db');
  const uploadsDir = path.join(tmpDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const ADMIN_ID = 'smoke-admin';
  let failures = 0;
  let child = null;

  try {
    // ── Фаза A: первый запуск — сервер создаёт схему БД ──
    let port = await findFreePort();
    console.log(`[1/5] Фаза A: старт сервера (порт ${port}, временная БД)...`);
    child = spawnServer(port, dbPath, uploadsDir);
    await waitForServer(child, port);
    killTree(child);
    await new Promise(r => setTimeout(r, 800)); // даём процессу завершиться

    // ── Сидинг: тестовый администратор ──
    console.log('[2/5] Сидинг администратора во временную БД...');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, email, status, is_admin)
                VALUES (?, ?, ?, 'online', 1)`).run(ADMIN_ID, 'smoke-admin', 'smoke@test.local');
    db.close();

    // ── Фаза B: проверки под администратором ──
    port = await findFreePort();
    console.log(`[3/5] Фаза B: рестарт и проверка эндпоинтов (порт ${port})...`);
    child = spawnServer(port, dbPath, uploadsDir);
    await waitForServer(child, port);

    const results = await runChecks(port, ADMIN_ID);

    // ── Фаза C: write-сценарии ──
    console.log('[4/5] Фаза C: write-сценарии (регистрация/логин/сообщения/файлы)...');
    const writeResults = await runWriteChecks(port, ADMIN_ID);
    results.push(...writeResults);

    // ── Отчёт ──
    console.log('[5/5] Результаты:');
    console.log('');
    for (const r of results) {
      const mark = r.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`${mark}  [${r.status || '—'}] ${r.name}${r.detail}`);
      if (!r.pass) failures++;
    }
    console.log('');
    console.log(failures === 0
      ? '✅ Все проверки пройдены'
      : `❌ Провалено проверок: ${failures}`);
  } catch (err) {
    console.error('❌ Ошибка smoke-теста:', err.message);
    failures++;
  } finally {
    killTree(child);
    setTimeout(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
      process.exit(failures === 0 ? 0 : 1);
    }, 500);
  }
})();
