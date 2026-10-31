// le-chonk (10-31 ~16:40): the render-level ON vs OFF test step5 named as missing — for the tile options, the CPU
// picture must DIFFER when the option is on, and be byte-identical to the option-absent (shipped-default) render
// when off. Node-only, CPU renderer, small frame.
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, A = RF.DriveAnim;

const W = 96, H = 54, DIST = 9740, T = 0;   // an intersection tile (seed 7, tile 49)
const flags = { people: true, animals: true, signs: true, posts: true, powerlines: true, veg: true, obstacle: false, rpm: true, wild: true };
const lamps = [[0, 0.7, 0.7], [0, -0.7, 0.7]];
const lut = D.lutFrom(() => 30000);
const baseOpts = { seed: 7, tiles: true, trafficDensity: 0, density: 1 };
const render = (extra, dist = DIST) => {
  const src = A.source('road', 3.5, false, flags, Object.assign({}, baseOpts, extra));
  const p = { w: W, h: H, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look: { RL: 0.2, ambient: 0 }, A: null, src };
  const sc = A.tileWorld(p, dist, T);
  const rgba = new Float32Array(4 * W * H);
  D.render({ w: W, h: H, hfov: 60, eye: D.eyeFor(), lamps, lut, conv: 'A', lane: 3.5, arc: sc.A, layer: 'frame', ss: 1, tight: true, rgba,
    scene: { objects: sc.objects, markings: sc.markings, verge: src.verge } });
  return rgba;
};
const diff = (a, b) => { let n = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 1e-6) { n++; worst = Math.max(worst, d); } } return { n, worst }; };

const off = render({});                                  // shipped defaults (option absent)
const endlessOff = render({ endlessRoad: false });      // explicit OFF must equal absent
const endlessOn = render({ endlessRoad: true });
const mlOff = render({ endlessRoad: true, multilaneRoad: false });
const mlOn = render({ endlessRoad: true, multilaneRoad: true });

ok('OFF == option-absent, byte-identical (endlessRoad)', diff(off, endlessOff).n === 0);
ok('ON differs at render level (endlessRoad): pixels changed', diff(off, endlessOn).n > 50, JSON.stringify(diff(off, endlessOn)));
ok('OFF == option-absent, byte-identical (multilaneRoad)', diff(endlessOn, mlOff).n === 0);
ok('ON differs at render level (multilaneRoad)', diff(mlOff, mlOn).n > 50, JSON.stringify(diff(mlOff, mlOn)));
ok('the two ON pictures differ from each other', diff(endlessOn, mlOn).n > 50);
// a mountain-block pose exercises the viaduct-pier line (cfg.endless + steep grade) and the km-post line —
// both used to run before the KP declaration (TDZ ReferenceError); the render must build, not throw
const mtnOff = render({ endlessRoad: false }, 140), mtnOn = render({ endlessRoad: true }, 140);
ok('mountain pose renders without throwing (pier/km-post KP TDZ regression)', diff(mtnOff, mtnOn).n > 0 || diff(mtnOff, mtnOff).n === 0);
console.log(fail === 0 ? `\nall ${pass} le-chonk-render-diff checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
