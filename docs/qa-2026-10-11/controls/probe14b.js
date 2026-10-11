// Control for probe14: same r=0.5 dome but z=0 (valid), and z=0.475 (max valid).
const { boot, pw } = require('./h.js');
(async () => { const browser = await pw.chromium.launch();
  for (const z of [0, 0.475, 2.85]) { const { ctx, page } = await boot({ browser });
    const r = await page.evaluate(async (z) => { RF.UI.setControl('src.domeR', 3); RF.UI.setControl('src.domeZ', z); RF.UI.setControl('src.domeR', 0.5); if (z <= 0.475) RF.UI.setControl('src.domeZ', z); RF.UI.store.scene.sim.rays = 50000; RF.UI.requestRun(false); await new Promise((r) => setTimeout(r, 4000)); return JSON.stringify(RF.UI.store.scene.source.dome) + ' ' + document.getElementById('footer').innerText.replace(/\s+/g, ' ').slice(0, 70); }, z);
    console.log('z', z, r); await ctx.close(); }
  await browser.close(); })();
