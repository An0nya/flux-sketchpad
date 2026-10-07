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

// 7. arc: frame() inverts at() (both bends, with offsets), and a quarter turn lands where geometry says
{ let worst = 0;
  for (const dir of ['left', 'right']) { const A = R.arc(150, dir);
    for (const s of [0, 10, 60, 120, 200]) for (const off of [-3.3, -1.65, 0, 1.65, 4.95]) {
      const q = A.frame(...A.at(s, off).p); worst = Math.max(worst, Math.abs(q.s - s), Math.abs(q.off - off)); } }
  ok('arc: frame(at(s, off)) = (s, off) on left and right bends', worst < 1e-9, 'worst error ' + worst.toExponential(1) + ' m');
  const q = R.arc(100, 'right').at(100 * Math.PI / 2, 0);
  ok('arc: a quarter turn right of R = 100 is at (100, −100) heading −y', Math.abs(q.p[0] - 100) < 1e-9 && Math.abs(q.p[1] + 100) < 1e-9 && Math.abs(q.t[1] + 1) < 1e-9, JSON.stringify(q.p) + ' heading ' + JSON.stringify(q.t)); }

// 8. regulation defaults: an ECE preset forces R112's 0.75 m lamp and the reference lane (right edge 1.5 m from the lamp)
//    until the user types a value; the right-edge line then passes through the 75R and 50R test points
{ const ece = R.resolve({}, 'ece-r112-b'), us = R.resolve({}, 'fmvss-lb2v'), typed = R.resolve({ mountH: 0.9 }, 'ece-r112-b');
  ok('ECE forces 0.75 m, FMVSS keeps 0.65 m, a typed value wins', ece.mountH === 0.75 && us.mountH === 0.65 && typed.mountH === 0.9, ece.mountH + ' / ' + us.mountH + ' / ' + typed.mountH);
  const lane = R.laneWidth(ece, 'ece-r112-b'), lamp = R.lamps(ece)[1], edgeY = -lane / 2;
  ok('ECE lane = reference (right edge 1.5 m from the right lamp); FMVSS = 3.6 m', Math.abs((lamp[1] - edgeY) - 1.5) < 1e-9 && R.laneWidth(us, 'fmvss-lb2v') === 3.6, 'lane ' + lane + ' m');
  const hv = (x) => RF.FarField.hvOf([x, edgeY - lamp[1], -lamp[2]], 'A');
  const a75 = hv(75), a50 = hv(50);
  ok('R112 reference road: the right edge lands on 75R (1.15 R, 0.57 D) and 50R (1.72 R, 0.86 D)',
    Math.abs(a75[0] - 1.15) < 0.02 && Math.abs(a75[1] + 0.57) < 0.02 && Math.abs(a50[0] - 1.72) < 0.02 && Math.abs(a50[1] + 0.86) < 0.02,
    '75 m → (' + a75[0].toFixed(3) + ' R, ' + (-a75[1]).toFixed(3) + ' D), 50 m → (' + a50[0].toFixed(3) + ' R, ' + (-a50[1]).toFixed(3) + ' D)');
  ok('Drive lane: ECE auto = a real 3.5 m lane, FMVSS 3.6 m, and an explicit R112 reference lane is still honoured',
    R.laneWidth(ece, 'ece-r112-b', true) === 3.5 && R.laneWidth(us, 'fmvss-lb2v', true) === 3.6 && R.laneWidth(Object.assign({}, ece, { lane: 'r112' }), 'ece-r112-b', true) === lane, R.laneWidth(ece, 'ece-r112-b', true) + ' m (the overlay keeps ' + lane + ' m)');
  // negative control: the old default (0.65 m lamp, 3.5 m lane) misses both
  const old = { mountH: 0.65, spacing: 1.4 }, ol = R.lamps(Object.assign(R.resolve(old), {}))[1], oy = -R.LANES.eu / 2, o75 = RF.FarField.hvOf([75, oy - ol[1], -ol[2]], 'A');
  ok('control: the old 0.65 m / 3.5 m road misses 75R by > 0.2°', Math.hypot(o75[0] - 1.15, o75[1] + 0.57) > 0.2, '75 m → (' + o75[0].toFixed(3) + ' R, ' + (-o75[1]).toFixed(3) + ' D)'); }

// 9. a bend: the beam goes straight on. A narrow straight beam lights the straight road ahead but not the lane of a 150 m right bend
{ const I = (h, v) => (Math.abs(h) < 3 && v < 0 && v > -3 ? 40000 : 0), m = R.model({ road: { two: true, mountH: 0.65, spacing: 1.4 }, I });
  const Ms = m.map({ nx: 100, ny: 20, x0: 0, x1: 100, y0: -10, y1: 10, z: 0.25, facing: 'car' });
  const Mb = m.map({ nx: 100, ny: 20, x0: 0, x1: 100, y0: -10, y1: 10, z: 0.25, arc: { R: 150, dir: 'right' } });
  const at = (M, x, y) => M.E[Math.floor((x - M.x0) / (M.x1 - M.x0) * M.nx) * M.ny + Math.floor((y - M.y0) / (M.y1 - M.y0) * M.ny)];
  ok('straight road: lit 40 m ahead on the centre line', at(Ms, 40.2, 0.25) > 5, at(Ms, 40.2, 0.25).toFixed(1) + ' lx');
  ok('map on a bend facing back along the road: nearly the straight value at short range', Math.abs(at(Mb, 20.2, 0.25) / at(Ms, 20.2, 0.25) - 1) < 0.05, 'ratio ' + (at(Mb, 20.2, 0.25) / at(Ms, 20.2, 0.25)).toFixed(3));
  const A = R.arc(150, 'right'), far = A.at(100, 0).p;
  ok('the 150R lane centre at 100 m is ' + far[1].toFixed(1) + ' m off the straight, outside this beam: dark', m.lux([far[0], far[1], 0.25], [A.at(100, 0).t[0], A.at(100, 0).t[1], 0]) === 0, 'E = ' + m.lux([far[0], far[1], 0.25]).toFixed(2) + ' lx'); }
console.log(fails ? fails + ' FAILED' : 'all road checks passed');
process.exitCode = fails ? 1 : 0;   // not process.exit(): it intermittently hung in Node 25.8 platform shutdown
