// TOUGE-ELEV B1/B2: the traffic halo on a touge grade. The halo table is built from the lamps in the car frame (the frame the ribbon projects in),
// so each lamp the halo reports must equal carFromWorld * (its world position) for the attitude at that station. Halo on touge: built (on 1, drawn > 0).
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/TOUGE-ELEV-B.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8805);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'TOUGE-ELEV-B'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate(() => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16 })) V.setOwn(k, v); });
    const r = await page.evaluate(async () => {
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      RF.UI.dvAnim.dist = 60; RF.UI.redrawSpec(); await sl(1200);
      const V = RF.DriveAnim._.V, P = RF.Touge, p = V.p, a = P.attitude(60), s = V.three.haloState();
      // carFromWorld = transpose of worldFromCar, whose columns are forward, left, up (as drive-three.js sets it)
      const [f, l, n] = [a.forward, a.left, a.up];
      const cfw = (v) => [f[0] * v[0] + f[1] * v[1] + f[2] * v[2], l[0] * v[0] + l[1] * v[1] + l[2] * v[2], n[0] * v[0] + n[1] * v[1] + n[2] * v[2]];
      const world = P.world(p, 60, 0), W = RF.Drive.trafficSources(world.objects, p.eye, p, world.A);
      const byDist = W.map((q) => ({ q, d: Math.hypot(q.x - p.eye[0], q.y - p.eye[1], q.z - p.eye[2]) })).sort((x, y) => x.d - y.d);
      const near = byDist[0].q, expect = cfw([near.x, near.y, near.z]);
      const got = s.lamps[0].lamp;
      return { on: s.on, drawn: s.drawn, touge: !!p.touge, got, expect, worldNear: [near.x, near.y, near.z], diff: Math.hypot(got[0] - expect[0], got[1] - expect[1], got[2] - expect[2]), shiftFromWorld: Math.hypot(got[0] - near.x, got[1] - near.y, got[2] - near.z), pitchSin: f[2] };
    });
    console.log(JSON.stringify(r));
    ok('B2 halo on a touge grade is built (on 1, lamps drawn)', r.on === 1 && r.drawn > 0 && r.touge, { on: r.on, drawn: r.drawn });
    ok('B1 nearest halo lamp is carFromWorld * world position (within 1e-3 m)', r.diff < 1e-3, { diff: r.diff });
    ok('B1 the car-frame lamp really differs from the world lamp on this grade (the mapping is not a no-op)', r.shiftFromWorld > 0.5, { shiftFromWorld: r.shiftFromWorld });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
