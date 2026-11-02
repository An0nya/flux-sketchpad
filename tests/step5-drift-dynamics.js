// step5-preview (Anya, 11-01: modelled is the way to go, a stylised step is the cheap first step, both behind a
// toggle): the drift family - driftDynamics (lag + cap), driftAfs (aim the beam along the road) and driftCabin
// (rotate the cockpit overlay with the car yaw). Node test on the registry contract, the control plumbing, and the
// relaxation itself (a pure function, so it is testable without a browser).
const fs = require('fs'), path = require('path');
const { load } = require('./load.js');
load();
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const anim = read('js/drive-anim.js'), reg = read('js/options-registry.js'), shader = read('js/drive-three-shaders.js');
const e = globalThis.RF.Options.byId['driftDynamics'], afs = globalThis.RF.Options.byId['driftAfs'], cabin = globalThis.RF.Options.byId['driftCabin']
const relax = globalThis.RF.DriveAnim && globalThis.RF.DriveAnim.relaxDrift;

ok('driftDynamics is registered and defaults OFF (so OFF is the shipped behaviour)', !!e && e.default === false);
ok('it is a bool with a control, an owner and a named test', !!e && e.type === 'bool' && !!e.control && e.owner && e.owner[0] === 'js/drive-anim.js' && e.tests[0] === 'node:step5-drift-dynamics');
ok('it needs tiles (the drift lives on curved tiles, like driftMode)', !!e && e.requires && e.requires.some((r) => (r && r.rule) === 'tiles'));
ok('the control exists in the drive bar (and is synced, so it cannot go stale)', /'data-anim': 'driftDynamics'/.test(anim) && /q\('\[data-anim="driftDynamics"\]'\)\) b\.setAttribute/.test(anim));
ok('driftAfs is registered and defaults OFF (the 2.6 behaviour is untouched)', !!afs && afs.default === false && afs.type === 'bool' && afs.control === '[data-anim="driftAfs"]' && afs.tests[0] === 'node:step5-drift-dynamics');
ok('driftAfs swivels the lamp by the FULL drift angle, where driftDynamics alone only 2.6/8 of it', /V\.driftA \* \(o\.driftAfs \? 1 : 2\.6 \/ 8\)/.test(anim));
ok('all three drift options measure from the same lagged angle, so the arc, the lamp and the cabin cannot disagree', /const lag = o\.driftDynamics \|\| o\.driftAfs \|\| o\.driftCabin/.test(anim));
ok('driftCabin is registered and defaults OFF, and needs both tiles and the cabin view to do anything', !!cabin && cabin.default === false && cabin.type === 'bool' && cabin.control === '[data-anim="driftCabin"]' && cabin.requires.some((r) => (r && r.rule) === 'tiles') && cabin.requires.some((r) => (r && r.rule) === 'cabinView'));
ok('drawCabin rotates the overlay by the drift angle and restores the frame (a bounded rotation, not a leaked one)', /function drawCabin\(V, on, style, light, kmh, yaw\)/.test(anim) && /if \(yaw\) \{ x\.save\(\); x\.translate\(W2 \/ 2, H2 \/ 2\); x\.rotate\(-yaw\); x\.translate\(-W2 \/ 2, -H2 \/ 2\); \}/.test(anim) && /if \(yaw\) x\.restore\(\);/.test(anim));
ok('the overlay is only rotated when the option is on (a paused or absent drift angle leaves it at 0)', /o\.driftCabin \? \(V\.driftA \|\| 0\) : 0/.test(anim));
ok('the sign convention the compensation rests on: the lamp shader rotates by -yaw while the arc rotates by +A', /d\.xy=vec2\(c\*d\.x\+s\*d\.y,c\*d\.y-s\*d\.x\)/.test(shader) && /q\.p\[0\] \* c - q\.p\[1\] \* sn, q\.p\[0\] \* sn \+ q\.p\[1\] \* c/.test(anim));
ok('the two drift sites were touched: the arc reads the lagged angle, the lamp shares it', /cfg\.driftMode && cfg\.driftDynamics && cfg\.driftA !== undefined \? cfg\.driftA/.test(anim) && /lag && V\.driftA !== undefined \? V\.driftA \* \(o\.driftAfs \? 1 : 2\.6 \/ 8\)/.test(anim));

ok('relaxDrift is exported (a pure function: the lag and the cap are unit-testable)', typeof relax === 'function');
const TAU = 0.3, CAP = 8 * Math.PI / 180;
if (typeof relax === 'function') {
  // the ramp is measured the way the app does it: one frame at a time, at 60 fps. A single call with dt = TAU
  // would be clamped at 0.1 s, so the property that matters is the frame-integrated one.
  const fps = 1 / 60, run = (cur, tgt, frames) => { let a = cur; for (let i = 0; i < frames; i++) a = relax(a, tgt, fps); return a; };
  const FR = Math.round(TAU / fps);                     // frames in one time constant
  ok('dt = 0 changes nothing (a paused frame cannot move the angle)', relax(0.05, 0.2, 0) === 0.05);
  ok('after one time constant of frames it covers 1 - 1/e (the tyre relaxation, not a snap)', Math.abs(run(0, 0.05, FR) - 0.05 * (1 - Math.exp(-1))) < 1e-9);
  ok('and 1 - 1/e^5 after five: it reaches the target but never jumps to it', Math.abs(run(0, 0.05, 5 * FR) - 0.05 * (1 - Math.exp(-5))) < 1e-9 && run(0, 0.05, 5 * FR) < 0.05);
  ok('it decays back off the bend as well as it builds onto it (leaving a corner is symmetric)', Math.abs(run(0.05, 0, FR) - 0.05 * Math.exp(-1)) < 1e-9);
  ok('a negative bend (the other direction) relaxes to the negative target', Math.abs(run(0, -0.05, FR) + 0.05 * (1 - Math.exp(-1))) < 1e-9);
  ok('a cold start (no previous angle) takes the target immediately', relax(undefined, 0.05, fps) === 0.05 && relax(null, -0.05, fps) === -0.05);
  ok('a huge target is clamped at the cap: 8 degrees', run(0, 1.5, 5 * FR) === CAP && run(0, -1.5, 5 * FR) === -CAP);
  ok('one long frame is only one 0.1 s step, whatever the elapsed time (a scrub or a stall cannot fling the angle)', Math.abs(relax(0, 0.05, 5) - 0.05 * (1 - Math.exp(-0.1 / TAU))) < 1e-15);
}
ok('the OFF path is the old expression, unchanged (switch all the options off and the angle is raw again)', /if \(tk && tk\.curvature\) A1 = rotArc\(A1, cfg\.driftMode && cfg\.driftDynamics && cfg\.driftA !== undefined \? cfg\.driftA : -tk\.curvature \* Math\.pow\(\(cfg\.driftKmh \|\| 80\) \/ 130, 2\) \* 8\);/.test(anim));
console.log((fails ? fails + ' of ' + n + ' step5-drift-dynamics checks FAILED' : 'all ' + n + ' step5-drift-dynamics checks passed'));
process.exit(fails ? 1 : 0);
