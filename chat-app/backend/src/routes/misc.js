/**
 * Разное: версия/обновления, пользователи, link-preview, health. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const os = require('os');
const { compareVersions } = require('../utils');

module.exports = function register(app, deps) {
  const { db, onlineUsers } = deps;

app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    res.json({ version: pkg.version || '1.0.0' });
  } catch (err) {
    res.json({ version: '1.0.0' });
  }
});

// Проверка новой версии на GitHub
app.get('/api/check-update', async (req, res) => {
  try {
    const response = await fetch('https://api.github.com/repos/AmiD4567/chatursa/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'chat-app'
      }
    });
    if (!response.ok) {
      return res.json({ hasUpdate: false, error: 'GitHub API error' });
    }
    const data = await response.json();
    const latestTag = data.tag_name || '';
    // tag_name может быть "v1.2.3" или "1.2.3"
    const latestVersion = latestTag.replace(/^v/i, '');

    // Получаем текущую версию
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const currentVersion = pkg.version || '1.0.0';

    // Сравниваем версии
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    res.json({
      hasUpdate,
      currentVersion,
      latestVersion,
      latestTag,
      releaseUrl: data.html_url || `https://github.com/AmiD4567/chatursa/releases/tag/${latestTag}`,
      publishedAt: data.published_at,
      releaseName: data.name || latestTag
    });
  } catch (err) {
    res.json({ hasUpdate: false, error: err.message });
  }
});



// ============================================
// API для администраторов
// ============================================

// Проверка статуса админа

app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, avatar FROM users').all();
    res.json({ users });
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

// ============================================
// Web Push API для push-уведомлений
// ============================================

// Получение VAPID public key

function extractOpenGraph(html, url) {
  const result = {};

  // og:title
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (titleMatch) result.title = titleMatch[1];

  // og:description
  const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) result.description = descMatch[1];

  // og:image
  const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (imageMatch) result.image = imageMatch[1];

  // og:url
  const urlMatch = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  if (urlMatch) result.ogUrl = urlMatch[1];

  // twitter:card
  const cardMatch = html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i);
  if (cardMatch) result.cardType = cardMatch[1];

  // twitter:title (fallback)
  if (!result.title) {
    const twTitle = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
    if (twTitle) result.title = twTitle[1];
  }

  // twitter:description (fallback)
  if (!result.description) {
    const twDesc = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
    if (twDesc) result.description = twDesc[1];
  }

  // twitter:image (fallback)
  if (!result.image) {
    const twImage = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (twImage) result.image = twImage[1];
  }

  // <title> tag as last fallback for title
  if (!result.title) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) result.title = titleTag[1].trim();
  }

  // Extract domain and build favicon URL
  try {
    const parsedUrl = new URL(url);
    result.domain = parsedUrl.hostname;
    result.favicon = `${parsedUrl.protocol}//${parsedUrl.hostname}/favicon.ico`;
  } catch {
    result.domain = url;
  }

  return result;
}

/**
 * Адреса этой машины: превью собственных файлов (https://192.168.210.48:3002/uploads/…)
 * должно работать, поэтому их явно разрешаем. Петлю добавляем руками — в
 * os.networkInterfaces() её нет.
 */
const OWN_ADDRESSES = new Set(['127.0.0.1', '::1']);
for (const list of Object.values(os.networkInterfaces())) {
  for (const a of list) if (a && a.address) OWN_ADDRESSES.add(a.address);
}

/** Порты самого сервера — config.js отдаёт их как PORT/HTTPS_PORT. */
const config = require('../config');
const OWN_PORTS = new Set([String(config.PORT), String(config.HTTPS_PORT)].filter(Boolean));

const MAX_PREVIEW_BYTES = 512 * 1024; // больше читать незачем: OpenGraph в начале

/**
 * Внутренний ли адрес: за него не ходим ни при каких условиях, кроме собственных.
 * 169.254.169.254 сюда попадает — это метаданные облака, самый частый адрес
 * в SSRF-атаках (кража IAM-токенов через вставленную в чат ссылку).
 * Про свои адреса функция ничего не знает: исключение живёт в assertPublicTarget.
 * Иначе петля пропускала бы любой порт, а не только 3001/3002.
 */
