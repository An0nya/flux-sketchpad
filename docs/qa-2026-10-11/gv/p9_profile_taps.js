const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'parabola'); await L.idle(page);
  const S = () => page.evaluate(() => ({ n: RF.UI.store.scene.modeC.profile.length, sel: RF.UI.profSel, past: RF.UI.hist.past.length, lastLabel: RF.UI.hist.past.length && RF.UI.hist.past[RF.UI.hist.past.length - 1].label, bounds: RF.UI.vProf.bounds && RF.UI.vProf.bounds.map((x) => +x.toFixed(1)), s: +RF.UI.vProf.s.toFixed(3) }));
  const r = await L.rect(page, 'left-canvas');
  console.log('start', JSON.stringify(await S()));
  // slow taps, 600ms apart
  for (let i = 0; i < 4; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.85); await page.waitForTimeout(600); console.log('slow tap', i, JSON.stringify(await S())); }
  // rapid taps, no delay
  for (let i = 0; i < 4; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.92); console.log('fast tap', i, JSON.stringify(await S())); }
  await page.waitForTimeout(1000);
  console.log('settled', JSON.stringify(await S()));
  for (let i = 0; i < 9; i++) { await page.click('#btn-undo'); await page.waitForTimeout(300); console.log('undo', i, JSON.stringify(await S()), await page.evaluate(() => document.getElementById('toast').textContent)); }
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
