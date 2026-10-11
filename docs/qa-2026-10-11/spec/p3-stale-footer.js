// footer tiles after eval-only changes (Aim, Measure at, Kernel): do they follow the report?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const snap = (tag) => page.evaluate((tag) => { const ui = RF.UI, ev = ui.spec.ev, rd = RF.SpecUI.roadModel(ui);
    const tiles = [...document.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\n/g, ' | '));
    return { tag, spec: ev.n.pass + '✓ ' + ev.n.fail + '✗ ' + ev.n.unsure + '?', footer: tiles[0], reachModel: rd.iihs.right + ' / ' + rd.iihs.left, reachTile: tiles.find((t) => /reach/.test(t)), Gdist: ui.spec.G.distance, tipMeasured: document.querySelector('.tile.spec-v').title.match(/Measured at [^.]*/)[0], caption: document.getElementById('right-caption').textContent }; }, tag);
  console.log(JSON.stringify(await snap('boot')));
  // Measure at: ∞ button
  await page.click('#spec-box [data-dist="0"]'); await page.waitForTimeout(4000);
  console.log(JSON.stringify(await snap('measure at ∞ (+4s)')));
  await page.click('#spec-box [data-dist="10000"]'); await page.waitForTimeout(4000);
  console.log(JSON.stringify(await snap('measure at 10 m (+4s)')));
  // switch display away and back: does that refresh?
  await page.evaluate(() => { RF.UI.setDisplay('road'); }); await page.waitForTimeout(800);
  await page.evaluate(() => { RF.UI.setDisplay('ff'); }); await page.waitForTimeout(800);
  console.log(JSON.stringify(await snap('after display road→ff')));
  console.log('errors', errors);
  await browser.close();
})();
