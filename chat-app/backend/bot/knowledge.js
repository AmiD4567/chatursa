const path = require('path');
const fs = require('fs');

// bot-knowledge.json лежит в родительской директории (backend/)
const knowledgePath = path.join(__dirname, '..', 'bot-knowledge.json');
let botKnowledge;

try {
  botKnowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  console.log('✅ База знаний бота загружена из bot-knowledge.json');
} catch (err) {
  console.error('❌ Не удалось загрузить базу знаний бота:', err.message);
  process.exit(1);
}

module.exports = botKnowledge;
