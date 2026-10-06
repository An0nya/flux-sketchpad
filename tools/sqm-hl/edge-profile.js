#!/usr/bin/env node
/* edge-profile.js scene [rays] [settingsJSON] [h=-2.5] — T*, model and traced intensity down the cut-off scan column (kernel-averaged like the judge), with the log-step per 0.1°. */
const fs = require('fs'), vm = require('vm');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', N = +(process.argv[3] || 8e6), setIn = process.argv[4] ? JSON.parse(process.argv[4]) : {}, h = +(process.argv[5] || -2.5);
const sc = makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const t0 = Date.now(); const out = RFX.SqmPipe.solve(input, Object.assign({}, setIn), { progress() {}, budget: { ms: 1e9 } }); console.log('solve', ((Date.now() - t0) / 1000).toFixed(1), 's', out.surfaces.length, 'facets');
const P = out.P, spec = input.spec, step = 0.05, win = spec.window; const m = out.best.m;
const opts = { win, step, conv: spec.conv, distance: P.dist, centre: input.source.pos.slice() };
sc.groups.A.surfaces = out.surfaces; const Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); Pp.ffStreams = [opts]; const c = RF.Engine.newCtx(Pp, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true; const Gt = RF.FarField.build(c, opts);
const Gm = m.gj, kv = Math.max(step / 2, 0.035) * 0.99, ct = (G, v) => RF.FarField.intensityAt(G, h, v, 0.25, kv).cd;
const Ts = (v) => { const g = P.g; let s = 0, w = 0; for (let j = g.jOf(v - kv); j <= g.jOf(v + kv); j++) for (let i = g.iOf(h - 0.25); i <= g.iOf(h + 0.25); i++) { s += P.des.T[j * g.nh + i] * g.om[j * g.nh + i]; w += g.om[j * g.nh + i]; } return s / w; };
const L = (a, b) => (a > 0 && b > 0 ? Math.log10(a / b) : NaN), f = (x) => (isFinite(x) ? x.toFixed(2).padStart(5) : '    -');
console.log(`column h=${h}   v    T*      g |  model     g |  trace     g     (g = log10 step per 0.1°)`); let mx = { T: 0, M: 0, R: 0 };
for (let v = -1.0; v <= 0.8 + 1e-9; v += 0.05) { const a = [Ts(v), ct(Gm, v), ct(Gt, v)], b = [Ts(v + 0.1), ct(Gm, v + 0.1), ct(Gt, v + 0.1)], g = a.map((x, i) => L(x, b[i])); ['T', 'M', 'R'].forEach((k, i) => { if (a[i] >= 0.02 * 12000 && g[i] > mx[k]) mx[k] = g[i]; });
  console.log(v.toFixed(2).padStart(10), a[0].toFixed(0).padStart(7), f(g[0]), '|', a[1].toFixed(0).padStart(7), f(g[1]), '|', a[2].toFixed(0).padStart(7), f(g[2])); }
console.log('max g (bright side ≥ 240 cd): T*', mx.T.toFixed(2), 'model', mx.M.toFixed(2), 'trace', mx.R.toFixed(2));
// who makes the glow at the column?  model field of the realized facets split by tier
{ const F = RFX.SqmFwd, fac = out.best.facets, main = fac.filter((f) => !f.decal), dec = fac.filter((f) => f.decal);
  const fM = F.field(main, P.S_, P.grid, { na: 100, occlude: true }), fD = dec.length ? F.field(dec, P.S_, P.grid, { na: 100, occlude: true }) : { E: new Float64Array(P.g.n) };
  const g = P.g, box = (E, v) => { let s = 0, w = 0; for (let j = g.jOf(v - 0.05); j <= g.jOf(v + 0.05); j++) for (let i = g.iOf(h - 0.25); i <= g.iOf(h + 0.25); i++) { s += E[j * g.nh + i]; w += g.om[j * g.nh + i]; } return s / w; };
  console.log(`facets ${fac.length}: ${main.length} main + ${dec.length} decals; glow at column by class (cd):   v | main | decals`);
  for (const v of [-0.4, -0.2, 0, 0.3, 0.6, 1.0, 1.5, 2.0]) console.log(String(v).padStart(6), box(fM.E, v).toFixed(0).padStart(7), box(fD.E, v).toFixed(0).padStart(7));
  // which main facets contribute most at the column above the cut-off (v in 0.1..2): list top 5 by their flux there
  const cols = []; main.forEach((f, k) => { const fp = fM.fps[k]; let s = 0; for (let t = 0; t < fp.idx.length; t++) { const j = (fp.idx[t] / g.nh) | 0, i = fp.idx[t] - j * g.nh, hh = g.hOf(i), vv = g.vOf(j); if (Math.abs(hh - h) <= 0.3 && vv > 0.1 && vv < 2.0) s += fp.val[t]; } cols.push([k, s, f.aimRef ? `aim(${f.aimRef.h.toFixed(1)},${f.aimRef.v.toFixed(1)}) ${f.aimRef.tier}` : '?']); });
  cols.sort((a, b) => b[1] - a[1]); console.log('top main contributors to the column glow (lm in the band):', cols.slice(0, 6).map((c) => `#${c[0]} ${c[1].toFixed(4)} ${c[2]}`).join(' | ')); }
{ const F = RFX.SqmFwd, fac = out.best.facets, dec = fac.filter((f) => f.decal), g = P.g, fD = F.field(dec, P.S_, P.grid, { na: 100, occlude: true }), rows = [];
  dec.forEach((f, k) => { const fp = fD.fps[k]; let s = 0, sh = 0, sv = 0, sc = 0; for (let t = 0; t < fp.idx.length; t++) { const j = (fp.idx[t] / g.nh) | 0, i = fp.idx[t] - j * g.nh, hh = g.hOf(i), vv = g.vOf(j), w = fp.val[t]; s += w; sh += w * hh; sv += w * vv; if (Math.abs(hh - h) <= 0.25 && vv > 0.1 && vv < 2.0) sc += w; }
    const mh = sh / s, mv = sv / s; let vh = 0, vv2 = 0; for (let t = 0; t < fp.idx.length; t++) { const j = (fp.idx[t] / g.nh) | 0, i = fp.idx[t] - j * g.nh, w = fp.val[t]; vh += w * (g.hOf(i) - mh) ** 2; vv2 += w * (g.vOf(j) - mv) ** 2; }
    rows.push({ k, aim: f.aimRef ? `(${f.aimRef.h.toFixed(1)},${f.aimRef.v.toFixed(1)})` : '?', seeded: f.aimRef && f.aimRef.seeded, lm: s, centre: `(${mh.toFixed(1)},${mv.toFixed(1)})`, sd: `${Math.sqrt(vh / s).toFixed(1)}x${Math.sqrt(vv2 / s).toFixed(1)}`, inBand: sc }); });
  rows.sort((a, b) => b.inBand - a.inBand); console.log('decals by lm landing in the column band (0.5° × v 0.1–2.0°):  aim | footprint centre | σh×σv ° | lm total | lm in band');
  for (const r of rows.slice(0, 10)) console.log(r.aim.padEnd(11), r.centre.padEnd(11), r.sd.padEnd(8), r.lm.toFixed(3).padStart(7), r.inBand.toFixed(4).padStart(8), r.seeded ? 'seeded' : ''); }
