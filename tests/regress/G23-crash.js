// G23c: a forced worker crash fails the in-flight solve, then the next solve works (bundled + loaded solvers restored).
// node tests/regress/G23-crash.js [port]
const T = require('./G23-boot.js'), ok = T.ok;
const SRC = `
RF.Solvers.register({ id: 'qa-async-crash', name: 'QA async crash', version: '1', modes: ['paint'], settings: [], solve() { setTimeout(() => { throw new Error('qa async boom'); }, 50); return new Promise(() => {}); } });
RF.Solvers.register({ id: 'qa-ok', name: 'QA ok', version: '1', modes: ['paint'], settings: [], solve() { return { surfaces: [] }; } });`;
(async () => {
  const { browser, page, errors, workers, st, start, settled, doneWith } = await T.boot();
  ok('page identifies as the flux app', await page.evaluate(() => !!(RF.UI && RF.SolverHost)));
  await page.evaluate((src) => RF.SolverHost.load(src), SRC);
  const w0 = workers.size;                                  // solver worker + the page's own trace worker(s)
  const kinds = await page.evaluate(() => {
    const sc = RF.UI.store.scene, inp = RF.Solvers.inputOf(sc), out = {};
    const tm = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG'), 8000))]);
    const run = (id) => tm(RF.Solvers.get(id).solve(inp, {}, { scene: sc })).then((v) => v === 'HUNG' ? 'HUNG' : 'ok', (e) => (e.kind || 'err') + ':' + e.message.slice(0, 60));
    return run('qa-async-crash');
  });
  ok('the crashed solve rejects with kind crash', /^crash:/.test(kinds), kinds);
  const after = await page.evaluate(() => { const sc = RF.UI.store.scene, inp = RF.Solvers.inputOf(sc); return Promise.race([RF.Solvers.get('qa-ok').solve(inp, {}, { scene: sc }), new Promise((r) => setTimeout(() => r('HUNG'), 20000))]).then((v) => v === 'HUNG' ? 'HUNG' : 'ok', (e) => (e.kind || 'err') + ':' + e.message.slice(0, 80)); });
  ok('a LOADED solver works after the crash (sources restored)', after === 'ok', after);
  await start('patch-array');
  ok('a bundled solver solves after the crash', await doneWith('patch-array'), JSON.stringify(await st()));
  ok('host is idle and no worker leaked', !(await st()).busy && workers.size === w0, 'workers ' + workers.size + ' (before the crash ' + w0 + ')');
  ok('no page errors besides the worker crash', errors.filter((e) => !/qa async boom/.test(e)).length === 0, errors.join(' | '));
  await browser.close(); process.exit(T.fails() ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
