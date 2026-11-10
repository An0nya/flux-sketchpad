// barbicane (11-05) — simCeiling option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; 'drive-anim: referenced' -> simCeiling behaviour; gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'simCeiling');
ok('registry: exists, type enum, group performance [module]', !!o && o.type === 'enum' && o.group === 'performance');
ok('registry: default high [module]', o && o.default === 'high');
ok('registry: control [data-anim="resolution"] [module]', o && o.control === '[data-anim="resolution"]');
ok('behaviour: simCeiling(low->640, high->1600, odd->high, undefined->high) [behaviour]', (() => {
  return A.simCeiling({ simCeiling: 'low' }) === 640
    && A.simCeiling({ simCeiling: 'high' }) === 1600
    && A.simCeiling({ simCeiling: 'bogus' }) === 1600
    && A.simCeiling() === 1600
    && A.SIM_CEILINGS.ultra === 2560 && A.SIM_CEILINGS.native === 3840;
})());
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-simCeiling');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
