const fs = require('fs');
const testStr = 'test-encoding-фыва';
const p = '\\\\m149\\C$\\Windows\\Temp\\__kpi_enc_test.txt';
fs.writeFileSync(p, testStr, 'utf8');
console.log('Written');
const raw = fs.readFileSync(p);
console.log('Bytes:', Array.from(raw).map(b => b.toString(16)).join(' '));
console.log('Content:', fs.readFileSync(p, 'utf8'));
