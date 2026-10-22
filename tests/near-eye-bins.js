// NE / NE2: near-eye sample placement (look.scatterNearBias) for the table. Pure counts, then the CPU twin in the road view:
// light-weighted error against an 8x reference, and seed-to-seed noise over 20 jitter seeds.
// Node: node tests/near-eye-bins.js — exits 1 on any failure. The GPU side (uniform counts, page frames) is tests/regress/NE-near-eye.js.
const { load } = require('./load.js');
const K = 12, S = 48, BAND = [4, 5, 6, 7, 8];
const jitters = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];
// 20 seeds for the noise measure: a fixed mulberry32 stream, so the numbers repeat.
const seeds = (() => { let a = 7; const out = []; for (let i = 0; i < 20; i++) { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; out.push(((t ^ (t >>> 14)) >>> 0) / 4294967296); } return out; })();
// Road view: the default eye and lamps the other table tests use, five ray directions around the forward road ray.
const ROAD_DIRS = [[1, 0.02, -0.15], [1, 0, -0.05], [1, 0.05, -0.3], [1, -0.02, 0], [1, 0.1, -0.1]].map((r) => { const L = Math.hypot(...r); return r.map((x) => x / L); });
const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

function run(RF, ok, report) {
  const D = RF.Drive;
  const offOld = (steps) => Math.max(1, Math.round(steps / K));
  const STEPS = []; for (let s = 16; s <= 96; s++) STEPS.push(s);

  // 1. counts
  ok('NE off: round(steps/12), at least 1, in every bin (steps 16..96)', STEPS.every((s) => D.tableBinSteps(s, 0).every((c) => c === offOld(s))));
  ok('NE on: total preserved, K * n (steps 16..96)', STEPS.every((s) => D.tableBinSteps(s, 1).reduce((a, b) => a + b, 0) === K * offOld(s)));
  ok('NE on: bins 0, 1, 9-11 are 1 sample each (steps 16..96)', STEPS.every((s) => { const c = D.tableBinSteps(s, 1); return [0, 1, 9, 10, 11].every((k) => c[k] === 1); }));
  ok('NE3 on: bins 2 and 3 get 2 samples where the budget allows (n >= 2, steps 24..96)', STEPS.filter((s) => s >= 24).every((s) => { const c = D.tableBinSteps(s, 1); return c[2] === 2 && c[3] === 2; }));
  ok('NE3 on at 16 steps (n = 1, budget 12): every bin stays 1', JSON.stringify(D.tableBinSteps(16, 1)) === JSON.stringify(new Array(K).fill(1)));
  ok('NE on: bins 4-8 get at least the off count (steps 16..96)', STEPS.every((s) => { const c = D.tableBinSteps(s, 1), n = offOld(s); return BAND.every((k) => c[k] >= n); }));
  ok('NE on: counts are integers >= 1 (steps 16..96)', STEPS.every((s) => D.tableBinSteps(s, 1).every((c) => Number.isInteger(c) && c >= 1)));
  ok('NE on: at 16 steps (n = 1) on is identical to off', JSON.stringify(D.tableBinSteps(16, 1)) === JSON.stringify(D.tableBinSteps(16, 0)));
  const on48 = D.tableBinSteps(48, 1), off48 = D.tableBinSteps(48, 0);
  ok('NE3 on at 48 steps: 1,1,2,2, 8,8,8,8,7, 1,1,1', JSON.stringify(on48) === JSON.stringify([1, 1, 2, 2, 8, 8, 8, 8, 7, 1, 1, 1]), JSON.stringify(on48));
  ok('NE3 on at 64 steps (UI max): 1,1,2,2, 10,11,10,10,10, 1,1,1', JSON.stringify(D.tableBinSteps(64, 1)) === JSON.stringify([1, 1, 2, 2, 10, 11, 10, 10, 10, 1, 1, 1]), JSON.stringify(D.tableBinSteps(64, 1)));

  // NE4 quality presets: totals, precedence (text > preset > steps / near sampling), 'steps' is the old rule, clamp to 64.
  const PRESET = { baseline: 14, low: 21, medium: 41, high: 74, max: 143 };
  for (const [name, total] of Object.entries(PRESET)) ok('NE4 preset ' + name + ': 12 counts summing to ' + total, D.qualityCounts(name) && D.qualityCounts(name).length === K && D.qualityCounts(name).reduce((a, b) => a + b, 0) === total, JSON.stringify(D.qualityCounts(name)));
  ok('NE4 preset high: the owner listed a total of 68 but the counts sum to 74 (reported, not changed)', D.qualityCounts('high').reduce((a, b) => a + b, 0) === 74);
  ok("NE4 quality 'steps' or an unknown name is no preset (null)", D.qualityCounts('steps') === null && D.qualityCounts('nope') === null && D.qualityCounts(undefined) === null);
  ok('NE4 quality returns a copy (changing it does not change the preset)', (() => { const c = D.qualityCounts('low'); c[0] = 99; return D.qualityCounts('low')[0] === 1; })());
  ok("NE4 quality 'steps' gives the old counts: near sampling off = round(steps/12), on = the NE3 rule", JSON.stringify(D.binCountsFor(48, 0, '', 'steps')) === JSON.stringify(off48) && JSON.stringify(D.binCountsFor(48, 1, '', 'steps')) === JSON.stringify(on48));
  ok('NE4 precedence: a preset beats near sampling and global steps', JSON.stringify(D.binCountsFor(16, 1, '', 'medium')) === JSON.stringify(D.qualityCounts('medium')));
  ok('NE4 precedence: valid debug text beats a preset', JSON.stringify(D.binCountsFor(48, 1, '3,3,3,3,3,3,3,3,3,3,3,3', 'max')) === JSON.stringify(new Array(K).fill(3)));
  ok('NE4 precedence: invalid debug text falls to the preset', JSON.stringify(D.binCountsFor(48, 0, '1,2', 'low')) === JSON.stringify(D.qualityCounts('low')));
  ok('NE4 clamp: a typed count above 64 becomes 64', JSON.stringify(D.parseBinCounts('200,1,1,1,1,1,1,1,1,1,1,1')) === JSON.stringify([64, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
  // NE5 air beam levels: bundles, totals from the counts, the derived value (off / level / custom), and the bundle's effect on precedence.
  const LEVEL_TOTAL = { baseline: 14, low: 21, medium: 41, high: 74, max: 143 };
  for (const [name, total] of Object.entries(LEVEL_TOTAL)) {
    const b = D.airLevelBundle(name);
    ok('NE5 bundle ' + name + ': sets scatter 16, table, its quality, and the counts total ' + total, !!b && b.scatter === 16 && b.scatterMode === 'table' && b.scatterQuality === name && D.qualityCounts(name).reduce((a, c) => a + c, 0) === total && b.scatterBinCounts === '' && b.scatterNearBias === 0);
  }
  ok('NE5 bundle: unknown names and off have no bundle (null); a bundle is a copy', D.airLevelBundle('off') === null && D.airLevelBundle('nope') === null && (() => { const b = D.airLevelBundle('low'); b.scatter = 99; return D.airLevelBundle('low').scatter === 16; })());
  const offBase = { scatter: 0, scatterMode: 'direct', scatterQuality: 'steps', scatterRes: 'half', scatterBlur: 'off', scatterCache: 'off', scatterCycle: 0, scatterBinCounts: '', scatterNearBias: 0 };
  const withLevel = (name, extra) => Object.assign({}, offBase, D.airLevelBundle(name), extra || {});
  ok('NE5 derived: scatter 0 is off', D.airLevelOf(offBase) === 'off' && D.airLevelOf(withLevel('medium', { scatter: 0 })) === 'off');
  ok('NE5 derived: options equal to a level bundle read as that level (each level)', ['baseline', 'low', 'medium', 'high', 'max'].every((n) => D.airLevelOf(withLevel(n)) === n));
  ok('NE5 derived: an advanced edit (steps 32, cycle 0, near sampling on, typed slices) reads custom', D.airLevelOf(withLevel('medium', { scatter: 32 })) === 'custom' && D.airLevelOf(withLevel('medium', { scatterCycle: 0 })) === 'custom' && D.airLevelOf(withLevel('medium', { scatterNearBias: 1 })) === 'custom' && D.airLevelOf(withLevel('medium', { scatterBinCounts: '1,1,1,1,1,1,1,1,1,1,1,1' })) === 'custom');
  ok('NE5 derived: saved strings from a select still match a level (scatter "16", cycle "8")', D.airLevelOf(withLevel('high', { scatter: '16', scatterCycle: '8', scatterNearBias: '0' })) === 'high');
  ok('NE5 derived: old saved settings without a quality read as custom, never as a level', D.airLevelOf({ scatter: 16, scatterMode: 'table', scatterRes: 'half', scatterBlur: 'off', scatterCache: 'on', scatterCycle: 8 }) === 'custom');
  ok('NE5 precedence: a level beats near sampling and the global steps (the derived value is that level)', JSON.stringify(D.binCountsFor(16, 1, '', 'low')) === JSON.stringify(D.qualityCounts('low')) && D.airLevelOf(withLevel('low', { scatterTableSteps: 16 })) === 'low');
  // NE3 slice override (debug): parse, clamp, zero, and the override beats the global steps and near sampling.
  const good = '1,1,2,2,8,9,8,8,8,1,1,1';
  ok('NE3 parse: 12 valid numbers (trimmed) give those counts', JSON.stringify(D.parseBinCounts(' ' + good + ' ')) === JSON.stringify([1, 1, 2, 2, 8, 9, 8, 8, 8, 1, 1, 1]));
  ok('NE3 parse: empty or blank is null (normal rule)', D.parseBinCounts('') === null && D.parseBinCounts('   ') === null && D.parseBinCounts(undefined) === null);
  ok('NE3 parse: too few, too many, empty field, letters, non-string are null', ['1,2,3', '1,2,3,4,5,6,7,8,9,10,11,12,13', '1,,1,1,1,1,1,1,1,1,1,1', 'a,1,1,1,1,1,1,1,1,1,1,1', 5, null].every((s) => D.parseBinCounts(s) === null));
  ok('NE4 parse: each value clamped to 0..64 (99 -> 64, 65 -> 64, -3 -> 0, 2.7 -> 2, 32 kept)', JSON.stringify(D.parseBinCounts('99,-3,2.7,32,0,1,1,1,1,1,1,65')) === JSON.stringify([64, 0, 2, 32, 0, 1, 1, 1, 1, 1, 1, 64]));
  ok('NE3 parse: zero skips a slice (count 0 is kept, not replaced)', JSON.stringify(D.parseBinCounts('0,0,0,0,0,0,0,0,0,0,0,0')) === JSON.stringify(new Array(K).fill(0)));
  ok('NE3 override beats the global steps and near sampling (bias on, steps 48 ignored)', JSON.stringify(D.binCountsFor(48, 1, '3,3,3,3,3,3,3,3,3,3,3,3')) === JSON.stringify(new Array(K).fill(3)));
  ok('NE3 override beats the global steps with bias off too', JSON.stringify(D.binCountsFor(16, 0, '5,5,5,5,5,5,5,5,5,5,5,5')) === JSON.stringify(new Array(K).fill(5)));
  ok('NE3 empty or invalid override: the normal rule (on: 48 steps default, off: round(steps/12))', JSON.stringify(D.binCountsFor(48, 1, '')) === JSON.stringify(on48) && JSON.stringify(D.binCountsFor(48, 0, 'x,y')) === JSON.stringify(off48));
  ok('NE off at 48 steps: 4 in every bin', JSON.stringify(off48) === JSON.stringify(new Array(K).fill(4)));
  ok('NE: undefined, null, NaN and zero steps stay finite, at least 1 per bin', [undefined, null, NaN, 0, -5].every((s) => D.tableBinSteps(s, 1).every((c) => Number.isFinite(c) && c >= 1) && D.tableBinSteps(s, 0).every((c) => Number.isFinite(c) && c >= 1)));
  ok('NE: bias values other than 1 (undefined, 0, "0", NaN) are off', [undefined, 0, '0', NaN].every((b) => JSON.stringify(D.tableBinSteps(48, b)) === JSON.stringify(off48)));
  ok('NE: a string "1" is on (saved option values are strings from a select)', JSON.stringify(D.tableBinSteps(48, '1')) === JSON.stringify(on48));

  // 2. light-weighted error, road view, same total (48 steps) for both arms; reference = 8x samples, averaged over the same jitters.
  const base = { eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lampRGB: [1, 1, 1] };
  const bins = (look, dir, steps, j) => D.scatterTableBins(Object.assign({}, base, { look }), dir, j, steps);
  // NE3: a slice set to 0 skips its samples (table value 0) and leaves the neighbours alone. Bin 4 carries scatter on this ray.
  { const ray = ROAD_DIRS[0], all4 = bins({ visibility: 200, scatter: 48, scatterNearFadeRange: 'medium', scatterBinCounts: '4,4,4,4,4,4,4,4,4,4,4,4' }, ray, S, 0.5), zero4 = bins({ visibility: 200, scatter: 48, scatterNearFadeRange: 'medium', scatterBinCounts: '4,4,4,4,0,4,4,4,4,4,4,4' }, ray, S, 0.5);
    ok('NE3 override 0 skips a slice: bin 4 value is 0 where it carries scatter, bin 5 unchanged', all4[4] > 0 && zero4[4] === 0 && zero4[5] === all4[5], 'bin 4 ' + all4[4].toExponential(2) + ' -> ' + zero4[4]); }
  for (const fr of ['off', 'medium']) {
    const look = { visibility: 200, scatter: 48, scatterNearFadeRange: fr };
    const ref = ROAD_DIRS.map((dir) => { const r = new Float64Array(K); for (const j of jitters) { const b = bins(look, dir, 8 * S, j); for (let k = 0; k < K; k++) r[k] += b[k] / jitters.length; } return r; });
    const light = new Float64Array(K); let tot = 0;
    for (const r of ref) for (let k = 0; k < K; k++) { light[k] += r[k]; tot += r[k]; }
    const share = Array.from(light, (x) => (tot > 0 ? x / tot : 0));
    const wRms = (bias) => {
      const mse = new Float64Array(K);
      ROAD_DIRS.forEach((dir, d) => { for (const j of jitters) { const b = bins(Object.assign({}, look, { scatterNearBias: bias }), dir, S, j); for (let k = 0; k < K; k++) mse[k] += (b[k] - ref[d][k]) ** 2 / (jitters.length * ROAD_DIRS.length); } });
      return Math.sqrt(Array.from(mse).reduce((a, m, k) => a + share[k] * m, 0));
    };
    const off = wRms(0), on = wRms(1);
    if (report) report('light-weighted RMS, road view, fade ' + fr + ': off ' + off.toExponential(3) + ', on ' + on.toExponential(3) + ', on/off ' + (on / off).toFixed(3) +
      '; light share of bins 0-3 ' + share.slice(0, 4).reduce((a, b) => a + b, 0).toFixed(4) + ', bins 4-8 ' + share.slice(4, 9).reduce((a, b) => a + b, 0).toFixed(4) + ', bins 9-11 ' + share.slice(9).reduce((a, b) => a + b, 0).toFixed(4));
    ok('NE light-weighted error (fade ' + fr + '): on <= off at the same total (road view)', on <= off, 'off ' + off.toExponential(3) + ' on ' + on.toExponential(3) + ' ratio ' + (on / off).toFixed(3));
  }

  // 3. noise: std of the table value over 20 jitter seeds, bins 4-8 summed, per road ray (averaged), off vs on at 48 steps.
  for (const fr of ['medium', 'off']) {
    const look = { visibility: 200, scatter: 48, scatterNearFadeRange: fr };
    const noise = (bias) => { let acc = 0; for (const dir of ROAD_DIRS) { const vals = seeds.map((j) => bins(Object.assign({}, look, { scatterNearBias: bias }), dir, S, j)); acc += BAND.reduce((a, k) => a + std(vals.map((v) => v[k])), 0); } return acc / ROAD_DIRS.length; };
    const nOff = noise(0), nOn = noise(1), ratio = nOn / nOff;
    if (report) report('noise (20 seeds, 48 steps, road view, fade ' + fr + '): sum of per-bin std over bins 4-8: off ' + nOff.toExponential(3) + ', on ' + nOn.toExponential(3) + ', on/off ' + ratio.toFixed(3) + ' (1/sqrt(2) = 0.707 if noise scales with sqrt(samples))');
    ok('NE noise (fade ' + fr + '): bins 4-8 seed-to-seed noise lower with bias on at the same total', ratio < 1, 'on/off ' + ratio.toFixed(3));
  }
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; }, (t) => console.log('[INFO] ' + t));
  console.log(fails ? fails + ' FAILED' : 'all near-eye-bins checks passed'); process.exitCode = fails ? 1 : 0;
}
