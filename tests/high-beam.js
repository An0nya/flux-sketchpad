// HB: high-beam switch, headless. Node tests/high-beam.js — exits 1 on any failure.
// HB_FORCE_HIGH=1 forces the switch on, so the identity check must FAIL (positive control: proves the check can see a change).
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const WIN = [-45, 45, -30, 15], STEP = 0.1;
const low = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false), { win: WIN, step: STEP });
const highOnly = D.lutFrom((h, v) => D.Headlamp.generic(h, v, true), { win: WIN, step: STEP });
const forceOn = process.env.HB_FORCE_HIGH === '1';

// 1. identity: switch off returns the table object itself (what the renderers see before this change)
ok('switch off -> same LUT object', D.withHigh(low, forceOn) === low, { forceOn });
// 2. the switch on gives a different object, cached per low table
const on = D.withHigh(low, true);
ok('switch on -> a different LUT object', on !== low);
ok('switch on is cached per low table', D.withHigh(low, true) === on);
ok('switch on keeps the grid', on.h0 === low.h0 && on.v0 === low.v0 && on.step === low.step && on.nh === low.nh && on.nv === low.nv);
const lowAgain = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false), { win: WIN, step: STEP }); ok('low table itself is not mutated', low.data.every((x, i) => x === lowAgain.data[i]));

// 3. combined = own + generic high, bilinearly. lutAt is linear, so the difference equals the high-only table's lookup at every point.
let maxErr = 0, worst = null;
const pts = []; let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let k = 0; k < 4000; k++) pts.push([-44 + 88 * rnd(), -29 + 43 * rnd()]);
for (const [h, v] of pts) {
  const diff = D.lutAt(on, h, v) - D.lutAt(low, h, v), want = D.lutAt(highOnly, h, v);
  const e = Math.abs(diff - want) / Math.max(1, Math.abs(want)); if (e > maxErr) { maxErr = e; worst = { h, v, diff, want }; }
}
ok('combined LUT = own + high at 4000 random points (rel err < 1e-5)', maxErr < 1e-5, { maxRelErr: maxErr, worst });
// exact at grid nodes: node value = own node + generic high at the node centre
{ let e = 0; for (const [i, j] of [[0, 0], [450, 150], [899, 449], [123, 321]]) { const h = WIN[0] + (i + 0.5) * STEP, v = WIN[2] + (j + 0.5) * STEP, k = j * low.nh + i; e = Math.max(e, Math.abs(on.data[k] - (low.data[k] + D.Headlamp.generic(h, v, true)))); } ok('grid nodes = own + generic high (float rounding)', e < 1e-2, { maxAbs: e }); }

// 4. candela gain at the brief's points (high-on minus low), in candela
const gain = (h, v) => D.lutAt(on, h, v) - D.lutAt(low, h, v);
const P = { centre: [0, 0], plus05: [0.5, 0], dist150: [0, -Math.atan(0.37 / 150) * 180 / Math.PI] };
for (const [name, [h, v]] of Object.entries(P)) ok('high on adds >= 30 kcd at ' + name, gain(h, v) >= 30000, { h: +h.toFixed(3), v: +v.toFixed(3), gain: +gain(h, v).toFixed(1) });
// 5. below the cut-off (2 deg down, 5 deg right): the difference is just the gaussian's value there (the gaussian is even in h, so the side is moot)
{ const want = D.Headlamp.generic(5, -2, true), got = gain(5, -2); ok('below cut-off (2 D, 5 R): gain = gaussian value', Math.abs(got - want) / want < 1e-3, { got: +got.toFixed(2), want: +want.toFixed(2) }); }
// 6. traffic keeps the LOW table: oncoming symmetric cars must not borrow our high beam
{ const tb = D.trafficBeam({ lut: on, lowLut: low, conv: 'A', src: { traffic: { onMode: 'symmetric' } } });
  ok('oncoming (symmetric) beam uses the low table, not the high one', tb.lut === low); }
{ const tb = D.trafficBeam({ lut: on, lowLut: undefined, conv: 'A', src: { traffic: { onMode: 'symmetric' } } });
  ok('no lowLut: oncoming falls back to p.lut (old behaviour)', tb.lut === on); }

// 7. minigame: misuse is flagged only with the switch on, in a city (urban) tile; the switch state is read at resolution
{ let seed = 0, k = 0; outer: for (seed = 1; seed < 400; seed++) for (k = 0; k < 60; k++) if (RF.DriveAnim.roadTile(seed, k).kind === 'urban') break outer;
  const run = (highBeam) => { const g = RF.DriveGame.create({ seed, speed: 50, highBeam }); g.x = k * 200 + 40; g.t = 1; RF.DriveGame.resolve(g, { id: 1, kind: 'deer', reaction: 0.5, hazardX: g.x + 30 }, false, 50, 0); return g.results[0]; };
  const on = run(true), off = run(false);
  ok('minigame: misuse flagged with switch on in an urban tile', on.highMisuse === true && on.highBeam === true, { seed, tile: k, on: { highBeam: on.highBeam, highMisuse: on.highMisuse } });
  ok('minigame: no misuse with switch off, same tile', off.highMisuse === false && off.highBeam === false, { off: { highBeam: off.highBeam, highMisuse: off.highMisuse } }); }

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' high-beam checks passed');
process.exit(fails ? 1 : 0);
