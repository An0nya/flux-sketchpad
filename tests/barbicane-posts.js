// barbicane (11-05) — posts option test.
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

const o = Opt.OPTIONS.find((x) => x.id === 'posts');
ok('registry: exists, type bool, group scenery [module]', !!o && o.type === 'bool' && o.group === 'scenery');
ok('registry: default true [module]', o && o.default === true);
ok('registry: control \'[data-anim="c-posts"]\' [module]', o && o.control === "[data-anim=\"c-posts\"]");
ok('wiring: source() carries the flags.posts flag through to src.tiles.flags [behaviour — flags passthrough; the o.posts read itself is prepare()-gated: source args are built inside prepare() (js/drive-anim.js:1719), which crashes at lampTintOf (1716) before srcArgs is set in a headless harness — measured]', (() => {
  const on = RF.DriveAnim.source('road', 3.5, false, { posts: true }, { seed: 7, tiles: true });
  const off = RF.DriveAnim.source('road', 3.5, false, { posts: false }, { seed: 7, tiles: true });
  return on.tiles.flags.posts === true && off.tiles.flags.posts === false;
})());
ok('wiring: the tile world honours the posts consent flag (mountain rails: posts on -> rails, posts off -> none) [behaviour]', (() => {
  // neb 13-15 (item-2): the check above proves the flag is CARRIED into src.tiles.flags; this one proves
  // the tile world CONSUMES it. Without this negative case a default-true read (`cfg.flags.posts !== false`)
  // passes even when the option is gone from the app: the renamed app reads an undefined flag, which is
  // `!== false`, so the rails keep appearing and nothing notices. Measured: renaming `posts` in
  // js/drive-anim.js leaves this suite green without this check and RED with it.
  const FL = { wild: true, signs: true, veg: true, animals: true, posts: true };
  const walk = (flags) => {
    const acc = [];
    for (let k = 0; k < 160; k++) {   // the same deterministic 160-tile window the verge suite uses
      const src = RF.DriveAnim.source('road', 3.5, false, flags, { seed: 7, tiles: true, endlessRoad: true });
      const p = { w: 96, h: 54, hfov: 60, lamps: [], lut: RF.Drive.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src };
      acc.push(...RF.DriveAnim.tileWorld(p, k * 200 + 100, 0).objects);
    }
    return acc;
  };
  const isRail = (o) => o.cls === 'rail';   // the mountain guardrail, gated on cfg.flags.posts !== false
  const on = walk(FL).filter(isRail).length;
  const off = walk(Object.assign({}, FL, { posts: false })).filter(isRail).length;
  return on > 0 && off === 0;
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-' + 'posts');
})());

console.log(fail === 0 ? '\n' + pass + ' checks, 0 failed' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
