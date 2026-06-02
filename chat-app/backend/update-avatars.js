const sqlite3 = require('sqlite3').verbose();
const os = require('os');

// Получаем локальный IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const SERVER_URL = `http://${getLocalIP()}:3001`;
const dbPath = require('path').join(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath);

console.log('=== Обновление URL аватаров ===');
console.log(`Новый SERVER_URL: ${SERVER_URL}`);

// Обновляем все аватары с localhost на SERVER_URL
db.run("UPDATE users SET avatar = REPLACE(avatar, 'http://localhost:3001', ?)", [SERVER_URL], function(err) {
  if (err) {
    console.error('Ошибка:', err);
  } else {
    console.log(`Обновлено строк: ${this.changes}`);
  }
  
  // Проверяем результат
  db.all("SELECT id, username, avatar FROM users", (err, rows) => {
    if (err) {
      console.error('Ошибка:', err);
    } else {
      console.log('\n=== Текущие аватары ===');
      rows.forEach(row => {
        console.log(`${row.username}: ${row.avatar}`);
      });
    }
    db.close();
  });
});