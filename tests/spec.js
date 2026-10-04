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
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
