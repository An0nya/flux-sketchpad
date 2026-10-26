// HB: oncoming high beams in onMode 'high-dip'. Node, no browser: node tests/high-dip.js (exits 1 on any failure).
// Each oncoming car = its shuffled library low (same pick as symmetric; the built-in low when the pool is empty) blended with the built-in high by f = dipFraction.
// One f drives eye glare, road light and the halo; road light and halo take it as two sources (low at w(1-f), high at w f), the GPU atlas gets the same slots.
const { load } = require('./load.js');
const RF = load(), D = RF.Drive, BA = RF.BeamAtlas;
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const EYE = [0, 0, 1.2], SEED = 3;
const lampOf = (x, id, y = 0) => ({ k: 'disc', x, y, z: 0.68, r: 0.08, nx: -1, ny: 0, nz: 0, mat: 'lamp-head', headlamp: true, traffic: id, emit: [1, 1, 1] });
const car = (x, id) => [lampOf(x, id), lampOf(x, id, 1.24)];
const wash = D.lutFrom((h, v) => 4000 + 50 * h - 30 * v, { step: 0.25 }), spot = D.lutFrom((h, v) => 12000 * Math.exp(-0.5 * ((h / 3) ** 2 + (v / 1.5) ** 2)) + 100, { step: 0.25 });
const entry = (id, lut, tint) => ({ id, lut, conv: 'A', tint });
const pool2 = { entries: [entry('a', wash, [1, 0.8, 0.6]), entry('b', spot, [0.7, 0.8, 1])], weights: null, key: 'k2' };
const P = (mode, pool) => ({ trafficBeams: true, src: { traffic: { onMode: mode, seed: SEED } }, lut: wash, lowLut: wash, conv: 'A', trafficPool: pool, lightRange: 1000, lightCars: 8, eye: EYE });
const idOf = (i) => 'oncoming:' + i;
// a car at distance x whose dipState f is wanted: search ids so we get f = 0, f = 1 (dist far) and 0 < f < 1 (dist in the 8 m transition)
const fAt = (id, x) => D.dipFraction(SEED, id, Math.hypot(x, 0, 0.52));
const idNotForgetful = (() => { for (let i = 1; i < 60; i++) if (!D.dipState(SEED, idOf(i), 100).forgetful) return idOf(i); })();
const dipAt = D.dipState(SEED, idNotForgetful, 100).at, xMid = dipAt;   // the 50% point: |lamp - eye| = at
const lampDist = (x) => Math.hypot(x - EYE[0], 0, 0.68 - EYE[2]);
const xFor = (d) => { let x = d; for (let i = 0; i < 20; i++) x = x + d - lampDist(x); return x; };
const sources = (p, x, id) => D.trafficSources(car(x, id), EYE, p);

