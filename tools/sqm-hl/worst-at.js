#!/usr/bin/env node
/* worst-at.js scene [settingsJSON] — the model's non-passing rows with the position of the worst pixel */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync('build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', setIn = process.argv[3] ? JSON.parse(process.argv[3]) : {}; const sc = makeScene(name, { preset: process.argv[4] || 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RFX.SqmPipe.solve(input, setIn, { progress() {}, budget: { ms: 1e9 } }), m = out.best.m; console.log(name, 'model verdict', m.ev.verdict, JSON.stringify(m.ev.n), 'shift', m.ev.shift.map((x) => +x.toFixed(2)), out.surfaces.length, 'facets');
for (const r of m.ev.rows) if (r.verdict !== 'pass' || /Zone/.test(r.name)) console.log(' ', r.verdict.padEnd(6), r.name.padEnd(18), (+r.value).toPrecision(4).padStart(9), r.isMin ? '>=' : '<=', (+r.bound).toPrecision(4), r.at ? `at (${r.at[0].toFixed(2)}, ${r.at[1].toFixed(2)})` : '');
