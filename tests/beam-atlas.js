// BA5 node checks for the GPU beam atlas (js/beam-atlas.js): packing, resampling and the car pick. Node, no browser:
//   node tests/beam-atlas.js   (exits 1 on any failure)
// 1. packing keeps candela (2x cd gives 2x at the same angle), per-beam offsets, tint and convention in the metadata.
// 2. resample round trip: the packed beam reads back within 2 percent of its peak at its own sample centres (interior cells).
// 3. pick: the GPU index is the CPU pick for 100 cars, stable across calls and pool rebuilds; overflow and empty packs are refused.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('./load.js'); const RF = load();
const ROOT = path.join(__dirname, '..');
if (!RF.BeamAtlas) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'beam-atlas.js'), 'utf8'), { filename: 'js/beam-atlas.js' });
const A = RF.BeamAtlas, D = RF.Drive;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); if (!cond) fails++; };

// fixtures: two beams with different windows, steps and sizes
const lutOf = (win, step, peak, sigmaH, sigmaV) => D.lutFrom((h, v) => peak * Math.exp(-0.5 * ((h / sigmaH) ** 2 + (v / sigmaV) ** 2)) + 200, { win, step });
const narrow = lutOf([-45, 45, -30, 15], 0.25, 30000, 2, 1), wide = lutOf([-60, 60, -40, 20], 0.5, 6000, 9, 5);
const warm = { id: 'a3200', lut: narrow, tint: [1, 0.72, 0.4], conv: 'A' }, cool = { id: 'b6500', lut: wide, tint: [0.9, 0.95, 1], conv: 'B' };
const P = A.packAtlas([warm, cool]);

// 1. packing: sizes, offsets, metadata, candela
ok('atlas is one band per beam, all W wide', P.width === P.W && P.height === P.H * 2 && P.data.length === P.W * P.H * 2, { W: P.W, H: P.H, height: P.height });
ok('resolution is capped at 128 by the largest beam', P.W === 128 && P.H === 128, { W: P.W, H: P.H });
ok('beam offsets: row 0 and row H', P.beamMeta[0] === 0 && P.beamMeta[4] === P.H, [P.beamMeta[0], P.beamMeta[4]]);
ok('candelaScale is 1 (no renormalisation)', P.beamMeta[3] === 1 && P.beamMeta[7] === 1);
ok('tint and convention are stored (A=0, B=1)', Math.abs(P.beamTint[1] - 0.72) < 1e-6 && P.beamTint[3] === 0 && P.beamTint[7] === 1, Array.from(P.beamTint));
const doubled = A.packAtlas([{ id: 'x2', lut: { ...narrow, data: narrow.data.map(v => 2 * v) }, tint: [1, 1, 1], conv: 'A' }]);
const single = A.packAtlas([warm]);
let worst2 = 0;
for (let h = -40; h <= 40; h += 0.37) for (let v = -25; v <= 12; v += 0.41) { const a = A.sampleAtlas(single, 0, h, v), b = A.sampleAtlas(doubled, 0, h, v); if (a > 1) worst2 = Math.max(worst2, Math.abs(b / a - 2)); }
ok('2x candela gives 2x at every angle', worst2 < 1e-6, { worst: worst2 });
const zero = A.sampleAtlas(P, 0, 500, 0), inside = A.sampleAtlas(P, 0, 0, 0);
ok('outside the window reads 0; the centre reads the lamp', zero === 0 && inside > 20000, { zero, inside });

// 2. round trip at each beam's own sample centres (interior cells, where the shader's +1 neighbour exists)
const roundTrip = (entry, idx) => {
  const L = entry.lut; let peak = 0, worst = 0;
  for (const v of L.data) peak = Math.max(peak, v);
  for (let j = 1; j < L.nv - 1; j++) for (let i = 1; i < L.nh - 1; i++) {
    const h = L.h0 + (i + 0.5) * L.step, v = L.v0 + (j + 0.5) * L.step, want = L.data[j * L.nh + i];
    worst = Math.max(worst, Math.abs(A.sampleAtlas(P, idx, h, v) - want) / peak);
  }
  return worst;
};
const rt0 = roundTrip(warm, 0), rt1 = roundTrip(cool, 1);
ok('resample round trip within 2% of peak (narrow beam, sigma 1 deg)', rt0 < 0.02, { worst: +rt0.toFixed(5) });
ok('resample round trip within 2% of peak (wide beam, sigma 4 deg)', rt1 < 0.02, { worst: +rt1.toFixed(5) });

// 3. pick equality, stability, refusals
const pool = (entries) => ({ entries, weights: null, key: JSON.stringify(entries.map(e => [e.id, e.tint])) });
const p1 = { trafficPool: pool([warm, cool]), src: { traffic: { onMode: 'symmetric', seed: 19 } } };
const p2 = { trafficPool: pool([warm, cool]), src: { traffic: { onMode: 'symmetric', seed: 19 } } };
let eq = 0, stable = 0; const counts = [0, 0];
for (let c = 0; c < 100; c++) {
  const carId = 'oncoming:' + c, idx = D.trafficPickIndexOf(p1, carId), cpu = D.trafficPickOf(p1, carId);
  if (cpu === p1.trafficPool.entries[idx]) eq++;
  if (D.trafficPickIndexOf(p2, carId) === idx) stable++;
  counts[idx]++;
}
ok('CPU and GPU give the same entry for 100 cars', eq === 100, { eq });
ok('the same seed and car keep the same index across pool rebuilds', stable === 100, { stable });
ok('both beams are used (balanced over 100 cars)', counts[0] > 30 && counts[1] > 30, counts);
const other = { trafficPool: p1.trafficPool, src: { traffic: { onMode: 'generic', seed: 19 } } };
ok('a non-symmetric mode has no pick (built-in beam)', D.trafficPickIndexOf(other, 'oncoming:1') === -1);
let refused = 0;
try { A.packAtlas(Array.from({ length: 17 }, () => warm)); } catch (e) { refused++; }
try { A.packAtlas([]); } catch (e) { refused++; }
ok('packing refuses 17 beams and an empty pool', refused === 2, { refused });
ok('the atlas cap is 16 (matches the uniform arrays)', A.MAX_BEAMS === 16);

console.log(fails ? fails + ' FAILED' : 'all beam atlas checks passed');
process.exitCode = fails ? 1 : 0;
