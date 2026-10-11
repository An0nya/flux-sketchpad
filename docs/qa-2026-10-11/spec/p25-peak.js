// "peak" in Spec mode: footer tile vs the far field (∞ and 25 m) vs beam quality vs the colour bar
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  for (const tgt of [2000, 25000]) {
    if (tgt !== 2000) { await page.evaluate((d) => { RF.UI.store.scene.target.distance = d; RF.UI.store.invalidate(['A', 'B', 'C', 'L']); RF.UI.afterChange(); }, tgt); await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => {}); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 }); await waitJudged(page, 240000); await page.waitForTimeout(1500); }
    console.log(JSON.stringify(await page.evaluate(() => {
      const ui = RF.UI, sc = ui.store.scene, c = ui.run.ctx, mx = (G, k) => { const M = RF.FarField.map(G, k); let m = 0; for (const x of M.cd) if (x > m) m = x; return Math.round(m); };
      const Ginf = RF.FarField.build(c, RF.Spec.gridOpts(sc, 0)), G25 = RF.FarField.build(c, RF.Spec.gridOpts(sc, 25000)), rd = RF.SpecUI.roadModel(ui);
      const tile = [...document.querySelectorAll('.tile')].find((t) => /\npeak$/.test(t.innerText) || /^[\d.]+k?\s*\n?peak/.test(t.innerText));
      return { target: sc.target.distance, footerPeak: tile && tile.innerText.replace(/\n/g, ' '), photoPeak: Math.round(ui.photo.peakCd), ffMaxInf: mx(Ginf, 0.15), ffMaxInfK05: mx(Ginf, 0.05), ffMaxInfK0745: mx(Ginf, 0.0745), tileTip: tile && tile.title, cellMm: 2 * RF.Engine.targetFrame(sc.target).half / sc.target.res, targetSize: sc.target.size, rays: c.N, ffMax25m: mx(G25, 0.15), colourbarTop: Math.round(ui.spec.top || 0), beamQualityPeak: rd.quality.peak.cd };
    })));
  }
  console.log('errors', errors);
  await browser.close();
})();
