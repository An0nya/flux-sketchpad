// Road view on a bend: readout at the curve 5 lx markers vs the curve numbers
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => { window.__txt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { if (this.canvas && this.canvas.id === 'heat-canvas') window.__txt.push(String(t)); return f.apply(this, arguments); }; });
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => RF.UI.setDisplay('road')); await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.__txt = []; }); await page.click('[data-rv="shape"]'); await page.waitForTimeout(800);
    console.log(JSON.stringify(await page.evaluate(() => {
      const ui = RF.UI, v = ui.vHeat, o = ui.rvOpts, rd = RF.SpecUI.roadModel(ui), m = /^(\d+)([RL])$/.exec(o.shape), R = +m[1], dir = m[2] === 'R' ? 'right' : 'left', A = RF.Road.arc(R, dir), c = rd.curves.find((q) => q.R === R && q.dir === dir), I3 = RF.Road.IIHS;
      const at = (s, off) => { const p = A.at(s, off).p, q = v.toScreen(p[0], p[1] * (v.roadK || 1)); return RF.SpecUI.roadReadout(ui, q[0], q[1]); };
      return { shape: o.shape, k: v.roadK, curve: [c.right, c.left], readR: c.right ? at(c.right, -I3.lane / 2) : '-', readRpast: c.right ? at(c.right + 1, -I3.lane / 2) : '-', labels: window.__txt.filter((t) => /edge|curves/.test(t)), caption: document.getElementById('right-caption').textContent };
    })));
  }
  await page.screenshot({ path: __dirname + '/p23-bend.png', clip: await page.locator('#heat-canvas').boundingBox() });
  console.log('errors', errors);
  await browser.close();
})();
