const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  const R = () => page.evaluate(() => ({ mode: RF.UI.store.scene.mode, preview: RF.UI.run.preview, N: RF.UI.run.ctx.N, status: document.getElementById('run-state').textContent }));
  await L.loadPreset(page, 'parabola'); await L.idle(page); await page.waitForTimeout(1500);
  console.log('C loaded', JSON.stringify(await R()));
  const r = await L.rect(page, 'left-canvas');
  await page.mouse.click(r.x + r.w * 0.8, r.y + r.h * 0.85); await page.waitForTimeout(3000);
  console.log('C after tap-add point', JSON.stringify(await R()), await page.evaluate(() => RF.UI.store.scene.modeC.profile.length));
  await L.loadPreset(page, 'cpc'); await L.idle(page); await page.waitForTimeout(1500);
  const hs = await page.evaluate(() => RF.UI.profHandles.map((h) => [h.x, h.y]));
  await L.drag(page, [[r.x + hs[5][0], r.y + hs[5][1]], [r.x + hs[5][0] + 15, r.y + hs[5][1] + 10]], 6); await page.waitForTimeout(3000);
  console.log('C after point drag', JSON.stringify(await R()));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
