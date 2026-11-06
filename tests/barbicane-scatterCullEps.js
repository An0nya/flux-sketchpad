// barbicane (11-05) — scatterCullEps option test. number (min 1e-4, max 100), default 0.001.
// GPU-side culling threshold; node test covers registry + wiring.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const halo3 = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterCullEps');
ok('registry: exists, type number, group halo', !!o && o.type === 'number' && o.group === 'halo');
ok('registry: default 0.001', o && o.default === 0.001);
ok('registry: control [data-anim="scatter-cull-eps"]', o && o.control === '[data-anim="scatter-cull-eps"]');
ok('registry: cost free', o && o.cost === 'free');
ok('registry: requires gpu+air+haloOn+cullFast', o && o.requires && o.requires.length === 4);
ok('drive-anim: in look projection', anim.includes('scatterCullEps: o.scatterCullEps'));
ok('drive-anim: LOD key', anim.includes("'scatterCullEps'"));
ok('drive-three-halo: consumed', halo3.includes('look.scatterCullEps'));
ok('gate: NODE registers this test', gate.includes("'barbicane-scatterCullEps'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);