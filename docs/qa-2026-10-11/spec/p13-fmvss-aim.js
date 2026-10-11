// FMVSS LB2V: aim label on the far field vs the judge's note and shift
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => { window.__txt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { if (this.canvas && this.canvas.id === 'heat-canvas') window.__txt.push(String(t)); return f.apply(this, arguments); }; });
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.selectOption('#spec-box select[aria-label="Spec preset"]', 'fmvss-lb2v');
  await page.locator('#spec-box button', { hasText: 'Load preset' }).click(); await page.locator('#spec-box button.confirming').click();
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 }); await waitJudged(page, 240000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { window.__txt = []; RF.UI.redrawSpec(); }); await page.waitForTimeout(600);
    console.log(JSON.stringify(await page.evaluate(() => { const ev = RF.UI.spec.ev; return { shift: ev.shift, base: ev.aim.base, reaim: ev.reaim, note: ev.aim.note, cutV: ev.aim.cutV, aimLine: RF.UI.store.scene.modeD.aimLine, label: window.__txt.filter((x) => /^aim:/.test(x)).slice(-1)[0], ffShownSame: RF.UI.ffShown === RF.UI.spec, full: RF.UI.spec.full }; })));
  }
  console.log('errors', errors);
  await browser.close();
})();
