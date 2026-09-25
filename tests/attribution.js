// Per-hit facet attribution (headless): node tests/attribution.js — exits 1 on failure.
// Each recorded hit carries hitK = 1 + the first surface the ray met (0 = direct) and hitB = bounces.
// Oracle: ray i draws the same random numbers in any scene, so a ray the full scene credits to facet k
// follows the same path when k is traced ALONE.  Solo footprint ⊇ credited footprint, cell by cell
// (solo can be larger: rays that other facets shadowed or re-hit).  Negative control: credit the
// wrong facet and the same test must fail.
const { load } = require('./load.js'); const RF = load(); const E = RF.Engine, C = RF.Controller;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

const st = C.createStore(RF.State.testScene()); C.regenerateA(st);
const sc = st.scene, surfs = RF.State.allSurfaces(sc), N = 200000;
const prep = (list) => { const P = E.prepare(sc, list); P.recordHits = true; return P; };
const P = prep(surfs), c = E.runSync(P, N), res = P.res, T = P.T;
const cellOf = (u, v) => { let iu = Math.floor((u + T.half) / (2 * T.half) * res), iv = Math.floor((v + T.half) / (2 * T.half) * res); if (iu >= res) iu = res - 1; if (iv >= res) iv = res - 1; return iv * res + iu; };
const credited = (label) => { const g = new Float64Array(res * res); for (let h = 0; h < c.nHits; h++) if (c.hitK[h] === label) g[cellOf(c.hits[3 * h], c.hits[3 * h + 1])] += c.hits[3 * h + 2]; return g; };

// bookkeeping: labels partition the landed energy exactly as the engine's own accumulators do
{ let d = 0, r = 0, bad = 0, range = 0;
  for (let h = 0; h < c.nHits; h++) { const k = c.hitK[h], e = c.hits[3 * h + 2]; if (k === 0) d += e; else r += e; if ((k === 0) !== (c.hitB[h] === 0)) bad++; if (k > P.G.n) range++; }
  ok('all hits recorded', c.nHits < c.hitCap, c.nHits + ' hits of cap ' + c.hitCap);
  ok('direct label sums to E.direct', Math.abs(d - c.E.direct) <= 1e-5 * c.E.direct + 1e-9, d.toPrecision(8) + ' vs ' + c.E.direct.toPrecision(8));
  ok('facet labels sum to E.reflected', Math.abs(r - c.E.reflected) <= 1e-5 * c.E.reflected, r.toPrecision(8) + ' vs ' + c.E.reflected.toPrecision(8));
  ok('label 0 ⇔ zero bounces; every label names a real surface', bad === 0 && range === 0, bad + ' mismatches, ' + range + ' out of range'); }

// oracle: solo trace of facet k contains everything credited to k
function subset(k, label) {
  const Ps = prep([surfs[k]]), cs = E.runSync(Ps, N), g = credited(label);
  let tot = 0, over = 0, solo = 0; for (let i = 0; i < g.length; i++) { tot += g[i]; solo += cs.gridR[i]; if (g[i] > cs.gridR[i] * (1 + 1e-5) + 1e-12) over += g[i] - cs.gridR[i]; }
  return { tot, over, solo };
}
const lit = []; { const per = new Float64Array(P.G.n + 1); for (let h = 0; h < c.nHits; h++) per[c.hitK[h]] += c.hits[3 * h + 2]; for (let k = 1; k <= P.G.n; k++) if (per[k] > 0) lit.push(k - 1); }
const pick = [lit[0], lit[lit.length >> 1], lit[lit.length - 1]];
for (const k of pick) {
  const r = subset(k, k + 1);
  ok('facet ' + surfs[k].id + ': credited footprint ⊆ solo footprint', r.tot > 0 && r.over <= 1e-4 * r.tot, 'credited ' + r.tot.toFixed(4) + ', solo ' + r.solo.toFixed(4) + ' (+' + (100 * (r.solo / r.tot - 1)).toFixed(2) + '% shadowed/re-hit in the full scene), overshoot ' + r.over.toExponential(2));
}
{ const k = pick[1], wrong = pick[0] + 1, r = subset(k, wrong);
  ok('negative control: wrong facet\'s credit is NOT inside facet ' + surfs[k].id + '\'s solo footprint', r.over > 0.5 * r.tot, 'overshoot ' + (100 * r.over / r.tot).toFixed(1) + '% of credited energy'); }

// loss accounting: k alone catches exactly (caught + shadowed) rays; fates partition the caught rays
for (const k of pick) {
  const rays = []; for (let i = 0; i < c.next; i++) if (c.rayK[i] === k + 1) rays.push(i);
  const L = E.facetLosses(P, c, k, rays), f = L.fate;
  const Ps = prep([surfs[k]]), cs = E.runSync(Ps, N); let solo = 0; for (let i = 0; i < N; i++) if (cs.rayK[i] === 1) solo++;
  ok('facet ' + surfs[k].id + ': solo catch = caught + shadowed; fates add up', solo === L.caught + L.shadowed && f.landed + f.blocked + f.escaped + f.other === L.caught,
    'solo ' + solo + ' = ' + L.caught + ' + ' + L.shadowed + ' shadowed (by ' + (L.shadowers.join(', ') || '—') + '); landed ' + f.landed + ', blocked ' + f.blocked + ' (by ' + (L.blockers.join(', ') || '—') + '), escaped ' + f.escaped + ', other ' + f.other);
}

