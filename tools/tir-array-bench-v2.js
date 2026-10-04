#!/usr/bin/env node
/* tir-array-bench-v2.js — (copy of tir-array-bench.js that also loads tir-array-v2; adds --envY, kernel column, --spec fmvss-lb2v works too) multi-emitter test scenes (K LEDs in a row facing +x, 1000 lm each, 2×2 mm Lambertian) for the
 * TIR-array solver; paint fidelity and Spec-mode verdicts.  Not part of tests/all.js.
 *   node tools/tir-array-bench.js [--emitters 1,3,5] [--solvers tir-array-v1,spoke] [--rays 1e6] [--spec ece-r112-b] [--specRays 4e6]
 *        [--settings '{"aperture":15}'] [--pitch 40]                                                                            */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('../tests/load.js'); const RF = load();
for (const f of ['tir-array-v1', 'tir-array-v2', 'opus55-2026-09-27-mosaic']) { const p = path.join(__dirname, '..', 'solvers', f + '.js'); if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const Ks = String(args.emitters || '1,3,5').split(',').map(Number), solvers = String(args.solvers || 'tir-array-v1').split(','), N = +(args.rays || 1e6);
const pitch = +(args.pitch || 40), over = JSON.parse(args.settings || '{}');

// a low-beam-ish paint on a 10 m wall: wide band below the horizon, brighter hot spot right of centre
function paint(res, half) {
  const out = new Array(res * res).fill(0), s = 2 * half / res;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const u = -half + (i + 0.5) * s, v = -half + (j + 0.5) * s;
    let w = 0;
    if (Math.abs(u) < 3000 && v < -100 && v > -900) w = 0.35;
    if (u > -300 && u < 1200 && v < -100 && v > -450) w = 1;
    out[j * res + i] = w;
  }
  return out;
}
function scene(K, spec) {
  const sc = RF.State.defaultScene(); sc.solve = { id: solvers[0] };
  const base = Object.assign(RF.U.deepCopy(sc.source), { pos: [0, 0, 0], axis: [1, 0, 0], power: 1000, w: 2, h: 2 });
  const ys = []; for (let k = 0; k < K; k++) ys.push((k - (K - 1) / 2) * pitch);
  sc.source = Object.assign(RF.U.deepCopy(base), { pos: [0, ys[0], 0] });
  sc.emitters = ys.slice(1).map((y, k) => Object.assign(RF.U.deepCopy(base), { id: 'e' + (k + 2), enabled: true, pos: [0, y, 0] }));
  sc.envelope = { shape: 'box', center: [28, 0, 0], half: [36, args.envY ? +args.envY : (K - 1) * pitch / 2 + pitch / 2 + 2, 26], axis: 2, keepOut: 5 };
  sc.sim.bounces = 4; sc.sim.rays = N;
  if (spec) {
    sc.mode = 'D'; RF.Spec.applyPreset(sc.modeD, spec);
    sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc)); sc.modeA.paint = RF.Spec.seedPaint(sc);
  } else {
    Object.assign(sc.target, { distance: 10000, size: 8000, res: 80 }); sc.sim.res = 80;
    sc.modeA.paint = paint(80, 4000);
  }
  return sc;
}
function run(K, id, spec) {
  const sc = scene(K, spec); sc.solve = { id }; sc.solverSettings = { [id]: over };
  const t0 = Date.now(), r = RF.Solvers.runSync(sc, id), ms = Date.now() - t0, out = r.output, f = r.facts;
  const viol = f.errors.length + f.violations.envelope.length + f.violations.keepOut.length + (f.violations.budget ? 1 : 0);
  const row = { K, id, ms, surfaces: out.surfaces.length, placed: f.placed, parts: f.parts, viol, errors: f.errors.concat(f.violations.envelope.slice(0, 3).map((x) => 'env:' + x), f.violations.keepOut.slice(0, 3).map((x) => 'keep:' + x)), notes: out.notes };
  if (f.errors.length) return row;
  const b = Math.max(sc.sim.bounces, f.needsBounces || 0);
  const input = RF.Solvers.inputOf(sc);
  const problem = RF.U.deepCopy({ source: sc.source, emitters: sc.emitters, target: input.target, envelope: sc.envelope, sim: Object.assign({}, sc.sim, { bounces: b }), modeA: { paint: input.paint.cells } });
  if (spec) Object.assign(problem, { modeD: sc.modeD, mode: 'D' });
  const tr = RF.Solvers.trace(problem, out.surfaces, { rays: spec ? Math.min(2e6, +(args.specRays || 2e6)) : N, bounces: b, spec: !!spec });
  row.lmOnTarget = tr.lmOnTarget; row.peakCd = tr.peakCd;
  if (args.map) {                                          // --map: ASCII picture of the traced target (rows of 2 cells)
    const res = tr.res, g = tr.grid, mx = Math.max(...g), ch = ' .:-=+*#%@';
    for (let j = res - 1; j > 0; j -= 2) { let s = ''; for (let i = 0; i < res; i++) s += ch[Math.min(9, Math.floor(5 * (g[j * res + i] + g[(j - 1) * res + i]) / mx))]; console.log(s); }
  }
  if (tr.fidelity) Object.assign(row, { fidelity: tr.fidelity.fidelity, within: tr.fidelity.within, gapsDark: tr.fidelity.gapsDark, ceiling: tr.fidelity.fidelityNoiseCeiling, kernel: tr.fidelity.kernelCells });
  if (tr.spec) Object.assign(row, { verdict: tr.spec.verdict, fail: tr.spec.n.fail, unsure: tr.spec.n.unsure, pass: tr.spec.n.pass, fails: tr.spec.rows.filter((x) => x.verdict === 'fail').map((x) => x.name), imax: (tr.spec.rows.find((x) => x.kind === 'imax') || {}).value });
  return row;
}
const rows = [];
for (const K of Ks) for (const id of solvers) for (const spec of [null].concat(args.spec ? [args.spec] : [])) {
  let row; try { row = run(K, id, spec); } catch (e) { row = { K, id, error: String(e.stack || e) }; }
  row.mode = spec || 'paint'; rows.push(row);
  const pc = (x) => (x === undefined ? '—' : (100 * x).toFixed(1) + '%');
  console.log(`K=${K} ${id.padEnd(16)} ${row.mode.padEnd(12)} ` + (row.error ? 'ERROR ' + row.error : `fid ${pc(row.fidelity)} (within ${pc(row.within)}, gaps ${pc(row.gapsDark)}, ceil ${pc(row.ceiling)}, ker ${row.kernel === undefined ? '—' : row.kernel.toFixed(2)}) · ${row.verdict ? row.verdict + ' fail ' + row.fail + ' unsure ' + row.unsure + ' imax ' + Math.round(row.imax || 0) + ' cd · ' : ''}lm ${Math.round(row.lmOnTarget || 0)} · peak ${Math.round(row.peakCd || 0)} cd · ${row.placed} facets + ${row.parts} parts · viol ${row.viol} ${row.errors.join(' ')} · ${(row.ms / 1000).toFixed(1)} s`));
  if (args.notes && row.notes) console.log('   ' + row.notes.join('\n   '));
  if (row.fails && row.fails.length) console.log('   fails: ' + row.fails.join(', '));
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 1));
