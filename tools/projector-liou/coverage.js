#!/usr/bin/env node
// coverage.js <scene.json> — from the emitter CENTRE (and both filament ends), which emission directions hit any surface? (geometric, no optics)
'use strict';
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', '..', 'tests', 'load.js')); const RF = load(); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')), S = RF.State.allSurfaces(sc).filter((f) => f.type === 'facet' || /ellipsoid/.test(f.id));
const G = RF.Geo.compile(S), src = sc.source, ax = src.axis || [1, 0, 0], L = (src.length || 0) / 2 - 0.1;
const pts = { centre: src.pos, front: V.add(src.pos, V.mul(ax, L)), rear: V.add(src.pos, V.mul(ax, -L)) };
const N = 20000, bins = 18;
for (const [name, O] of Object.entries(pts)) {
  const hit = new Array(bins).fill(0), tot = new Array(bins).fill(0);
  for (let i = 0; i < N; i++) {
    const z = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * 2.399963229728653, d = [z, r * Math.cos(ph), r * Math.sin(ph)];      // Fibonacci sphere, x = axis
    const w = Math.sqrt(Math.max(0, 1 - z * z)), b = Math.min(bins - 1, Math.floor(Math.acos(z) / Math.PI * bins));      // weight ∝ sin θ (an axial filament's side emission)
    tot[b] += w; let any = false;
    for (let k = 0; k < S.length && !any; k++) { const t = RF.Geo.intersect(G.D, G.poly, k, O[0], O[1], O[2], d[0], d[1], d[2], 1e-6, 1e6); if (t >= 0) any = true; }
    if (any) hit[b] += w;
  }
  console.log(name.padEnd(7), hit.map((h, b) => `${b * 10}°:${Math.round(100 * h / Math.max(1e-9, tot[b]))}%`).join(' '));
}
