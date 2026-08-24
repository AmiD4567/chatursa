/**
 * Конфигурация сервера: .env, config.json, пути, SSL.
 * Все значения вычисляются один раз при первом require.
 */
const path = require('path');
const fs = require('fs');

// Загрузка .env файла
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}

const BACKEND_ROOT = path.join(__dirname, '..');

// Загрузка конфигурации
let config = {};
const configPath = path.join(BACKEND_ROOT, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const configFileContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configFileContent);
    console.log('Конфигурация загружена из config.json');
  } catch (err) {
    console.error('Ошибка чтения конфигурации:', err.message);
  }
} else {
  console.log('Файл config.json не найден, используем настройки по умолчанию');
}

// Используем переменные окружения от Electron или значения из config
const HOST = process.env.CHAT_APP_HOST || config.server?.host || '0.0.0.0';
const PORT = process.env.CHAT_APP_PORT || config.server?.port || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || config.server?.httpsPort || 3002;
const DATA_PATH = process.env.CHAT_APP_DATA_PATH || BACKEND_ROOT;
const DB_PATH = process.env.CHAT_APP_DB_PATH || path.join(BACKEND_ROOT, 'chat.db');
const UPLOADS_PATH = process.env.CHAT_APP_UPLOADS_PATH || config.uploads?.path || path.join(BACKEND_ROOT, 'uploads');

// Функция для получения локального IP
function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// URL сервера для доступа клиентам к файлам: по умолчанию localhost (для Electron), можно переопределить через env
// Если SERVER_URL не задан в окружении или конфиге, используем локальный IP для доступности в сети
let SERVER_URL = process.env.CHAT_APP_SERVER_URL || config.server?.url;
if (!SERVER_URL) {
  const localIP = getLocalIP();
  SERVER_URL = `http://${localIP}:${PORT}`;
}

// SSL опции — по умолчанию HTTPS выключен.
// Для включения установите HTTPS_ENABLED=true в .env
// и разместите сертификаты в ssl/server.key и ssl/server.crt (или укажите свои пути)
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(BACKEND_ROOT, '../../ssl/server.key');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(BACKEND_ROOT, '../../ssl/server.crt');
let httpsOptions = null;
let useHttps = false;
if (HTTPS_ENABLED) {
  if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
    try {
      httpsOptions = {
        key: fs.readFileSync(SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(SSL_CERT_PATH, 'utf8')
      };
      useHttps = true;
      console.log('SSL сертификаты загружены, включён HTTPS');
    } catch (err) {
      console.error('Ошибка загрузки SSL сертификатов:', err.message);
      console.log('Сервер работает по HTTP');
    }
  } else {
    console.log(`HTTPS_ENABLED=true, но сертификаты не найдены: ${SSL_KEY_PATH}, ${SSL_CERT_PATH}`);
    console.log('Сервер работает по HTTP');
  }
} else {
  console.log('Сервер работает по HTTP (для включения HTTPS установите HTTPS_ENABLED=true)');
}

module.exports = {
  config,
  HOST,
  PORT,
  HTTPS_PORT,
  DATA_PATH,
  DB_PATH,
  UPLOADS_PATH,
  BACKEND_ROOT,
  SERVER_URL,
  useHttps,
  httpsOptions,
  getLocalIP
};
