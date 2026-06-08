const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = 3002;

async function main() {
  console.log('Starting DB init...');
  const wasmBinary = fs.readFileSync(path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
  const wasmModule = new WebAssembly.Module(wasmBinary);
  const SQL = await initSqlJs({ wasmModule });
  console.log('sql.js init OK');
  
  const db = new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS test (id int)');
  console.log('DB created OK');
  
  server.listen(PORT, () => {
    console.log('Server running on port', PORT);
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
