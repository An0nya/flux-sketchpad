// shared by the G23-*.js tests (not a test itself): boot the page on a clean profile, collect console errors, helpers
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
exports.port = +(process.argv[2] || 8828);
let fails = 0; exports.ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
exports.fails = () => fails;
exports.boot = async function () {
  const browser = await pw.chromium.launch(), page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage(), errors = [], workers = new Set();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('worker', (w) => { workers.add(w); w.on('close', () => workers.delete(w)); });
  await page.goto('http://localhost:' + exports.port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 130000 });
  const st = () => page.evaluate(() => { const ui = RF.UI; return { solving: !!ui.solving, busy: !!RF.SolverHost.busy(), fail: !!document.getElementById('solve-fail'), failText: (document.getElementById('solve-fail') || {}).textContent || '', repSolver: ui.store.reports.A && ui.store.reports.A.solver && ui.store.reports.A.solver.id, notices: ui.store.notices.slice(0, 3).map((n) => n.msg.slice(0, 120)) }; });
  const start = (id, set) => page.evaluate(([id, set]) => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: set || {} }); ui.generateA(); }, [id, set]);
  const settled = (ms) => page.waitForFunction(() => !RF.UI.solving, null, { timeout: ms || 30000 }).then(() => true, () => false);
  const doneWith = (id, ms) => page.waitForFunction((id) => !RF.UI.solving && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id === id, id, { timeout: ms || 30000 }).then(() => true, () => false);   // the report is from that solver
  return { browser, page, errors, workers, st, start, settled, doneWith };
};
