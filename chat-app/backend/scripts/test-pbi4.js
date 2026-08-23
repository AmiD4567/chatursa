const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const reportId = 'c78c27f6-34da-4f52-81c6-29a64dbdf5c4';
  await page.goto('http://localhost:3001/api/pbi-proxy/fm/report/view/' + reportId, { 
    waitUntil: 'networkidle', timeout: 60000 
  });
  
  await page.waitForTimeout(5000);

  // Get the iframe content
  const frames = page.frames();
  console.log('Frames:', frames.length);
  
  if (frames.length > 1) {
    const reportFrame = frames[1];
    const frameUrl = reportFrame.url();
    console.log('Frame URL:', frameUrl);
    
    // Get iframe body content
    const frameContent = await reportFrame.evaluate(() => {
      return { 
        title: document.title,
        bodyText: document.body ? document.body.innerText : 'no body',
        html: document.body ? document.body.innerHTML.slice(0, 3000) : 'no body'
      };
    });
    console.log('Frame title:', frameContent.title);
    console.log('Frame body:', frameContent.bodyText.slice(0, 2000));
    console.log('Frame HTML:', frameContent.html.slice(0, 1000));
  }

  await browser.close();
})();
