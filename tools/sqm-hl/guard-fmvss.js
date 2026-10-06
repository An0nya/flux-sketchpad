#!/usr/bin/env node
/* guard-fmvss.js scene preset settingsJSON — what the ideal beam and the guard look like for one solve: asked flux, plateau scale, the guard's columns (max, cap, pixels), notes. */
const fs = require('fs'), vm = require('vm'); const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(process.env.SQM_DEBUG || 'build/sqm-hl.debug.js', 'utf8'), { filename: 'sqm-hl.js' }); const RFX = globalThis.__sqm;
const name = process.argv[2] || 'box', preset = process.argv[3] || 'fmvss-lb2v', setIn = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const sc = makeScene(name, { preset, budget: +(setIn.budget || 100) }); const input = RF.Solvers.inputOf(sc);
const out = RFX.SqmPipe.solve(input, Object.assign({}, setIn), { progress() {}, budget: { ms: 1e9 } }), P = out.P, d = P.des;
console.log(JSON.stringify({ name, preset, setIn, asked_lm: +d.flux.toFixed(0), W0: Math.round(d.W0), leftover: Math.round(d.leftover), edge: d.edge, tries: d.tries, alpha: +(d.alpha || 0).toPrecision(4), cover_lm: +out.cover.toFixed(0), Mtot: +out.Mtot.toFixed(0), chosen: P.chosen, window: P.win || P.spec.window,
  aim: { mode: P.spec.aim && P.spec.aim.mode, line: P.spec.aim && P.spec.aim.line, scan: P.spec.aim && P.spec.aim.scan },
  guard: (d.guard || []).map((c) => ({ hc: c.hc, M: Math.round(c.M), cap: Math.round(c.cap), vStart: +c.vStart.toFixed(2), px: c.px.length })), cut: P.cut0 ? { line: P.cut0.line } : null, notes: P.notes.slice(0, 24) }, null, 1));
