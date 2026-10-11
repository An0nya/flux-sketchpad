// node shoot.js <label>: screenshots Paint + Spec(ff/drive) at 3 viewports into shots-<label>/
const L = require('./lib'); const label = process.argv[2]; const dir = __dirname + '/shots-' + label + '/'; require('fs').mkdirSync(dir, { recursive: true });
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }, { width: 375, height: 812 }]) {
    const mob = vp.width < 500;
    const { ctx, page } = await L.open({ browser, viewport: vp, mobile: mob, touch: mob });
    await page.screenshot({ path: dir + vp.width + '-paint.png' });
    await page.evaluate(() => RF.UI.setMode('D')); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(1000);
    if (mob) { await page.evaluate(() => RF.UI.setPane('result', 'activate')); await page.waitForTimeout(400); }
    for (const d of ['ff', 'drive']) { await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(1200); await page.screenshot({ path: dir + vp.width + '-spec-' + d + '.png' }); }
    await ctx.close();
  }
  await browser.close();
})();
