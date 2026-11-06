// barbicane (11-05) — lampCone option test. enum ['auto','off','on'], default 'auto'.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'lampCone');
ok('registry: exists, type enum, group street-lamps', !!o && o.type === 'enum' && o.group === 'street-lamps');
ok('registry: default auto', o && o.default === 'auto');
ok('registry: cost per-frame-gpu', o && o.cost === 'per-frame-gpu');
ok('drive-anim: in V.p projection', anim.includes('lampCone: D.lampConeOn'));
ok('drive-anim: in conservative default', anim.includes("lampCone: 'off'"));
ok('gate: NODE registers this test', gate.includes("'barbicane-lampCone'"));
console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);