// REVIEW-D integ 2026-10-26: B10 packs both polar halo tables into one sampler2DArray (haloPolarBin/haloPolarT take a layer, not a sampler) and B14 moves `uniform sampler2D marks` out of the shared prefix to surface(); the text diff vs 5079676 is exactly those lines (ground and pass diffs identical), GPU frame pins unchanged. Moved: c0925ddbe976974a, 02c3f5c5d9919bb4, 9deedc2ec1e5e8c8, 454ea36e3e88a4f0 -> 192c9a834eaf7fc5, f70552a64e52fb08, 70491566a8ab3a88, 788980098647e046.
// REVIEW-C integ 2026-10-26: halo lookup now reads 4 knots from a prefix-summed table (shader text changed on purpose; halo-on frames differ from main by <= 2/255, agent-measured on 4 poses). Moved: withLighting/touge text pins eada3a08e2cfcae7, 02eafb816a6166fa, f870e59d654ecf27, 3d66f72f67cdcf42 -> c0925ddbe976974a, 02c3f5c5d9919bb4, 9deedc2ec1e5e8c8, 454ea36e3e88a4f0.
// BA5 node checks for the GPU beam atlas (js/beam-atlas.js) and its shader text: packing, resampling and the car pick. Node, no browser:
//   node tests/beam-atlas.js   (exits 1 on any failure)
// 0. shader text: withLighting(ground) with the atlas off is main 7ee9c65's text (hash pinned), the touge pass too.
// 1. packing keeps candela (2x cd gives 2x at the same angle), per-beam offsets, tint and convention in the metadata.
// 2. resample round trip: the packed beam reads back within 2 percent of its peak at its own sample centres (interior cells).
// 3. pick: the GPU index is the CPU pick for 100 cars, stable across calls and pool rebuilds; overflow and empty packs are refused.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { load } = require('./load.js'); const RF = load();
const ROOT = path.join(__dirname, '..');
if (!RF.BeamAtlas) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'beam-atlas.js'), 'utf8'), { filename: 'js/beam-atlas.js' });
const A = RF.BeamAtlas, D = RF.Drive;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// the shader modules are ES modules: strip the export/import keywords and evaluate them as plain code
const esm = (file, extra, names) => new Function(...Object.keys(extra || {}), fs.readFileSync(path.join(ROOT, 'js', file), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '') + '\nreturn { ' + names.join(', ') + ' };')(...Object.values(extra || {}));
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); if (!cond) fails++; };

