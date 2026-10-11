// Halogen HB4 → "measured" emitter (via the UI select), then trace; plus drive-current carry-over kyocera → sft70-3000.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  const sel = '#source-preset select[aria-label="Emitter preset"]';
  const show = (tag) => page.evaluate((tag) => { const s = RF.UI.store.scene.source; return tag + ' ' + JSON.stringify({ preset: s.preset, kind: s.kind, shape: s.shape, power: s.power, volts: s.volts, driveA: s.driveA, fluxModel: s.fluxModel, w: s.w, emission: s.emission, shapeSelect: (document.querySelector('#side select[data-control="src.shape"]') || {}).value, kindSelect: document.querySelector('#side select[data-control="src.kind"]').value }); }, tag);
  await page.selectOption(sel, 'hb4'); await page.waitForTimeout(200); console.log(await show('hb4'));
  await page.selectOption(sel, 'measured'); await page.waitForTimeout(200); console.log(await show('→ measured'));
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 20000; RF.UI.requestRun(false); });
  await page.waitForTimeout(3000);
  console.log('trace done', await page.evaluate(() => RF.UI.run && RF.UI.run.ctx.done), 'footer:', (await page.evaluate(() => document.getElementById('footer').innerText)).replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: 'halogen-to-measured.png' });
  // drive carry-over
  await page.selectOption(sel, 'sft70-3000'); await page.waitForTimeout(200); console.log(await show('sft70-3000 fresh-ish'));
  await page.selectOption(sel, 'kyocera-laserlight-smd1000'); await page.waitForTimeout(200); console.log(await show('kyocera'));
  await page.selectOption(sel, 'sft70-3000'); await page.waitForTimeout(200); console.log(await show('→ sft70-3000'));
  console.log('label', await page.evaluate(() => [...document.querySelectorAll('#source-preset option')].find((o) => o.value === 'sft70-3000').text));
  console.log('errors', [...new Set(errors)].slice(0, 4));
  await browser.close();
})();
