// SD1: air-beam scatter table, CPU twin (scatterTableBins / scatterTableAt in js/drive.js). Node: node tests/scatter-table.js — exits 1 on any failure.
// The GPU table pass (js/drive-three.js runTable) is checked on the page by tests/regress/SD-scatter-table.js. Direct mode is pinned by tests/scatter.js.
// Table = integral from 0 to each distance; direct (inScatter) starts at s0 = min(1 m, S/4). This file pins the plain SD table (near fade 'off'):
// it agrees with direct within 10 % from 15 m on, and inside 15 m the table also counts the near-eye slice direct leaves out (reported, not gated).
// SE3 near fade (default 'on' in table mode) is on purpose LOWER than direct inside 10 m; tests/scatter-table-pace.js checks it.
const { load } = require('./load.js');
const jitters = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];
function run(RF, ok) {
  const D = RF.Drive;
  const o = { eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lampRGB: [1, 1, 1], look: { visibility: 200, scatterNearFade: 'off' } };
  const rays = [[1, 0, -0.1], [1, 0.05, -0.2], [1, -0.1, -0.3], [1, 0, -0.05]].map((r) => { const L = Math.hypot(...r); return r.map((x) => x / L); });
  // 1. table lookup vs direct at 64 steps, averaged over the same 8 jitter offsets, at object-like (15 m) and ground-like (8, 30 m) distances
  const worst = [];
  for (const dir of rays) for (const d of [15, 30]) {
    let tab = 0, dir64 = 0;
    for (const j of jitters) { tab += D.scatterTableAt(D.scatterTableBins(o, dir, j, 48), d) / jitters.length; dir64 += D.inScatter(o, dir, d, j, 64)[0] / jitters.length; }
    worst.push({ dir: dir.map((x) => x.toFixed(2)).join(','), d, ratio: tab / dir64 });
  }
  const maxDev = Math.max(...worst.map((w) => Math.abs(w.ratio - 1)));
  ok('SD table twin: lookup within 10 percent of direct (64 steps) at 15 and 30 m on four rays', maxDev < 0.1 && worst.every((w) => Number.isFinite(w.ratio)),
    'max deviation ' + (100 * maxDev).toFixed(1) + ' percent');
  // 2. near-eye (4 m) divergence: reported, not gated. The table includes [0, s0]; direct starts at s0 = min(1, S/4).
  const near = rays.map((dir) => { let tab = 0, dd = 0; for (const j of jitters) { tab += D.scatterTableAt(D.scatterTableBins(o, dir, j, 48), 4) / 8; dd += D.inScatter(o, dir, 4, j, 64)[0] / 8; } return (tab / dd).toFixed(2); });
  console.log('[info] table/direct at 4 m per ray, fade off (table includes the near-eye slice direct omits): ' + near.join(' '));
  const nearOn = rays.map((dir) => { let tab = 0, dd = 0; for (const j of jitters) { tab += D.scatterTableAt(D.scatterTableBins(Object.assign({}, o, { look: { visibility: 200, scatterNearFade: 'on' } }), dir, j, 48), 4) / 8; dd += D.inScatter(o, dir, 4, j, 64)[0] / 8; } return (tab / dd).toFixed(2); });
  console.log('[info] table/direct at 4 m per ray, fade on (SE3, lower on purpose inside 10 m): ' + nearOn.join(' '));
  // 3. finite and monotone: the integrand is non-negative, so the cumulative value cannot fall with distance; zero at 0; clamped beyond S_MAX
  let finite = true, mono = true;
  for (const dir of rays) for (const j of [0.1, 0.9]) {
    const bins = D.scatterTableBins(o, dir, j, 48); if (!bins.every(Number.isFinite)) finite = false;
    let prev = -1; for (let d = 0.01; d < 200; d *= 1.07) { const v = D.scatterTableAt(bins, d); if (!Number.isFinite(v) || v < prev - 1e-12) mono = false; prev = v; }
    const S = D.SCAT.S_MAX;
    if (D.scatterTableAt(bins, 0) !== 0 || D.scatterTableAt(bins, 500) !== D.scatterTableAt(bins, S)) mono = false;
  }
  ok('SD table: bins finite, lookup monotone in d, zero at 0, clamped beyond S_MAX', finite && mono);
  // 4. off: no fog (sigma 0) gives empty bins
  const clear = Object.assign({}, o, { look: {} });
  ok('SD table: no visibility gives zero bins and zero lookup', D.scatterTableBins(clear, rays[0], 0.5, 48).every((v) => v === 0) && D.scatterTableAt(D.scatterTableBins(clear, rays[0], 0.5, 48), 20) === 0);
  // 4b. cycle 8 (eight jitter versions, averaged for display): the eight-version mean at 48 steps converges to the 64-step table mean
  const v8 = (steps) => { let a = 0; for (const j of jitters) a += D.scatterTableAt(D.scatterTableBins(o, rays[0], j, steps), 15) / jitters.length; return a; };
  const r8 = v8(48) / v8(64);
  ok('SD cycle 8: the eight-version mean (48 steps) is within 3 percent of the 64-step table mean at 15 m', Math.abs(r8 - 1) < 0.03, 'ratio ' + r8.toFixed(4));
  // 5. one-jitter spread at 48 steps, reported (the GPU table uses one jitter per pixel)
  const one = jitters.map((j) => D.scatterTableAt(D.scatterTableBins(o, rays[0], j, 48), 15));
  const mean = one.reduce((a, b) => a + b, 0) / one.length;
  console.log('[info] one-jitter table at 15 m, ray 0: min/max over 8 jitters = ' + (100 * Math.min(...one) / mean - 100).toFixed(1) + ' / +' + (100 * Math.max(...one) / mean - 100).toFixed(1) + ' percent of the mean');
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scatter-table checks passed'); process.exitCode = fails ? 1 : 0;
}
