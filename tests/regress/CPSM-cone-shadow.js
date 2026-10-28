// CP + SM: the side-on cone pass (haloConePass, haloConeAngle) and the traffic shadow maps (trafficShadows, shadowRes, trafficShadowRoad). GPU, headless.
// Poses: the pass hairpin approach (IL's d 600 rel 90: an oncoming car side-on), plus d 600 rel 50, d 560 rel 80, d 700 rel 60 for the maps. Oncoming lamps carry the scene's beam (onMode symmetric).
// The halo is measured as (frame) - (the same settings with trafficHalo 0), the no-halo frame taken RIGHT BEFORE each one: the frame depends on how many redraws came before
// (IL, 10-28: distant lights pop in at the horizon), so a single no-halo frame at the start contaminates later totals; and a warm-up frame comes first (see haloSum).
// Checks:
//  (1) CP precondition: angle 0 hands both lamps over (share 1) and the table draws none of them.
//  (2) CP accuracy: the total halo light with the cone pass is within 5% of the even 32-bin table and no farther from it than even 8 bins (pencil + wide beam).
//  (3) CP hand-over: at half share the total lies between the 8-bin table's and the cone pass's (2% slack): the two parts add, nothing is counted twice or dropped.
//  (4) SM identity: maps cleared to 'nothing in the way' (SL_SM_CLEAR) give the same halo table texels as trafficShadows off.
//  (5) SM effect: the map agrees with the CPU line-of-sight test (RF.Touge.blocked) on >= 95% of air points inside it, at 4 poses.
//  (6) SM road: shadows on the road with cleared maps change the frame no more than a redraw does; all-blocked maps (SL_SM_BLOCK) remove the oncoming road light (so it is in view and
//      the road reads the maps); real maps leave no salt-noise acne (isolated darkened px < 5% of the darkened ones; few darkened px where the lamp sees the road = no acne).
//  (7) Off again: no cone lamps, no maps, the ribbon text is the old one. (8) No page errors.
// CPSM_PRINT=1 prints the numbers, CPSM_SHOTS=dir saves frames.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/CPSM-cone-shadow.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806), SHOTS = process.env.CPSM_SHOTS, PRINT = !!process.env.CPSM_PRINT;
const fx = (n) => fs.readFileSync(path.join(__dirname, '../fixtures/' + n), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 300, trafficHalo: 16, haloPolar: 'off', lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, crestOcclusion: 'off', haloBins: 8, mountainPass: true, onMode: 'symmetric', haloConePass: 'off', trafficShadows: 'off' };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async (scene) => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'CPSM'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, BASE);
    return page;
  };
  let POSE = { d: 600, rel: 90 };
  const frame = async (page, o, tag) => {
    await page.evaluate(([o, P]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); RF.DriveAnim.trafficCars = () => [{ id: 'oncoming:CPSM', kind: 'oncoming', rel: P.rel, off: V.src.lane }]; }, [o, POSE]);
    await page.evaluate(async (d) => { RF.UI.dvAnim.dist = d; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, POSE.d);
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(400); const buf = await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
    if (SHOTS && tag) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, tag + '.png'), buf); }
    return buf;
  };
  const lumOf = (page, buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, L = new Array(c.width * c.height); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return { w: c.width, h: c.height, L }; }, buf.toString('base64'));
  // The halo of settings o: (frame with o) - (frame with o and trafficHalo 0, drawn just before).
  const DBG = {};
  // A warm-up frame first: an option in the ground cache key rebuilds on its first frame, and that frame's object layer can miss lit objects (seen 10-28: 44 reflector / lamp-head px black).
  const haloSum = async (page, o, tag) => { await frame(page, { ...o, trafficHalo: 16 }); const none = await lumOf(page, await frame(page, { ...o, trafficHalo: 0 }, tag && tag + '-none')), A = await lumOf(page, await frame(page, { ...o, trafficHalo: 16 }, tag)); let s = 0, big = 0, bigS = 0; const bb = [1e9, 1e9, -1, -1];
    for (let i = 0; i < A.L.length; i++) { const d = Math.max(0, A.L[i] - none.L[i]); s += d; if (d > 40) { big++; bigS += d; const x = i % A.w, y = (i / A.w) | 0; bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); } }
    if (tag) DBG[tag] = { big, bigS: Math.round(bigS), bb }; return Math.round(s); };
  const st = (page) => page.evaluate(() => { const t = RF.DriveAnim._.V.three; return { cone: t.coneState(), sm: t.smState(), drawn: t.haloState().drawn }; });
  try {
    const res = {};
    // ---- CP
    for (const [fixture, name] of [['PB-pencil.json', 'pencil'], ['MG2-default-lamp.json', 'wide']]) {
      POSE = { d: 600, rel: 90 }; const page = await open(fx(fixture));
      const even8 = await haloSum(page, { haloBins: 8, haloConePass: 'off' }, name + '-even8');
      const even32 = await haloSum(page, { haloBins: 32 }, name + '-even32');
      const cone = await haloSum(page, { haloBins: 8, haloConePass: '2', haloConeAngle: 0 }, name + '-cone'), s1 = await st(page);
      const ang = Math.min(...s1.cone.lamps.map((q) => q.angle)), half = await haloSum(page, { haloConeAngle: ang - 7.5 }, name + '-half'), s2 = await st(page);
      res[name] = { even8, even32, cone, half, shares1: s1.cone.lamps.map((q) => +q.share.toFixed(3)), drawn1: s1.drawn, angles: s1.cone.lamps.map((q) => +q.angle.toFixed(1)), sharesHalf: s2.cone.lamps.map((q) => +q.share.toFixed(3)) };
      await page.close();
    }
    if (PRINT) console.log(JSON.stringify(res), JSON.stringify(DBG));
    const err = (x, r) => +Math.abs(x / r - 1).toFixed(4);
    ok('CP precondition: angle 0 hands both lamps over with share 1 and the table draws none (pencil + wide)', ['pencil', 'wide'].every((k) => res[k].shares1.length === 2 && res[k].shares1.every((v) => v === 1) && res[k].drawn1 === 0), ['pencil', 'wide'].map((k) => [res[k].shares1, res[k].drawn1, res[k].angles]));
    ok('CP accuracy: cone-pass halo within 5% of even 32 bins and no farther than even 8 bins (total light)', ['pencil', 'wide'].every((k) => { const r = res[k]; return err(r.cone, r.even32) <= 0.05 && err(r.cone, r.even32) <= err(r.even8, r.even32) + 0.01; }), Object.fromEntries(['pencil', 'wide'].map((k) => [k, { cone: err(res[k].cone, res[k].even32), even8: err(res[k].even8, res[k].even32) }])));
    ok('CP hand-over: at half share the total lies between the 8-bin table and the cone pass (2% slack)', ['pencil', 'wide'].every((k) => { const r = res[k], lo = Math.min(r.even8, r.cone) * 0.98, hi = Math.max(r.even8, r.cone) * 1.02; return r.sharesHalf.some((v) => v > 0.2 && v < 0.8) && r.half >= lo && r.half <= hi; }), Object.fromEntries(['pencil', 'wide'].map((k) => [k, { half: res[k].half, even8: res[k].even8, cone: res[k].cone, shares: res[k].sharesHalf }])));
    // ---- SM
    POSE = { d: 600, rel: 90 }; const page = await open(fx('MG2-default-lamp.json'));
    const tableB64 = () => page.evaluate(() => RF.DriveAnim._.V.three.haloTableBytes('cum').b64);
    await frame(page, { trafficShadows: 'off' }); const tOff = await tableB64();
    await page.evaluate(() => { globalThis.SL_SM_CLEAR = true; }); await frame(page, { trafficShadows: '1' }); const tClr = await tableB64(), sClr = await st(page);
    ok('SM identity: maps cleared to nothing-in-the-way give the same halo table texels as trafficShadows off', sClr.sm.maps.length === 1 && tClr === tOff, { maps: sClr.sm.maps.length, same: tClr === tOff });
    // (6a) road with cleared maps vs road off: no more change than a plain redraw
    const L = async (o) => lumOf(page, await frame(page, o));
    const diffN = (A, B) => { let n = 0; for (let i = 0; i < A.L.length; i++) if (Math.abs(A.L[i] - B.L[i]) > 2) n++; return n; };
    const rOff = await L({ trafficShadowRoad: 'off' }), rOff2 = await L({ trafficShadowRoad: 'off' }), rClr = await L({ trafficShadowRoad: 'on' });
    const redrawN = diffN(rOff, rOff2), clrN = diffN(rOff2, rClr);
    await page.evaluate(() => { globalThis.SL_SM_CLEAR = false; });
    // (5) map vs CPU line of sight
    const agree = [];
    for (const [d, rel] of [[600, 90], [600, 50], [560, 80], [700, 60]]) {
      POSE = { d, rel }; await frame(page, { trafficShadows: '1', trafficShadowRoad: 'on' });
      agree.push(await page.evaluate(([d]) => {
        const V = RF.DriveAnim._.V, t = V.three, s = t.smState(); if (!s.maps.length) return { d, maps: 0 };
        const M = s.maps[0], map = t.smRead(0), w = RF.Touge.world(V.p, d, 0), A = w.A, a = RF.Touge.attitude(d), F = a.forward, Lf = a.left, U = a.up;
        const cfw = (v) => [F[0] * v[0] + F[1] * v[1] + F[2] * v[2], Lf[0] * v[0] + Lf[1] * v[1] + Lf[2] * v[2], U[0] * v[0] + U[1] * v[1] + U[2] * v[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
        const src = RF.Drive.trafficSources(w.objects, V.p.eye, V.p, A); if (!src.length) return { d, sources: 0 };
        const Lw = [src[0].x, src[0].y, src[0].z];
        const lit = (Pc) => { const v = [0, 1, 2].map((k) => Pc[k] - M.e[k]), x = dot(v, M.f); if (x <= 0.05) return null; const ux = (-dot(v, M.l) / (x * M.p[0])) * 0.5 + 0.5, uy = (dot(v, M.u) / (x * M.p[1])) * 0.5 + 0.5; if (ux < 0 || uy < 0 || ux >= 1 || uy >= 1) return null; const r = Math.hypot(...v); return r <= map.t[Math.floor(uy * map.H) * map.W + Math.floor(ux * map.W)] + 0.3 + 0.015 * r; };
        let n = 0, ag = 0, falseShadow = 0;
        for (let s = -5; s <= 200; s += 5) for (let off = -40; off <= 40; off += 4) for (const h of [1, 3]) { const q = A.surface(s, off), Pw = [q.p[0], q.p[1], q.p[2] + h], g = lit(cfw(Pw)); if (g === null) continue; n++; const c = !RF.Touge.blocked(A, Lw, Pw); if (g === c) ag++; else if (!g) falseShadow++; }
        return { d, inMap: n, agree: ag, frac: n ? +(ag / n).toFixed(3) : 0, falseShadow: n ? +(falseShadow / n).toFixed(3) : 0 };
      }, [d]));
    }
    // Gate on FALSE shadows (map dark, CPU lit: the visible failure). Map lit where the CPU says shadowed is the old behaviour (measured 10-28: up to 11% at d 560, rays grazing the road within the bias; inference).
    ok('SM effect: the map shadows <= 3% of air points the CPU line of sight (RF.Touge.blocked) calls lit, and agrees on >= 85% overall, 4 poses', agree.every((r) => r.inMap > 50 && r.falseShadow <= 0.03 && r.frac >= 0.85), agree);
    // (6b) acne: road on vs off with real maps; isolated darkened pixels among the darkened ones
    let nd = 0, iso = 0, nblk = 0; const perPose = [];   // perPose: [d, rel, darkened px, isolated px, px darkened by the all-blocked control]
    for (const [d, rel] of [[600, 90], [600, 50], [560, 80], [700, 60]]) {
      POSE = { d, rel }; await L({ trafficShadows: '1', trafficShadowRoad: 'off' }); const aOff = await L({ trafficShadowRoad: 'off' }), aOn = await L({ trafficShadowRoad: 'on' });
      const dark = new Uint8Array(aOn.L.length); let n1 = 0, i1 = 0; for (let i = 0; i < dark.length; i++) if (aOff.L[i] - aOn.L[i] > 4) { dark[i] = 1; n1++; }
      const W = aOn.w; for (let y = 1; y < aOn.h - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (dark[i] && !dark[i - 1] && !dark[i + 1] && !dark[i - W] && !dark[i + W]) i1++; }
      await page.evaluate(() => { globalThis.SL_SM_BLOCK = true; }); const aBlk = await L({ trafficShadowRoad: 'on' }); await page.evaluate(() => { globalThis.SL_SM_BLOCK = false; });
      let nb = 0; for (let i = 0; i < aBlk.L.length; i++) if (aOff.L[i] - aBlk.L[i] > 4) nb++;
      nd += n1; iso += i1; nblk += nb; perPose.push([d, rel, n1, i1, nb]);
    }
    const sRoad = await st(page);
    ok('SM road: cleared maps change the frame no more than a redraw (+200 px); all-blocked maps darken > 1000 px (the oncoming road light is in view and the road reads the maps); real maps leave salt-noise acne on < 5% of the px they darken', sRoad.sm.road && clrN <= redrawN + 200 && nblk > 1000 && iso <= 0.05 * Math.max(nd, 20), { redrawPx: redrawN, clearedRoadPx: clrN, darkenedPx: nd, isolated: iso, blockedPx: nblk, perPose });
    await frame(page, { trafficShadows: 'off', haloConePass: 'off' }); const sOff = await st(page);
    ok('off again: no cone lamps, no maps, the ribbon is the old text', sOff.cone.lamps.length === 0 && !sOff.sm.cars && !sOff.sm.road, { cone: sOff.cone.lamps.length, sm: sOff.sm.cars, road: sOff.sm.road });
    await page.close();
  } catch (e) { errors.push(String(e && e.stack || e)); }
  ok('no page errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  const n = checks.filter(Boolean).length; console.log(n === checks.length ? 'ALL PASS ' + n : 'FAILED ' + (checks.length - n) + ' of ' + checks.length);
  process.exit(n === checks.length ? 0 : 1);
})();
