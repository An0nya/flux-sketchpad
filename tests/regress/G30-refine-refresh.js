// G30: the Refine button must be disabled as soon as a solve starts (canRefine is false then), and enabled again when it ends.
// node tests/regress/G30-refine-refresh.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8829);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 120000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  const b = () => page.evaluate(() => ({ disabled: document.getElementById('btn-refine').disabled, can: RF.UI.canRefine(), solving: !!RF.UI.solving }));
  await page.waitForTimeout(400);
  let s = await b(); ok('idle, finished run: Refine is enabled', !s.disabled && s.can, JSON.stringify(s));
  await page.evaluate(() => { RF.UI.store.scene.solve = { id: 'fill-fix' }; RF.UI.generateA(); });
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }); await page.waitForTimeout(300);
  s = await b(); ok('while a solve runs: Refine is disabled', s.disabled && !s.can && s.solving, JSON.stringify(s));
  await page.evaluate(() => RF.UI.stopSolve()); await page.waitForTimeout(600);
  s = await b(); ok('after Stop (design out of date): Refine stays disabled, matching canRefine', s.disabled === !s.can && !s.can, JSON.stringify(s));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
