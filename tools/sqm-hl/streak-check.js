// Trace single facets of a saved design alone and measure the far-field footprint: centre, principal axes (1σ), orientation vs the facet's azimuth.
const { RF, loadScene } = require('./lib.js'); const V = RF.V;
const sc = loadScene(process.argv[2]); const all = RF.State.allSurfaces(sc).filter((s) => s.type === 'facet'); const S = sc.source.pos;
const pickAz = [0, 45, 90, 135, 180, 225, 270, 315];
const withAz = all.map((f) => { const d = V.sub(f.P, S); return { f, az: (Math.atan2(d[2], -d[1]) * 180 / Math.PI + 360) % 360, r: V.len(d) }; });
const opts = { win: [-30, 30, -20, 20], step: 0.05, conv: 'A', distance: Infinity, centre: S.slice() };
const N = 600000;
function farfield(surfs) { const one = RF.U.deepCopy(sc); one.groups.A.surfaces = surfs; const P = RF.Engine.prepare(one, RF.State.allSurfaces(one)); P.ffStreams = [opts]; const c = RF.Engine.newCtx(P, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true; return RF.FarField.build(c, opts); }
const G0 = farfield([]);   // direct light only: same seed, so the rays that miss the facet cancel exactly in the difference
for (const A of pickAz) {
  let best = null; for (const w of withAz) { let dd = Math.abs(w.az - A); if (dd > 180) dd = 360 - dd; if (!best || dd < best.dd) best = { ...w, dd }; }
  const G = farfield([best.f]); const D = new Float64Array(G.E.length); for (let q = 0; q < D.length; q++) D[q] = Math.max(0, G.E[q] - G0.E[q]); G.E = D;
  // flux-weighted moments over bins (bin energy E)
  let W = 0, mh = 0, mv = 0; for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) { const e = G.E[j * G.nh + i]; if (e > 0) { const [h, v] = RF.FarField.binCentre(G, i, j); W += e; mh += e * h; mv += e * v; } }
  mh /= W; mv /= W; let shh = 0, svv = 0, shv = 0; for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) { const e = G.E[j * G.nh + i]; if (e > 0) { const [h, v] = RF.FarField.binCentre(G, i, j); shh += e * (h - mh) ** 2; svv += e * (v - mv) ** 2; shv += e * (h - mh) * (v - mv); } }
  shh /= W; svv /= W; shv /= W; const tr = shh + svv, det = shh * svv - shv * shv, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const ang = 0.5 * Math.atan2(2 * shv, shh - svv) * 180 / Math.PI;
  // analytic estimate: filament axis projected ⟂ to the ray
  const fr = RF.Source.frame(sc.source), d = V.norm(V.sub(best.f.P, S)); const sinpsi = Math.sqrt(1 - V.dot(fr.a, d) ** 2);
  const L = sc.source.length, est = L * sinpsi / best.r * 180 / Math.PI;
  console.log(`az ${best.az.toFixed(0).padStart(3)}°  r ${best.r.toFixed(0).padStart(3)} mm  ${best.f.id.padEnd(4)} lm in window ${W.toFixed(2)}  aim (${mh.toFixed(1)}, ${mv.toFixed(1)})  σ_long ${Math.sqrt(l1).toFixed(2)}°  σ_short ${Math.sqrt(Math.max(0,l2)).toFixed(2)}°  streak angle ${ang.toFixed(0)}° from horizontal   filament-length estimate L·sinψ/r = ${est.toFixed(2)}° (full length; uniform line σ = ${(est / Math.sqrt(12)).toFixed(2)}°)`);
}
