const H = require('./h.js');
const SRC = require('fs').readFileSync(__dirname + '/p15_errors.js', 'utf8').split('`')[1];
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  await page.evaluate((src) => RF.SolverHost.load(src), SRC);
  const run = async (id, wait) => {
    const t = Date.now(); await start(id);
    await page.waitForFunction(() => RF.UI.solving, null, { timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: wait || 20000 }).catch(() => console.log('  ' + id + ' STILL SOLVING'));
    await page.waitForTimeout(300);
    const s = await st(), x = await page.evaluate(() => ({ surf: RF.UI.store.scene.groups.A.surfaces.length, placed: RF.UI.store.reports.A.placed, details: (document.querySelector('#limits, .limits, #details') || {}).textContent }));
    console.log(id, Date.now() - t, 'ms |', s.status, '| repErr', s.repErr, '| A surfaces', x.surf, 'report.placed', x.placed, '| fail:', s.fail ? await page.evaluate(() => document.getElementById('solve-fail').textContent.slice(0, 110)) : '-');
  };
  await run('patch-array');
  await page.evaluate(() => RF.SolverHost.testBudget(2000));
  await run('qa-spin');
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  await run('qa-badout');
  await run('qa-throw');
  await run('patch-array');
  await run('qa-async-crash', 8000);
  await run('patch-array');
  console.log('workers', workers.size, 'errors', errors);
  await browser.close();
})();
