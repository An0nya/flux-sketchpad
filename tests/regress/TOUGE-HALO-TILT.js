// REVIEW-C integ 2026-10-26: halo lookup now reads 4 knots from a prefix-summed table (shader text changed on purpose; halo-on frames differ from main by <= 2/255, agent-measured on 4 poses). Moved: PIN_FLAT b1d5d4b18067ffb4 -> fd6166c47fb95091, PIN_EQUAL 51727377c14f45d3 -> c6a2fdc3619e9657 (halo-on frames).
// TOUGE-HALO-TILT: each oncoming car's halo axis carries that car's own pitch, in our car frame (hDir.z = elevation).
// Checks: (1) the nearest halo lamp's axis elevation matches an independent calculation (their beam direction, cos/sin of their trafficPitch,
// rotated by OUR carFromWorld, z kept), with the right sign; (2) pixels move the expected way: a beam pitched down (dip) lights less of the frame,
// a beam pitched up (valley) lights more, and equal grades (elevation ~0) leave the frame byte-identical; (3) flat road and touge with the
// same halo pose are byte-identical to the pre-tilt base (pinned hashes, measured on base b0a37ea via git archive).
// Poses are the road geometry of MG2-default-lamp at these stations (found by a scan, see the report): dip d=1332 (us -3.05 deg, car -1.38 deg),
// valley d=1028 (us -3.05, car +5.68), equal d=1084 (us -5.71, car +5.68, car 43 m), with the halo bins reaching 120 m.
// E2 part 2 (2026-10-27): pass lamp heads now carry their street direction, so the lamp cone (default 'auto' = on in mist) draws on a pass frame for the first time and moved the touge pin(s) of this test
// (PIN_EQUAL). The touge page here sets lampCone 'off' so the pins are about the halo, as before; the old pin is the proof. The flat page is left on the default: its pin did not move with the cone drawing (flat frames are identical).
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/TOUGE-HALO-TILT.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
const crypto = require('crypto');
// FLAT-PEDS re-pin 2026-10-26 (overnight integration): flat-road pin(s) moved by pedestrian scene content, not by the halo/sky (bisected with --only, alone): clean through wave-2 e51c4bc, moved by T 228686b (drive-anim walkers seeded); identical on main d20fe9d and on Brief J's branch. Pass pins unchanged. Moved: fd6166c47fb95091 -> cad1ecc09b3d711e.
const PIN_FLAT = 'cad1ecc09b3d711e', PIN_EQUAL = 'c6a2fdc3619e9657';   // REVIEW integ 2026-10-26: c93885d2e890d8c2 -> 51727377c14f45d3, cause: B6 shadow normal (proved: the old hash returns with only the B6 line reverted).   // scene region y>=140, 912x373 PNG. PIN_EQUAL was f73730821efb1e75 (base b0a37ea, main 0fed388 still gives it); re-baselined by TOUGE-SKY-VEIL: the sky now takes the halo veil on halo-on touge frames. Cause proven: f73730821efb1e75 reproduces with the sky term switched off.
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
    await setOpts(page, { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, lampCone: 'off' });
    // (1) axis elevation, nearest lamp, three poses
    const axis = async (d) => page.evaluate(async (dd) => {
      RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200));
      globalThis.HALO_TILT_OFF = false;
      const V = RF.DriveAnim._.V, P = RF.Touge, p = V.p, a = P.attitude(dd), world = P.world(p, dd, 0), W = RF.Drive.trafficSources(world.objects, p.eye, p, world.A);
      const q = W.map((q) => ({ q, d: Math.hypot(q.x - p.eye[0], q.y - p.eye[1], q.z - p.eye[2]) })).sort((x, y) => x.d - y.d)[0].q;
      const f = world.A.frame(q.x, q.y), sf = world.A.surface(f.s, f.off), pt = Math.atan(sf.grade * (q.nx * f.t[0] + q.ny * f.t[1]));
      let b = [q.nx * Math.cos(pt), q.ny * Math.cos(pt), Math.sin(pt)], n = a.up;   // their beam, world; our up = carFromWorld row z
      // ROLL (REVIEW integ 2026-10-26): the beam forward is the grade-carrying heading projected onto the road plane under the car (drive-three-halo.js toCarFrame), so a banked car's beam carries its roll
      if (sf.normal) { const sn = sf.normal, dir = q.nx * f.t[0] + q.ny * f.t[1], H = [q.nx, q.ny, sf.grade * dir], hn = H[0] * sn[0] + H[1] * sn[1] + H[2] * sn[2], F = [H[0] - sn[0] * hn, H[1] - sn[1] * hn, H[2] - sn[2] * hn], fl = Math.hypot(...F) || 1; b = F.map((v) => v / fl); }
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
    ok('dip nz is within 0.03 of sin(our pitch + their pitch) (rough cross-check: the gap is our bank and, since ROLL, their bank; was 0.02 before ROLL), roll ' + (dip.roll * 180 / Math.PI).toFixed(2) + ' deg)', Math.abs(dip.nz - dip.sinSum) < 0.03, { nz: dip.nz, sinSum: dip.sinSum });
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
