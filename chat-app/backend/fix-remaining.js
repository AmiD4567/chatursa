/** Fix remaining unencrypted text reads */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');
const lines = c.split('\n');

// 1. REST API messages endpoint: text: row.text -> text: decryptText(row.text)
let fixed1 = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'text: row.text,' && !lines[i].includes('decryptText')) {
    // Check context - is this inside a messages.map block?
    let inMsgMap = false;
    for (let j = Math.max(0, i-15); j < i; j++) {
      if (lines[j].includes('.map(row =>') || lines[j].includes('db.all')) inMsgMap = true;
    }
    if (inMsgMap) {
      lines[i] = lines[i].replace('text: row.text,', 'text: decryptText(row.text),');
      fixed1 = true;
      console.log('[OK] Fixed REST API messages endpoint (line ' + (i+1) + ')');
      break;
    }
  }
}
if (!fixed1) {
  // Show context for debugging
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'text: row.text,' && !lines[i].includes('decryptText')) {
      console.log('[WARN] Found text: row.text, at line ' + (i+1) + ', context:');
      for (let j = Math.max(0,i-5); j <= Math.min(i+3, lines.length-1); j++) {
        console.log('  ' + (j+1) + ': ' + lines[j].trim());
      }
    }
  }
}

// 2. Check msg.text occurrences
let msgTextCount = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('msg.text') && !lines[i].includes('decryptText')) {
    msgTextCount++;
    // Show context
    console.log('[INFO] msg.text without decrypt at line ' + (i+1) + ':');
    for (let j = Math.max(0,i-3); j <= Math.min(i+2, lines.length-1); j++) {
      console.log('  ' + (j+1) + ': ' + lines[j].trim());
    }
  }
}
if (msgTextCount === 0) console.log('[OK] No unencrypted msg.text found');

// Write back - join lines back into c
c = lines.join('\n');
fs.writeFileSync(f, c, 'utf8');
console.log('\nDone.');
