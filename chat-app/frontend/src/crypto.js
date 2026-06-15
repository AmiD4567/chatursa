// E2EE модуль на основе Web Crypto API (ECDH + AES-256-GCM)
// Не требует внешних зависимостей, работает в браузере и Electron

const E2EE_KEY_STORE = 'e2ee_keys';
const E2EE_PEER_STORE = 'e2ee_peer_keys';
const E2EE_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' };
const SYMMETRIC_ALGORITHM = { name: 'AES-GCM', length: 256 };

// Кэш общих ключей в памяти: Map<chatId, CryptoKey>
const sharedKeyCache = new Map();
// API URL (устанавливается при инициализации)
let apiBase = '';

export function setE2EEApiBase(url) {
  apiBase = url;
}

// ---- Генерация/экспорт/импорт ключей ----

export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(E2EE_ALGORITHM, true, ['deriveKey', 'deriveBits']);
  return keyPair;
}

export async function exportPublicKeyBase64(publicKey) {
  const raw = await crypto.subtle.exportKey('spki', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importPublicKeyBase64(base64) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', raw, E2EE_ALGORITHM, true, []);
}

export async function exportPrivateKeyBase64(privateKey) {
  const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importPrivateKeyBase64(base64) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', raw, E2EE_ALGORITHM, true, ['deriveKey', 'deriveBits']);
}

// ---- ECDH + AES-GCM ----

export async function deriveSharedKey(privateKey, publicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    SYMMETRIC_ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    sharedKey,
    data
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    nonce: btoa(String.fromCharCode(...nonce))
  };
}

export async function decryptMessage(sharedKey, ciphertextBase64, nonceBase64) {
  try {
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
    const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      sharedKey,
      ciphertext
    );
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    console.error('[E2EE] decryptMessage error:', err.message);
    return null;
  }
}

// ---- Управление своими ключами (IndexedDB) ----

export async function saveE2EEKeys(userId, keyPair) {
  const [pubBase64, privBase64] = await Promise.all([
    exportPublicKeyBase64(keyPair.publicKey),
    exportPrivateKeyBase64(keyPair.privateKey)
  ]);
  const db = await openE2EEDB();
  const tx = db.transaction(E2EE_KEY_STORE, 'readwrite');
  tx.objectStore(E2EE_KEY_STORE).put({
    userId,
    publicKey: pubBase64,
    privateKey: privBase64,
    createdAt: new Date().toISOString()
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return pubBase64;
}

export async function loadE2EEKeys(userId) {
  const db = await openE2EEDB();
  const tx = db.transaction(E2EE_KEY_STORE, 'readonly');
  const store = tx.objectStore(E2EE_KEY_STORE);
  const data = await new Promise((resolve, reject) => {
    const req = store.get(userId);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  if (!data) return null;
  const [publicKey, privateKey] = await Promise.all([
    importPublicKeyBase64(data.publicKey),
    importPrivateKeyBase64(data.privateKey)
  ]);
  return { publicKey, privateKey, publicKeyBase64: data.publicKey };
}

export async function hasE2EEKeys(userId) {
  try {
    const keys = await loadE2EEKeys(userId);
    return keys !== null;
  } catch {
    return false;
  }
}

// ---- Публичные ключи других пользователей (кэш в IndexedDB) ----

async function savePeerPublicKey(userId, publicKeyBase64) {
  const db = await openE2EEDB();
  const tx = db.transaction(E2EE_PEER_STORE, 'readwrite');
  tx.objectStore(E2EE_PEER_STORE).put({ userId, publicKey: publicKeyBase64, cachedAt: new Date().toISOString() });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  db.close();
}

async function loadPeerPublicKey(userId) {
  const db = await openE2EEDB();
  const tx = db.transaction(E2EE_PEER_STORE, 'readonly');
  const store = tx.objectStore(E2EE_PEER_STORE);
  const data = await new Promise((resolve, reject) => {
    const req = store.get(userId);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  db.close();
  return data ? data.publicKey : null;
}

// ---- Инициализация E2EE при входе ----

export async function initE2EEForUser(userId) {
  try {
    let keyPair;
    let pubBase64;

    const existing = await loadE2EEKeys(userId);
    if (existing) {
      keyPair = { publicKey: existing.publicKey, privateKey: existing.privateKey };
      pubBase64 = existing.publicKeyBase64;
    } else {
      keyPair = await generateKeyPair();
      pubBase64 = await saveE2EEKeys(userId, keyPair);
    }

    // Загружаем публичный ключ на сервер
    if (apiBase) {
      await fetch(`${apiBase}/api/e2ee/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, publicKey: pubBase64 })
      });
    }

    return { keyPair, publicKeyBase64: pubBase64 };
  } catch (err) {
    console.error('[E2EE] init error:', err);
    return null;
  }
}

// ---- Получение публичного ключа собеседника ----

export async function getPeerPublicKey(peerUserId) {
  // Сначала проверяем кэш
  const cached = await loadPeerPublicKey(peerUserId);
  if (cached) return cached;

  // Иначе запрашиваем с сервера
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/api/e2ee/key/${peerUserId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.publicKey) {
      await savePeerPublicKey(peerUserId, data.publicKey);
      return data.publicKey;
    }
    return null;
  } catch (err) {
    console.error('[E2EE] getPeerPublicKey error:', err);
    return null;
  }
}

// ---- Получение/кэширование общего ключа для чата ----

export function getCachedSharedKey(chatId) {
  return sharedKeyCache.get(chatId) || null;
}

export function cacheSharedKey(chatId, key) {
  sharedKeyCache.set(chatId, key);
}

export async function ensureSharedKey(chatId, peerUserId, myPrivateKey) {
  // Проверяем кэш
  const cached = sharedKeyCache.get(chatId);
  if (cached) return cached;

  // Получаем публичный ключ собеседника
  const peerPubB64 = await getPeerPublicKey(peerUserId);
  if (!peerPubB64) return null;

  try {
    const peerPubKey = await importPublicKeyBase64(peerPubB64);
    const sharedKey = await deriveSharedKey(myPrivateKey, peerPubKey);
    sharedKeyCache.set(chatId, sharedKey);
    return sharedKey;
  } catch (err) {
    console.error('[E2EE] ensureSharedKey error:', err);
    return null;
  }
}

// ---- Вспомогательные ----

function openE2EEDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-e2ee', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(E2EE_KEY_STORE)) {
        db.createObjectStore(E2EE_KEY_STORE, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(E2EE_PEER_STORE)) {
        db.createObjectStore(E2EE_PEER_STORE, { keyPath: 'userId' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
