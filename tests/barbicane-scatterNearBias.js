// barbicane (11-05) — scatterNearBias option test. enum [0, 1], default 0.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (GPU scatter lane; no headless seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const drive3 = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterNearBias');
ok('registry: exists, type enum, group air [module]', !!o && o.type === 'enum' && o.group === 'air');
ok('registry: default 0 [module]', o && o.default === 0);
ok('registry: values [0, 1] [module]', o && o.values && o.values.length === 2 && o.values[0] === 0 && o.values[1] === 1);
// KEEP: text [GPU scatter look-projection lane, no headless behaviour seam]
ok('drive-anim: in look projection [KEEP: text — GPU scatter look-projection lane]', /(^|[^a-zA-Z_])scatterNearBias(?![a-zA-Z_])/.test(anim) && anim.includes('scatterNearBias: o.scatterNearBias'));
// KEEP: text [GPU scatter table lane]
ok('drive-three: consumed [KEEP: text — GPU scatter table lane]', /(^|[^a-zA-Z_])scatterNearBias(?![a-zA-Z_])/.test(drive3) && drive3.includes('look.scatterNearBias'));
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-scatterNearBias');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
