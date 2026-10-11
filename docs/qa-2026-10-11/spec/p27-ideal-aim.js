// ideal-beam goals / beam quality "at the judged aim": do they move with Road → Aim on the car (a road-only setting)?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const snap = (tag) => page.evaluate((tag) => { const ui = RF.UI, rd = RF.SpecUI.roadModel(ui), q = rd.quality; return { tag, judgeShift: ui.spec.ev.shift, roadShift: rd.sh.map((x) => +x.toFixed(3)), idealScore: rd.ideal.score + '/' + rd.ideal.n, hotTop: (rd.ideal.goals.find((g) => g.key === 'hotTop') || {}).text, qPeak: q.peak, tiles: [...document.querySelectorAll('.tile')].map((t) => t.innerText.split('\n')[0]).slice(2, 5).join(' | '), idealNote: [...document.querySelectorAll('#spec-box details[data-section="D-ideal"] .note')].map((n) => n.textContent)[0].slice(0, 120) }; }, tag);
  console.log(JSON.stringify(await snap('road aim = spec')));
  await setRow('^Aim on the car', 'manual'); await setRow('^Inclination', '-1.5'); await page.waitForTimeout(1500);
  console.log(JSON.stringify(await snap('road aim = manual -1.5 %')));
  console.log('errors', errors);
  await browser.close();
})();
