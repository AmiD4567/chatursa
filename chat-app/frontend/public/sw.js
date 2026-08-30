const CACHE_NAME = 'chat-ursa-v5';
const STATIC_CACHE = 'chat-ursa-static-v5';
const DYNAMIC_CACHE = 'chat-ursa-dynamic-v5';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache error:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DYNAMIC_CACHE && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
});

// Минимальная страница «нет соединения» — вместо устаревшей «живой» оболочки,
// которая маскировала бы сбой сети под работающее приложение
function offlineResponse() {
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Нет соединения</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f1a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;box-sizing:border-box}h1{font-size:22px;font-weight:600;margin:0 0 10px}p{color:rgba(255,255,255,.7);margin:0 0 8px;line-height:1.5}button{margin-top:16px;padding:12px 28px;border:none;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:16px;cursor:pointer;-webkit-tap-highlight-color:transparent}</style></head><body><h1>😔 Нет соединения с сервером</h1><p>Проверьте Wi-Fi/интернет и попробуйте снова.</p><button onclick="location.reload()">⟳ Повторить</button></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  const isNavigation = request.mode === 'navigate';

  if (url.pathname.startsWith('/static/')) {
    // Hashed-ассеты: stale-while-revalidate
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  if (isNavigation) {
    // Навигация всегда через сеть — shell не кэшируем, чтобы не показывать
    // устаревшую «живую» оболочку при реальном сбое соединения
    event.respondWith(
      fetch(request).then((response) => response).catch(() => offlineResponse())
    );
    return;
  }

  // Прочие ресурсы (не hashed): сеть с динамическим кэшем как фолбэком
  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(request, clone);
          trimCache(DYNAMIC_CACHE, 30);
        });
      }
      return response;
    }).catch(() => {
      return caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 }));
    })
  );
});

function trimCache(cacheName, maxItems) {
  caches.open(cacheName).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > maxItems) {
        cache.delete(keys[0]).then(() => trimCache(cacheName, maxItems));
      }
    });
  });
}

self.addEventListener('push', (event) => {
  let data = { title: 'Чат', body: '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: {} };
  try {
    if (event.data) data = JSON.parse(event.data.text());
  } catch {}

  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'chat-message',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Чат', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.chatId ? `/?chatId=${data.chatId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'focus-chat', chatId: data.chatId, messageId: data.messageId });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});
