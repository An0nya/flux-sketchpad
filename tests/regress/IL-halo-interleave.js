// IL: jittered / interleaved sampling of the traffic-halo table + a bin blur pass (options haloJitter, haloJitterAmount, haloBlur; default off; GPU).
// The table marches each depth slice at 6 fixed points per step ladder, the same for every cell, so a beam thinner than the step spacing (a pencil beam seen side-on) only lights
// where it crosses a sample sphere: a row of beads (owner's shots 10-28). 'interleaved' gives each cell one of N x N offsets, 'jittered' adds fixed per-cell noise inside the slot,
// and a separable tent blur (before the running totals) merges the pattern. The halo is isolated as (frame, trafficHalo 16) - (frame, trafficHalo 0).
// Poses: the pass hairpin approach, the oncoming car side-on (d 600 rel 90; d 640 rel 60), its lamps carrying the scene's beam (onMode symmetric).
// Checks: (1) precondition: the modes reach the table pass (halo.jit, halo.blur); (2) ACCURACY: the halo's total light is at least as close to a 4x finer even reference (32 bins)
// as even 8-bin sampling is, for the pencil AND the wide default beam (measured 10-28 at d 600: even off by 4.9 / 36 percent, interleaved 0.06 / 3.9, jittered 0.4 / 1.3);
// (3) heavy blur + jittered (4 x 4 pattern) and depth blur build (accuracy printed, not gated); (4) off again = the pre-IL path; (5) no page errors.
// NOT checked here: how the beads look. My roughness number did not separate the modes at these poses (the halo is small on screen); the bead check is the owner's eye
// (dreamworld H11 projector, fixed 150L curve, cars at 800 m, 400 m range). IL_PRINT=1 prints the numbers, IL_SHOTS=dir saves frames.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/IL-halo-interleave.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806), SHOTS = process.env.IL_SHOTS;
const fx = (n) => fs.readFileSync(path.join(__dirname, '../fixtures/' + n), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const errors = [];
const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 300, trafficHalo: 16, haloPolar: 'off', lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, crestOcclusion: 'off', haloBins: 8, mountainPass: true, onMode: 'symmetric' };   // symmetric: the oncoming car carries the scene's own beam (the pencil)
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async (scene) => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'IL'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, BASE);
    return page;
  };
  let POSE = { d: 600, rel: 90 };
  const frame = async (page, o, tag) => {
    await page.evaluate(([o, P]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); RF.DriveAnim.trafficCars = () => [{ id: 'oncoming:IL', kind: 'oncoming', rel: P.rel, off: V.src.lane }]; }, [o, POSE]);
    await page.evaluate(async (d) => { RF.UI.dvAnim.dist = d; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, POSE.d);
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(500); const buf = await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
    if (SHOTS && tag) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, tag + '.png'), buf); }
    return buf;
  };
  const lumOf = (page, buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, L = new Array(c.width * c.height); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return { w: c.width, h: c.height, L }; }, buf.toString('base64'));
  // The halo alone (with - without), its total, and its roughness: sum of |horizontal| + |vertical| neighbour differences over the sum (a row of beads is rough, a smooth line is not).
  const haloStats = (A, B) => { const w = A.w, h = A.h, D = A.L.map((v, i) => Math.max(0, v - B.L[i])); let sum = 0, tv = 0; for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; sum += D[i]; tv += Math.abs(D[i + 1] - D[i]) + Math.abs(D[i + w] - D[i]); } return { sum: Math.round(sum), rough: +(tv / Math.max(sum, 1)).toFixed(4) }; };
  const run = async (fixture, name, pose) => {
    POSE = pose; name += '-d' + pose.d; const page = await open(fx(fixture));
    const none = await lumOf(page, await frame(page, { trafficHalo: 0, haloJitter: 'off' }, name + '-nohalo'));
    const offB = await frame(page, { trafficHalo: 16, haloJitter: 'off' }, name + '-even'), off = haloStats(await lumOf(page, offB), none);
    const st0 = await page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const on = haloStats(await lumOf(page, await frame(page, { haloJitter: 'interleaved' }, name + '-interleaved')), none);
    const st1 = await page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const jt = haloStats(await lumOf(page, await frame(page, { haloJitter: 'jittered' }, name + '-jittered')), none);
    const hv = haloStats(await lumOf(page, await frame(page, { haloJitter: 'jittered', haloBlur: 'heavy' }, name + '-jittered-heavy')), none);
    const st2 = await page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const db = haloStats(await lumOf(page, await frame(page, { haloJitter: 'jittered', haloBlur: 'auto', haloDepthBlur: 'light' }, name + '-jittered-depth')), none);
    const st3 = await page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const ref = haloStats(await lumOf(page, await frame(page, { haloJitter: 'off', haloBlur: 'auto', haloDepthBlur: 'off', haloBins: 32 }, name + '-even32')), none);   // reference: 4x finer steps, even
    await frame(page, { haloJitter: 'off', haloBins: 8, haloDepthBlur: 'off' }); const stOff = await page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    await page.close();
    const err = (x) => +Math.abs(x.sum / ref.sum - 1).toFixed(4);
    return { sums: [off.sum, on.sum, jt.sum, hv.sum, ref.sum], errOff: err(off), errOn: err(on), errJt: err(jt), errHv: err(hv), errDb: err(db), dblur: st3.dblur, lamps: st0.lamps && st0.lamps.length, modes: [st0.jit, st0.blur, st1.jit, st1.blur, st2.jit, st2.blur], offState: [stOff.jit, stOff.blur, stOff.dblur] };
  };
  try {
    const res = {};
    for (const pose of [{ d: 600, rel: 90 }, { d: 640, rel: 60 }]) { res['pencil' + pose.d] = await run('PB-pencil.json', 'pencil', pose); res['wide' + pose.d] = await run('MG2-default-lamp.json', 'wide', pose); }
    const pencil = res.pencil600, wide = res.wide600;
    if (process.env.IL_PRINT) console.log(JSON.stringify(res));
    const all = Object.values(res), m = pencil.modes;
    ok('precondition: the car is a halo source in every run; the modes reach the table pass (even: none, blur 0; interleaved: blur 1 auto; jittered + heavy: 4 x 4 pattern, blur 3)', all.every((r) => r.lamps > 0) && !m[0] && m[1] === 0 && m[2] === 'interleaved' && m[3] === 1 && m[4] === 'jittered:4' && m[5] === 3, { modes: m, lamps: all.map((r) => r.lamps) });
    // 0.01 slack: even-32 is itself a sampled estimate; the point is that no mode moves AWAY from it.
    // Gated at d 600 only. At d 640 the 32-bin reference disagrees with every 8-bin mode by about the same 23-26 percent (measured 10-28), so it cannot rank them there: printed, not gated.
    // Heavy blur is printed, not gated: it moved the wide beam's total by -17 / +42 percent (d 600 / d 640). INFERENCE: a 7-cell blur moves light across silhouettes, where neighbouring
    // rays end at very different depths (the lookup reads each ray only up to its surface). Owner's call whether heavy stays.
    for (const k of ['pencil600', 'wide600']) { const r = res[k]; ok(k + ': interleaved and jittered (light blur) are each at least as close to the 32-bin reference as even 8-bin sampling (total halo light)', r.errOn <= r.errOff + 0.01 && r.errJt <= r.errOff + 0.01, r); }
    console.log('[INFO] not gated: ' + JSON.stringify({ heavy: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.errHv])), depthLight: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, [r.dblur, r.errDb]])), d640: { pencil: res.pencil640, wide: res.wide640 } }));
    // Not a frame hash: the frame depends on how many redraws came before (measured 10-28: one extra frame of ANY mode, depth blur or not, moved ~1300 pixels near the horizon by up to
    // 255 levels; elapsed time alone did not). Off = byte-identical is held by the gate's frame pins (BJ2-halo-table-pin, SC, E2), since off compiles the old texts and runs no blur pass.
    ok('options off again: the table pass is back to the pre-IL path (no jitter text, no blur pass, no depth blur)', all.every((r) => !r.offState[0] && r.offState[1] === 0 && r.offState[2] === 0), all.map((r) => r.offState));
  } catch (e) { errors.push(String(e && e.stack || e)); }
  ok('no page errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  const n = checks.filter(Boolean).length; console.log(n === checks.length ? 'ALL PASS ' + n : 'FAILED ' + (checks.length - n) + ' of ' + checks.length);
  process.exit(n === checks.length ? 0 : 1);
})();
