// Touch pinch in the Paint editor via CDP Input.dispatchTouchEvent (real touch → pointer events in Chromium)
const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({ touch: true });
  await L.setMode(page, 'A');
  await page.evaluate(() => { RF.UI.setAuto('paint', false); RF.UI.clearPaint(); });
  const r = await L.rect(page, 'left-canvas');
  const cdp = await page.context().newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] !== undefined ? p[2] : i })) });
  const S = () => page.evaluate(() => ({ painted: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, s: +RF.UI.vLeft.s.toFixed(3), past: RF.UI.hist.past.length + ':' + RF.UI.hist.past.slice(-1)[0].label, dirtyA: RF.UI.store.dirty.has('A'), interacting: RF.UI.interacting }));
  console.log('start', JSON.stringify(await S()));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  // finger 1 down, finger 2 down 40 ms later, spread apart, lift both
  await T('touchStart', [[cx - 20, cy, 0]]);
  await page.waitForTimeout(40);
  await T('touchStart', [[cx - 20, cy, 0], [cx + 20, cy, 1]]);
  for (let k = 1; k <= 10; k++) await T('touchMove', [[cx - 20 - 6 * k, cy, 0], [cx + 20 + 6 * k, cy, 1]]);
  await T('touchEnd', [[cx + 80, cy, 1]]);
  await T('touchEnd', []);
  await page.waitForTimeout(500);
  console.log('after pinch', JSON.stringify(await S()));
  await page.screenshot({ path: L.DIR + '/shots/p23_pinch.png', clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
