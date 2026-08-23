const http = require('http');
const httpntlm = require('httpntlm');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/pbi-proxy' + path, res => {
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
  // Get full catalog
  const catalog = await getJson('/fm/api/v2.0/CatalogItems');
  console.log('Total items:', catalog.value.length);
  
  for (const item of catalog.value) {
    console.log(item.Type.padEnd(30), (item.Name || '').slice(0,60));
  }
  
  // Look for datasets specifically
  const datasets = catalog.value.filter(i => i.Type === 'Dataset' || i.Type === 'Model' || i.Type === 'CrescendoPowerBIDataset');
  console.log('\nDatasets found:', datasets.length);
  for (const ds of datasets) {
    console.log('  ', ds.Name, ds.Path, ds.Id);
  }

  // Also try the /api/v2.0/Models endpoint
  try {
    const models = await getJson('/fm/api/v2.0/Models');
    console.log('\nModels:', JSON.stringify(models).slice(0,500));
  } catch(e) {
    // Not all PBIRS versions have Models endpoint
  }

  // Check if XMLA endpoint exists
  try {
    const directQuery = await getJson('/fm/api/v2.0/Discovered');
    console.log('\nDiscovered:', JSON.stringify(directQuery).slice(0,500));
  } catch(e) {}
})().catch(console.error);
