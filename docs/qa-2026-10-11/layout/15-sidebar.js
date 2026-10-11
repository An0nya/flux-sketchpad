const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    const mob = vp.width < 500;
    const { ctx, page, errors } = await L.open({ browser, viewport: vp, mobile: mob, touch: mob });
    const st = () => page.evaluate(() => { const s = document.getElementById('sidebar').getBoundingClientRect(); return { hidden: document.body.classList.contains('side-hidden'), side: [Math.round(s.left), Math.round(s.width)], vis: getComputedStyle(sidebar).visibility, pressed: document.getElementById('btn-side').getAttribute('aria-pressed'), scrollW: document.documentElement.scrollWidth }; });
    console.log(vp.width, 'boot', JSON.stringify(await st()));
    await page.click('#btn-side'); await page.waitForTimeout(500);
    console.log(vp.width, 'toggled', JSON.stringify(await st()), JSON.stringify(await L.overflow(page)));
    await page.screenshot({ path: L.SH + `side-${vp.width}-toggled.png` });
    const c = await L.canvases(page); console.log(' canv', Object.entries(c).map(([k, v]) => k + ':' + v.css.join('x') + ' nb' + v.nonbg).join(' '));
    // in overlay mode: click on the workspace closes it
    if (vp.width <= 1024) { await page.mouse.click(40, vp.height - 200); await page.waitForTimeout(400); console.log(vp.width, 'after outside click', JSON.stringify(await st())); }
    console.log(' errors', errors);
    await ctx.close();
  }
  await browser.close();
})();
