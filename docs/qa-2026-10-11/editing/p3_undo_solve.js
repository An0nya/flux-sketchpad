const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  const r = await L.rect(page, 'left-canvas');
  await L.drag(page, [[r.x + r.w * 0.3, r.y + r.h * 0.4], [r.x + r.w * 0.7, r.y + r.h * 0.6]], 40);
  await L.idle(page);
  const snap = () => page.evaluate(() => ({ t: Math.round(performance.now()), solving: !!RF.UI.solving, nA: RF.UI.store.scene.groups.A.surfaces.length, modelSurf: RF.UI.model && RF.UI.model.surfaces ? RF.UI.model.surfaces.length : null, dirtyA: RF.UI.store.dirty.has('A'), status: document.getElementById('run-state').textContent, facetsStat: (document.getElementById('min-row') || {}).innerText }));
  console.log('before undo', JSON.stringify(await snap()));
  await page.click('#btn-undo');
  for (let i = 0; i < 12; i++) { console.log(JSON.stringify(await snap())); if (i === 2) await page.screenshot({ path: L.DIR + '/shots/p3_during.png' }); await page.waitForTimeout(250); }
  await L.idle(page);
  console.log('end', JSON.stringify(await snap()));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
