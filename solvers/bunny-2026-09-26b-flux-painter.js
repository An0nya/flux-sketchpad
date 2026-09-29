/* Bundled model solver: space-bunny-alpha, Flux solver benchmark run 2026-09-26 (workspace work-space-bunny-alpha-flux-solver-20260926-0546).
 * Copied verbatim from that run's solvers/solver.js (sha256 a6e5fd06897c…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* Flux "paint-fitting" reflector — a STATIC solver.  No ray tracing inside solve().
 *
 * --------------------------------------------------------------------------------------
 * The model (closed-form, first order — the same physics the app reports as `achievableKernel`)
 *
 *   A facet reflects an IMAGE of the LED onto the target.  With its design source S0, its centre P
 *   and its aim Z, the image of S0 lands exactly on Z, and the transverse magnification is
 *
 *       m = |P − Z| / |P − S0| ,
 *
 *   so the facet paints a soft-edged blob of side  W ≈ m · (the LED's width seen from P) + (a little
 *   of its own aperture), centred on Z.  What it can deliver is fixed by flux conservation:
 *
 *       level = ( A · sinφ · ρ(P) · R · Φ ) / ( W² · cellArea · paintMax )
 *
 *   with A the aperture area, φ the half turn (the facet's tilt), ρ(P) the flux per mm² the LED
 *   sends to P and Φ the lamp's lumens.  Two knobs, then: POSITION sets the stamp size and the
 *   brightness per mm², AIM sets where the stamp lands, AREA sets how bright it is.
 *
 *   That turns the job into a stamp-covering problem: place ⌈maxFacets⌉ stamps so that
 *   Σ stamps ≈ paint everywhere and ≈ 0 in the gaps.  It is solved with a greedy
 *   weighted-least-squares fit driven by summed-area tables (O(1) per candidate), then polished by
 *   coordinate descent.  Milliseconds, deterministic, no search.
 * --------------------------------------------------------------------------------------
 */
