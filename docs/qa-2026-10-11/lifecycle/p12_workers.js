// worker count across many stop / replace cycles
const H = require('./h.js');
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  const count = () => [...workers].map((w) => w.url().split('/').pop()).join(',');
  console.log('boot', workers.size, count());
  for (let i = 0; i < 6; i++) {
    await start('fill-fix'); await page.waitForTimeout(700);
    if (i % 2) await page.evaluate(() => RF.UI.stopSolve()); else await start('sqm');
    await page.waitForTimeout(1800);           // let the rebuild finish (avoid the reload race)
    if (!(i % 2)) await page.evaluate(() => RF.UI.stopSolve());
    await page.waitForTimeout(1800);
    console.log('cycle', i, workers.size, count(), 'solving', !!(await st()).solving);
  }
  await page.waitForTimeout(3000);
  console.log('final', workers.size, count());
  console.log('page-side check: SolverHost.busy', await page.evaluate(() => RF.SolverHost.busy()));
  console.log('errors', errors); await browser.close();
})();
