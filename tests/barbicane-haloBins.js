// barbicane (11-05, cyrus assignment) — haloBins option test. enum [4,6,8,12,16,24,32], default 12.
// GPU-side option consumed in drive-three-halo.js; node test covers registry + wiring.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloBins');
ok('registry: exists, type enum, group halo', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 12', o && o.default === 12);
ok('registry: control [data-dv="haloBins"]', o && o.control === '[data-dv="haloBins"]');
ok('drive-anim: in look projection', anim.includes('haloBins: o.haloBins'));
ok('drive-three-halo: consumed', halo3.includes('look.haloBins'));
ok('gate: NODE registers this test', gate.includes("'barbicane-haloBins'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);