const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps');
  await L.idle(page);
  const S = () => page.evaluate(() => { const sc = RF.UI.store.scene, T = RF.Engine.targetFrame(sc.target); return { mode: sc.mode, half: T.half, sel: sc.modeB.selected, stamps: sc.modeB.stamps.map((s) => ({ id: s.id, u: +s.u.toFixed(1), v: +s.v.toFixed(1), scale: +s.scale.toFixed(2), th: s.th && +s.th.toFixed(1), ph: s.ph && +s.ph.toFixed(1), dm: s.dirMode })), nB: sc.groups.B.surfaces.length, rep: (RF.UI.store.reports.B || {}).stamps ? RF.UI.store.reports.B.stamps.map((x) => x.ok) : null }; });
  console.log('loaded', JSON.stringify(await S()));
  const h = await L.rect(page, 'heat-canvas');
  await L.activate(page, 'heat-canvas');
  // tap to place in an empty spot
  await page.mouse.click(h.x + h.w * 0.15, h.y + h.h * 0.15); await page.waitForTimeout(300);
  let s = await S(); console.log('after tap', JSON.stringify(s));
  // drag the newest stamp far off the target edge and release outside canvas
  const last = s.stamps[s.stamps.length - 1];
  const scr = await page.evaluate((id) => { const sc = RF.UI.store.scene, st = sc.modeB.stamps.find((t) => t.id === id), T = RF.Engine.targetFrame(sc.target); const c = RF.Render2D ? null : null; const cc = RF.Render2D && RF.Render2D.uvToCell ? RF.Render2D.uvToCell(T, st.u, st.v) : null; return cc ? RF.UI.vHeat.toScreen(cc[0], cc[1]) : null; }, last.id);
  console.log('stamp screen', scr);
  const bx = h.x + scr[0], by = h.y + scr[1];
  await L.drag(page, [[bx, by], [h.x - 150, h.y - 60]], 20);
  await page.waitForTimeout(400);
  s = await S(); console.log('after drag off edge', JSON.stringify(s));
  await page.screenshot({ path: L.DIR + '/shots/p4_offedge.png' });
  await L.idle(page);
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
