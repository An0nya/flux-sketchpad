// LC: the CPU driver's-eye still is skipped while the GPU drive view shows (LAZYCPU), and rendered on demand or when forced.
// Counts CPU renders with RF.SpecUI.cpuStillRenders(). Run: python3 tests/serve.py 8993, then
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/LC-lazy-cpu.js 8993
// Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8993);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => UX2Page.ready());
    await sleep(1500);
    // wait for the GPU drive view to come up
    let shown = false;
    for (let i = 0; i < 60 && !shown; i++) { await sleep(500); shown = await page.evaluate(() => { const V = RF.DriveAnim._.V; return !!(V.three && V.canvas && !V.canvas.hidden); }); }
    ok('GPU drive view is showing before the checks', shown);
    const toggle = (key) => page.evaluate(async (key) => { const u = RF.UI; u.dvOpts[key] = !u.dvOpts[key]; u.redrawSpec(); await new Promise((r) => setTimeout(r, 700)); }, key);
    const count = () => page.evaluate(() => RF.SpecUI.cpuStillRenders());
    const set = (patch) => page.evaluate((p) => { Object.assign(RF.UI.dvOpts, p); RF.UI.redrawSpec(); }, patch);
    // 1. GPU showing: option changes render no CPU still
    let c0 = await count();
    await toggle('people'); await toggle('wetSheen'); await toggle('people');
    let c1 = await count();
    ok('GPU showing: option changes render 0 CPU stills', c1 === c0, { before: c0, after: c1 });
    // 2. click probe path: ensureCpuStill renders exactly one, then the cached one is reused
    const probe = () => page.evaluate(() => { const s = RF.SpecUI.ensureCpuStill(RF.UI); return !!(s && s.res); });
    const p1 = await probe(); const c2 = await count();
    const p2 = await probe(); const c3 = await count();
    ok('click probe (ensureCpuStill) renders exactly one CPU still', p1 && c2 === c1 + 1, { before: c1, after: c2, ok: p1 });
    ok('a second ensureCpuStill reuses the still (no render)', p2 && c3 === c2, { before: c2, after: c3 });
    // 3. forced CPU still: every redraw renders
    await page.evaluate(() => { RF.SpecUI.forceCpuStill = true; });
    const c4 = await count(); await toggle('people'); const c5 = await count();
    ok('forceCpuStill true: the CPU still renders on the redraw', c5 === c4 + 1, { before: c4, after: c5 });
    await page.evaluate(() => { RF.SpecUI.forceCpuStill = false; });
    // 4. GPU renderer off: the CPU still renders as before
    await set({ gpuRenderer: false });
    const c6 = await count(); await toggle('people'); const c7 = await count();
    ok('gpuRenderer off: the CPU still renders', c7 === c6 + 1, { before: c6, after: c7 });
    await set({ gpuRenderer: true });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) { ok('LC page run completed', false, String(e && e.stack || e).slice(0, 400)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' LC checks passed');
  process.exitCode = fails ? 1 : 0;
})();
