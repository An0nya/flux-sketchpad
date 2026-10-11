// trace ↔ solve mixing: refine in progress then a solve; slider drag (preview trace) during a solve; reload mid-refine
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 });
  await page.evaluate(() => RF.UI.refine(4)); await page.waitForTimeout(300);
  let s = await st(); console.log('refining', s.status, await page.evaluate(() => RF.UI.run.ctx.N));
  await start('patch-array'); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 30000 });
  await page.waitForTimeout(300); s = await st(); console.log('solve during refine →', s.repSolver, s.status, 'N', await page.evaluate(() => RF.UI.run.ctx.N));
  await start('fill-fix'); await page.waitForTimeout(1200);
  for (const v of [1500, 1600, 1700]) { await page.evaluate((v) => RF.UI.previewControl('tgt.dist', v), v); await page.waitForTimeout(150); }
  s = await st(); console.log('drag during solve', s.solving && s.solving.name, '|', s.status, '| preview run', await page.evaluate(() => RF.UI.run.preview));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  s = await st(); console.log('after solve', s.repSolver, s.status, 'dirtyA', s.dirtyA, 'run.preview', await page.evaluate(() => RF.UI.run.preview), 'strip', s.strip);
  await page.evaluate(() => RF.UI.refine(8)); await page.waitForTimeout(200);
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 90000 }).catch(() => console.log('not settled after reload'));
  s = await st(); console.log('after reload mid-refine', s.status, s.repSolver, 'tgt.dist', await page.evaluate(() => RF.UI.store.scene.target.distance));
  console.log('errors', errors); await browser.close();
})();
