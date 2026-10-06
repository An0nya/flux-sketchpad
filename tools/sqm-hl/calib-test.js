// model vs trace by region for the packaged solver's design: ratio of traced to modelled intensity (smoothed 0.3°), by intensity class and by H/V region
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', N = +(process.argv[3] || 6e6);
const sc = makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc), def = RF.Solvers.get('sqm-hl');
const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
const out = def.solve(input, RF.Solvers.sanitize(def, { traces: 0 }), { progress() {}, budget: { ms: 1e9 }, scene: problem, trace: () => null });
const surf = out.surfaces, spec = input.spec; const win = spec.window, step = 0.05;
const opts = { win, step, conv: spec.conv, distance: Infinity, centre: input.source.pos.slice() };
const dd = +spec.measure.distance; if (dd > 0 && isFinite(dd)) opts.distance = dd;
sc.groups.A.surfaces = surf; const Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); Pp.ffStreams = [opts]; const c = RF.Engine.newCtx(Pp, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true; const Gt = RF.FarField.build(c, opts);
// the model field for the same facets (the solver's own forward model + direct light), via its pipeline objects
const P = RFX.SqmPipe.problem(input, Object.assign({}, RFX.SqmPipe.DEFAULTS), {});
const surfD = surf.map((f) => Object.assign({}, f));
const t00 = Date.now(); const fld = RFX.SqmFwd.field(surfD, P.S_, P.grid, { na: 40, occlude: process.argv[4] !== 'no' }); console.log('model field', Date.now() - t00, 'ms, occlusion', process.argv[4] !== 'no');
// direct light: from the real trace of an EMPTY lamp (same seed): exact
const P0 = RF.Engine.prepare(Object.assign({}, sc, { groups: Object.assign({}, sc.groups, { A: Object.assign({}, sc.groups.A, { surfaces: [] }) }) }), []); P0.ffStreams = [opts]; const c0 = RF.Engine.newCtx(P0, N, 0); RF.Engine.traceRange(c0, 0, N); c0.next = N; c0.done = true; const G0 = RF.FarField.build(c0, opts);
const nh = Gt.nh, nv = Gt.nv, Em = fld.E, Et = Gt.E;
const box = (E, k) => { const o = new Float64Array(E.length), om = Gt.Om; const r = Math.round(k / step); for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { let s = 0, w = 0; for (let jj = Math.max(0, j - r); jj <= Math.min(nv - 1, j + r); jj++) for (let ii = Math.max(0, i - r); ii <= Math.min(nh - 1, i + r); ii++) { s += E[jj * nh + ii]; w += om[jj * nh + ii]; } o[j * nh + i] = s / w; } return o; };
const Rm = Float64Array.from(Em, (x, q) => x + Math.max(0, G0.E[q])), cm = box(Rm, 0.3), ct = box(Et, 0.3);
let tm = 0, tt = 0; for (let q = 0; q < Em.length; q++) { tm += Rm[q]; tt += Et[q]; } console.log(`window flux: model(reflected+direct) ${tm.toFixed(0)} lm, traced ${tt.toFixed(0)} lm → ratio ${(tt / tm).toFixed(3)}`);
const bins = [[0, 300], [300, 1500], [1500, 5000], [5000, 15000], [15000, 1e9]];
for (const [lo, hi] of bins) { let n = 0, sr = 0, sl = []; for (let q = 0; q < cm.length; q++) if (cm[q] >= lo && cm[q] < hi) { n++; const r = ct[q] / cm[q]; sr += r; sl.push(r); } sl.sort((a, b) => a - b); console.log(`model ${String(lo).padStart(5)}–${String(hi).padStart(9)} cd: ${String(n).padStart(6)} px, trace/model median ${sl[sl.length >> 1].toFixed(2)} p10 ${sl[Math.floor(sl.length * 0.1)].toFixed(2)} p90 ${sl[Math.floor(sl.length * 0.9)].toFixed(2)}`); }
// the spec's points
for (const it of spec.items.filter((x) => x.kind === 'point')) { const i = Math.floor((it.h - win[0]) / step), j = Math.floor((it.v - win[2]) / step), q = j * nh + i; console.log(`  ${it.name.padEnd(6)} model ${cm[q].toFixed(0).padStart(6)}  trace ${ct[q].toFixed(0).padStart(6)}  ratio ${(ct[q] / cm[q]).toFixed(2)}`); }
// energy accounting of the real trace
{ const tr = RF.Solvers.trace(problem, surf, { rays: 2e6, spec: false }); console.log('trace energy', JSON.stringify(tr.energy), 'blocked', tr.blocked.toFixed(3), 'lmOnTarget', tr.lmOnTarget && tr.lmOnTarget.toFixed(0)); }
