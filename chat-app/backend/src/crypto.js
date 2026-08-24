/**
 * Шифрование конфиденциальных полей БД (aes-256-cbc, формат hexIV:hexCiphertext).
 * Ключ берётся из CHAT_ENCRYPTION_KEY (см. .env), иначе — insecure fallback.
 */
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.error('⚠️  CHAT_ENCRYPTION_KEY не задан в .env! Используется insecure default!');
  console.error('⚠️  Создайте .env файл с CHAT_ENCRYPTION_KEY=<ваш-ключ>');
}
const FALLBACK_KEY = ENCRYPTION_KEY || 'my-super-secret-key-2026';
const IV_LENGTH = 16;

// Проверка: строка уже зашифрована? (формат: hexIV:hexCiphertext)
function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const parts = text.split(':');
  if (parts.length < 2) return false;
  try {
    Buffer.from(parts[0], 'hex');
    return true;
  } catch {
    return false;
  }
}

// Функция шифрования текста
function encryptText(text) {
  if (!text || text.length === 0) return null;
  // Если уже зашифровано — не шифруем повторно
  if (isEncrypted(text)) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(FALLBACK_KEY).digest(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Сохраняем IV вместе с зашифрованным текстом (IV нужен для расшифровки)
  return iv.toString('hex') + ':' + encrypted;
}

// Функция расшифровки текста
function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;
  // Если не зашифровано — вернуть как есть (для обратной совместимости с существующими данными)
  if (!isEncrypted(encryptedText)) return encryptedText;

  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    // Проверяем, что оба значения не пустые
    if (!ivHex || !encryptedHex) {
      // Не логгируем — бот может отправлять plaintext-сообщения, которые
      // корректно возвращаются как есть (см. issue: console spam on bot usage)
      return encryptedText;
    }

    const iv = Buffer.from(ivHex, 'hex');
    // Проверяем длину IV (должна быть 16 байт для aes-256-cbc)
    if (iv.length !== 16) {
      // Не логгируем — см. выше
      return encryptedText;
    }

    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(FALLBACK_KEY).digest(), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Ошибка расшифровки:', err.message);
    // При ошибке возвращаем оригинальный текст для предотвращения потери данных
    return encryptedText;
  }
}

module.exports = { isEncrypted, encryptText, decryptText };
