#!/usr/bin/env node
// statistical probe: rays from random LED points to random points on facet <id>; what does the engine do with them (fate histogram by event sequence)
const fs = require('fs'); const { RF } = require('./lib.js'); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const ids = process.argv.slice(3); sc.sim.bounces = 8;
const surf = RF.State.allSurfaces(sc), S = sc.source.pos, P = RF.Engine.prepare(sc, surf), F = RF.P3 || null;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (const id of ids) {
  const f = surf.find((s) => s.id === id), pts = f.clip.pts3, c = pts.reduce((a, p) => V.add(a, p), [0, 0, 0]).map((x) => x / pts.length);
  const hist = {}; let n = 0;
  for (let t = 0; t < 300; t++) {
    // a random point in the polygon (fan triangle), a random point on the filament (cylinder along the source axis, radius 0.7, half-length 2.55: small, use the centre ± a bit)
    const i = (rnd() * pts.length) | 0, a = rnd(), b = rnd() * (1 - a); const X = V.add(c, V.add(V.mul(V.sub(pts[i], c), a), V.mul(V.sub(pts[(i + 1) % pts.length], c), b)));
    const o = V.add(S, [(rnd() - 0.5) * 5, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4]), d = V.norm(V.sub(X, o));
    const r = RF.Engine.probeRay(P, o, d, 1), key = r.events.map((e) => e.type + ':' + (e.k !== undefined && surf[e.k] ? surf[e.k].id.replace(/^p3_/, '') : '')).join(' > ');
    const first = r.events[0]; if (!first || first.k === undefined || surf[first.k].id !== id) { const k2 = 'FIRST HIT ' + (first && first.k !== undefined ? surf[first.k].id : first && first.type); hist[k2] = (hist[k2] || 0) + 1; n++; continue; }
    const coarse = r.events.slice(1).map((e) => e.type + (e.k !== undefined && surf[e.k] ? ':' + surf[e.k].id.replace(/^p3_/, '').replace(/\d+$/, '') : '')).join(' > ') || 'escape'; hist[coarse] = (hist[coarse] || 0) + 1; n++;
  }
  console.log(id, '— where 300 rays aimed at it go:'); for (const [k, v] of Object.entries(hist).sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log('  ', String(v).padStart(4), k);
}
