/** Fix remaining encryption changes in server.js */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// 1. Add isEncrypted + update encryptText/decryptText bodies
const oldCrypto = '// Функция шифрования текста\nfunction encryptText(text) {\n  if (!text || text.length === 0) return null;\n\n  const iv = crypto.randomBytes(IV_LENGTH);';

const newCrypto = `// Проверка: строка уже зашифрована? (формат: hexIV:hexCiphertext)
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

  const iv = crypto.randomBytes(IV_LENGTH);`;

if (c.includes(oldCrypto)) {
  c = c.replace(oldCrypto, newCrypto);
  console.log('[1] Added isEncrypted + updated encryptText body');
} else {
  console.log('[1] SKIP: already applied or different format');
}

// 2. Update decryptText to handle plain text and fix error return
const oldDecrypt = `function decryptText(encryptedText) {\n  if (!encryptedText || encryptedText.length === 0) return null;\n\n  try {\n    const [ivHex, encryptedHex] = encryptedText.split(':');`;

const newDecrypt = `function decryptText(encryptedText) {\n  if (!encryptedText || encryptedText.length === 0) return null;\n  // Если не зашифровано — вернуть как есть (для обратной совместимости с существующими данными)\n  if (!isEncrypted(encryptedText)) return encryptedText;\n\n  try {\n    const [ivHex, encryptedHex] = encryptedText.split(':');`;

if (c.includes(oldDecrypt)) {
  c = c.replace(oldDecrypt, newDecrypt);
  console.log('[2] Updated decryptText to handle plain text');
} else {
  console.log('[2] SKIP: already applied or different format');
}

// 3. Fix error return in decryptText (return null -> return encryptedText)
const oldErr = "    console.error('Ошибка расшифровки:', err.message);\n    return null;\n  }\n}\n\n// Функция шифрования JSON данных";

const newErr = "    console.error('Ошибка расшифровки:', err.message);\n    return encryptedText; // возвращаем как есть при ошибке\n  }\n}\n\n// Функция шифрования JSON данных";

if (c.includes(oldErr)) {
  c = c.replace(oldErr, newErr);
  console.log('[3] Fixed decryptText error return');
} else {
  console.log('[3] SKIP: already applied or different format');
}

// 4. Bot welcome message — encrypt text in prepared statement
const botWelcome = "VALUES (?, 'general', ?, ?, ?)\n          `, [messageId, botId, welcomeText, new Date().toISOString()]";

if (c.includes(botWelcome)) {
  c = c.replace(botWelcome, "VALUES (?, 'general', ?, encryptText(?), ?)\n          `, [messageId, botId, welcomeText, new Date().toISOString()]");
  console.log('[4] Encrypted text in bot welcome INSERT');
} else {
  console.log('[4] SKIP: marker not found (bot welcome)');
}

// 5. Bot reminder message — encrypt text in prepared statement  
const botReminder = "VALUES (?, ?, ?, ?, ?)\n          `, [messageId, botChatId, botId, reminderText, new Date().toISOString()]";

if (c.includes(botReminder)) {
  c = c.replace(botReminder, "VALUES (?, ?, ?, encryptText(?), ?)\n          `, [messageId, botChatId, botId, reminderText, new Date().toISOString()]");
  console.log('[5] Encrypted text in bot reminder INSERT');
} else {
  console.log('[5] SKIP: marker not found (bot reminder)');
}

// 6. Decrypt text in getUserChats last_msg_text
const lastMsg = "lastMsgText: row.last_msg_text || '',";
if (c.includes(lastMsg)) {
  c = c.replace(lastMsg, "lastMsgText: decryptText(row.last_msg_text) || '',");
  console.log('[6] Decrypted text in getUserChats');
} else {
  console.log('[6] SKIP: marker not found (getUserChats last_msg_text)');
}

// 7. Decrypt text in getChatWithDetails single message query
const chatDetailSelect = `SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,\n               u.username as senderName, u.avatar as senderAvatar\n        FROM messages m\n        JOIN users u ON m.sender_id = u.id\n        WHERE m.id = ?`;

if (c.includes(chatDetailSelect)) {
  c = c.replace(chatDetailSelect, `SELECT m.id, m.chat_id, m.sender_id, decryptText(m.text) as text, m.file_data, m.reply_to, m.timestamp, m.forwarded_from,\n               u.username as senderName, u.avatar as senderAvatar\n        FROM messages m\n        JOIN users u ON m.sender_id = u.id\n        WHERE m.id = ?`);
  console.log('[7] Decrypted text in getChatWithDetails query');
} else {
  console.log('[7] SKIP: marker not found (getChatWithDetails SELECT)');
}

// 8. Decrypt text in forwarded_message query
const fwdSelect = `SELECT m.id, m.chat_id, m.sender_id, m.text, m.file_data, m.timestamp, m.forwarded_from,\n               u.username as senderName, u.avatar as senderAvatar`;

if (c.includes(fwdSelect)) {
  c = c.replace(fwdSelect, `SELECT m.id, m.chat_id, m.sender_id, decryptText(m.text) as text, m.file_data, m.timestamp, m.forwarded_from,\n               u.username as senderName, u.avatar as senderAvatar`);
  console.log('[8] Decrypted text in forwarded_message query');
} else {
  console.log('[8] SKIP: marker not found (forwarded_message SELECT)');
}

// Write back
fs.writeFileSync(f, c, 'utf8');
console.log('\n✓ All fixes applied!');
