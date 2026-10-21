// SL1: traffic halo (the CPU reference for oncoming lamps in fog). Node, no browser: node tests/traffic-halo.js — exits 1 on any failure.
// Checks the halo against its own model: off adds exactly zero, a lamp aimed at the eye beats one aimed away (5x), dense fog
// peaks and then falls as transmittance takes over, a car's two lamps are symmetric, N selects the nearest lamps, NaN free,
// and the log sampling converges (8 vs 32 steps, within 15 percent of the jitter mean).
const DIR = [1, 0, 0];                       // the eye ray: +x from the eye
const EYE = [0, 0, 1.2];                     // eye 1.2 m high at the origin; a lamp at 0.68 m, 0.52 m below the ray (miss distance 0.52 m)
// A narrow synthetic cone on the lamp axis (sigma 2 degrees, 35000 cd peak): aimed-at and aimed-away are unambiguous.
const coneLut = (RF) => RF.Drive.lutFrom((h, v) => 35000 * Math.exp(-(h * h + v * v) / (2 * 4)));
// one oncoming lamp at x = dist, facing the eye (nx = -1) or away (nx = +1); the beam is passed on the source, as trafficSources does for symmetric traffic
const lamp = (RF, dist, o) => Object.assign({ x: dist, y: 0, z: 0.68, nx: -1, ny: 0, w: 1, beam: { lut: coneLut(RF), conv: 'A' } }, o || {});
const par = (V, extra) => Object.assign({ eye: EYE, trafficBeams: true, look: { visibility: V, trafficHalo: 8 } }, extra || {});
const sum3 = (c) => c[0] + c[1] + c[2];

function run(RF, report) {
  const D = RF.Drive, check = (name, ok, detail) => report(name, !!ok, detail || '');
  const H = (srcs, N, V, o) => D.trafficHalo(DIR, Infinity, srcs, N, par(V, o), 0.5);

  // 1. off adds exactly zero: N = 0, and infinite visibility (sigma 0), and haloN gates both
  const near = [lamp(RF, 80)];
  const off0 = H(near, 0, 60), offInf = H(near, 8, Infinity);
  check('halo off (N = 0) adds exactly zero', sum3(off0) === 0 && off0.every((v) => v === 0), JSON.stringify(off0));
  check('halo with visibility Infinity adds exactly zero', offInf.every((v) => v === 0), JSON.stringify(offInf));
  check('haloN is 0 for trafficHalo absent, Infinity visibility, or trafficBeams off',
    D.haloN(par(60, { look: { visibility: 60 } })) === 0 && D.haloN(par(Infinity)) === 0 && D.haloN(par(60, { trafficBeams: false })) === 0);
  check('haloN returns 4, 8, 16 as set, finite visibility', D.haloN(par(60, { look: { visibility: 60, trafficHalo: 16 } })) === 16 && D.haloN(par(60)) === 8);

  // 2. aimed at the eye beats aimed away, by 5x or more
  const at = sum3(H(near, 8, 60)), away = sum3(H([lamp(RF, 80, { nx: 1 })], 8, 60));
  check('a lamp aimed at the eye is at least 5x one aimed away', at > 0 && away * 5 <= at, 'at ' + at.toExponential(3) + ' away ' + away.toExponential(3) + ' ratio ' + (at / away).toFixed(1));

  // 3. dense fog: a lamp at 30 m, halo across visibility. Denser fog (V = 60) gives more than clear air (V = 1000), then the curve falls at high density.
  const Vs = [1000, 300, 60, 20, 5, 1], curve = Vs.map((V) => sum3(H([lamp(RF, 30)], 8, V)));
  const peak = Math.max(...curve), pk = curve.indexOf(peak);
  check('dense fog (V = 60) gives a larger halo than V = 1000 at 30 m', curve[2] > curve[0], curve.map((c) => c.toExponential(2)).join(' '));
  check('halo peaks then falls with density (transmittance at very dense fog)', pk > 0 && pk < Vs.length - 1 && curve[Vs.length - 1] < peak,
    'peak at V = ' + Vs[pk] + ', V = 1 ' + curve[Vs.length - 1].toExponential(2));

  // 4. a car's two lamps are mirror-symmetric about its centre line: each lamp alone gives the same value, and the car is their sum
  const A = lamp(RF, 80, { y: 0.7 }), B = lamp(RF, 80, { y: -0.7 });
  const hA = sum3(H([A], 8, 60)), hB = sum3(H([B], 8, 60)), hAB = sum3(H([A, B], 8, 60));
  check('the two lamps of a car give equal halos', Math.abs(hA - hB) <= 1e-9 * Math.max(hA, 1e-30), hA + ' vs ' + hB);
  check('two lamps of a car add up', Math.abs(hAB - (hA + hB)) <= 1e-9 * Math.max(hAB, 1e-30), hAB + ' vs ' + (hA + hB));

  // 5. N ranks the lamps by distance to the eye: N = 4 ignores the far lamps, N = 16 includes them
  const nearFour = [30, 32, 34, 36].map((x) => lamp(RF, x, { y: 0.2 })), far = Array.from({ length: 12 }, (_, i) => lamp(RF, 100 + i, { y: 0.1 * i }));
  const all = nearFour.concat(far);
  const n4all = H(all, 4, 60), n4near = H(nearFour, 4, 60), n16 = H(all, 16, 60);
  check('N = 4 with 16 lamps equals N = 4 with only the 4 nearest', n4all.every((v, i) => v === n4near[i]), sum3(n4all) + ' vs ' + sum3(n4near));
  check('N = 16 adds the far lamps on top of N = 4', sum3(n16) > sum3(n4all) * 1.0000001, sum3(n16) + ' vs ' + sum3(n4all));

  // 6. NaN free: a lamp on the eye, a zero-length ray, a lamp with no beam
  const zero = [lamp(RF, 0, { x: EYE[0], y: EYE[1], z: EYE[2] })];
  const outs = [H(zero, 8, 60), D.trafficHalo(DIR, 0, near, 8, par(60), 0.5), D.trafficHalo(DIR, Infinity, [{ x: 80, y: 0, z: 0.68, nx: -1, ny: 0, w: 1 }], 8, par(60), 0.5)];
  check('the halo is finite at a lamp on the eye, at zero length, and with no beam', outs.every((c) => c.every(Number.isFinite)), JSON.stringify(outs));

  // 7. step convergence: equiangular, 8 vs 32 steps, averaged over 8 jitter values (the per-pixel jitter is the noise, not the step count)
  const Js = Array.from({ length: 8 }, (_, i) => (i + 0.5) / 8), mean = (steps) => {
    const prev = D.HALO.steps; D.HALO.steps = steps; const m = Js.reduce((a, j) => a + sum3(D.trafficHalo(DIR, Infinity, [lamp(RF, 80)], 8, par(60), j)), 0) / Js.length; D.HALO.steps = prev; return m;
  };
  const m8 = mean(8), m32 = mean(32), rel = Math.abs(m8 - m32) / m32;
  check('halo converges: 8 vs 32 steps within 15 percent (jitter mean, lamp on the ray-miss line)', rel < 0.15, 'rel ' + (rel * 100).toFixed(1) + ' %');
  check('halo sampling default is 8 steps per lamp', D.HALO.steps === 8);
}

module.exports = { run };
if (require.main === module) {
  let fails = 0;
  run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' failed' : 'all pass');
  process.exit(fails ? 1 : 0);
}
