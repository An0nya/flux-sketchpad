#!/usr/bin/env node
// Trace-seed repeatability of the mode scores: the same designs traced with seeds 90210 / 7 / 11 (1M rays each).
//   node tools/mode-run.js bench-out/modes/plans/seeds.json --seed 7 --out bench-out/modes-seed7   (and 11), then:  node tools/mode-seeds.js
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), A = require('./mode-analyze.js');
const root = path.join(__dirname, '..', 'bench-out'), dirs = [['90210', path.join(root, 'modes/runs')], ['7', path.join(root, 'modes-seed7/runs')], ['11', path.join(root, 'modes-seed11/runs')]];
const MODE_OF = { 'p-halfplane': 'cutoff', 'held-low-beam': 'cutoff', 'p-text': 'text', 'p-hotwash': 'hotspot', 'p-photo': 'photo', 'p-wash': 'uniformity' };
const f3 = (x) => (isFinite(x) ? x.toFixed(3) : '—');
console.log('scene / mode / design                       score by seed (90210, 7, 11)      spread   gates by seed');
let worst = {};
for (const f of fs.readdirSync(dirs[1][1]).sort()) {
  const label = f.replace('.json', ''), scene = label.split('__')[0], mode = MODE_OF[scene], cfg = A.MODES[mode], vals = [], gates = [];
  for (const [, d] of dirs) { const r = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), m = cfg.fn(r); vals.push(cfg.key(m)); gates.push(cfg.gates(m, r).pass ? 'P' : 'v'); }
  const spread = Math.max(...vals) - Math.min(...vals); worst[mode] = Math.max(worst[mode] || 0, spread);
  console.log((scene + ' / ' + mode + ' / ' + label.split('__')[1]).padEnd(46) + vals.map(f3).join('  ').padEnd(30) + f3(spread).padStart(8) + '   ' + gates.join(' '));
}
console.log('\nlargest spread per mode: ' + Object.entries(worst).map(([k, v]) => k + ' ' + f3(v)).join(' · '));
