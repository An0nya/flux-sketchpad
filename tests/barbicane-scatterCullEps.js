// barbicane (11-05) — scatterCullEps option test. number (min 1e-4, max 100), default 0.001.
// GPU-side culling threshold.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (GPU cull threshold lane; no headless seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterCullEps');
ok('registry: exists, type number, group halo [module]', !!o && o.type === 'number' && o.group === 'halo');
ok('registry: default 0.001 [module]', o && o.default === 0.001);
ok('registry: control [data-anim="scatter-cull-eps"] [module]', o && o.control === '[data-anim="scatter-cull-eps"]');
ok('registry: cost free [module]', o && o.cost === 'free');
ok('registry: requires gpu+air+haloOn+cullFast [module]', o && o.requires && o.requires.length === 4);
// KEEP: text [GPU cull threshold lane, no headless behaviour seam]
ok('drive-anim: in look projection [KEEP: text — GPU cull threshold look-projection lane]', /(^|[^a-zA-Z_])scatterCullEps(?![a-zA-Z_])/.test(anim) && anim.includes('scatterCullEps: o.scatterCullEps'));
// KEEP: text [GPU LOD key lane]
ok('drive-anim: LOD key [KEEP: text — GPU cull LOD lane]', /(^|[^a-zA-Z_])scatterCullEps(?![a-zA-Z_])/.test(anim) && anim.includes("'scatterCullEps'"));
// KEEP: text [GPU halo table lane]
ok('drive-three-halo: consumed [KEEP: text — GPU halo table lane]', /(^|[^a-zA-Z_])scatterCullEps(?![a-zA-Z_])/.test(halo3) && halo3.includes('look.scatterCullEps'));
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-scatterCullEps');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
