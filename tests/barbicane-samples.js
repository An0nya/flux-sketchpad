// barbicane (11-05) — samples option test.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'samples');
ok('registry: exists, type enum, group performance', !!o && o.type === 'enum' && o.group === 'performance');
ok('registry: default', o && o.default === '1');
ok('registry: control', o && o.control === '[data-dv="samples"]');
ok('drive-anim: referenced', anim.includes('samples'));
ok('gate: NODE registers this test', gate.includes('barbicane-samples'));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
