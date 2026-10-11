// reload the page mid-solve and mid-trace
const H = require('./h.js');
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(2000);
  const a = await st(); console.log('before reload', a.solving && a.solving.name, a.repSolver, 'saved solve:', await page.evaluate(() => { try { return JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /scene/.test(k)) || 'null')); } catch (e) { return 'n/a'; } }) ? 'yes' : 'no');
  await page.reload();
  const t = Date.now();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const b = await st(); console.log('after reload boot', JSON.stringify(b));
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 }).catch(() => console.log('not settled at 60 s'));
  const c = await st(); console.log('settled after', Date.now() - t, 'ms', JSON.stringify(c), 'A surfaces', await page.evaluate(() => RF.UI.store.scene.groups.A.surfaces.length));
  // mid-trace reload: big ray count
  await page.evaluate(() => { RF.UI.setControl('sim.rays', 5000000); });
  await page.waitForTimeout(500);
  console.log('mid trace', (await st()).status);
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('after trace reload', JSON.stringify(await st()));
  console.log('workers', workers.size, 'errors', errors); await browser.close();
})();
