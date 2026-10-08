#!/usr/bin/env node
// steps.js <scene.json> — how far a design's facets are from one continuous surface: for rays from the emitter centre, the depth jump between
// neighbouring facets across their shared edges (sample pairs of nearby directions that hit different facets).
'use strict';
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', '..', 'tests', 'load.js')); const RF = load(); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')), S = RF.State.allSurfaces(sc).filter((f) => f.type === 'facet');
const G = RF.Geo.compile(S), O = sc.source.pos, N = 60000, eps = 0.004, jumps = [];
const first = (d) => { let best = { t: Infinity, k: -1 }; for (let k = 0; k < S.length; k++) { const t = RF.Geo.intersect(G.D, G.poly, k, O[0], O[1], O[2], d[0], d[1], d[2], 1e-6, 1e6); if (t >= 0 && t < best.t) best = { t, k }; } return best; };
for (let i = 0; i < N; i += 7) {
  const z = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * 2.399963229728653, d = [z, r * Math.cos(ph), r * Math.sin(ph)];
  const a = first(d); if (a.k < 0) continue;
  const e1 = V.norm(V.cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), d2 = V.norm(V.add(d, V.mul(e1, eps))), b = first(d2);
  if (b.k >= 0 && b.k !== a.k) jumps.push(Math.abs(a.t - b.t) - Math.abs(a.t * eps) * 0);      // a.t·eps ≈ 0.2 mm of lateral offset: depth jump ≫ that = a step
}
jumps.sort((x, y) => x - y); const q = (t) => jumps[Math.min(jumps.length - 1, Math.floor(t * jumps.length))].toFixed(2);
console.log(`facet-to-facet depth jumps at shared edges (mm, n ${jumps.length}): p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(0.999)}`);
