// Refine button state vs solves / stale design
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 }); await page.waitForTimeout(300);
  const b = () => page.evaluate(() => { const x = document.getElementById('btn-refine'); return { disabled: x.disabled, text: x.textContent, can: RF.UI.canRefine(), N: RF.UI.run.ctx.N }; });
  console.log('idle', JSON.stringify(await b()));
  await start('fill-fix'); await page.waitForTimeout(1000);
  console.log('solving', JSON.stringify(await b()), (await st()).solving.name);
  const r = await page.evaluate(() => { document.getElementById('btn-refine').click(); return RF.UI.run.ctx.N; });
  await page.waitForTimeout(300);
  console.log('after clicking Refine while solving: N', r, '→', (await b()).N, 'status', (await st()).status);
  await page.evaluate(() => RF.UI.stopSolve()); await page.waitForTimeout(500);
  // stale design (setting change, autoSet off)
  await page.evaluate(() => RF.UI.setControl('A.budget', 40)); await page.waitForTimeout(1500);
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 }); await page.waitForTimeout(300);
  console.log('stale', JSON.stringify(await b()), (await st()).status);
  console.log('errors', errors); await browser.close();
})();
