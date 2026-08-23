const httpntlm = require('httpntlm');

const AUTH = {
  username: 'amid',
  password: 'Pan1309Kris',
  domain: 'vladice',
  workstation: ''
};

const BASE = 'http://m149';

function ntlmGet(url) {
  return new Promise((resolve, reject) => {
    httpntlm.get({ url, ...AUTH }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

async function main() {
  console.log('=== COMPLETE DATA SOURCE REPORT ===\n');

  const reportIds = [
    { id: '5db4a340-56b5-4204-8d74-2d91ea49380c', name: 'Производство-Продажи ОПТ-Сторонняя Розница-ФРС 2025' },
    { id: 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4', name: 'Производство-Продажи ОПТ-Сторонняя Розница-ФРС 2026' },
  ];

  for (const report of reportIds) {
    console.log(`\n========================================`);
    console.log(`REPORT: ${report.name}`);
    console.log(`ID: ${report.id}`);
    console.log(`========================================\n`);

    const res = await ntlmGet(BASE + `/fm/api/v2.0/PowerBIReports/${report.id}/DataSources`);
    
    if (res.statusCode === 200) {
      const data = JSON.parse(res.body.toString());
      console.log(`Data sources count: ${data.value.length}\n`);
      
      for (let i = 0; i < data.value.length; i++) {
        const ds = data.value[i];
        console.log(`--- DataSource #${i + 1} ---`);
        console.log(`  ID: ${ds.Id}`);
        console.log(`  Name: ${ds.Name}`);
        console.log(`  ConnectionString: ${ds.ConnectionString}`);
        console.log(`  DataSourceType: ${ds.DataSourceType}`);
        console.log(`  DataSourceSubType: ${ds.DataSourceSubType}`);
        console.log(`  CredentialRetrieval: ${ds.CredentialRetrieval}`);
        console.log(`  IsEnabled: ${ds.IsEnabled}`);
        console.log(`  IsReference: ${ds.IsReference}`);
        
        if (ds.DataModelDataSource) {
          console.log(`  DataModelDataSource:`);
          console.log(`    Type: ${ds.DataModelDataSource.Type}`);
          console.log(`    Kind: ${ds.DataModelDataSource.Kind}`);
          console.log(`    AuthType: ${ds.DataModelDataSource.AuthType}`);
          console.log(`    SupportedAuthTypes: ${JSON.stringify(ds.DataModelDataSource.SupportedAuthTypes)}`);
          console.log(`    Username: ${ds.DataModelDataSource.Username}`);
          console.log(`    Secret: ${ds.DataModelDataSource.Secret ? '(present)' : '(empty)'}`);
          console.log(`    ModelConnectionName: ${ds.DataModelDataSource.ModelConnectionName}`);
        }
        
        if (ds.CredentialsInServer) {
          console.log(`  CredentialsInServer:`);
          console.log(`    UserName: ${ds.CredentialsInServer.UserName}`);
          console.log(`    Password: ${ds.CredentialsInServer.Password ? '(present)' : '(empty)'}`);
          console.log(`    Domain: ${ds.CredentialsInServer.Domain}`);
        }
        
        if (ds.CredentialsByUser) {
          console.log(`  CredentialsByUser: ${JSON.stringify(ds.CredentialsByUser)}`);
        }
        console.log('');
      }
    } else {
      console.log(`HTTP ${res.statusCode}: ${res.body.toString().slice(0, 500)}`);
    }
  }

  // =========================================
  // Also get ALL reports' data sources
  // =========================================
  console.log(`\n========================================`);
  console.log(`ALL POWER BI REPORTS DATA SOURCES`);
  console.log(`========================================\n`);

  // Get all Power BI reports first
  const catalogRes = await ntlmGet(BASE + '/fm/api/v2.0/PowerBIReports');
  if (catalogRes.statusCode === 200) {
    const catalog = JSON.parse(catalogRes.body.toString());
    
    for (const item of catalog.value) {
      console.log(`\n--- ${item.Name} ---`);
      console.log(`  ID: ${item.Id}`);
      console.log(`  Path: ${item.Path}`);
      
      const dsRes = await ntlmGet(BASE + `/fm/api/v2.0/PowerBIReports/${item.Id}/DataSources`);
      if (dsRes.statusCode === 200) {
        const dsData = JSON.parse(dsRes.body.toString());
        for (const ds of dsData.value) {
          console.log(`  DataSource:`);
          console.log(`    ConnectionString: ${ds.ConnectionString}`);
          console.log(`    DataModelDataSource.Kind: ${ds.DataModelDataSource ? ds.DataModelDataSource.Kind : 'N/A'}`);
          console.log(`    DataModelDataSource.Username: ${ds.DataModelDataSource ? ds.DataModelDataSource.Username : 'N/A'}`);
          if (ds.CredentialsInServer) {
            console.log(`    Stored Credentials: ${ds.CredentialsInServer.UserName}${ds.CredentialsInServer.Domain ? '@' + ds.CredentialsInServer.Domain : ''}`);
          }
        }
      }
    }
  }

  console.log(`\n=== COMPLETE ===`);
}

main().catch(console.error);
