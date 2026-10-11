const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    const mob = vp.width < 500;
    const { ctx, page, errors } = await L.open({ browser, viewport: vp, mobile: mob, touch: mob });
    await page.click('#btn-details'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const d = document.getElementById('stats-full'), b = d.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), sh: d.scrollHeight, ch: d.clientHeight, vh: innerHeight, docH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth }; });
    console.log(vp.width, JSON.stringify(r), JSON.stringify((await L.overflow(page)).offRight));
    await page.screenshot({ path: L.SH + `details-${vp.width}.png` });
    await ctx.close();
  }
  await browser.close();
})();