function isInternalAddress(ip) {
  if (!ip) return true;
  if (ip === '0.0.0.0' || ip.startsWith('0.')) return true;                 // 0.0.0.0/8
  if (/^10\./.test(ip)) return true;                                        // 10/8
  if (/^127\./.test(ip)) return true;                                       // 127/8
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;      // 100.64/10
  if (/^169\.254\./.test(ip)) return true;                                  // link-local + метаданные
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;                   // 172.16/12
  if (/^192\.168\./.test(ip)) return true;                                  // 192.168/16
  if (/^(22[4-9]|23\d)\./.test(ip)) return true;                            // 224/4 multicast
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(ip)) return true;                                    // link-local v6
  return false;
}

/**
 * Резолвит хост и решает, можно ли по нему ходить.
 * Свой адрес разрешаем только на собственном порту — тогда превью ссылок на файлы
 * живут, а http://127.0.0.1:6379/ остаётся недоступным.
 * Возвращает IP для прибития в lookup, чтобы между проверкой и подключением
 * адрес нельзя было подменить (DNS rebinding).
 */
async function assertPublicTarget(hostname, port) {
  const isLiteral = isIpv4Literal(hostname);
  const addresses = isLiteral
    ? [{ address: hostname, family: 4 }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) throw new Error('host не резолвится');

  let own = false;
  for (const { address } of addresses) {
    if (!isInternalAddress(address)) continue;                               // публичный — идём
    if (OWN_ADDRESSES.has(address) && OWN_PORTS.has(String(port))) { own = true; continue; }
    throw new Error(`внутренний адрес запрещён: ${address}`);
  }
  return { ip: addresses[0].address, own };
}

/**
 * Fetches HTML from a URL using http/https with timeout.
 * Проверка адреса живёт внутри функции, поэтому каждый прыжок редиректа
 * проходит её сам: с публичного сайта нельзя увести запрос на внутренний хост.
 */
async function fetchHtml(url, timeoutMs = 5000) {
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const { ip: pinnedIp, own } = await assertPublicTarget(parsed.hostname, port);

  // lookup с прибитым адресом: DNS повторно не резолвится, подменить нельзя.
  // Node 20+ по умолчанию просит все адреса (all:true) и ждёт массив, а не строку.
  const pinLookup = (_hostname, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    const entry = { address: pinnedIp, family: pinnedIp.includes(':') ? 6 : 4 };
    if (opts && typeof opts === 'object' && opts.all) done(null, [entry]);
    else done(null, entry.address, entry.family);
  };

  // К самому себе по HTTPS ходим с его же сертификатом: он самоподписанный, и без ca
  // превью ссылок на https://192.168.210.48:3002/uploads/... падало бы с ошибкой.
  const ownCa = own && url.startsWith('https') ? config.httpsOptions?.cert : undefined;

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const opts = { timeout: timeoutMs, lookup: pinLookup };
    if (ownCa) opts.ca = ownCa;
    const request = client.get(url, opts, (res) => {
      // Follow redirects manually up to 3 times
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectCount = 0;
        const followRedirect = (redirectUrl) => {
          redirectCount++;
          if (redirectCount > 3) return reject(new Error('Too many redirects'));
          fetchHtml(redirectUrl, timeoutMs).then(resolve).catch(reject);
        };

        // Handle relative redirects
        let location = res.headers.location;
        if (!location.startsWith('http')) {
          try {
            location = new URL(location, url).href;
          } catch {
            return reject(new Error('Invalid redirect URL'));
          }
        }
        followRedirect(location);
        return;
      }

      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      // Тело режем: без границы `html += chunk` позволял странице съесть память,
      // а OpenGraph всё равно лежит в первых килобайтах.
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (html.length >= MAX_PREVIEW_BYTES) return;
        html += chunk;
        if (html.length >= MAX_PREVIEW_BYTES) {
          res.destroy();
          resolve(html);
        }
      });
      res.on('end', () => resolve(html));
      res.on('error', err => (html.length ? resolve(html) : reject(err)));
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
    request.on('error', reject);
  });
}

