#!/usr/bin/env node
// Phase-2 evaluation plans for tools/mode-run.js.   node tools/p2-plans.js <set> out.json
//   quick   : Auto (quick), Fill & fix at its defaults
//   refs    : fixed reference designs (the trial's contenders) for "best single design"
//   search  : Auto (search) with the goal auto-detected
//   fewest  : Auto, goal Fewest facets, quality 100 / 80 / 50
'use strict';
const fs = require('fs');
const SCENES = [['photo-moon', 400], ['photo-leaf', 400], ['photo-cat', 400], ['photo-flowers', 400], ['anya-beamshot-400'], ['anya-lowbeam-212'], ['held-low-beam'], ['p-hello'], ['hello-die0.4'], ['p-text'], ['p-wash'], ['p-disc'], ['default']];
const REFS = { 'ff-default': { solver: 'fill-fix' }, 'ff-bal-round-fast': { solver: 'fill-fix', settings: { priority: 'balanced', shapes: 'round', quality: 'fast' } }, 'ff-light-normal': { solver: 'fill-fix', settings: { priority: 'light' } },
  'ff-sharp-normal': { solver: 'fill-fix', settings: { priority: 'sharp' } }, 'dish-fit': { solver: 'dish-fit' }, 'opus-mosaic': { solver: 'opus-mosaic' } };
const job = (scene, budget, tag, o) => Object.assign({ label: 'p2__' + scene + '__' + tag, scene, budget }, o);
function plan(set) {
  const out = [];
  for (const [scene, budget] of SCENES) {
    if (set === 'quick') { out.push(job(scene, budget, 'auto-quick', { solver: 'auto', settings: { effort: 'quick' } })); out.push(job(scene, budget, 'ff-default', REFS['ff-default'])); }
    if (set === 'refs') for (const [k, v] of Object.entries(REFS)) if (k !== 'ff-default') out.push(job(scene, budget, k, v));
    if (set === 'search') out.push(job(scene, budget, 'auto-search', { solver: 'auto', settings: { effort: 'search' } }));
  }
  if (set === 'fewest') for (const scene of ['default', 'sparse-ring-24', 'sparse-hot-16']) for (const q of [100, 80, 50]) out.push(job(scene, scene === 'default' ? 400 : 400, 'fewest-q' + q, { solver: 'auto', settings: { goal: 'fewest', quality: q } }));
  return out;
}
if (require.main === module) { const [set, file] = process.argv.slice(2); const p = plan(set); fs.writeFileSync(file, JSON.stringify(p)); console.log(file + ': ' + p.length + ' jobs'); }
module.exports = { plan, SCENES };
