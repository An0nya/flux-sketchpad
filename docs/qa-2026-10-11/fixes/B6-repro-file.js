const pw = require(process.env.PLAYWRIGHT);
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage(), errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file:///Users/anya/Projects/flux-sketchpad/.claude/worktrees/b6-memory/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 }).catch((e) => errs.push('boot wait: ' + e.message.split('\n')[0]));
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => ({ title: document.title, nSolvers: RF.Solvers.list().length, workerSolvers: RF.Solvers.list().filter((d) => d.worker).length, solveId: RF.UI.store.scene.solve && RF.UI.store.scene.solve.id, current: RF.Solvers.current(RF.UI.store.scene), repA: RF.UI.store.reports.A && (RF.UI.store.reports.A.error || RF.UI.store.reports.A.placed), status: document.querySelector('#status, .status') && document.querySelector('#status, .status').textContent, notices: RF.UI.store.notices.slice(0, 3).map((n) => n.msg.slice(0, 200)) }));
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-anya/e131d530-06e8-45fd-966e-f5141ea2d478/scratchpad/qa/fixes/B6-file-origin.png' });
  console.log(JSON.stringify(st, null, 1)); console.log(errs.slice(0, 6).join('\n'));
  await browser.close();
})();
