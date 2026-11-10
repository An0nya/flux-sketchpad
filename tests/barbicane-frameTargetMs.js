// barbicane (11-05) — frameTargetMs option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; 'drive-anim: referenced' -> nearestMinFps/fpsSettings behaviour; gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'frameTargetMs');
ok('registry: exists, type int, group performance [module]', !!o && o.type === 'int' && o.group === 'performance');
ok('registry: default 33 [module]', o && o.default === 33);
ok('registry: control none [module]', o && o.control === 'none');
ok('behaviour: nearestMinFps(50) -> 20 (1000/50=20), fpsSettings(frameTargetMs:50) -> 20 [behaviour]', (() => {
  return A.nearestMinFps(50) === 20 && A.fpsSettings({ frameTargetMs: 50 }).minFps === 20
    && A.fpsSettings({ frameTargetMs: 33 }).minFps === 30;
})());
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-frameTargetMs');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
