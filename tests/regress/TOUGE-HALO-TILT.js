// TOUGE-HALO-TILT: each oncoming car's halo axis carries that car's own pitch, in our car frame (hDir.z = elevation).
// Checks: (1) the nearest halo lamp's axis elevation matches an independent calculation (their beam direction, cos/sin of their trafficPitch,
// rotated by OUR carFromWorld, z kept), with the right sign; (2) pixels move the expected way: a beam pitched down (dip) lights less of the frame,
// a beam pitched up (valley) lights more, and equal grades (elevation ~0) leave the frame byte-identical; (3) flat road and touge with the
// same halo pose are byte-identical to the pre-tilt base (pinned hashes, measured on base b0a37ea via git archive).
// Poses are the road geometry of MG2-default-lamp at these stations (found by a scan, see the report): dip d=1332 (us -3.05 deg, car -1.38 deg),
// valley d=1028 (us -3.05, car +5.68), equal d=1084 (us -5.71, car +5.68, car 43 m), with the halo bins reaching 120 m.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/TOUGE-HALO-TILT.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
const crypto = require('crypto');
const PIN_FLAT = 'b1d5d4b18067ffb4', PIN_EQUAL = 'f73730821efb1e75';   // base b0a37ea, scene region y>=140, 912x373 PNG
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'TOUGE-HALO-TILT'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  const setOpts = (page, o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  const shot = async (page, d, off) => {
    await page.evaluate(async ([dd, o]) => { globalThis.HALO_TILT_OFF = o; RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200)); }, [d, off]);
    return page.screenshot({ clip: { x: 0, y: 140, width: 912, height: 373 } });
  };
  const lum = (page, buf) => page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return s / (px.length / 4);
  }, buf.toString('base64'));
  try {
    const page = await open();
    await setOpts(page, { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16 });
    // (1) axis elevation, nearest lamp, three poses
    const axis = async (d) => page.evaluate(async (dd) => {
      RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200));
      globalThis.HALO_TILT_OFF = false;
      const V = RF.DriveAnim._.V, P = RF.Touge, p = V.p, a = P.attitude(dd), world = P.world(p, dd, 0), W = RF.Drive.trafficSources(world.objects, p.eye, p, world.A);
      const q = W.map((q) => ({ q, d: Math.hypot(q.x - p.eye[0], q.y - p.eye[1], q.z - p.eye[2]) })).sort((x, y) => x.d - y.d)[0].q;
      const f = world.A.frame(q.x, q.y), sf = world.A.surface(f.s, f.off), pt = Math.atan(sf.grade * (q.nx * f.t[0] + q.ny * f.t[1]));
      const b = [q.nx * Math.cos(pt), q.ny * Math.cos(pt), Math.sin(pt)], n = a.up;   // their beam, world; our up = carFromWorld row z
      const expected = n[0] * b[0] + n[1] * b[1] + n[2] * b[2];
      const s = V.three.haloState();
      return { on: s.on, nz: s.lamps[0].nz, expected, ourPitch: a.pitch, carPitch: pt, roll: a.roll, sinSum: Math.sin(a.pitch + pt) };
    }, d);
    const dip = await axis(1332), valley = await axis(1028), equal = await axis(1084);
    console.log(JSON.stringify({ dip, valley, equal }));
    ok('halo is built on the pass at all three poses', dip.on === 1 && valley.on === 1 && equal.on === 1, { dip: dip.on, valley: valley.on, equal: equal.on });
    ok('dip: nearest lamp axis elevation is the full rotation (within 1e-3) and points down', Math.abs(dip.nz - dip.expected) < 1e-3 && dip.nz < -0.05, { nz: dip.nz, expected: dip.expected });
    ok('valley: nearest lamp axis elevation is the full rotation (within 1e-3) and points up', Math.abs(valley.nz - valley.expected) < 1e-3 && valley.nz > 0.02, { nz: valley.nz, expected: valley.expected });
    ok('equal grades: axis is level (|nz| < 0.002)', Math.abs(equal.nz) < 0.002, { nz: equal.nz });
    ok('dip nz is within 0.02 of sin(our pitch + their pitch) (the gap is our bank, roll ' + (dip.roll * 180 / Math.PI).toFixed(2) + ' deg)', Math.abs(dip.nz - dip.sinSum) < 0.02, { nz: dip.nz, sinSum: dip.sinSum });
    // (2) pixels: tilt on vs tilt off (the old frames) at the same station
    const dipOn = await shot(page, 1332, false), dipOff = await shot(page, 1332, true);
    const valOn = await shot(page, 1028, false), valOff = await shot(page, 1028, true);
    const eqOn = await shot(page, 1084, false), eqOff = await shot(page, 1084, true);
    const [ld, lv] = [await lum(page, dipOff) - await lum(page, dipOn), await lum(page, valOn) - await lum(page, valOff)];
    const dipOffL = await lum(page, dipOff), valOffL = await lum(page, valOff);
    ok('dip: tilt lowers the lit frame (beam dips away): mean luminance drops by >= 5%', ld > 0.05 * dipOffL, { offMean: +dipOffL.toFixed(3), onMinusOff: +(-ld).toFixed(3) });
    ok('valley: tilt raises the lit frame (beam up toward us): mean luminance rises by >= 5%', lv > 0.05 * valOffL, { offMean: +valOffL.toFixed(3), onMinusOff: +lv.toFixed(3) });
    ok('equal grades: tilt on and off are byte-identical', eqOn.equals(eqOff), { on: crypto.createHash('sha256').update(eqOn).digest('hex').slice(0, 16), off: crypto.createHash('sha256').update(eqOff).digest('hex').slice(0, 16) });
    // (3) pins: flat road and the equal-grade touge frame match the pre-tilt base (flat: no touge; the pins are the base's hashes)
    const pageFlat = await open();
    await setOpts(pageFlat, { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, mountainPass: false });
    const flat = await shot(pageFlat, 60, false), touge = await pageFlat.evaluate(() => !!RF.DriveAnim._.V.p.touge);
    const hf = crypto.createHash('sha256').update(flat).digest('hex').slice(0, 16);
    ok('flat road frame is byte-identical to the base (pin ' + PIN_FLAT + ')', hf === PIN_FLAT && !touge, { hash: hf });
    await pageFlat.close();
    const he = crypto.createHash('sha256').update(eqOn).digest('hex').slice(0, 16);
    ok('touge equal-grade frame is byte-identical to the base (pin ' + PIN_EQUAL + ')', he === PIN_EQUAL, { hash: he });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
