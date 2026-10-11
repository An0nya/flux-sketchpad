// G08: Undo must not blank the reflector while the worker re-solve runs (and Stop must not leave it blank).
// node tests/regress/G08-undo-stop.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8823);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  await idle();
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  await page.evaluate(() => RF.UI.setMode('A')); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.4); await page.mouse.down(); await page.mouse.move(r.x + r.w * 0.7, r.y + r.h * 0.6, { steps: 40 }); await page.mouse.up();
  await idle();
  const snap = () => page.evaluate(() => ({ solving: !!RF.UI.solving, nA: RF.UI.store.scene.groups.A.surfaces.length, dirtyA: RF.UI.store.dirty.has('A'), past: RF.UI.hist.past.length }));
  const before = await snap(); ok('painted + solved: reflector present (' + before.nA + ' surfaces), an Undo entry exists', before.nA > 0 && before.past > 0);
  await page.click('#btn-undo');
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const mid = await snap();
  ok('while the re-solve runs the previous reflector is still there (' + mid.nA + ' surfaces)', mid.nA > 0);
  ok('and it is marked out of date (dirty A ' + mid.dirtyA + ')', mid.dirtyA);
  await page.click('#btn-stop'); await page.waitForTimeout(1500);
  const after = await snap();
  ok('after Stop the reflector is not empty (' + after.nA + ' surfaces)', after.nA > 0);
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
