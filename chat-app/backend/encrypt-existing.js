/**
 * Encrypt existing plain-text messages in chat.db
 * Run this ONCE to migrate all existing messages to encrypted format.
 */
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = 'C:\\ChatServer\\chat-app\\backend\\chat.db';
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY || 'my-super-secret-key-2026';
const IV_LENGTH = 16;

// Derive a proper 32-byte key from the password using SHA-256
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  // Strict check: must be exactly "32-hex-chars:more-hex" (hexIV:ciphertext format)
  const match = text.match(/^([0-9a-f]{32}):([0-9a-f]+)$/i);
  if (!match) return false;
  try {
    const iv = Buffer.from(match[1], 'hex');
    return iv.length === IV_LENGTH;
  } catch {
    return false;
  }
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
  console.log('🔐 Encrypting existing messages in chat.db...\n');

  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found at:', DB_PATH);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  console.log('✓ Database loaded');

  const totalCount = db.exec('SELECT COUNT(*) as count FROM messages')[0]?.values[0][0] || 0;
  console.log(`📊 Total messages in database: ${totalCount}`);

  if (totalCount === 0) {
    console.log('✓ No messages to encrypt.');
    db.close();
    return;
  }

  // Get all messages with non-NULL text
  const rows = db.exec("SELECT id, text FROM messages WHERE text IS NOT NULL AND text != ''");
  
  if (rows.length === 0) {
    console.log('✓ No messages with text to encrypt.');
    db.close();
    return;
  }

  let encryptedCount = 0;
  let skippedCount = 0;
  const msgValues = rows[0].values; // [[id, text], ...]

  for (const [msgId, text] of msgValues) {
    if (!isEncrypted(String(text))) {
      const encrypted = encryptText(text);
      db.run(`UPDATE messages SET text = '${encrypted.replace(/'/g, "''")}' WHERE id = '${String(msgId).replace(/'/g, "''")}'`);
      encryptedCount++;
    } else {
      skippedCount++;
    }
    
    // Progress indicator every 100 messages
    if ((encryptedCount + skippedCount) % 100 === 0) {
      console.log(`   Processed: ${encryptedCount + skippedCount}...`);
    }
  }

  // Save database
  const exported = db.export();
  const buffer = Buffer.from(exported);
  fs.writeFileSync(DB_PATH, buffer);
  db.close();

  console.log('\n✅ Migration complete!');
  console.log(`   Encrypted: ${encryptedCount}`);
  console.log(`   Already encrypted (skipped): ${skippedCount}`);
  console.log(`   Total processed: ${encryptedCount + skippedCount}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
