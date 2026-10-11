const L = require('./lib');
(async () => {
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }]) {
    const { browser, page } = await L.open({ viewport: vp });
    const m = () => page.evaluate(() => ({ L: Math.round(RF.UI.vLeft.fitSq), H: Math.round(RF.UI.vHeat.fitSq), cap: RF.UI.vLeft.cap, lc: [Math.round(document.getElementById('left-canvas').getBoundingClientRect().width), Math.round(document.getElementById('left-canvas').getBoundingClientRect().height)], hc: [Math.round(document.getElementById('heat-canvas').getBoundingClientRect().width), Math.round(document.getElementById('heat-canvas').getBoundingClientRect().height)] }));
    console.log(vp.width, 'normal', JSON.stringify(await m()));
    for (const p of ['editor', 'result']) {
      await page.click(`button.expand[data-expand="${p}"]`); await page.waitForTimeout(700);
      console.log(vp.width, 'expanded ' + p, JSON.stringify(await m()));
      await page.screenshot({ path: L.SH + `expsize-${vp.width}-${p}.png` });
      await page.click(`button.expand[data-expand="${p}"]`); await page.waitForTimeout(700);
    }
    await page.click('button.collapse[data-collapse="result"]'); await page.waitForTimeout(700);
    console.log(vp.width, 'result collapsed', JSON.stringify(await m()));
    await browser.close();
  }
})();
