// barbicane (11-05) — onDist option test.
// 11-10 nicholl (item-2 conversion): registry text-greps → module reads; gate → gate --list plan resolution;
// 'spec-ui: referenced' kept with measured reason — the option→buildScene call sits inside the 2D-canvas
// renderer and has no headless seam; instead a builder-behaviour check (the dist argument shifts the
// oncoming/preceding car placement by exactly the requested delta) is added on the app side.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const spec = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const D = RF.Drive;

const o = Opt.OPTIONS.find((x) => x.id === 'onDist');
ok('registry: exists, type number, group traffic [module]', !!o && o.type === 'number' && o.group === 'traffic');
ok('registry: default 80 [module]', o && o.default === 80);
ok('builder honours the headlamp-dist argument [behaviour]', (() => {
  const sc = D.buildScene('road', { Lw: 3.5, A: null, us: false, seed: 7 }, { oncoming: { dist: 80, kcd: 30 } });
  const far = D.buildScene('road', { Lw: 3.5, A: null, us: false, seed: 7 }, { oncoming: { dist: 120, kcd: 30 } });
  const lampsOf = (s) => s.objects.filter((ob) => ob.emit && ob.emit[0] > 1e5).map((ob) => Math.round(ob.x));
  const a = lampsOf(sc), b = lampsOf(far);
  return a.length === 2 && b.length === 2 && b[0] - a[0] === 40 && b[1] - a[1] === 40;
})());
ok('spec-ui: referenced [KEEP: text — option→buildScene lane is app-side, no headless seam]', /(^|[^a-zA-Z_])onDist(?![a-zA-Z_])/.test(spec));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-onDist');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
