// Road → Aim on the car = Manual inclination, with the judge in each aim mode: where does it put the cut-off?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  await setRow('^Aim on the car', 'manual'); await setRow('^Inclination', '-1'); await page.waitForTimeout(1000);
  for (const mode of ['cutoff', 'design', 'peak', 'manual']) {
    await setRow('^Aim$', mode); await page.waitForTimeout(2500);
    console.log(JSON.stringify(await page.evaluate(() => { const ui = RF.UI, ev = ui.spec.ev, rd = RF.SpecUI.roadModel(ui); return { judgeAim: ui.store.scene.modeD.aimMode, judgeShift: ev.shift, cutV: ev.aim.cutV, note: ev.aim.note, roadShift: rd.sh, reachR: rd.iihs.right, tile: [...document.querySelectorAll('.tile')].map((t) => t.innerText.split('\n')[0]).slice(0, 3).join(' | ') }; })));
  }
  console.log('errors', errors);
  await browser.close();
})();
