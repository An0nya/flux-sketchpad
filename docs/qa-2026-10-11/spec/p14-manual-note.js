// the report's aim sentence in Manual aim mode (the re-aim box is skipped by design)
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const note = () => page.evaluate(() => ({ aimMode: RF.UI.store.scene.modeD.aimMode, box: RF.UI.store.scene.modeD.aimBox, reaim: RF.UI.spec.ev.reaim, text: [...document.querySelectorAll('#spec-report .note')].map((n) => n.innerText).find((t) => /^Measured/.test(t)) }));
  console.log(JSON.stringify(await note()));
  await page.evaluate(() => { const s = [...document.querySelectorAll('#spec-box select')].find((s) => [...s.options].some((o) => o.value === 'manual')); s.value = 'manual'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(2000);
  console.log(JSON.stringify(await note()));
  await page.evaluate(() => { const s = [...document.querySelectorAll('#spec-box select')].find((s) => [...s.options].some((o) => o.value === 'manual')); s.value = 'design'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await note()));
  console.log('errors', errors);
  await browser.close();
})();
