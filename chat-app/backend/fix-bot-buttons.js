/** Encrypt bot buttons message text */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// Use line-by-line approach to avoid template literal issues
const lines = c.split('\n');
let found = false;
for (let i = 0; i < lines.length; i++) {
  // Look for the bot buttons INSERT: VALUES (?, ?, ?, ?, ?, ?) followed by args with text
  if (lines[i].includes('VALUES (?, ?, ?, ?, ?, ?)') && 
      lines[i+1] && lines[i+1].includes('messageId, chatId, botId, text, timestamp, buttonsData')) {
    // Check it's not already encrypted
    if (!lines[i].includes('encryptText')) {
      lines[i] = lines[i].replace('VALUES (?, ?, ?, ?, ?, ?)', 'VALUES (?, ?, ?, encryptText(?), ?, ?)');
      c = lines.join('\n');
      found = true;
      console.log('[OK] Encrypted text in bot buttons INSERT (line ' + (i+1) + ')');
    } else {
      console.log('[SKIP] Already encrypted');
    }
    break;
  }
}

if (!found) {
  // Try broader search - look for the db.run block around line 3230
  let inBotButtons = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('bot_buttons') && !inBotButtons) {
      inBotButtons = true;
    }
    if (inBotButtons && lines[i].includes('VALUES (?, ?, ?, ?, ?, ?)')) {
      if (!lines[i].includes('encryptText')) {
        lines[i] = lines[i].replace('VALUES (?, ?, ?, ?, ?, ?)', 'VALUES (?, ?, ?, encryptText(?), ?, ?)');
        c = lines.join('\n');
        found = true;
        console.log('[OK] Encrypted text in bot buttons INSERT (broad search, line ' + (i+1) + ')');
      }
      break;
    }
  }
}

if (!found) {
  console.log('[WARN] Could not find bot buttons INSERT');
  // Debug: show lines around "bot_buttons"
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('bot_buttons')) {
      console.log('  Line ' + (i+1) + ':', lines[i].trim().substring(0, 80));
      console.log('  Line ' + (i+5) + ':', lines[i+4]?.trim().substring(0, 80));
      console.log('  Line ' + (i+6) + ':', lines[i+5]?.trim().substring(0, 80));
    }
  }
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
