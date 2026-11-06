// barbicane (11-05) — trafficLogic option test.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'trafficLogic');
ok('registry: exists, type bool, group traffic', !!o && o.type === 'bool' && o.group === 'traffic');
ok('registry: default', o && o.default === false);
ok('registry: control', o && o.control === '[data-anim="traffic-logic"]');
ok('drive-anim: referenced', anim.includes('trafficLogic'));
ok('gate: NODE registers this test', gate.includes('barbicane-trafficLogic'));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
