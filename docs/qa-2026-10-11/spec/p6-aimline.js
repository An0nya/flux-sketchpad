// aim line above the horizon: labels; aim marker text vs judge note; manual-aim marker label
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.addInitScript(() => {});
  await page.evaluate(() => { window.__txt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (this.canvas && this.canvas.id === 'heat-canvas') window.__txt.push(String(t)); return f.apply(this, arguments); }; });
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const grab = (tag) => page.evaluate((tag) => { const ev = RF.UI.spec.ev; const t = window.__txt.filter((x) => /^aim:/.test(x)).slice(-1)[0]; window.__txt = []; return { tag, aimLine: RF.UI.store.scene.modeD.aimLine, note: ev.aim.note, shift: ev.shift, reaim: ev.reaim, ffAimLabel: t,  }; }, tag);
  await page.evaluate(() => RF.UI.redrawSpec()); await page.waitForTimeout(500);
  console.log(JSON.stringify(await grab('default cutoff')));
  // Aim line (° D) = -0.5  → the cut-off 0.5° UP
  await page.evaluate(() => { const i = [...document.querySelectorAll('#spec-box .row')].find((r) => /^Aim line/.test(r.querySelector('label') && r.querySelector('label').textContent)).querySelector('input'); i.value = '-0.5'; i.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await grab('aim line -0.5 °D (= 0.5 up)')));
  // manual
  await page.evaluate(() => { const s = [...document.querySelectorAll('#spec-box select')].find((s) => [...s.options].some((o) => o.value === 'manual')); s.value = 'manual'; s.dispatchEvent(new Event('change')); const h = document.querySelector('input[aria-label="Manual aim, beam right"]'), v = document.querySelector('input[aria-label="Manual aim, beam up"]'); h.value = '-0.3'; h.dispatchEvent(new Event('change')); v.value = '0.25'; v.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await grab('manual L0.3 up0.25')));
  await page.screenshot({ path: __dirname + '/p6-manual.png' });
  console.log('errors', errors);
  await browser.close();
})();
