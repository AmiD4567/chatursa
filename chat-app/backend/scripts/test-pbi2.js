const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';

  // Collect all network responses
  const dataResponses = [];
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json') || url.includes('PowerBI') || url.includes('signalr') || url.includes('dataset')) {
      try {
        const text = await res.text();
        if (text.length > 50 && text.length < 100000) {
          dataResponses.push({ url: url.slice(0,150), text: text.slice(0,500) });
        }
      } catch(e) {}
    }
  });

  // Go directly to ReportViewer
  const reportUrl = 'http://localhost:3001/api/pbi-proxy/ReportServer/Pages/ReportViewer.aspx?%2Fview%2F' + reportId;
  console.log('Opening:', reportUrl);
  await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: 90000 });
  
  // Wait for report to render
  console.log('Waiting for report render...');
  await page.waitForTimeout(20000);
  
  // Check page content
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : 'no body');
  console.log('Body text length:', bodyText.length);
  console.log('Body text:', bodyText.slice(0, 2000));
  
  // Check visual elements
  const visualInfo = await page.evaluate(() => {
    const result = {};
    // Power BI creates specific DOM elements
    result.canvas = document.querySelectorAll('canvas').length;
    result.svg = document.querySelectorAll('svg').length;
    result.divs = [];
    // Look for visual containers
    document.querySelectorAll('*').forEach(el => {
      const cls = el.className || '';
      if (typeof cls === 'string' && (cls.includes('visual') || cls.includes('card') || cls.includes('kpi') || cls.includes('value'))) {
        result.divs.push(cls + ' text:' + (el.textContent || '').slice(0,60));
      }
    });
    return result;
  });
  console.log('Visuals:', JSON.stringify(visualInfo, null, 2));
  
  console.log('\n=== Data responses intercepted ===');
  dataResponses.forEach(r => {
    console.log('\nURL:', r.url);
    console.log('DATA:', r.text.slice(0,500));
  });
  
  await browser.close();
})();
