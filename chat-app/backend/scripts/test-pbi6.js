const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture ALL network responses
  const responses = [];
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json') || ct.includes('xml') || url.includes('api/v2.0') || 
        url.includes('getVisuals') || url.includes('query') || url.includes('export') ||
        url.includes('signalr')) {
      try {
        const text = await res.text();
        responses.push({ url: url.slice(0,150), type: ct, len: text.length, text: text.slice(0,200) });
      } catch(e) {}
    }
  });

  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';
  console.log('Opening portal page for report:', reportId);
  await page.goto('http://localhost:3001/api/pbi-proxy/fm/report/view/' + reportId, { 
    waitUntil: 'networkidle', timeout: 60000 
  });

  // Wait for report to render
  console.log('Portal loaded, waiting 15s for report render...');
  await page.waitForTimeout(15000);

  // Check if the iframe src changed
  const iframeInfo = await page.evaluate(() => {
    const iframe = document.querySelector('iframe.viewer');
    if (!iframe) return { found: false };
    return { src: iframe.src, title: iframe.title, id: iframe.id };
  });
  console.log('Iframe info:', JSON.stringify(iframeInfo, null, 2));

  // Check portal page content
  const portalText = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('Portal page text (first 2000):', portalText.slice(0,2000));

  // Check all iframes
  const frames = page.frames();
  console.log('Total frames:', frames.length);
  for (const f of frames) {
    console.log('  Frame:', f.url().slice(0,150));
  }

  // Check for any error messages
  const errorText = await page.evaluate(() => {
    const els = document.querySelectorAll('.error, .message, .alert, [class*=error], [class*=message]');
    return Array.from(els).map(e => e.textContent.trim().slice(0,100));
  });
  console.log('Error elements:', JSON.stringify(errorText));

  // Log all captured responses
  console.log('\n=== Captured data responses (' + responses.length + ') ===');
  for (const r of responses) {
    console.log(r.url, '[' + r.type + ']', r.len + 'B', 'text:', r.text);
  }

  // Also check for XHR requests in the page context
  const xhrLogs = await page.evaluate(() => {
    // Check if there's a global variable with report data
    const globals = Object.getOwnPropertyNames(window).filter(k => {
      try {
        const v = window[k];
        return v && typeof v !== 'function' && typeof v !== 'undefined';
      } catch(e) { return false; }
    });
    return { globals: globals.slice(0,20), href: window.location.href };
  });
  console.log('\nPage context:', JSON.stringify(xhrLogs, null, 2));

  await browser.close();
})();
