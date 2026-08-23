const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture script resources
  const scripts = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.endsWith('.js') || url.endsWith('.html') || url.includes('powerbi')) {
      try {
        const text = await res.text();
        scripts.push({ url: url.slice(0,150), len: text.length, snippet: text.slice(0,300) });
        if (url.includes('powerbi') || url.includes('report')) {
          console.log('SCRIPT:', url.slice(0,150));
          console.log('  snippet:', text.slice(0,400));
        }
      } catch(e) {}
    }
  });

  await page.goto('http://localhost:3001/api/pbi-proxy/fm/report/view/' + 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4', { 
    waitUntil: 'networkidle', timeout: 60000 
  });
  await page.waitForTimeout(5000);
  await browser.close();
  
  console.log('\n=== Captured scripts ===');
  for (const s of scripts) {
    console.log(s.url, s.len + 'B');
  }
})();
