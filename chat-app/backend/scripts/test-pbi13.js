const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Try ReportServer/PowerBIReport/{id} directly
  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';
  
  // First open the portal to get auth cookies
  console.log('Step 1: Opening portal...');
  await page.goto('http://localhost:3001/api/pbi-proxy/fm/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Now try PowerBIReport endpoint with cookies
  console.log('\nStep 2: Opening PowerBIReport...');
  await page.goto('http://localhost:3001/api/pbi-proxy/ReportServer/PowerBIReport/' + reportId, { 
    waitUntil: 'networkidle', timeout: 30000 
  });
  
  const text1 = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('Result:', text1.slice(0, 500));
  
  // Check for iframes
  console.log('Frames:', page.frames().length);
  for (const f of page.frames()) {
    console.log('  Frame:', f.url().slice(0,150));
  }
  
  // Try the old Power BI report viewer URL
  console.log('\nStep 3: Trying ReportViewer with actual path...');
  const path = '/Фабрика Мороженого/Производство и продажи/Производство-Продажи ОПТ-Сторонняя Розница-ФРС 2026';
  const encodedPath = path.split('/').map(s => encodeURIComponent(s)).join('/');
  await page.goto('http://localhost:3001/api/pbi-proxy/ReportServer/Pages/ReportViewer.aspx?' + encodedPath.slice(1), { 
    waitUntil: 'networkidle', timeout: 30000 
  });
  
  const text2 = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('Result:', text2.slice(0, 500));

  await browser.close();
})();
