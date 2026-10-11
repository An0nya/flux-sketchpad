// G31 regression (Playwright): node tests/regress/G31-envelope-min-thickness.js [port]
// Dragging an envelope face past its opposite face must stop at a small minimum thickness (not shrink geometrically to ~0), keep the opposite
// face where it was, and let the face come back out when the drag reverses.  Needs: python3 tests/serve.py 8831
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8831);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
async function open(opts) {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, hasTouch: !!(opts && opts.touch) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.UI.vLeft)));
  return { browser, ctx, page, errors };
}
(async () => {
  const { browser, page, errors } = await open();
  await page.evaluate(() => { RF.UI.setAuto('paint', false); });
  const o = await page.evaluate(() => { const b = document.getElementById('surface-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.evaluate(() => RF.UI.setPane('optics', 'activate')); await page.waitForTimeout(400);
  const hs = await page.evaluate(() => RF.UI.handlesS.map((h) => ({ id: h.id, axis: h.axis, sign: h.sign, x: h.x, y: h.y })));
  const f = hs.find((h) => h.id === 'env' && h.sign > 0), g = hs.find((h) => h.id === 'env' && h.axis === f.axis && h.sign < 0);
  ok('found two opposite envelope face handles', !!f && !!g, JSON.stringify(hs.filter((h) => h.id === 'env')));
  const E = () => page.evaluate((ax) => { const e = RF.UI.store.scene.envelope; return { lo: e.center[ax] - e.half[ax], hi: e.center[ax] + e.half[ax], w: 2 * e.half[ax] }; }, f.axis);
  const e0 = await E();
  await page.mouse.move(o.x + f.x, o.y + f.y); await page.mouse.down();
  await page.mouse.move(o.x + g.x + 3 * (g.x - f.x), o.y + g.y + 3 * (g.y - f.y), { steps: 40 });
  const e1 = await E();
  ok('past the opposite face: thickness stays >= 0.05 mm (not ~0)', e1.w >= 0.05 - 1e-9, 'width ' + e1.w);
  ok('past the opposite face: the opposite face has not moved', Math.abs(e1.lo - e0.lo) < 1e-6, JSON.stringify([e0, e1]));
  await page.mouse.move(o.x + f.x, o.y + f.y, { steps: 40 }); await page.mouse.up(); await page.waitForTimeout(200);
  const e2 = await E();
  ok('reversing the drag brings the face back out to its start', Math.abs(e2.w - e0.w) < 0.5, JSON.stringify([e0, e2]));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
