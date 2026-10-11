// G23b: loading a solver file while a solve runs: the load succeeds AND the solve completes (or hits its own budget).
// node tests/regress/G23-load-during-solve.js [port]
const T = require('./G23-boot.js'), ok = T.ok;
const SRC = `RF.Solvers.register({ id: 'qa-ok', name: 'QA ok', version: '1', modes: ['paint'], settings: [], solve() { return { surfaces: [] }; } });`;
(async () => {
  const { browser, page, errors, st, start, settled } = await T.boot();
  ok('page identifies as the flux app', await page.evaluate(() => !!(RF.UI && RF.SolverHost)));
  await start('fill-fix'); await page.waitForTimeout(1500);
  ok('a solve is running', (await st()).solving);
  const res = await page.evaluate((src) => RF.SolverHost.load(src).then((d) => 'loaded ' + d.map((x) => x.id)).catch((e) => 'rejected: ' + e.message), SRC);
  ok('the load succeeded', res === 'loaded qa-ok', res);
  ok('the solve completed', await settled(60000), JSON.stringify(await st()));
  const s = await st();
  ok('the solve produced a report (not stopped)', s.repSolver === 'fill-fix' && !s.fail, JSON.stringify(s));
  ok('the loaded solver is registered', await page.evaluate(() => !!RF.Solvers.get('qa-ok')));
  // same, under a short budget: the solve (not the load) is what times out
  await page.evaluate(() => RF.SolverHost.testBudget(2500)); await start('fill-fix'); await page.waitForTimeout(1500);
  const res2 = await page.evaluate((src) => RF.SolverHost.load(src.replace('qa-ok', 'qa-ok2')).then((d) => 'loaded ' + d.map((x) => x.id)).catch((e) => 'rejected: ' + e.message), SRC);
  ok('the load succeeded under a budget', res2 === 'loaded qa-ok2', res2);
  await page.waitForSelector('#solve-fail', { timeout: 30000 }).catch(() => {});
  const s2 = await st();
  ok('the solve (not the load) hit the budget: timeout notice shown', s2.fail && /budget/.test(s2.failText), s2.failText.slice(0, 120));
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  ok('both loaded solvers survived the restart', await page.evaluate(() => !!RF.Solvers.get('qa-ok') && !!RF.Solvers.get('qa-ok2')));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(T.fails() ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
