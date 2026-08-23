const sql = require('mssql');

async function main() {
  // Try m149 first with NTLM
  try {
    const pool = await sql.connect({
      server: 'm149',
      database: 'fmka',
      port: 1433,
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
    console.log('Connected to m149/fmka!');
    const r = await pool.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES');
    console.log('Tables:', r.recordset.map(t => t.TABLE_NAME).join('\n  '));
    sql.close();
  } catch(e) {
    console.log('m149/fmka error:', e.message);
    
    // Try other databases on m149
    try {
      const pool2 = await sql.connect({
        server: 'm149',
        database: 'master',
        port: 1433,
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
      console.log('\nConnected to m149/master!');
      const r2 = await pool2.request().query(`
        SELECT name FROM sys.databases ORDER BY name
      `);
      console.log('Databases:', r2.recordset.map(d => d.name).join('\n  '));
      sql.close();
    } catch(e2) {
      console.log('m149/master error:', e2.message);
      
      // Try 192.168.210.133 with different ports
      const ports = [1433, 1541, 5432];
      for (const port of ports) {
        try {
          const pool3 = await sql.connect({
            server: '192.168.210.133',
            port: port,
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
          console.log('\nConnected to 192.168.210.133:' + port + '!');
          const r3 = await pool3.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES');
          console.log('Tables:', r3.recordset.map(t => t.TABLE_NAME).join('\n  '));
          sql.close();
          break;
        } catch(e3) {
          console.log('192.168.210.133:' + port + ' - ' + e3.message.split('\n')[0]);
        }
      }
    }
  }
}

main();
