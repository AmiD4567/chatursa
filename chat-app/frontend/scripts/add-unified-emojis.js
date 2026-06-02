/**
 * Добавляет поле `unified` (Unicode hex code) в каждый эмодзи emojiData.json.
 * unified нужен для загрузки PNG Apple emoji из CDN.
 */

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'src', 'emojiData.json');
const outputPath = path.join(__dirname, '..', 'src', 'emojiData.json');

const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

function getUnified(emoji) {
  // Получаем все code points символа и конвертируем в hex unified код
  const codePoints = [...emoji].map(c => c.codePointAt(0).toString(16));
  return codePoints.join('-');
}

let totalAdded = 0;
let totalSkipped = 0;

for (const [category, data] of Object.entries(rawData)) {
  if (!data.emojis || !Array.isArray(data.emojis)) continue;
  
  for (const item of data.emojis) {
    if (!item.unified && item.emoji) {
      const unified = getUnified(item.emoji);
      // Вставляем unified сразу после emoji, сохраняя порядок полей
      const oldEntry = item;
      const newEntry = {
        emoji: oldEntry.emoji,
        unified: unified,
        name: oldEntry.name,
      };
      
      // Обновляем в массиве (по ссылке)
      const idx = data.emojis.indexOf(item);
      data.emojis[idx] = newEntry;
      totalAdded++;
    } else {
      totalSkipped++;
    }
  }
}

fs.writeFileSync(outputPath, JSON.stringify(rawData, null, 2), 'utf-8');

console.log(`✅ Обновлено ${totalAdded} эмодзи (добавлено поле unified)`);
console.log(`⏭️ Пропущено уже с unified: ${totalSkipped}`);
