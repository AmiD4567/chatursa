/**
 * Разное: версия/обновления, пользователи, link-preview, health. Извлечено из server.js без изменений логики.
 * Регистрация выполняется после initDatabase() — зависимости передаются через deps.
 */
const path = require('path');
const fs = require('fs');
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
 * Fetches HTML from a URL using http/https with timeout.
 */
function fetchHtml(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: timeoutMs }, (res) => {
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

      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => resolve(html));
      res.on('error', reject);
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

app.get('/api/link-preview', async (req, res) => {
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

  // Проверка кэша
  const cacheKey = rawUrl.toLowerCase();
  if (linkPreviewCache.has(cacheKey)) {
    const cached = linkPreviewCache.get(cacheKey);
    if (Date.now() - cached.ts < LINK_PREVIEW_CACHE_TTL) {
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
    console.warn(`Link preview failed for ${rawUrl}:`, err.message);
    // Return minimal preview from the URL itself
    let domain = '';
    try { domain = new URL(rawUrl).hostname; } catch {}
    res.json({ success: false, title: domain || rawUrl, url: rawUrl });
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