// GET /api/link-preview?url=...
const linkPreviewCache = new Map();
const linkPreviewAttempts = new Map(); // ip -> { count, startTime }
const LINK_PREVIEW_CACHE_TTL = 60 * 60 * 1000; // 1 час
const LINK_PREVIEW_CACHE_MAX = 500; // макс. записей

// Фоновая очистка просроченных и лишних записей linkPreviewCache
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of linkPreviewCache) {
    if (now - cached.ts > LINK_PREVIEW_CACHE_TTL) {
      linkPreviewCache.delete(key);
    }
  }
  if (linkPreviewCache.size > LINK_PREVIEW_CACHE_MAX) {
    const toRemove = [...linkPreviewCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, linkPreviewCache.size - LINK_PREVIEW_CACHE_MAX);
    for (const [key] of toRemove) linkPreviewCache.delete(key);
  }
}, 10 * 60 * 1000);

// ── Защита от мусорных «ссылок» (вставленные стектрейсы, ключ=значение и т.п.) ──
// Хост обязан быть доменным именем с точкой и без исходников-расширений.
const VALID_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
// Хвосты имён файлов. В вставленных логах и релизных заметках они попадают в
// «ссылки» целиком: ChatApp-Setup-1.0.209.exe, latest.yml, *.blockmap.
// md — тоже сюда: это хвост из release-notes, а молдавские домены не используются.
const FILE_EXT_RE = /\.(kt|java|py|ts|tsx|jsx|cpp|h|hpp|cs|log|gradle|exe|msi|apk|dmg|pkg|deb|rpm|blockmap|yml|yaml|json|xml|txt|ini|cfg|conf|env|sh|bat|cmd|ps1|html|htm|css|js|mjs|map|zip|tar|gz|7z|rar|pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|dll|so|dylib|jar|war|class|db|sql|bak|tmp|lock|swp|md)$/i;
// Популярные gTLD. Двухбуквенные метки (ccTLD) принимаются без списка: их ~250,
// они стабильны и держать их вручную незачем. Список нужен только для длинных.
const COMMON_GTLD = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name', 'pro',
  'app', 'dev', 'io', 'co', 'ai', 'me', 'tv', 'cc', 'ws', 'fm', 'am', 'im', 'ly',
  'sh', 'st', 'to', 'so', 'gg', 'la', 'xyz', 'top', 'site', 'online', 'store',
  'shop', 'blog', 'wiki', 'news', 'live', 'cloud', 'tech', 'space', 'website',
  'host', 'press', 'world', 'today', 'agency', 'company', 'digital', 'network',
  'systems', 'studio', 'design', 'media', 'museum', 'travel', 'zone', 'club',
  'team', 'group', 'center', 'works', 'email', 'link', 'click', 'one', 'life',
  'expert', 'review', 'software', 'tools', 'services', 'support', 'academy',
  'school', 'training', 'institute', 'foundation', 'community', 'social',
  'chat', 'video', 'photo', 'pics', 'gallery', 'market', 'sale', 'deals',
  'discount', 'promo', 'gift', 'party', 'fun', 'games', 'game', 'run', 'fit',
  'health', 'care', 'clinic', 'legal', 'law', 'finance', 'money', 'bank',
  'capital', 'fund', 'invest', 'insurance', 'credit', 'cash', 'fitness', 'yoga',
  'pizza', 'cafe', 'coffee', 'bar', 'pub', 'restaurant', 'recipes', 'food',
  'kitchen', 'organic', 'farm', 'garden', 'flowers', 'house', 'home', 'estate',
  'properties', 'rentals', 'vacations', 'cruise', 'holiday', 'tours', 'art',
  'culture', 'festival', 'events', 'tickets', 'solutions', 'ventures',
  'holdings', 'limited', 'local',
]);
const NEGATIVE_CACHE_TTL = 10 * 60 * 1000; // неудачный URL не дёргаем 10 минут
const warnedHosts = new Set();             // warn один раз на уникальный хост
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Настоящий ли это IPv4-адрес (не 999.999.1.1 и т.п.) */
function isIpv4Literal(host) {
  const m = host.match(IPV4_RE);
  if (!m) return false;
  return m.slice(1).every(oct => Number(oct) <= 255);
}

