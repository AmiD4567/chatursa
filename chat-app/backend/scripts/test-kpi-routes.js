const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const { registerKpiRoutes } = require('./kpi');

const app = express();
const db = new Database(':memory:');

app.use(express.json());
registerKpiRoutes(app, db);

const server = app.listen(0, () => {
  const port = server.address().port;
  http.get(`http://localhost:${port}/api/kpi`, { headers: { 'x-user-id': '1' } }, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      const d = JSON.parse(body);
      console.log('Groups:', Object.keys(d.groups));
      for (const [g, items] of Object.entries(d.groups)) {
        console.log(`  ${g}:`);
        for (const i of items) {
          console.log(`    ${i.id}: ${i.name} = ${i.value}`);
        }
      }
      server.close();
      db.close();
    });
  });
});
