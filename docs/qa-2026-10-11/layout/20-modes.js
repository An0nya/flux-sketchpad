const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    const mob = vp.width < 500;
    const { ctx, page, errors } = await L.open({ browser, viewport: vp, mobile: mob, touch: mob });
    for (const m of ['B', 'C', 'D']) {
      await page.evaluate((m) => RF.UI.setMode(m), m);
      await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
      await page.waitForTimeout(1200);
      if (mob) { await page.evaluate(() => RF.UI.setPane('result', 'activate')); await page.waitForTimeout(400); }
      const mode = await page.evaluate(() => RF.UI.store.scene.mode);
      const ov = await L.overflow(page);
      console.log(vp.width, 'mode', mode, JSON.stringify({ clipped: ov.clipped, off: ov.offRight, scrollW: ov.scrollW }));
      const c = await L.canvases(page); console.log('  canv', Object.entries(c).map(([k, v]) => k + ':' + v.css.join('x') + ' nb' + v.nonbg).join(' '));
      await page.screenshot({ path: L.SH + `mode-${vp.width}-${m}.png` });
      if (mob) { await page.evaluate(() => RF.UI.setPane('editor', 'activate')); await page.waitForTimeout(400); await page.screenshot({ path: L.SH + `mode-${vp.width}-${m}-editor.png` }); }
    }
    // Spec: cycle displays
    for (const d of ['road', 'drive', 'ff']) {
      await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(1500);
      if (mob) { await page.evaluate(() => RF.UI.setPane('result', 'activate')); await page.waitForTimeout(400); }
      const ov = await L.overflow(page);
      console.log(vp.width, 'D disp', d, JSON.stringify({ clipped: ov.clipped, scrollW: ov.scrollW }), 'heat nb', (await L.canvases(page))['heat-canvas'].nonbg);
      await page.screenshot({ path: L.SH + `disp-${vp.width}-${d}.png` });
    }
    console.log(' errors', errors);
    await ctx.close();
  }
  await browser.close();
})();
