const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({ viewport: { width: 1500, height: 950 } });
  await page.waitForTimeout(3000);
  const st = () => page.evaluate(() => document.getElementById('progress-strip').className);
  console.log('idle', await st());
  await page.screenshot({ path: L.SH + 'strip-a.png', clip: { x: 0, y: 0, width: 600, height: 100 } });
  console.log('after shot', await st());
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(100);
  console.log('100ms after collapse', await st());
  await browser.close();
})();