// fixture totals (Engine.occlusion + occ.blockedK) = the per-facet counts summed over every facet
{ const t0 = Date.now(), O = E.occlusion(P, c), ms = Date.now() - t0, e0R = (P.power / N) * sc.modeA.reflectivity;
  let shSum = 0, shBad = 0, blBad = 0;
  for (let k = 0; k < P.G.n; k++) {
    const rays = []; for (let i = 0; i < c.next; i++) if (c.rayK[i] === k + 1) rays.push(i);
    const L = E.facetLosses(P, c, k, rays); shSum += L.shadowed;
    if (L.shadowed !== O.shadowK[k]) shBad++;
    if (Math.abs(c.occ.blockedK[k] / e0R - L.fate.blocked) > 1e-6) blBad++;
    if (L.caught && Math.abs(c.occ.blockedK[k] / c.occ.out1K[k] - L.fate.blocked / L.caught) > 1e-9) blBad++;   // same share, energy vs count
  }
  const st = E.stats(c).occlusion;
  ok('occlusion totals match per-facet counts (' + P.G.n + ' facets)', shBad === 0 && blBad === 0,
    shBad + ' shadow / ' + blBad + ' blocked mismatches; shadowed ' + (100 * O.shadowed).toFixed(2) + '%, overlap ' + (100 * O.overlap).toFixed(2) + '%, blocked ' + (100 * st.blocked).toFixed(2) + '% (worst ' + st.blockedWorst.slice(0, 2).map((w) => w.id + ' ' + (100 * w.lost).toFixed(0) + '%').join(', ') + '); pass ' + ms + ' ms at ' + N + ' rays'); }

// retrace: replaying a hit's ray lands on the same point via the same first surface; rayK agrees
{ const T = P.T; let bad = 0, badK = 0, wrong = 0, n = 0;
  const land = (h) => E.targetUVtoWorld(T, c.hits[3 * h], c.hits[3 * h + 1]);
  for (let h = 0; h < c.nHits; h += Math.max(1, Math.floor(c.nHits / 300))) {
    n++; const r = E.retrace(P, c.hitI[h]), L = r.length, end = [r[L - 3], r[L - 2], r[L - 1]], p = land(h);
    if (Math.hypot(end[0] - p[0], end[1] - p[1], end[2] - p[2]) > 1e-3 * T.half) bad++;
    if ((r.ks.length ? r.ks[0] + 1 : 0) !== c.hitK[h] || c.rayK[c.hitI[h]] !== c.hitK[h]) badK++;
    const r2 = E.retrace(P, c.hitI[h] + 1), e2 = [r2[r2.length - 3], r2[r2.length - 2], r2[r2.length - 1]];
    if (Math.hypot(e2[0] - p[0], e2[1] - p[1], e2[2] - p[2]) > 1e-3 * T.half) wrong++;
  }
  ok('retrace reproduces ' + n + ' sampled hits (point + first surface + rayK)', bad === 0 && badK === 0, bad + ' off, ' + badK + ' label mismatches');
  ok('negative control: retracing the NEXT ray index lands elsewhere', wrong > 0.95 * n, wrong + ' of ' + n + ' differ'); }

// multi-bounce: the test scene has none, so use a light pipe (two facing mirrors along the throw axis)
{ const f = RF.State.testScene(); for (const k of Object.keys(f.groups)) f.groups[k].surfaces = [];
  f.source.pos = [0, 0, 0]; f.source.axis = [1, 0, 0]; f.source.dist = 'cone'; f.source.halfAngle = 40; f.sim.bounces = 4;
  const wall = (id, y) => ({ type: 'plane', id, P: [60, y, 0], n: [0, -Math.sign(y), 0], clip: { kind: 'disc', r: 60 }, optics: { interaction: 'reflect', reflectivity: 0.9, ior: 1.49, fresnelT: 0.96, twoSided: false } });
  const pipe = [wall('top', 6), wall('bottom', -6)], P3 = E.prepare(f, pipe); P3.recordHits = true; const c3 = E.runSync(P3, N);
  const byB = [0, 0, 0, 0, 0]; let bad = 0, er = 0;
  for (let h = 0; h < c3.nHits; h++) { const b = c3.hitB[h]; byB[Math.min(b, 4)]++; if (b > 0) er += c3.hits[3 * h + 2]; if ((c3.hitK[h] === 0) !== (b === 0) || b > P3.cap || c3.hitK[h] > 2) bad++; }
  ok('light pipe: multi-bounce hits exist and labels stay consistent', byB[2] + byB[3] + byB[4] > 0 && bad === 0 && Math.abs(er - c3.E.reflected) <= 1e-5 * c3.E.reflected, 'hits by bounces 0..4: ' + byB.join(' / ') + ', ' + bad + ' bad'); }

// cost of recording (informational; the view already records u, v, E)
{ const t = (rec) => { const Q = E.prepare(sc, surfs); Q.recordHits = rec; E.runSync(Q, 20000); const a = []; for (let i = 0; i < 3; i++) a.push(E.runSync(Q, N).elapsed); return a.sort((x, y) => x - y)[1]; };
  const off = t(false), on = t(true); console.log('[INFO] ' + N + ' rays: recording off ' + off.toFixed(0) + ' ms, on ' + on.toFixed(0) + ' ms'); }
process.exit(fails ? 1 : 0);
