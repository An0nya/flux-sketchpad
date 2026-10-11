// Point source (Mode A) and Profile focal 0.01 (Mode C): grab the stats leaf rows containing Infinity, screenshot details.
const { boot, pw } = require('./h.js');
(async () => {
  const browser = await pw.chromium.launch();
  for (const [mode, sets, shot] of [['A', [['src.kind', 'point']], 'inf-point-source.png'], ['C', [['C.f', 0.01]], 'inf-profile-f001.png']]) {
    const { ctx, page, errors } = await boot({ browser });
    await page.evaluate(([mode, sets]) => { RF.UI.setMode(mode); RF.UI.store.scene.sim.rays = 20000; for (const [id, v] of sets) RF.UI.setControl(id, v); }, [mode, sets]);
    await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(800);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#stats *, #feasibility *')].filter((e) => e.children.length === 0 && /Infinity|NaN/.test(e.textContent)).map((e) => e.parentElement.textContent.slice(0, 260)));
    console.log(mode, JSON.stringify(sets), 'mode=' + await page.evaluate(() => RF.UI.store.scene.mode)); rows.forEach((r) => console.log('   ', r));
    await page.click('#btn-details'); await page.waitForTimeout(400); await page.screenshot({ path: shot });
    console.log('   errors', [...new Set(errors)].slice(0, 2)); await ctx.close();
  }
  await browser.close();
})();
