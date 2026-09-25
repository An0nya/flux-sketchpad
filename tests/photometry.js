// Photometry (headless): node tests/photometry.js — exits 1 on failure.
// Known answers: Lambertian luminance = Φ/(πA); box silhouette; throw = 2√cd; and the brightness theorem
// as a gate — a facet's measured intensity may not exceed its own ceiling beyond shot noise.
const { load } = require('./load.js'); const RF = load(); const E = RF.Engine, C = RF.Controller, Ph = RF.Photometry;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const st = C.createStore(RF.State.defaultScene()); C.regenerateA(st); const sc = st.scene, src = sc.source;
{ const L = Ph.luminance(src, RF.Source.frame(src).a), want = src.power / (Math.PI * src.w * src.h);
  ok('Lambertian luminance = Φ/(πA), same off-axis', Math.abs(L - want) < 1e-9 * want && Math.abs(Ph.luminance(src, RF.V.norm([1, 0.3, 1])) - want) < 1e-6 * want, L.toFixed(2) + ' cd/mm²'); }
ok('box silhouette along an axis = the face', Ph.boxProj([1, 2, 3], [1, 0, 0]) === 24 && Math.abs(Ph.boxProj([1, 1, 1], RF.V.norm([1, 1, 1])) - 4 * Math.sqrt(3)) < 1e-9);
const P = E.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const N = 1000000, c = E.runSync(P, N);
const f = Ph.fixture(sc, P, c);
ok('fixture: peak ≤ design ceiling ≤ envelope ceiling', f.peakCd <= f.designCeiling * (1 + 3 * f.peakNoise) && f.designCeiling <= f.envelopeCeiling,
  'peak ' + Math.round(f.peakCd) + ' cd (' + (100 * f.ofDesign).toFixed(0) + '% of design ' + Math.round(f.designCeiling) + ', ' + (100 * f.ofEnvelope).toFixed(0) + '% of envelope ' + Math.round(f.envelopeCeiling) + '); throw ' + f.throwM.toFixed(0) + ' m; ' + f.lmOnTarget.toFixed(0) + ' lm on target; reflector ' + f.reflectorArea.toFixed(0) + ' mm², aperture ' + f.apertureProj.toFixed(0) + ' mm²');
ok('throw = 2√cd', Math.abs(f.throwM - 2 * Math.sqrt(f.peakCd)) < 1e-9);
// brightness theorem per facet at 1M rays: p90 of its footprint must not exceed its ceiling (+3σ of the
// peak cell).  COARSE: at ~30 rays/cell it only catches violations above ~1.5×.  Measured 09-25 (pooled
// 4×1M seeds): A33 124% → 109%, A28 102% — facets REACH their ceiling (fully flashed); the excess is the
// brightest-of-N-noisy-cells bias and shrinks with rays.
let worst = null, viol = 0, n = 0;
for (let k = 0; k < P.G.n; k++) {
  const id = P.G.metas[k].id, vals = new Float64Array(P.res * P.res), T = P.T, r = P.res;
  for (let h = 0; h < c.nHits; h++) if (c.hitK[h] === k + 1) { let i = Math.floor((c.hits[3*h] + T.half) / (2*T.half) * r), j = Math.floor((c.hits[3*h+1] + T.half) / (2*T.half) * r); vals[Math.min(j, r-1) * r + Math.min(i, r-1)] += c.hits[3*h+2]; }
  const m = Ph.facet(sc, P, c, id, vals, null); if (!m || !(m.ceilingCd > 0) || m.peakRays < 20) continue;
  n++; const x = m.p90Cd / m.ceilingCd, lim = 1 + 3 / Math.sqrt(m.peakRays);
  if (x > lim) viol++;
  if (!worst || x > worst.x) worst = { id, x, lim };
}
ok('brightness theorem: no facet\'s p90 intensity exceeds its ceiling beyond noise (' + n + ' facets, 1M rays)', viol === 0, 'worst ' + worst.id + ' at ' + (100 * worst.x).toFixed(0) + '% of ceiling (limit ' + (100 * worst.lim).toFixed(0) + '%)');
process.exit(fails ? 1 : 0);
