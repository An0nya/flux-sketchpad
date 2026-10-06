#!/usr/bin/env node
/* hot-map.js scene [settingsJSON] — kernel-averaged (0.3°) T* and model over the hot-spot region, as kcd tables (rows v, cols h). */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', setIn = process.argv[3] ? JSON.parse(process.argv[3]) : {}; const sc = makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RFX.SqmPipe.solve(input, setIn, { progress() {}, budget: { ms: 1e9 } }), P = out.P, g = P.g, m = out.best.m, hs = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6], vs = [0.3, 0, -0.2, -0.4, -0.6, -0.8, -1.0, -1.3, -1.7, -2.2];
const kavg = (E, h, v, k) => { let s = 0, w = 0; for (let j = g.jOf(v - k); j <= g.jOf(v + k); j++) for (let i = g.iOf(h - k); i <= g.iOf(h + k); i++) { s += E[j * g.nh + i]; w += g.om[j * g.nh + i]; } return s / w; };
const Tl = Float64Array.from(P.des.T, (t, q) => t * g.om[q]); const row = (E, v) => hs.map((h) => (kavg(E, h, v, 0.15) / 1000).toFixed(1).padStart(5)).join(' ');
console.log('kcd, kernel ±0.15°      h: ' + hs.map((h) => String(h).padStart(5)).join(' ')); for (const v of vs) console.log(`T*    v ${String(v).padStart(5)}:        ${row(Tl, v)}\nmodel v ${String(v).padStart(5)}:        ${row(m.Et, v)}`);
console.log('cut-off top(h): ' + hs.map((h) => P.cut.top(h).toFixed(2).padStart(5)).join(' '));
