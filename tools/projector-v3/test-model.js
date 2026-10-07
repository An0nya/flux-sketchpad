#!/usr/bin/env node
// Gate: the forward model (facet quadrics → shield → lens → far field) agrees with the ENGINE's trace of the same surfaces.
// Uses a v2-generated scene (not our design code): its facets + its biconvex lens, shield removed on both sides.
const fs = require('fs');
const { RF, loadDev } = require('./lib.js'); loadDev(['lens', 'fwd', 'optic']); const P3 = RF.P3, V = RF.V;
const scn = process.argv[2], N = +(process.argv[3] || 4e6);
if (!scn) { console.log('usage: node test-model.js <scene.json of a projector-v2 design> [rays]   (v2 scene: run projector-v2 on a scene with tools/sqm-hl/run-on-scene.js; its lens parts are named p2_lens_face / p2_lens_exit)'); process.exit(2); }
const sc = RF.State.deserialize(fs.readFileSync(scn, 'utf8'));
const surf = sc.groups.A.surfaces.filter((s) => !/^p2_shield/.test(s.id));
const lensS = surf.filter((s) => /^p2_lens_(face|exit)$/.test(s.id)), face = lensS.find((s) => /face/.test(s.id)), exit = lensS.find((s) => /exit/.test(s.id));
const a = face.seg.r1, zin = face.seg.zv;
const L = { n: face.optics.ior, a, kind: 'bi', s: [{ zv: face.seg.zv, R: face.seg.R, k: face.seg.k }, exit.seg.kind === 'conic' ? { zv: exit.seg.zv, R: exit.seg.R, k: exit.seg.k } : { zv: exit.seg.z0, R: Infinity, k: 0 }] };
L.sag0 = RF.Geo.conicSag(L.s[0].R, L.s[0].k, a); L.t = L.s[1].zv; L.sag1 = isFinite(L.s[1].R) ? RF.Geo.conicSag(L.s[1].R, L.s[1].k, a) : 0;
const O = face.O.slice(); const facets = surf.filter((s) => s.type === 'facet');
const spec = RF.Solvers.inputOf(Object.assign(sc, { groups: sc.groups })).spec;
const win = spec.window, step = 0.05, dd = +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;
const opts = { win, step, conv: spec.conv, distance: dist, centre: sc.source.pos.slice() };
// engine
sc.groups.A.surfaces = surf; sc.sim.bounces = 6; const Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); Pp.ffStreams = [opts];
let t0 = Date.now(); const c = RF.Engine.newCtx(Pp, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true; const Gt = RF.FarField.build(c, opts); console.log('engine', N / 1e6, 'M rays', Date.now() - t0, 'ms, window', Gt.lmWindow.toFixed(1), 'lm');
// model
const S = P3.fwd.sourceSamples(sc.source, 128), grid = P3.fwd.gridOf(win, step, spec.conv, dist, sc.source.pos);
const post = P3.makePost({ lens: { L, O, T: face.optics.fresnelT * face.optics.fresnelT }, shield: null });
t0 = Date.now(); const fld = P3.fwd.field(facets, S, grid, { na: 40, post }); console.log('model ', Date.now() - t0, 'ms');
const nh = Gt.nh, nv = Gt.nv, om = Gt.Om, step_ = step;
const box = (E, k) => { const o = new Float64Array(E.length), r = Math.round(k / step_); for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { let s = 0, w = 0; for (let jj = Math.max(0, j - r); jj <= Math.min(nv - 1, j + r); jj++) for (let ii = Math.max(0, i - r); ii <= Math.min(nh - 1, i + r); ii++) { s += E[jj * nh + ii]; w += om[jj * nh + ii]; } o[j * nh + i] = s / w; } return o; };
let tm = 0, tt = 0; for (let q = 0; q < fld.E.length; q++) { tm += fld.E[q]; tt += Gt.E[q]; }
console.log(`window flux: model ${tm.toFixed(1)} lm, engine ${tt.toFixed(1)} lm → engine/model ${(tt / tm).toFixed(3)}`);
const cm = box(fld.E, 0.3), ct = box(Gt.E, 0.3);
for (const [lo, hi] of [[0, 300], [300, 1500], [1500, 5000], [5000, 15000], [15000, 1e9]]) { const r = []; for (let q = 0; q < cm.length; q++) if (cm[q] >= lo && cm[q] < hi) r.push(ct[q] / cm[q]); r.sort((x, y) => x - y); console.log(`model ${String(lo).padStart(5)}–${String(hi).padStart(9)} cd: ${String(r.length).padStart(6)} px  engine/model median ${r.length ? r[r.length >> 1].toFixed(2) : '–'}  p10 ${r.length ? r[Math.floor(r.length * 0.1)].toFixed(2) : '–'}  p90 ${r.length ? r[Math.floor(r.length * 0.9)].toFixed(2) : '–'}`); }
// where is the light: centroid and spread of both maps (bright part)
const mom = (E) => { let s = 0, h = 0, v = 0; for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const e = E[j * nh + i]; s += e; h += e * (win[0] + (i + 0.5) * step); v += e * (win[2] + (j + 0.5) * step); } return [(h / s).toFixed(2), (v / s).toFixed(2)]; };
console.log('flux centroid (H,V) model', mom(fld.E).join(','), 'engine', mom(Gt.E).join(','));
