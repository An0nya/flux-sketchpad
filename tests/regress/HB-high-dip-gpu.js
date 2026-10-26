// HB page checks: oncoming high beams on the mountain pass (GPU), onMode 'high-dip'. Each oncoming car = its low beam blended with the built-in high by f (D.dipFraction);
// the same f drives eye glare (drive-touge.js trafficLight), road light and the halo table (atlas slots on the sources).
// (1) a car well inside the dip distance (f 0) glares exactly as 'generic'; a car past 400 m (f 1) glares exactly as 'high'; a car in the 8 m transition is between and has two sources per lamp.
// (2) GPU and CPU agree per car: the atlas indices on the GPU are the sources' slots from D.trafficSources, and the halo table's lamps carry the same slots.
// (3) the haze: a far car on high lights the air more than the same car in 'generic' (frame luminance); over a crest, crestOcclusion on cuts that glow (halo occ true, luminance drops).
// (4) PINS (measured on the base 395e362 with this test's poses, HB_PRINT=1): 'generic' and 'high' frames with the far car are byte-identical after the change; 'symmetric' is pinned by BA5/BT/PP/E2/BJ2.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/HB-high-dip-gpu.js <port>   (HB_BASE=1 against the base skips the checks that need the new code)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8807);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PIN = { generic: process.env.HB_PIN_GENERIC || 'b174292239daf5d3', high: process.env.HB_PIN_HIGH || 'b174292239daf5d3' };
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'HB-high-dip'), scene);
  await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
  await page.evaluate(() => TGPage.ready()); await sleep(1500);
  const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  let CAR = 'oncoming:HB';
  const car = (rel) => page.evaluate(([rel, id]) => { const D = RF.DriveAnim; D.trafficCars = () => [{ id, kind: 'oncoming', rel, off: D._.V.src.lane }]; }, [rel, CAR]);
  const pose = (d) => page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, d);
  const shot = async () => {
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(500); return page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
  };
  const meanLum = (buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); }, buf.toString('base64'));
  // what the page knows about the cars this frame: heads' eyeCd, the CPU sources (slots, weights), the GPU atlas and halo state
  const state = () => page.evaluate(() => {
    const V = RF.DriveAnim._.V, p = V.p, d = RF.UI.dvAnim.dist, w = RF.Touge.world(p, d, 0), src = RF.Drive.trafficSources(w.objects, p.eye, p, w.A);
    const hs = w.objects.filter((o) => o.headlamp), heads = hs.map((o) => o.eyeCd), dist = hs.length ? Math.hypot(hs[0].x, hs[0].y, hs[0].z) : null, a = V.three.atlasState(), h = V.three.haloState();
    return { heads, dist, src: src.map((q) => ({ idx: q.idx, w: +q.w.toFixed(5), hasBeam: !!q.beam, y: +q.y.toFixed(2) })), atlas: { on: a.on, beams: a.beams, idx: a.idx }, halo: { on: h.on, lamps: h.lamps.map((l) => ({ idx: l.idx, w: +l.w.toFixed(5), hasBeam: l.hasBeam })), occ: V.three.crestState().occ } };
  });
  const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 1000, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, trafficRange: 800, trafficLightRange: 'cars', crestOcclusion: 'off' };
  try {
    await setOpts(BASE);
    const D0 = 1150;
    // The dip distance is the straight-line eye-to-lamp distance, and the road bends, so the cars are placed by measuring: take a non-forgetful car whose dip distance (150-400 m) is
    // under 200 m, then slide it along the road until the straight-line distance is under the dip distance (f 0), at it (f 0.5) and well past it (f 1).
    const pick = await page.evaluate(() => {
      const V = RF.DriveAnim._.V, seed = V.src.traffic.seed;
      for (let n = 0; n < 400; n++) { const id = 'oncoming:HB' + n, st = RF.Drive.dipState(seed, id, 0); if (!st.forgetful && st.at > 160 && st.at < 190) return { seed, id, at: st.at, forgetful: false }; }
      return null;
    });
    ok('precondition: found a non-forgetful test car with a dip distance of 160-190 m (seed ' + (pick && pick.seed) + ')', !!pick, pick);
    CAR = pick.id;
    const distAt = async (rel) => { await car(rel); return (await state()).dist; };   // world() is rebuilt from the property each call, no render needed
    await pose(D0);
    const rels = {}; let lo = 20, hi = 450;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if ((await distAt(mid)) < pick.at) lo = mid; else hi = mid; }
    rels.mid = (lo + hi) / 2; rels.low = 40; rels.high = 450;
    const meas = [[rels.low, await distAt(rels.low)], [rels.mid, await distAt(rels.mid)], [rels.high, await distAt(rels.high)]];
    console.log('placement (rel, straight-line m):', JSON.stringify(meas), 'chosen', JSON.stringify(rels), 'dip at', pick.at);
    const per = {};
    for (const mode of ['generic', 'high', 'high-dip']) {
      await setOpts({ onMode: mode });
      for (const k of ['low', 'high']) { await car(rels[k]); await pose(D0); per[mode + ':' + k] = await state(); }
    }
    const g = (m, k) => per[m + ':' + k].heads[0];
    if (!process.env.HB_BASE) {
      ok('f=0 (car well inside the dip distance): the pass glare equals onMode generic', Math.abs(g('high-dip', 'low') - g('generic', 'low')) < 1e-6 * g('generic', 'low'), [g('high-dip', 'low'), g('generic', 'low')]);
      ok('f=1 (car well past the dip distance): the pass glare equals onMode high, and is more than 5x the generic low', Math.abs(g('high-dip', 'high') - g('high', 'high')) < 1e-6 * g('high', 'high') && g('high-dip', 'high') > 5 * g('generic', 'high'), [g('high-dip', 'high'), g('high', 'high'), g('generic', 'high')]);
    } else console.log('BASE high-dip pass glare, far car (expected = generic low on the base):', g('high-dip', 'high'), 'generic', g('generic', 'high'), 'high', g('high', 'high'));
    if (!process.env.HB_BASE) {
      // (2) per-car agreement
      for (const k of ['low', 'high']) {
        const s = per['high-dip:' + k];
        ok('GPU atlas is on in high-dip (' + k + ') and each lit source\'s slot is the GPU\'s trafficBeamIdx and the halo lamp\'s slot', s.atlas.on && s.src.length === 2 && JSON.stringify(s.atlas.idx) === JSON.stringify(s.src.map((q) => q.idx)) && s.halo.lamps.length === 2 && s.halo.lamps.every((l, i) => l.idx === s.src[i].idx && l.hasBeam), s);
      }
      ok('slots: near car on the built-in low (0), far car on the built-in high (1), no library pool', per['high-dip:low'].src.every((q) => q.idx === 0) && per['high-dip:high'].src.every((q) => q.idx === 1));
      // transition
      await car(rels.mid); await pose(D0); const m = await state();
      const byY = {}; for (const q of m.src) (byY[q.y] = byY[q.y] || []).push(q);
      ok('transition: car near the dip distance has a low and a high source per lamp, atlas slots match, weights add up per lamp', m.src.length === 4 && Object.values(byY).every((a) => a.length === 2 && a[0].idx === 0 && a[1].idx === 1 && a[0].w > 0 && a[1].w > 0 && Math.abs(a[0].w + a[1].w - m.src[0].w - m.src[1].w + (a === byY[Object.keys(byY)[0]] ? 0 : 0)) < 1e-3) && JSON.stringify(m.atlas.idx) === JSON.stringify(m.src.map((q) => q.idx)), m);
      const lo = g('high-dip', 'low') > 0 ? per['high-dip:low'].heads[0] : 0, hi = per['high-dip:high'].heads[0];
      ok('transition: glare is between the near and far values', m.heads[0] > 0 && m.heads[0] < hi * 1.01, { mid: m.heads[0], low: lo, high: hi });
    }
    // (3) haze: far car, 1000 m visibility
    const lum = {};
    for (const mode of ['generic', 'high', 'high-dip']) { await setOpts({ onMode: mode }); await car(rels.high); await pose(D0); const b = await shot(); lum[mode] = await meanLum(b); if (['generic', 'high'].includes(mode)) { const h = sha(b); if (process.env.HB_PRINT) console.log('HASH', mode, h); if (!process.env.HB_BASE && !process.env.HB_PRINT) ok('pin: ' + mode + ' frame with the far car is byte-identical to the base (' + PIN[mode] + ')', h === PIN[mode], h); } }
    if (!process.env.HB_BASE) ok('haze: a far oncoming car on high lights the frame more than the same car in generic low (mean level)', lum['high-dip'] > lum.generic * 1.005, lum);
    console.log('luminance', JSON.stringify(lum));
    if (!process.env.HB_BASE) {
      // crest: pose d 1000, the car 200 m along the road is over the crest (CPU blocked: lamp hidden) and 199 m away in a straight line, past its dip distance (f 1).
      // On high its beam lights the haze above the crest line; the same car on generic low barely does. crestOcclusion on keeps the glow above the crest line and cuts what is below it.
      await setOpts({ crestOcclusion: 'on' }); CAR = pick.id;
      const C = {};
      for (const mode of ['generic', 'high-dip']) { await setOpts({ onMode: mode }); await car(200); await pose(1000); const s = await state(); C[mode] = { lum: await meanLum(await shot()), occ: s.halo.occ, f: s.src.length, idx: s.src.map((q) => q.idx) }; }
      ok('crest pose (d 1000), crestOcclusion on: the car on high lights the haze, more than 2x the generic-low frame, with the height map in use and both lamps on the high slot', C['high-dip'].lum > 2 * C.generic.lum && C['high-dip'].occ === true && C['high-dip'].idx.every((i) => i === 1), C);
      await setOpts({ onMode: 'high-dip', crestOcclusion: 'off' }); await car(200); await pose(1000);
      const off = await state(), offLum = await meanLum(await shot());
      ok('crest pose, high-dip: crestOcclusion off does not use the height map, and lights at least as much air as on', off.halo.occ === false && offLum >= C['high-dip'].lum, { off: offLum, on: C['high-dip'].lum });
    }
    if (!process.env.HB_BASE) {
      // a library pool in high-dip on the GPU: the atlas holds the 2 pool beams + built-in low + built-in high; each lit source's slot is the CPU pick (low half) or the high slot
      const bundle = await page.evaluate(() => { const L = RF.DriveAnim._.V.p.lowLut; const scaled = RF.Beams.fromLut({ ...L, data: Float32Array.from(L.data, (x) => x * 0.6) }, { name: 'x', beamKind: 'low', conv: 'A', colour: { cct: 3200 } });
        const wash = RF.Beams.fromLut(RF.Beams.uniformWash(4000, { hMin: -40, hMax: 40, vMin: -12, vMax: 6 }, 0.25), { name: 'x', beamKind: 'low', conv: 'A', colour: { cct: 6500 } });
        return JSON.stringify(RF.Beams.bundle([{ ...scaled, name: 'halogen 3200 design' }, { ...wash, name: 'LED 6500 wash' }], { name: 'HB test bundle' })); });
      await page.setInputFiles('[data-anim="beam-file"]', { name: 'hb-test.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
      await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.startsWith('Added 2'), null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => { const el = document.querySelector('[data-anim="traffic-shuffle"]'); el.value = 'library'; el.dispatchEvent(new Event('change')); });
      await setOpts({ onMode: 'high-dip', crestOcclusion: 'off' }); CAR = pick.id;
      const R = {};
      for (const k of ['low', 'mid', 'high']) { await car(rels[k]); await pose(D0); R[k] = await page.evaluate(() => { const V = RF.DriveAnim._.V, p = V.p, w = RF.Touge.world(p, RF.UI.dvAnim.dist, 0), src = RF.Drive.trafficSources(w.objects, p.eye, p, w.A), a = V.three.atlasState(), h = V.three.haloState(); return { cpu: src.map((q) => q.idx), pick: RF.Drive.trafficPickIndexOf(p, src[0] && src[0].car), gpu: a.idx, haloIdx: h.lamps.map((l) => l.idx), beams: a.beams, on: a.on }; }); }
      ok('library pool in high-dip: atlas = 2 pool beams + built-in low + high (4); the GPU slots are the CPU sources\' slots, the halo lamps carry them, the low half is the symmetric pick, the far car is on slot 3',
        ['low', 'mid', 'high'].every((k) => R[k].on && R[k].beams === 4 && JSON.stringify(R[k].gpu) === JSON.stringify(R[k].cpu) && JSON.stringify(R[k].haloIdx) === JSON.stringify(R[k].cpu)) && R.low.cpu.every((i) => i === R.low.pick) && R.high.cpu.every((i) => i === 3) && R.mid.cpu.includes(R.mid.pick) && R.mid.cpu.includes(3), R);
    }
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) { ok('run completed', false, String(e && e.stack || e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
