// SB1 page checks: lane studs are placed on every scene (open road, forest, city, mountain pass), the studs toggle is enabled on every
// scene, and the drive view draws without page errors on each. The count comes from the page's own world builder (tileWorld at the
// current frame's parameters), not from pixels.
// Run: PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SB1-studs-everywhere.js 8991   (server: python3 tests/serve.py 8991)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage(), errors = [], checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
  await page.evaluate(() => UX2Page.ready());
  const scenes = [['road', false], ['forest', false], ['city', false], ['road', true]];
  for (const [scene, pass] of scenes) {
    const name = pass ? 'pass' : scene;
    await page.evaluate(([s, mp]) => { RF.UI.dvOpts.scene = s; RF.UI.dvOpts.mountainPass = mp; RF.UI.dvOpts.rpm = true; RF.UI.redrawSpec(); }, [scene, pass]);
    await sleep(2500);
    const r = await page.evaluate(() => {
      const V = RF.DriveAnim._.V, btn = document.querySelector('[data-anim="c-rpm"]');
      const world = V.p && V.p.src ? RF.DriveAnim.tileWorld(V.p, 95, 2) : null;
      return { studs: world ? world.objects.filter(o => o.cls === 'rpm').length : -1, toggleDisabled: btn ? btn.disabled : 'missing', pressed: btn ? btn.getAttribute('aria-pressed') : 'missing' };
    });
    ok('SB1 ' + name + ': studs placed on the page (count at 95 m) ' + r.studs, r.studs > 0, JSON.stringify(r));
    ok('SB1 ' + name + ': studs toggle enabled', r.toggleDisabled === false, 'disabled=' + r.toggleDisabled);
  }
  ok('SB1 no page errors across the four scenes', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
  await context.close(); await browser.close();
  let fails = 0;
  for (const c of checks) { console.log((c.pass ? '[PASS] ' : '[FAIL] ') + c.name + (c.detail ? ' — ' + c.detail : '')); if (!c.pass) fails++; }
  console.log(JSON.stringify({ checks: checks.map(c => ({ name: c.name, pass: c.pass })), pass: fails === 0 }));
  if (fails) process.exitCode = 1;
}
run().catch(e => { console.error('[FAIL] SB1 page run threw: ' + e.stack); process.exitCode = 1; });
