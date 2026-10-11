// load a solver file while a worker solve is running (the file input's path: RF.SolverHost.load)
const H = require('./h.js');
const SRC = `RF.Solvers.register({ id: 'qa-ok', name: 'QA ok', version: '1', modes: ['paint'], settings: [], solve() { return { surfaces: [] }; } });`;
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1500);
  console.log('solving', (await st()).solving.name);
  const res = await page.evaluate((src) => RF.SolverHost.load(src).then((d) => 'loaded ' + JSON.stringify(d)).catch((e) => 'load rejected: ' + e.message), SRC);
  console.log('load result:', res.slice(0, 200));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 30000 }).catch(() => console.log('fill-fix STILL SOLVING at 30 s'));
  const s = await st(); console.log('state', JSON.stringify(s));
  console.log('qa-ok registered?', await page.evaluate(() => !!RF.Solvers.get('qa-ok')));
  console.log('errors', errors); await browser.close();
})();
