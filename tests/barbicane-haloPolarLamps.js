// barbicane (11-05) — haloPolarLamps option test. enum [1, 2], default 2.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloPolarLamps');
ok('registry: exists, type enum, group halo', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 2', o && o.default === 2);
ok('registry: values [1, 2]', o && o.values && o.values.length === 2 && o.values[0] === 1 && o.values[1] === 2);
ok('drive-anim: in look projection', anim.includes('haloPolarLamps: o.haloPolarLamps'));
ok('drive-three-halo: consumed', halo3.includes('look.haloPolarLamps'));
ok('gate: NODE registers this test', gate.includes("'barbicane-haloPolarLamps'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);