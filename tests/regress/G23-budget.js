// G23d: the solve budget (RF.SolverHost.testBudget stands in for the 120 s) still stops a solve with the timeout notice, even with
// a rebuild going on, and the next solve works.
// node tests/regress/G23-budget.js [port]
const T = require('./G23-boot.js'), ok = T.ok;
(async () => {
  const { browser, page, errors, st, start, settled, doneWith } = await T.boot();
  ok('page identifies as the flux app', await page.evaluate(() => !!(RF.UI && RF.SolverHost && RF.SolverHost.testBudget)));
  ok('default limit is the 120 s budget', await page.evaluate(() => RF.SolverHost.limitMs() === 120000 && RF.SolverHost.BUDGET.ms === 120000));
  await page.evaluate(() => RF.SolverHost.testBudget(2500));
  const t = Date.now(); await start('fill-fix');
  await page.waitForSelector('#solve-fail', { timeout: 30000 }).catch(() => {});
  const s = await st();
  ok('timeout notice shown', s.fail && /budget/.test(s.failText), s.failText.slice(0, 120));
  ok('it fired near the budget (2.5 s, within 8 s)', Date.now() - t < 8000, (Date.now() - t) + ' ms');
  // a Stop, then a solve that runs into the rebuild and the budget
  await start('fill-fix'); await page.waitForTimeout(800); await page.evaluate(() => RF.UI.stopSolve());
  await start('fill-fix');
  await page.waitForSelector('#solve-fail', { timeout: 30000 }).catch(() => {});
  ok('a solve queued behind the rebuild still times out with the notice', (await st()).fail && /budget/.test((await st()).failText), (await st()).failText.slice(0, 100));
  // a load arriving mid-solve must not take over the solve's budget timer: the solve is what times out
  await start('fill-fix'); await page.waitForTimeout(800);
  const ld = await page.evaluate(() => RF.SolverHost.load("RF.Solvers.register({ id: 'qa-b', name: 'QA b', version: '1', modes: ['paint'], settings: [], solve() { return { surfaces: [] }; } });").then(() => 'loaded', (e) => 'rejected: ' + e.message));
  await page.waitForSelector('#solve-fail', { timeout: 30000 }).catch(() => {});
  ok('a load during a budgeted solve succeeds', ld === 'loaded', ld);
  ok('and the solve still times out with the notice', (await st()).fail && /budget/.test((await st()).failText), (await st()).failText.slice(0, 100));
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  await start('patch-array');
  ok('the next solve completes', await doneWith('patch-array'), JSON.stringify(await st()));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(T.fails() ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
