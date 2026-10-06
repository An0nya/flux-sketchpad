#!/usr/bin/env node
/* col-compare.js scene [rays] [settingsJSON] — solve with the packaged debug build, then compare MODEL vs TRACE: the stock judge's aim (cut-off scan column) and the I(v) profile there. */
const fs = require('fs'), vm = require('vm');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', N = +(process.argv[3] || 8e6), setIn = process.argv[4] ? JSON.parse(process.argv[4]) : { traces: 0 };
const sc = makeScene(name.startsWith('file:') ? name : name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc), def = RF.Solvers.get('sqm-hl');
const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
const t0 = Date.now(); const out = def.solve(input, RF.Solvers.sanitize(def, Object.assign({ traces: 0 }, setIn)), { progress() {}, budget: { ms: 1e9 }, scene: problem, trace: () => null });
console.log('solve', ((Date.now() - t0) / 1000).toFixed(1), 's', out.surfaces.length, 'surfaces'); const surf = out.surfaces, spec = input.spec, win = spec.window, step = 0.05;
const opts = { win, step, conv: spec.conv, distance: Infinity, centre: input.source.pos.slice() }; const dd = +spec.measure.distance; if (dd > 0 && isFinite(dd)) opts.distance = dd;
sc.groups.A.surfaces = surf; const Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); Pp.ffStreams = [opts]; const c = RF.Engine.newCtx(Pp, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true; const Gt = RF.FarField.build(c, opts);
const P = RFX.SqmPipe.problem(input, Object.assign({}, RFX.SqmPipe.DEFAULTS), {});
const fld = RFX.SqmFwd.field(surf.map((f) => Object.assign({}, f)), P.S_, P.grid, { na: +(setIn.NA || 150), occlude: true });
const P0 = RF.Engine.prepare(Object.assign({}, sc, { groups: Object.assign({}, sc.groups, { A: Object.assign({}, sc.groups.A, { surfaces: [] }) }) }), []); P0.ffStreams = [opts]; const c0 = RF.Engine.newCtx(P0, N, 0); RF.Engine.traceRange(c0, 0, N); c0.next = N; c0.done = true; const G0 = RF.FarField.build(c0, opts);
const Em = Float64Array.from(fld.E, (x, q) => x + Math.max(0, G0.E[q])), Gm = RFX.SqmTarget.judgeGrid(P.g, Em, { distance: P.dist, centre: P.Lp });
const md = RFX.SqmTarget.mdOf(spec), evT = RF.Spec.evaluate(Gt, md), evM = RF.Spec.evaluate(Gm, md);
console.log('TRACE judge:', evT.aim.note, 'shift', evT.shift.map((x) => +x.toFixed(2)), JSON.stringify(evT.n)); console.log('MODEL judge:', evM.aim.note, 'shift', evM.shift.map((x) => +x.toFixed(2)), JSON.stringify(evM.n));
const h = -2.5, kv = Math.max(step / 2, 0.035) * 0.99, col = (G) => { const r = []; for (let v = -3.57; v + 0.1 <= 2.43 + 1e-9; v += 0.05) { const a = RF.FarField.intensityAt(G, h, v, 0.25, kv), b = RF.FarField.intensityAt(G, h, v + 0.1, 0.25, kv); r.push({ v: +(v + 0.05).toFixed(2), a: a.cd, g: a.cd > 0 && b.cd > 0 ? Math.log10(a.cd / b.cd) : null }); } return r; };
const ct = col(Gt), cm = col(Gm); let topT = 0, topM = 0; for (const r of ct) topT = Math.max(topT, r.a); for (const r of cm) topM = Math.max(topM, r.a);
console.log(`column h=${h}: top trace ${topT.toFixed(0)} model ${topM.toFixed(0)}   (2% gate: ${(0.02 * topT).toFixed(0)} / ${(0.02 * topM).toFixed(0)})`); console.log('   v     trace_cd  g     |  model_cd   g');
for (let i = 0; i < ct.length; i++) if (ct[i].v > -1.3 && ct[i].v < 1.5 && i % 2 === 0) console.log(String(ct[i].v).padStart(6), ct[i].a.toFixed(0).padStart(8), ct[i].g === null ? '   -  ' : ct[i].g.toFixed(2).padStart(6), ' |', cm[i].a.toFixed(0).padStart(8), cm[i].g === null ? '   -  ' : cm[i].g.toFixed(2).padStart(6));
// decomposition at the column above the cut-off: reflected facets (model) vs direct light (empty-lamp trace) — kernel-averaged like the judge
{ const box = (E, om, i0, i1, j0, j1) => { let s = 0, w = 0; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s += E[j * Gt.nh + i]; w += om[j * Gt.nh + i]; } return s / w; };
  const i0 = Math.floor((h - 0.25 - Gt.h0) / step), i1 = Math.floor((h + 0.25 - Gt.h0) / step); console.log('decomposition at column (cd, 0.5°×0.1° boxes): v | reflected(model) | direct(trace) | total trace');
  for (const v of [-0.5, -0.2, 0.1, 0.4, 0.7, 1.0, 1.5, 2.0]) { const j0 = Math.floor((v - 0.05 - Gt.v0) / step), j1 = Math.floor((v + 0.05 - Gt.v0) / step); console.log(String(v).padStart(5), box(fld.E, Gt.Om, i0, i1, j0, j1).toFixed(0).padStart(8), box(G0.E, Gt.Om, i0, i1, j0, j1).toFixed(0).padStart(8), box(Gt.E, Gt.Om, i0, i1, j0, j1).toFixed(0).padStart(8)); } }
{ const main = surf.filter((f) => !f.decal), dec = surf.filter((f) => f.decal), fM = RFX.SqmFwd.field(main.map((f) => Object.assign({}, f)), P.S_, P.grid, { na: 100, occlude: true }), fD = dec.length ? RFX.SqmFwd.field(dec.map((f) => Object.assign({}, f)), P.S_, P.grid, { na: 100, occlude: true }) : { E: new Float64Array(fld.E.length) };
  const box = (E, i0, i1, j0, j1) => { let s = 0, w = 0; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s += E[j * Gt.nh + i]; w += Gt.Om[j * Gt.nh + i]; } return s / w; };
  const i0 = Math.floor((h - 0.25 - Gt.h0) / step), i1 = Math.floor((h + 0.25 - Gt.h0) / step); console.log(`facets: ${main.length} main, ${dec.length} decals;  column glow by class (cd): v | main | decals`);
  for (const v of [-0.5, -0.2, 0.1, 0.4, 0.7, 1.0, 1.5, 2.0]) { const j0 = Math.floor((v - 0.05 - Gt.v0) / step), j1 = Math.floor((v + 0.05 - Gt.v0) / step); console.log(String(v).padStart(5), box(fM.E, i0, i1, j0, j1).toFixed(0).padStart(8), box(fD.E, i0, i1, j0, j1).toFixed(0).padStart(8)); } }
// the same reading position for both: model's chosen shift applied to model and trace alike (grid origin moved, aimed 'as designed', no reaim box)
{ const [dh, dv] = evM.shift, mdFix = Object.assign({}, md, { aimMode: 'design', aimBox: null, aimTol: 0 }), mv = (G) => Object.assign({}, G, { h0: G.h0 - dh, v0: G.v0 - dv, h1: G.h1 - dh, v1: G.v1 - dv });
  const a = RF.Spec.evaluate(mv(Gm), mdFix), b = RF.Spec.evaluate(mv(Gt), mdFix); console.log(`\nboth read at the model's shift (${dh.toFixed(2)}, ${dv.toFixed(2)}):  model ${JSON.stringify(a.n)}  trace ${JSON.stringify(b.n)}`);
  a.rows.forEach((r, i) => { const t = b.rows[i]; if (r.verdict !== 'pass' || t.verdict !== 'pass') console.log(' ', r.name.padEnd(18), 'model', (+r.value).toPrecision(4).padStart(9), r.verdict.padEnd(6), '| trace', (+t.value).toPrecision(4).padStart(9), t.verdict.padEnd(6), '| bound', (+r.bound).toPrecision(4)); }); }
