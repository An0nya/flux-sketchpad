#!/usr/bin/env node
// Previews must not change what a solver computes (SOLVER_API.md "Watching a solve"): run each solver a file registers
// twice on the same scene, once counting tools.preview calls and once with the no-op, and compare the surfaces byte for
// byte.  Exits 1 if any output differs or a solve throws.
//   node tools/preview-check.js solvers/lab-fill-fix.js [--spec] [--scene default|test]
// --spec runs on an ECE R112 class B Spec-mode scene (for spec solvers).  The solver runs in this process with
// budget ms = Infinity, so a solver's time governor stays off and the two runs are comparable.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { load } = require('../tests/load.js'); const RF = load(); const S = RF.Solvers;
const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--scene');
const spec = args.includes('--spec'), sceneName = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : 'test';
if (!file) { console.error('usage: node tools/preview-check.js <solver.js> [--spec] [--scene default|test]'); process.exit(2); }
const before = new Set(S.list().map((d) => d.id));
vm.runInThisContext(fs.readFileSync(path.resolve(ROOT, file), 'utf8'), { filename: file });
const ids = S.list().map((d) => d.id).filter((id) => !before.has(id));
if (!ids.length) { console.error('no solver registered by ' + file); process.exit(2); }
function scene() {
  const sc = sceneName === 'default' ? RF.State.defaultScene() : RF.State.testScene();
  if (spec) { sc.mode = 'D'; sc.modeD = sc.modeD || {}; RF.Spec.applyPreset(sc.modeD, 'ece-r112-b'); }
  return sc;
}
async function once(id, withPreview) {
  const sc = scene(); sc.solve = { id };
  let n = 0;
  const tools = { progress() {}, budget: { rays: Infinity, ms: Infinity }, scene: sc,
    trace: (surfaces, o) => S.trace(sc, surfaces, o),
    preview: withPreview ? () => { n++; } : S.NO_PREVIEW };
  const t = Date.now(), out = await S.get(id).solve(S.inputOf(sc), S.settingsOf(sc, id), tools);
  return { json: JSON.stringify(out && out.surfaces), n, ms: Date.now() - t, facets: out && out.surfaces ? out.surfaces.length : 0 };
}
(async () => {
  let bad = 0;
  for (const id of ids) {
    try {
      const a = await once(id, true), b = await once(id, false), same = a.json === b.json;
      if (!same) bad++;
      console.log((same ? '[PASS] ' : '[FAIL] ') + id + ' | previews ' + a.n + ' | surfaces ' + a.facets + ' / ' + b.facets + ' | ms ' + a.ms + ' / ' + b.ms + (same ? '' : ' | OUTPUT DIFFERS with previews on'));
    } catch (e) { bad++; console.log('[FAIL] ' + id + ' | threw: ' + (e && e.message || e)); }
  }
  process.exit(bad ? 1 : 0);
})();
