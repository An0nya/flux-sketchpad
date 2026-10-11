// shared harness: boot page on 8803, collect console errors + worker counts
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
exports.boot = async function (opts) {
  opts = opts || {};
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage(), errors = [], workers = new Set();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('worker', (w) => { workers.add(w); w.on('close', () => workers.delete(w)); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto('http://localhost:8803/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 130000 });
  const st = () => page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene, stop = document.getElementById('btn-stop');
    return { title: document.title, mode: sc.mode, solver: RF.Solvers.current(sc), solving: ui.solving && { seq: ui.solving.seq, name: ui.solving.name }, seq: ui.solveSeq, busy: RF.SolverHost.busy() && RF.SolverHost.busy().id,
      stopShown: stop ? !stop.hidden : null, bodySolving: document.body.classList.contains('solving'), status: document.getElementById('run-state').textContent, badge: [...document.querySelectorAll('.watch-badge')].filter((b) => !b.hidden).map((b) => b.textContent.slice(0, 50))[0] || null,
      dirtyA: ui.store.dirty.has('A'), pendingA: ui.pendingA, armed: ui.solveArmed, watch: ui.watch && { seq: ui.watch.seq, failed: !!ui.watch.failed, n: ui.watch.n },
      fail: !!document.getElementById('solve-fail'), notices: ui.store.notices.slice(0, 4).map((n) => n.msg.slice(0, 140)), repSolver: ui.store.reports.A && ui.store.reports.A.solver && ui.store.reports.A.solver.id,
      repErr: ui.store.reports.A && ui.store.reports.A.error, strip: document.getElementById('progress-strip').classList.contains('open'), runDone: ui.run && ui.run.ctx.done }; });
  const start = (id, set) => page.evaluate(([id, set]) => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: set || {} }); ui.generateA(); }, [id, set]);
  return { browser, page, errors, workers, st, start };
};
