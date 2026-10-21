// SM: distance-driven cycle phase (js/table-pace.js cyclePhase). Node: node tests/cycle-phase.js, exits 1 on any failure.
const pace = require('../js/table-pace.js');
const V = 8, DT = 1 / 30;
function run(RF, ok) {
  // advance over a window of seconds at a constant speed (m/s), frame by frame at 30 fps
  const advance = (speed, secs) => { let p = 0; const n = Math.round(secs * 30); for (let i = 0; i < n; i++) p = pace.cyclePhase(p, speed * DT, DT, V); return p; };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // 1. standstill: exactly drift * dt per frame
  const one = pace.cyclePhase(0, 0, DT, V);
  ok('SM cycle: standstill advances exactly CYCLE_DRIFT_HZ * dt', near(one, pace.CYCLE_DRIFT_HZ * DT), 'got ' + one);
  // 2. speed: 20 km/h (5.56 m/s) advances less than 50 km/h (13.9 m/s) when both are under the cap, and 50 km/h is capped
  const v20 = 20 / 3.6, v50 = 50 / 3.6, v80 = 80 / 3.6;
  const p20 = pace.cyclePhase(0, v20 * DT, DT, V) - pace.cyclePhase(0, 0, DT, V);
  const p50 = pace.cyclePhase(0, v50 * DT, DT, V) - pace.cyclePhase(0, 0, DT, V);
  ok('SM cycle: 20 km/h advances per frame less than 50 km/h (speed term under the cap)', p20 < p50 && p20 > 0, 'per frame 20 km/h ' + p20.toFixed(4) + ', 50 km/h ' + p50.toFixed(4));
  const capStep = pace.CYCLE_MAX_HZ * DT + pace.CYCLE_DRIFT_HZ * DT;
  ok('SM cycle: 50 and 80 km/h both hit the cap (per-frame advance = CYCLE_MAX_HZ * dt + drift * dt)', near(pace.cyclePhase(0, v50 * DT, DT, V), capStep) && near(pace.cyclePhase(0, v80 * DT, DT, V), capStep), 'cap step ' + capStep.toFixed(4));
  ok('SM cycle: a seek (200 m in one frame) advances no more than the cap', pace.cyclePhase(0, 200, DT, V) <= capStep + 1e-9);
  // 3. wrap: phase stays in [0, V) over a long drive, and the wrap happens (the phase is not monotonic past V)
  let p = 0, wrapped = false, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 30 * 600; i++) { const q = pace.cyclePhase(p, v50 * DT, DT, V); if (q < p) wrapped = true; p = q; lo = Math.min(lo, p); hi = Math.max(hi, p); }
  ok('SM cycle: phase stays in [0, versions) and wraps over 10 minutes at 50 km/h', lo >= 0 && hi < V && wrapped, 'min ' + lo.toFixed(3) + ' max ' + hi.toFixed(3));
  // 4. never NaN on bad input
  const bad = [pace.cyclePhase(NaN, 1, DT, V), pace.cyclePhase(0, NaN, DT, V), pace.cyclePhase(0, -5, DT, V), pace.cyclePhase(0, 1, NaN, V), pace.cyclePhase(0, 1, -1, V), pace.cyclePhase(0, 1, DT, 0), pace.cyclePhase(undefined, undefined, undefined, V)];
  ok('SM cycle: never NaN or out of range on bad input', bad.every((x) => Number.isFinite(x) && x >= 0 && x < V || x === 0), bad.join(' '));
  // 5. deterministic: the same inputs give the same phase
  ok('SM cycle: deterministic (same inputs, same phase)', advance(v50, 3) === advance(v50, 3));
  // 6. speed-driven advance is continuous in distance (no jump at a speed change)
  const raw20 = 2 * (v20 / pace.CYCLE_METRES_PER_VERSION + pace.CYCLE_DRIFT_HZ);
  ok('SM cycle: 2 s at 20 km/h (under the cap) advances (v/M + drift) * 2 versions, mod versions', near(advance(v20, 2), raw20 % V), 'got ' + advance(v20, 2).toFixed(4) + ' expected ' + (raw20 % V).toFixed(4));
  ok('SM cycle: 2 s standstill advances drift * 2 = 3 versions exactly', near(advance(0, 2), 3));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(null, (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all cycle-phase checks passed'); process.exitCode = fails ? 1 : 0;
}
