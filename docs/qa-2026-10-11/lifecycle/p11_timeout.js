// forced timeout (testBudget) → notice + candidate; then: scene change → Use last candidate (should be refused); then a new solve works
const H = require('./h.js');
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  console.log('limitMs default', await page.evaluate(() => RF.SolverHost.limitMs()), 'BUDGET', await page.evaluate(() => RF.SolverHost.BUDGET.ms));
  await page.evaluate(() => RF.SolverHost.testBudget(2500));
  const t = Date.now(); await start('fill-fix');
  await page.waitForSelector('#solve-fail', { timeout: 30000 });
  const a = await st(); console.log('timeout after', Date.now() - t, 'ms', JSON.stringify(a));
  console.log('fail text:', await page.evaluate(() => document.getElementById('solve-fail').textContent));
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  // change a setting, then try the candidate
  const before = await page.evaluate(() => RF.UI.store.scene.groups.A.surfaces.length);
  await page.evaluate(() => RF.UI.setControl('A.budget', 10));
  await page.waitForTimeout(300);
  const stillBtn = await page.evaluate(() => !!document.getElementById('btn-use-candidate'));
  if (stillBtn) await page.click('#btn-use-candidate');
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => ({ cand: RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.candidate, n: RF.UI.store.scene.groups.A.surfaces.length, notice: RF.UI.store.notices[0].msg.slice(0, 200), budgetNow: RF.UI.store.scene.modeA.budget, settingsBudget: RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.settings && RF.UI.store.reports.A.solver.settings.budget }));
  console.log('btn still there after setting change:', stillBtn, 'surfaces before', before, JSON.stringify(b));
  // new solve after a timeout
  const t2 = Date.now(); await start('patch-array');
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 30000 }).then(() => console.log('next solve done in', Date.now() - t2, 'ms', JSON.stringify(st && 0))).catch(() => console.log('NEXT SOLVE HUNG'));
  console.log('rep', (await st()).repSolver, 'workers', workers.size, [...workers].map((w) => w.url().split('/').pop()).join(','), 'errors', errors);
  await browser.close();
})();
