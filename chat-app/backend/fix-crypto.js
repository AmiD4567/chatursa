/** Fix only the crypto functions - targeted approach */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// The file has a broken decryptText: param is `encryptedText` but body uses `text.split(':')`
// We need to:
// 1. Add isEncrypted() before encryptText
// 2. Update encryptText body to skip already-encrypted data  
// 3. Fix decryptText parameter name and add plain-text handling

// Step 1: Replace the entire crypto block using line-by-line approach
const lines = c.split('\n');
let startIdx = -1, endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '// Функция шифрования текста') {
    startIdx = i;
  }
  if (startIdx >= 0 && lines[i].trim() === '// Функция для получения локального IP') {
    endIdx = i;
    break;
  }
}

if (startIdx >= 0 && endIdx > startIdx) {
  console.log(`Found crypto block: lines ${startIdx+1}-${endIdx}`);
  
  const newBlock = `// Проверка: строка уже зашифрована? (формат: hexIV:hexCiphertext)
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
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
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
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Ошибка расшифровки:', err.message);
    return encryptedText; // возвращаем как есть при ошибке
  }
}

`;

  const before = lines.slice(0, startIdx).join('\n');
  const after = lines.slice(endIdx).join('\n');
  c = before + '\n' + newBlock + after;
  
  console.log('[OK] Crypto functions replaced successfully');
} else {
  console.error(`ERROR: Could not find crypto block boundaries (start=${startIdx}, end=${endIdx})`);
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
