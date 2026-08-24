/**
 * Middleware-цепочка Express: редирект HTTPS, Helmet/CSP, HSTS,
 * security-заголовки, CORS, CSRF (single-header), rate-limit, statics.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cfg = require('./config');

function setupMiddleware(app) {
  // Принудительный редирект HTTP → HTTPS (код 301).
  // Отключён по умолчанию: в dual-mode HTTP-порт нужен десктопу/Android.
  // Включается только явно через HTTPS_REDIRECT=true в .env.
  app.use((req, res, next) => {
    if (process.env.HTTPS_REDIRECT === 'true' && cfg.useHttps && !req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });

  // Helmet с настройками, совместимыми с WebSocket и стикерами
  const PROTOCOL = cfg.useHttps ? 'https' : 'http';
  const WS_PROTOCOL = cfg.useHttps ? 'wss:' : 'ws:';
  const LAN_HTTP_ORIGIN = `http://${cfg.getLocalIP()}:${cfg.PORT}`;
  const CSP_ORIGINS = process.env.CHAT_APP_SERVER_URL || `${PROTOCOL}://localhost:${cfg.PORT}`;
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://ui-avatars.com', 'https://cdn.jsdelivr.net', CSP_ORIGINS, LAN_HTTP_ORIGIN],
        connectSrc: ["'self'", WS_PROTOCOL, 'wss:', 'https://api.github.com', CSP_ORIGINS, LAN_HTTP_ORIGIN, 'capacitor://localhost', `${PROTOCOL}://localhost`],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        mediaSrc: ["'self'", CSP_ORIGINS, LAN_HTTP_ORIGIN],
        workerSrc: ["'self'"],
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // HSTS (HTTP Strict Transport Security)
  app.use((req, res, next) => {
    if (cfg.useHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });

  // Дополнительные заголовки безопасности
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // CORS — разрешаем только наш фронтенд
  const ALLOWED_ORIGINS = [CSP_ORIGINS, LAN_HTTP_ORIGIN, `${PROTOCOL}://localhost:3000`, `${PROTOCOL}://localhost:3001`, 'capacitor://localhost', `${PROTOCOL}://localhost`];
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://192.168.') || origin.startsWith('https://192.168.') || origin.startsWith('capacitor://')) return cb(null, true);
      cb(null, true); // в локальной сети разрешаем все
    },
    credentials: true
  }));

  // Cookie parser (используется в др.местах, не для CSRF)
  app.use(cookieParser());

  // CSRF защита: Single-header pattern (Same Origin Policy не даёт атакующему
  // установить кастомный заголовок X-CSRF-Token на跨доменный запрос).
  // Фронтенд читает токен из JSON-ответа и добавляет его в заголовок всех мутирующих запросов.
  // Не используем cookie из-за sameSite-ограничений в Electron (file:// origin).
  app.get('/api/csrf-token', (req, res) => {
    const token = uuidv4();
    res.json({ csrfToken: token });
  });

  // Проверка CSRF для всех мутирующих запросов к API
  function csrfMiddleware(req, res, next) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const headerToken = req.headers['x-csrf-token'];
      if (!headerToken || headerToken === '') {
        console.warn(`[CSRF] Отсутствует или пустой X-CSRF-Token: ${req.method} ${req.path}, IP: ${req.ip}`);
        return res.status(403).json({ error: 'Недействительный CSRF-токен' });
      }
    }
    next();
  }

  app.use('/api/', csrfMiddleware);

  // Общий rate-limiter для всех API-эндпоинтов: 100 запросов/мин на IP
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов, попробуйте позже' }
  });
  app.use('/api/', apiLimiter);

  // Регистрируем MIME-тип для .avif (стикеры)
  express.static.mime.define({ 'image/avif': ['avif'] });
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(cfg.UPLOADS_PATH));
  app.use('/stickers', express.static(path.join(cfg.BACKEND_ROOT, '../frontend/build/stickers')));
  app.use(express.static(path.join(cfg.BACKEND_ROOT, '../frontend/build')));
}

module.exports = { setupMiddleware };
