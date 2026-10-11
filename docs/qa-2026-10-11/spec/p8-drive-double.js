// a Drive-only setting (marking reflectivity) at 1280 px forest: how many renders, how long the main thread blocks
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; const t = performance.now(); i.dispatchEvent(new Event('change')); return performance.now() - t; }, [re, val]);
  await page.evaluate(() => { RF.UI.setDisplay('drive'); });
  await page.selectOption('.drive-tools select[data-dv="scene"]', 'forest').catch(async () => { console.log('scene options', await page.evaluate(() => [...document.querySelectorAll('.drive-tools select option')].map((o) => o.value))); });
  await setRow('^Drive view: picture size', '1280'); await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__n = 0; window.__ms = 0; const f = RF.Drive.render; RF.Drive.render = function () { const t = performance.now(); const r = f.apply(this, arguments); window.__n++; window.__ms += performance.now() - t; return r; }; });
  const syncMs = await setRow('^Drive view: marking', '150'); await page.waitForTimeout(4000);
  console.log('RL change: renders', await page.evaluate(() => window.__n), 'render ms', Math.round(await page.evaluate(() => window.__ms)), 'change handler blocked', Math.round(syncMs), 'ms', 'scene', await page.evaluate(() => RF.UI.dvOpts.scene));
  console.log('errors', errors);
  await browser.close();
})();
