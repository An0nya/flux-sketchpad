// change a setting mid-solve (Auto-solve on settings = off, the default): is the old-settings result applied as up to date?
const H = require('./h.js');
(async () => {
  const which = process.argv[2] || 'budget';
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1500);
  console.log('mid', JSON.stringify(await st()));
  if (which === 'budget') await page.evaluate(() => RF.UI.setControl('A.budget', 20));
  else await page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint; for (let i = 0; i < p.length; i++) p[i] = 0; p[Math.floor(p.length / 2)] = 1; RF.UI.store.invalidate(['A']); RF.UI.afterChange({ settings: true }); });
  console.log('after change', JSON.stringify(await st()), await page.evaluate(() => RF.UI.store.version));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const s = await st();
  const r = await page.evaluate(() => { const rep = RF.UI.store.reports.A; return { budgetNow: RF.UI.store.scene.modeA.budget, placed: rep.placed, facts: rep.facts && rep.facts.violations && rep.facts.violations.budget, warn: rep.warnings.slice(-2), stale: document.getElementById('btn-generate').classList.contains('stale'), title: document.getElementById('btn-generate').title }; });
  console.log('end', JSON.stringify(s), JSON.stringify(r));
  console.log('errors', errors);
  await browser.close();
})();
