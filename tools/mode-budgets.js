#!/usr/bin/env node
// Fewest-facets study: quality against facet budget (runs written by tools/mode-run.js from `mode-plans.js budgets`).
//   node tools/mode-budgets.js [--montage]
// For each scene it prints, per budget: facets placed, the app's fidelity, light on paint, the scene's own mode score and gates, then the
// facet count that two candidate rules would pick.  "first" = the first budget whose quality reaches 90% of the best quality seen;
// "stable" = the first budget from which every LARGER budget also reaches it (a dip can't fool it).
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), A = require('./mode-analyze.js'), H = require('./heatmap-png.js');
const dir = path.join(__dirname, '..', 'bench-out/modes'), a = process.argv.slice(2);
const MODE_OF = { 'sparse-spot-16': 'hotspot', 'sparse-ring-24': 'text', 'sparse-bar-16': 'text', 'sparse-hot-16': 'hotspot', 'p-halfplane': 'cutoff', 'p-hello': 'text', 'p-wash': 'uniformity', 'p-photo': 'photo' };
const KEY = { hotspot: (m) => m.ofPossible, text: (m) => m.f1 * (1 - Math.min(1, m.farGlare / 0.3)) * (m.paintHoles > 0 ? 0.5 + 0.5 * Math.min(1, m.litHoles / m.paintHoles) : 1), cutoff: (m) => m.score, uniformity: (m) => m.score, photo: (m) => 0.5 * m.rho * (1 - Math.min(1, 2 * m.lightnessErr)) + 0.5 * Math.max(0, m.detail) };
const GATE = { hotspot: M.hotspotGates, text: M.textGates, cutoff: M.cutoffGates, uniformity: M.uniformityGates, photo: M.photoGates };
const f2 = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(2)), pc = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : (100 * x).toFixed(0));
const out = {};
for (const [scene, mode] of Object.entries(MODE_OF)) for (const prio of ['bal', 'sharp']) {
  const rows = [];
  for (const f of fs.readdirSync(path.join(dir, 'runs')).filter((x) => x.startsWith('bud__' + scene + '__' + prio + '__'))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')), m = M[mode === 'hotspot' ? 'hotspot' : mode](r), g = GATE[mode](m, r);
    rows.push({ b: r.row.budgetAsked, placed: r.row.placed, fid: r.row.fidelity, onP: r.row.onPaint, key: KEY[mode](m), pass: g.pass, why: g.why.join(', '), label: r.label });
  }
  rows.sort((x, y) => x.b - y.b); if (!rows.length) continue;
  const best = Math.max(...rows.map((r) => r.key)), bestFid = Math.max(...rows.map((r) => r.fid));
  const ok = (r, ref, k) => r[k] >= 0.9 * ref, first = rows.find((r) => ok(r, best, 'key') && r.pass), stableIdx = rows.findIndex((r, i) => rows.slice(i).every((q) => ok(q, best, 'key') && q.pass));
  const firstFid = rows.find((r) => ok(r, bestFid, 'fid')), stableFid = rows.findIndex((r, i) => rows.slice(i).every((q) => ok(q, bestFid, 'fid')));
  console.log('## ' + scene + ' (' + mode + ', priority ' + prio + ')   mode score = ' + (mode === 'hotspot' ? 'hot cd of possible' : mode));
  console.log('  budget placed  fid  onP  score gates');
  for (const r of rows) console.log('  ' + String(r.b).padStart(5) + String(r.placed).padStart(7) + pc(r.fid).padStart(6) + pc(r.onP).padStart(5) + f2(r.key).padStart(7) + '  ' + (r.pass ? 'pass' : 'VETO ' + r.why));
  console.log('  facets needed (90% of best): mode score first ' + (first ? first.b : '—') + ' · stable ' + (stableIdx >= 0 ? rows[stableIdx].b : '—') + '   |   by fidelity first ' + (firstFid ? firstFid.b : '—') + ' · stable ' + (stableFid >= 0 ? rows[stableFid].b : '—'));
  out[scene + '__' + prio] = { mode, rows, first: first && first.b, stable: stableIdx >= 0 ? rows[stableIdx].b : null, firstFid: firstFid && firstFid.b, stableFid: stableFid >= 0 ? rows[stableFid].b : null };
}
fs.writeFileSync(path.join(dir, 'budgets-summary.json'), JSON.stringify(out, null, 1));
if (a.includes('--montage')) {
  const imgDir = path.join(dir, 'img'); fs.mkdirSync(imgDir, { recursive: true });
  for (const [scene] of Object.entries(MODE_OF)) {
    const labs = [8, 16, 32, 64, 150].map((b) => 'bud__' + scene + '__bal__' + b).filter((l) => fs.existsSync(path.join(dir, 'runs', l + '.json')));
    if (!labs.length) continue; const runs = labs.map((l) => H.loadRun(l, path.join(dir, 'runs')));
    const m = H.montage(runs, { cols: 3, numbers: labs.map((l) => l.split('__').pop()) }); const f = path.join(imgDir, 'budgets__' + scene + '.png'); fs.writeFileSync(f, m.png); console.log(f + '  budgets ' + labs.map((l) => l.split('__').pop()).join(', '));
  }
}
