/** Verify encryption coverage and decryption round-trip */
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = 'C:\\ChatServer\\chat-app\\backend\\chat.db';
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY || 'my-super-secret-key-2026';
const IV_LENGTH = 16; // 128-bit IV for AES-256-CBC
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

/**
 * Check if text matches the encrypted format: hexIV:ciphertext
 * Encrypted messages are exactly "32-hex-chars:more-hex" with no newlines.
 */
function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  
  // Must be single colon, no newlines, IV must be exactly 32 hex chars (16 bytes)
  const match = text.match(/^([0-9a-f]{32}):([0-9a-f]+)$/i);
  if (!match) return false;
  
  try {
    const iv = Buffer.from(match[1], 'hex');
    return iv.length === IV_LENGTH;
  } catch {
    return false;
  }
}

function decryptText(encryptedText) {
  if (!encryptedText || encryptedText.length === 0) return null;
  if (!isEncrypted(encryptedText)) return encryptedText; // not encrypted, return as-is
  
  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decrypt error:', err.message);
    return encryptedText; // return as-is on failure
  }
}

async function main() {
  console.log('🔍 Verifying encryption...\n');
  
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  // Sample messages
  const rows = db.exec("SELECT id, text FROM messages WHERE text IS NOT NULL AND text != '' LIMIT 10");
  const msgValues = rows[0].values;
  
  console.log('Sample messages:');
  for (const [id, text] of msgValues) {
    const enc = isEncrypted(text);
    const displayText = text.substring(0, 50).replace(/\n/g, '\\n').replace(/\r/g, '');
    console.log(`  [${enc ? '🔒' : '📄'}] #${id}: ${displayText}${text.length > 50 ? '...' : ''}`);
    
    if (enc) {
      const decrypted = decryptText(text);
      if (decrypted && decrypted.length > 0) {
        console.log(`      → "${decrypted.substring(0, 50).replace(/\n/g, '\\n')}${decrypted.length > 50 ? '...' : ''}"`);
      } else {
        console.log(`      → ❌ DECRYPTION FAILED!`);
      }
    }
  }

  // Full DB scan
  const allRows = db.exec("SELECT id, text FROM messages WHERE text IS NOT NULL AND text != ''");
  
  let totalEncrypted = 0;
  let totalPlain = 0;
  let decryptFail = 0;
  let decryptSuccess = 0;
  
  for (const [id, text] of allRows[0].values) {
    if (isEncrypted(text)) {
      totalEncrypted++;
      const decrypted = decryptText(text);
      if (decrypted && decrypted.length > 0) {
        decryptSuccess++;
      } else {
        decryptFail++;
      }
    } else {
      totalPlain++;
    }
  }
  
  const total = totalEncrypted + totalPlain;
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total messages with text: ${total}`);
  console.log(`   Encrypted (hexIV:ciphertext): ${totalEncrypted} (${(totalEncrypted/total*100).toFixed(1)}%)`);
  console.log(`   Plain text / other format:    ${totalPlain} (${((total-totalEncrypted)/total*100).toFixed(1)}%)`);
  console.log(`\n   Decryption successes: ${decryptSuccess}`);
  console.log(`   Decryption failures:  ${decryptFail}`);
  
  if (decryptFail > 0) {
    console.log('\n❌ Some encrypted messages could NOT be decrypted!');
  } else if (totalEncrypted > 0) {
    console.log('\n✅ All encrypted messages decrypt successfully!');
  }
  
  // Show plain text examples that might need re-encryption
  if (totalPlain > 0) {
    console.log(`\n⚠️  ${totalPlain} messages are NOT in hexIV:ciphertext format.`);
    let shown = 0;
    for (const [id, text] of allRows[0].values) {
      if (!isEncrypted(text) && shown < 5) {
        console.log(`   - #${id}: "${text.substring(0, 70).replace(/\n/g, '\\n')}${text.length > 70 ? '...' : ''}"`);
        shown++;
      }
    }
  }

  db.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
