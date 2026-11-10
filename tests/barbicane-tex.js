// barbicane (11-05) — tex option test.
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

const o = Opt.OPTIONS.find((x) => x.id === 'tex');
ok('registry: exists, type bool, group surface [module]', !!o && o.type === 'bool' && o.group === 'surface');
ok('registry: default true [module]', o && o.default === true);
ok('registry: control \'none\' [module]', o && o.control === "none");
ok('wiring: source() carries tex into src.tiles.grain', (() => {
  const off = RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7, tiles: true, tex: false });
  const on = RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7, tiles: true });
  return off.tiles.grain === false && on.tiles.grain === true;
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-' + 'tex');
})());

console.log(fail === 0 ? '\n' + pass + ' checks, 0 failed' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
