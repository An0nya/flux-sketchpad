// barbicane (11-05) — corneringLamps option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; gate -> gate --list; 'drive-anim: referenced'
// disposition per the option's lane (behaviour lane where headlessly reachable; KEEP otherwise, with the reason named).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'corneringLamps');
ok('registry: exists, type bool, group own-lamp [module]', !!o && o.type === 'bool' && o.group === 'own-lamp');
ok('registry: default false [module]', o && o.default === false);
ok('registry: control \'[data-anim="cornering-lamps"]\' [module]', o && o.control === "[data-anim=\"cornering-lamps\"]");
// KEEP: text [own-lamp render path — V.high-lane lens logic, no headless behaviour seam]
ok('drive-anim: referenced [KEEP: text — render-own-lamp lane, no headless behaviour seam]', /(^|[^a-zA-Z_])corneringLamps(?![a-zA-Z_])/.test(anim));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-' + 'corneringLamps');
})());

console.log(fail === 0 ? '\n' + pass + ' checks, 0 failed' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
