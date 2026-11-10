// barbicane (11-05) — wild option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; gate -> gate --list; 'drive-anim:
// referenced' -> source-lane behaviour (source() builds the wild-scenery chunk path only with wild on).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'wild');
ok('registry: exists, type bool, group road [module]', !!o && o.type === 'bool' && o.group === 'road');
ok('registry: default true [module]', o && o.default === true);
ok('registry: control none [module]', o && o.control === 'none');
ok('wiring: source() builds the wild-scenery chunk path only with wild on [behaviour]', (() => {
  const on = A.source('road', 3.5, false, {}, { seed: 7, wild: true });
  const off = A.source('road', 3.5, false, {}, { seed: 7, wild: false });
  return typeof on.chunk === 'function' && !('chunk' in off);
})());
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-wild');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
