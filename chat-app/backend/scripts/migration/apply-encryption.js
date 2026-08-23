/**
 * Comprehensive encryption patch for server.js
 * Handles both clean and partially-modified states.
 */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// ============================================================
// PHASE 1: Fix crypto functions (lines ~17-46)
// ============================================================

// Check current state - is the file clean or partially modified?
const hasBrokenTextSplit = c.includes("const [ivHex, encryptedHex] = text.split(':')");
const hasCleanCrypto = c.includes('// Функция шифрования текста\nfunction encryptText(text) {\n  if (!text || text.length === 0) return null;\n\n  const iv = crypto.randomBytes(IV_LENGTH);');

if (hasBrokenTextSplit) {
  // File is partially modified: decryptText has `text.split(':')` but param is still `encryptedText`
  // We need to replace the entire broken crypto block with the correct one
  
  // Find the start of the crypto section and the end (before "Функция для получения локального IP")
  const startMarker = '// Функция шифрования текста\nfunction encryptText(text) {';
  const endMarker = '\n// Функция для получения локального IP';
  
  const startIdx = c.indexOf(startMarker);
  const endIdx = c.indexOf(endMarker);
  
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = c.substring(0, startIdx);
    const after = c.substring(endIdx);
    
    const newCryptoBlock = `// Проверка: строка уже зашифрована? (формат: hexIV:hexCiphertext)
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
    
    c = before + newCryptoBlock + after;
    console.log('[PHASE1] Fixed crypto functions (replaced broken block)');
  } else {
    console.log('[PHASE1] ERROR: Could not find crypto block boundaries');
  }
} else if (hasCleanCrypto) {
  // File is clean - apply the full replacement
  const oldBlock = `// Функция шифрования текста
function encryptText(text) {
  if (!text || text.length === 0) return null;

  const iv = crypto.randomBytes(IV_LENGTH);`;

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

  const iv = crypto.randomBytes(IV_LENGTH);`;

  c = c.replace(oldBlock, newBlock);
  
  // Also update decryptText
  const oldDecrypt = `function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;

  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');`;

  const newDecrypt = `function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;
  // Если не зашифровано — вернуть как есть (для обратной совместимости с существующими данными)
  if (!isEncrypted(encryptedText)) return encryptedText;

  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');`;

  c = c.replace(oldDecrypt, newDecrypt);
  
  // Fix error return
  c = c.replace(
    "return null;\n  }\n}\n\n// Функция шифрования JSON данных",
    "return encryptedText; // возвращаем как есть при ошибке\n  }\n}\n\n// Функция шифрования JSON данных"
  );
  
  console.log('[PHASE1] Fixed crypto functions (clean file)');
} else {
  console.log('[PHASE1] SKIP: crypto functions already correct?');
}

// ============================================================
// PHASE 2: Encrypt text on INSERT statements
// ============================================================

// 2. Main send_message handler (~line 3686) — raw SQL with template literals
const m_send = "VALUES ('${messageId}', '${chatId}', '${onlineUser.id}', '${(text || '').replace(/'/g, \"''\")}'";
if (c.includes(m_send)) {
  c = c.replace(m_send, "VALUES ('${messageId}', '${chatId}', '${onlineUser.id}', encryptText('${(text || '').replace(/'/g, \"''\")}'),");
  console.log('[2] Encrypted text in send_message INSERT');
} else {
  // Check if already done
  const m_send_done = "encryptText('${(text || '').replace(/'/g, \"''\")}')";
  if (c.includes(m_send_done)) {
    console.log('[2] SKIP: already encrypted (send_message)');
  } else {
    console.log('[2] WARN: send_message INSERT marker not found');
  }
}

// 3. forward_message (~line 4078) — raw SQL with template literals  
const m_fwd = "VALUES ('${newMessageId}', '${chat.id}', '${onlineUser.id}', '${textVal}'";
if (c.includes(m_fwd)) {
  c = c.replace(m_fwd, "VALUES ('${newMessageId}', '${chat.id}', '${onlineUser.id}', '${encryptedText}'");
  console.log('[3] Encrypted text in forward_message INSERT');
  
  // Add encryptText call before sql variable
  const m_fwd2 = 'const textVal = String(originalMessage.text || \'\').replace(/\'/g, "\'\'");';
  if (c.includes(m_fwd2)) {
    c = c.replace(m_fwd2, `const textVal = String(originalMessage.text || '').replace(/'/g, "''");\n    const encryptedText = encryptText(textVal);`);
    console.log('[3b] Added encryptText() call before forward_message SQL');
  } else {
    // Check if already done
    if (c.includes('const encryptedText = encryptText(textVal);')) {
      console.log('[3b] SKIP: already has encryptText call');
    } else {
      console.log('[3b] WARN: textVal definition not found');
    }
  }
} else {
  if (c.includes("encryptText('${encryptedText}')") || c.includes("'${encryptedText}'")) {
    console.log('[3] SKIP: already encrypted (forward_message)');
  } else {
    console.log('[3] WARN: forward_message INSERT marker not found');
  }
}

// 4. Bulk import / copy message (~line 2180) — prepared statement with bind()
const m_bulk = 'originalMsg.text || null,';
if (c.includes(m_bulk)) {
  c = c.replace(m_bulk, 'encryptText(originalMsg.text) || null,');
  console.log('[4] Encrypted text in bulk import INSERT');
} else if (c.includes('encryptText(originalMsg.text)')) {
  console.log('[4] SKIP: already encrypted (bulk import)');
} else {
  console.log('[4] WARN: bulk import marker not found');
}

// 5. Bot welcome message (~line 3493) — prepared statement with bind()
const m_bot_welcome = "VALUES (?, 'general', ?, ?, ?)\n          `, [messageId, botId, welcomeText, new Date().toISOString()]";
if (c.includes(m_bot_welcome)) {
  c = c.replace(m_bot_welcome, "VALUES (?, 'general', ?, encryptText(?), ?)\n          `, [messageId, botId, welcomeText, new Date().toISOString()]");
  console.log('[5] Encrypted text in bot welcome INSERT');
} else if (c.includes("encryptText(?)") && c.includes("'general'")) {
  console.log('[5] SKIP: already encrypted (bot welcome)');
} else {
  // Try broader search - the actual format might differ slightly
  const lines = c.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("VALUES (?, 'general', ?, ?, ?)") && lines[i+1] && lines[i+1].includes('messageId, botId, welcomeText')) {
      lines[i] = lines[i].replace("VALUES (?, 'general', ?, ?, ?)", "VALUES (?, 'general', ?, encryptText(?), ?)");
      c = lines.join('\n');
      found = true;
      console.log('[5] Encrypted text in bot welcome INSERT (line-by-line)');
      break;
    }
  }
  if (!found) console.log('[5] WARN: bot welcome INSERT not found');
}

