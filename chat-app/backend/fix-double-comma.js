/** Fix double comma in send_message INSERT */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// Fix: encryptText('...'),, ${fileDataStr -> encryptText('...'), ${fileDataStr
c = c.replace("encryptText('${(text || '').replace(/'/g, \"''\")}'),,", "encryptText('${(text || '').replace(/'/g, \"''\")}'),");

if (c.includes("encryptText('${(text || '').replace(/'/g, \"''\")}'),,")) {
  console.log('ERROR: double comma still present');
} else {
  console.log('[OK] Fixed double comma in send_message INSERT');
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
