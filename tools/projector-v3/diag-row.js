#!/usr/bin/env node
// which facets put light into a spec row?  node diag-row.js scene.json "<row name>"   (model footprints on the 0.05° grid)
const fs = require('fs');
const { RF, loadDev } = require('./lib.js'); loadDev(['lens', 'geom', 'fwd', 'optic', 'target']); const P3 = RF.P3, T = RF.SqmTarget;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')), rowName = process.argv[3]; const surf = RF.State.allSurfaces(sc);
const input = RF.Solvers.inputOf(sc), spec = input.spec, win = spec.window, step = 0.05, dd = +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;
const entry = surf.find((s) => /lens_in$/.test(s.id)), out = surf.find((s) => /lens_out$/.test(s.id)), a = entry.seg.r1, flat = entry.seg.kind === 'line';
const L = { n: entry.optics.ior, a, kind: flat ? 'flat-in' : 'curve-in', s: [flat ? { zv: 0, R: Infinity, k: 0 } : { zv: 0, R: entry.seg.R, k: entry.seg.k }, out.seg.kind === 'conic' ? { zv: out.seg.zv, R: out.seg.R, k: out.seg.k } : { zv: out.seg.z0, R: Infinity, k: 0 }] };
L.sag0 = flat ? 0 : RF.Geo.conicSag(L.s[0].R, L.s[0].k, a); L.t = L.s[1].zv; L.sag1 = isFinite(L.s[1].R) ? RF.Geo.conicSag(L.s[1].R, L.s[1].k, a) : 0;
const strips = surf.filter((s) => /^p3_shield/.test(s.id)); let shield = null;
if (strips.length) { const pts = []; for (const s of strips) { const c = s.clip.pts3; pts.push([c[0][1], c[0][2]], [c[1][1], c[1][2]]); } pts.sort((p, q) => p[0] - q[0]); const ed = []; for (const p of pts) if (!ed.length || Math.abs(p[0] - ed[ed.length - 1][0]) > 1e-6) ed.push(p); const s0 = strips[0]; shield = { xc: s0.P[0], cy: s0.curv ? -s0.curv[0] : 0, yF: s0.P[1], edge: ed, zb: Math.min(...strips.map((s) => s.clip.pts3[2][2])), W: Math.max(...ed.map((p) => Math.abs(p[0] - s0.P[1]))) + 1e-6 }; }
const facets = surf.filter((s) => s.type === 'facet'), S = P3.fwd.sourceSamples(sc.source, 128), grid = P3.fwd.gridOf(win, step, spec.conv, dist, sc.source.pos), g = T.grid(win, step, spec.conv);
const post = P3.makePost({ lens: { L, O: entry.O.slice(), T: 0.96 * 0.96 }, shield }), B = T.bands(spec, g, { lo: 1.2, hi: 1.2 }), row = B.rows.find((r) => r.name === rowName && r.px); if (!row) { console.log('no pixel row', rowName, B.rows.map((r) => r.name).join(' | ')); process.exit(1); }
const set = new Set(row.px); let tot = 0; const per = [];
facets.forEach((f) => { const fp = P3.fwd.footprint(f, S, grid, { na: 24, post }); let c = 0; for (let q = 0; q < fp.idx.length; q++) if (set.has(fp.idx[q])) c += fp.val[q]; const om = row.px.reduce((x, p) => x + g.om[p], 0); per.push({ id: f.id, cd: c / om, cls: f.id[3] === 'd' ? 'D' : 'L', hc: fp.hc, vc: fp.vc, sh: Math.sqrt(fp.cov[0]), sv: Math.sqrt(fp.cov[2]), flux: fp.flux }); tot += c / om; });
per.sort((x, y) => y.cd - x.cd); console.log(rowName, 'mean cd over the row', tot.toFixed(0), '(limits', row.min, row.max + ')'); for (const p of per.slice(0, 10)) console.log(' ', p.id.padEnd(8), p.cd.toFixed(0).padStart(6), 'cd  centroid', p.hc.toFixed(1), p.vc.toFixed(1), ' rms size', p.sh.toFixed(1), p.sv.toFixed(1), ' flux', p.flux.toFixed(1), 'lm');
