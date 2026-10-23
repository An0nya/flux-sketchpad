// POWERLINES on the pass (js/drive-touge.js world()). Run: python3 tests/serve.py 8812 & node tests/regress/PL2-powerlines-pass.js 8812
// Checks, on the mountain pass at a fixed route position (the same view the animated drive builds):
//  1 option off and option absent give identical object lists
//  2 option on: the non-powerline objects are unchanged
//  3 on: poles and wires are present (poles > 0, wire segments > 0, 2 conductors x 8 segments per span)
//  4 each conductor is continuous (segment ends meet within 1e-9 m)
//  5 each conductor's first end sits at its span pole's attachment height (pole base + 8.6 m, within 0.1 m); the span pole is within 0.5 m
//  6 every wire segment midpoint is at least 5 m above the road surface under it
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8812);
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => UX2Page.ready());
    await page.waitForTimeout(1500);
    const setup = (pl) => page.evaluate((pl) => {
      const u = RF.UI;
      const o = { scene: 'road', mountainPass: true, gpuRenderer: true, detailedModels: true, deerBehaviour: false, streetLamps: 'sodium', oncoming: false, preceding: false, trafficLogic: false, animals: false, people: false, posts: true, signs: true, veg: true, rpm: true, wild: false };
      if (pl !== undefined) o.powerlines = pl;
      Object.assign(u.dvOpts, o);
      Object.assign(u.dvAnim, { view: 'anim', dist: 180, t: 2, playing: false });
      u.redrawSpec();
    }, pl);
    // first build: option absent
    await setup(undefined);
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const absent = await page.evaluate(() => JSON.stringify(RF.Touge.world(RF.DriveAnim._.V.p, RF.UI.dvAnim.dist, 2).objects));
    await setup('off');
    const offStr = await page.evaluate(() => JSON.stringify(RF.Touge.world(RF.DriveAnim._.V.p, RF.UI.dvAnim.dist, 2).objects));
    ok('1 option off and option absent give identical objects', absent === offStr, { lenAbsent: absent.length, lenOff: offStr.length });
    await setup('on');
    const r = await page.evaluate((offStr) => {
      const V = RF.DriveAnim._.V, p = V.p, dist = RF.UI.dvAnim.dist, A = RF.Touge.route(dist, p.lane, !!p.touge);
      const objs = RF.Touge.world(p, dist, 2).objects;
      const pl = objs.filter((o) => o.cls === 'powerline'), rest = objs.filter((o) => o.cls !== 'powerline');
      const poles = pl.filter((o) => o.mat === 'pole'), wires = pl.filter((o) => o.mat === 'wire');
      const ends = (o) => { const h = (o.z1 - o.z0) / 2, a = o.axis || [0, 0, 1], zc = o.z0 + h; return [[o.x - a[0] * h, o.y - a[1] * h, zc - a[2] * h], [o.x + a[0] * h, o.y + a[1] * h, zc + a[2] * h]]; };
      let maxGap = 0, endErr = 0, poleDist = 0, minAbove = Infinity;
      for (let g = 0; g < wires.length; g += 8) {
        const seg = wires.slice(g, g + 8);
        for (let j = 0; j + 1 < seg.length; j++) { const e = ends(seg[j])[1], s = ends(seg[j + 1])[0]; maxGap = Math.max(maxGap, Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2])); }
        const a0 = ends(seg[0])[0];
        let best = null; for (const po of poles) { const d = Math.hypot(po.x - a0[0], po.y - a0[1]); if (!best || d < best.d) best = { d, po }; }
        if (best) { poleDist = Math.max(poleDist, best.d); endErr = Math.max(endErr, Math.abs(a0[2] - (best.po.z0 + 8.6))); }
      }
      for (const wsg of wires) { const m = [wsg.x, wsg.y, (wsg.z0 + wsg.z1) / 2], f = A.frame(m[0], m[1]); minAbove = Math.min(minAbove, m[2] - A.height(f.s, f.off)); }
      return { nPoles: poles.length, nWires: wires.length, touge: !!p.touge, restSame: JSON.stringify(rest) === offStr, maxGap, endErr, poleDist, minAbove };
    }, offStr);
    ok('2 option on: non-powerline objects unchanged', r.restSame, r.restSame);
    ok('3 on: pass is elevated and poles and wires are present (2 conductors x 8 segments per span)', r.touge && r.nPoles > 0 && r.nWires > 0 && r.nWires % 16 === 0, { touge: r.touge, poles: r.nPoles, wires: r.nWires });
    ok('4 each conductor continuous (ends meet within 1e-9 m)', r.maxGap < 1e-9, r.maxGap);
    ok('5a span pole within 0.5 m of the wire end', r.poleDist < 0.5, r.poleDist);
    ok('5b wire end at pole base + 8.6 m (within 0.1 m)', r.endErr < 0.1, r.endErr);
    ok('6 wires at least 5 m above the road under them', r.minAbove >= 5, r.minAbove);
    console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  } catch (e) { console.log('[FAIL] exception ' + e); fails++; }
  finally { await browser.close(); }
  process.exit(fails ? 1 : 0);
})();
