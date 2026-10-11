const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  const r = await L.rect(page, 'left-canvas');
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.4], [r.x + r.w * 0.7, r.y + r.h * 0.6]], 40);
  await L.idle(page);
  const snap = () => page.evaluate(() => ({ solving: !!RF.UI.solving, nA: RF.UI.store.scene.groups.A.surfaces.length, dirtyA: RF.UI.store.dirty.has('A'), foot: (document.getElementById('min-row') || {}).innerText.replace(/\n/g, ' | ').slice(0, 160), notice: RF.UI.store.notices[0] && RF.UI.store.notices[0].msg }));
  console.log('before undo', JSON.stringify(await snap()));
  await page.click('#btn-undo');
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.click('#btn-stop');
  await page.waitForTimeout(1500);
  console.log('after stop', JSON.stringify(await snap()));
  await page.waitForTimeout(3000);
  console.log('3s later', JSON.stringify(await snap()));
  await page.screenshot({ path: L.DIR + '/shots/p3c_undo_stop.png' });
  // redo: does the design come back?
  await page.click('#btn-redo'); await page.waitForTimeout(300);
  console.log('after redo', JSON.stringify(await snap()));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
