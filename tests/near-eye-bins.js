// NE: near-eye sample placement (look.scatterNearBias) for the table. Pure counts, then the CPU twin's error against an 8x reference.
// Node: node tests/near-eye-bins.js — exits 1 on any failure. The GPU side (uniform counts, page frames) is tests/regress/NE-near-eye.js.
const { load } = require('./load.js');
const jitters = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];
const K = 12;
function run(RF, ok) {
  const D = RF.Drive;
  const counts = (steps, bias) => D.tableBinSteps(steps, bias);
  const offOld = (steps) => Math.max(1, Math.round(steps / K));
  const STEPS = []; for (let s = 16; s <= 96; s++) STEPS.push(s);

  // 1. counts: off is the old count in every bin; the total is K * n for both settings; counts are integers >= 1; NaN free.
  ok('NE off: round(steps/12), at least 1, in every bin (steps 16..96)', STEPS.every((s) => counts(s, 0).every((c) => c === offOld(s))));
  ok('NE on: total preserved, K * n (steps 16..96)', STEPS.every((s) => counts(s, 1).reduce((a, b) => a + b, 0) === K * offOld(s)));
  ok('NE on: counts are non-increasing with bin index (steps 16..96)', STEPS.every((s) => { const c = counts(s, 1); return c.every((v, k) => k === 0 || v <= c[k - 1]); }));
  ok('NE on: counts are integers >= 1 (steps 16..96)', STEPS.every((s) => counts(s, 1).every((c) => Number.isInteger(c) && c >= 1)));
  ok('NE on: near bins never fewer than off, far bins never more (steps 16..96)', STEPS.every((s) => { const on = counts(s, 1), off = counts(s, 0); return on.every((c, k) => k < 4 ? c >= off[k] : (k >= 8 ? c <= off[k] : true)); }));
  ok('NE on: at 16 steps (n = 1) the minimum of one sample makes on identical to off', JSON.stringify(counts(16, 1)) === JSON.stringify(counts(16, 0)));
  const sample = counts(48, 1), sampleOff = counts(48, 0);
  ok('NE on at 48 steps: near 5 each, middle 4, far 3 (the 1.25 : 1 : 0.75 weights)', JSON.stringify(sample) === JSON.stringify([5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3]), JSON.stringify(sample));
  ok('NE off at 48 steps: 4 in every bin', JSON.stringify(sampleOff) === JSON.stringify(new Array(K).fill(4)));
  ok('NE: undefined, null, NaN and zero steps stay finite, at least 1 per bin', [undefined, null, NaN, 0, -5].every((s) => counts(s, 1).every((c) => Number.isFinite(c) && c >= 1) && counts(s, 0).every((c) => Number.isFinite(c) && c >= 1)));
  ok('NE: bias values other than 1 (undefined, 0, "0", NaN) are off', [undefined, 0, '0', NaN].every((b) => JSON.stringify(counts(48, b)) === JSON.stringify(sampleOff)));
  ok('NE: a string "1" is on (saved option values are strings from a select)', JSON.stringify(counts(48, '1')) === JSON.stringify(sample));

  // 2. error: CPU twin against an 8x oversampled reference. Same total cost: steps S, both settings.
  // Geometry: the default road eye (-2, 0.37, 1.2) sees no scatter closer than the lamps (2 m), so bins 0-3 would be empty and the
  // near-bin ratio meaningless. This test puts the eye on the lamp line, 0.5 m behind the lamps, looking down +x: bins 2-5 then carry scatter.
  const base = { eye: [-0.5, 0, 0.65], lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lampRGB: [1, 1, 1] };
  const dir = [1, 0, 0];
  const S = 48;
  const run1 = (look, steps, j) => D.scatterTableBins(Object.assign({}, base, { look }), dir, j, steps);
  // Reference: 8x samples per bin, averaged over the same jitters (bias off; the 8x run is far finer than either arm).
  const errs = (fadeRange) => {
    const look = Object.assign({ visibility: 200, scatter: 48, scatterNearFadeRange: fadeRange }, {});
    const ref = new Float64Array(K);
    for (const j of jitters) { const b = run1(look, 8 * S, j); for (let k = 0; k < K; k++) ref[k] += b[k] / jitters.length; }
    const rms = (bias) => {
      const acc = new Float64Array(K);
      for (const j of jitters) { const b = run1(Object.assign({}, look, { scatterNearBias: bias }), S, j); for (let k = 0; k < K; k++) acc[k] += (b[k] - ref[k]) ** 2 / jitters.length; }
      return Array.from(acc, Math.sqrt);
    };
    return { off: rms(0), on: rms(1), ref: Array.from(ref) };
  };
  for (const fr of ['off', 'medium']) {
    const e = errs(fr);
    const near = (v) => v.slice(0, 4).reduce((a, b) => a + b, 0), far = (v) => v.slice(8).reduce((a, b) => a + b, 0);
    const nearRatio = near(e.on) / near(e.off), farRatio = far(e.on) / far(e.off);
    const detail = 'fade ' + fr + ': near RMS on/off ' + nearRatio.toFixed(3) + ', far RMS on/off ' + farRatio.toFixed(3) +
      ' (off near ' + near(e.off).toExponential(2) + ', on near ' + near(e.on).toExponential(2) + ', off far ' + far(e.off).toExponential(2) + ', on far ' + far(e.on).toExponential(2) + ')';
    ok('NE error (' + fr + ' fade): near bins 0-3 RMS lower with bias on at the same total', nearRatio < 1, detail);
    ok('NE error (' + fr + ' fade): far bins 8-11 RMS not worse than 1.5x with bias on', farRatio <= 1.5, detail);
  }
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all near-eye-bins checks passed'); process.exitCode = fails ? 1 : 0;
}
