const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'parabola'); await L.idle(page);
  const S = () => page.evaluate(() => { const sc = RF.UI.store.scene, mc = sc.modeC; const sv = sc.groups.C.surfaces; let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const s of sv) for (const p of (s.verts || s.poly || (s.P ? [s.P] : []))) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    return { mode: sc.mode, n: mc.profile.length, pts: mc.profile.slice(0, 4).map((p) => p.map((x) => +x.toFixed(1))), last: mc.profile.length && mc.profile[mc.profile.length - 1].map((x) => +x.toFixed(1)), sel: RF.UI.profSel, nC: sv.length, bb: [lo.map(Math.round), hi.map(Math.round)], env: [sc.envelope.center, sc.envelope.half], handles: RF.UI.profHandles.length, sweep: mc.sweep, keys: sv[0] && Object.keys(sv[0]).join(',') }; });
  let s = await S(); console.log('start', JSON.stringify(s));
  const r = await L.rect(page, 'left-canvas');
  const hs = await page.evaluate(() => RF.UI.profHandles.map((h) => [h.i, h.x, h.y]));
  console.log('handles', JSON.stringify(hs.slice(0, 3)), '...', JSON.stringify(hs.slice(-2)));
  const h0 = hs[hs.length - 1];
  // drag the last point off the canvas to the far left (negative x in revolve) and release outside the canvas
  await L.drag(page, [[r.x + h0[1], r.y + h0[2]], [r.x - 200, r.y - 100]], 15); await page.waitForTimeout(500);
  s = await S(); console.log('after drag out', JSON.stringify(s));
  await page.screenshot({ path: L.DIR + '/shots/p8_drag_out.png' });
  // tap empty spot to add a point
  await page.mouse.click(r.x + r.w * 0.9, r.y + r.h * 0.1); await page.waitForTimeout(400);
  s = await S(); console.log('after tap add', JSON.stringify(s));
  // rapid taps
  for (let i = 0; i < 8; i++) await page.mouse.click(r.x + r.w * (0.2 + 0.07 * i), r.y + r.h * 0.85);
  await page.waitForTimeout(500);
  s = await S(); console.log('after 8 rapid taps', JSON.stringify(s));
  await page.screenshot({ path: L.DIR + '/shots/p8_rapid.png' });
  // undo all the way back a few steps
  for (let i = 0; i < 3; i++) { await page.click('#btn-undo'); await page.waitForTimeout(200); }
  s = await S(); console.log('after 3 undo', JSON.stringify(s));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
