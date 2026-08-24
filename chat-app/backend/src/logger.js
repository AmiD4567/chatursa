/**
 * Асинхронный буферизированный логгер.
 * Полностью неблокирующий: ни один console.* вызов не происходит синхронно.
 * Ротация: server-runtime.log → server-runtime.1.log → ... → server-runtime.N.log
 *
 * Подключение модуля переопределяет console.log/warn/error и ставит
 * обработчики unhandledRejection / uncaughtException.
 * Для сохранения состояния перед падением используйте registerFatalSaveHook(fn).
 */
const path = require('path');
const fs = require('fs');

const BACKEND_ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(BACKEND_ROOT, 'server-runtime.log');
const LOG_FLUSH_INTERVAL = 3000; // flush каждые 3 сек (было 2с)
const LOG_MAX_BATCH_SIZE = 100;  // макс. строк в одном write (было 50)
const LOG_MAX_SIZE = 50 * 1024 * 1024; // ротация при 50MB
const LOG_MAX_FILES = 5;               // хранить до 5 старых логов

const logQueue = [];             // очередь сообщений
let logFlushTimer = null;        // таймер периодического сброса
let isFlushing = false;          // флаг: идёт запись в файл

let fatalSaveHook = null;        // колбэк сохранения состояния при фатальной ошибке

function registerFatalSaveHook(fn) {
  fatalSaveHook = fn;
}

/**
 * enqueue — добавить сообщение в очередь логирования.
 * Не блокирует event loop, запись происходит асинхронно.
 */
function logEnqueue(level, ...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${args.join(' ')}\n`;

  // ERROR — приоритетная очередь (в начало), но выводим асинхронно
  if (level === 'ERROR') {
    logQueue.unshift(line);
    flushLogs();
    return;
  }

  // Обычные логи — в очередь
  logQueue.push(line);

  // Защита от переполнения очереди
  if (logQueue.length > 10000) {
    logQueue.splice(0, 5000);
  }

  // Если таймер ещё не запущен — запускаем debounce
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(() => {
      flushLogs();
    }, LOG_FLUSH_INTERVAL);
  }
}

/**
 * rotateLogFile — ротация лог-файла при превышении LOG_MAX_SIZE.
 * server-runtime.log → server-runtime.1.log → ... → server-runtime.N.log
 */
function rotateLogFile() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_SIZE) return;
    // Удаляем самый старый файл
    const oldest = path.join(BACKEND_ROOT, `server-runtime.${LOG_MAX_FILES}.log`);
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    // Сдвигаем: N → N+1, ... , 1 → 2
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const oldName = path.join(BACKEND_ROOT, `server-runtime.${i}.log`);
      const newName = path.join(BACKEND_ROOT, `server-runtime.${i + 1}.log`);
      if (fs.existsSync(oldName)) fs.renameSync(oldName, newName);
    }
    // Текущий → .1
    fs.renameSync(LOG_FILE, path.join(BACKEND_ROOT, 'server-runtime.1.log'));
  } catch (err) {
    origConsoleError(`[logger] Ошибка ротации лога: ${err.message}`);
  }
}

/**
 * flushLogs — записать накопленные логи в файл И вывести в консоль.
 * Вызывается по таймеру или при переполнении буфера.
 */
async function flushLogs() {
  if (isFlushing) return;
  isFlushing = true;

  // Собираем батч из очереди
  const batch = logQueue.splice(0, LOG_MAX_BATCH_SIZE);
  if (batch.length === 0) {
    isFlushing = false;
    // Если очередь ещё есть — планируем следующий flush
    if (logQueue.length > 0) {
      logFlushTimer = setTimeout(flushLogs, 100);
    }
    return;
  }

  const data = batch.join('');

  try {
    rotateLogFile(); // проверяем размер перед записью
    await fs.promises.appendFile(LOG_FILE, data);
  } catch (err) {
    // Если файл-лог недоступен — выводим в консоль как ошибку
    origConsoleError(`[logger] Ошибка записи в лог-файл: ${err.message}`);
  }

  isFlushing = false;

  // Если остались сообщения — продолжаем flush
  if (logQueue.length > 0) {
    logFlushTimer = setTimeout(flushLogs, 100);
  } else {
    logFlushTimer = null;
  }
}

/**
 * flushLogsSync — синхронный сброс (только для graceful shutdown).
 */
function flushLogsSync() {
  if (logQueue.length === 0) return;
  try {
    const data = logQueue.join('');
    fs.appendFileSync(LOG_FILE, data);
  } catch (err) {
    process.stderr.write(`[logger] Ошибка синхронной записи в лог: ${err.message}\n`);
  }
  logQueue.length = 0;
}

// Сохраняем оригинальный console.log для sql.js (WASM конфликтует с setImmediate)
const origConsoleLog = console.log.bind(console);
const origConsoleWarn = console.warn.bind(console);
const origConsoleError = console.error.bind(console);

// Переопределяем console.log / console.warn → полностью асинхронный логгер
console.log = (...args) => {
  origConsoleLog(...args);
  logEnqueue('INFO', ...args);
};

console.warn = (...args) => {
  origConsoleWarn(...args);
  logEnqueue('WARN', ...args);
};

// console.error тоже полностью асинхронный
console.error = (...args) => {
  origConsoleError(...args);
  logEnqueue('ERROR', ...args);
};

// Глобальный обработчик unhandledRejection → асинхронный лог + graceful shutdown
process.on('unhandledRejection', (reason, promise) => {
  const reasonStr = reason?.stack || reason;
  origConsoleError('[unhandledRejection]', reasonStr);
  logEnqueue('ERROR', '[unhandledRejection]', reasonStr);
});

// Глобальный обработчик uncaughtException — синхронное исключение, процесс умирает.
// Сохраняем БД + логи, потом выходим.
process.on('uncaughtException', (err) => {
  const errStr = err?.stack || err;
  origConsoleError('[uncaughtException]', errStr);
  logEnqueue('ERROR', '[uncaughtException]', errStr);
  flushLogsSync();
  if (fatalSaveHook) {
    try {
      fatalSaveHook();
    } catch (e) {
      origConsoleError('[uncaughtException] Ошибка сохранения состояния:', e);
    }
  }
  process.exit(1);
});

// Запускаем первый flush-таймер при старте
logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL);

module.exports = { registerFatalSaveHook, flushLogsSync };
