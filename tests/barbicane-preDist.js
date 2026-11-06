// barbicane (11-05) — preDist option test.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const spec = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'preDist');
ok('registry: exists, type number, group traffic', !!o && o.type === 'number' && o.group === 'traffic');
ok('registry: default 50', o && o.default === 50);
ok('spec-ui: referenced', spec.includes('preDist'));
ok('gate: NODE registers this test', gate.includes("barbicane-preDist"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);