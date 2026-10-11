// L04: an expanded Editor / Result map may grow bigger than its partner; un-expanding restores the shared size.
// node tests/regress/L04-expand-map-size.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identifies as Flux', await page.evaluate(() => !!(RF.UI && RF.UI.vHeat)));
  const sizes = () => page.evaluate(() => ({ l: +RF.UI.vLeft.s.toFixed(3), h: +RF.UI.vHeat.s.toFixed(3), cap: RF.UI.vHeat.cap, exp: RF.UI.layout.expanded }));
  await page.waitForTimeout(800); const a = await sizes();
  ok('side by side: the two maps share one scale', Math.abs(a.l - a.h) < 1e-6 && a.cap > 0, JSON.stringify(a));
  await page.evaluate(() => RF.UI.setPane('result', 'expand')); await page.waitForTimeout(1200);
  const b = await sizes();
  ok('Result expanded: it draws bigger than the Editor map', b.h > b.l * 1.1 && b.cap === 0, JSON.stringify(b));
  await page.evaluate(() => RF.UI.setPane('result', 'expand')); await page.waitForTimeout(1200);
  const c = await sizes();
  ok('un-expanded: shared scale restored', Math.abs(c.l - c.h) < 1e-6 && c.cap > 0 && Math.abs(c.h - a.h) < 1e-3, JSON.stringify(c));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
