// barbicane (11-05) — scatterQuality option test. enum ['steps','baseline','low','medium','high','max'], default 'steps'.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (GPU scatter lane; no headless seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const drive3 = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterQuality');
ok('registry: exists, type enum, group air [module]', !!o && o.type === 'enum' && o.group === 'air');
ok('registry: default steps [module]', o && o.default === 'steps');
ok('registry: control none [module]', o && o.control === 'none');
// KEEP: text [GPU scatter look-projection lane, no headless behaviour seam]
ok('drive-anim: in look projection [KEEP: text — GPU scatter look-projection lane]', /(^|[^a-zA-Z_])scatterQuality(?![a-zA-Z_])/.test(anim) && anim.includes('scatterQuality: o.scatterQuality'));
// KEEP: text [GPU scatter config lane]
ok('drive-three: bin count [KEEP: text — GPU scatter config lane]', /(^|[^a-zA-Z_])scatterQuality(?![a-zA-Z_])/.test(drive3) && drive3.includes('look.scatterQuality'));
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-scatterQuality');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
