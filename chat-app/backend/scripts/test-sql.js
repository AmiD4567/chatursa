const sql = require('mssql');

async function main() {
  // Try connecting to olimp SQL Server with Windows auth
  const config = {
    server: 'olimp',
    database: 'fmka',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      // Windows Integrated Security
      trustedConnection: true,
    },
    authentication: {
      type: 'ntlm',
      options: {
        userName: 'Марина_Петухова',
        password: '',
        domain: 'VLADICE'
      }
    }
  };

  try {
    console.log('Connecting to olimp SQL Server...');
    const pool = await sql.connect(config);
    console.log('Connected!');

    const result = await pool.request().query(`
      SELECT TABLE_NAME, TABLE_SCHEMA 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    console.log('Tables (' + result.recordset.length + '):');
    for (const t of result.recordset) {
      console.log('  ' + t.TABLE_SCHEMA + '.' + t.TABLE_NAME);
    }
    
    sql.close();
  } catch (e) {
    console.log('Error:', e.message);
    
    // Try without NTLM
    try {
      console.log('\nTrying with Windows integrated auth...');
      const pool2 = await sql.connect({
        server: 'olimp',
        database: 'fmka',
        options: { encrypt: false, trustServerCertificate: true },
        authentication: {
          type: 'ntlm',
          options: {
            userName: 'amid',
            password: 'Pan1309Kris',
            domain: 'VLADICE'
          }
        }
      });
      console.log('Connected!');
      const r = await pool2.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE=\'BASE TABLE\'');
      console.log('Tables:', r.recordset.map(t => t.TABLE_NAME).join('\n  '));
      sql.close();
    } catch(e2) {
      console.log('NTLM error:', e2.message);
    }
  }
}

main();
