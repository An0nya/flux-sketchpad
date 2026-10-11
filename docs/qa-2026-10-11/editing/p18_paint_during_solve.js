const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  await page.evaluate(() => { window.__applied = []; const C = RF.Controller; const orig = C.applyCandidate; });
  const r = await L.rect(page, 'left-canvas');
  // stroke 1 → solve starts; during it, stroke 2, then a source drag in Optics, then stroke 3 released outside the canvas
  await L.drag(page, [[r.x + r.w * 0.2, r.y + r.h * 0.2], [r.x + r.w * 0.4, r.y + r.h * 0.2]], 30);
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await L.drag(page, [[r.x + r.w * 0.2, r.y + r.h * 0.8], [r.x + r.w * 0.8, r.y + r.h * 0.8]], 30);
  const o = await L.rect(page, 'surface-canvas');
  await L.activate(page, 'surface-canvas');
  const h = await page.evaluate(() => { const s = RF.UI.handlesS.find((x) => x.id === 'src'); return [s.x, s.y]; });
  await L.drag(page, [[o.x + h[0], o.y + h[1]], [o.x + h[0] + 4, o.y + h[1] - 4]], 5);
  await L.activate(page, 'left-canvas');
  await L.drag(page, [[r.x + r.w * 0.8, r.y + r.h * 0.3], [r.x + r.w + 60, r.y + r.h * 0.3]], 20);
  const paintKey = await page.evaluate(() => RF.UI.store.scene.modeA.paint.reduce((a, x, i) => a + x * (i % 97 + 1), 0));
  await L.idle(page, 180000); await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ dirty: [...RF.UI.store.dirty], nA: RF.UI.store.scene.groups.A.surfaces.length, status: document.getElementById('run-state').textContent, version: RF.UI.store.version, paintKey: RF.UI.store.scene.modeA.paint.reduce((a, x, i) => a + x * (i % 97 + 1), 0), notices: RF.UI.store.notices.slice(0, 3).map((n) => n.msg.slice(0, 100)), past: RF.UI.hist.past.slice(-5).map((e) => e.label) }));
  console.log('paintKey at last edit', paintKey, JSON.stringify(st));
  // Is the applied design for the latest paint? Re-solve deterministically and compare facet count
  await page.evaluate(() => RF.UI.generateA()); await page.waitForTimeout(300); await L.idle(page);
  console.log('after explicit rebuild nA', await page.evaluate(() => RF.UI.store.scene.groups.A.surfaces.length));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
