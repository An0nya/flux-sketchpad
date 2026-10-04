#!/usr/bin/env node
// Spec mode gates: exit-ray recording, far-field intensity (js/farfield.js) against analytic sources, the screen-distance
// switch, and the spec judge (js/spec.js) on synthetic fields with known answers.  node tests/spec.js
const { load } = require('./load.js');
const RF = load();
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!ok) fails++; };

function pointScene(dist, axis) {
  const sc = RF.State.testScene();
  Object.assign(sc.source, { kind: dist === 'lambertian' ? 'planar' : 'point', shape: 'rect', w: 1, h: 1, pos: [0, 0, 0], axis: axis || [1, 0, 0], dist, power: 1000 });
  return sc;
}
function traceExit(sc, N, surfaces) { const P = RF.Engine.prepare(sc, surfaces || []); P.recordExit = true; P.exitCap = N; return RF.Engine.runSync(P, N); }

// 1. isotropic point source: I = P / 4π everywhere, in every convention
{
  const ctx = traceExit(pointScene('isotropic'), 1000000), want = 1000 / (4 * Math.PI);
  check('every ray of a bare source exits exactly once', ctx.ex.n === 1000000 && RF.Engine.exitCoverage(ctx) === 1000000, ctx.ex.n + ' records');
  for (const conv of RF.FarField.CONVS) {
    const G = RF.FarField.build(ctx, { conv, win: [-40, 40, -20, 20], step: 0.5 });
    let e = 0, om = 0; for (let m = 0; m < G.E.length; m++) { e += G.E[m]; om += G.Om[m]; }
    const pts = [[0, 0], [20, 5], [-30, -15], [35, 17]].map(([h, v]) => RF.FarField.intensityAt(G, h, v, 2));
    const z = pts.map((r) => (r.cd - want) / r.sd), worst = Math.max(...z.map(Math.abs));
    check('isotropic, conv ' + conv + ': window mean = P/4π (±1%), points within 4σ', Math.abs(e / om / want - 1) < 0.01 && worst < 4, 'mean ' + (e / om / want).toFixed(4) + ', worst ' + worst.toFixed(1) + 'σ');
  }
}
// 2. Lambertian die facing +x: I(θ) = (P / π) cos θ
{
  const ctx = traceExit(pointScene('lambertian'), 1000000);
  const G = RF.FarField.build(ctx, { conv: 'A', win: [-60, 60, -60, 60], step: 0.5 });
  const z = [[0, 0], [30, 0], [0, 40], [45, 30], [-50, -20]].map(([h, v]) => { const want = 1000 / Math.PI * RF.FarField.dirOf(h, v, 'A')[0], r = RF.FarField.intensityAt(G, h, v, 2); return (r.cd - want) / r.sd; });
  check('Lambertian die: I = (P/π) cos θ within 4σ at 5 directions', Math.max(...z.map(Math.abs)) < 4, z.map((x) => x.toFixed(1) + 'σ').join(' '));
}
// 3. solid angles: the bins of a full-sphere-ish window add up, and conventions agree on a small central bin
{
  let s = 0; for (let v = -89.5; v < 90; v += 1) for (let h = -179.5; h < 180; h += 1) s += RF.FarField.binOmega(h - 0.5, h + 0.5, v - 0.5, v + 0.5, 'A');
  const a = RF.FarField.binOmega(-0.05, 0.05, -0.05, 0.05, 'A'), b = RF.FarField.binOmega(-0.05, 0.05, -0.05, 0.05, 'B'), c = RF.FarField.binOmega(-0.05, 0.05, -0.05, 0.05, 'S');
  check('conv A bins tile the sphere (4π) and A/B/S agree at the axis', Math.abs(s / (4 * Math.PI) - 1) < 1e-9 && Math.abs(a / b - 1) < 1e-6 && Math.abs(a / c - 1) < 1e-5, 'Σ = ' + (s / Math.PI).toFixed(9) + 'π');
  let ok = true; for (const conv of RF.FarField.CONVS) for (const [h, v] of [[0, 0], [12.3, -4.5], [-33, 21]]) { const r = RF.FarField.hvOf(RF.FarField.dirOf(h, v, conv), conv); if (Math.abs(r[0] - h) > 1e-9 || Math.abs(r[1] - v) > 1e-9) ok = false; }
  check('hvOf ∘ dirOf = identity in A, B and S', ok);
}
// 4. a reflector scene: progressive = one-shot for exit records; a screen at 1e9 mm = the far field; a point source at
//    the photometric centre reads the same at any screen distance (its rays all start there)
{
  const sc = RF.State.testScene(); sc.mode = 'A';
  const r = RF.Solvers.runSync(sc); const surfs = r.output.surfaces;
  const P1 = RF.Engine.prepare(sc, surfs); P1.recordExit = true; const one = RF.Engine.runSync(P1, 40000);
  const P2 = RF.Engine.prepare(sc, surfs); P2.recordExit = true; const prog = RF.Engine.newCtx(P2, 40000, 0); while (!RF.Engine.step(prog, 1)) { /* slices */ }
  const same = one.ex.n === prog.ex.n && one.ex.d.every((x, i) => x === prog.ex.d[i]) && one.ex.e.every((x, i) => x === prog.ex.e[i]);
  check('exit records: progressive run = one-shot run, byte for byte', same, one.ex.n + ' exits');
  const E = one.E, exitE = E.direct + E.reflected + E.targetBack + E.escaped; let rec = 0; for (let k = 0; k < one.ex.n; k++) rec += one.ex.e[k];
  check('exit energy = on target + target back + escaped (Float32 rounding)', Math.abs(rec / exitE - 1) < 1e-5, rec.toFixed(3) + ' vs ' + exitE.toFixed(3) + ' lm');
  const o = { win: [-30, 30, -30, 30], step: 0.5, conv: 'A', centre: sc.source.pos };
  const Gi = RF.FarField.build(one, o), Gf = RF.FarField.build(one, Object.assign({}, o, { distance: 1e12 }));
  let diff = 0, tot = 0; for (let m = 0; m < Gi.E.length; m++) { diff += Math.abs(Gi.E[m] - Gf.E[m]); tot += Gi.E[m]; }
  check('screen at 10⁹ m reads the far field', diff / tot < 1e-3, 'Σ|ΔE| / ΣE = ' + (diff / tot).toExponential(2));
  const pc = traceExit(pointScene('isotropic'), 200000), Ga = RF.FarField.build(pc, o), Gb = RF.FarField.build(pc, Object.assign({}, o, { distance: 3000 }));
  let d2 = 0, t2 = 0; for (let m = 0; m < Ga.E.length; m++) { d2 += Math.abs(Ga.E[m] - Gb.E[m]); t2 += Ga.E[m]; }
  check('point source at the centre: screen at 3 m = far field', d2 / t2 < 1e-6, (d2 / t2).toExponential(2));
}
// 5. the judge on synthetic fields (a fake grid: E = cd × Ω, noise from 1e-6 lm rays)
function fakeG(fn, win, step) {
  const h0 = win[0], v0 = win[2], nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), n = nh * nv, E = new Float64Array(n), E2 = new Float64Array(n), Om = new Float64Array(n), eRay = 1e-6;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const m = j * nh + i, om = RF.FarField.binOmega(h0 + i * step, h0 + (i + 1) * step, v0 + j * step, v0 + (j + 1) * step, 'A'); Om[m] = om; E[m] = fn(h0 + (i + 0.5) * step, v0 + (j + 0.5) * step) * om; E2[m] = E[m] * eRay; }
  // build() is the only producer of sat; reuse its helper by building a G-shaped object the same way
  const sat = (a) => { const W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; };
  return { E, E2, Om, nh, nv, h0, v0, step, h1: h0 + nh * step, v1: v0 + nv * step, conv: 'A', distance: Infinity, eRay, rays: 1e9, sat: { E: sat(E), E2: sat(E2), Om: sat(Om) } };
}
{
  const cut = 0.5, field = (h, v) => (v < cut ? 10000 : 100);                     // a sharp cut-off at V = +0.5°
  const G = fakeG(field, [-10, 10, -5, 5], 0.1);
  const md = { traffic: 'RHT', conv: 'A', kernel: 0.15, aimTol: 0, items: [
    { id: 'a', kind: 'point', name: 'low', h: 0, v: -1, min: 5000, on: true },
    { id: 'b', kind: 'point', name: 'glare', h: 0, v: 0.2, max: 350, on: true },
    { id: 'c', kind: 'zone', name: 'above', poly: [[-5, 1], [5, 1], [5, 3], [-5, 3]], max: 625, on: true },
    { id: 'd', kind: 'gradient', name: 'sharp', h: 0, v0: -1, v1: 1.5, dv: 0.1, min: 0.13, on: true },
  ] };
  let ev = RF.Spec.evaluate(G, md);
  const by = (n) => ev.rows.find((r) => r.name === n);
  check('judge: min met / glare point lit / dark zone ok / sharp edge', by('low').verdict === 'pass' && by('glare').verdict === 'fail' && by('above').verdict === 'pass' && by('sharp').verdict === 'pass' && ev.verdict === 'fail',
    ev.rows.map((r) => r.name + ' ' + r.verdict).join(', '));
  check('judge: the cut-off scan finds the step at V = +0.5° (G = 2)', Math.abs(by('sharp').value - 2) < 1e-9 && Math.abs(by('sharp').at[1] - 0.5) < 0.06, 'G = ' + by('sharp').value.toFixed(3) + ' at ' + by('sharp').at[1].toFixed(2) + '°');
  md.aimTol = 0.6; ev = RF.Spec.evaluate(G, md);
  check('judge: re-aiming within ±0.6° clears the glare point', ev.verdict === 'pass' && ev.shift[1] > 0.3 && ev.atZero.n.fail === 1, 'shift ' + ev.shift.map((x) => x.toFixed(1)).join(', '));
  md.aimTol = 0; md.traffic = 'LHT'; md.items[1].h = 3; ev = RF.Spec.evaluate(G, md);
  check('judge: left-hand traffic mirrors H', ev.rows.find((r) => r.name === 'glare').at[0] === -3);
  // unsure: a bound inside the noise
  const Gn = fakeG(() => 1000, [-5, 5, -5, 5], 0.1); Gn.E2 = Gn.E.map((e) => e * 1e-3); Gn.sat.E2 = (() => { const nh = Gn.nh, nv = Gn.nv, W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += Gn.E2[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; })();
  const r0 = RF.FarField.intensityAt(Gn, 0, 0, 0.15);
  const evn = RF.Spec.evaluate(Gn, { traffic: 'RHT', conv: 'A', kernel: 0.15, items: [{ id: 'x', kind: 'point', name: 'p', h: 0, v: 0, min: r0.cd + r0.sd, on: true }] });
  check('judge: a bound within 2σ is "unsure", with a ray hint', evn.verdict === 'unsure' && evn.moreRays > 1, '±' + (100 * r0.sd / r0.cd).toFixed(1) + '%, ×' + evn.moreRays.toFixed(1) + ' rays');
}
// 6. the working target: a max carves the painting, a min lifts it; the seed respects the cut-off
{
  const sc = RF.State.defaultScene(); sc.mode = 'D'; sc.target.distance = 10000; sc.target.size = RF.Spec.fitTargetSize(sc);
  const res = sc.target.res; sc.modeA.paint = new Array(res * res).fill(0.5);
  sc.modeD.items = [{ id: 'm', kind: 'point', name: 'hole', h: 0, v: 0, max: 1, on: true }, { id: 'n', kind: 'zone', name: 'lift', poly: [[5, -3], [8, -3], [8, -1], [5, -1]], min: 50000, on: true }];
  sc.modeD.paintCd = 10000;
  const wp = RF.Spec.workingPaint(sc), T = RF.Engine.designFrame(sc.target);
  const at = (h, v) => { const uv = RF.Spec.planeUV(sc, h, v), c = RF.Render2D ? null : null; const i = Math.floor((uv[0] + T.half) / (2 * T.half) * res), j = Math.floor((uv[1] + T.half) / (2 * T.half) * res); return wp[j * res + i]; };
  check('working target: max → hole, min-zone → brighter than the painting', at(0, 0) < 0.01 && at(6.5, -2) > 3 * at(-6.5, -2), 'hole ' + at(0, 0).toFixed(4) + ', lift ' + at(6.5, -2).toFixed(3) + ' vs ' + at(-6.5, -2).toFixed(3));
  const seed = RF.Spec.seedPaint(sc); let above = 0; for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const [u, v] = RF.Engine.cellCenter(T, i, j), hv = RF.Spec.hvAtUV(sc, u, v); if (hv[0] < -1 && hv[1] > -0.4 && seed[j * res + i] > 0) above++; }
  check('seed painting stays under the oncoming-side cut-off', above === 0 && seed.some((x) => x > 0), above + ' cells above');
  const old = JSON.parse(RF.State.serialize(sc)); delete old.modeD; const back = RF.State.deserialize(old);
  check('older scenes load with the default spec', back.modeD && back.modeD.items.length > 0 && back.modeD.preset === 'ece-r112-b');
}
// 7. (backlog trap) a collimating facet (di = ∞) survives save / load — it used to reload flat (JSON null)
{
  const sc = RF.State.testScene();
  const f = { type: 'facet', id: 'Mpar', P: [-10, 0, 20], S0: [0, 0, 0], Z: [1000, 0, 0], di: Infinity, clip: { kind: 'rect', hx: 5, hy: 5 } };
  sc.groups.M.surfaces = [f];
  const back = RF.State.deserialize(RF.State.serialize(sc)), g = back.groups.M.surfaces[0];
  const qa = RF.Geo.facetQuadric(f.P, f.S0, f.Z, f.di), qb = RF.Geo.facetQuadric(g.P, g.S0, g.Z, g.di);
  check('a di = ∞ facet reloads as the same paraboloid, not flat', !qb.flat && qa.A.every((x, i) => Math.abs(x - qb.A[i]) < 1e-12) && qa.b.every((x, i) => Math.abs(x - qb.b[i]) < 1e-12), 'saved di = ' + g.di);
}
// 8. the R112 presets carry the regulation's rows (Rev.4, §6.2.4 / §6.3.3 tables, Annex 9)
{
  const P = RF.Spec.PRESETS, B = P['ece-r112-b'], A = P['ece-r112-a'], D = P['ece-r112-b-drive'];
  const it = (p, n) => p.items.find((x) => x.name === n);
  const ok = it(B, 'B50L').max === 350 && it(B, 'B50L').h === -3.43 && it(B, 'B50L').v === 0.57 && it(B, 'BR').max === 1750 && it(B, '75R').min === 10100 && it(B, '75L').max === 10600
    && it(B, '50L').max === 13200 && it(B, '50R').min === 10100 && it(B, '50V').min === 5100 && it(B, '25L').min === 1700 && it(B, 'Zone III').max === 625
    && JSON.stringify(it(B, 'Zone III').poly) === JSON.stringify([[-8, 1], [-8, 4], [8, 4], [8, 2], [6, 1.5], [1.5, 1.5], [0, 0], [-4, 0]]) && it(B, 'Zone IV').min === 2500
    && it(B, 'Zone I').maxRel.ref === '50R' && it(B, 'Zone I').maxRel.factor === 2 && it(B, 'Points 1+2+3').min === 190 && it(B, 'Points 4+5+6').min === 375
    && it(B, 'Point 7').min === 65 && it(B, 'Point 8').min === 125 && it(B, 'Cut-off sharpness').min === 0.13 && it(B, 'Cut-off sharpness').max === 0.40 && it(B, 'Cut-off linearity').max === 0.2
    && it(A, '75R').min === 5100 && !it(A, '50V') && it(A, '25R').min === 1250 && it(A, 'Zone IV').min === 1700 && it(A, 'Zone I').max === 17600
    && it(D, 'Imax').min === 40500 && it(D, 'Imax').max === 215000 && it(D, 'H-2.5L').min === 20300 && it(D, 'H-5R').min === 5100 && it(D, 'HV').minRel.factor === 0.8
    && B.kernel === 0.0745 && B.distance === 25000 && B.aimMode === 'cutoff' && B.aimLine === -0.57 && B.aimBox.left === 0.5 && B.aimBox.right === 0.75 && B.aimBox.up === 0.25 && B.verified === true;
  check('R112 presets: rows, measuring and aiming as in Rev.4', ok);
  const old = JSON.parse(RF.State.serialize(RF.State.defaultScene())); old.modeD.verified = false; old.modeD.items = [{ id: 'x', kind: 'point', name: 'B50L', h: -3.43, v: 0.57, max: 999, on: true }];
  const mig = RF.State.deserialize(old);
  check('scenes saved with the from-memory preset get the regulation rows', mig.modeD.verified === true && mig.modeD.items.length === B.items.length && mig.modeD.items[0].max === 350);
}
// 9. the new kinds and the aiming procedure, on synthetic fields
{
  const mk = (fn) => fakeG(fn, [-12, 12, -6, 6], 0.05);
  const base = { traffic: 'RHT', conv: 'A', kernel: 0.1 };
  // sums
  let ev = RF.Spec.evaluate(mk(() => 100), Object.assign({}, base, { items: [{ id: 's1', kind: 'sum', name: 'S190', pts: [[-8, 4], [0, 4], [8, 4]], min: 190, on: true }, { id: 's2', kind: 'sum', name: 'S375', pts: [[-4, 2], [0, 2], [4, 2]], min: 375, on: true }] }));
  check('sum: 3 × 100 cd meets 190, misses 375', ev.rows[0].verdict === 'pass' && Math.abs(ev.rows[0].value - 300) < 1e-6 && ev.rows[1].verdict === 'fail');
  // relative bound: Zone I < 2 × 50R
  const rel = (zcd) => RF.Spec.evaluate(mk((h, v) => (v < -1.72 ? zcd : 1000)), Object.assign({}, base, { items: [{ id: 'r', kind: 'point', name: '50R', h: 1.72, v: -0.86, on: true }, { id: 'z', kind: 'zone', name: 'Zone I', poly: [[-9, -1.8], [9, -1.8], [9, -4], [-9, -4]], maxRel: { ref: '50R', factor: 2 }, on: true }] }));
  check('relative bound: zone at 1.5k / 2.5k vs 2 × 1k at 50R', rel(1500).rows[0].verdict === 'pass' && rel(2500).rows[0].verdict === 'fail' && Math.abs(rel(2500).rows[0].bound - 2000) < 1e-6);
  // aim by the cut-off: built with its cut-off at V = +0.3°; the lab puts the inflection on 0.57° D (sampling offset +0.87)
  const cutAt = (h) => 0.3 + 0.15 * (h + 2.5) * 0;                                     // flat cut-off
  const lamp = mk((h, v) => (v < cutAt(h) ? 10000 : 100));
  const md = Object.assign({}, base, { aimMode: 'cutoff', aimLine: -0.57, aimBox: null, items: [
    { id: 'g', kind: 'gradient', name: 'G', h: -2.5, v0: -1.5, v1: 0.5, scan: 0.05, dv: 0.1, min: 0.13, max: 0.40, on: true },
    { id: 'b', kind: 'point', name: 'B50L', h: -3.43, v: 0.57, max: 350, on: true }, { id: 'p', kind: 'point', name: 'below', h: -3.43, v: -0.86, min: 5000, on: true }] });
  ev = RF.Spec.evaluate(lamp, md);
  check('aim by cut-off: inflection found and put on 0.57° D', Math.abs(ev.aim.cutV - 0.3) <= 0.05 && Math.abs(ev.shift[1] - 0.87) <= 0.05, ev.aim.note);
  check('a step cut-off is too sharp for G ≤ 0.40 but sharp enough for ≥ 0.13', ev.rows.find((r) => r.name === 'G' && r.isMin).verdict === 'pass' && ev.rows.find((r) => r.name === 'G' && !r.isMin).verdict === 'fail');
  check('after aiming, B50L sits above the cut-off (dark) and 50L-level point below it (lit)', ev.rows.find((r) => r.name === 'B50L').verdict === 'pass' && ev.rows.find((r) => r.name === 'below').verdict === 'pass');
  // linearity: a cut-off tilted 0.15° per degree spreads the inflections at 1.5 / 2.5 / 3.5° by 0.3° (> 0.2°)
  const lin = (tilt) => RF.Spec.evaluate(mk((h, v) => (v < -0.57 + tilt * (h + 2.5) ? 10000 : 100)), Object.assign({}, base, { items: [{ id: 'l', kind: 'linearity', name: 'L', hs: [-1.5, -2.5, -3.5], v0: -1.5, v1: 0.5, scan: 0.05, dv: 0.1, max: 0.2, on: true }] })).rows[0];
  check('linearity: flat passes, 0.15°/° tilt fails', lin(0).verdict === 'pass' && lin(0.15).verdict === 'fail', 'spread ' + lin(0).value.toFixed(2) + '° / ' + lin(0.15).value.toFixed(2) + '°');
  // asymmetric re-aim box (beam right ≤ 0.75 for RHT, mirrored for LHT): a glare point that needs the beam 0.7° right
  const glare = mk((h, v) => (h > -3.0 && h < 3 && Math.abs(v) < 1 ? 10000 : 50));       // bright block |h| < 3, B at h −3.43 + reads it once the beam moves left
  const box = (traffic, h) => RF.Spec.evaluate(glare, Object.assign({}, base, { traffic, aimMode: 'design', aimBox: { left: 0.5, right: 0.75, up: 0.25, down: 0.25 }, items: [{ id: 'q', kind: 'point', name: 'Q', h, v: 0, min: 5000, on: true }] }));
  const r1 = box('RHT', 3.6), r2 = box('RHT', -3.6), r3 = box('LHT', 3.6);
  check('re-aim box: RHT moves the beam ≤ 0.75° right but ≤ 0.5° left; LHT mirrors both', r1.verdict === 'pass' && r2.verdict === 'fail' && r3.verdict === 'pass',
    'needs 0.7°: right ' + r1.verdict + ', left ' + r2.verdict + ', LHT mirrored ' + r3.verdict);
  // peak aim (driving beam): maximum moved onto HV, then HV ≥ 0.8 Imax holds
  const beam = mk((h, v) => 40000 * Math.exp(-((h - 1) ** 2 + (v + 0.5) ** 2) / 2));
  ev = RF.Spec.evaluate(beam, Object.assign({}, base, { aimMode: 'peak', items: [{ id: 'm', kind: 'imax', name: 'Imax', min: 30000, max: 215000, on: true }, { id: 'hv', kind: 'point', name: 'HV', h: 0, v: 0, minRel: { ref: 'Imax', factor: 0.8 }, on: true }] }));
  check('peak aim: maximum put on HV; HV ≥ 0.8 × Imax', Math.abs(ev.shift[0] - 1) < 0.06 && Math.abs(ev.shift[1] + 0.5) < 0.06 && ev.verdict === 'pass', ev.aim.note);
}
// 10. emitter presets (js/source-presets.js)
{
  const SP = RF.SourcePresets, s = RF.State.testScene().source, pos = s.pos.slice();
  SP.apply(s, 'sft40-3000k');
  check('SFT-40 (datasheet): 1.97 mm Lambertian die, defaults to 3 A = 695 lm (bin D9 min, Tj 85 °C)', s.kind === 'planar' && s.w === 1.97 && s.h === 1.97 && s.dist === 'lambertian' && s.driveA === 3 && s.power === 695 && SP.matches(s) && s.pos.join() === pos.join());
  SP.apply(s, 'sft40-3000k', { amps: 4 });
  check('SFT-40 (datasheet): 861 lm at the 4 A rating, Vf 3.11 V, not flagged', s.power === 861 && Math.abs(SP.electrical(s).vf - 3.11) < 1e-9 && !SP.electrical(s).overRated);
  SP.apply(s, 'sft40-3000k', { amps: 8 });
  check('SFT-40 (datasheet): 8 A continues koef3\'s shape scaled at 4 A (1,355 lm), flagged over 4 A and 13 W', s.power === Math.round(1385 * 861 / 880) && SP.electrical(s).overRated && SP.electrical(s).overPower && SP.electrical(s).extrapolated);
  SP.apply(s, 'sft40-3000k', { model: 'koef3', amps: 10 });
  check('SFT-40 (koef3): 1,555 lm at 10 A, flagged over the 4 A rating', s.power === 1555 && SP.electrical(s).overRated && Math.abs(SP.electrical(s).vf - 3.72) < 1e-9);
  SP.apply(s, 'sft40-3000k', { amps: 6.5 });
  check('SFT-40 (koef3): flux interpolates the curve (6.5 A → 1,228 lm)', s.fluxModel === 'koef3' && s.power === Math.round(1170 + 0.5 * 115));
  SP.apply(s, 'sft40-cw', { amps: 8 });
  const ec = SP.electrical(s);
  check('SFT-40 cool white: 8 A = 2,272 lm (6500 K bin N5 min), Vf 3.60 V ≈ 28.8 W, within the 8 A / 29 W rating', s.w === 1.97 && s.power === 2272 && Math.abs(ec.vf - 3.6) < 1e-9 && !ec.overRated && !ec.overPower);
  SP.apply(s, 'sft40-cw', { model: 'n4', amps: 5 });
  check('SFT-40 cool white: bin N4 at 5 A = 1,550 lm', s.power === 1550);
  SP.apply(s, 'sft25r', { amps: 5 });
  const er = SP.electrical(s);
  check('SFT-25R: Ø 1.70 mm disc, 3000 K bin F1 = 1,021 lm at 5 A, Vf 3.40 V (17 W < 18 W), ≈ 143 cd/mm²', s.shape === 'disc' && s.radius === 0.85 && s.power === 1021 && Math.abs(er.vf - 3.4) < 1e-9 && !er.overPower && Math.abs(SP.luminanceOf(s) - 1021 / (Math.PI * Math.PI * 0.85 * 0.85)) < 1e-9);
  // koef3-measured LEDs: the effective area reproduces his luminance at his rows, and stays near-constant with current
  let okK = true, spread = [];
  for (const [id, k] of Object.entries(SP.KOEF3)) {
    const areas = [];
    for (const [a, L] of k.lum) { const t = { pos: [0, 0, 0], axis: [0, 0, 1] }; SP.apply(t, id, { amps: a }); areas.push(t.effArea); if (Math.abs(SP.luminanceOf(t) / L - 1) > 0.01) okK = false; }
    spread.push(id + ' ' + Math.min(...areas).toFixed(2) + '–' + Math.max(...areas).toFixed(2) + ' mm²');
    if (Math.max(...areas) / Math.min(...areas) > 1.15) okK = false;
  }
  check('koef3 LEDs: luminance reproduced at his rows; effective area constant within 15 %', okK, spread.join(' · '));
  const w = { pos: [0, 0, 0], axis: [0, 0, 1] }; SP.apply(w, 'lmp-w5050sq3', { amps: 2.8 });
  const wEff = Math.PI * w.radius * w.radius; SP.apply(w, 'lmp-w5050sq3', { model: 'die', amps: 2.8 });
  check('LMP W5050SQ3: round die; effective ≈ 2.47 mm² from his luminance vs the 2.3 mm² die model', Math.abs(wEff - 2.47) < 0.05 && w.shape === 'disc' && Math.abs(Math.PI * w.radius * w.radius - 2.3) < 1e-3 && !w.effArea && SP.matches(w), 'effective ' + wEff.toFixed(2) + ' mm²');
  const rows = SP.parseRows('Current\tlm\tcd/mm2\n700\t250\t56.2\n2,800 760 160.6\n5.6, 1031, 211.7');
  check('pasted rows: mA → A, thousands separators, mixed delimiters, header skipped', JSON.stringify(rows) === JSON.stringify([[0.7, 250, 56.2], [2.8, 760, 160.6], [5.6, 1031, 211.7]]));
  const u = { pos: [0, 0, 0], axis: [0, 0, 1] }; SP.apply(u, 'measured', { measured: { name: 'test', shape: 'disc', rows }, amps: 2.8 });
  check('measured emitter: round die of area Φ/(πL), flux from the rows', u.shape === 'disc' && u.power === 760 && Math.abs(Math.PI * u.radius * u.radius - 760 / (Math.PI * 160.6)) < 1e-3 && SP.matches(u));
  SP.apply(s, 'hb3', { volts: 12 });
  check('HB3: axial 5.1 mm opaque coil, 1,300 lm at 12 V / 1,860 at 13.2 V', s.kind === 'volume' && s.shape === 'cylinder' && s.length === 5.1 && s.emission === 'surface' && s.axis.join() === '1,0,0' && s.power === 1300 && SP.apply(s, 'hb3', { volts: 13.2 }) && s.power === 1860);
  s.radius = 0.8; check('an edited preset is flagged', !SP.matches(s));
  const P = RF.Engine.prepare(Object.assign(RF.State.testScene(), { source: s }), []); const c = RF.Engine.runSync(P, 2000);
  check('the HB3 source traces (energy closes)', Math.abs(RF.Engine.stats(c).conservationError) < 1e-9);
}
// streamed far field and Refine (Engine.extend)
{
  const sc = RF.State.defaultScene(); sc.mode = 'D'; sc.target.distance = 10000; sc.target.size = RF.Spec.fitTargetSize(sc);
  sc.groups.A.surfaces = RF.ModeA.generate(RF.U.deepCopy(sc)).surfaces;
  const opts = [0, 25000].map((d) => RF.Spec.gridOpts(sc, d)), surfs = RF.State.allSurfaces(sc);
  const P1 = RF.Engine.prepare(sc, surfs); P1.recordExit = true; P1.exitCap = 60000; P1.ffStreams = opts; P1.recordHits = true;
  const one = RF.Engine.runSync(P1, 60000);
  let okS = true, det = [];
  for (const o of opts) {
    const Gs = RF.FarField.build(one, o), Gx = RF.FarField.build(Object.assign({}, one, { ff: null }), o);
    const a = RF.FarField.intensityAt(Gs, 1.15, -0.57, 1), b = RF.FarField.intensityAt(Gx, 1.15, -0.57, 1);
    if (!Gs.streamed || Math.abs(Gs.lmWindow / Gx.lmWindow - 1) > 1e-6 || Math.abs(a.cd / b.cd - 1) > 0.01) okS = false;
    det.push((isFinite(o.distance) ? o.distance / 1000 + ' m' : '∞') + ' ' + Math.round(a.cd) + ' / ' + Math.round(b.cd) + ' cd');
  }
  check('streamed far field = the one built from stored exit rays (window lumens exact; a 2° kernel within 1 %, float32 storage)', okS, det.join(' · '));
  const P2 = RF.Engine.prepare(sc, surfs); P2.recordExit = true; P2.exitCap = 60000; P2.ffStreams = opts; P2.recordHits = true;
  let c = RF.Engine.newCtx(P2, 20000, 0); while (!RF.Engine.step(c, 5)) { /* slices */ }
  const c0 = c; c = RF.Engine.extend(c, 60000); while (!RF.Engine.step(c, 5)) { /* slices */ }
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= 1e-9 * Math.abs(b[i]) + 1e-15);   // equal up to rounding (rescaled sums)
  const same = c !== c0 && near(c.gridD, one.gridD) && near(c.gridR, one.gridR) && near(c.ff[0].E, one.ff[0].E) && near(c.ff[1].E2, one.ff[1].E2)
    && c.nHits === one.nHits && c.ex.n === one.ex.n && c.rayK.every((x, i) => x === one.rayK[i]) && Math.abs(c.E.emitted / one.E.emitted - 1) < 1e-12;
  check('Refine: a 20k run extended to 60k = a 60k run from scratch (grids, streams, hits, exits, attribution)', same, 'conservation ' + RF.Engine.stats(c).conservationError.toExponential(1));
  const sc2 = RF.U.deepCopy(sc); sc2.modeD.step = 0.1;
  let threw = ''; try { RF.FarField.build(Object.assign({}, one, { ex: null }), RF.Spec.gridOpts(sc2)); } catch (e) { threw = e.message; }
  check('a grid the run did not stream (bin changed) asks for a re-trace', /re-trace/.test(threw), threw);
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
