// load a preset (non-paint) mid-solve: old solve keeps running on the old scene, its preview overlays the new scene
const H = require('./h.js');
(async () => {
  const name = process.argv[2] || 'parabola';
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1500);
  const oldStore = await page.evaluate(() => { window.__old = RF.UI.store; return true; });
  await page.evaluate((n) => { const s = document.getElementById('preset-select'); s.value = n; s.dispatchEvent(new Event('change')); document.querySelector('#preset-confirm button.primary').click(); }, name);
  await page.waitForTimeout(800);
  const a = await st(); console.log('+0.8s', JSON.stringify(a));
  console.log('viewModel has preview polys:', await page.evaluate(() => RF.UI.watchShown()), 'new store?', await page.evaluate(() => window.__old !== RF.UI.store));
  await page.screenshot({ path: 'preset-mid-' + name + '.png' });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ oldA: window.__old.reports.A && window.__old.reports.A.solver && window.__old.reports.A.solver.id, newA: RF.UI.store.scene.groups.A.surfaces.length, newMode: RF.UI.store.scene.mode }));
  console.log('end', JSON.stringify(await st()), JSON.stringify(r));
  console.log('errors', errors.length, errors[0] || '');
  await browser.close();
})();
