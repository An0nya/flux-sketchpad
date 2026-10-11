const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));   // keep solves out of the way
  const S = () => page.evaluate(() => { const sc = RF.UI.store.scene, e = sc.envelope; const inside = (p) => [0, 1, 2].every((k) => Math.abs(p[k] - e.center[k]) <= e.half[k] + 1e-9); return { src: sc.source.pos.map((x) => +x.toFixed(1)), inEnv: inside(sc.source.pos), env: { c: e.center.map((x) => +x.toFixed(1)), h: e.half.map((x) => +x.toFixed(2)) }, tgt: +sc.target.distance.toFixed(3), axis: sc.source.axis.map((x) => +x.toFixed(3)), past: RF.UI.hist.past.slice(-1).map((x) => x.label) }; });
  console.log('start', JSON.stringify(await S()));
  const o = await L.rect(page, 'surface-canvas');
  await L.activate(page, 'surface-canvas');
  const H = () => page.evaluate(() => RF.UI.handlesS.map((h) => ({ id: h.id, axis: h.axis, sign: h.sign, x: +h.x.toFixed(1), y: +h.y.toFixed(1), label: h.label })));
  const hs = await H(); console.log('optics handles', JSON.stringify(hs));
  const src = hs.find((h) => h.id === 'src');
  // drag the source far away (well outside the envelope) and release outside the canvas
  await L.drag(page, [[o.x + src.x, o.y + src.y], [o.x + o.w + 150, o.y - 80]], 25); await page.waitForTimeout(400);
  console.log('after src drag out', JSON.stringify(await S()));
  await page.screenshot({ path: L.DIR + '/shots/p11_src_out.png' });
  // drag an envelope face across the opposite face
  const hs2 = await H(); const f = hs2.find((h) => h.id === 'env' && h.sign > 0), g = hs2.find((h) => h.id === 'env' && h.axis === f.axis && h.sign < 0);
  console.log('face', JSON.stringify(f), 'opposite', JSON.stringify(g));
  await L.drag(page, [[o.x + f.x, o.y + f.y], [o.x + g.x + 3 * (g.x - f.x), o.y + g.y + 3 * (g.y - f.y)]], 25); await page.waitForTimeout(400);
  console.log('after face past opposite', JSON.stringify(await S()));
  // undo twice
  await page.click('#btn-undo'); await page.waitForTimeout(300); console.log('undo1', JSON.stringify(await S()), await page.evaluate(() => document.getElementById('toast').textContent));
  await page.click('#btn-undo'); await page.waitForTimeout(300); console.log('undo2', JSON.stringify(await S()), await page.evaluate(() => document.getElementById('toast').textContent));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
