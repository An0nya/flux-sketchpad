const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({});
  const info = () => page.evaluate(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    const vis = (sel) => { const e = document.querySelector(sel), p = e.closest('.pane').getBoundingClientRect(), b = e.getBoundingClientRect(); return b.height > 0 && b.bottom <= p.bottom + 1 ? 'in' : 'CLIPPED(' + Math.round(b.bottom - p.bottom) + 'px)'; };
    return { left: r('left-canvas'), heat: r('heat-canvas'), fitL: Math.round(RF.UI.vLeft.fitSq), fitH: Math.round(RF.UI.vHeat.fitSq), leftTools: vis('#left-tools'), colorbar: vis('#colorbar'), pairRows: getComputedStyle(pair).gridTemplateRows }; });
  await page.evaluate(() => { RF.UI.layout.rowSplit = 0.1; RF.UI.layoutGrid(); }); await page.waitForTimeout(600);
  console.log('rowSplit 0.1 (pair at MIN_H)', JSON.stringify(await info()));
  await page.screenshot({ path: L.SH + 'min-row.png', clip: { x: 570, y: 50, width: 640, height: 250 } });
  await page.evaluate(() => { RF.UI.layout.rowSplit = 0.58; RF.UI.layout.split = 0.9; RF.UI.layoutGrid(); }); await page.waitForTimeout(600);
  console.log('split 0.9 (right col at MIN)', JSON.stringify(await info()));
  await browser.close();
})();
