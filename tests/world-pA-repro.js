// glm5.3flash — repro for the Touge.world() ignores-p.A bug (qwen3.8max flag, glm5.2 relay, le-chonk area).
// Endless tiles + elevatedView: frameSources/tileA hand world() an ELEVATED route (p.A), world() rebuilds a
// FLAT one. Consequence: glareSources and autoSense see flat terrain while the picture shows hills.
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, A = RF.DriveAnim, T = RF.Touge;
const dist = 1000, lane = 3.5;
// the caller-side setup, exactly as drive-anim's tileA() builds it for endless tiles under elevatedView
const p = { w: 100, h: 60, hfov: 60, lane, touge: true, mountainPass: false, eye: [dist, 0, 1.2],
  lut: { data: [0] },   // world()'s trafficLight reads p.lut.data (hasDesign = any nonzero); empty = design-free
  src: { tiles: { seed: 7, endless: true, preset: 'forest', terrain: true, mountain: false, flags: {}, lamps: 'on' } } };
const A2 = A.tileRoute(7, dist, undefined, A.endlessTile);
p.A = T.elevate(A2, dist, lane, true, A.endlessElev(7, 'forest', true));
const hAt = (R, s, off) => R.height(s, off);
const elevNonzero = (() => { for (let s = -100; s <= 400; s += 20) if (Math.abs(hAt(p.A, s, 0)) > 0.01) return true; return false; })();
ok('setup: the caller-supplied p.A is elevated (height nonzero somewhere)', elevNonzero);

const w = T.world(p, dist, 0);
ok('BUG CHECK: world().A is the caller-supplied elevated route (p.A honoured)', w.A === p.A || (w.A.height && Math.abs(hAt(w.A, 40, 0) - hAt(p.A, 40, 0)) < 1e-9),
  { worldHeightAt40: w.A.height ? +hAt(w.A, 40, 0).toFixed(3) : null, pAHeightAt40: +hAt(p.A, 40, 0).toFixed(3) });
ok('BUG CHECK: world().A is NOT the flat rebuild', !(w.A.height && (() => { for (let s = -100; s <= 400; s += 20) if (Math.abs(hAt(w.A, s, 0)) > 1e-9) return false; return true; })()));
// street lamps hang at z = 6.85 + A.height at their position: with the honoured elevated route the lights must
// ride the grade (some lamp sits on a nonzero height), while the flat rebuild would pin them at 6.85.
const lamps = w.lights || [];
const lifted = lamps.filter((l) => Math.abs(l.z - 6.85) > 0.01);
ok('world() lifts street lights onto the honoured grade (flat rebuild pins them at 6.85)', lamps.length > 0 && lifted.length > 0,
  { lights: lamps.length, liftedZ: lifted.slice(0, 3).map((l) => +l.z.toFixed(3)) });
console.log(fail === 0 ? '\nall ' + pass + ' world-pA checks passed' : '\n' + fail + ' of ' + (pass + fail) + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
