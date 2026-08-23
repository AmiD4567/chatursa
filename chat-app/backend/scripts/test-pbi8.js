const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Get detailed info about the OPT reports
  await page.goto('http://localhost:3001/api/pbi-proxy/fm/api/v2.0/CatalogItems', { 
    waitUntil: 'networkidle', timeout: 30000 
  });
  
  const catalog = await page.evaluate(() => JSON.parse(document.body.innerText));
  
  for (const item of catalog.value) {
    if (item.Type === 'PowerBIReport' && (item.Name.includes('ОПТ') || item.Name.includes('ФРС') || item.Name.includes('Продажи'))) {
      // Get more details
      await page.goto(`http://localhost:3001/api/pbi-proxy/fm/api/v2.0/CatalogItems(${item.Id})`, {
        waitUntil: 'networkidle', timeout: 30000
      });
      const detail = await page.evaluate(() => JSON.parse(document.body.innerText));
      
      console.log('\n=== Report:', item.Name, '===');
      console.log('Id:', item.Id);
      console.log('Path:', item.Path);
      console.log('Type:', item.Type);
      console.log('Size:', detail.ContentSize || item.ContentSize, 'bytes');
      console.log('Modified:', detail.ModifiedDate || item.ModifiedDate);
      console.log('Created:', detail.CreatedDate || item.CreatedDate);
      console.log('Hidden:', detail.Hidden);
      console.log('ContentType:', detail.ContentType);
      
      // Get data sources
      await page.goto(`http://localhost:3001/api/pbi-proxy/fm/api/v2.0/DataSources(CatalogItemId=${item.Id})`, {
        waitUntil: 'networkidle', timeout: 30000
      });
      const dsText = await page.evaluate(() => document.body.innerText);
      console.log('DataSources:', dsText.slice(0, 500));
    }
  }

  await browser.close();
})();
