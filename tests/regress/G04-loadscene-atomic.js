// G04 (ui half): a scene that fails to load must not replace the live store (all-or-nothing), and must not cancel the running solve.
// node tests/regress/G04-loadscene-atomic.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
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
  await page.evaluate(() => { window.__store = RF.UI.store; window.__mode = RF.UI.store.scene.mode; RF.UI.store.scene.solve = { id: 'fill-fix' }; RF.UI.generateA(); });
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 });
  const r = await page.evaluate(() => { const bad = RF.State.defaultScene(); bad.mode = 'Z'; let threw = false; try { RF.UI.loadScene(bad, 'bad'); } catch (e) { threw = true; } return { threw, same: RF.UI.store === window.__store, solving: !!RF.UI.solving, mode: RF.UI.store.scene.mode, body: document.body.className }; });
  ok('a scene that fails to load throws', r.threw, JSON.stringify(r));
  ok('and the live store is still the old one', r.same, JSON.stringify(r));
  ok('and the running solve was not cancelled', r.solving, JSON.stringify(r));
  ok('and the old mode is still shown (body class mode-' + r.mode + ')', new RegExp('mode-' + r.mode).test(r.body) && !/mode-Z/.test(r.body), r.body);
  await page.evaluate(() => RF.UI.stopSolve());
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
