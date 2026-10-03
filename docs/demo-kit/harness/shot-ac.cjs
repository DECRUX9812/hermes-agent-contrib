const { chromium } = require('playwright-core');
const cam = process.argv[2] || 'exterior_hero';
const time = process.argv[3] || 'golden';
const out = process.argv[4] || `/tmp/ac-${cam}-${time}.png`;
const wait = parseInt(process.argv[5] || '6000');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bad = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.url()) });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[pg]', m.text().slice(0,200)) });
  await page.goto(`http://127.0.0.1:5199/?cam=${cam}&time=${time}&speed=4&auto=1`);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
  console.log('saved', out);
  console.log('HTTP>=400:', bad.length);
  bad.slice(0,10).forEach(u => console.log(' ', u));
  await browser.close();
})();
