// which judge-only changes leave the footer stale? each step: change, wait 3 s, compare footer vs report
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => { window.__rs = 0; const f = RF.Panels.renderStats; RF.Panels.renderStats = function () { window.__rs++; return f.apply(this, arguments); }; });
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const check = async (label, fn) => { await page.evaluate(() => { window.__rs = 0; }); await fn(); await page.waitForTimeout(3000);
    console.log(label.padEnd(28), await page.evaluate(() => { const ev = RF.UI.spec.ev, f = document.querySelector('.tile.spec-v').innerText.split('\n')[0]; const rep = ev.n.pass + '✓ ' + ev.n.fail + '✗ ' + ev.n.unsure + '?'; return (f === rep ? 'OK   ' : 'STALE') + ' report ' + rep + ' footer ' + f + ' renderStats×' + window.__rs; })); };
  await check('Aim → design', () => setRow('^Aim$', 'design'));
  await check('Aim → peak', () => setRow('^Aim$', 'peak'));
  await check('Aim → cutoff', () => setRow('^Aim$', 'cutoff'));
  await check('Measure at ∞', () => page.click('#spec-box [data-dist="0"]'));
  await check('Measure at 25 m', () => page.click('#spec-box [data-dist="25000"]'));
  await check('Kernel 0.3', () => setRow('^Kernel', '0.3'));
  await check('Aim → manual', () => setRow('^Aim$', 'manual'));
  await check('Manual R = 1', () => page.evaluate(() => { const h = document.querySelector('input[aria-label="Manual aim, beam right"]'); h.value = '1'; h.dispatchEvent(new Event('change')); }));
  await check('Manual up = -0.5', () => page.evaluate(() => { const h = document.querySelector('input[aria-label="Manual aim, beam up"]'); h.value = '-0.5'; h.dispatchEvent(new Event('change')); }));
  await browser.close();
})();
