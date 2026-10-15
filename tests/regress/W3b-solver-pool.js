// W3b: solver threads (tools.pool) in the real page: the same design for 0 and 3 threads, the pool really ran (no traces on the solve worker's own count),
// the Advanced settings exist and are remembered, and the background-tone setting is off by default.
// node tests/regress/W3b-solver-pool.js [port]   (needs: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8729);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading() && RF.Solvers.get('dish-fit-auto'), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  const where = await page.evaluate(() => ({ ui: !!RF.UI, port: location.port })); if (!where.ui || +where.port !== port) throw new Error('wrong page ' + JSON.stringify(where));
  const solve = (threads) => page.evaluate(async (th) => {
    RF.SolverHost.setThreads(th); RF.GpuTrace && RF.GpuTrace.setPref(false);   // W3c: dish-fit-auto traces on the GPU by default; this test is about the pool and CPU traces
    const sc = RF.State.defaultScene(); sc.modeA.budget = 40; sc.solve = { id: 'dish-fit-auto' }; sc.solverSettings = { 'dish-fit-auto': { rays: 60000, trials: 8 } };
    const r = await RF.Solvers.runAsync(sc, 'dish-fit-auto'), s = JSON.stringify(r.output.surfaces); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    const st = RF.SolverHost.lastStats(); return { hash: h >>> 0, placed: r.facts.placed, errors: r.facts.errors, traces: st.traces, rays: st.raysUsed };
  }, threads);
  const a = await solve(0), b = await solve(3);
  ok('solve with 0 threads places facets and traces on the solve worker', a.placed > 0 && !a.errors.length && a.traces > 0, JSON.stringify(a));
  ok('solve with 3 threads: same surfaces as with 0', a.hash === b.hash && a.placed === b.placed, a.hash + ' vs ' + b.hash);
  ok('solve with 3 threads: the work ran in the pool (no traces on the worker itself, rays still counted)', b.traces <= 1 && b.rays > 0, JSON.stringify(b));
  const ui = await page.evaluate(() => { const sel = document.querySelector('select[aria-label="Solver threads"]'); const lab = [...document.querySelectorAll('label.tog')].find((l) => /background tab/.test(l.textContent));
    return { sel: !!sel, val: sel && sel.value, keep: !!lab, keepOn: !!(lab && lab.querySelector('input').checked), stored: localStorage.getItem('flux/solverThreads'), keepStored: localStorage.getItem('flux/solveKeepAwake') }; });
  ok('Simulation → Advanced has Solver threads (remembered) and the background-tone box (off by default)', ui.sel && ui.keep && !ui.keepOn && ui.stored === '3' && !+ui.keepStored, JSON.stringify(ui));
  await page.evaluate(() => RF.SolverHost.setThreads(0));
  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
