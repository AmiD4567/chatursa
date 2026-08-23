const http = require('http');

// Try to download PBIX content from the REST API
const reportId = '5db4a340-56b5-4204-8d74-2d91ea49380c'; // OPT 2025

const opts = new URL('http://localhost:3001/api/pbi-proxy/fm/api/v2.0/CatalogItems(' + reportId + ')/Content');
opts.headers = { 'Accept': 'application/octet-stream' };

http.get(opts, res => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  console.log('Content-Length:', res.headers['content-length']);
  console.log('Content-Disposition:', res.headers['content-disposition']);
  
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    console.log('Received bytes:', buf.length);
    
    // Check if it's a ZIP file
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      console.log('This is a ZIP file (PBIX)');
      // Try to list ZIP contents without extracting (look for key files)
      console.log('First 100 hex:', buf.slice(0, 100).toString('hex'));
    } else {
      // Print first bytes as hex
      console.log('First 100 hex:', buf.slice(0, 100).toString('hex'));
      console.log('First 200 chars:', buf.slice(0, 200).toString('utf8'));
    }
  });
}).on('error', console.error);
