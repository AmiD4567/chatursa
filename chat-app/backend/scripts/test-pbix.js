const http = require('http');

async function getReportContent(reportId, reportName) {
  // Try different content endpoints
  const endpoints = [
    `/api/pbi-proxy/fm/api/v2.0/CatalogItems(${reportId})/Content/$value`,
    `/api/pbi-proxy/fm/api/v2.0/CatalogItems(${reportId})/Content`,
    `/api/pbi-proxy/ReportServer/${encodeURIComponent(reportId)}/Download`,
  ];

  for (const ep of endpoints) {
    console.log(`\nTrying: ${ep}`);
    try {
      const result = await new Promise((resolve, reject) => {
        http.get('http://localhost:3001' + ep, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              type: res.headers['content-type'],
              length: res.headers['content-length'],
              disposition: res.headers['content-disposition'],
              bytes: buf.length,
              firstHex: buf.length > 0 ? buf.slice(0, 20).toString('hex') : '',
              firstChars: buf.length > 0 ? buf.slice(0, 200).toString('utf8') : ''
            });
          });
        }).on('error', reject);
      });
      console.log('  Status:', result.status);
      console.log('  Type:', result.type);
      console.log('  Length:', result.length);
      console.log('  Bytes:', result.bytes);
      console.log('  Hex:', result.firstHex);
      console.log('  Text:', result.firstChars);
      if (result.bytes > 0 && result.type?.includes('zip') || result.firstHex.startsWith('504b')) {
        console.log('  *** THIS IS A ZIP/PBIX FILE! ***');
      }
    } catch(e) {
      console.log('  Error:', e.message);
    }
  }
}

// Test with OPT 2025 and OPT 2026
(async () => {
  console.log('=== OPT/Retail/FRS 2025 (5db4a340) ===');
  await getReportContent('5db4a340-56b5-4204-8d74-2d91ea49380c', 'OPT 2025');
  
  console.log('\n\n=== OPT/Retail/FRS 2026 (c78c27f6) ===');
  await getReportContent('c78c27f6-34da-4f52-81c6-29a64dbdf5c4', 'OPT 2026');
  
  console.log('\n\n=== Sales 2025 (ecd8a8a1) ===');
  await getReportContent('ecd8a8a1-5739-4226-8d97-e3b5a6f50a0b', 'Sales 2025');
})();
