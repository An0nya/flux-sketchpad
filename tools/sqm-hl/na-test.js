#!/usr/bin/env node
/* na-test.js scene [settingsJSON] — the model's sharpness/aim as a function of the sampling density of the model itself (same final facets). */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(process.env.SQM_DEBUG || 'build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', setIn = process.argv[3] ? JSON.parse(process.argv[3]) : {}; const sc = makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RFX.SqmPipe.solve(input, setIn, { progress() {}, budget: { ms: 1e9 } }), P = out.P, md = RFX.SqmTarget.mdOf(input.spec);
const Ed = out.best.m.Ed; // direct light (analytic), unchanged
for (const na of [40, 100, 250, 600]) { const t0 = Date.now(); const fld = RFX.SqmFwd.field(out.best.facets, P.S_, P.grid, { na, occlude: true }), Et = Float64Array.from(fld.E, (x, q) => x + Ed[q]);
  const gj = RFX.SqmTarget.judgeGrid(P.g, Et, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, md), g = ev.rows.find((r) => r.unit === 'log');
  console.log(`na ${String(na).padStart(4)} (${Date.now() - t0} ms): sharpness ${g.value.toFixed(3)} at v ${g.at[1].toFixed(2)} | aim ${ev.aim.note} | verdict ${ev.verdict} ${JSON.stringify(ev.n)}`); }
