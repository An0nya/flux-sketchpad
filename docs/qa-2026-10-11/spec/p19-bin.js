// Bin (°) change: the streams no longer cover the grid → what does the report show, does it recover?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const st = () => page.evaluate(() => ({ step: RF.UI.store.scene.modeD.step, err: RF.UI.spec && RF.UI.spec.error, Gstep: RF.UI.spec && RF.UI.spec.G && RF.UI.spec.G.step, done: RF.UI.run.ctx.done, next: RF.UI.run.ctx.next, solving: !!RF.UI.solving, report: (document.getElementById('spec-report').innerText || '').slice(0, 160).replace(/\n/g, ' | '), status: (document.querySelector('#status, .status') || {}).textContent }));
  console.log('before', JSON.stringify(await st()));
  await setRow('^Bin', '0.1');
  for (const t of [100, 1500, 5000]) { await page.waitForTimeout(t); console.log('+' + t, JSON.stringify(await st())); }
  console.log('errors', errors);
  await browser.close();
})();
