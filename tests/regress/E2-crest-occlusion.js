// E2 part 1: crest / cliff occlusion of the oncoming in-scatter on the mountain pass (option crestOcclusion, default off; GPU, pass only).
// The traffic-halo table pass (drive-three-halo.js) tests 3 points along each lamp -> air-sample line against a top-down height map of the pass ribbon (drive-touge-three.js heightMap).
// Checks: (1) the height map matches the true terrain height A.surface(s, off) on the road (|off| <= 5) within 0.1 m at three poses, a hairpin among them (this pins the xy box, the z decode and
// the orientation); (2) a car just behind a crest (pose d 140, the car 96 m ahead, 4 m below us; the CPU blocked() says its lamp is hidden, its lamps ARE in the halo sources) lights the air
// below the crest line with the option off and does not with it on (frame luminance and the rows under the crest line), while the sky above the line is unchanged; (3) NEGATIVE CONTROL: a car in
// plain view (d 1350, 50 m, nothing between) gives the same frame on and off within 2 levels, so a sign or rotation error cannot pass as "occlusion works"; (4) option off: no height-map render,
// the frame is byte-identical to the base 5d3047b (pin); flat road with the option ON is byte-identical to the base too (pin: the option does nothing off the pass).
// The cars are placed by replacing RF.DriveAnim.trafficCars (read through the property by drive-touge.js world()), so the pose does not depend on the traffic logic's clock.
// All pages here set lampCone 'off' and street lamps off: E2 part 2 (the lamp cone on the pass) must not move these frames.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/E2-crest-occlusion.js <port>   (E2_PRINT=1 prints the hashes; E2_BASE=1 against the base 5d3047b skips the checks that need the new hooks, to measure the pins)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PIN_CREST_OFF = '2325e0a834dbbdf0', PIN_FLAT = 'a6a815aa706bc634';   // measured on the base 5d3047b with this test's own poses (E2_PRINT=1)
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'E2-crest-occlusion'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  const setOpts = (page, o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  const car = (page, rel) => page.evaluate((rel) => { const D = RF.DriveAnim; D.trafficCars = () => [{ id: 'oncoming:E2', kind: 'oncoming', rel, off: D._.V.src.lane }]; }, rel);
  const pose = (page, d) => page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, d);
  const shot = async (page) => {
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(500); return page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
  };
  const px = (page, buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) }; }, buf.toString('base64'));
  const rowLum = (A, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < A.w; x++) { const i = 4 * (y * A.w + x); s += A.d[i] + A.d[i + 1] + A.d[i + 2]; n += 3; } return s / n; };
  const diff = (A, B) => { let n = 0, max = 0; for (let i = 0; i < A.d.length; i += 4) { let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.d[i + c] - B.d[i + c])); if (m) { n++; if (m > max) max = m; } } return { changed: n, max }; };
  const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false };
  try {
    const page = await open();
    await setOpts(page, { ...BASE, crestOcclusion: 'on' });
    if (!process.env.E2_BASE) {
    // (1) height map against the terrain
    const probe = await page.evaluate(async () => {
      const res = [];
      for (const d of [140, 700, 1300]) {
        RF.UI.dvAnim.dist = d; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1500));
        const V = RF.DriveAnim._.V, w = RF.Touge.world(V.p, d, 0), A = w.A, pts = [], truth = [];
        for (let s = -20; s <= 300; s += 17) for (const off of [-1.5, 0, 2.2, 5]) { const q = A.surface(s, off); pts.push([q.p[0], q.p[1]]); truth.push(q.p[2]); }
        const z = V.three.crestProbe(pts.slice(0, 64)).concat(V.three.crestProbe(pts.slice(64)) || []); let n = 0, nul = 0, max = 0;
        z.forEach((v, i) => { if (v === null) { nul++; return; } n++; max = Math.max(max, Math.abs(v - truth[i])); });
        res.push({ d, pts: z.length, n, nul, maxErr: +max.toFixed(4), runs: V.three.crestState().runs });
      }
      return res;
    });
    ok('height map equals the terrain on the road within 0.1 m at 3 poses (d 140, 700 hairpin, 1300), every point inside the map (road columns only: |off| <= 5, the ribbon has a column at -4.15 and the next at -18)', probe.every((r) => r.n === r.pts && r.maxErr < 0.1), probe);
    // (2) car just behind a crest
    await car(page, 96); await pose(page, 140);
    const pre = await page.evaluate(() => {
      const V = RF.DriveAnim._.V, p = V.p, d = 140, w = RF.Touge.world(p, d, 0), a = RF.Touge.attitude(d), eye = [-2, .37, 1.2], E = [0, 1, 2].map((j) => a.forward[j] * eye[0] + a.left[j] * eye[1] + a.up[j] * eye[2]);
      const src = RF.Drive.trafficSources(w.objects, p.eye, p, w.A), q = src[0];
      return { sources: src.length, car: q && q.car, hidden: q ? RF.Touge.blocked(w.A, E, [q.x, q.y, q.z]) : null, haloLamps: V.three.haloState().lamps.length, haloOn: V.three.haloState().on, occ: V.three.crestState().occ };
    });
    ok('precondition: the car behind the crest is hidden from the eye (CPU blocked) and its two lamps are halo sources, option on uses the height map', pre.sources === 2 && pre.hidden === true && pre.haloLamps === 2 && pre.haloOn === 1 && pre.occ === true, pre);
    const onB = await shot(page);
    await setOpts(page, { crestOcclusion: 'off' }); await pose(page, 140);
    const offState = await page.evaluate(() => RF.DriveAnim._.V.three.crestState());
    const offB = await shot(page);
    const A = await px(page, onB), B = await px(page, offB);
    const lumOff = rowLum(B, 0, B.h), lumOn = rowLum(A, 0, A.h), lowOff = rowLum(B, 340, B.h), lowOn = rowLum(A, 340, A.h), skyOff = rowLum(B, 0, 250), skyOn = rowLum(A, 0, 250);
    ok('crest pose: the option lowers the frame luminance by more than 15 percent', lumOn < 0.85 * lumOff, { off: +lumOff.toFixed(2), on: +lumOn.toFixed(2) });
    ok('crest pose: the air under the crest line (rows 340 and below) is less than half as bright with the option on', lowOn < 0.5 * lowOff, { off: +lowOff.toFixed(2), on: +lowOn.toFixed(2) });
    ok('crest pose: the sky glow above the crest line (rows 0 to 250) keeps at least 85 percent', skyOn > 0.85 * skyOff, { off: +skyOff.toFixed(2), on: +skyOn.toFixed(2) });
    // (3) negative control
    await setOpts(page, { crestOcclusion: 'on' }); await car(page, 50); await pose(page, 1350);
    const ctl = await page.evaluate(() => { const V = RF.DriveAnim._.V, p = V.p, d = 1350, w = RF.Touge.world(p, d, 0), a = RF.Touge.attitude(d), eye = [-2, .37, 1.2], E = [0, 1, 2].map((j) => a.forward[j] * eye[0] + a.left[j] * eye[1] + a.up[j] * eye[2]), q = RF.Drive.trafficSources(w.objects, p.eye, p, w.A)[0]; return { hidden: q ? RF.Touge.blocked(w.A, E, [q.x, q.y, q.z]) : null, occ: V.three.crestState().occ, dist: q && Math.round(Math.hypot(q.x - E[0], q.y - E[1], q.z - E[2])) }; });
    const cOn = await px(page, await shot(page));
    await setOpts(page, { crestOcclusion: 'off' }); await pose(page, 1350);
    const cOff = await px(page, await shot(page)), cd = diff(cOn, cOff);
    ok('negative control: a car in plain view (not hidden, 50 m) gives the same frame on and off within 2 levels (< 2000 pixels differ)', ctl.hidden === false && ctl.occ === true && cd.max <= 2 && cd.changed < 2000, { ...ctl, ...cd });
    } else { await setOpts(page, { crestOcclusion: 'off' }); }
    // (4) off = base
    await car(page, 96); await pose(page, 140);
    const hOff = sha(await shot(page)), st = await page.evaluate(() => RF.DriveAnim._.V.three.crestState ? RF.DriveAnim._.V.three.crestState() : { occ: false });
    if (process.env.E2_PRINT) console.log('HASH crest off', hOff);
    ok('option off: no height-map render for this frame, and the crest-pose frame is byte-identical to the base (pin ' + PIN_CREST_OFF + ')', st.occ === false && hOff === PIN_CREST_OFF, { hash: hOff, occ: st.occ });
    await page.close();
    const flat = await open();
    await setOpts(flat, { ...BASE, visibility: 60, mountainPass: false, crestOcclusion: 'on' });
    await flat.evaluate(async () => { globalThis.HALO_TILT_OFF = false; RF.UI.dvAnim.dist = 60; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); });
    const fs0 = await flat.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, haloOn: RF.DriveAnim._.V.three.haloState().on, occ: !!(RF.DriveAnim._.V.three.crestState && RF.DriveAnim._.V.three.crestState().occ), runs: RF.DriveAnim._.V.three.crestState ? RF.DriveAnim._.V.three.crestState().runs : 0 }));
    const fOn = sha(await shot(flat));
    if (process.env.E2_PRINT) console.log('HASH flat on', fOn);
    ok('flat road with the option on: no height map, frame byte-identical to the base (pin ' + PIN_FLAT + ')', !fs0.touge && fs0.haloOn === 1 && fs0.occ === false && fs0.runs === 0 && fOn === PIN_FLAT, { hash: fOn, ...fs0 });
    await flat.close();
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) { ok('run completed', false, String(e && e.stack || e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
