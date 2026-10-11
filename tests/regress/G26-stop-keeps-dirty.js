// G26: Stop / timeout / solver error must keep the design marked out of date (dirty A, Rebuild marker, no "up to date"),
// and a solver error must not replace the kept design's report.
// node tests/regress/G26-stop-keeps-dirty.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
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
  await page.evaluate(() => { RF.UI.store.scene.solve = { id: 'fill-fix' }; RF.UI.generateA(); });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.store.reports.A && RF.UI.store.reports.A.solver.id === 'fill-fix', null, { timeout: 90000 });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 });
  await page.evaluate(() => { window.__kept = RF.UI.store.reports.A; window.__keptN = RF.UI.store.scene.groups.A.surfaces.length; });
  const snap = () => page.evaluate(() => ({ solving: !!RF.UI.solving, dirtyA: RF.UI.store.dirty.has('A'), status: document.getElementById('run-state').textContent, stale: document.getElementById('btn-generate').classList.contains('stale'), keptRep: RF.UI.store.reports.A === window.__kept, nA: RF.UI.store.scene.groups.A.surfaces.length }));
  const edit = () => page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint, r = RF.UI.store.scene.target.res; for (let i = 0; i < p.length; i++) p[i] = 0; p[Math.floor(r / 2) * r + Math.floor(r / 2)] = 1; RF.UI.store.invalidate(['A']); RF.UI.afterChange(); });
  const settle = async () => { await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && !RF.UI.solveArmed, null, { timeout: 90000 }); await page.waitForTimeout(700); };

  // 1. Stop
  await edit(); await page.waitForFunction(() => RF.UI.solving, null, { timeout: 8000 }); await page.waitForTimeout(800);
  await page.click('#btn-stop'); await page.waitForTimeout(900);
  let s = await snap();
  ok('Stop: design stays marked out of date (dirty A)', s.dirtyA, JSON.stringify(s));
  ok('Stop: status does not say "up to date"', !/up to date/.test(s.status), s.status);
  ok('Stop: Rebuild button carries the stale marker', s.stale);
  ok('Stop: the kept design and report are untouched', s.keptRep && s.nA === await page.evaluate(() => window.__keptN));

  // 2. solver error (injected): the kept report must survive, the design stays out of date
  await page.evaluate(() => { window.__run = RF.Solvers.runAsync; RF.Solvers.runAsync = () => Promise.reject(new Error('boom (injected)')); });
  await edit(); await settle();
  s = await snap();
  ok('error: design stays marked out of date', s.dirtyA, JSON.stringify(s));
  ok('error: status does not say "up to date"', !/up to date/.test(s.status), s.status);
  ok('error: the kept design\'s report is not replaced by the error', s.keptRep, 'report is the kept one: ' + s.keptRep);
  ok('error: the failure is still told (notice / solve-fail)', await page.evaluate(() => !!document.getElementById('solve-fail') || RF.UI.store.notices.some((n) => /boom/.test(n.msg))));
  await page.evaluate(() => { RF.Solvers.runAsync = window.__run; });

  // 3. timeout
  await page.evaluate(() => RF.SolverHost.testBudget(1500));
  await edit(); await settle();
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  s = await snap();
  ok('timeout: design stays marked out of date', s.dirtyA, JSON.stringify(s));
  ok('timeout: status does not say "up to date"', !/up to date/.test(s.status), s.status);
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
