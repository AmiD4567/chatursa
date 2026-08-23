const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('embed') || url.includes('PowerBIReport') || url.includes('report')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('html') || ct.includes('json')) {
          const text = await res.text();
          console.log('RESP', url.slice(0,120), '|', text.slice(0,200));
        }
      } catch(e) {}
    }
  });

  await page.goto('http://localhost:3001/api/pbi-proxy/fm/report/view/' + reportId, { 
    waitUntil: 'networkidle', timeout: 60000 
  });

  await page.waitForTimeout(5000);
  const html = await page.content();
  console.log('HTML length:', html.length);
  
  // Find iframe
  const iframes = html.match(/<iframe[^>]*/gi);
  if (iframes) {
    console.log('Iframes found:', iframes.length);
    iframes.forEach(f => console.log('  ', f.slice(0,150)));
  }
  
  await browser.close();
})();
