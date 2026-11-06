// barbicane (11-05) — scatterNearBias option test. enum [0, 1], default 0.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const drive3 = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterNearBias');
ok('registry: exists, type enum, group air', !!o && o.type === 'enum' && o.group === 'air');
ok('registry: default 0', o && o.default === 0);
ok('registry: values [0, 1]', o && o.values && o.values.length === 2 && o.values[0] === 0 && o.values[1] === 1);
ok('drive-anim: in look projection', anim.includes('scatterNearBias: o.scatterNearBias'));
ok('drive-three: consumed', drive3.includes('look.scatterNearBias'));
ok('gate: NODE registers this test', gate.includes("'barbicane-scatterNearBias'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);