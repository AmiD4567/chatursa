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

function ntlmPost(url, body, contentType) {
  return new Promise((resolve, reject) => {
    httpntlm.post({
      url, ...AUTH,
      headers: { 'Content-Type': contentType || 'text/xml; charset=utf-8' },
      body
    }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

// Helper: parse SOAP XML to get all text content of specific elements
function extractSoapText(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

// Helper: extract SOAP element content (handles multiline)
function extractSoapElement(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

async function main() {
  console.log('=== PBIRS DATA SOURCE RESEARCH ===\n');

  // =========================================
  // APPROACH 1: REST API v2.0 - list all catalog items
  // =========================================
  console.log('--- APPROACH 1: REST API v2.0 Catalog ---');
  try {
    const catalogRes = await ntlmGet(BASE + '/fm/api/v2.0/CatalogItems');
    if (catalogRes.statusCode === 200) {
      const catalog = JSON.parse(catalogRes.body.toString());
      console.log('Total items:', catalog.value.length);
      console.log('');
      for (const item of catalog.value) {
        console.log(`  [${item.Type.padEnd(20)}] ${item.Name} (${item.Id})`);
      }
      console.log('');

      // For each report, try to get data sources
      for (const item of catalog.value) {
        if (item.Type === 'PowerBIReport' || item.Type === 'Report') {
          // Try REST endpoint for data sources
          try {
            const dsRes = await ntlmGet(BASE + `/fm/api/v2.0/DataSources(CatalogItemId=${item.Id})`);
            if (dsRes.statusCode === 200) {
              console.log(`\nDatasources for [${item.Name}]:`);
              console.log(`  ${dsRes.body.toString().slice(0, 1000)}`);
            }
          } catch(e) {
            try {
              const dsRes2 = await ntlmGet(BASE + `/fm/api/v2.0/CatalogItems(${item.Id})/DataSources`);
              if (dsRes2.statusCode === 200) {
                console.log(`\nDatasources (alt) for [${item.Name}]:`);
                console.log(`  ${dsRes2.body.toString().slice(0, 1000)}`);
              }
            } catch(e2) {}
          }
        }
      }
    } else {
      console.log('REST API responded with:', catalogRes.statusCode, catalogRes.body.toString().slice(0,300));
    }
  } catch(e) {
    console.log('REST API error:', e.message);
  }

  // =========================================
  // APPROACH 2: SOAP ReportService2010 - ListChildren
  // =========================================
  console.log('\n=== APPROACH 2: SOAP ReportService2010 ===');
  
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <ListChildren xmlns="http://schemas.microsoft.com/sqlserver/reporting/2010/03/01/ReportServer">
      <ItemPath>/</ItemPath>
      <Recursive>true</Recursive>
    </ListChildren>
  </soap:Body>
</soap:Envelope>`;

  try {
    const soapRes = await ntlmPost(
      BASE + '/ReportServer/ReportService2010.asmx',
      soapEnvelope
    );

    if (soapRes.statusCode === 200) {
      const body = soapRes.body.toString();
      // Save full response for later parsing
      const fs = require('fs');
      fs.writeFileSync('C:\\ChatServer\\chat-app\\backend\\soap-response.xml', body);
      
      // Extract catalog items from SOAP response
      const names = extractSoapElement(body, 'Name');
      const paths = extractSoapElement(body, 'Path');
      const types = extractSoapElement(body, 'Type');
      const ids = extractSoapElement(body, 'ID');
      
      console.log(`\nFound ${names.length} items via SOAP:\n`);
      for (let i = 0; i < names.length; i++) {
        console.log(`  [${(types[i]||'?').padEnd(20)}] ${names[i]}`);
        console.log(`         Path: ${paths[i]}`);
        if (ids[i]) console.log(`         ID: ${ids[i]}`);
        console.log('');
      }

      // For each shared data source, get its contents
      for (let i = 0; i < names.length; i++) {
        if (types[i] === 'DataSource') {
          console.log(`\n--- DataSource: ${names[i]} ---`);
          const dsEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <GetDataSourceContents xmlns="http://schemas.microsoft.com/sqlserver/reporting/2010/03/01/ReportServer">
      <DataSourcePath>${paths[i]}</DataSourcePath>
    </GetDataSourceContents>
  </soap:Body>
</soap:Envelope>`;
          try {
            const dsRes = await ntlmPost(
              BASE + '/ReportServer/ReportService2010.asmx',
              dsEnvelope
            );
            if (dsRes.statusCode === 200) {
              const dsBody = dsRes.body.toString();
              const connStr = extractSoapElement(dsBody, 'ConnectString');
              const credRetrieval = extractSoapElement(dsBody, 'CredentialRetrieval');
              const userName = extractSoapElement(dsBody, 'UserName');
              const dataProvider = extractSoapElement(dsBody, 'DataProvider');
              console.log(`  DataProvider: ${dataProvider[0] || 'N/A'}`);
              console.log(`  ConnectString: ${connStr[0] || 'N/A'}`);
              console.log(`  CredentialRetrieval: ${credRetrieval[0] || 'N/A'}`);
              if (userName[0]) console.log(`  UserName: ${userName[0]}`);
            }
          } catch(e) {
            console.log(`  Error getting data source contents: ${e.message}`);
          }
        }
      }

      // For each Report or PowerBIReport, get item data sources
      for (let i = 0; i < names.length; i++) {
        if (types[i] === 'Report' || types[i] === 'PowerBIReport') {
          console.log(`\n--- Report DataSources: ${names[i]} ---`);
          const dsEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <GetItemDataSources xmlns="http://schemas.microsoft.com/sqlserver/reporting/2010/03/01/ReportServer">
      <ItemPath>${paths[i]}</ItemPath>
    </GetItemDataSources>
  </soap:Body>
</soap:Envelope>`;
          try {
            const dsRes = await ntlmPost(
              BASE + '/ReportServer/ReportService2010.asmx',
              dsEnvelope
            );
            if (dsRes.statusCode === 200) {
              const dsBody = dsRes.body.toString();
              
              // Extract DataSourceReference or DataSourceDefinition
              const refs = extractSoapElement(dsBody, 'DataSourceReference');
              const connStrs = extractSoapElement(dsBody, 'ConnectString');
              const userNames = extractSoapElement(dsBody, 'UserName');
              const secrets = extractSoapElement(dsBody, 'Password');
              const dsNames = extractSoapElement(dsBody, 'DataSourceName');
              
              console.log(`  SOAP response excerpt:`, dsBody.slice(0, 2000));
              
              if (refs.length > 0) {
                console.log(`  References shared data source(s): ${refs.join(', ')}`);
              }
              if (connStrs.length > 0) {
                connStrs.forEach((cs, idx) => {
                  console.log(`  ConnectString[${idx}]: ${cs}`);
                });
              }
              if (userNames.length > 0) {
                userNames.forEach((un, idx) => {
                  console.log(`  UserName[${idx}]: ${un}`);
                });
              }
              if (dsNames.length > 0) {
                dsNames.forEach((dn, idx) => {
                  console.log(`  DataSourceName[${idx}]: ${dn}`);
                });
              }
            } else {
              console.log(`  HTTP ${dsRes.statusCode}: ${dsRes.body.toString().slice(0,300)}`);
            }
          } catch(e) {
            console.log(`  Error: ${e.message}`);
          }
        }
      }
    } else {
      console.log('SOAP responded with:', soapRes.statusCode, soapRes.body.toString().slice(0,500));
    }
  } catch(e) {
    console.log('SOAP error:', e.message);
  }

  // =========================================
  // APPROACH 3: Direct REST for specific reports
  // =========================================
  console.log('\n=== APPROACH 3: Specific report data sources ===');
  
  const targetReports = [
    { id: '5db4a340-56b5-4204-8d74-2d91ea49380c', name: 'ФРС 2025 (ОПТ)' },
    { id: 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4', name: 'ФРС 2026 (ОПТ)' }
  ];

  for (const report of targetReports) {
    console.log(`\n--- ${report.name} (${report.id}) ---`);
    
    // Try several REST endpoint patterns
    const endpoints = [
      `/fm/api/v2.0/CatalogItems(${report.id})/DataSources`,
      `/fm/api/v2.0/DataSources(CatalogItemId=${report.id})`,
      `/fm/api/v2.0/CatalogItems(${report.id})`,
      `/fm/api/v2.0/CatalogItems(${report.id})/DataModel`,
      `/fm/api/v2.0/DataModel(ItemId=${report.id})`,
      `/fm/api/v2.0/CatalogItems(${report.id})/PBIX`,
      `/fm/api/v2.0/DataModel(Id=${report.id})`,
      `/fm/api/v2.0/CatalogItems(${report.id})/DataModel/DataSource`
    ];

    for (const ep of endpoints) {
      try {
        const res = await ntlmGet(BASE + ep);
        console.log(`  GET ${ep}`);
        console.log(`  HTTP ${res.statusCode}`);
        if (res.statusCode === 200) {
          let body = res.body.toString();
          // Try to pretty-print JSON
          try {
            body = JSON.stringify(JSON.parse(body), null, 2);
          } catch(e) {}
          console.log(`  Response: ${body.slice(0, 2000)}`);
        }
      } catch(e) {
        console.log(`  GET ${ep} ERROR: ${e.message}`);
      }
    }
  }

  // =========================================
  // APPROACH 4: List all shared data sources via REST
  // =========================================
  console.log('\n=== APPROACH 4: Shared DataSources via REST ===');
  try {
    const res = await ntlmGet(BASE + '/fm/api/v2.0/DataSources');
    if (res.statusCode === 200) {
      const body = res.body.toString();
      try {
        const data = JSON.parse(body);
        console.log(`Found ${data.value.length} shared data sources:\n`);
        for (const ds of data.value) {
          console.log(`  Name: ${ds.Name}`);
          console.log(`  Path: ${ds.Path}`);
          console.log(`  ConnectionString: ${ds.ConnectionString || 'N/A'}`);
          if (ds.CredentialRetrieval) console.log(`  CredentialRetrieval: ${ds.CredentialRetrieval}`);
          if (ds.UserName) console.log(`  UserName: ${ds.UserName}`);
          if (ds.DataProvider) console.log(`  DataProvider: ${ds.DataProvider}`);
          console.log('');
        }
      } catch(e) {
        console.log(`Raw: ${body.slice(0, 2000)}`);
      }
    } else {
      console.log(`HTTP ${res.statusCode}`);
    }
  } catch(e) {
    console.log(`Error: ${e.message}`);
  }

  // =========================================
  // APPROACH 5: Try to get data model info
  // =========================================
  console.log('\n=== APPROACH 5: DataModels / DataSets ===');
  const extraEndpoints = [
    '/fm/api/v2.0/DataModels',
    '/fm/api/v2.0/DataSets',
    '/fm/api/v2.0/Discovered'
  ];
  for (const ep of extraEndpoints) {
    try {
      const res = await ntlmGet(BASE + ep);
      console.log(`\nGET ${ep}`);
      console.log(`  HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        let body = res.body.toString().slice(0, 2000);
        try {
          body = JSON.stringify(JSON.parse(body), null, 2).slice(0, 2000);
        } catch(e) {}
        console.log(`  ${body}`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