/**
 * Отсекает хосты, которые не могут быть настоящим сайтом.
 * Раньше проверялась только форма имени (метки из [a-z0-9-] через точку), и сквозь
 * неё проходили хвосты имён классов из логов: java.lang.securityexception,
 * androidx.activity.result.activityresultregistry, com.chatursa...chatscreenkt,
 * 16.invoke. Настоящий TLD не проверялся вообще.
 *
 * IP-литералы пропускаются намеренно: приложение само строит ссылки на файлы как
 * https://192.168.210.48:3002/uploads/... (App.js), и блокировать их здесь нельзя.
 * Что показывать или нет решает сетевой слой (assertPublicTarget).
 */
function isGarbageHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (isIpv4Literal(host)) return false;
  if (!VALID_HOST_RE.test(host)) return true;
  if (FILE_EXT_RE.test(host)) return true;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (tld.startsWith('xn--')) return false;   // IDN в punycode: .рф, .дети, .москва
  if (tld.length === 2) return false;         // ccTLD
  return !COMMON_GTLD.has(tld);
}

app.get('/api/link-preview', async (req, res) => {
  // Частота: превью дёргают на каждую ссылку в сообщении, поэтому без счётчика
  // одно вставленное сообщение — это десяток исходящих запросов с одного адреса.
  const clientIp = deps.getClientIp ? deps.getClientIp(req) : (req.ip || 'unknown');
  if (!deps.checkRateLimit(linkPreviewAttempts, clientIp, 60, 60 * 1000)) {
    return res.status(429).json({ success: false, url: (req.query.url || '').trim() });
  }

  const rawUrl = (req.query.url || '').trim();

  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate URL format
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(url.protocol)) {
    return res.status(400).json({ error: 'Only http and https protocols allowed' });
  }

  // Email-адрес, ошибочно принятый за ссылку, после обёртки в https:// даёт userinfo
  // (https://user@example.com). Это не сайт — превью подгружать не нужно.
  if (url.username || url.password) {
    return res.json({ success: false, title: url.hostname, url: rawUrl });
  }

  // Мусорный хост — отдаём заглушку сразу: без DNS и без записи в лог
  if (isGarbageHost(url.hostname)) {
    return res.json({ success: false, title: url.hostname, url: rawUrl });
  }

  // Проверка кэша (успех — 1 час, неудача — 10 минут)
  const cacheKey = rawUrl.toLowerCase();
  if (linkPreviewCache.has(cacheKey)) {
    const cached = linkPreviewCache.get(cacheKey);
    const ttl = cached.negative ? NEGATIVE_CACHE_TTL : LINK_PREVIEW_CACHE_TTL;
    if (Date.now() - cached.ts < ttl) {
      return res.json(cached.data);
    }
    linkPreviewCache.delete(cacheKey);
  }

  try {
    const html = await fetchHtml(rawUrl, 5000);
    const preview = extractOpenGraph(html, rawUrl);

    // Normalize image URL (handle relative URLs)
    if (preview.image && !preview.image.startsWith('http')) {
      try {
        preview.image = new URL(preview.image, url).href;
      } catch { /* keep as-is */ }
    }

    const responseData = { success: true, ...preview };
    linkPreviewCache.set(cacheKey, { ts: Date.now(), data: responseData });
    res.json(responseData);
  } catch (err) {
    // Негативный кэш: та же заглушка, что вернём сейчас
    const fallbackData = { success: false, title: url.hostname || rawUrl, url: rawUrl };
    linkPreviewCache.set(cacheKey, { ts: Date.now(), negative: true, data: fallbackData });

    // Лог — один раз на уникальный хост за жизнь процесса
    if (!warnedHosts.has(url.hostname)) {
      warnedHosts.add(url.hostname);
      console.warn(`Link preview failed for ${rawUrl}:`, err.message);
    }
    res.json(fallbackData);
  }
});

// ============================================
// Health check endpoint
// ============================================

const startTime = Date.now();

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  let dbSize = 0;
  try {
    if (fs.existsSync(DB_PATH)) dbSize = fs.statSync(DB_PATH).size;
  } catch {}
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '2.0.0',
    usersOnline: onlineUsers.size,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    },
    dbSize,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// API для бота-помощника
// ============================================

// Статистика пользователя
};
