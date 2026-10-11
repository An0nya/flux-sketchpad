// G28: pressing Rebuild while the bundled solvers are still loading must wait for them, not switch the scene to the built-in Spoke.
// node tests/regress/G28-rebuild-while-loading.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8829);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/solvers/*.js', async (r) => { await new Promise((done) => setTimeout(done, 80)); r.continue(); });   // keep the loading window open
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.route('**/solvers/*.js', async (r) => { await new Promise((done) => setTimeout(done, 80)); r.continue(); });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && document.getElementById('btn-generate-top'), null, { timeout: 30000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  const a = await page.evaluate(() => ({ loading: RF.SolverHost.loading(), wanted: RF.Solvers.wanted(RF.UI.store.scene), have: !!RF.Solvers.get(RF.Solvers.wanted(RF.UI.store.scene)) }));
  ok('precondition: bundle still loading and the wanted solver not registered yet', a.loading && !a.have, JSON.stringify(a));
  await page.click('#btn-generate-top');
  await page.waitForFunction(() => !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.solveArmed && !RF.UI.pendingA, null, { timeout: 120000 });
  const b = await page.evaluate(() => ({ scSolve: RF.UI.store.scene.solve && RF.UI.store.scene.solve.id, rep: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, dropdown: document.querySelector('#solver-box select[aria-label=Solver]').value, nA: RF.UI.store.scene.groups.A.surfaces.length }));
  ok('the scene keeps the wanted solver (' + a.wanted + '), not Spoke', b.scSolve !== 'spoke' && b.dropdown !== 'spoke' && b.rep !== 'spoke', JSON.stringify(b));
  ok('and the Rebuild ran once the solvers arrived (a design exists)', b.nA > 0, JSON.stringify(b));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
