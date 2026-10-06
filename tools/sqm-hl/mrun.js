#!/usr/bin/env node
/* mrun.js scene settingsJSON [preset] — one solve with the packaged debug build, then the ACCURATE noise-free verdict (model at 250 aperture samples/facet, stock judge incl. cut-off aim + re-aim box).
 * Prints one JSON line.  Deterministic and fast to judge: use it to compare variants without shot noise; confirm with the traced bench. */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(process.env.SQM_DEBUG || 'build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', setIn = process.argv[3] ? JSON.parse(process.argv[3]) : {}, preset = process.argv[4] || 'ece-r112-b';
const sc = makeScene(name, { preset, budget: +(setIn.budget || 100) }); const input = RF.Solvers.inputOf(sc);
if (setIn.facets > 0) input.limits.maxFacets = setIn.facets;
const t0 = Date.now(); const out = RFX.SqmPipe.solve(input, Object.assign({}, setIn), { progress() {}, budget: { ms: 1e9 } }), ms = Date.now() - t0, P = out.P, m = out.best.m;
const fld = RFX.SqmFwd.field(out.surfaces, P.S_, P.grid, { na: 250, occlude: true }), Ed = m.Ed, Et = Float64Array.from(fld.E, (x, q) => x + Ed[q]);
const gj = RFX.SqmTarget.judgeGrid(P.g, Et, { distance: P.dist, centre: P.Lp }), md = RFX.SqmTarget.mdOf(input.spec), ev = RF.Spec.evaluate(gj, md);
const rows = ev.rows.map((r) => ({ n: r.name, v: +(+r.value).toPrecision(4), b: +(+r.bound).toPrecision(4), min: !!r.isMin, m: +r.margin.toFixed(3), verdict: r.verdict }));
let lm = 0; for (let q = 0; q < Et.length; q++) lm += Et[q];
console.log(JSON.stringify({ scene: name, ms, facets: out.surfaces.length, lm: Math.round(lm), n: ev.n, verdict: ev.verdict, worst: +Math.min(...ev.rows.map((r) => r.margin)).toFixed(3), shift: ev.shift.map((x) => +x.toFixed(2)), aim: ev.aim.note, bad: rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.n} ${r.v}${r.min ? '>=' : '<='}${r.b} (${r.m})`), chosen: P.chosen }));
