const L = require('./lib');
(async () => {
  const { browser, page, errors, title } = await L.open();
  const st = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, res: RF.UI.store.scene.target.res, painted: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, nA: RF.UI.store.scene.groups.A.surfaces.length, autoA: RF.UI.store.autoA, solver: RF.Solvers.current(RF.UI.store.scene) }));
  console.log('title', title, JSON.stringify(st));
  await L.setMode(page, 'A');
  await page.evaluate(() => RF.UI.clearPaint()); await L.idle(page);
  const r = await L.rect(page, 'left-canvas'); console.log('left', JSON.stringify(r));
  // first press on inactive pane: swallowed?
  const act0 = await page.evaluate(() => document.getElementById('left-canvas').closest('.pane').classList.contains('active'));
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.5], [r.x + r.w * 0.7, r.y + r.h * 0.5]]);
  const c1 = await page.evaluate(() => RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length);
  console.log('activeBefore', act0, 'painted after first drag', c1);
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.5], [r.x + r.w * 0.7, r.y + r.h * 0.5]]);
  const c2 = await page.evaluate(() => ({ n: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, solving: !!RF.UI.solving, pend: RF.UI.pendingA }));
  console.log('after second drag', JSON.stringify(c2));
  await L.idle(page);
  const c3 = await page.evaluate(() => ({ nA: RF.UI.store.scene.groups.A.surfaces.length, dirty: [...RF.UI.store.dirty], past: RF.UI.hist.past.map((e) => e.label) }));
  console.log('after solve', JSON.stringify(c3));
  // drag off the canvas edge and release outside the window area of the canvas
  await L.drag(page, [[r.x + r.w * 0.5, r.y + r.h * 0.8], [r.x + r.w * 0.5, r.y + r.h + 80], [r.x - 100, r.y + r.h + 80]]);
  const c4 = await page.evaluate(() => ({ n: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, interacting: RF.UI.interacting, painted: RF.UI.painted, brushAt: RF.UI.brushAt }));
  console.log('after drag-out', JSON.stringify(c4));
  await L.idle(page);
  // undo the last paint stroke
  await page.click('#btn-undo'); await page.waitForTimeout(300);
  const c5 = await page.evaluate(() => ({ n: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, toast: (document.getElementById('toast') || {}).textContent }));
  console.log('after undo', JSON.stringify(c5));
  await page.screenshot({ path: L.DIR + '/shots/p1.png' });
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
