const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps'); await page.waitForTimeout(1500);
  const S = () => page.evaluate(() => ({ mode: RF.UI.store.scene.mode, solving: !!RF.UI.solving, pendingA: Math.round(RF.UI.pendingA), armed: !!RF.UI.solveArmed, dirty: [...RF.UI.store.dirty], status: document.getElementById('run-state').textContent, now: Math.round(performance.now()), paint: RF.UI.store.scene.modeA.paint.some((x) => x > 0) }));
  console.log('loaded', JSON.stringify(await S()));
  await page.evaluate(() => { RF.Controller.actions.setTargetDistance(RF.UI.store, 2100); RF.UI.afterChange(); });
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); console.log(i, JSON.stringify(await S())); }
  await page.mouse.move(10, 10); await page.mouse.move(20, 20);
  console.log('after mouse move', JSON.stringify(await S()));
  console.log('errors', errors.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
