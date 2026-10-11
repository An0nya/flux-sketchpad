// review: an UNdisturbed solve must still be applied (guards against G06 dropping every result)
const H = require('./h.js');
(async () => {
  const { browser, page, start } = await H.boot();
  const boot = await page.evaluate(() => ({ v: RF.UI.store.version, dirtyA: RF.UI.store.dirty.has('A'), n: RF.UI.store.scene.groups.A.surfaces.length, solver: RF.Solvers.current(RF.UI.store.scene) }));
  console.log('after boot solve', JSON.stringify(boot));
  for (const id of ['fill-fix', 'tir-array-v2']) {
    await start(id); await page.waitForTimeout(300);
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(500);
    console.log(id, JSON.stringify(await page.evaluate(() => ({ v: RF.UI.store.version, dirtyA: RF.UI.store.dirty.has('A'), n: RF.UI.store.scene.groups.A.surfaces.length, rep: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, stale: document.getElementById('btn-generate').classList.contains('stale') }))));
  }
  await browser.close();
})();
