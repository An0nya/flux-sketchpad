// barbicane (11-05) — smooth option test.
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

const o = Opt.OPTIONS.find((x) => x.id === 'smooth');
ok('registry: exists, type enum, group own-lamp [module]', !!o && o.type === 'enum' && o.group === 'own-lamp');
ok("registry: default 'smooth' [module]", o && o.default === 'smooth');
ok('registry: control \'Spec > Road sidebar row\' [module]', o && o.control === "Spec > Road sidebar row");
// KEEP: text [own-lamp look path; lut smoothing selection, no headless behaviour seam]
ok('drive-anim: referenced [KEEP: text — own-lamp lut lane, no headless behaviour seam]', /(^|[^a-zA-Z_])smooth(?![a-zA-Z_])/.test(anim));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-' + 'smooth');
})());

console.log(fail === 0 ? '\n' + pass + ' checks, 0 failed' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
