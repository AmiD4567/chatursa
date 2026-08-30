const DB_NAME = 'chat-ursa-offline';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('messages')) {
        const msgs = db.createObjectStore('messages', { keyPath: 'id' });
        msgs.createIndex('chatId', 'chatId', { unique: false });
        msgs.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        outbox.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('custom_backgrounds')) {
        db.createObjectStore('custom_backgrounds', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── Библиотека пользовательских фонов чата ───

export async function saveCustomBg(dataUrl) {
  const db = await openDB();
  const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('custom_backgrounds', 'readwrite');
    tx.objectStore('custom_backgrounds').put({ id, dataUrl, createdAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return id;
}

export async function getAllCustomBgs() {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction('custom_backgrounds', 'readonly')
      .objectStore('custom_backgrounds').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteCustomBg(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('custom_backgrounds', 'readwrite');
    tx.objectStore('custom_backgrounds').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function saveMessages(chatId, messages) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  for (const msg of messages) {
    store.put({ ...msg, chatId });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function getMessages(chatId, limit = 100) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.objectStore('messages').index('chatId');
  const range = IDBKeyRange.only(chatId);
  const messages = [];
  await new Promise((resolve, reject) => {
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && messages.length < limit) {
        messages.unshift(cursor.value);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return messages;
}

export async function saveChats(chats) {
  const db = await openDB();
  const tx = db.transaction('chats', 'readwrite');
  const store = tx.objectStore('chats');
  for (const chat of chats) {
    store.put(chat);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function getChats() {
  const db = await openDB();
  const tx = db.transaction('chats', 'readonly');
  const store = tx.objectStore('chats');
  const chats = [];
  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chats.push(cursor.value);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return chats.sort(compareChatsDesc);
}

export async function queueOutgoing(msg) {
  const db = await openDB();
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  store.add({ ...msg, status: 'pending', queuedAt: new Date().toISOString() });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function getOutbox() {
  const db = await openDB();
  const tx = db.transaction('outbox', 'readonly');
  const index = tx.objectStore('outbox').index('status');
  const range = IDBKeyRange.only('pending');
  const queue = [];
  await new Promise((resolve, reject) => {
    const req = index.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        queue.push(cursor.value);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return queue;
}

export async function removeFromOutbox(id) {
  const db = await openDB();
  const tx = db.transaction('outbox', 'readwrite');
  tx.objectStore('outbox').delete(id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function setMetadata(key, value) {
  const db = await openDB();
  const tx = db.transaction('metadata', 'readwrite');
  tx.objectStore('metadata').put({ key, value });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

export async function getMetadata(key) {
  const db = await openDB();
  const tx = db.transaction('metadata', 'readonly');
  const store = tx.objectStore('metadata');
  const value = await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = (e) => resolve(e.target.result?.value);
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return value;
}

// Числовой «вес» времени чата для сортировки списка.
// Важно: бэкенд присылает created_at (snake_case), а фронт раньше читал
// createdAt (camelCase) — из-за этого время часто было undefined, компаратор
// возвращал NaN и новый чат оставался внизу списка. Здесь мы проверяем все
// возможные поля и трактуем отсутствующий/невалидный timestamp как самый свежий
// (Infinity), чтобы чат без сообщений/времени попадал наверх, а не вниз.
export function chatSortTime(chat) {
  const candidates = [
    chat?.lastMessage?.timestamp,
    chat?.lastActivity,
    chat?.created_at,
    chat?.createdAt,
    chat?.timestamp,
  ];
  for (const t of candidates) {
    if (t == null) continue;
    const n = Date.parse(t);
    if (!Number.isNaN(n)) return n;
  }
  return Infinity;
}

// Сортировка чатов по убыванию времени (самые свежие — сверху).
// prevCandidates используется, чтобы не менять порядок при равных временах.
export function compareChatsDesc(a, b) {
  const ta = chatSortTime(a);
  const tb = chatSortTime(b);
  if (tb !== ta) return tb - ta;
  return 0;
}

// То же, но закреплённые (pinned) чаты всегда выше остальных.
export function compareChatsPinnedFirst(a, b) {
  if (!!a.pinned !== !!b.pinned) return !!a.pinned ? -1 : 1;
  return compareChatsDesc(a, b);
}
