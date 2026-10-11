// G23a: two solve requests during the ~1 s worker rebuild after a Stop must both settle (the second one completes).
// node tests/regress/G23-rebuild-race.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const T = require('./G23-boot.js'), ok = T.ok;
(async () => {
  const { browser, page, errors, st, start, settled, doneWith } = await T.boot();
  ok('page identifies as the flux app', await page.evaluate(() => !!(RF.UI && RF.SolverHost && RF.Solvers.get('fill-fix'))));
  await start('fill-fix'); await page.waitForTimeout(1200);
  await page.evaluate(() => RF.UI.stopSolve());
  await start('fill-fix'); await page.waitForTimeout(120);        // the first request waits for the rebuild
  await start('patch-array');                                      // the second one replaces it, still inside the rebuild
  const done = await doneWith('patch-array'), s = await st();
  ok('both requests settled (not solving 30 s later)', done, JSON.stringify(s));
  ok('the second solve completed (report is from patch-array)', s.repSolver === 'patch-array', 'repSolver ' + s.repSolver);
  // direct API: a solve, Stop, a solve queued behind the rebuild, a second Stop d ms later (while the rebuild is loading), then a solve
  const res = await page.evaluate(async () => {
    const sc = RF.UI.store.scene, inp = RF.Solvers.inputOf(sc), tm = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG'), ms))]);
    const solve = (id) => RF.Solvers.get(id).solve(inp, RF.Solvers.settingsOf(sc, id), { scene: sc }).then(() => 'ok', (e) => 'rejected ' + (e.kind || e.message));
    const out = [];
    for (const d of [0, 15, 40, 80, 150]) {
      const a = solve('fill-fix'); await new Promise((r) => setTimeout(r, 400));
      RF.SolverHost.abort('stop 1', 'user'); const ra = await tm(a, 3000);
      const b = solve('fill-fix'); await new Promise((r) => setTimeout(r, d));
      RF.SolverHost.abort('stop 2', 'replaced'); const rb = await tm(b, 3000);
      const rc = await tm(solve('patch-array'), 20000);
      out.push({ d, ra, rb, rc });
    }
    return out;
  });
  console.log('  ' + JSON.stringify(res));
  ok('every solve queued behind a rebuild settles', res.every((r) => r.ra !== 'HUNG' && r.rb !== 'HUNG'));
  ok('a solve after two stops completes, at every delay', res.every((r) => r.rc === 'ok'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(T.fails() ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