for (const [label, pool] of [['pool of 2', pool2], ['empty pool', null]]) {
  const p = P('high-dip', pool), sym = P('symmetric', pool);
  const pk = D.trafficPickOf(p, idNotForgetful);
  ok(label + ': the high-dip pick is the symmetric pick (same car, same seed)', D.trafficPickIndexOf(p, idNotForgetful) === D.trafficPickIndexOf(sym, idNotForgetful), D.trafficPickIndexOf(p, idNotForgetful));
  // f = 0 (well under 150 m): one source per lamp, the low half at full weight
  const s0 = sources(p, xFor(60), idNotForgetful);
  ok(label + ': f=0: one source per lamp, weight untouched, the car\'s low beam', s0.length === 2 && s0.every((q) => q.w === 1 && q.beam.lut === (pk ? pk.lut : D.dipTables().low)), s0.map((q) => q.w));
  // f = 1 (past 400 m): one source per lamp, the high half
  const s1 = sources(P('high-dip', pool), xFor(480), idNotForgetful);
  ok(label + ': f=1: one source per lamp, the built-in high, no pick colour', s1.length === 2 && s1.every((q) => near(q.w, 1) && q.beam.lut === D.dipTables().high && q.tint === undefined), s1.map((q) => [q.w, q.tint]));
  // transition: two sources per lamp whose weights add to w
  const xm = xFor(dipAt), sm = sources(p, xm, idNotForgetful);
  const byLamp = [0, 1].map((k) => sm.filter((q) => Math.abs(q.y - k * 1.24) < 1e-9));
  ok(label + ': transition: a low and a high source per lamp, weights sum to w (=1)', byLamp.every((g) => g.length === 2 && near(g[0].w + g[1].w, 1) && g[0].beam.lut !== g[1].beam.lut), byLamp.map((g) => g.map((q) => +q.w.toFixed(4))));
  // road light (CPU trafficAt) at a road point = (1-f) low + f high, per lamp
  const L = byLamp[0], f = L[1].w / (L[0].w + L[1].w), T = D.dipTables();
  const px = xm - 12, py = -0.5, pz = 0, got = L.reduce((a, q) => a + D.trafficAt(q, null, px, py, pz), 0);
  const lowBeam = pk ? pk.lut : T.low, lowC = pk ? pk.conv : 'A', dx = px - L[0].x, dy = py - L[0].y, dz = pz - L[0].z;
  const want = (1 - f) * D.beamAt(lowBeam, lowC, -dx, -dy, dz, 0) + f * D.beamAt(T.high, 'A', -dx, -dy, dz, 0);
  ok(label + ': road light = (1-f) low + f high at a road point', near(got, want, 1e-9) && got > 0, { got, want, f });
  // glare: eye cd of the same lamp uses the same f (distance = lamp to eye) and the same two beams
  const ob = lampOf(xm, idNotForgetful), o = { mode: 'high-dip', seed: SEED, eye: EYE, lut: pk ? pk.lut : wash, conv: lowC, pickLow: !!pk, tint: pk ? pk.tint : undefined };
  const parts = D.Headlamp.dipParts(ob, o), cd = D.Headlamp.cd(ob, o);
  ok(label + ': eye glare uses the same f as the road-light split', near(parts.f, f, 1e-6) && near(cd, parts.low + parts.high, 1e-12), { fGlare: parts.f, fRoad: f });
  if (pk) {
    D.Headlamp.apply([ob], o);
    const Lum = ob.eyeCd, mix = (t) => ((parts.low * t + parts.high) / Lum);
    ok(label + ': the car\'s colour tints the low half only (glare emit = (low*tint + high)/cd)', ob.emit.every((v, i) => near(v / ob.emit[0], [mix(pk.tint[0]), mix(pk.tint[1]), 0.93 * mix(pk.tint[2])][i] / mix(pk.tint[0]), 1e-9)), ob.emit);
  }
  // halo (CPU): linear in the split, so the two halves sum to the blend of the two halos
  const pH = { ...p, look: { visibility: 400, trafficHalo: 16 } }, ray = (() => { const v = [1, 0.12, 0.02], n = Math.hypot(...v); return v.map((c) => c / n); })();
  const H = D.trafficHalo(ray, 60, sm, 16, pH, 0.5);
  const halo1 = (q) => D.trafficHalo(ray, 60, [q], 16, pH, 0.5);
  const sumParts = sm.reduce((a, q) => halo1(q).map((v, i) => v + a[i]), [0, 0, 0]);
  ok(label + ': the halo of the split sources is the sum of the halves, and is non-zero', near(H[0], sumParts[0], 1e-9) && H[0] > 0, { H, sumParts });
  // atlas: every source's slot is the CPU beam, and sampling the packed atlas at a direction equals the CPU table
  const A = D.trafficAtlasPool(p, sm), pack = BA.packAtlas(A.entries);
  let maxRel = 0;
  for (const q of sm) for (const [h, v] of [[0.3, -0.6], [-4, -1.5], [8, -3], [20, -10], [-30, 2], [1, 0.4], [60, -40]]) {
    const cpuV = D.lutAt(q.beam.lut, h, v), gpuV = BA.sampleAtlas(pack, q.idx, h, v);
    maxRel = Math.max(maxRel, Math.abs(cpuV - gpuV) / Math.max(1, cpuV));
    if (pk && q.beam.lut === pk.lut) continue;
  }
  ok(label + ': atlas slot of each source = its CPU beam (built-in tables exact on the atlas grid)', maxRel < 1e-4 || (pool && maxRel < 0.05), { maxRel, slots: sm.map((q) => q.idx), count: pack.count });
  ok(label + ': the atlas holds the pool + built-in low + built-in high', pack.count === (pool ? pool.entries.length : 0) + 2 && A.highSlot === pack.count - 1 && sm.every((q) => q.idx === A.highSlot || q.idx === (pk ? D.trafficPickIndexOf(p, idNotForgetful) : A.lowSlot)), { count: pack.count, hi: A.highSlot });
}
// the built-in tables are exactly the atlas grid (no resample blur at the cutoff)
{ const T = D.dipTables(), pk = BA.packAtlas([{ lut: T.low, conv: 'A' }, { lut: T.high, conv: 'A' }]);
  ok('built-in low/high tables are 256 x 256 (the atlas grid), so packing does not resample', T.low.nh === 256 && T.low.nv === 256 && pk.W === 256 && pk.H === 256);
  let m = 0; for (let j = 0; j < 256; j += 7) for (let i = 0; i < 256; i += 5) m = Math.max(m, Math.abs(pk.data[j * 256 + i] - T.low.data[j * 256 + i]));
  ok('packed built-in low equals the table texel for texel', m === 0, m); }
// more than 14 pool entries: high-dip drops the shuffle (atlas holds 16) on CPU and GPU alike; symmetric keeps it
{ const big = { entries: Array.from({ length: 15 }, (_, i) => entry('e' + i, wash, [1, 1, 1])), weights: null, key: 'big' };
  const p = P('high-dip', big);
  ok('15-entry pool: high-dip has no pick (built-in low) and the atlas fits', D.trafficPickIndexOf(p, idOf(1)) === -1 && BA.packAtlas(D.trafficAtlasPool(p, [1]).entries).count === 2);
  ok('15-entry pool: symmetric still picks', D.trafficPickIndexOf(P('symmetric', big), idOf(1)) >= 0); }
// other modes are untouched: no idx field, no split, the atlas test is the old one
for (const mode of ['symmetric', 'generic', 'high', 'manual']) {
  const p = P(mode, pool2), s = sources(p, xFor(60), idNotForgetful);
  ok(mode + ': sources have no idx and keep weight 1; atlas pool is the old test', s.every((q) => q.idx === undefined && q.w === 1) && (mode === 'symmetric' ? D.trafficAtlasPool(p, s) === pool2 : D.trafficAtlasPool(p, s) === null), s.map((q) => Object.keys(q).join()));
}
// preceding (tail-lamp) cars are never put on high
{ const p = P('high-dip', pool2), tail = [{ k: 'disc', x: 500, y: 0, z: 0.68, r: 0.05, nx: 1, ny: 0, nz: 0, taillamp: true, traffic: 'prec:1', emit: [1, 0, 0] }];
  const s = D.trafficSources(tail, EYE, { ...p, lightRange: 1000 });
  ok('a tail-lamp car stays on its low beam (f = 0) even far away', s.length > 0 && s.every((q) => q.idx !== D.trafficAtlasPool(p, s).highSlot), s.map((q) => q.idx)); }
console.log(fails ? fails + ' FAILED' : 'all high-dip checks passed'); process.exitCode = fails ? 1 : 0;
