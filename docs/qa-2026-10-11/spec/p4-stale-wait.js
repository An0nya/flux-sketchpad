const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => { const m = RF.UI.store.scene.modeD; const s = [...document.querySelectorAll('#spec-box select')].find((s) => [...s.options].some((o) => o.value === 'manual')); s.value = 'manual'; s.dispatchEvent(new Event('change')); const h = document.querySelector('input[aria-label="Manual aim, beam right"]'); h.value = '1'; h.dispatchEvent(new Event('change')); });
  for (const t of [500, 3000, 10000]) { await page.waitForTimeout(t);
    console.log(await page.evaluate(() => { const ev = RF.UI.spec.ev; return 'report ' + ev.n.pass + '/' + ev.n.fail + '/' + ev.n.unsure + ' · footer ' + document.querySelector('.tile.spec-v').innerText.replace(/\n/g, ' ') + ' · reach model ' + RF.SpecUI.roadModel(RF.UI).iihs.right + ' tile ' + [...document.querySelectorAll('.tile')].find((t) => /reach/.test(t.innerText)).innerText.split('\n')[0]; })); }
  // orbit the scene / hover: does any ordinary interaction refresh it?
  await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(350, 330, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(1000);
  console.log('after scene drag', await page.evaluate(() => document.querySelector('.tile.spec-v').innerText.replace(/\n/g, ' ')));
  await browser.close();
})();
