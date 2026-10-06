#!/usr/bin/env node
/* guard-design.js scene preset — the ideal beam alone (no polish): asked flux, wash level, edge tries, with the aim guard on and off. */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(process.env.SQM_DEBUG || 'build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', preset = process.argv[3] || 'fmvss-lb2v';
for (const guard of [0.011, 0]) {
  const sc = makeScene(name, { preset, budget: 100 }), input = RF.Solvers.inputOf(sc);
  const S = Object.assign({}, RFX.SqmPipe.DEFAULTS, { aimGuard: guard }), P = RFX.SqmPipe.problem(input, S, { progress() {} });
  const Mtot = P.Mtot || 1885; const capLm = +(process.argv[4] || 0.7 * Mtot); RFX.SqmPipe.design(P, capLm); const d = P.des;
  console.log(JSON.stringify({ guard, capLm, fluxTarget: Math.round(P.refl * capLm * 0.97), asked: Math.round(d.flux), W0: Math.round(d.W0), leftover: Math.round(d.leftover), edge: d.edge, tries: d.tries, guardCols: (d.guard || []).map((c) => [c.hc, Math.round(c.M), Math.round(c.cap), c.px.length]) }));
}
