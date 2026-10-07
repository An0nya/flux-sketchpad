#!/usr/bin/env node
// probe: send a ray from the LED toward the centre of facet <id> through the engine and print what it meets
const fs = require('fs'); const { RF } = require('./lib.js'); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const id = process.argv[3] || 'p3_d1'; sc.sim.bounces = 8;
const surf = RF.State.allSurfaces(sc), f = surf.find((s) => s.id === id), S = sc.source.pos;
const P = RF.Engine.prepare(sc, surf); const d = V.norm(V.sub(f.P, S));
console.log(id, 'P', f.P.map((x) => x.toFixed(1)).join(','), 'dist', V.dist(f.P, S).toFixed(1), 'di', f.di, 'vg', f.vg, 'flat', f.flat);
const r = RF.Engine.probeRay(P, S, d, 1); for (const e of r.events) console.log(' ', e.type, 'k', e.k, surf[e.k] ? surf[e.k].id : '', 'at', e.p ? e.p.map((x) => x.toFixed(1)).join(',') : '', 'out', e.dOut ? e.dOut.map((x) => x.toFixed(3)).join(',') : '');
const G = RF.Geo.compile([f]); const fq = RF.Geo.facetQuadric ? RF.Geo.facetQuadric(f.P, f.S0, f.Z, f.flat ? null : f.di) : null; console.log('quadric normal', fq && fq.n && fq.n.map((x) => x.toFixed(3)).join(','), 'expect bisector', V.norm(V.add(V.norm(V.sub(S, f.P)), V.norm(V.sub(f.Z, f.P)))).map((x) => x.toFixed(3)).join(','));
