// barbicane (11-05) — haloDiv option test. enum [0, 4, 2.8, 2, 1.8, 1.4], default 2.8.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloDiv');
ok('registry: exists, type enum, group halo', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 2.8', o && o.default === 2.8);
ok('registry: control [data-dv="haloDiv"]', o && o.control === '[data-dv="haloDiv"]');
ok('registry: cost table-rebuild', o && o.cost === 'table-rebuild');
ok('drive-anim: in look projection', anim.includes('haloDiv: o.haloDiv'));
ok('drive-three-halo: consumed', halo3.includes('look.haloDiv'));
ok('gate: NODE registers this test', gate.includes("'barbicane-haloDiv'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);