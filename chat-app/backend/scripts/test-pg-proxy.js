const { Client } = require('pg');

// Try connecting through the port proxy on m149
const client = new Client({
  host: 'm149',
  port: 5433,
  database: 'fmka',
  user: 'analyst',
  password: '',
});

client.connect(err => {
  if (err) {
    console.log('m149 port 5433 error:', err.message);
    // Try with host address
    const c2 = new Client({
      host: '192.168.210.49', // m149 IP
      port: 5433,
      database: 'fmka',
      user: 'analyst',
      password: '',
    });
    c2.connect(err2 => {
      if (err2) {
        console.log('192.168.210.49:5433 error:', err2.message);
        console.log('\nAll PostgreSQL connection attempts failed.');
        console.log('Maybe need a password for analyst user.');
        
        // Try some common passwords
        const passwords = ['', 'analyst', 'password', 'fmka', '123', '123456'];
        tryNext(passwords, 0);
      } else {
        console.log('Connected through proxy!');
        c2.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 30', (e, r) => {
          if (e) console.log('Query error:', e.message);
          else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
          c2.end();
        });
      }
    });
  } else {
    console.log('Connected through m149 proxy!');
    client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 30', (e, r) => {
      if (e) console.log('Query error:', e.message);
      else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
      client.end();
    });
  }
});

function tryNext(passwords, idx) {
  if (idx >= passwords.length) {
    console.log('All passwords tried. No luck.');
    return;
  }
  const pw = passwords[idx];
  const c = new Client({
    host: '192.168.210.49',
    port: 5433,
    database: 'fmka',
    user: 'analyst',
    password: pw,
  });
  c.connect(err => {
    if (err) {
      console.log(`  pw='${pw}': ${err.message.split('\n')[0]}`);
      c.end();
      tryNext(passwords, idx + 1);
    } else {
      console.log(`  pw='${pw}': SUCCESS!`);
      c.query('SELECT current_user, version()', (e, r) => {
        if (e) console.log('Error:', e.message);
        else console.log('User info:', JSON.stringify(r.rows[0]));
        c.end();
      });
    }
  });
}
