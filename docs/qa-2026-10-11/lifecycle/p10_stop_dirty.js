// edit the painting (auto-solve on painting = on) → solve starts → Stop: is the old design reported as up to date?
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st } = await H.boot();
  await page.evaluate(() => { const sc = RF.UI.store.scene; sc.solve = { id: 'fill-fix' }; RF.UI.generateA(); });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.store.reports.A && RF.UI.store.reports.A.solver.id === 'fill-fix', null, { timeout: 60000 });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 });
  // paint edit through the app's own path (afterChange without settings: the 'painting' auto switch)
  await page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint; for (let i = 0; i < p.length; i++) p[i] = 0; const r = RF.UI.store.scene.target.res; p[Math.floor(r / 2) * r + Math.floor(r / 2)] = 1; RF.UI.store.invalidate(['A']); RF.UI.afterChange(); });
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 });
  await page.waitForTimeout(1000);
  console.log('solving', JSON.stringify((await st()).solving));
  await page.click('#btn-stop');
  const seen = [];
  for (let i = 0; i < 10; i++) { const s = await st(); seen.push(s.status); await page.waitForTimeout(100); }
  const s = await st();
  console.log('status sequence', JSON.stringify([...new Set(seen)]));
  console.log('after stop: dirtyA', s.dirtyA, 'stale btn', await page.evaluate(() => document.getElementById('btn-generate').classList.contains('stale')), 'fail notice', s.fail, await page.evaluate(() => (document.getElementById('solve-fail') || {}).textContent));
  await page.screenshot({ path: 'stop-uptodate.png' });
  console.log('errors', errors); await browser.close();
})();
