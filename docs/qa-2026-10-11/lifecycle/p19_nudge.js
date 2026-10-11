// natural trigger for the rebuild race: Auto-solve on settings ON, nudge the facet budget 5× at 700 ms
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForFunction(() => !RF.UI.solving && RF.UI.store.reports.A.solver.id === 'fill-fix', null, { timeout: 60000 });
  await page.evaluate(() => RF.UI.setAuto('settings', true));
  for (const v of [90, 80, 70, 60, 50]) { await page.evaluate((v) => RF.UI.setControl('A.budget', v), v); await page.waitForTimeout(700); }
  let ok = false; const t = Date.now();
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); const s = await st(); if (!s.solving) { ok = true; break; } }
  const s = await st(), r = await page.evaluate(() => ({ placed: RF.UI.store.reports.A.placed, solverBudget: RF.UI.store.scene.modeA.budget }));
  console.log(ok ? 'SETTLED' : 'HUNG (30 s after last nudge)', Date.now() - t, 'ms', JSON.stringify(s), JSON.stringify(r));
  await page.evaluate(() => RF.UI.setAuto('settings', false));
  console.log('errors', errors); await browser.close();
})();
