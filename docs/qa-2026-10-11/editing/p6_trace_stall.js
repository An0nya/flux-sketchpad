const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps'); await L.idle(page);
  const S = () => page.evaluate(() => ({ mode: RF.UI.store.scene.mode, next: RF.UI.run && RF.UI.run.ctx.next, N: RF.UI.run && RF.UI.run.ctx.N, done: RF.UI.run && RF.UI.run.ctx.done, status: document.getElementById('run-state').textContent }));
  for (let i = 0; i < 6; i++) { console.log('B', JSON.stringify(await S())); await page.waitForTimeout(1000); }
  // set a large ray count to make the stall obvious
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 2000000; RF.UI.needCompile = true; RF.UI.sceneDirty = true; RF.UI.requestRun(false); });
  for (let i = 0; i < 6; i++) { console.log('B 2M', JSON.stringify(await S())); await page.waitForTimeout(1000); }
  await L.setMode(page, 'C');
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 2000000; RF.UI.needCompile = true; RF.UI.requestRun(false); });
  for (let i = 0; i < 6; i++) { console.log('C 2M', JSON.stringify(await S())); await page.waitForTimeout(1000); }
  console.log('errors', errors.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
