const Database = require('better-sqlite3');
const db = new Database('C:/ChatServer/chat-app/backend/chat.db');
const users = db.prepare('SELECT id, username, email, is_admin FROM users').all();
console.log('Users:', JSON.stringify(users, null, 2));
const columns = db.prepare("PRAGMA table_info(users)").all();
console.log('Columns:', columns.map(c => c.name).join(', '));
