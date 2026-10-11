// G37: Optics has a view reset (button + double-click), like Scene's Reset view.
// node tests/regress/G37-optics-reset.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const open = async (browser, vp, setup) => { const page = await browser.newPage({ viewport: vp || { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  if (setup) await page.addInitScript(setup);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => !!(RF.UI && RF.UI.layout)))) throw new Error('not the Flux page'); return page; };

(async () => {
  const browser = await pw.chromium.launch(); const page = await open(browser, null, () => { try { localStorage.setItem('flux/idleOrbit', '6'); localStorage.setItem('flux/turntable', '1'); } catch (e) { /* ignore */ } });
  await page.evaluate(() => { RF.UI.orbitFirst = false; }); await page.waitForTimeout(300);   // no turntable running while we measure
  const cam = () => page.evaluate(() => { const c = RF.UI.camS; return { s: +c.scale.toFixed(3), um: c.userMoved, pan: c.pan.map((v) => Math.round(v)), r: c.R.map((r) => r.map((v) => +v.toFixed(2))).join() }; });
  const orbit = async () => { const b = await page.locator('#surface-canvas').boundingBox();
    await page.mouse.move(b.x + 20, b.y + b.height - 20); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + b.height - 60, { steps: 6 }); await page.mouse.up();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200); await page.waitForTimeout(400); return b; };
  const home = await page.evaluate(() => new RF.Render.Camera(193.8, 19.3).R.map((r) => r.map((v) => +v.toFixed(2))).join());
  ok('Optics has a reset button', (await page.locator('.optics-pane #btn-optics-reset').count()) === 1);
  let b = await orbit(); const moved = await cam();
  ok('orbit + zoom moved the view', moved.um && moved.r !== home, JSON.stringify(moved));
  await page.click('#btn-optics-reset', { timeout: 3000 }).catch(() => ok('the button can be clicked', false)); await page.waitForTimeout(400);
  let c = await cam(); ok('the button restores the opening view (angle, userMoved)', !c.um && c.r === home && c.s !== moved.s, JSON.stringify(c) + ' vs ' + home); const ref = c;
  await orbit(); b = await page.locator('#surface-canvas').boundingBox();
  await page.mouse.dblclick(b.x + 15, b.y + 60); await page.waitForTimeout(400);
  c = await cam(); ok('double-click restores it too', !c.um && c.s === ref.s && c.r === ref.r, JSON.stringify(c));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
