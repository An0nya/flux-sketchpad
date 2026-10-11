const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  const R = () => page.evaluate(() => ({ t: Math.round(performance.now()), solving: !!RF.UI.solving, pend: Math.round(RF.UI.pendingA), preview: RF.UI.run.preview, previewRun: RF.UI.previewRun, N: RF.UI.run.ctx.N, next: RF.UI.run.ctx.next, interacting: RF.UI.interacting, status: document.getElementById('run-state').textContent, raysTile: document.getElementById('min-row').innerText.split('\n').slice(-2).join(' ') }));
  console.log('boot', JSON.stringify(await R()));
  const r = await L.rect(page, 'left-canvas');
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.4], [r.x + r.w * 0.7, r.y + r.h * 0.6]], 40);
  await L.idle(page);
  for (let i = 0; i < 6; i++) { console.log(i, JSON.stringify(await R())); await page.waitForTimeout(1000); }
  await page.screenshot({ path: L.DIR + '/shots/p19_preview.png' });
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
