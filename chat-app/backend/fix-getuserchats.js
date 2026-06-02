/** Fix getUserChats last message text decryption */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// In getUserChats: text: msg.text || (msg.file_data ? '📎 Файл' : '')
const oldLine = "text: msg.text || (msg.file_data ? '\\uD83D\\uDCF0 Файл' : ''),";
const newLine = "text: decryptText(msg.text) || (msg.file_data ? '\\uD83D\\uDCF0 Файл' : ''),";

// Try with actual emoji first
if (c.includes("text: msg.text || (msg.file_data ? '📎 Файл' : ''),")) {
  c = c.replace(
    "text: msg.text || (msg.file_data ? '📎 Файл' : ''),",
    "text: decryptText(msg.text) || (msg.file_data ? '📎 Файл' : ''),");
  console.log('[OK] Decrypted text in getUserChats lastMessage');
} else {
  // Try with unicode escape
  if (c.includes(oldLine)) {
    c = c.replace(oldLine, newLine);
    console.log('[OK] Decrypted text in getUserChats lastMessage (unicode)');
  } else {
    // Line-by-line approach
    const lines = c.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('text: msg.text') && lines[i].includes('msg.file_data')) {
        if (!lines[i].includes('decryptText')) {
          lines[i] = lines[i].replace('msg.text', 'decryptText(msg.text)');
          c = lines.join('\n');
          found = true;
          console.log('[OK] Decrypted text in getUserChats lastMessage (line-by-line)');
        }
        break;
      }
    }
    if (!found) {
      console.log('[WARN] Could not find msg.text in getUserChats');
      // Show what we have around that area
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('lastMessage = {')) {
          console.log(`   Line ${i+1}:`, lines[i+1]?.trim());
          console.log(`   Line ${i+2}:`, lines[i+2]?.trim());
          break;
        }
      }
    }
  }
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
