#!/usr/bin/env node
// Can the mode scores run on Fill & fix's own predicted field (no rays)?  For the three designs per scene that were solved with S.debug
// (ff-sharp-fast, ff-bal-fast, ff-light-fast) compute each mode's score twice: on the traced map and on the model's predicted map (Fpred).
//   node tools/mode-pred.js
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), A = require('./mode-analyze.js');
const dir = path.join(__dirname, '..', 'bench-out/modes');
const MODES = { cutoff: ['p-halfplane', 'held-low-beam', 'anya-lowbeam-212', 'anya-lowbeam-1001'], hotspot: ['p-hotwash', 'sparse-hot-16', 'default', 'anya-beamshot-400'], text: ['p-text', 'p-hello', 'held-ring', 'sparse-ring-24'], photo: ['p-gradient', 'p-photo'], uniformity: ['p-wash', 'p-disc'] };
const f2 = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(2));
const pearson = (x, y) => { const n = x.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
function predRun(r) {
  const P = r.paint, Fp = r.Fpred; let on = 0, all = 0; for (let k = 0; k < P.length; k++) { all += Fp[k]; if (P[k] > 0) on += Fp[k]; }
  return Object.assign({}, r, { D: Fp, row: Object.assign({}, r.row, { rays: 1e12, onPaint: on, spill: all > 0 ? 1 - on / all : 0 }) });
}
const KEY = { cutoff: (m) => m.score, hotspot: (m) => m.ofPossible, text: (m) => m.f1 * (1 - Math.min(1, m.farGlare / 0.3)) * (m.paintHoles > 0 ? 0.5 + 0.5 * Math.min(1, m.litHoles / m.paintHoles) : 1), photo: (m) => 0.5 * m.rho * (1 - Math.min(1, 2 * m.lightnessErr)) + 0.5 * Math.max(0, m.detail), uniformity: (m) => m.score };
const rowsOut = [];
for (const [mode, scenes] of Object.entries(MODES)) for (const scene of scenes) {
  const runs = A.load(scene).filter((r) => r.Fpred); if (runs.length < 2) continue;
  const tr = [], pr = [], corr = [], onT = [], onP = [];
  for (const r of runs) { const p = predRun(r), a = M[mode](r), b = M[mode](p); tr.push(KEY[mode](a)); pr.push(KEY[mode](b)); const idx = []; for (let k = 0; k < r.paint.length; k++) idx.push(k); corr.push(pearson(Array.from(r.D), Array.from(r.Fpred))); onT.push(r.row.onPaint); onP.push(p.row.onPaint); }
  const order = (v) => v.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).map((p) => runs[p[1]].label.split('__')[1].replace('ff-', '').replace('-fast', '')).join(' > ');
  console.log(mode.padEnd(10) + scene.padEnd(19) + 'traced ' + tr.map(f2).join('/') + '  pred ' + pr.map(f2).join('/') + '   onPaint traced ' + onT.map((x) => (100 * x).toFixed(0)).join('/') + ' pred ' + onP.map((x) => (100 * x).toFixed(0)).join('/') + '   field corr ' + corr.map(f2).join('/') + '   order traced: ' + order(tr) + '  |  pred: ' + order(pr));
  rowsOut.push({ mode, scene, traced: tr, pred: pr, orderSame: order(tr) === order(pr) });
}
console.log('\nsame order of the 3 designs on both: ' + rowsOut.filter((r) => r.orderSame).length + ' of ' + rowsOut.length + ' scene×mode pairs   (designs in each triple: ' + 'sharp, balanced, light at quality fast)');
