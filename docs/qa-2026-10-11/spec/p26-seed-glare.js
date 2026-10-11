// (a) Seed from road reach runs and re-solves without errors (b) the reach tile's fail colour when only glare is over
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const b = page.locator('#spec-box button', { hasText: 'Seed from road reach' }); await b.click(); await page.locator('#spec-box button.confirming').click();
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => console.log('(no solve)'));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 }); await waitJudged(page, 240000); await page.waitForTimeout(1500);
  console.log(JSON.stringify(await page.evaluate(() => { const ui = RF.UI, m = ui.store.scene.modeD, rd = RF.SpecUI.roadModel(ui), t = [...document.querySelectorAll('.tile')].find((x) => /reach/.test(x.innerText)); return { paintCd: m.paintCd, usePaint: m.usePaint, reach: [rd.iihs.right, rd.iihs.left], glare: +rd.iihs.glareMax.toFixed(1), tileClass: t.className, tileText: t.innerText.replace(/\n/g, ' '), notice: ui.store.notices[0] && ui.store.notices[0].msg.slice(0, 120) }; })));
  console.log('errors', errors);
  await browser.close();
})();
