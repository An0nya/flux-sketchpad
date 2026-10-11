// solver errors: sync throw, async uncaught throw (worker onerror → 'crash'), infinite loop under a short budget; and what the NEXT solve does
const H = require('./h.js');
const SRC = `
RF.Solvers.register({ id: 'qa-throw', name: 'QA throw', version: '1', modes: ['paint'], settings: [], solve() { throw new Error('qa boom'); } });
RF.Solvers.register({ id: 'qa-async-crash', name: 'QA async crash', version: '1', modes: ['paint'], settings: [], solve() { setTimeout(() => { throw new Error('qa async boom'); }, 50); return new Promise(() => {}); } });
RF.Solvers.register({ id: 'qa-spin', name: 'QA spin', version: '1', modes: ['paint'], settings: [], solve() { for (;;) {} } });
RF.Solvers.register({ id: 'qa-badout', name: 'QA bad output', version: '1', modes: ['paint'], settings: [], solve() { return { surfaces: [{ id: 'x', fn() {} }] }; } });
`;
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot();
  const defs = await page.evaluate((src) => RF.SolverHost.load(src).then((d) => d.map((x) => x.id)), SRC);
  console.log('loaded', defs);
  const run = async (id, wait) => {
    const t = Date.now(); await start(id);
    await page.waitForFunction(() => RF.UI.solving, null, { timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: wait || 20000 }).catch(() => console.log('  ' + id + ' STILL SOLVING'));
    await page.waitForTimeout(300);
    const s = await st();
    console.log(id, Date.now() - t, 'ms |', s.status, '| repSolver', s.repSolver, '| repErr', s.repErr, '| fail:', s.fail ? await page.evaluate(() => document.getElementById('solve-fail').textContent.slice(0, 160)) : '-', '| notices', JSON.stringify(s.notices.slice(0, 2)));
  };
  await run('qa-throw');
  await run('patch-array');
  await run('qa-async-crash', 8000);
  await run('patch-array');
  await run('patch-array');
  await page.evaluate(() => RF.SolverHost.testBudget(2000));
  await run('qa-spin');
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  await run('patch-array');
  await run('qa-badout');
  await run('patch-array');
  console.log('workers', workers.size, 'errors', errors);
  await browser.close();
})();
