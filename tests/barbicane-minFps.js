// barbicane (11-05) — minFps option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; 'drive-anim: fps' -> fpsSettings behaviour; gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'minFps');
ok('registry: exists, type enum, group performance [module]', !!o && o.type === 'enum' && o.group === 'performance');
ok('registry: default 30 [module]', o && o.default === 30);
ok('registry: control [data-anim="min-fps"] [module]', o && o.control === '[data-anim="min-fps"]');
ok('behaviour: fpsSettings(minFps: 60) -> 60, frameTargetMs 1000/60 [behaviour]', (() => {
  const f = A.fpsSettings({ minFps: 60 });
  return f.minFps === 60 && f.frameTargetMs === 1000 / 60;
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-minFps');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
