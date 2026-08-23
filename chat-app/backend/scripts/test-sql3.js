const sql = require('mssql');

async function main() {
  // Try different SQL Server instances on m149
  const instances = [
    { server: 'm149', instance: '', desc: 'Default instance' },
    { server: 'm149', instance: 'OLIMP', desc: 'Named instance OLIMP' },
    { server: 'm149', instance: 'olimp', desc: 'Named instance olimp' },
    { server: 'm149', instance: 'FMKA', desc: 'Named instance FMKA' },
    { server: 'm149\\olimp', instance: '', desc: 'Backslash olimp' },
    { server: 'm149\\OLIMP', instance: '', desc: 'Backslash OLIMP' },
  ];

  for (const inst of instances) {
    const server = inst.server + (inst.instance ? '\\' + inst.instance : '');
    const port = 1433; // default
    try {
      const pool = await sql.connect({
        server: inst.server,
        port: port,
        database: 'master',
        options: { encrypt: false, trustServerCertificate: true },
        authentication: {
          type: 'ntlm',
          options: { userName: 'amid', password: 'Pan1309Kris', domain: 'VLADICE' }
        }
      });
      const r = await pool.request().query('SELECT @@SERVERNAME as srv, DB_NAME() as db');
      console.log(inst.desc + ' (' + server + '): SUCCESS - ' + JSON.stringify(r.recordset[0]));
      // Get databases
      const r2 = await pool.request().query('SELECT name FROM sys.databases ORDER BY name');
      console.log('  Databases:', r2.recordset.map(d => d.name).join(', '));
      sql.close();
    } catch(e) {
      console.log(inst.desc + ' (' + server + '): ' + e.message.split('\n')[0]);
    }
  }
}

main();
