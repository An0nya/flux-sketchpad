const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  await page.evaluate(() => RF.UI.setPane('editor', 'activate')); await page.waitForTimeout(300);
  const sum = () => page.evaluate(() => { let s = 0, n = 0; for (const v of RF.UI.store.scene.modeA.paint) { s += v; if (v > 0) n++; } return { sum: +s.toFixed(2), cells: n, undo: !document.getElementById('btn-undo').disabled, past: RF.UI.hist.past.length }; });
  // zoom first so reset has something to do
  const lb = await page.locator('#left-canvas').boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(300);
  console.log('before', JSON.stringify(await sum()), 'zoomed', await page.evaluate(() => RF.UI.vLeft.zoomed));
  await page.mouse.dblclick(lb.x + lb.width * 0.15, lb.y + lb.height * 0.25); await page.waitForTimeout(800);
  console.log('after dblclick', JSON.stringify(await sum()), 'zoomed', await page.evaluate(() => RF.UI.vLeft.zoomed));
  await page.screenshot({ path: L.SH + 'dblclick-paint.png', clip: { x: lb.x - 10, y: lb.y - 10, width: lb.width + 20, height: lb.height + 20 } });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  console.log('solving triggered?', await page.evaluate(() => RF.UI.lastGenMs));
  console.log(errors); await browser.close();
})();
