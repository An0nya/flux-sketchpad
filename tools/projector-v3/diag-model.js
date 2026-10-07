#!/usr/bin/env node
// where does the MODEL's light go for a v3 design?  loads a scene.json written by run-on-scene, re-runs the model with the loss ledger
const fs = require('fs');
const { RF, loadDev } = require('./lib.js'); loadDev(['lens', 'geom', 'fwd', 'optic']); const P3 = RF.P3;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const surf = RF.State.allSurfaces(sc);
const input = RF.Solvers.inputOf(sc), spec = input.spec, win = spec.window, step = 0.05, dd = +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;
const entry = surf.find((s) => /lens_in$/.test(s.id)), out = surf.find((s) => /lens_out$/.test(s.id)); const a = entry.seg.r1; const flat = entry.seg.kind === 'line';
const L = { n: entry.optics.ior, a, kind: flat ? 'flat-in' : 'curve-in', s: [flat ? { zv: 0, R: Infinity, k: 0 } : { zv: 0, R: entry.seg.R, k: entry.seg.k }, out.seg.kind === 'conic' ? { zv: out.seg.zv, R: out.seg.R, k: out.seg.k } : { zv: out.seg.z0, R: Infinity, k: 0 }] };
L.sag0 = flat ? 0 : RF.Geo.conicSag(L.s[0].R, L.s[0].k, a); L.t = L.s[1].zv; L.sag1 = isFinite(L.s[1].R) ? RF.Geo.conicSag(L.s[1].R, L.s[1].k, a) : 0;
// the shield from its surfaces: rebuild the edge polyline from the strips
const strips = surf.filter((s) => /^p3_shield/.test(s.id)); let shield = null;
if (strips.length) { const pts = []; for (const s of strips) { const c = s.clip.pts3; pts.push([c[0][1], c[0][2]], [c[1][1], c[1][2]]); } pts.sort((p, q) => p[0] - q[0]); const ed = []; for (const p of pts) if (!ed.length || Math.abs(p[0] - ed[ed.length - 1][0]) > 1e-6) ed.push(p);
  const s0 = strips[0]; const cy = s0.curv ? -s0.curv[0] : 0, xc = s0.P ? s0.P[0] : 0, yF = s0.P ? s0.P[1] : 0; const zb = Math.min(...strips.map((s) => s.clip.pts3[2][2]));
  shield = { xc, cy, yF, edge: ed, zb, W: Math.max(...ed.map((p) => Math.abs(p[0] - yF))) + 1e-6 }; }
const facets = surf.filter((s) => s.type === 'facet'), S = P3.fwd.sourceSamples(sc.source, 128), grid = P3.fwd.gridOf(win, step, spec.conv, dist, sc.source.pos);
const stats = {}; const post = P3.makePost({ lens: { L, O: entry.O.slice(), T: 0.96 * 0.96 }, shield, stats });
const fld = P3.fwd.field(facets, S, grid, { na: 24, post }); let lm = 0; for (const e of fld.E) lm += e;
let refl = 0; for (const fp of fld.fps) refl += fp.flux;
console.log('facets', facets.length, 'window lm (model)', lm.toFixed(1), '| flux that leaves facets ≈ (shield+lensLost+passBy+through)', JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, +v.toFixed(1)]))));

// ---- per-class comparison with the engine (needs attribution): lumens landing on the solve plane per facet vs the model's window flux per facet
{
  const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
  const r = RF.Solvers.trace(problem, surf, { rays: 3e6, attribution: true, bounces: 6, spec: false });
  const pf = r.perFacet || {}, cls = (id) => (/^p3_d/.test(id) ? 'bypass' : /^p3_f/.test(id) ? 'lens-path' : 'other');
  const tot = {}; facets.forEach((f, k) => { const c = cls(f.id); tot[c] = tot[c] || { n: 0, model: 0, engine: 0 }; tot[c].n++; tot[c].model += fld.fps[k].flux; tot[c].engine += (pf[f.id] || 0); });
  const eu = Object.values(pf).reduce((a, b) => a + b, 0);
  console.log('engine perFacet sum', eu.toFixed(1), '(units as returned) | lmOnTarget', r.lmOnTarget && r.lmOnTarget.toFixed(0));
  for (const [c, v] of Object.entries(tot)) console.log(c.padEnd(10), 'n', v.n, 'model window lm', v.model.toFixed(1), 'engine landed', v.engine.toFixed(1), 'ratio', (v.engine / Math.max(1e-9, v.model)).toFixed(2));
  const rows = facets.map((f, k) => ({ id: f.id, m: fld.fps[k].flux, e: pf[f.id] || 0 })).filter((x) => x.m > 3).map((x) => Object.assign(x, { r: x.e / x.m })).sort((a, b) => a.r - b.r);
  console.log('worst engine/model facets:', rows.slice(0, 8).map((x) => `${x.id} ${x.m.toFixed(1)}→${x.e.toFixed(1)}`).join('  '));
}
