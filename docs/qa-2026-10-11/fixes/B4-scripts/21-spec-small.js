const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 1500, height: 950 }]) {
    const { ctx, page, errors } = await L.open({ browser, viewport: vp });
    await page.evaluate(() => RF.UI.setMode('D')); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(1200);
    for (const d of ['grid', 'drive', 'ff', 'road']) {
      await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(1200);
      const r = await page.evaluate((d) => { const rr = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
        const wrap = document.getElementById('heat-canvas').parentElement, tools = wrap.querySelector('.' + ({ drive: 'drive', ff: 'ff', road: 'road' }[d] || 'none') + '-tools');
        return { mode: RF.UI.store.scene.mode, footerH: Math.round(footer.getBoundingClientRect().height), heatCanvas: rr(document.getElementById('heat-canvas')), leftCanvas: rr(document.getElementById('left-canvas')), tools: rr(tools), resultPane: rr(document.querySelector('.result-pane')), vw: innerWidth }; }, d);
      console.log(vp.width, d, JSON.stringify(r));
    }
    console.log(' errors', errors.filter(e => !/clearZero/.test(e)));
    await ctx.close();
  }
  await browser.close();
})();
