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
// ---- paint fidelity: synthetic grids with known answers (no tracing: a fake ctx whose grid IS the design)
{
  const fsc = RF.U.deepCopy(sc), R = fsc.target.res, paint = fsc.modeA.paint, n = R * R;
  const fake = (G, rays) => ({ ctx: { gridD: Float64Array.from(G), gridR: new Float64Array(n), N: rays || 1e9, E: { emitted: 1 } }, P: { res: R, power: 1 } });
  const F = (G, rays) => { const f = fake(G, rays); return Ph.fidelity(fsc, f.P, f.ctx); };
  const perfect = paint.map((w) => w * 1e-3), fp = F(perfect);
  ok('fidelity: a perfect copy of the paint passes every cell, no spill', fp.within === 1 && fp.withinRaw === 1 && fp.spill === 0 && Math.abs(fp.ratio.p50 - 1) < 0.25, 'within ' + fp.within + ', p50 ' + fp.ratio.p50.toFixed(3));
  const f3 = F(perfect.map((x) => 3 * x));
  ok('fidelity: brightness scale does not change it (efficiency is a separate number)', f3.within === fp.within && f3.withinRaw === fp.withinRaw);
  const spillG = Float64Array.from(perfect); let far = -1;
  for (let k = 0; k < n && far < 0; k++) { const i = k % R, j = (k / R) | 0; let clear = true; for (let a = -6; a <= 6 && clear; a++) for (let b = -6; b <= 6; b++) { const q = (j + b) * R + i + a; if (i + a >= 0 && j + b >= 0 && i + a < R && j + b < R && paint[q] > 0) { clear = false; break; } } if (clear) far = k; }
  const tot = perfect.reduce((a, b) => a + b, 0); spillG[far] = tot / 3; const fs = F(spillG);
  ok('fidelity: light off the paint is spill, not a fidelity failure', fs.within === 1 && Math.abs(fs.spill - 0.25) < 1e-9 && fs.spillNear === 0, 'spill ' + fs.spill.toFixed(3));
  const hot = Float64Array.from(perfect); let hk = paint.findIndex((w) => w > 0); hot[hk] *= 2; const fh = F(hot);
  ok('fidelity: a ×2 hotspot counts as over (two-sided)', fh.over > 0 && fh.within === 1 - 1 / fp.cells, 'over ' + (fh.over * fp.cells).toFixed(0) + ' cell');
  // blur concession: deliver the BLURRED paint.  With the real kernel the edge dims pass; at kernel 0 they would not.
  const k = Ph.achievableKernel(fsc), Bl = Ph.boxBlur(paint, R, Math.max(k.cells, 1.5)), save = fsc.source.w;
  const big = RF.U.deepCopy(fsc); big.source.w = big.source.h = save * Math.max(1, 1.5 / Math.max(1e-9, k.cells)) * 1.01; const kb = Ph.achievableKernel(big);
  const fb = (() => { const f = fake(Bl.map((x, q) => paint[q] > 0 ? x * 1e-3 : 0)); return Ph.fidelity(big, f.P, f.ctx); })();
  ok('fidelity: an achievable (blurred) edge passes via the blur, fails on raw alone', kb.cells >= 1.5 && fb.within > fb.withinRaw && fb.within > 0.99, 'kernel ' + kb.cells.toFixed(2) + ' cells · within ' + (100 * fb.within).toFixed(1) + '% vs raw-only ' + (100 * fb.withinRaw).toFixed(1) + '%');
  ok('fidelity: a perfect copy keeps the gaps dark too (headline = 100%)', fp.gapsDark === 1 && fp.fidelity === 1 && fp.gapCells > 0, fp.gapCells + ' gap cells, band ' + fp.gapBand);
  // a flood: every painted cell gets its share AND every cell around it is lit as brightly → gaps fail, headline ≤ ½
  const flood = Float64Array.from(perfect); { const mx = Math.max(...perfect); for (let q = 0; q < n; q++) if (!(paint[q] > 0)) flood[q] = mx; }
  const ff = F(flood);
  ok('fidelity: a flood passes the painted cells but fails the gaps (it can no longer rank first)', ff.within === 1 && ff.gapsDark === 0 && ff.fidelity === 0.5, 'painted ' + ff.within + ', gaps dark ' + ff.gapsDark + ', headline ' + ff.fidelity);
  // a faint halo (5% of a typical painted cell) around the paint is 'dark'; light far outside the band is spill only
  const halo = Float64Array.from(perfect); { const typ = perfect.reduce((a, b) => a + b, 0) / fp.cells; for (let q = 0; q < n; q++) if (!(paint[q] > 0)) halo[q] = 0.05 * typ; }
  const fhal = F(halo);
  ok('fidelity: a faint halo (5% of a painted cell) stays dark', fhal.gapsDark === 1 && fhal.fidelity === 1, 'gaps dark ' + fhal.gapsDark);
  ok('fidelity: far spill is spill, not a lit gap', fs.gapsDark === 1 && fs.fidelity === 1, 'gaps dark ' + fs.gapsDark + ', spill ' + fs.spill.toFixed(3));
  const fn = F(perfect, 1e3);
  ok('fidelity: noise ceiling falls when rays are scarce', fp.noiseCeiling > 0.999 && fn.noiseCeiling < 0.9, 'ceiling ' + fp.noiseCeiling.toFixed(3) + ' → ' + fn.noiseCeiling.toFixed(3) + ' at ' + fn.raysPerCell.toFixed(1) + ' rays/cell');
}
process.exit(fails ? 1 : 0);
