const http = require('http');

// Try XMLA endpoint on the report server
const endpoints = [
  '/api/pbi-proxy/ReportServer/xmla',
  '/api/pbi-proxy/ReportServer/RSDS',
  '/api/pbi-proxy/ReportServer/RSDS/datasources',
  '/api/pbi-proxy/fm/api/v2.0/CatalogItems(5db4a340-56b5-4204-8d74-2d91ea49380c)/DataModel',
  '/api/pbi-proxy/fm/api/v2.0/CatalogItems(5db4a340-56b5-4204-8d74-2d91ea49380c)/Visuals',
];

(async () => {
  for (const ep of endpoints) {
    console.log(`\n=== ${ep} ===`);
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3001' + ep, { timeout: 10000 }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve({
            status: res.statusCode,
            type: res.headers['content-type'],
            body: d.slice(0, 500)
          }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      console.log('Status:', result.status);
      console.log('Type:', result.type);
      console.log('Body:', result.body);
    } catch(e) {
      console.log('Error:', e.message);
    }
  }
})();
