// press Rebuild while the bundled solvers are still loading at boot
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // slow the bundle a little so the window is reliably open
  if (process.argv[2] !== 'nodelay') await page.route('**/solvers/*.js', async (r) => { await new Promise((ok) => setTimeout(ok, 60)); r.continue(); });
  await page.goto('http://localhost:8803/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && document.getElementById('btn-generate-top'), null, { timeout: 30000 });
  const a = await page.evaluate(() => ({ loading: RF.SolverHost.loading(), wanted: RF.Solvers.wanted(RF.UI.store.scene), current: RF.Solvers.current(RF.UI.store.scene) }));
  console.log('at click', JSON.stringify(a));
  await page.click('#btn-generate-top');
  await page.waitForFunction(() => !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 });
  const b = await page.evaluate(() => ({ scSolve: RF.UI.store.scene.solve && RF.UI.store.scene.solve.id, rep: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, dropdown: document.querySelector('#solver-box select[aria-label=Solver]').value, notices: RF.UI.store.notices.map((n) => n.msg.slice(0, 80)) }));
  console.log('after load', JSON.stringify(b));
  console.log('errors', errors); await browser.close();
})();
