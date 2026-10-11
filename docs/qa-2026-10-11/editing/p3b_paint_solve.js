const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  const r = await L.rect(page, 'left-canvas');
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.4], [r.x + r.w * 0.7, r.y + r.h * 0.6]], 40);
  await L.idle(page);
  const snap = () => page.evaluate(() => ({ solving: !!RF.UI.solving, nA: RF.UI.store.scene.groups.A.surfaces.length, run: RF.UI.run && RF.UI.run.P ? (RF.UI.run.P.surfaces || []).length : 'na', foot: (document.getElementById('min-row') || {}).innerText.replace(/\n/g, ' | ') }));
  console.log('before', JSON.stringify(await snap()));
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.7], [r.x + r.w * 0.7, r.y + r.h * 0.7]], 40);
  for (let i = 0; i < 10; i++) { console.log(JSON.stringify(await snap())); await page.waitForTimeout(300); }
  await L.idle(page);
  // undo path
  await page.click('#btn-undo');
  for (let i = 0; i < 10; i++) { console.log('U', JSON.stringify(await snap())); if (i === 6) await page.screenshot({ path: L.DIR + '/shots/p3b_undo_during.png' }); await page.waitForTimeout(300); }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
