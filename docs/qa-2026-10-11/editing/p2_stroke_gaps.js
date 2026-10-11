const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  await page.evaluate(() => { RF.UI.setAuto('paint', false); RF.UI.clearPaint(); });
  const b = await page.evaluate(() => ({ brush: RF.UI.store.scene.modeA.brush, res: RF.UI.store.scene.target.res, s: RF.UI.vLeft.s, mode: RF.UI.store.scene.mode }));
  console.log(JSON.stringify(b));
  const r = await L.rect(page, 'left-canvas');
  for (const steps of [40, 8, 2]) {
    await page.evaluate(() => RF.UI.clearPaint());
    await L.drag(page, [[r.x + r.w * 0.2, r.y + r.h * 0.5], [r.x + r.w * 0.8, r.y + r.h * 0.5]], steps);
    const row = await page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint, R = RF.UI.store.scene.target.res; let best = -1, bc = 0; for (let j = 0; j < R; j++) { let c = 0; for (let i = 0; i < R; i++) if (p[j * R + i] > 0) c++; if (c > bc) { bc = c; best = j; } } let s = ''; let lo = R, hi = -1; for (let i = 0; i < R; i++) { if (p[best * R + i] > 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); } } for (let i = lo; i <= hi; i++) s += p[best * R + i] > 0 ? '#' : '.'; return { row: best, span: hi - lo + 1, filled: bc, s }; });
    console.log('steps', steps, JSON.stringify(row));
  }
  await page.screenshot({ path: L.DIR + '/shots/p2.png', clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
