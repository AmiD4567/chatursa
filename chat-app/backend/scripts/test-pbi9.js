const http = require('http');
const URL = require('url');

function getJson(path) {
  return new Promise((resolve, reject) => {
    const opts = URL.parse('http://localhost:3001' + path);
    opts.headers = { 'Accept': 'application/json' };
    http.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error(d.slice(0,200))); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const catalog = await getJson('/api/pbi-proxy/fm/api/v2.0/CatalogItems');
  
  for (const item of catalog.value) {
    if (item.Type !== 'PowerBIReport') continue;
    console.log('\n=== ' + item.Name + ' ===');
    console.log('  Id:', item.Id);
    console.log('  Path:', item.Path);
    console.log('  Size:', item.ContentSize, 'bytes');
    
    // This might not exist - try and ignore errors
    try {
      const ds = await getJson('/api/pbi-proxy/fm/api/v2.0/DataSources(CatalogItemId=' + item.Id + ')');
      console.log('  DataSources:', JSON.stringify(ds));
    } catch(e) {
      // Try alternative data source endpoint
      try {
        const ds = await getJson('/api/pbi-proxy/fm/api/v2.0/CatalogItems(' + item.Id + ')/DataSources');
        console.log('  DataSources (alt):', JSON.stringify(ds));
      } catch(e2) {
        console.log('  DataSources: not available via REST');
      }
    }
  }
})().catch(console.error);
