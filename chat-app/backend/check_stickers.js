const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY || 'my-super-secret-key-2026';

function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const parts = text.split(':');
  if (parts.length < 2) return false;
  try { Buffer.from(parts[0], 'hex'); return true; } catch { return false; }
}

function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;
  if (!isEncrypted(encryptedText)) return encryptedText;
  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    if (!ivHex || !encryptedHex) return encryptedText;
    const iv = Buffer.from(ivHex, 'hex');
    if (iv.length !== 16) return encryptedText;
    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) { return encryptedText; }
}

async function main() {
  const dbPath = path.join(__dirname, 'chat.db');
  if (!fs.existsSync(dbPath)) {
    console.error('DB not found at:', dbPath);
    return;
  }
  const fileBuffer = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(fileBuffer);

  // Check sticker messages
  const result = db.exec("SELECT id, text, file_data FROM messages WHERE text LIKE '%STICKER%' LIMIT 5");
  if (result[0]) {
    result[0].values.forEach(row => {
      const decrypted = decryptText(row[1]);
      const marker = '\x00STICKER\x00';
      console.log('ID:', row[0]);
      console.log('Decrypted length:', decrypted?.length);
      console.log('Contains STICKER marker:', decrypted && decrypted.includes(marker));
      console.log('Decrypted:', JSON.stringify(decrypted));
      console.log('File data:', row[2]);
      console.log('---');
    });
  } else {
    console.log('No sticker messages found');
  }

  const allMsgs = db.exec('SELECT COUNT(*) FROM messages');
  console.log('Total messages:', allMsgs[0]?.values[0][0]);
}

main().catch(console.error);
