// Road view: stretch modes, caption, readout at the 5 lx marker, tick positions
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => { window.__txt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (this.canvas && this.canvas.id === 'heat-canvas') window.__txt.push([String(t), Math.round(x), Math.round(y)]); return f.apply(this, arguments); }; });
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => RF.UI.setDisplay('road')); await page.waitForTimeout(800);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  for (const st of ['1', 'fit', '2', '4']) {
    await page.evaluate(() => { window.__txt = []; });
    await setRow('^Road view: sideways stretch', st); await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const ui = RF.UI, v = ui.vHeat, k = v.roadK, rd = RF.SpecUI.roadModel(ui), R = rd.iihs, I3 = RF.Road.IIHS;
      const p = v.toScreen(R.right, -I3.lane / 2 * k), q = v.toScreen(R.right + 1, -I3.lane / 2 * k);
      const ro = RF.SpecUI.roadReadout(ui, p[0], p[1]), ro2 = RF.SpecUI.roadReadout(ui, q[0], q[1]);
      const lux = rd.mdl.lux([R.right, -I3.lane / 2, I3.sensorZ], 'car');
      const s10 = v.toScreen(10, 0), s50 = v.toScreen(50, 0), sY = v.toScreen(0, 10 * k), sY0 = v.toScreen(0, 0);
      const marks = window.__txt.filter((t) => /edge 5 lx|^\d+ m$/.test(t[0]));
      return { stretchOpt: ui.rvOpts.stretch, k, caption: document.getElementById('right-caption').textContent, readAtMark: ro, readPast: ro2, luxAtReach: +lux.toFixed(2), pxPerM_x: +((s50[0] - s10[0]) / 40).toFixed(2), pxPerM_y: +((sY0[1] - sY[1]) / 10).toFixed(2), marks: marks.slice(0, 14).map((m) => m.join('@')) };
    });
    console.log(JSON.stringify(r));
    await page.screenshot({ path: __dirname + '/p9-road-' + st + '.png', clip: await page.locator('#heat-canvas').boundingBox() });
  }
  console.log('errors', errors);
  await browser.close();
})();
