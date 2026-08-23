const httpntlm = require('httpntlm');
const http = require('http');

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

function ntlmPost(url, body, contentType, accept) {
  return new Promise((resolve, reject) => {
    httpntlm.post({
      url, ...AUTH,
      headers: { 
        'Content-Type': contentType || 'text/xml; charset=utf-8',
        'Accept': accept || 'text/xml'
      },
      body
    }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function proxyGet(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3001' + path, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { 
          resolve({ statusCode: res.statusCode, body: d.slice(0, 2000) });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== DEEPER PBIRS DATA SOURCE RESEARCH ===\n');

  // =========================================
  // 1. Check OData $metadata for DataSources entity
  // =========================================
  console.log('--- 1. OData $metadata ---');
  try {
    const res = await ntlmGet(BASE + '/fm/api/v2.0/$metadata');
    if (res.statusCode === 200) {
      const body = res.body.toString();
      // Look for DataSource related entities
      const dsMatch = body.match(/<EntityType[^>]*Name="[^"]*Data[^"]*"[^>]*>[\s\S]*?<\/EntityType>/gi);
      if (dsMatch) {
        console.log('Found DataSource-related entity types:\n');
        for (const m of dsMatch) {
          console.log(m.slice(0, 2000));
          console.log('---');
        }
      } else {
        console.log('No DataSource entity types found in metadata');
        // Just print relevant parts
        const relevant = body.match(/<EntityType[^>]*>[\s\S]*?<\/EntityType>/g);
        if (relevant) {
          console.log('All entity types:');
          for (const r of relevant) {
            const name = r.match(/Name="([^"]+)"/);
            if (name) console.log('  ' + name[1]);
          }
        }
      }
    } else {
      console.log('HTTP', res.statusCode);
    }
  } catch(e) {
    console.log('Error:', e.message);
  }

  // =========================================
  // 2. Try DataSource endpoint with OData syntax
  // =========================================
  console.log('\n--- 2. DataSource OData queries ---');
  const odataTests = [
    '/fm/api/v2.0/DataSources',
    '/fm/api/v2.0/DataSources?$top=10',
    '/fm/api/v2.0/DataSources?$filter=Type eq \'OData\'',
    // OData navigation from catalog item
    `/fm/api/v2.0/CatalogItems('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataSources`,
    `/fm/api/v2.0/CatalogItems('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataSources?$expand=DataSource`,
  ];
  
  for (const ep of odataTests) {
    try {
      const res = await ntlmGet(BASE + ep);
      console.log(`GET ${ep}`);
      console.log(`  HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        let body = res.body.toString();
        try {
          const parsed = JSON.parse(body);
          body = JSON.stringify(parsed, null, 2);
        } catch(e) {}
        console.log(`  ${body.slice(0, 2000)}`);
      } else if (res.statusCode === 404) {
        console.log(`  404 Not Found`);
      } else {
        console.log(`  ${res.body.toString().slice(0, 300)}`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // =========================================
  // 3. Try Power BI specific endpoints
  // =========================================
  console.log('\n--- 3. Power BI specific endpoints ---');
  const pbEndpoints = [
    // Common PBIRS data source endpoints
    '/fm/api/v2.0/CatalogItems/5db4a340-56b5-4204-8d74-2d91ea49380c/DataSources',
    '/fm/api/v2.0/PowerBIReports/5db4a340-56b5-4204-8d74-2d91ea49380c/DataSources',
    '/fm/api/v2.0/PowerBIReports',
    '/fm/api/v2.0/PowerBIReports(\'5db4a340-56b5-4204-8d74-2d91ea49380c\')',
    '/fm/api/v2.0/PowerBIReports(\'5db4a340-56b5-4204-8d74-2d91ea49380c\')/DataSources',
    // Try different casing
    '/fm/api/v2.0/Datasources',
    '/fm/api/v2.0/Datasources(\'5db4a340-56b5-4204-8d74-2d91ea49380c\')',
    // V1 API
    '/fm/api/v1.0/CatalogItems/5db4a340-56b5-4204-8d74-2d91ea49380c/DataSources',
    '/fm/api/v1.0/DataSources',
    // OData different syntax
    '/fm/api/v2.0/DataSources?$filter=startswith(DataSourcePath,\'/\')',
  ];

  for (const ep of pbEndpoints) {
    try {
      const res = await ntlmGet(BASE + ep);
      console.log(`GET ${ep}`);
      console.log(`  HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        let body = res.body.toString();
        try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
        console.log(`  ${body.slice(0, 2000)}`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // =========================================
  // 4. Try SOAP at different URLs
  // =========================================
  console.log('\n--- 4. SOAP ReportService different URLs ---');
  const soapUrls = [
    BASE + '/ReportServer/ReportService2010.asmx',
    BASE + '/ReportServer/ReportService2005.asmx',
    BASE + '/ReportServer/ReportService2010.asmx?wsdl',
    BASE + '/ReportServer/ReportService2005.asmx?wsdl',
    BASE + '/Reports/ReportService2010.asmx',
  ];

  for (const url of soapUrls) {
    try {
      // First try GET to see what's there
      const res = await ntlmGet(url);
      console.log(`GET ${url}`);
      console.log(`  HTTP ${res.statusCode}, Content-Type: ${res.headers['content-type']}`);
      if (res.headers['content-type'] && res.headers['content-type'].includes('xml')) {
        console.log(`  Body(first 500): ${res.body.toString().slice(0, 500)}`);
      } else {
        console.log(`  Body(first 200): ${res.body.toString().slice(0, 200)}`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // =========================================
  // 5. Try SOAP with proper ListChildren
  // =========================================
  console.log('\n--- 5. SOAP ListChildren (refined) ---');
  
  const soapListChildren = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Body>
    <ListChildren xmlns="http://schemas.microsoft.com/sqlserver/reporting/2010/03/01/ReportServer">
      <ItemPath>/</ItemPath>
      <Recursive>true</Recursive>
    </ListChildren>
  </soap12:Body>
</soap12:Envelope>`;

  try {
    const res = await ntlmPost(
      BASE + '/ReportServer/ReportService2010.asmx',
      soapListChildren,
      'application/soap+xml; charset=utf-8',
      'application/soap+xml'
    );
    console.log(`SOAP POST (soap12) HTTP ${res.statusCode}`);
    console.log(`Content-Type: ${res.headers['content-type']}`);
    console.log(`Body(first 1000): ${res.body.toString().slice(0, 1000)}`);
  } catch(e) {
    console.log('SOAP12 Error:', e.message);
  }

  // Try text/xml variant with SOAP action
  const soapListChildren2 = `<?xml version="1.0" encoding="utf-8"?>
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
    const res = await new Promise((resolve, reject) => {
      httpntlm.post({
        url: BASE + '/ReportServer/ReportService2010.asmx',
        ...AUTH,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '"http://schemas.microsoft.com/sqlserver/reporting/2010/03/01/ReportServer/ListChildren"'
        },
        body: soapListChildren2
      }, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
    console.log(`\nSOAP POST (text/xml+SOAPAction) HTTP ${res.statusCode}`);
    console.log(`Content-Type: ${res.headers['content-type']}`);
    console.log(`Body(first 1000): ${res.body.toString().slice(0, 1000)}`);
  } catch(e) {
    console.log('SOAP text/xml Error:', e.message);
  }

  // =========================================
  // 6. Try to get the actual PBIX content and parse DataSources
  // =========================================
  console.log('\n--- 6. Attempt to get DataSource through Power BI API ---');
  // PBIRS exposes a special endpoint for getting the data sources of a PBIX report
  const dataSourceEndpoints = [
    // This is the actual API used by Power BI Report Server web portal
    `/fm/api/v2.0/CatalogItems('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataModel`,
    `/fm/report/api/v2.0/CatalogItems('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataSources`,
    // Try the Power BI specific data source API
    `/fm/_api/v2.0/PowerBIReports('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataSources`,
    `/fm/api/v2.0/CatalogItems('5db4a340-56b5-4204-8d74-2d91ea49380c')/DataSources`,
    // Try without quotes
    `/fm/api/v2.0/CatalogItems(5db4a340-56b5-4204-8d74-2d91ea49380c)/DataSources`,
  ];

  // First try through the proxy which might handle auth differently
  for (const ep of dataSourceEndpoints) {
    try {
      const res = await ntlmGet(BASE + ep);
      console.log(`GET ${ep}`);
      console.log(`  HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        let body = res.body.toString();
        try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
        console.log(`  ${body.slice(0, 3000)}`);
      }
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // =========================================
  // 7. Try the Report Server web service GET with parameters
  // =========================================
  console.log('\n--- 7. Report Server URL parameters ---');
  // The older Reporting Services URL access has a datasource parameter
  try {
    const res = await ntlmGet(BASE + '/ReportServer/ReportService2010.asmx?wsdl');
    if (res.statusCode === 200) {
      const body = res.body.toString();
      if (body.includes('wsdl') || body.includes('schema') || body.includes('definitions')) {
        console.log('WSDL retrieved successfully');
        // Save it for inspection
        require('fs').writeFileSync('C:\\ChatServer\\chat-app\\backend\\wsdl.xml', body);
        console.log(`WSDL length: ${body.length}`);
        // Check for ListChildren and GetItemDataSources operations
        const ops = body.match(/<wsdl:operation[^>]*>[\s\S]*?<\/wsdl:operation>/g);
        if (ops) {
          console.log('Operations:');
          for (const op of ops) {
            const name = op.match(/name="([^"]+)"/);
            if (name) console.log('  ' + name[1]);
          }
        }
      } else {
        console.log('Not a WSDL response:', body.slice(0, 300));
      }
    }
  } catch(e) {
    console.log('Error:', e.message);
  }

  console.log('\n=== RESEARCH COMPLETE ===');
}

main().catch(console.error);
