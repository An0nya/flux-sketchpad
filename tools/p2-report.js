#!/usr/bin/env node
// Phase-2 evaluation table: Auto (quick / search) vs Fill & fix at its defaults vs the best single reference design, per scene.
//   node tools/p2-report.js [--images] [--dir bench-out/p2]
// "best single" = the reference design (ff defaults, ff round fast, ff light, ff sharp, dish-fit, opus-mosaic) that RF.Modes.rank puts first
// for the scene's detected kind.  Every number is read from the run dumps of tools/mode-run.js (1M rays, trace seed 90210).
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), H = require('./heatmap-png.js');
const dir = path.resolve((process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : path.join(__dirname, '..', 'bench-out/p2'))), runs = path.join(dir, 'runs');
const P2 = require('./p2-plans.js'), SCENES = process.argv.includes('--holdout') ? P2.HOLDOUT : P2.SCENES;
const load = (label) => { const f = path.join(runs, label + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const f0 = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : Math.round(100 * x)), f2 = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(2));
const REFS = ['ff-default', 'ff-bal-round-fast', 'ff-light-normal', 'ff-sharp-normal', 'dish-fit', 'opus-mosaic'];
const goalKey = (goal, ev) => (goal === 'cutoff' ? ev.m.sharpness : goal === 'hotspot' ? ev.peak / 1000 : goal === 'text' ? M.textScore(ev.m) : goal === 'photo' ? M.photoScore(ev.m) : goal === 'wash' ? ev.m.score : NaN);
const KEYNAME = { cutoff: 'edge sharpness', hotspot: 'peak kcd', text: 'text score', photo: 'photo score', wash: 'evenness', general: '—' };
const imgDir = path.join(dir, 'img'); if (process.argv.includes('--images')) fs.mkdirSync(imgDir, { recursive: true });
const out = [];
for (const [scene] of SCENES) {
  const q = load('p2__' + scene + '__auto-quick'); if (!q) continue;
  const cls = M.classify(q.paint, q.R, q.row.achievableKernelCells), goal = cls.kind, opt = { tol: 1 };
  const cand = (tag) => { const r = load('p2__' + scene + '__' + tag); if (!r) return null; const ev = M.evaluate(goal, r, opt); return { tag, r, ev, key: goalKey(goal, ev) }; };
  const refs = REFS.map(cand).filter(Boolean), ranked = M.rank(goal, refs.map((c) => Object.assign({}, c))), bestRef = ranked[0];
  const cols = [['auto-quick', cand('auto-quick')], ['auto-search', cand('auto-search')], ['ff-default', cand('ff-default')], ['best single: ' + (bestRef ? bestRef.tag : '—'), bestRef ? refs.find((c) => c.tag === bestRef.tag) : null]];
  out.push({ scene, goal, cls, cols });
  console.log('## ' + scene + '  → detected: ' + goal + ' (' + cls.why + ')');
  console.log('   design'.padEnd(34) + 'fid  onP  ' + KEYNAME[goal].padEnd(15) + 'gates                             solve s  (trace s)');
  for (const [name, c] of cols) { if (!c) continue; const r = c.r.row, g = c.ev.gates;
    console.log('   ' + name.padEnd(31) + String(f0(r.fidelity)).padStart(3) + String(f0(r.onPaint)).padStart(5) + '  ' + (goal === 'hotspot' ? (c.key).toFixed(1) : f2(c.key)).padEnd(15) + (g.pass ? 'pass' : 'VETO ' + g.why.join(', ')).slice(0, 34).padEnd(34) + ((r.solveMs || 0) / 1000).toFixed(1).padStart(6) + '  (' + (((r.traceMs || 0) / 1000).toFixed(1)) + ')'); }
  if (process.argv.includes('--images')) {
    const use = cols.filter(([, c]) => c), m = H.montage(use.map(([, c]) => c.r), { cols: 4, numbers: use.map(([, c]) => Math.round(100 * c.r.row.fidelity)) }), f = path.join(imgDir, 'p2__' + scene + '.png'); fs.writeFileSync(f, m.png);
    console.log('   image: ' + f + '  (paint, then ' + use.map(([n], i) => '#' + (i + 1) + ' ' + n).join(' · ') + ')');
  }
}
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(out.map((o) => ({ scene: o.scene, goal: o.goal, why: o.cls.why, rows: o.cols.filter(([, c]) => c).map(([n, c]) => ({ n, fid: c.r.row.fidelity, onPaint: c.r.row.onPaint, key: c.key, pass: c.ev.gates.pass, solveMs: c.r.row.solveMs })) })), null, 1));
