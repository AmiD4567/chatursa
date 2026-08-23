const { Client } = require('pg');

// Try with SSL
const client = new Client({
  host: '192.168.210.133',
  port: 5432,
  database: 'fmka',
  user: 'analyst',
  password: '',
  ssl: { rejectUnauthorized: false }
});

client.connect(err => {
  if (err) {
    console.log('SSL error:', err.message);
    
    // Try SSL=require
    const c2 = new Client({
      host: '192.168.210.133',
      port: 5432,
      database: 'fmka',
      user: 'analyst',
      password: '',
      ssl: true
    });
    c2.connect(err2 => {
      if (err2) {
        console.log('SSL=true error:', err2.message);
        console.log('\nTrying SQL Server at olimp instead...');
        
        // Try SQL Server on olimp
        const sql = require('mssql');
        const config = {
          server: 'olimp',
          database: 'fmka',
          user: 'VLADICE\\Марина_Петухова',
          password: '',
          options: { encrypt: false, trustServerCertificate: true }
        };
        
        sql.connect(config).then(pool => {
          console.log('Connected to SQL Server on olimp!');
          return pool.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE=\'BASE TABLE\'');
        }).then(r => {
          console.log('Tables:', r.recordset.map(t => t.TABLE_NAME).join('\n  '));
          sql.close();
        }).catch(e => {
          console.log('SQL Server error:', e.message);
        });
      } else {
        console.log('Connected with SSL=true!');
        c2.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 50', (e, r) => {
          if (e) console.log('Query error:', e.message);
          else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
          c2.end();
        });
      }
    });
  } else {
    console.log('Connected with SSL!');
    client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' LIMIT 50', (e, r) => {
      if (e) console.log('Query error:', e.message);
      else console.log('Tables:', r.rows.map(r => r.table_name).join('\n  '));
      client.end();
    });
  }
});
