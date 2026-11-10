// barbicane (11-05) — samples option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; 'drive-anim: referenced' ->
// KEEP (the samples ladder is read at frame time inside the render loop; no headless behaviour seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'samples');
ok('registry: exists, type enum, group performance [module]', !!o && o.type === 'enum' && o.group === 'performance');
ok('registry: default 1 [module]', o && o.default === '1');
ok('registry: control [data-dv="samples"] [module]', o && o.control === '[data-dv="samples"]');
// KEEP: text [frame-time wiring — the samples ladder is read inside the render loop; no headless behaviour seam]
ok('drive-anim: referenced [KEEP: text — V.ss/samples read in the frame path]', anim.includes('samples'));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-samples');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
