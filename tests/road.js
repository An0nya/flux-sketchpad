// Road model (headless): node tests/road.js — exits 1 on failure.
// Oracles are closed forms: a uniform (isotropic) lamp gives E = I·cosθ / r², so the 5-lux reach solves I·x/r³ = 5.
const { load } = require('./load.js'); const RF = load(); const R = RF.Road;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const uniform = (cd) => () => cd;
const road1 = { two: false, mountH: 0.65, spacing: 1.4 };

// 1. one uniform lamp, a point straight ahead of it at its own height: cos = 1, E = I / r²
{ const m = R.model({ road: road1, I: uniform(1000) }), L = m.lamps[0], E = m.lux([20, L[1], L[2]]);
  ok('inverse square straight ahead', Math.abs(E - 2.5) < 1e-9, 'E = ' + E.toFixed(6) + ' lx (want 2.5)'); }

// 2. reach on the IIHS right edge vs a bisection on the closed form I·x / r³ = 5
{ const I = 50000, m = R.model({ road: road1, I: uniform(I) }), L = m.lamps[0], dy = -R.IIHS.lane / 2 - L[1], dz = R.IIHS.sensorZ - L[2];
  const f = (x) => I * x / Math.pow(x * x + dy * dy + dz * dz, 1.5) - 5; let a = 10, b = 250; for (let k = 0; k < 60; k++) { const c = (a + b) / 2; if (f(c) > 0) a = c; else b = c; }
  const r = m.iihs().right;
  ok('5-lux reach matches the closed form', Math.abs(r - a) <= 0.5 + 1e-9, 'reach ' + r + ' m, closed form ' + a.toFixed(2) + ' m (step 0.5)'); }

// 3. two identical lamps far ahead: ~twice one lamp (their directions converge)
{ const one = R.model({ road: road1, I: uniform(20000) }).lux([200, 0, 0.25]), two = R.model({ road: Object.assign({}, road1, { two: true }), I: uniform(20000) }).lux([200, 0, 0.25]);
  ok('two lamps ≈ 2× one lamp at 200 m', Math.abs(two / one - 2) < 0.01, 'ratio ' + (two / one).toFixed(4)); }

// 4. negative control: a beam dark to the left (H > 0 is RIGHT: H = atan2(right, forward)) must lose the left edge
{ const darkLeft = (h) => (h < 0 ? 0 : 40000), m = R.model({ road: road1, I: darkLeft }), lit = R.model({ road: road1, I: uniform(40000) });
  const a = m.iihs(), b = lit.iihs();
  ok('a beam dark on the left loses the left edge, keeps the right', a.left === 0 && a.right === b.right, 'dark-left: R ' + a.right + ' / L ' + a.left + ' m; uniform: R ' + b.right + ' / L ' + b.left + ' m'); }

// 5. aim shift: the judge's shift as is; a manual −1.0 % puts the judge's cut-off (cutV) at 0.573° D
{ const ev = { shift: [0.2, 0.05], aim: { cutV: -0.52 } };
  const s1 = R.aimShift({ aim: 'spec' }, ev), s2 = R.aimShift({ aim: 'manual', aimPct: -1.0 }, ev);
  ok('aim: spec = the judge’s shift', s1[0] === 0.2 && s1[1] === 0.05, JSON.stringify(s1));
  ok('aim: manual −1 % puts the cut-off at 0.573° D', Math.abs((-0.52 - s2[1]) + R.PCT) < 1e-12, 'cut-off on the road at ' + (-0.52 - s2[1]).toFixed(4) + '° (want −' + R.PCT.toFixed(4) + '°)'); }


// 6. curves: a huge radius reproduces the straight right edge (same line, same facing); a uniform beam from a
//    symmetric lamp pair mirrors (right curve's right edge = left curve's left edge)
{ const m = R.model({ road: { two: true, mountH: 0.65, spacing: 1.4 }, I: uniform(30000) });
  const big = m.curve(1e7, 'right'), straight = m.reach(-R.IIHS.lane / 2, R.IIHS.sensorZ, R.IIHS.near, 120, 0.5);
  ok('curve with R = 10,000 km = the straight edge', big.right === straight, 'curve ' + big.right + ' m, straight ' + straight + ' m');
  const cr = m.curve(150, 'right'), cl = m.curve(150, 'left');
  ok('uniform pair mirrors: right curve R edge = left curve L edge', cr.right === cl.left && cr.left === cl.right, '150R: R ' + cr.right + ' / L ' + cr.left + ' m; 150L: R ' + cl.right + ' / L ' + cl.left + ' m');
  ok('a curve reaches less than the straight edge', cr.d < straight, '150R min ' + cr.d + ' m < straight ' + straight + ' m'); }
console.log(fails ? fails + ' FAILED' : 'all road checks passed');
process.exitCode = fails ? 1 : 0;   // not process.exit(): it intermittently hung in Node 25.8 platform shutdown
