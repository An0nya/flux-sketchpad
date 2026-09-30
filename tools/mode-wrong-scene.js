#!/usr/bin/env node
// A design solved for one painting, scored against another painting on the same optics (the "wrong scene" negative control).
// Every metric should fail these.  Only p-* scenes are used (they share the default scene's LED, envelope and target).
//   node tools/mode-wrong-scene.js
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), A = require('./mode-analyze.js');
const runs = path.join(__dirname, '..', 'bench-out/modes/runs'), load = (l) => JSON.parse(fs.readFileSync(path.join(runs, l + '.json'), 'utf8'));
// [mode, scene whose paint is used, scene whose design (its light map) is used, design]
const PAIRS = [['cutoff', 'p-halfplane', 'p-wash', 'ff-sharp-fast'], ['cutoff', 'p-halfplane', 'p-disc', 'ff-sharp-fast'], ['hotspot', 'p-hotwash', 'p-disc', 'ff-light-fast'], ['hotspot', 'p-hotwash', 'p-wash', 'ff-light-fast'],
  ['text', 'p-text', 'p-hello', 'ff-sharp-fast'], ['text', 'p-hello', 'p-text', 'ff-bal-normal'], ['photo', 'p-photo', 'p-gradient', 'ff-bal-normal'], ['photo', 'p-photo', 'p-wash', 'ff-bal-normal'],
  ['uniformity', 'p-wash', 'p-halfplane', 'ff-bal-normal'], ['uniformity', 'p-wash', 'p-disc', 'ff-bal-normal']];
const f2 = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(2));
console.log('mode        paint of      light map of    design            score  (same design on its own scene)  gates');
for (const [mode, paintScene, lightScene, d] of PAIRS) {
  const own = load(paintScene + '__' + d), other = load(lightScene + '__' + d), cfg = A.MODES[mode];
  const wrong = Object.assign({}, own, { D: other.D, row: Object.assign({}, own.row, { onPaint: other.D.reduce((s, x, k) => s + (own.paint[k] > 0 ? x : 0), 0), spill: 1 - other.D.reduce((s, x, k) => s + (own.paint[k] > 0 ? x : 0), 0) / other.D.reduce((s, x) => s + x, 0) }) });
  const a = cfg.fn(own), b = cfg.fn(wrong), g = cfg.gates(b, wrong);
  console.log(mode.padEnd(12) + paintScene.padEnd(14) + lightScene.padEnd(16) + d.padEnd(18) + f2(cfg.key(b)).padStart(5) + '  (' + f2(cfg.key(a)) + ')' + '                      ' + (g.pass ? 'PASS' : 'veto: ' + g.why.join(', ')));
}
