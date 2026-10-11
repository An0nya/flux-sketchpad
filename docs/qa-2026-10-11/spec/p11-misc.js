// EV step size; Measure-at "target" after the target moves; distance labels; compare distances
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  // 1. EV step
  await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(1500);
  const ev0 = await page.evaluate(() => ({ ev: RF.UI.dvOpts.ev, white: RF.UI.driveShown.tm.white, title: document.querySelector('[data-dv="evp"]').title }));
  await page.click('[data-dv="evp"]'); await page.waitForTimeout(500);
  const ev1 = await page.evaluate(() => ({ ev: RF.UI.dvOpts.ev, white: RF.UI.driveShown.tm.white, btn: document.querySelector('[data-dv="ev"]').textContent }));
  console.log('EV', JSON.stringify(ev0), '→', JSON.stringify(ev1));
  await page.evaluate(() => RF.UI.setDisplay('ff')); await page.waitForTimeout(500);
  // 2. Measure at target, then move the target
  await page.click('#spec-box [data-dist="-1"]'); await page.waitForTimeout(2500);
  const onBtn = () => page.evaluate(() => ({ md: RF.UI.store.scene.modeD.distance, target: RF.UI.store.scene.target.distance, on: [...document.querySelectorAll('#spec-box [data-dist]')].filter((b) => b.classList.contains('on')).map((b) => b.textContent), caption: document.getElementById('right-caption').textContent, Gdist: RF.UI.spec && RF.UI.spec.G && RF.UI.spec.G.distance, measured: (document.querySelector('#spec-report .note') || {}).innerText }));
  console.log('target btn', JSON.stringify(await onBtn()));
  await page.evaluate(() => { RF.Controller ? 0 : 0; const C = RF.Controller || RF.C; RF.UI.store.scene.target.distance = 5000; RF.UI.store.invalidate(['A', 'B', 'C', 'L']); RF.UI.afterChange(); });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 }); await page.waitForTimeout(3000);
  try { await waitJudged(page, 120000); } catch (e) { console.log('not judged', e.message); }
  console.log('after target → 5 m', JSON.stringify(await onBtn()));
  // 3. Compare distances
  const cmp = await page.evaluate(() => { const b = [...document.querySelectorAll('#spec-report button')].find((x) => /Compare distances/.test(x.textContent)); if (!b) return 'no button'; b.click(); return document.querySelector('.spec-cmp').innerText; });
  console.log('compare:', JSON.stringify(cmp));
  console.log('errors', errors);
  await browser.close();
})();
