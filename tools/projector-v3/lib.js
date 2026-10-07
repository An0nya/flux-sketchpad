// shared harness bits: load the app's engine from the repo (since 10-07 evening nobody else edits it).  While another session was editing js/ this pointed at a frozen
// `git archive` snapshot: set P3_ROOT=/path/to/snapshot to get that back.  Dev modules are loaded straight from tools/projector-v3/dev.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.P3_ROOT || path.join(__dirname, '..', '..');
const { load } = require(path.join(ROOT, 'tests', 'load.js'));
const RF = load();
const DEV = path.join(__dirname, 'dev');
function loadDev(names) { for (const n of names) { const p = path.join(DEV, n + '.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); } return RF; }
module.exports = { RF, ROOT, DEV, loadDev };
