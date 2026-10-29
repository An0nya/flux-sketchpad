// Loads the app's classic scripts into Node's own global context (the same files the browser
// loads).  runInThisContext rather than a vm sandbox: sandboxed globals (Math, typed arrays) go
// through interceptors and run ~10x slower, which would make every timing meaningless.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['core', 'options-registry', 'geometry', 'source', 'source-presets', 'cct','sealed-beam-source', 'engine', 'state', 'solver', 'solver-env', 'modeA', 'solvers', 'solver-spoke', 'solver-constellation', 'modeB', 'feasibility', 'photometry', 'farfield', 'spec', 'road', 'beam-quality', 'ideal-beam', 'drive', 'drive-models', 'drive-scenes', 'drive-touge', 'scene-details', 'beam-store', 'beam-atlas', 'drive-anim', 'drive-game', 'drive-layout', 'modes', 'exports', 'compare', 'solve-cache', 'profile', 'lenses', 'controller', 'history', 'checks1', 'checks2', 'checks3', 'share-presets'];
function load(extra) {
  if (globalThis.RF) return globalThis.RF;
  for (const f of FILES.concat(['manufacturability'], extra || [])) {
    const p = path.join(ROOT, 'js', f + '.js');
    if (!fs.existsSync(p)) continue;
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  }
  // js/lamp-dist.js is an ES module (index.html loads it with type=module); D.glareSources needs RF.LampDist for every street lamp, so load its text as a classic script here
  if (!globalThis.RF.LampDist) { const p = path.join(ROOT, 'js', 'lamp-dist.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8').replace(/^export /gm, ''), { filename: p }); }
  return globalThis.RF;
}
module.exports = { load, ROOT, FILES };
