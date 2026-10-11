const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 768, height: 1024 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
    await page.goto(L.URL); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && document.getElementById('scene-hint').classList.contains('show'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const h = await page.evaluate(() => { const e = document.getElementById('scene-hint'), r = e.getBoundingClientRect(), c = document.getElementById('scene-canvas').getBoundingClientRect(); return { show: e.classList.contains('show'), op: getComputedStyle(e).opacity, hint: [Math.round(r.left - c.left), Math.round(r.top - c.top), Math.round(r.width), Math.round(r.height)], canvasH: Math.round(c.height) }; });
    console.log(vp.width, JSON.stringify(h));
    const c = await page.locator('#scene-canvas').boundingBox();
    await page.screenshot({ path: L.SH + `hint-${vp.width}.png`, clip: { x: c.x, y: c.y + c.height - 80, width: Math.min(c.width, 600), height: 80 } });
    await ctx.close();
  }
  await browser.close();
})();
