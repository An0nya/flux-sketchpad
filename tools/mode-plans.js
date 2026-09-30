#!/usr/bin/env node
// Which designs the autotune-mode study ran (see AUTOTUNE-MODES.md).  Writes a plan for tools/mode-run.js.
//   node tools/mode-plans.js survey  out.json [scene,scene,...]     ~29 deliberately varied designs per scene
//   node tools/mode-plans.js budgets out.json                        Fill & fix at a ladder of facet budgets (fewest-facets mode)
'use strict';
const fs = require('fs');

// Fill & fix at several settings.  ff-* = the three Priority values × two facet shapes at quality fast, three at normal, then
// one advanced knob at a time on top of balanced / fast.
const FF = {
  'ff-sharp-fast': { priority: 'sharp', quality: 'fast' }, 'ff-bal-fast': { priority: 'balanced', quality: 'fast' }, 'ff-light-fast': { priority: 'light', quality: 'fast' },
  'ff-sharp-round-fast': { priority: 'sharp', quality: 'fast', shapes: 'round' }, 'ff-bal-round-fast': { priority: 'balanced', quality: 'fast', shapes: 'round' }, 'ff-light-round-fast': { priority: 'light', quality: 'fast', shapes: 'round' },
  'ff-sharp-normal': { priority: 'sharp', quality: 'normal' }, 'ff-bal-normal': { priority: 'balanced', quality: 'normal' }, 'ff-light-normal': { priority: 'light', quality: 'normal' },
  'ff-dim5': { quality: 'fast', dim: 0.5 }, 'ff-gap4': { quality: 'fast', gapWeight: 4 }, 'ff-gap0': { quality: 'fast', gapWeight: 0 }, 'ff-feat1': { quality: 'fast', feature: 1 }, 'ff-feat8': { quality: 'fast', feature: 8 },
  'ff-util6': { quality: 'fast', util: 0.6 }, 'ff-util12': { quality: 'fast', util: 1.2 }, 'ff-shell0': { quality: 'fast', sharp: 0 }, 'ff-shell4': { quality: 'fast', sharp: 4 }, 'ff-useall': { quality: 'fast', useAll: 'on' },
};
// the other bundled paint solvers, at their defaults
const OTHERS = { 'dish-fit': 'dish-fit', 'opus-mosaic': 'opus-mosaic', 'bowl-image': 'bowl-image', 'finite-image': 'finite-image', 'patch-array': 'patch-array', 'sqm': 'sqm', 'nemotron-b': 'paint-solver', 'bunny-mosaic': 'paint-mosaic' };
// deliberately bad: a random share of the facets of a good design
const BAD = { 'bad-keep25': { keep: 0.25, keepSeed: 7 }, 'bad-keep60': { keep: 0.6, keepSeed: 11 } };

function survey(scenes) {
  const plan = [];
  for (const sc of scenes) {
    for (const [k, s] of Object.entries(FF)) plan.push({ label: sc + '__' + k, solver: 'fill-fix', scene: sc, settings: s, debug: k === 'ff-bal-fast' || k === 'ff-sharp-fast' || k === 'ff-light-fast' });
    for (const [k, id] of Object.entries(OTHERS)) plan.push({ label: sc + '__' + k, solver: id, scene: sc });
    for (const [k, b] of Object.entries(BAD)) plan.push(Object.assign({ label: sc + '__' + k, solver: 'fill-fix', scene: sc, settings: FF['ff-bal-fast'] }, b));
  }
  return plan;
}
function budgets(scenes, ladder) {
  const plan = [];
  for (const sc of scenes) for (const b of ladder) for (const [k, s] of [['bal', FF['ff-bal-fast']], ['sharp', FF['ff-sharp-fast']]]) plan.push({ label: 'bud__' + sc + '__' + k + '__' + b, solver: 'fill-fix', scene: sc, settings: s, budget: b });
  return plan;
}
const SURVEY_SCENES = ['p-halfplane', 'held-low-beam', 'anya-lowbeam-212', 'anya-lowbeam-1001', 'p-hotwash', 'sparse-hot-16', 'default', 'anya-beamshot-400', 'p-text', 'p-hello', 'held-ring', 'sparse-ring-24', 'p-gradient', 'p-photo', 'p-wash', 'p-disc'];
const BUDGET_SCENES = ['sparse-spot-16', 'sparse-ring-24', 'sparse-bar-16', 'sparse-hot-16', 'p-halfplane', 'p-hello', 'p-wash', 'p-photo'];
const LADDER = [4, 8, 12, 16, 24, 32, 48, 64, 100, 150];
module.exports = { survey, budgets, FF, OTHERS, BAD, SURVEY_SCENES, BUDGET_SCENES, LADDER };

if (require.main === module) {
  const [kind, out, list] = process.argv.slice(2);
  const plan = kind === 'budgets' ? budgets(list ? list.split(',') : BUDGET_SCENES, LADDER) : survey(list ? list.split(',') : SURVEY_SCENES);
  fs.writeFileSync(out, JSON.stringify(plan, null, 1)); console.log(out + ': ' + plan.length + ' jobs');
}
