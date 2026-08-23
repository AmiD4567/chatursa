const { Client } = require('pg');

const client = new Client({
  host: '192.168.210.133',
  port: 5432,
  database: 'fmka',
  user: 'analyst',
  password: '', // try no password first
});

client.connect(err => {
  if (err) {
    console.log('Connection error:', err.message);
    // Try with empty string password
    const c2 = new Client({
      host: '192.168.210.133',
      port: 5432,
      database: 'fmka',
      user: 'analyst',
      password: '', 
    });
    c2.connect(err2 => {
      if (err2) console.log('Error with empty password:', err2.message);
      else {
        console.log('Connected with empty password!');
        c2.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 50', (e, r) => {
          if (e) console.log('Query error:', e.message);
          else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
          c2.end();
        });
      }
    });
  } else {
    console.log('Connected!');
    client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 50', (e, r) => {
      if (e) console.log('Query error:', e.message);
      else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
      client.end();
    });
  }
});
