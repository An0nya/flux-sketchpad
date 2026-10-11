// leftover ui.pendingA after a superseded worker solve → a later setting change auto-solves although Auto-solve on settings is off
const H = require('./h.js');
(async () => {
  const control = process.argv[2] === 'control';
  const { browser, page, errors, st, start } = await H.boot();
  if (control) { await start('spoke'); await page.waitForTimeout(1500); }
  else {
    await start('fill-fix'); await page.waitForTimeout(1500);
    await page.evaluate(() => { const s = document.querySelector('#solver-box select[aria-label=Solver]'); s.value = 'spoke'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(1000);
  }
  const a = await st(); console.log('settled', a.solver, 'pendingA', a.pendingA, 'dirtyA', a.dirtyA, 'autoSet', await page.evaluate(() => RF.UI.store.autoSet));
  const r0 = await page.evaluate(() => { window.__rep = RF.UI.store.reports.A; return RF.UI.store.reports.A.placed; });
  await page.evaluate(() => RF.UI.setControl('A.budget', 30));
  await page.waitForTimeout(1500);
  const b = await st(), same = await page.evaluate(() => window.__rep === RF.UI.store.reports.A);
  console.log(control ? 'CONTROL' : 'LEAK', 'after setting change: dirtyA', b.dirtyA, 'status', b.status, 'report replaced (re-solved)', !same, 'stale btn', await page.evaluate(() => document.getElementById('btn-generate').classList.contains('stale')));
  console.log('errors', errors); await browser.close();
})();
