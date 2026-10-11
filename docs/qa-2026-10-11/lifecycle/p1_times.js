const H = require('./h.js');
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  for (const id of ['fill-fix', 'sqm', 'haiku55-spots', 'patch-array', 'tir-array-v2', 'opus-mosaic']) {
    const t = Date.now(); await start(id, id === 'tir-array-v2' ? { calib: 1, calibRays: 100000 } : {});
    await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 130000 }).catch(() => {});
    const s = await st(); console.log(id, Date.now() - t, 'ms', s.repSolver, s.repErr || '', s.notices[0] || '');
  }
  console.log('workers', workers.size, 'errors', errors);
  await browser.close();
})();
