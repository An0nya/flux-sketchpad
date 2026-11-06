// barbicane (11-05) — lampClass option test. enum ['II','III','IV','V'], default 'III'.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'lampClass');
ok('registry: exists, type enum, group street-lamps', !!o && o.type === 'enum' && o.group === 'street-lamps');
ok('registry: default III', o && o.default === 'III');
ok('registry: requires lampDistUsed', o && o.requires && o.requires.length === 1);
ok('drive-anim: in V.p projection', anim.includes('lampClass: o.lampClass'));
ok('drive-anim: in glareOpts', anim.includes('lampClass: o.lampClass'));
ok('gate: NODE registers this test', gate.includes("'barbicane-lampClass'"));
console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);