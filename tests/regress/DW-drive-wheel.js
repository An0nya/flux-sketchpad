// DW: a mouse wheel over the in-page Drive display must not zoom or pan the heat view that the drive image is drawn through (owner: a free-spin wheel zoomed the
// drive image out and changed the frame time). Positive control: with a non-drive display the same wheel still zooms. Run:
//   python3 tests/serve.py <port> &  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/DW-drive-wheel.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const view = () => page.evaluate(() => { const v = RF.UI.vHeat; return { s: v.s, display: RF.UI.display }; });
    const spin = async () => {
      const c = await page.evaluate(() => { const r = document.getElementById('heat-canvas') ? document.getElementById('heat-canvas').getBoundingClientRect() : null; return r && r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; });
      if (!c) return false; await page.mouse.move(c[0], c[1]); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -300); await sleep(60); } await sleep(300); return true;
    };
    const d0 = await view(); ok('DW the drive display is showing', d0.display === 'drive', JSON.stringify(d0));
    const had = await spin(); ok('DW found the drive canvas to scroll over', had);
    const d1 = await view(); ok('DW wheel over the Drive display does not zoom the heat view', d1.s === d0.s, d0.s + ' -> ' + d1.s);
    await page.evaluate(() => RF.UI.setDisplay('hits')); await sleep(1200);
    const h0 = await view(); await spin(); const h1 = await view();
    ok('DW positive control: the same wheel zooms a non-drive display', h1.s !== h0.s, h0.display + ' ' + h0.s + ' -> ' + h1.s);
    ok('DW nothing throws', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' DW checks FAILED' : 'all DW checks passed'); process.exit(fails ? 1 : 0);
})();
