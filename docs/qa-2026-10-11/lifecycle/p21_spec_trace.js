// Spec preset: trace in progress → solve starts (auto from preset) → stop → change mode → switch preset mid-trace
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st } = await H.boot();
  const preset = (n) => page.evaluate((n) => { const s = document.getElementById('preset-select'); s.value = n; s.dispatchEvent(new Event('change')); document.querySelector('#preset-confirm button.primary').click(); }, n);
  await preset('spec-box'); await page.waitForTimeout(1500);
  let s = await st(); console.log('spec preset +1.5s', s.mode, s.solver, s.solving && s.solving.name, '|', s.status);
  await page.evaluate(() => RF.UI.stopSolve()); await page.waitForTimeout(1500);
  s = await st(); console.log('after stop', s.status, 'runDone', s.runDone, 'fail', s.fail);
  await page.evaluate(() => RF.UI.generateA()); await page.waitForTimeout(2000);
  s = await st(); console.log('rebuild', s.solving && s.solving.name, '|', s.status);
  await preset('headlamp'); await page.waitForTimeout(500);
  s = await st(); console.log('headlamp mid-spec-solve', s.mode, s.solving && s.solving.name, '|', s.status, '| notices', JSON.stringify(s.notices.slice(0, 2)));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 130000 }).catch(() => console.log('still solving'));
  await page.waitForTimeout(3000);
  s = await st(); console.log('end', JSON.stringify(s));
  console.log('errors', errors); await browser.close();
})();
