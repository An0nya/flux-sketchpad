const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id: 'tir-array-v2' }; sc.solverSettings = Object.assign({}, sc.solverSettings, { 'tir-array-v2': { calib: 1, calibRays: 100000 } }); ui.generateA(); });
    const started = await page.waitForFunction(() => RF.UI.solving, null, { timeout: 30000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    const mid = await page.evaluate(() => ({ busy: RF.SolverHost.busy() && RF.SolverHost.busy().id }));
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id: 'auto' }; ui.generateA(); });
    await page.waitForTimeout(300);
    const t = Date.now();
    await page.waitForFunction(() => !RF.UI.solving && !RF.UI.solveArmed, null, { timeout: 150000 });
    const r = await page.evaluate(() => ({ rep: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, ms: Math.round(RF.UI.lastGenMs), notices: RF.UI.store.notices.slice(0, 2).map((n) => n.msg.slice(0, 120)) }));
    console.log(JSON.stringify({ i, started, mid, waitedMs: Date.now() - t, ...r }));
  }
  await browser.close();
})();
