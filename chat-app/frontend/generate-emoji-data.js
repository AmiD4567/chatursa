const fs = require('fs');
const path = require('path');

// Загружаем данные emoji-picker-react
const emojisDataPath = path.join(__dirname, 'node_modules/emoji-picker-react/dist/data/emojis.json');
const emojisData = JSON.parse(fs.readFileSync(emojisDataPath, 'utf8'));

// Категории из emoji-picker-react (Еда, Путешествия, Активности, Объекты и Символы исключены по запросу пользователя)
const categoryOrder = [
  { key: 'smileys_people', name: 'Смайлы', icon: '😀' },
  { key: 'animals_nature', name: 'Природа', icon: '🐱' },
  // food_drink исключён — пользователь просил удалить категорию "Еда"
  // travel_places, activities, objects, symbols исключены по запросу пользователя
];

// Категории для фильтрации (ограничиваем количество популярных эмодзи)
const CATEGORY_LIMITS = {
  'Смайлы': Infinity,
  'Жесты': Infinity,
  'Природа': 30,
};

// Ключевые слова для определения жестов рук (извлекаются из smileys_people в отдельную категорию)
const HAND_KEYWORDS = [
  'hand', 'finger', 'thumb', 'fist', 'wave', 'clap', 'point', 'pinch',
  'selfie', 'muscle', 'bicep', 'palms', 'prayer', 'writing', 'manicure',
  'gesturing', 'holding hands', 'tipping hand'
];

function isHandEmoji(names) {
  // Используем regex с word boundary для точного совпадения слов (исключаем "disappointed", "handball" и т.д.)
  const pattern = new RegExp(`\\b(${HAND_KEYWORDS.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return names.some(n => pattern.test(n));
}

// Конвертирует unified code в реальный эмодзи (с skin tones и ZWJ sequences)
function unifiedToEmoji(unified, variants = []) {
  // Если есть variants — берём первый с базовым skin tone (1f3fb = light)
  if (variants && variants.length > 0) {
    const firstVariant = variants[0];
    // Разбираем "1f44b-1f3fb" → ["1f44b", "1f3fb"]
    const parts = firstVariant.split('-');
    return String.fromCodePoint(...parts.map(p => parseInt(p, 16)));
  }
  
  // Нет variants — просто базовый emoji через parseInt
  return String.fromCodePoint(parseInt(unified, 16));
}

// Формируем структуру для InlinePicker
const result = {};

for (const cat of categoryOrder) {
  const emojisInCat = emojisData.emojis[cat.key] || [];
  
  if (cat.name === 'Смайлы') {
    // Извлекаем жесты рук в отдельную категорию
    const hands = [];
    const faces = [];
    
    for (const e of emojisInCat) {
      if (isHandEmoji(e.n)) {
        hands.push({
          emoji: unifiedToEmoji(e.u, e.v),
          name: e.n.join(' '),
        });
      } else {
        faces.push({
          emoji: unifiedToEmoji(e.u, e.v),
          name: e.n.join(' '),
        });
      }
    }
    
    result['Смайлы'] = { icon: cat.icon, emojis: faces };
    result['Жесты'] = { icon: '👋', emojis: hands };
  } else {
    result[cat.name] = {
      icon: cat.icon,
      emojis: emojisInCat.map(e => ({
        emoji: unifiedToEmoji(e.u, e.v), // реальный эмодзи
        name: e.n.join(' '), // short names (для tooltip)
      })),
    };
  }
}

// Применяем лимиты на количество эмодзи в каждой категории
for (const [name, data] of Object.entries(result)) {
  const limit = CATEGORY_LIMITS[name];
  if (limit && data.emojis.length > limit) {
    console.log(`✂️  ${name}: ${data.emojis.length} → ${limit}`);
    data.emojis = data.emojis.slice(0, limit);
  }
}

// Сохраняем в файл для использования в InlinePicker
const outputPath = path.join(__dirname, 'src/emojiData.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

console.log(`✅ Generated ${Object.keys(result).length} categories`);
for (const [name, data] of Object.entries(result)) {
  console.log(`  - ${name}: ${data.emojis.length} emojis`);
}
console.log(`\nSaved to: ${outputPath}`);

// Покажем первые 10 эмодзи для проверки
console.log('\n🔍 Примеры (Смайлы):');
const first10 = result['Смайлы'].emojis.slice(0, 10);
first10.forEach(e => console.log(`  ${e.emoji} — ${e.name}`));

// Покажем примеры жестов
console.log('\n🔍 Примеры (Жесты):');
const gestures = result['Жесты'].emojis.slice(0, 10);
gestures.forEach(e => console.log(`  ${e.emoji} — ${e.name}`));

// Покажем пример с skin tone
const waveExample = result['Жесты'].emojis.find(e => e.name.includes('waving hand'));
if (waveExample) {
  console.log(`\n🖐️ Скин-тоун: ${waveExample.emoji} — ${waveExample.name}`);
}