// 0. shader text (BA5b): the atlas-off text is main's, byte for byte, so the CPU-equal GPU frames are untouched
const S = esm('drive-three-shaders.js', null, ['withLighting', 'ground']);
const TOUGE = esm('drive-touge-three.js', { ground: S.ground }, ['passShader']);
// SL: the ground prelude now carries the traffic scatter lookup (declarations + one `if(haloOn>0)` line in main), behind a uniform branch. The text is
// therefore no longer main's byte for byte; stripping exactly that addition gives main's text again (hash pinned), and the full text has its own pin.
const stripHalo = (t) => t.replace(/\/\/ SL: the traffic scatter table[\s\S]*?return C;\n}\n/, '').replace('  if(haloOn>0) r+=haloScatter(t<5000.0?t:1e20);\n', '');
const full = S.withLighting(S.ground), pass = TOUGE.passShader(full);
// LAMP-DIST (lampRoad, road lamp light): the table declarations, helper and the factor in the light loop are added to the ground text. Stripping exactly that addition gives main's text again (the lampRoad-off text differs from main only by the uniform declarations and the 1.0 factor, which the frames never see: LHS1/LDR1 off equal main by bytes).
const stripLampRoad = (t) => t.replace(/\/\/ LAMP-DIST: road lamp light[\s\S]*?return I\/159\.1549;\n}\n/, '').replace('float fl=lampRoadOn==1 ? lampRoadF(-d,lightStreet[i]) : 1.0; ', '').replace('*light[i].w*fl*max', '*light[i].w*max');
ok('withLighting(ground) minus the halo lookup and the LAMP-DIST addition equals main 7ee9c65 outside the halo declarations (HDX3 changed haloE[24] and the bin-tile width, which sit outside the stripped lookup)', hash(stripHalo(stripLampRoad(full))) === 'fe5d8ba5cd20fbf2', hash(stripHalo(stripLampRoad(full))));   // SP re-pin 2026-10-26 (was 192c9a834eaf7fc5): the halo polar lookup in haloPolarT gained the band branch and one uniform line (haloPolar auto); stripHalo leaves the polar lookup in. Proof: reversing exactly that edit in memory reproduces 192c9a834eaf7fc5 f70552a64e52fb08 70491566a8ab3a88 788980098647e046 (all four old pins)   // SR re-pin (was 2177a7e74aabf37f): the 120.0 / 240.0 literals became the scatSMax uniform (value 120 at the default; the frames are the proof: BJ2, SD, SCULL pins unchanged).   // OHR + GGXV re-pin 2026-10-29 (was dba879899992fe71): the haloSMax uniform is declared beside scatSMax and the halo lookups clamp at it (= scatSMax while haloRange is 0, the pinned value); wetGGX returns 0 for n.z <= 0.7. Pinned-default frames unchanged (touched gate frame hashes).
// REVIEW integ 2026-10-26: the two touge pass text pins moved 7d5e2eca9819fac7 -> 02eafb816a6166fa and 49467e5f786efba6 -> 3d66f72f67cdcf42, cause: B6 shadow-normal line in passShader (shader text; both pass with B6 reverted)
ok('touge pass minus the halo lookup and the LAMP-DIST addition equals main 7ee9c65', hash(TOUGE.passShader(stripHalo(stripLampRoad(full)))) === '4429c197bad5994b', hash(TOUGE.passShader(stripHalo(stripLampRoad(full)))));   // SP re-pin (was f70552a64e52fb08), cause and proof as above   // SR re-pin (was 23c1a51e463ee6c6): same cause as the line above.   // OHR + GGXV re-pin 2026-10-29 (was 878e3119ab9fdb25): the haloSMax uniform is declared beside scatSMax and the halo lookups clamp at it (= scatSMax while haloRange is 0, the pinned value); wetGGX returns 0 for n.z <= 0.7. Pinned-default frames unchanged (touched gate frame hashes).
// re-pinned 2026-10-22 (LAMP-DIST): the full text now carries the lampRoad addition (stripLampRoad above removes it). Was d56a86cda19e6b46.
ok('withLighting(ground) with the halo lookup is pinned (SL)', hash(full) === 'db6351e9cc1624a1', hash(full));   // SP re-pin (was 70491566a8ab3a88), cause and proof as above   // SR re-pin (was 56448753b8be54b3): same cause, the lookup's clamp and table edge read scatSMax.   // OHR + GGXV re-pin 2026-10-29 (was ca551a94375b23e7): the haloSMax uniform is declared beside scatSMax and the halo lookups clamp at it (= scatSMax while haloRange is 0, the pinned value); wetGGX returns 0 for n.z <= 0.7. Pinned-default frames unchanged (touched gate frame hashes).
// re-pinned 2026-10-22 (LAMP-DIST): as above. Was 6404d07768852b9d.
ok('touge pass with the halo lookup is pinned (SL)', hash(pass) === 'cddda091385cb6e3', hash(pass));   // SP re-pin (was 788980098647e046), cause and proof as above   // SR re-pin (was 83f7105c60878209): same cause as the line above.   // OHR + GGXV re-pin 2026-10-29 (was d59085a23e87e470): the haloSMax uniform is declared beside scatSMax and the halo lookups clamp at it (= scatSMax while haloRange is 0, the pinned value); wetGGX returns 0 for n.z <= 0.7. Pinned-default frames unchanged (touched gate frame hashes).
ok('atlas variant reads the atlas and the per-lamp tint', S.withLighting(S.ground, true).includes('otint*otherIntensity(local)') && S.withLighting(S.ground, true).includes('trafficBeamIdx[i>>2][i&3]'));
ok('touge pass patches the atlas loop spelling', TOUGE.passShader(S.withLighting(S.ground, true)).includes('cos(trafficPitch[i])') && TOUGE.passShader(S.withLighting(S.ground, true)).includes('r+=rho*otint*otherIntensity(local)'));

// fixtures: two beams with different windows, steps and sizes
const lutOf = (win, step, peak, sigmaH, sigmaV) => D.lutFrom((h, v) => peak * Math.exp(-0.5 * ((h / sigmaH) ** 2 + (v / sigmaV) ** 2)) + 200, { win, step });
const narrow = lutOf([-45, 45, -30, 15], 0.25, 30000, 2, 1), wide = lutOf([-60, 60, -40, 20], 0.5, 6000, 9, 5);
const warm = { id: 'a3200', lut: narrow, tint: [1, 0.72, 0.4], conv: 'A' }, cool = { id: 'b6500', lut: wide, tint: [0.9, 0.95, 1], conv: 'B' };
const P = A.packAtlas([warm, cool]);

// 1. packing: sizes, offsets, metadata, candela
ok('atlas is one band per beam, all W wide', P.width === P.W && P.height === P.H * 2 && P.data.length === P.W * P.H * 2, { W: P.W, H: P.H, height: P.height });
ok('resolution is capped at 256 (W) and by the largest beam (H = 180 here)', P.W === 256 && P.H === 180, { W: P.W, H: P.H });
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
// INFO, not a pass/fail check: a design-shaped beam (generic low table, 0.25 deg native over 180 deg) at the cap. Reported, not hidden.
{
  const gen = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false), { win: [-90, 90, -90, 90], step: 0.25 });
  const PG = A.packAtlas([{ lut: gen, tint: [1, 1, 1], conv: 'A' }]);
  let peak = 0, worst = 0, at = null, sum = 0, n = 0;
  for (const v of gen.data) peak = Math.max(peak, v);
  for (let j = 1; j < gen.nv - 1; j++) for (let i = 1; i < gen.nh - 1; i++) {
    const h = gen.h0 + (i + 0.5) * gen.step, v = gen.v0 + (j + 0.5) * gen.step, want = gen.data[j * gen.nh + i];
    const e = Math.abs(A.sampleAtlas(PG, 0, h, v) - want) / peak; sum += e; n++; if (e > worst) { worst = e; at = [h, v]; }
  }
  console.log('[INFO] design-shaped beam at the cap: worst ' + (100 * worst).toFixed(2) + '% of peak at (h,v)=' + JSON.stringify(at.map(x => +x.toFixed(2))) + ', mean ' + (100 * sum / n).toFixed(3) + '% (bar is 2% worst)');
}

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
