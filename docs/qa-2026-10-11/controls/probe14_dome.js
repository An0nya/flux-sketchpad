// Dome: z clamp vs later radius change; trace result with an out-of-range z; n reset after r→0→r.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  const st = (t) => page.evaluate((t) => t + ' ' + JSON.stringify(RF.UI.store.scene.source.dome) + ' fieldZ=' + document.querySelector('#side input.scrub[data-control="src.domeZ"]')?.value, t);
  await page.evaluate(() => { RF.UI.setControl('src.domeR', 3); RF.UI.setControl('src.domeN', 1.53); RF.UI.setControl('src.domeZ', 2.85); }); console.log(await st('r3 n1.53 z2.85'));
  await page.evaluate(() => RF.UI.setControl('src.domeR', 0.5)); console.log(await st('then r0.5'));
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 50000; RF.UI.requestRun(false); }); await page.waitForTimeout(4000);
  console.log('trace', await page.evaluate(() => ({ done: RF.UI.run.ctx.done, footer: document.getElementById('footer').innerText.replace(/\s+/g, ' ').slice(0, 160) })));
  await page.evaluate(() => { RF.UI.setControl('src.domeR', 0); RF.UI.setControl('src.domeR', 2); }); console.log(await st('r0 then r2'));
  console.log('errors', [...new Set(errors)].slice(0, 3));
  await browser.close();
})();
