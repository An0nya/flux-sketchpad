const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const [name, vp, scheme, mob] of [['1500', { width: 1500, height: 950 }, 'dark'], ['1280', { width: 1280, height: 720 }, 'dark'], ['768', { width: 768, height: 1024 }, 'dark'], ['375', { width: 375, height: 812 }, 'dark', true], ['1500-light', { width: 1500, height: 950 }, 'light'], ['375-light', { width: 375, height: 812 }, 'light', true]]) {
    const { ctx, page, errors } = await L.open({ browser, viewport: vp, colorScheme: scheme, mobile: mob, touch: mob });
    await page.screenshot({ path: L.SH + 'base-' + name + '.png' });
    const st = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, layout: JSON.stringify(RF.UI.layout), side: !document.body.classList.contains('side-hidden') }));
    console.log('== ' + name, JSON.stringify(st));
    console.log(' canvases', JSON.stringify(await L.canvases(page)));
    console.log(' overflow', JSON.stringify(await L.overflow(page)));
    console.log(' errors', errors);
    await ctx.close();
  }
  await browser.close();
})();
