const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  const o = await L.rect(page, 'surface-canvas');
  await L.activate(page, 'surface-canvas');
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  const z = await page.evaluate(() => ({ scale: RF.UI.camS.scale, pan: RF.UI.camS.pan, h: RF.UI.handlesS.slice(0, 2).map((h) => [h.id, h.x, h.y]) }));
  console.log('zoomed out', JSON.stringify(z));
  // now drag from the centre (where all handles collapse) a little
  const src0 = await page.evaluate(() => RF.UI.store.scene.source.pos.slice());
  await L.drag(page, [[o.x + z.h[0][1], o.y + z.h[0][2]], [o.x + z.h[0][1] + 5, o.y + z.h[0][2] + 3]], 3); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ src: RF.UI.store.scene.source.pos, env: RF.UI.store.scene.envelope.half, activeLast: RF.UI.hist.past.slice(-1)[0].label }));
  console.log('src before', JSON.stringify(src0), 'after 6px drag', JSON.stringify(after));
  await page.screenshot({ path: L.DIR + '/shots/p16b_zoom30.png' });
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
