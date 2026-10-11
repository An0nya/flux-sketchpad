// (a) Compare distances agrees with the report at the same distance (b) footer "Measured at" for 18.3 m (c) ideal hotH input
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const a = await page.evaluate(() => { const b = [...document.querySelectorAll('#spec-report button')].find((x) => /Compare distances/.test(x.textContent)); b.click(); const ev = RF.UI.spec.ev; return { report25: ev.n.pass + '/' + ev.rows.length + ' · ' + Math.round(100 * ev.score) + '%', cmp: document.querySelector('.spec-cmp').innerText.replace(/\n/g, ' ') }; });
  console.log('(a)', JSON.stringify(a));
  const c = await page.evaluate(() => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => /^Hotspot centre H/.test(r.querySelector('label').textContent)); const i = r.querySelector('input'); return { min: i.min, value: i.value, validAtMinus1: (i.value = '-1', i.checkValidity()) }; });
  console.log('(c) hotH input', JSON.stringify(c));
  await page.selectOption('#spec-box select[aria-label="Spec preset"]', 'fmvss-lb2v');
  await page.locator('#spec-box button', { hasText: 'Load preset' }).click(); await page.locator('#spec-box button.confirming').click();
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 }); await waitJudged(page, 240000); await page.waitForTimeout(1500);
  const b = await page.evaluate(() => ({ tile: document.querySelector('.tile.spec-v').title.match(/Measured at [^.]*\.\d*[^.]*|Measured at [^.]*/)[0], report: [...document.querySelectorAll('#spec-report .note')].map((n) => n.innerText).find((t) => /^Measured/.test(t)).slice(0, 30), caption: document.getElementById('right-caption').textContent }));
  console.log('(b)', JSON.stringify(b));
  console.log('errors', errors);
  await browser.close();
})();
