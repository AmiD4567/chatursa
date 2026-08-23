const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect data responses
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('getVisuals') || url.includes('query') || url.includes('render') || url.includes('export')) {
      try {
        const text = await res.text();
        if (text.length < 50000) {
          console.log('DATA:', url.slice(0,120), text.slice(0,500));
        }
      } catch(e) {}
    }
  });

  // Try the PowerBIReport endpoint directly (this worked with curl for reports)
  const reportId = '5db4a340-56b5-4204-8d74-2d91ea49380c'; // 2025 report with OPT
  await page.goto('http://localhost:3001/api/pbi-proxy/ReportServer/PowerBIReport/' + reportId, { 
    waitUntil: 'networkidle', timeout: 60000 
  });

  console.log('PBI Report page loaded');
  await page.waitForTimeout(10000);

  // Check page content
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : 'no body');
  console.log('Body:', bodyText.slice(0, 3000));

  // Check all DOM elements with text
  const elements = await page.evaluate(() => {
    const result = [];
    const walker = document.createTreeWalker(document.body, 4, null, false);
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 1 && text.length < 200 && /[0-9]/.test(text)) {
        result.push(text.slice(0,100));
      }
    }
    return result.slice(0, 30);
  });
  console.log('Text elements with numbers:', JSON.stringify(elements, null, 2));

  await browser.close();
})();
