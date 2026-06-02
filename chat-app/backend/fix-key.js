/** Fix ENCRYPTION_KEY to use SHA-256 derived key in server.js */
const fs = require('fs');
const f = 'C:\\ChatServer\\chat-app\\backend\\server.js';
let c = fs.readFileSync(f, 'utf8');

// Replace Buffer.from(ENCRYPTION_KEY) with crypto.createHash('sha256').update(ENCRYPTION_KEY).digest()
c = c.replace(
  "Buffer.from(ENCRYPTION_KEY)",
  "crypto.createHash('sha256').update(ENCRYPTION_KEY).digest()"
);

const count = (c.match(/crypto\.createHash\('sha256'\)\.update\(ENCRYPTION_KEY\)\.digest\(\)/g) || []).length;
console.log(`[OK] Updated ${count} key derivation(s) to use SHA-256`);

fs.writeFileSync(f, c, 'utf8');
console.log('Done.');
