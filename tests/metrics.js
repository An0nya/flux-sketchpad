// Evaluation-metric regression (headless): node tests/metrics.js — exits 1 on failure.
// Controls with known answers for U₀ (5th pct ÷ mean over the task area, one-cell border zone).
const { load } = require('./load.js'); const RF = load(); const E = RF.Engine, C = RF.Controller;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
// flat direct patch: U₀ must sit at its shot-noise ceiling (measures evenness, not edges)
const f = RF.State.defaultScene(); for (const k of Object.keys(f.groups)) f.groups[k].surfaces = [];
f.source.axis = [1, 0, 0]; f.source.dist = 'cone'; f.source.halfAngle = 5; f.sim.res = 100;
{ const s = E.stats(E.runSync(E.prepare(f, []), 200000)); ok('flat patch U₀ ≈ noise ceiling', Math.abs(s.uniformity - s.noiseCeiling) < 0.03, s.uniformity.toFixed(3) + ' vs ' + s.noiseCeiling.toFixed(3)); }
// designed scene: U₀ must not fall as rays grow (the old 1−σ/μ over lit cells did)
const st = C.createStore(RF.State.defaultScene()); C.regenerateA(st); const sc = st.scene, P = E.prepare(sc, RF.State.allSurfaces(sc));
const u = (N) => E.stats(E.runSync(P, N), { paint: sc.modeA.paint, paintRes: sc.target.res }).uniformity;
{ const a = u(50000), b = u(200000); ok('U₀ does not fall with more rays', b >= a - 0.03, a.toFixed(3) + ' → ' + b.toFixed(3)); }
// paint-level scale invariance, and exact multi-level delivery scores 1
{ const c = E.runSync(P, 50000); const a = E.stats(c, { paint: sc.modeA.paint, paintRes: sc.target.res }).uniformity, b = E.stats(c, { paint: sc.modeA.paint.map((x) => x * 2), paintRes: sc.target.res }).uniformity; ok('paint ×2 leaves U₀ unchanged', a === b); }
{ const rp = 20, paint = new Array(rp * rp).fill(0); for (let j = 5; j < 15; j++) for (let i = 5; i < 15; i++) paint[j * rp + i] = i < 10 ? 1 : 0.3;
  const g = new Float64Array(1600); for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) g[j * 40 + i] = paint[(j >> 1) * rp + (i >> 1)] * 5;
  const s = E.evaluate({ P: { res: 40, power: 1000 }, N: 1e6, gridD: g, gridR: new Float64Array(1600) }, paint, rp); ok('exact two-level delivery scores U₀ = 1', Math.abs(s.uniformity - 1) < 1e-12); }
process.exit(fails ? 1 : 0);
