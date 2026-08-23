const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';

  // Intercept ALL data responses
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('signalr') || url.includes('negotiate') || url.includes('send') || url.includes('invoke')) {
      try {
        const text = await res.text();
        console.log('SIGNALR:', url.slice(0,100), text.slice(0,300));
      } catch(e) {}
    }
  });

  await page.goto('http://localhost:3001/api/pbi-proxy/fm/report/view/' + reportId, { 
    waitUntil: 'networkidle', timeout: 60000 
  });
  
  console.log('Page loaded. Looking for iframe...');
  await page.waitForTimeout(3000);

  // Find the iframe element and get its src
  const iframeSrc = await page.evaluate(() => {
    const iframe = document.querySelector('iframe.viewer');
    return iframe ? iframe.src : 'not found';
  });
  console.log('Iframe src:', iframeSrc);

  // Try to access iframe content
  const frames = page.frames();
  console.log('All frames:', frames.length);
  for (const f of frames) {
    console.log('Frame:', f.url().slice(0,150));
  }

  // If we have an iframe, try to get its content
  if (frames.length > 1) {
    const reportFrame = frames[1];
    try {
      await reportFrame.waitForSelector('canvas', { timeout: 30000 });
      console.log('Canvas found in iframe!');
      
      // Try to extract text from the report
      const text = await reportFrame.evaluate(() => document.body.innerText);
      console.log('Report text:', text.slice(0, 3000));
      
      // Look for visual elements
      const visuals = await reportFrame.evaluate(() => {
        const all = [];
        document.querySelectorAll('*').forEach(el => {
          const text = el.textContent || '';
          const cls = el.className || '';
          if (typeof cls === 'string' && (text.length > 3 && text.length < 100)) {
            all.push(cls.slice(0,60) + '=' + text.trim().slice(0,80));
          }
        });
        return all.slice(0, 50);
      });
      console.log('Visual elements:', JSON.stringify(visuals, null, 2));
    } catch(e) {
      console.log('No canvas in iframe, error:', e.message);
    }
  }

  await browser.close();
})();
