// SE: table pacing helpers (js/table-pace.js) and the near-eye fade (SE3) on the CPU twin (js/drive.js scatterTableBins).
// Node: node tests/scatter-table-pace.js — exits 1 on any failure. The GPU banded fill and the header strip are checked on the page by
// tests/regress/SE-table-pacing.js.
const { load } = require('./load.js');
const pace = require('../js/table-pace.js');
const jitters = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];
function run(RF, ok) {
  // 1. pacing math pure helpers
  ok('SE pacing: budget 0.1 ms at 5 ms per row still gives one row (progress every frame)', pace.bandRows(0.1, 5, 475) === 1);
  ok('SE pacing: 8 ms budget at 0.5 ms per row gives 16 rows, never more than are left', pace.bandRows(8, 0.5, 475) === 16 && pace.bandRows(8, 0.5, 5) === 5);
  ok('SE pacing: before any measurement the probe band is 8 rows (or fewer if fewer are left)', pace.bandRows(8, 0, 475) === pace.TABLE_PROBE_ROWS && pace.bandRows(8, 0, 3) === 3);
  ok('SE pacing: no rows left gives zero rows', pace.bandRows(8, 0.5, 0) === 0);
  ok('SE pacing: ms per row is smoothed (a 40 ms frame of 20 rows then 10 ms of 20 rows gives 1.25 ms/row)', Math.abs(pace.smoothMsPerRow(pace.smoothMsPerRow(0, 40, 20), 10, 20) - 1.25) < 1e-9);
  ok('SE pacing: a frame with no rows leaves the estimate unchanged', pace.smoothMsPerRow(0.7, 0, 0) === 0.7);
  // 2. strip and badge text
  ok('SE strip: status reads building air-beam cache valid/wanted, and is null when complete', pace.tableStatus(3, 8) === 'building air-beam cache 3/8' && pace.tableStatus(8, 8) === null);
  ok('SE strip: bar fraction counts the version in progress (2 done + half of the third of 8 = 2.5/8)', Math.abs(pace.fillFraction(2, 8, 50, 100) - 2.5 / 8) < 1e-12 && pace.fillFraction(8, 8, 0, 0) === 1);
  ok('SE badge: cache text matches the brief format', pace.tableBadge(true, 3, 8, 140.4) === 'air beam cache 3/8 · 140 ms/table');
  ok('SE badge: cache off and not yet measured', pace.tableBadge(false, 0, 1, NaN) === 'air beam table · measuring');
  ok('SE fade: smoothstep is 0 at S0, 1 at S1, and 0.5 at the midpoint', pace.smoothstep(1, 10, 1) === 0 && pace.smoothstep(1, 10, 10) === 1 && Math.abs(pace.smoothstep(1, 10, 5.5) - 0.5) < 1e-12);
  // 3. SE3 near fade on the CPU twin. Table = integral from 0; the fade removes the near-eye slice on purpose.
  const D = RF.Drive;
  const o = { eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lampRGB: [1, 1, 1], look: { visibility: 200 } };
  const off = Object.assign({}, o, { look: { visibility: 200, scatterNearFade: 'off' } });
  const L = Math.hypot(1, 0, -0.1), dir = [1 / L, 0, -0.1 / L];
  const at = (opts, d, steps) => { let a = 0; for (const j of jitters) a += D.scatterTableAt(D.scatterTableBins(opts, dir, j, steps), d) / jitters.length; return a; };
  // 3a. the fade lowers the table inside 10 m (on purpose): fade on < fade off at 4 m and 8 m
  const lower = at(o, 4, 48) < at(off, 4, 48) && at(o, 8, 48) < at(off, 8, 48);
  ok('SE fade: the table is lower with the fade on at 4 m and 8 m (near-eye slice removed on purpose)', lower, 'on/off at 4 m ' + (at(o, 4, 48) / at(off, 4, 48)).toFixed(3) + ', 8 m ' + (at(o, 8, 48) / at(off, 8, 48)).toFixed(3));
  // 3b. noise: variance of the table value over 8 jitter seeds at 4 m, fade on vs off (spec: at least 5x lower with the fade)
  // ground ray: the point 4 m away on the road, from the eye (z is up); d is the distance along the ray to that point
  const eye = D.eyeFor(), gh = eye[2], gL = Math.hypot(4, gh), gdir = [4 / gL, 0, -gh / gL];
  const variance = (opts) => { const v = jitters.map((j) => D.scatterTableAt(D.scatterTableBins(opts, gdir, j, 48), gL)); const m = v.reduce((a, b) => a + b, 0) / v.length; return v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length; };
  const vOn = variance(o), vOff = variance(off), ratio = vOff / vOn;
  ok('SE fade: jitter variance at 4 m is at least 5x lower with the fade on', ratio >= 5, 'off/on ' + ratio.toFixed(2) + 'x (ground ray at 4 m, along-ray ' + gL.toFixed(2) + ' m; on ' + vOn.toExponential(2) + ', off ' + vOff.toExponential(2) + ')');
  // 3c. beyond 20 m the fade-on table matches fade-off within 2 percent (spec). Measured: the removed 0-10 m slice is a fixed offset in the cumulative value, so this does not hold; see the report.
  const far = at(o, 20, 48) / at(off, 20, 48);
  // info: the same 20 m comparison per bin (the cumulative value at 20 m is the sum of the bins up to it)
  const binsOn = (opts) => { let a = new Float64Array(12); for (const j of jitters) { const b = D.scatterTableBins(opts, dir, j, 48); for (let k = 0; k < 12; k++) a[k] += b[k] / jitters.length; } return a; };
  const bo = binsOn(o), bf = binsOn(off);
  console.log('[info] per-bin fade on/off ratio (bins 0..11, edges 0.5 m..120 m): ' + Array.from(bo, (v, k) => (bf[k] > 0 ? (v / bf[k]).toFixed(2) : 'n/a')).join(' '));
  // Owner-accepted (2026-10-20): the fade removes the near-eye scatter on purpose, so the cumulative value beyond the fade is LOWER by that fixed amount (measured 0.75 at 20 m on the road ray). Pin the band so a change is noticed.
  ok('SE fade: the removed 1-10 m slice lowers the cumulative value at 20 m to between 0.6 and 0.9 of fade-off', far > 0.6 && far < 0.9, 'on/off at 20 m ' + far.toFixed(4));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scatter-table-pace checks passed'); process.exitCode = fails ? 1 : 0;
}
