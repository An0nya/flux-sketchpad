const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps'); await L.idle(page);
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, marks: RF.UI.pickMarks.length, stamps: RF.UI.store.scene.modeB.stamps.length }));
  console.log(JSON.stringify(st));
  const r = await L.rect(page, 'left-canvas');
  await page.screenshot({ path: L.DIR + '/shots/p5_picker.png', clip: { x: r.x - 10, y: r.y - 60, width: r.w + 20, height: r.h + 120 } });
  // try dragging where the selected stamp's mark should be: centre region
  await L.drag(page, [[r.x + r.w / 2, r.y + r.h / 2], [r.x + r.w * 0.7, r.y + r.h * 0.3]], 10);
  const st2 = await page.evaluate(() => RF.UI.store.scene.modeB.stamps.map((s) => [s.id, s.dirMode, s.th, s.ph]));
  console.log(JSON.stringify(st2));
  // switch to A and back to B: does the error stop? and to C
  await L.setMode(page, 'C'); await page.waitForTimeout(200);
  const n1 = errors.length; await page.waitForTimeout(500); console.log('errors growing in C?', errors.length - n1);
  await L.setMode(page, 'B'); await page.waitForTimeout(500);
  console.log('total errors', errors.length, 'unique', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
