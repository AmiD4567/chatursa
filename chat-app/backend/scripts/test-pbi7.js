const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // First find the actual path from REST API
  await page.goto('http://localhost:3001/api/pbi-proxy/fm/api/v2.0/CatalogItems', { 
    waitUntil: 'networkidle', timeout: 30000 
  });
  
  const catalog = await page.evaluate(() => JSON.parse(document.body.innerText));
  console.log('Catalog total:', catalog.value.length);
  for (const item of catalog.value) {
    if (item.Type === 'PowerBIReport' && item.Name.includes('ОПТ')) {
      console.log('FOUND:', item.Name, 'Path:', item.Path, 'Id:', item.Id);
    }
  }

  // Now try the actual path in ReportViewer
  for (const item of catalog.value) {
    if (item.Type === 'PowerBIReport' && item.Name.includes('ОПТ')) {
      console.log('\nReport:', item.Name);
      console.log('Actual path:', item.Path);
      console.log('Id:', item.Id);
      
      // Try to use the actual path in the ReportViewer
      const encodedPath = encodeURIComponent(item.Path);
      await page.goto('http://localhost:3001/api/pbi-proxy/ReportServer/Pages/ReportViewer.aspx?' + item.Path + '&rc:showbackbutton=true', {
        waitUntil: 'networkidle', timeout: 30000 
      });
      const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
      console.log('Direct path result:', bodyText.slice(0, 200));

      // Try with the actual path + rs:Command=Render
      await page.goto('http://localhost:3001/api/pbi-proxy/ReportServer?' + encodeURIComponent(item.Path) + '&rs:Command=Render&rs:Format=MHTML', {
        waitUntil: 'networkidle', timeout: 30000 
      });
      const bodyText2 = await page.evaluate(() => document.body ? document.body.innerText : '');
      console.log('Render result (first 200):', bodyText2.slice(0, 200));
    }
  }

  await browser.close();
})();
