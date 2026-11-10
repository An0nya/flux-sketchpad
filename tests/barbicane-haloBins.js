// barbicane (11-05, cyrus assignment) — haloBins option test. enum [4,6,8,12,16,24,32], default 12.
// GPU-side option consumed in drive-three-halo.js.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (GPU halo lane, no headless behaviour seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'haloBins');
ok('registry: exists, type enum, group halo [module]', !!o && o.type === 'enum' && o.group === 'halo');
ok('registry: default 12 [module]', o && o.default === 12);
ok('registry: control [data-dv="haloBins"] [module]', o && o.control === '[data-dv="haloBins"]');
// KEEP: text [GPU halo lane, no headless behaviour seam]
ok('drive-anim: in look projection [KEEP: text — GPU halo look-projection lane]', /(^|[^a-zA-Z_])haloBins(?![a-zA-Z_])/.test(anim) && anim.includes('haloBins: o.haloBins'));
// KEEP: text [GPU halo table lane]
ok('drive-three-halo: consumed [KEEP: text — GPU halo table lane]', /(^|[^a-zA-Z_])haloBins(?![a-zA-Z_])/.test(halo3) && halo3.includes('look.haloBins'));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-haloBins');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
