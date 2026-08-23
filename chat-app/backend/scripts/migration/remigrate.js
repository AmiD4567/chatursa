/** Fix isEncrypted to be stricter and re-migrate plain text messages */
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = 'C:\\ChatServer\\chat-app\\backend\\chat.db';
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY || 'my-super-secret-key-2026';
const IV_LENGTH = 16;
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

// Stricter: both parts must be valid hex, and IV must be exactly IV_LENGTH*2 hex chars
function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const colonIdx = text.indexOf(':');
  if (colonIdx <= 0) return false;
  
  const ivPart = text.substring(0, colonIdx);
  const rest = text.substring(colonIdx + 1);
  
  // IV must be exactly IV_LENGTH*2 hex chars (32 for 16-byte IV)
  if (ivPart.length !== IV_LENGTH * 2) return false;
  if (!/^[0-9a-f]+$/i.test(ivPart)) return false;
  // Rest must be non-empty hex
  if (rest.length === 0 || !/^[0-9a-f]+$/i.test(rest)) return false;
  
  return true;
}

function encryptText(text) {
  if (!text || text.length === 0) return null;
  if (isEncrypted(text)) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

async function main() {
  console.log('🔐 Re-migrating plain-text messages...\n');
  
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  // Get all messages with non-NULL text
  const rows = db.exec("SELECT id, text FROM messages WHERE text IS NOT NULL AND text != ''");
  const msgValues = rows[0].values;
  
  let encryptedCount = 0;
  let skippedCount = 0;
  let alreadyCorrect = 0;
  
  for (const [msgId, text] of msgValues) {
    const strText = String(text);
    
    if (isEncrypted(strText)) {
      // Properly encrypted - verify it can be decrypted
      try {
        const [ivHex, encHex] = strText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
        let dec = decipher.update(encHex, 'hex', 'utf8');
        dec += decipher.final('utf8');
        if (dec.length > 0) {
          alreadyCorrect++;
        } else {
          // Decryption produced empty result - re-encrypt
          const newEnc = encryptText(strText);
          db.run(`UPDATE messages SET text = '${newEnc.replace(/'/g, "''")}' WHERE id = '${String(msgId).replace(/'/g, "''")}'`);
          encryptedCount++;
        }
      } catch {
        // Can't decrypt - re-encrypt with correct key
        const newEnc = encryptText(strText);
        db.run(`UPDATE messages SET text = '${newEnc.replace(/'/g, "''")}' WHERE id = '${String(msgId).replace(/'/g, "''")}'`);
        encryptedCount++;
      }
    } else {
      // Plain text - encrypt it
      const newEnc = encryptText(strText);
      db.run(`UPDATE messages SET text = '${newEnc.replace(/'/g, "''")}' WHERE id = '${String(msgId).replace(/'/g, "''")}'`);
      encryptedCount++;
    }
    
    skippedCount++;
    if (skippedCount % 100 === 0) {
      console.log(`   Processed: ${skippedCount}...`);
    }
  }

  // Save database
  const exported = db.export();
  const buffer = Buffer.from(exported);
  fs.writeFileSync(DB_PATH, buffer);
  db.close();

  console.log('\n✅ Re-migration complete!');
  console.log(`   Newly encrypted: ${encryptedCount}`);
  console.log(`   Already correct (verified): ${alreadyCorrect}`);
  console.log(`   Total processed: ${skippedCount}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
