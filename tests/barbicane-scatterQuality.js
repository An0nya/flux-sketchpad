// barbicane (11-05) — scatterQuality option test. enum ['steps','baseline','low','medium','high','max'], default 'steps'.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const drive3 = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterQuality');
ok('registry: exists, type enum, group air', !!o && o.type === 'enum' && o.group === 'air');
ok('registry: default steps', o && o.default === 'steps');
ok('registry: control none', o && o.control === 'none');
ok('drive-anim: in look projection', anim.includes('scatterQuality: o.scatterQuality'));
ok('drive-three: bin count', drive3.includes('look.scatterQuality'));
ok('gate: NODE registers this test', gate.includes("'barbicane-scatterQuality'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);