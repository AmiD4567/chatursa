const fs = require('fs');
const path = require('path');

const sqlFile = path.join(__dirname, 'dist', 'words-russian-fullbase.sql');
const outputFile = path.join(__dirname, 'dist', 'russian-dictionary.json');

console.log('Reading SQL file...');
const content = fs.readFileSync(sqlFile, 'utf8');
console.log('File size:', content.length);

const wordSet = new Set();
const lines = content.split('\n');
console.log('Lines:', lines.length);

for (let i = 75; i < lines.length; i++) {
  const line = lines[i];
  if (line && line.startsWith('(')) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const word = parts[1].trim();
      if (word.startsWith("'") && word.endsWith("'")) {
        const w = word.substring(1, word.length - 1);
        if (w.length >= 3 && w.length <= 25 && /^[а-яёА-ЯЁ-]+$/.test(w) && !w.includes('--') && !w.includes('- ')) {
          wordSet.add(w);
        }
      }
    }
  }
}

const words = Array.from(wordSet).sort();
console.log('Unique words:', words.length);

fs.writeFileSync(outputFile, JSON.stringify(words, null, 2), 'utf8');
console.log('Saved to:', outputFile);