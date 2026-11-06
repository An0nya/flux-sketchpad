// barbicane (11-05) — frameTargetMs option test.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'frameTargetMs');
ok('registry: exists, type int, group performance', !!o && o.type === 'int' && o.group === 'performance');
ok('registry: default', o && o.default === 33);
ok('registry: control', o && o.control === 'none');
ok('drive-anim: referenced', anim.includes('frameTargetMs'));
ok('gate: NODE registers this test', gate.includes('barbicane-frameTargetMs'));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
