const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
const css = fs.readFileSync(cssPath, 'utf8');
const lines = css.split('\n');
const totalLines = lines.length;

const sections = {
  'base.css':      { start: 0,   end: 306 },
  'auth.css':      { start: 306, end: 743 },
  'layout.css':    { start: 743, end: 1288 },
  'chat.css':      { start: 1288,end: 3080 },
  'modals.css':    { start: 3080,end: 8323 },
  'views.css':     { start: 8323,end: 9413 },
  'theme.css':     { start: 9413,end: totalLines }
};

const outDir = path.join(__dirname, 'src', 'css');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const [file, range] of Object.entries(sections)) {
  const content = lines.slice(range.start, range.end).join('\n');
  fs.writeFileSync(path.join(outDir, file), content, 'utf8');
  console.log('Created ' + file + ': lines ' + (range.start+1) + '-' + range.end + ' (' + (range.end - range.start) + ' lines)');
}

console.log('\nTotal split into ' + Object.keys(sections).length + ' files');
