/** Fix decryptText key derivation */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// Replace remaining Buffer.from(ENCRYPTION_KEY) in decryptText
const old = "crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)";
const new_ = "crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), iv)";

if (c.includes(old)) {
  c = c.replace(old, new_);
  console.log('[OK] Fixed decryptText key derivation');
} else {
  // Check if already fixed
  if (c.includes("crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256')")) {
    console.log('[SKIP] Already fixed');
  } else {
    console.log('[WARN] Could not find decryptText key pattern');
    // Show what's there
    const idx = c.indexOf('createDecipheriv');
    if (idx >= 0) {
      console.log('Context:', c.substring(idx-20, idx+80));
    }
  }
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
