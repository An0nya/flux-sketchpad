// Loads the app's classic scripts into Node's own global context (the same files the browser
// loads).  runInThisContext rather than a vm sandbox: sandboxed globals (Math, typed arrays) go
// through interceptors and run ~10x slower, which would make every timing meaningless.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['core', 'geometry', 'source', 'engine', 'state', 'solver', 'modeA', 'modeB', 'feasibility', 'profile', 'lenses', 'controller', 'history', 'checks1', 'checks2', 'checks3'];
function load(extra) {
  if (globalThis.RF) return globalThis.RF;
  for (const f of FILES.concat(extra || [])) {
    const p = path.join(ROOT, 'js', f + '.js');
    if (!fs.existsSync(p)) continue;
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  }
  return globalThis.RF;
}
module.exports = { load, ROOT, FILES };
