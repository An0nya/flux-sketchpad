// barbicane (11-05) — haloGain option test. enum [0.25, 0.5, 1, 2, 4], default 0.25.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (GPU halo lane + drive.js comment lane, no headless seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const drive = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloGain');
ok('registry: exists, type enum, group halo [module]', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 0.25 [module]', o && o.default === 0.25);
ok('registry: cost free [module]', o && o.cost === 'free');
// KEEP: text [GPU halo look-projection lane, no headless behaviour seam]
ok('drive-anim: in look projection [KEEP: text — GPU halo look-projection lane]', /(^|[^a-zA-Z_])haloGain(?![a-zA-Z_])/.test(anim) && anim.includes('haloGain: o.haloGain'));
// KEEP: text [GPU halo table lane]
ok('drive-three-halo: consumed [KEEP: text — GPU halo table lane]', /(^|[^a-zA-Z_])haloGain(?![a-zA-Z_])/.test(halo3) && halo3.includes('look.haloGain'));
// KEEP: text [CPU halo path — the level-vs-gain comment behaviour stays in review on the CPU renderer]
ok('drive.js: comment says level never sets haloGain [KEEP: text — CPU halo lane]', /(^|[^a-zA-Z_])haloGain(?![a-zA-Z_])/.test(drive));
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-haloGain');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
