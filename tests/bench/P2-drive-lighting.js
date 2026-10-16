// Tester: python3 tests/serve.py 8784; node tests/bench/P2-drive-lighting.js 8784
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright'), port = +(process.argv[2] || 8784);
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(String(e))); await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate(txt => RF.UI.loadScene(RF.State.deserialize(txt), 'P2 bench'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/p2-drive-lighting-page.js' }); console.log(JSON.stringify({ errors, ...await page.evaluate(() => P2Page.bench()) }));
    process.exitCode = errors.length ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