(function () {
  'use strict';
  if (typeof RF === 'undefined') return;
  const { V, Geo, Engine, Source, Photometry } = RF;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'aimStep', label: 'Aim grid step (cells)', type: 'range', min: 0.25, max: 2, step: 0.25, default: 1 },
    { key: 'gapWeight', label: 'Dark-gap penalty', type: 'range', min: 0, max: 20, step: 0.5, default: 2 },
    { key: 'spotGain', label: 'Image size gain', type: 'range', min: 0.3, max: 2.5, step: 0.05, default: 1.1 },
    { key: 'plateFill', label: 'Plate fill of its cell', type: 'range', min: 0.1, max: 0.98, step: 0.01, default: 0.92 },
    { key: 'farCut', label: 'How far out to build (×r_max)', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
    { key: 'rhoWeight', label: 'Weight on flux when seating plates', type: 'range', min: 0, max: 4, step: 0.25, default: 0 },
    { key: 'stampFactor', label: 'Image size (× cells per facet)', type: 'range', min: 0.5, max: 6, step: 0.1, default: 1.3 },
    { key: 'edge', label: 'Image edge softness', type: 'range', min: 0, max: 0.8, step: 0.05, default: 0.35 },
    { key: 'bandFocus', label: 'Focus on failing cells', type: 'range', min: 0, max: 1, step: 0.1, default: 0 },
    { key: 'light', label: 'Light ambition (× what fits)', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.7 },
    { key: 'polish', label: 'Polish passes', type: 'range', min: 0, max: 6, step: 1, default: 4 },
    { key: 'recheck', label: 'Beam re-check rounds', type: 'range', min: 0, max: 6, step: 1, default: 2 },
    { key: 'facets', label: 'Fraction of the facet budget used', type: 'range', min: 0.1, max: 1, step: 0.05, default: 1 },
  ];

  // ------------------------------------------------------------------ summed-area tables
  function sumTable(A, R) {
    const W = R + 1, S = new Float64Array(W * W);
    for (let j = 0; j < R; j++) {
      let rs = 0, o = j * R, q = (j + 1) * W, p = j * W;
      for (let i = 0; i < R; i++) { rs += A[o + i]; S[q + i + 1] = S[p + i + 1] + rs; }
    }
    return S;
  }
  function rect(S, R, i0, i1, j0, j1) {
    i0 = i0 < 0 ? 0 : i0; j0 = j0 < 0 ? 0 : j0; i1 = i1 > R ? R : i1; j1 = j1 > R ? R : j1;
    if (i1 <= i0 || j1 <= j0) return 0;
    const W = R + 1;
    return S[j1 * W + i1] - S[j0 * W + i1] - S[j1 * W + i0] + S[j0 * W + i0];
  }

  // ------------------------------------------------------------------ the LED, as a stamp size
  /* Characteristic transverse width of the source seen from the facet: the geometric mean of its
   * width in two directions perpendicular to the chief ray.  (planar sources foreshorten, so this
   * falls off with the off-axis angle; a point source gives 0 and the stamp is then aperture-limited) */
  function sourceTransverse(src, view) {
    if (src.kind === 'point') return 0;
    const fr = Source.frame(src);
    let d1 = V.cross(view, fr.a);
    if (V.len(d1) < 1e-6) d1 = V.cross(view, fr.u);
    d1 = V.norm(d1);
    const d2 = V.norm(V.cross(view, d1));
    const width = (d) => {
      if (src.kind === 'planar' && src.shape === 'rect') return src.w * Math.abs(V.dot(d, fr.u)) + src.h * Math.abs(V.dot(d, fr.v));
      if (src.kind === 'planar') return 2 * src.radius * Math.sqrt(Math.max(0, 1 - Math.pow(V.dot(d, fr.a), 2)));
      if (src.shape === 'cylinder') return 2 * src.radius * Math.sqrt(Math.max(0, 1 - Math.pow(V.dot(d, fr.a), 2))) + src.length * Math.abs(V.dot(d, fr.a));
      return 2 * src.radius;
    };
    return Math.sqrt(Math.max(0, width(d1) * width(d2)));
  }
  /* Relative flux reaching one mm² of mirror at P, as a fraction of the whole lamp: the source's
   * intensity per steradian times the cosine of the incidence, over the solid angle and the total
   * integral.  (Mirror facets are tilted, so the caller multiplies by the projected-area factor.) */
  function catchPerArea(src, P, S) {
    const r = V.dist(P, S);
    if (!(r > 1e-9)) return 0;
    const c = V.dot(V.mul(V.sub(P, S), 1 / r), Source.frame(src).a);
    if (c <= 0.02) return 0;                                       // behind a planar LED
    const th = Math.acos(clamp(c, -1, 1));
    if (th > Source.thetaMax(src) - 1e-3) return 0;
    return Source.intensity(src, th) * c / (r * r * Source.totalIntegral(src));
  }

  // ------------------------------------------------------------------ the envelope's boundary
  /* A grid of boundary points with their inward normal, each pushed `margin` inside. */
  function boundarySamples(env, G, margin) {
    const c = env.center, h = env.half, out = [];
    const put = (p, n) => {
      for (let a = 0; a < 3; a++) if (Math.abs(p[a] - c[a]) > h[a] * (1 - 1e-9)) p[a] = c[a] + Math.sign(p[a] - c[a]) * h[a] * (1 - 1e-9);
      out.push({ p, n });
    };
    if (env.shape === 'box') {
      for (let ax = 0; ax < 3; ax++) for (const sd of [-1, 1]) {
        const i = (ax + 1) % 3, j = (ax + 2) % 3;
        for (let a = 0; a <= G; a++) for (let b = 0; b <= G; b++) {
          const p = c.slice(), n = [0, 0, 0];
          p[ax] += sd * h[ax]; p[i] += (2 * a / G - 1) * h[i]; p[j] += (2 * b / G - 1) * h[j]; n[ax] = -sd;
          put(p, n);
        }
      }
    } else if (env.shape === 'ellipsoid') {
      const N = Math.max(96, 6 * G * G), ga = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < N; k++) {
        const z = 1 - 2 * (k + 0.5) / N, r = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * k;
        const d = [h[0] * r * Math.cos(t), h[1] * r * Math.sin(t), h[2] * z];
        put([c[0] + d[0], c[1] + d[1], c[2] + d[2]], V.mul(V.norm([d[0] / h[0], d[1] / h[1], d[2] / h[2]]), -1));
      }
    } else {
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      for (let a = 0; a <= G; a++) for (let k = 0; k < 4 * G; k++) {
        const t = 2 * Math.PI * k / (4 * G), p = c.slice(), n = [0, 0, 0];
        p[ax] += (2 * a / G - 1) * h[ax]; p[i] += h[i] * Math.cos(t); p[j] += h[j] * Math.sin(t);
        n[i] = -Math.cos(t) * h[ax] / h[i]; n[j] = -Math.sin(t) * h[ax] / h[j];
        put(p, V.norm(n));
      }
    }
    for (const s of out) s.p = s.p;                                // Q: the raw wall point
    return out;
  }
  function roomAlong(env, P, dir) {                                 // distance to the wall from P
    if (!Geo.envInside(env, V.madd(P, dir, 1e-6), 0)) return 0;
    let lo = 0, hi = Math.max(...env.half) * 2 + 1;
    if (!Geo.envInside(env, V.madd(P, dir, hi), 0)) { let a = 0, b = hi; for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (Geo.envInside(env, V.madd(P, dir, m), 0)) a = m; else b = m; } lo = a; }
    else lo = hi;
    for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (Geo.envInside(env, V.madd(P, dir, mid), 0)) lo = mid; else hi = mid; }
    return lo;
  }

  // ------------------------------------------------------------------ the stamp of one facet
  /* The footprint model: a flat core of side W(1−edge) plus a ring of weight RING out to W.  Both
   * are axis-aligned rectangles in paint cells, so the fit only ever needs rectangle sums.        */
  const RING = 0.45;
  function stampOf(pl, Z, gain, edge, cell, R) {
    const r = pl.r, di = V.dist(pl.p, Z);
    const sh = V.norm(V.sub(pl.S, pl.p)), ah = V.norm(V.sub(Z, pl.p));
    const sinPhi = Math.sqrt(Math.max(0, 0.5 * (1 - V.dot(sh, ah))));                 // facet's projected area toward the LED
    const W = Math.max(0.75 * cell, gain * (di / r) * pl.s + 0.3 * pl.side);
    const ci = 0.5 * W * (1 - edge) / cell, co = 0.5 * W / cell;
    const i0 = Math.round(0.5 - ci), i1 = Math.round(0.5 + ci);
    const j0 = Math.round(0.5 - ci), j1 = Math.round(0.5 + ci);
    const I0 = Math.round(0.5 - co), I1 = Math.round(0.5 + co);
    const J0 = Math.round(0.5 - co), J1 = Math.round(0.5 + co);
    return { W, sinPhi, i0, i1, j0, j1, I0, I1, J0, J1, nIn: (i1 - i0) * (j1 - j0), nOut: (I1 - I0) * (J1 - J0) };
  }
  // objective bookkeeping for one stamp placed at cell (i,j) with a level x
  function stampTerms(Sres, Scw, R, st, i, j) {
    const Rin = rect(Sres, R, i + st.i0, i + st.i1, j + st.j0, j + st.j1);
    const Rout = rect(Sres, R, i + st.I0, i + st.I1, j + st.J0, j + st.J1);
    const Qin = rect(Scw, R, i + st.i0, i + st.i1, j + st.j0, j + st.j1);
    const Qout = rect(Scw, R, i + st.I0, i + st.I1, j + st.J0, j + st.J1);
    return { R: Rin + RING * (Rout - Rin), Q: Qin + RING * RING * (Qout - Qin) };
  }
  function addStamp(G, R, st, i, j, x) {                            // commit a stamp to the grid
    for (let jj = j + st.J0; jj < j + st.J1; jj++) {
      if (jj < 0 || jj >= R) continue;
      const inY = jj >= j + st.j0 && jj < j + st.j1;
      for (let ii = i + st.I0; ii < i + st.I1; ii++) {
        if (ii < 0 || ii >= R) continue;
        const inX = ii >= i + st.i0 && ii < i + st.i1;
        G[jj * R + ii] += x * (inX && inY ? 1 : RING);
      }
    }
  }

  // ================================================================== solve
  function solve(input, settings, tools) {
    const src = input.source, env = input.envelope, tgt = input.target;
    const S = src.pos.slice();
    const T = Engine.targetFrame(tgt);
    const R = input.paint.res | 0, paint = input.paint.cells;
    // the scorer indexes the paint at target.res; if a scene ever disagreed, follow the scorer
    const cell = 2 * T.half / ((tgt.res | 0) || R), cellA = cell * cell;
    const Nmax = Math.max(1, Math.min(2000, input.limits.maxFacets | 0));
    const N = Math.max(1, Math.min(Nmax, Math.round(Nmax * clamp(+settings.facets === undefined ? 1 : +settings.facets, 0.05, 1))));
    const refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const power = Math.max(1e-9, src.power);
    const notes = [];

    // ---- the painting ---------------------------------------------------------------------
    let maxLvl = 0, sumLvl = 0, nPaint = 0;
    for (let k = 0; k < R * R; k++) if (paint[k] > 0) { if (paint[k] > maxLvl) maxLvl = paint[k]; sumLvl += paint[k]; nPaint++; }
    if (!(nPaint > 0) || !(maxLvl > 0)) return { surfaces: [], intent: [], notes: ['the target is not painted: nothing to fit'] };
    const p01 = new Float64Array(R * R);
    for (let k = 0; k < R * R; k++) p01[k] = paint[k] / maxLvl;
    const typ = sumLvl / maxLvl / nPaint;
    let iMin = R, iMax = -1, jMin = R, jMax = -1;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (p01[j * R + i] > 0) {
      if (i < iMin) iMin = i; if (i > iMax) iMax = i; if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    }
    const demand = sumLvl / maxLvl;                                   // Σ p01  (energy for level 1)

    // the app's own notions of "the smallest image" and "how dark a gap may be"
    let kerCells = 0;
    try { kerCells = (Photometry.achievableKernel({ source: src, envelope: env, target: tgt }).cells) || 0; } catch (e) { kerCells = 0; }
    const band = Math.ceil(kerCells) + 2;
    const blur = Photometry.boxBlur(p01, R, Math.max(2, kerCells));
    const near = new Uint8Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (p01[j * R + i] > 0)
      for (let b = -band; b <= band; b++) {
        const a = i + b, d = j + b;
        if (a >= 0 && a < R) near[j * R + a] = 1;
        if (d >= 0 && d < R) near[d * R + i] = 1;
      }

    // ---- where facets may sit ------------------------------------------------------------
    /* A facet is a tilted plate: its normal bisects "to the LED" and "to the aim", so on a flat wall
     * it leans by up to 45° and a square of side s needs ~s of depth to stay inside.  So every
     * candidate keeps its wall point Q and its inward normal, and its centre is placed
     * P = Q + delta·n_in with delta sized from the plate's own side (re-checked after the fit).  */
    const margin = Math.max(0.01 * Math.max.apply(null, env.half), 0.01);
    /* The throw axis, and the "lateral" coordinates of a point: what the fixture sees looking down
     * the beam.  Two mirrors whose lateral footprints overlap shadow each other from the lamp or
     * stand in each other's beam, however far apart they are along the axis — so the layout below
     * is a blue-noise packing in the LATERAL plane, with each mirror pushed as far along the axis as
     * the envelope allows (which is also what makes its image of the LED smallest).                 */
    const axis = V.norm(V.sub(T.C, S));
    const lat1 = V.norm(V.cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const lat2 = V.cross(axis, lat1);
    const latOf = (q) => { const d = V.sub(q, S); return [V.dot(d, lat1), V.dot(d, lat2)]; };
    const samples = boundarySamples(env, 40, 0);
    const tMax = Source.thetaMax(src), fr = Source.frame(src);
    const totalI = Math.max(1e-12, Source.totalIntegral(src));
    const usable = [];
    for (const s of samples) {
      const Q = s.p, nIn = s.n;
      const r0 = V.dist(Q, S);
      if (!(r0 > keep + 1e-6)) continue;                              // must clear the LED
      const toT = V.sub(T.C, Q), lT = V.len(toT);
      if (!(lT > 1e-6)) continue;
      const cosE = V.dot(V.mul(V.sub(Q, S), 1 / r0), fr.a);
      if (cosE <= 0.04 || Math.acos(clamp(cosE, -1, 1)) > tMax - 1e-3) continue;
      const rec = { Q, nIn, view: V.mul(V.sub(Q, S), 1 / r0) };
      rec.lat = latOf(Q);
      rec.depth = V.dot(V.sub(Q, S), axis);
      rec.image = V.dist(Q, T.C) / r0 * sourceTransverse(src, rec.view);   // the LED image this plate would paint
      // how much the beam leaving this wall runs ALONG it: a plate on a wall square to the throw
      // axis never has another plate in its beam, one on a wall parallel to it usually does
      rec.along = Math.abs(V.dot(nIn, V.mul(toT, 1 / lT)));
      placePlate(rec, margin);                                        // provisional centre
      if (!(rec.rho > 0) || !(rec.r > keep)) continue;
      // room for the plate, measured from INSIDE the envelope: on a curved wall a step along the
      // tangent from the surface itself is already outside
      const e1 = V.norm(V.cross(nIn, Math.abs(nIn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      const e2 = V.cross(nIn, e1);
      const room = Math.min(roomAlong(env, rec.p, e1), roomAlong(env, rec.p, e2),
        roomAlong(env, rec.p, V.neg(e1)), roomAlong(env, rec.p, V.neg(e2)));
      if (!(room > 1e-6)) continue;
      rec.room = room;
      usable.push(rec);
    }
    if (!usable.length) return { surfaces: [], intent: [], notes: ['no envelope boundary the LED can see: nothing to place'] };
    const rTop = usable.reduce((m, s) => Math.max(m, s.r), 0);
    // the far shell gives the smallest image, but the band has to be wide enough to hold the facets
    const pool = usable.slice().sort((a, b) => (b.rho / a.rho) - 1 || (b.r - a.r) || (a.Q[0] + a.Q[1] + a.Q[2] - (b.Q[0] + b.Q[1] + b.Q[2])));
    const fill = clamp(+settings.plateFill, 0.05, 0.95);
    const stampFactor = Math.max(0.3, +settings.stampFactor || 1.3);
    /* One candidate per lateral cell, chosen so the LED's image comes out at the size the painting
     * wants: W ≈ stampFactor·(the target cells each of the facets has to cover).  Much smaller an
     * image and the facets cannot cover the painting; much larger and they wash its edges out.    */
    const cellW = Math.max(0.5, 0.02 * Math.max(...env.half));
    const Wtarget = Math.max(0.4 * cell, clamp(+settings.stampCells > 0 ? +settings.stampCells * cell
      : stampFactor * cell * Math.sqrt(nPaint / Math.max(1, N)), 0.3 * cell, 40 * Math.max(...env.half)));
    const bucketed = [];
    {
      const rhoMax = pool.reduce((m, c) => Math.max(m, c.rho), 0) || 1;
      const kw = Math.max(0, +settings.rhoWeight || 0);
      const score = (c) => kw * Math.log(Math.max(1e-12, c.rho) / rhoMax) - Math.pow(Math.log(Math.max(1e-9, c.image) / Wtarget), 2);
      const map = new Map();
      for (const c of pool) {
        const key = Math.round(c.lat[0] / cellW) + ':' + Math.round(c.lat[1] / cellW);
        const cur = map.get(key);
        if (!cur || score(c) > score(cur)) map.set(key, c);
      }
      for (const c of map.values()) bucketed.push(c);
    }
    const shells = bucketed.length ? bucketed : pool;
    let plates = [], cut = clamp(+settings.farCut, 0, 1);
    for (let attempt = 0; attempt < 8; attempt++) {
      const sub = shells.filter((c) => c.r >= cut * rTop);
      plates = spreadPlates(sub.length >= 4 ? sub : shells, N, fill);
      if (plates.length >= N || attempt === 7) break;
      cut *= 0.5;
    }
    if (!plates.length) return { surfaces: [], intent: [], notes: ['no room for facets on the boundary'] };

    const gain = Math.max(0.05, +settings.spotGain || 1);
    const edge = clamp(+settings.edge, 0, 0.8);
    const plateFlux = (pl, st) => pl.side * pl.side * st.sinPhi * pl.rho * refl * power;   // lumens
    const levelOf = (pl, st) => plateFlux(pl, st) * cellA / (st.W * st.W * maxLvl);        // level inside the stamp
    const stampAt = (pl, Z) => stampOf(pl, Z, gain, edge, cell, R);
    // provisional seating depth for a plate of side s; the exact one is used when the plate is
    // built, once its size (and therefore its tilt) is known
    const depthFor = (side) => margin + 0.62 * side;
    function placePlate(rec, delta) {
      rec.S = S;
      rec.p = V.madd(rec.Q, rec.nIn, delta);
      rec.r = V.dist(rec.p, S);
      const cosE = V.dot(rec.view, fr.a);
      const th = Math.acos(clamp(cosE, -1, 1));
      rec.rho = (cosE > 0.04 && th <= tMax - 1e-3) ? Source.intensity(src, th) / (rec.r * rec.r * totalI) : 0;
      rec.s = sourceTransverse(src, rec.view);
      return rec;
    }
    for (const pl of plates) placePlate(pl, depthFor(pl.side));

    // ---- aim grid over the painting -------------------------------------------------------
    const step = clamp(+settings.aimStep || 1, 0.2, 4);
    const gi0 = Math.max(0, Math.floor(iMin - 1.5)), gi1 = Math.min(R, Math.ceil(iMax + 2.5));
    const gj0 = Math.max(0, Math.floor(jMin - 1.5)), gj1 = Math.min(R, Math.ceil(jMax + 2.5));
    const aims = [];
    for (let j = gj0; j < gj1; j += step) for (let i = gi0; i < gi1; i += step)
      aims.push({ i, j, z: Engine.targetUVtoWorld(T, -T.half + (i + 0.5) * cell, -T.half + (j + 0.5) * cell) });
    if (!aims.length) return { surfaces: [], intent: [], notes: ['empty aim grid'] };

    const lam = Math.max(0, +settings.gapWeight || 0);

    /* The fit.  Re-runnable: the plates' centres (and therefore their image size and flux) depend on
     * how big the plates turn out to be, and their size comes out of the fit — so the design is
     * fitted, the plates are re-seated at the depth their real size needs, and fitted again.        */
    function runFit(L0) {
    // ---- fit target and weights (weighted least squares, units: level × the paint's own levels)
    const cW = new Float64Array(R * R), tK = new Float64Array(R * R);
    for (let k = 0; k < R * R; k++) {
      if (p01[k] > 0) { tK[k] = p01[k] * L0; cW[k] = 1; }
      else if (near[k]) { tK[k] = 0.5 * Math.max(1.25 * blur[k], 0.1 * typ) * L0; cW[k] = lam; }
      else { tK[k] = 0; cW[k] = lam * 0.03; }
    }
    const G = new Float64Array(R * R);
    const focus = clamp(+settings.bandFocus || 0, 0, 1);
    const base = Float64Array.from(cW);
    /* The scorer only counts cells outside ±25 %, so cells already inside that band should stop
     * consuming facets.  Re-weighting each pass (IRLS-style) does that: a painted cell's weight
     * falls to `floor` as its ratio approaches the band.  The objective stays quadratic in the
     * level, so the greedy's closed-form step is still exact.                                       */
    const fixed = focus > 0 ? null : sumTable(base, R);
    const reweight = () => {
      if (!(focus > 0)) return fixed;
      const floor = 1 - 0.9 * focus;
      for (let k = 0; k < R * R; k++) {
        let c = base[k];
        if (c > 0 && tK[k] > 0) {
          const u = Math.abs(G[k] / tK[k] - 1);
          c *= floor + (1 - floor) * clamp((u - 0.18) / 0.22, 0, 1);
        }
        cW[k] = c;
      }
      return sumTable(cW, R);
    };
    let Scw = reweight();
    const Sres = () => { const a = new Float64Array(R * R); for (let k = 0; k < R * R; k++) a[k] = cW[k] * (G[k] - tK[k]); return sumTable(a, R); };
    let Sr = Sres();

    // ---- phase 1: greedy over aims, all stamps taken as the mid-layout plate's ----------------
    const ref = plates[plates.length >> 1];
    const refSt = stampAt(ref, T.C);
    const refCap = levelOf(ref, refSt);
    const nTake = Math.min(aims.length, N);
    const picks = [];
    for (let n = 0; n < nTake; n++) {
      let best = null, bestGain = 0;
      for (let ai = 0; ai < aims.length; ai++) {
        const a = aims[ai];
        const t = stampTerms(Sr, Scw, R, refSt, a.i, a.j);
        if (t.R >= 0) continue;
        const x = Math.min(-t.R / t.Q, refCap * 1.6);
        if (!(x > 0)) continue;
        const g = 2 * x * -t.R - x * x * t.Q;      // the actual drop of the weighted error
        if (g > bestGain) { bestGain = g; best = { ai, x }; }
      }
      if (!best) break;
      const a = aims[best.ai];
      addStamp(G, R, refSt, a.i, a.j, best.x);
      picks.push({ i: a.i, j: a.j, x: best.x, z: a.z, pi: -1 });
      Scw = reweight();
      Sr = Sres();
      if (tools && tools.progress) tools.progress(0.5 * n / nTake);
    }
    if (!picks.length) return { surfaces: [], intent: [], notes: ['the painting is already satisfied by the LED alone'] };

    // ---- phase 2: give every stamp a plate, brightest demand ← biggest aperture ---------------
    const order = plates.map((p, k) => k).sort((a, b) =>
      stampAt(plates[a], picks[0].z).W - stampAt(plates[b], picks[0].z).W);      // sharpest image first
    const demandSort = picks.map((p, k) => k).sort((a, b) => picks[b].x - picks[a].x);
    for (let q = 0; q < Math.min(picks.length, order.length); q++) picks[demandSort[q]].pi = order[q];
    for (let q = order.length; q < picks.length; q++) picks[q].pi = order.length ? order[q % order.length] : -1;

    // ---- phase 3: coordinate-descent polish (each stamp re-aims and re-levels) ---------------
    const passes = Math.max(0, Math.round(+settings.polish || 0));
    for (let pass = 0; pass < passes; pass++) {
      for (let k = 0; k < picks.length; k++) {
        const pk = picks[k], pl = plates[pk.pi];
        if (!pl) { pk.x = 0; continue; }
        const st = stampAt(pl, pk.z);
        const cap = levelOf(pl, st);
        // remove its current contribution
        addStamp(G, R, st, pk.i, pk.j, -pk.x);
        Scw = reweight();
        Sr = Sres();
        const sp = Math.max(1, Math.round(step));
        let bi = pk.i, bj = pk.j, bx = 0, bgain = 0;
        for (let dj = -sp; dj <= sp; dj++) for (let di = -sp; di <= sp; di++) {
          const i = pk.i + di, j = pk.j + dj;
          if (i < 0 || j < 0 || i >= R || j >= R) continue;
          const t = stampTerms(Sr, Scw, R, st, i, j);
          if (t.R >= 0) continue;
          const x = Math.min(-t.R / t.Q, cap);
          if (!(x > 0)) continue;
          const g = 2 * x * -t.R - x * x * t.Q;
          if (g > bgain) { bgain = g; bi = i; bj = j; bx = x; }
        }
        if (bgain <= 0) { bi = pk.i; bj = pk.j; bx = 0; }
        pk.i = bi; pk.j = bj; pk.x = bx; pk.z = Engine.targetUVtoWorld(T, -T.half + (bi + 0.5) * cell, -T.half + (bj + 0.5) * cell);
        addStamp(G, R, st, bi, bj, bx);
        Scw = reweight();
        Sr = Sres();
      }
      if (tools && tools.progress) tools.progress(0.5 + 0.5 * (pass + 1) / passes);
    }
    return { picks, G, obj: rect(Sr, R, 0, R, 0, R) };
    }

    // the level at which the plates, used flat out, exactly pay for the painting
    const levelScale = () => clamp(plates.reduce((a, pl) => a + plateFlux(pl, stampAt(pl, T.C)), 0) / maxLvl / Math.max(1e-9, demand) * clamp(+settings.light, 0.02, 4), 1e-12, 1e9);
    /* A facet whose beam runs into another facet delivers nothing but still costs a facet, so the
     * design is fitted, the beams are checked against one another (pure geometry), the dead plates
     * are dropped and the survivors are re-fitted to fill the holes they leave.                      */
    const seated = (fk) => {
      for (let k = 0; k < fk.picks.length; k++) {
        const pl = plates[fk.picks[k].pi];
        if (!pl) continue;
        const st = stampAt(pl, fk.picks[k].z);
        const side = pl.side * Math.sqrt(Math.max(1e-6, Math.min(1, fk.picks[k].x / Math.max(1e-12, levelOf(pl, st)))));
        placePlate(pl, depthFor(side));
      }
    };
    const sizeUp = (fk) => {
      const out = [];
      for (let k = 0; k < fk.picks.length; k++) {
        const pk = fk.picks[k], pl = plates[pk.pi];
        if (!pl) continue;
        const st = stampAt(pl, pk.z), cap = levelOf(pl, st);
        const x = Math.min(pk.x, cap);
        if (!(x > 0) || !(cap > 0)) continue;
        const side = pl.side * Math.sqrt(x / cap);                  // area ∝ side²
        if (!(side > 1e-6)) continue;
        out.push({ pl, st, x, side, i: pk.i, j: pk.j, z: pk.z, pi: pk.pi, P: pl.p.slice(), h: 0.5 * side, ex: null, surf: null });
      }
      return out;
    };
    /* Seat a plate on its wall: turn its square so one edge lies along the wall normal (least depth
     * needed), then push it in by exactly that much, so the whole curved patch sits just inside.  */
    const seat = (b) => {
      const nrm = V.norm(V.add(V.norm(V.sub(S, b.pl.p)), V.norm(V.sub(b.z, b.pl.p))));
      const ref = wallRef(nrm, b.pl.nIn);
      b.P = V.madd(b.pl.Q, b.pl.nIn, margin + b.h * plateDepth(nrm, ref, b.pl.nIn));
      b.ex = V.inPlane(nrm, ref);
      b.ref = ref;
      b.surf = {
        type: 'facet', id: 'fx', group: 'A', P: b.P.slice(), S0: S.slice(), Z: b.z.slice(), flat: false,
        di: V.dist(b.P, b.z), clip: { kind: 'poly', ref: ref.slice(), pts3: platePts(b.P, S, b.z, b.h, ref) },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      };
      return b;
    };
    let fit = runFit(levelScale()), built = sizeUp(fit);
    const maxRounds = Math.max(0, Math.min(6, Math.round(settings.recheck === undefined ? 3 : +settings.recheck)));
    let deadCount = 0;
    for (let round = 0; round < maxRounds; round++) {
      if (built.length < 4) break;
      for (const b of built) seat(b);
      const dead = beamDead(built);
      if (!dead.length) break;
      deadCount += dead.length;
      const keep = plates.filter((pl) => dead.indexOf(pl) < 0);
      if (keep.length < 4) break;
      plates = keep;
      fit = runFit(levelScale());
      if (!fit.picks.length) break;
      seated(fit);
      built = sizeUp(fit);
    }
    if (!built.length) return { surfaces: [], intent: [], notes: ['no facet got a usable level'] };
    const picks = fit.picks, G = fit.G;
    if (deadCount) notes.push(deadCount + ' plate positions dropped: another facet stood in their beam');

    const surfaces = [], live = [];
    for (let k = 0; k < built.length && surfaces.length < N; k++) {
      const b = seat(built[k]);
      // the largest half-side that keeps the WHOLE mirror (sag included) inside the envelope and
      // clear of the LED — the app's own compile+outline test, so nothing can come back a violation
      b.h = fitSide(b.surf, env, S, keep, 0.5 * b.side);
      if (!(b.h > 1e-6)) continue;
      b.surf.clip.pts3 = platePts(b.P, S, b.z, b.h, b.ref);
      b.surf.id = 'f' + surfaces.length;
      surfaces.push(b.surf);
      live.push(b);
    }

    // ---- intent ----------------------------------------------------------------------------
    const covered = new Float64Array(R * R);
    const intent = [];
    for (let k = 0; k < surfaces.length; k++) {
      const b = live[k], cells = [];
      const rad = Math.ceil(b.st.W / cell) + 1;
      for (let j = Math.max(0, b.j - rad); j <= Math.min(R - 1, b.j + rad); j++) for (let i = Math.max(0, b.i - rad); i <= Math.min(R - 1, b.i + rad); i++) {
        const du = Math.max(0, Math.abs(i - b.i) - 0.5 * b.st.W / cell), dv = Math.max(0, Math.abs(j - b.j) - 0.5 * b.st.W / cell);
        if (Math.hypot(du, dv) > 1.1) continue;
        const kk = j * R + i;
        if (p01[kk] > 0) cells.push([kk, p01[kk]]);
        covered[kk] += p01[kk];
      }
      intent.push({ facet: surfaces[k].id, cells });
    }
    const missed = [];
    for (let k = 0; k < R * R; k++) if (p01[k] > 0 && covered[k] < 0.02) missed.push([k, 1]);
    if (missed.length) intent.push({ facet: null, cells: missed });

    notes.push(surfaces.length + ' facets; stamp ' + Math.min.apply(null, live.map((b) => b.st.W)).toFixed(0) + '–' +
      Math.max.apply(null, live.map((b) => b.st.W)).toFixed(0) +
      ' mm; r ' + Math.min.apply(null, plates.map((p) => p.r)).toFixed(0) + '–' + rTop.toFixed(0) + ' mm; fit level ' + levelScale().toFixed(3) +
      ' of the paint; ' + missed.length + ' painted cells had no facet aimed at them');
    return { surfaces, intent, notes };
  }
  function platePts(P, S, Z, h, ref) {
    const n = V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Z, P))));
    const ex = V.inPlane(n, ref || LED_AXIS), ey = V.cross(n, ex);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
      P[0] + ex[0] * a * h + ey[0] * b * h,
      P[1] + ex[1] * a * h + ey[1] * b * h,
      P[2] + ex[2] * a * h + ey[2] * b * h]);
  }
  const LED_AXIS = [0, 0, 1];
  /* A square plate of half-size h leaning by α on a wall with inward normal nIn sticks out of the
   * wall by h·(|ex·nIn| + |ey·nIn|); rotating the square so that one of its edges lies along the
   * wall's normal plane minimises that to h·sin α.  wallRef picks that orientation.                */
  function plateDepth(n, ref, nIn) {
    const ex = V.inPlane(n, ref), ey = V.cross(n, ex);
    return Math.abs(V.dot(ex, nIn)) + Math.abs(V.dot(ey, nIn));
  }
  function wallRef(n, nIn) {
    const m = V.sub(nIn, V.mul(n, V.dot(nIn, n)));              // the wall normal inside the plate
    return V.len(m) > 1e-9 ? m : [0, 0, 1];
  }
  /* Largest plate half-side ≤ h0 whose whole outline (curvature included) is inside the envelope and
   * outside the LED clearance.  It runs the app's own compile + outline, so it cannot disagree.    */
  /* Which of these plates deliver nothing because another plate stands in their beam?  A beam is a
   * straight line from a point of the mirror to its aim point; we test a 3x3 sample of the mirror
   * against the other mirrors.  Pure intersection geometry - the same routine the tracer uses, but
   * on our own geometry, and as a design clearance test rather than a search.                        */
  function beamDead(recs) {
    const out = [];
    const Cs = recs.map((r) => { try { return Geo.compile([r.surf]); } catch (e) { return null; } });
    for (let i = 0; i < recs.length; i++) {
      const a = recs[i], ah = V.norm(V.sub(a.z, a.P));
      const ex = a.ex, ey = V.cross(ah, ex), tmax = V.dist(a.P, a.z);
      let hit = 0, n = 0;
      for (let u = -0.75; u <= 0.751; u += 0.75) for (let v = -0.75; v <= 0.751; v += 0.75) {
        const p = [a.P[0] + ex[0] * a.h * u + ey[0] * a.h * v, a.P[1] + ex[1] * a.h * u + ey[1] * a.h * v, a.P[2] + ex[2] * a.h * u + ey[2] * a.h * v];
        n++;
        for (let j = 0; j < recs.length; j++) {
          if (j === i || !Cs[j]) continue;
          const b = recs[j];
          const w = V.sub(b.P, p), t = V.dot(w, ah);
          if (t <= 1e-6) continue;
          if (V.len(V.sub(w, V.mul(ah, t))) > a.h + b.h + 1.5) continue;
          if (Geo.intersect(Cs[j].D, Cs[j].poly, 0, p[0], p[1], p[2], ah[0], ah[1], ah[2], 1e-7, tmax) >= 0) { hit++; break; }
        }
      }
      if (n && hit / n > 0.6) out.push(a.pl);
    }
    return out;
  }
  function fitSide(surf, env, S, keep, h0) {
    const tol = 1e-6 * Math.max.apply(null, env.half);
    const fits = (h) => {
      if (!(h > 1e-9)) return false;
      surf.clip.pts3 = platePts(surf.P, S, surf.Z, h, surf.clip.ref);
      let C;
      try { C = Geo.compile([surf]); } catch (e) { return false; }
      for (const poly of Geo.outline(C, 0)) for (const p of poly) {
        if (!Geo.envInside(env, p, tol)) return false;
        if (keep > 0 && V.dist(p, S) < keep * (1 - 1e-6)) return false;
      }
      return true;
    };
    if (fits(h0)) return h0;
    let lo = 0, hi = h0;
    for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  /* N plate positions, blue-noise spread (so no facet can shadow another: a plate of side s at
   * radius r subtends s/r, so two plates must be at least about s apart) weighted by how much flux
   * each spot of boundary receives — a farthest-point selection on  minSeparation · sqrt(ρ) .       */
  function spreadPlates(pool, N, fill) {
    const out = [];
    if (!pool.length) return out;
    const n = pool.length;
    const w = new Float64Array(n);
    let wmax = 0;
    for (let i = 0; i < n; i++) { if (pool[i].rho > wmax) wmax = pool[i].rho; }
    if (!(wmax > 0)) return out;
    for (let i = 0; i < n; i++) w[i] = pool[i].rho / wmax;
    const dmin = new Float64Array(n).fill(Infinity);
    const take = new Uint8Array(n);
    const eff = (A, B) => {
      const dl = Math.hypot(A.lat[0] - B.lat[0], A.lat[1] - B.lat[1]);
      return Math.min(dl, V.dist(A.p, B.p));      // shadowing and blocking both care about the nearer of the two
    };
    for (let k = 0; k < N; k++) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < n; i++) {
        if (take[i]) continue;
        const sep = Math.min(dmin[i], pool[i].room);
        if (!(sep > 1e-9)) continue;
        const sc2 = sep * sep * (0.02 + w[i]);
        if (sc2 > bestScore) { bestScore = sc2; best = i; }
      }
      if (best < 0) break;
      take[best] = 1;
      out.push(pool[best]);
      for (let i = 0; i < n; i++) { const d = eff(pool[i], pool[best]); if (d < dmin[i]) dmin[i] = d; }
    }
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      let sep = Infinity;
      for (let m = 0; m < out.length; m++) if (m !== k) sep = Math.min(sep, eff(c, out[m]));
      if (!isFinite(sep)) sep = c.room;
      c.sep = sep;
      c.side = Math.max(1e-4, Math.min(fill * sep, 2 * c.room));
    }
    return out;
  }

  RF.Solvers.register({
    id: 'flux-painter', name: 'Static paint-fitting reflector', version: '1.0', modes: ['paint'],
    settings: SETTINGS, solve,
  });
})();
})();