// 6. Bot reminder message (~line 4457) — prepared statement with bind()
const m_bot_reminder = "VALUES (?, ?, ?, ?, ?)\n          `, [messageId, botChatId, botId, reminderText, new Date().toISOString()]";
if (c.includes(m_bot_reminder)) {
  c = c.replace(m_bot_reminder, "VALUES (?, ?, ?, encryptText(?), ?)\n          `, [messageId, botChatId, botId, reminderText, new Date().toISOString()]");
  console.log('[6] Encrypted text in bot reminder INSERT');
} else {
  // Try line-by-line approach
  const lines = c.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("VALUES (?, ?, ?, ?, ?)") && lines[i+1] && lines[i+1].includes('messageId, botChatId, botId, reminderText')) {
      lines[i] = lines[i].replace("VALUES (?, ?, ?, ?, ?)", "VALUES (?, ?, ?, encryptText(?), ?)");
      c = lines.join('\n');
      found = true;
      console.log('[6] Encrypted text in bot reminder INSERT (line-by-line)');
      break;
    }
  }
  if (!found) console.log('[6] WARN: bot reminder INSERT not found');
}

// ============================================================
// PHASE 3: Decrypt text on SELECT statements
// ============================================================

// 7. getChatMessages (~line 2650) — in the message object construction
const m_getmsg = "text: row.text || '',";
if (c.includes(m_getmsg)) {
  c = c.replace(m_getmsg, "text: decryptText(row.text) || '',");
  console.log('[7] Decrypted text in getChatMessages');
} else if (c.includes("decryptText(row.text)")) {
  console.log('[7] SKIP: already decrypted (getChatMessages)');
} else {
  console.log('[7] WARN: getChatMessages row.text not found');
}

