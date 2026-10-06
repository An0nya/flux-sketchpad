#!/usr/bin/env node
/* flux-bands.js scene [settingsJSON] — lm in horizontal bands of the window: T* vs the model of the final facets. */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', setIn = process.argv[3] ? JSON.parse(process.argv[3]) : {}; const sc = makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RFX.SqmPipe.solve(input, setIn, { progress() {}, budget: { ms: 1e9 } }), P = out.P, g = P.g, m = out.best.m;
const bands = [[-10, -4.2], [-4.2, -1.7], [-1.7, -0.9], [-0.9, -0.5], [-0.5, 0], [0, 0.5], [0.5, 4], [4, 10]], hs = [[-15, -6], [-6, 0], [0, 6], [6, 15]];
const lm = (E, v0, v1, h0, h1) => { let s = 0; for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); if (v < v0 || v >= v1) continue; for (let i = 0; i < g.nh; i++) { const h = g.hOf(i); if (h < h0 || h >= h1) continue; s += E[j * g.nh + i]; } } return s; };
const Tl = Float64Array.from(P.des.T, (t, q) => t * g.om[q]);
console.log('lm by band (T* | model) per h-band  [-15,-6) [-6,0) [0,6) [6,15)   total'); let tt = 0, tm = 0;
for (const [v0, v1] of bands) { const a = hs.map(([h0, h1]) => lm(Tl, v0, v1, h0, h1)), b = hs.map(([h0, h1]) => lm(m.Et, v0, v1, h0, h1)); tt += a.reduce((x, y) => x + y); tm += b.reduce((x, y) => x + y); console.log(`v ${String(v0).padStart(5)}..${String(v1).padEnd(5)} T* ${a.map((x) => x.toFixed(0).padStart(4)).join(' ')} =${a.reduce((x, y) => x + y).toFixed(0).padStart(4)} | model ${b.map((x) => x.toFixed(0).padStart(4)).join(' ')} =${b.reduce((x, y) => x + y).toFixed(0).padStart(4)}`); }
console.log('total T*', tt.toFixed(0), 'model', tm.toFixed(0));
