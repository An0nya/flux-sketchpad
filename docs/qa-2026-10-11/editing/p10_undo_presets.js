// For each preset: load, make 3 distinct edits (envelope keepOut-free: use sim bounces? use target distance via action), then press Undo 4x, record toasts
const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  for (const name of ['parabola', 'cpc', 'stamps', 'tir', 'fresnel', 'headlamp']) {
    await L.loadPreset(page, name); await L.idle(page); await page.waitForTimeout(300);
    const d0 = await page.evaluate(() => RF.UI.store.scene.target.distance);
    for (let i = 1; i <= 3; i++) { await page.evaluate((d) => { RF.Controller.actions.setTargetDistance(RF.UI.store, d); RF.UI.afterChange(); }, d0 + 100 * i); await page.waitForTimeout(400); await L.idle(page); }
    const toasts = [];
    for (let i = 0; i < 4; i++) { await page.click('#btn-undo'); await page.waitForTimeout(250); await L.idle(page).catch(() => {}); toasts.push((await page.evaluate(() => document.getElementById('toast').textContent)) + ' [d=' + (await page.evaluate(() => RF.UI.store.scene.target.distance)) + ']'); }
    console.log(name, 'd0=' + d0, JSON.stringify(toasts));
  }
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
