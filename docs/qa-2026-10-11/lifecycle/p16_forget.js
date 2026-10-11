// "Forget loaded" mid-solve (bundled solver running, a user file loaded), then solves afterwards
const H = require('./h.js');
const SRC = `RF.Solvers.register({ id: 'qa-slow', name: 'QA slow', version: '1', modes: ['paint'], settings: [], solve(i, s, tools) { const t = Date.now(); while (Date.now() - t < 4000) {} return { surfaces: [] }; } });`;
(async () => {
  const which = process.argv[2] || 'bundled';
  const { browser, page, errors, workers, st, start } = await H.boot();
  await page.evaluate((src) => RF.SolverHost.load(src), SRC);
  await start(which === 'bundled' ? 'fill-fix' : 'qa-slow'); await page.waitForTimeout(1200);
  console.log('solving', (await st()).solving.name);
  await page.evaluate(() => [...document.querySelectorAll('#solver-files button')].find((b) => /Forget loaded/.test(b.textContent)).click());
  await page.waitForTimeout(400);
  console.log('+0.4', JSON.stringify(await st()));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 30000 }).catch(() => console.log('STILL SOLVING at 30 s'));
  const s = await st(); console.log('end', JSON.stringify(s), 'qa-slow registered?', await page.evaluate(() => !!RF.Solvers.get('qa-slow')));
  const t = Date.now(); await start('patch-array');
  await page.waitForFunction(() => RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id === 'patch-array' && !RF.UI.solving, null, { timeout: 20000 }).then(() => console.log('next solve ok', Date.now() - t, 'ms')).catch(async () => console.log('NEXT SOLVE FAILED/HUNG', JSON.stringify(await st())));
  console.log('workers', workers.size, 'errors', errors); await browser.close();
})();
