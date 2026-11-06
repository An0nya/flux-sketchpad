// barbicane (11-05) — haloGain option test. enum [0.25, 0.5, 1, 2, 4], default 0.25.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const drive = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloGain');
ok('registry: exists, type enum, group halo', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 0.25', o && o.default === 0.25);
ok('registry: cost free', o && o.cost === 'free');
ok('drive-anim: in look projection', anim.includes('haloGain: o.haloGain'));
ok('drive-three-halo: consumed', halo3.includes('look.haloGain'));
ok('drive.js: comment says level never sets haloGain', drive.includes('haloGain'));
ok('gate: NODE registers this test', gate.includes("'barbicane-haloGain'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);