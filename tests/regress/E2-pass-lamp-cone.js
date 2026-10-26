// E2 part 2: the lamp cone draws on the mountain pass. Before, pass lamp heads (drive-touge.js world()) carried no `street`, so lampCone.build() skipped every one of them
// (count 0 in haze, OBSERVED 2026-10-27 at d = 240..1160). Now the head object carries its street direction (world, horizontal), and the cone shader works in the world frame on a pass
// frame (drive-three-lampcone.js: coneR = world-from-car, cFloor = the road height under the lamp).
// Checks: (1) every pass head has a unit street vector pointing at the road centre, over a scan of the lamp stretches; (2) the cone count equals the heads the eye can see in front (<= 8);
// (3) the cone only adds light, warm (R gain > B gain), and the added light lies mostly BELOW each head on screen (it hangs under the head, it is not above it);
// (4) the lights list keeps lampStreet and gets no `street` (that would switch on the pass lampRoad path); (5) a flat urban frame with the cone drawing is byte-identical to the base (pin measured on 5d3047b).
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/E2-pass-lamp-cone.js <port>   (E2_PRINT=1 prints the flat hash)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PIN_FLAT_CONE = '59d1bc8161539e9a';   // flat urban frame (F2 pose, seed 7), haze 1000, sodium lamps, cone on (3 lamps drawn); same on 5d3047b and on this branch
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'E2-pass-lamp-cone'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  const setOpts = (page, o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  const pose = (page, d) => page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1500)); }, d);
  const shot = async (page) => {
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(600); return page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
  };
  const px = (page, buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(d.data) }; }, buf.toString('base64'));
  try {
    const page = await open();
    await setOpts(page, { visibility: 1000, oncoming: false, preceding: false, streetLamps: 'sodium', lampCone: 'on', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false });
    // (1) + (4): street vectors over the lamp stretches, and the lights list
    const scan = await page.evaluate(async () => {
      let n = 0, bad = 0, nonUnit = 0, lightsStreet = 0, lightsLampStreet = 0;
      for (let d = 240; d <= 1160; d += 20) {
        RF.UI.dvAnim.dist = d; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 150));
        const V = RF.DriveAnim._.V, w = RF.Touge.world(V.p, d, 0);
        for (const h of w.objects.filter((o) => o.cls === 'street-lamp' && o.mat === 'lamp-head')) {
          n++; const f = w.A.frame(h.x, h.y), nl = [-f.t[1], f.t[0]], c = f.off > 0 ? [-nl[0], -nl[1]] : nl;   // the unit vector from the lamp's side toward the road centre
          if (!h.street || Math.abs(Math.hypot(...h.street) - 1) > 1e-6) { nonUnit++; continue; }
          if (h.street[0] * c[0] + h.street[1] * c[1] <= 0.5) bad++;
        }
        for (const L of w.lights) { if (L.street) lightsStreet++; if (L.lampStreet) lightsLampStreet++; }
      }
      return { n, bad, nonUnit, lightsStreet, lightsLampStreet };
    });
    ok('every pass lamp head has a unit street vector pointing at the road centre (cos > 0.5), ' + scan.n + ' heads', scan.n > 30 && scan.bad === 0 && scan.nonUnit === 0, scan);
    ok('pass lights keep lampStreet and get no street (the lampRoad path stays off)', scan.lightsStreet === 0 && scan.lightsLampStreet > 30, scan);
    // (2) + (3) at the curve pose d = 980 (150R tile, three heads 109 to 189 m ahead)
    await pose(page, 980);
    const st = await page.evaluate(() => { const V = RF.DriveAnim._.V, s = V.three.lampConeState(), w = RF.Touge.world(V.p, 980, 0), heads = w.objects.filter((o) => o.cls === 'street-lamp' && o.mat === 'lamp-head'); return { on: s.on, count: s.count, heads: heads.length }; });
    ok('cone is on in the pass frame and draws every head in view (count = heads, 3)', st.on === 1 && st.count === st.heads && st.count === 3, st);
    const on = await shot(page);
    await setOpts(page, { lampCone: 'off' }); await pose(page, 980);
    const offS = await page.evaluate(() => RF.DriveAnim._.V.three.lampConeState());
    const off = await shot(page);
    const A = await px(page, on), B = await px(page, off);
    let darker = 0, brighter = 0, rGain = 0, bGain = 0;
    for (let i = 0; i < A.d.length; i += 4) { const dr = A.d[i] - B.d[i], db = A.d[i + 2] - B.d[i + 2]; if (dr < 0 || A.d[i + 1] < B.d[i + 1] || db < 0) darker++; if (dr > 0 || A.d[i + 1] > B.d[i + 1] || db > 0) brighter++; if (dr > 0) rGain += dr; if (db > 0) bGain += db; }
    ok('cone off: state off, no lamps', offS.on === 0, offS);
    ok('cone only adds light on the pass (no darker pixel) and adds some, warm (red gain > 3x blue gain)', darker === 0 && brighter > 500 && rGain > 3 * bGain, { darker, brighter, rGain, bGain });
    // the added light hangs under each head: screen box of the head, mass of the added light below vs above it
    const heads = await page.evaluate(() => {
      const V = RF.DriveAnim._.V, d = 980, w = RF.Touge.world(V.p, d, 0), a = RF.Touge.attitude(d), p = V.p, eye = [-2, .37, 1.2];
      const E = [0, 1, 2].map((j) => a.forward[j] * eye[0] + a.left[j] * eye[1] + a.up[j] * eye[2]), tan = Math.tan(p.hfov * Math.PI / 360), W = V.canvas.width, H = V.canvas.height;
      return w.objects.filter((o) => o.cls === 'street-lamp' && o.mat === 'lamp-head').map((h) => {
        const r = [h.x - E[0], h.y - E[1], h.z - E[2]], q = [0, 1, 2].map((k) => [a.forward, a.left, a.up][k].reduce((s, v, j) => s + v * r[j], 0));
        return { sx: (-q[1] / (q[0] * tan) * .5 + .5) * W, sy: (1 - (q[2] * W / (q[0] * tan * H) * .5 + .5)) * H, r: q[0] };
      });
    });
    const mass = (cx, y0, y1, half) => { let m = 0; for (let y = Math.max(0, Math.floor(y0)); y < Math.min(A.h, y1); y++) for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(A.w, cx + half); x++) { const i = 4 * (y * A.w + x); m += Math.max(0, A.d[i] - B.d[i]) + Math.max(0, A.d[i + 1] - B.d[i + 1]); } return m; };
    const hang = heads.map((h) => { const half = Math.max(8, 2200 / h.r); return { r: Math.round(h.r), sx: Math.round(h.sx), sy: Math.round(h.sy), below: mass(h.sx, h.sy, h.sy + 2 * half, half), above: mass(h.sx, h.sy - 2 * half, h.sy, half) }; });
    hang.sort((x, y) => x.r - y.r);   // the far head's box overlaps its neighbours' cones (both sit in the same patch of screen), so the per-head test is on the nearest two; the sum covers all three
    ok('added cone light lies below the nearest two heads on screen (below > 2x above) and below all three together (> 2x)', hang.length === 3 && hang.slice(0, 2).every((h) => h.below > 2 * h.above && h.below > 300) && hang.reduce((q, h) => q + h.below, 0) > 2 * hang.reduce((q, h) => q + h.above, 0), hang);
    // (5) flat identity
    await page.close();
    const flat = await open();
    await setOpts(flat, { mountainPass: false, scene: 'road', tiles: true, visibility: 1000, oncoming: false, preceding: false, streetLamps: 'sodium', lampCone: 'on', animals: false, people: false, expMode: 'fixed', ev: 1, dynamicResolution: false, trafficLogic: false });
    await flat.evaluate(async () => { const D = RF.DriveAnim, tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban'); Object.assign(RF.UI.dvAnim, { view: 'anim', playing: false, dist: tile.s0 + 55, t: 2 }); RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 3500)); });
    const fs0 = await flat.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, cone: RF.DriveAnim._.V.three.lampConeState().count }));
    const fh = sha(await shot(flat));
    if (process.env.E2_PRINT) console.log('FLAT HASH', fh);
    ok('flat urban frame with the cone drawing is byte-identical to the base (pin ' + PIN_FLAT_CONE + ')', !fs0.touge && fs0.cone === 3 && fh === PIN_FLAT_CONE, { hash: fh, ...fs0 });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await flat.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
