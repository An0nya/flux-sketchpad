// barbicane (11-05) — density option test.
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

const o = Opt.OPTIONS.find((x) => x.id === 'density');
ok('registry: exists, type number, group road [module]', !!o && o.type === 'number' && o.group === 'road');
ok('registry: default 1.5 [module]', o && o.default === 1.5);
ok('registry: control \'[data-anim="density"]\' [module]', o && o.control === "[data-anim=\"density\"]");
ok('wiring: source() carries density into src.tiles', (() => {
  const s = A => A.tiles && A.tiles.density;
  const with_d = s(RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7, tiles: true, density: 2.5 }));
  const no_d = s(RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7, tiles: true }));
  return with_d === 2.5 && no_d === undefined;   // src.tiles mirrors raw o.density (registry defaults are applied in setDV)
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-' + 'density');
})());

console.log(fail === 0 ? '\n' + pass + ' checks, 0 failed' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
