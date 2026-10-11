const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({ viewport: { width: 375, height: 812 }, mobile: true, touch: true });
  const v = () => page.evaluate(() => ({ active: RF.UI.layout.active, s: RF.UI.vLeft.s, hs: RF.UI.vHeat.s }));
  // pan the editor map with shift-drag is mouse-only; use a two-finger pinch via CDP touch
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('#left-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[cx - 30, cy], [cx + 30, cy]]) });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[cx - 30 - i * 10, cy], [cx + 30 + i * 10, cy]]) }); await page.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  console.log('after pinch', JSON.stringify(await v()), JSON.stringify((await L.canvases(page))['left-canvas']));
  await page.screenshot({ path: L.SH + 'phone-1pinched.png' });
  await page.click('button[data-tab="result"]'); await page.waitForTimeout(600);
  console.log('on result tab', JSON.stringify(await v()), JSON.stringify((await L.canvases(page))['heat-canvas']));
  await page.screenshot({ path: L.SH + 'phone-2result.png' });
  await page.click('button[data-tab="editor"]'); await page.waitForTimeout(600);
  console.log('back on editor', JSON.stringify(await v()), JSON.stringify((await L.canvases(page))['left-canvas']));
  await page.screenshot({ path: L.SH + 'phone-3editor-back.png' });
  for (const t of ['scene', 'optics']) { await page.click(`button[data-tab="${t}"]`); await page.waitForTimeout(800); const c = await L.canvases(page); console.log(t, JSON.stringify(c[t === 'scene' ? 'scene-canvas' : 'surface-canvas'])); await page.screenshot({ path: L.SH + 'phone-tab-' + t + '.png' }); }
  console.log(errors); await browser.close();
})();
