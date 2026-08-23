const fs = require('fs');
const initSqlJs = require('sql.js');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('C:\\ChatServer\\chat-app\\backend\\chat.db'));
  
  // Simulate what API does
  const word = 'привэт';
  const wordLower = word.toLowerCase();
  console.log('Input word:', word, 'Lower:', wordLower);
  
  // Check similar words
  const result = db.exec(`SELECT correct_word FROM spelling_dictionary WHERE LOWER(correct_word) LIKE '%${wordLower}%' LIMIT 10`);
  console.log('Similar words:', JSON.stringify(result));
  
  db.close();
})();