// two judge-only edits 300 ms apart (typing Manual R, then tabbing to Manual up), after the page has been idle
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const cmp = () => page.evaluate(() => { const ev = RF.UI.spec.ev, f = document.querySelector('.tile.spec-v').innerText.split('\n')[0], rep = ev.n.pass + '✓ ' + ev.n.fail + '✗ ' + ev.n.unsure + '?'; return (f === rep ? 'OK   ' : 'STALE') + ' report ' + rep + ' · footer ' + f + ' · reach model ' + RF.SpecUI.roadModel(RF.UI).iihs.right + ' / tile ' + [...document.querySelectorAll('.tile')].find((t) => /reach/.test(t.innerText)).innerText.split('\n')[0]; });
  await setRow('^Aim$', 'manual'); await page.waitForTimeout(3000); console.log('manual, idle 3 s :', await cmp());
  for (let trial = 0; trial < 3; trial++) {
    await page.evaluate((t) => { const h = document.querySelector('input[aria-label="Manual aim, beam right"]'); h.value = String(0.5 + t); h.dispatchEvent(new Event('change')); }, trial);
    await page.waitForTimeout(300);
    await page.evaluate((t) => { const h = document.querySelector('input[aria-label="Manual aim, beam up"]'); h.value = String(-0.25 * (t + 1)); h.dispatchEvent(new Event('change')); }, trial);
    await page.waitForTimeout(5000); console.log('trial', trial, '+5 s     :', await cmp());
  }
  await browser.close();
})();
