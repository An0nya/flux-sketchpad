// known issue check in Spec views: collapse + reopen the Result pane (far field / road / drive)
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const lit = () => page.evaluate(() => { const cv = document.getElementById('heat-canvas'), g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height; const c = g.getContext('2d'); c.drawImage(cv, 0, 0); const d = c.getImageData(0, 0, g.width, g.height).data; let n = 0; for (let q = 0; q < d.length; q += 4) if (d[q] + d[q + 1] + d[q + 2] > 60) n++; return { w: cv.width, h: cv.height, bright: n }; });
  for (const disp of ['ff', 'road', 'drive']) {
    await page.evaluate((d) => RF.UI.setDisplay(d), disp); await page.waitForTimeout(1200);
    const a = await lit();
    await page.click('button[data-collapse="result"]'); await page.waitForTimeout(600);
    await page.click('button[data-collapse="result"]'); await page.waitForTimeout(1500);
    const b = await lit();
    console.log(disp, 'before', JSON.stringify(a), 'after collapse+reopen', JSON.stringify(b));
    await page.screenshot({ path: __dirname + '/p22-' + disp + '-reopened.png', clip: await page.locator('#heat-canvas').boundingBox() });
  }
  console.log('errors', errors);
  await browser.close();
})();
