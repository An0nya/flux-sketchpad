// G27: a scene / solver change must cancel the running worker solve (built-in solver chosen mid-solve, preset loaded mid-solve),
// and the superseded solve must not leave ui.pendingA behind (a later setting change would auto-solve with the switch off).
// node tests/regress/G27-cancel-solve.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
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
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  const startFill = async () => { await page.evaluate(() => { RF.UI.store.scene.solve = { id: 'fill-fix' }; RF.UI.generateA(); }); await page.waitForFunction(() => RF.UI.solving && RF.UI.watch && RF.UI.watch.msg, null, { timeout: 30000 }); };
  const info = () => page.evaluate(() => ({ solving: !!RF.UI.solving, busy: !!RF.SolverHost.busy(), shown: RF.UI.watchShown(), watch: !!RF.UI.watch, pendingA: RF.UI.pendingA, armed: RF.UI.solveArmed, dirtyA: RF.UI.store.dirty.has('A'), solver: RF.Solvers.current(RF.UI.store.scene) }));

  // 1. a built-in solver chosen mid-solve
  await startFill();
  await page.evaluate(() => { const s = document.querySelector('#solver-box select[aria-label=Solver]'); s.value = 'spoke'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  let s = await info();
  ok('built-in chosen mid-solve: the worker solve is cancelled', !s.solving && !s.busy, JSON.stringify(s));
  ok('built-in chosen mid-solve: no preview drawn over the new design', !s.shown && !s.watch, JSON.stringify(s));
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && !RF.UI.solveArmed, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  s = await info();
  ok('settled with no pending auto-solve left over (pendingA ' + s.pendingA + ')', !s.pendingA && !s.dirtyA, JSON.stringify(s));
  await page.evaluate(() => { window.__rep = RF.UI.store.reports.A; RF.UI.setControl('A.budget', 30); });
  await page.waitForTimeout(1500);
  ok('a setting change afterwards does not auto-solve (Auto-solve on settings is off)', await page.evaluate(() => window.__rep === RF.UI.store.reports.A && RF.UI.store.dirty.has('A') && !RF.UI.solving && !RF.UI.store.autoSet));

  // 2. a preset loaded mid-solve
  await page.evaluate(() => { RF.UI.store.scene.solverSettings = RF.UI.store.scene.solverSettings || {}; });
  await startFill();
  await page.evaluate(() => { const s = document.getElementById('preset-select'); s.value = 'parabola'; s.dispatchEvent(new Event('change')); document.querySelector('#preset-confirm button.primary').click(); });
  await page.waitForTimeout(800);
  s = await info();
  ok('preset loaded mid-solve: the old scene\'s solve is cancelled', !s.solving && !s.busy, JSON.stringify(s));
  ok('preset loaded mid-solve: its preview is not drawn over the new scene', !s.shown && !s.watch, JSON.stringify(s));
  await page.waitForTimeout(2500);
  ok('preset loaded mid-solve: the old solve never lands in the new scene (no solver report from fill-fix)', await page.evaluate(() => { const r = RF.UI.store.reports.A; return !(r && r.solver && r.solver.id === 'fill-fix'); }));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