// 8. getUserChats — last_msg_text  
const m_lastmsg = "lastMsgText: row.last_msg_text || '',";
if (c.includes(m_lastmsg)) {
  c = c.replace(m_lastmsg, "lastMsgText: decryptText(row.last_msg_text) || '',");
  console.log('[8] Decrypted text in getUserChats');
} else if (c.includes("decryptText(row.last_msg_text)")) {
  console.log('[8] SKIP: already decrypted (getUserChats)');
} else {
  // Search for it more broadly
  const lastMsgLines = c.split('\n').filter(l => l.includes('last_msg_text'));
  if (lastMsgLines.length > 0) {
    console.log('[8] Found last_msg_text references:', lastMsgLines.length);
    c = c.replace(/lastMsgText: row\.last_msg_text \|\| ''/g, "lastMsgText: decryptText(row.last_msg_text) || '',");
    if (c.includes("decryptText(row.last_msg_text)")) {
      console.log('[8] Decrypted text in getUserChats (regex)');
    } else {
      console.log('[8] WARN: could not replace last_msg_text');
    }
  } else {
    console.log('[8] INFO: no last_msg_text found, checking for similar patterns...');
    // Maybe it's structured differently
    const similar = c.split('\n').filter(l => l.includes('lastMsgText'));
    if (similar.length > 0) {
      console.log('   Found:', similar[0].trim());
    }
  }
}

// 9. Decrypt text in SELECT queries — use line-by-line for reliability
const selectLines = c.split('\n');
let changes9 = 0;
for (let i = 0; i < selectLines.length; i++) {
  const line = selectLines[i];
  
  // Pattern: m.text in SELECT that's followed by JOIN users ... WHERE m.id = ?
  if (line.includes('SELECT m.id, m.chat_id, m.sender_id, m.text') && 
      line.includes('m.file_data') &&
      c.substring(c.indexOf(line, i > 0 ? selectLines.slice(0,i).reduce((a,l) => a+l.length, 0) : 0)).includes('WHERE m.id = ?')) {
    if (!line.includes('decryptText(m.text)')) {
      selectLines[i] = line.replace('m.text', 'decryptText(m.text) as text');
      changes9++;
    }
  }
  
  // Pattern: SELECT ... m.text, m.file_data, m.timestamp, m.forwarded_from (forwarded_message query)
  if ((line.includes('SELECT m.id') && line.includes('m.sender_id') && 
       line.includes('m.text, m.file_data, m.timestamp, m.forwarded_from')) &&
      !line.includes('decryptText(m.text)')) {
    selectLines[i] = line.replace('m.text', 'decryptText(m.text) as text');
    changes9++;
  }
}
if (changes9 > 0) {
  c = selectLines.join('\n');
  console.log('[9] Decrypted text in SELECT queries (' + changes9 + ' changes)');
} else {
  // Check if already done
  const decryptSelects = (c.match(/decryptText\(m\.text\)/g) || []).length;
  if (decryptSelects > 0) {
    console.log('[9] SKIP: SELECT queries already have decryptText (' + decryptSelects + ' found)');
  } else {
    // Try broader approach - find all "SELECT m.id, m.chat_id" lines with m.text
    const broad = c.split('\n').filter(l => l.includes('SELECT m.id') && l.includes('m.sender_id') && l.includes('m.text'));
    if (broad.length > 0) {
      console.log('[9] Found SELECT patterns:', broad.map(l => l.trim().substring(0,80)).join(' | '));
      // Apply regex replacement to all such lines
      c = c.replace(
        /(SELECT m\.id, m\.chat_id, m\.sender_id,)m\.text(, m\.file_data)/g,
        '$1decryptText(m.text) as text$2'
      );
      if (c.includes('decryptText(m.text)')) {
        console.log('[9] Applied broad regex replacement for SELECT queries');
      }
    } else {
      console.log('[9] INFO: no m.text in SELECT patterns found');
    }
  }
}

// ============================================================
// Write back
// ============================================================
fs.writeFileSync(f, c, 'utf8');
console.log('\n✓ Patch applied successfully!');
