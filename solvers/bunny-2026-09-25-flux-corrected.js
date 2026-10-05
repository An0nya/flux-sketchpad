/* Bundled model solver: space-bunny-alpha, Flux solver benchmark run 2026-09-25 (workspace work-space-bunny-alpha-flux-solver-20260925-2110).
 * Copied verbatim from that run's solvers/solver.js (sha256 5e65fcbe5fd0…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote.
 * Exception (2026-10-05): display-only tools.preview calls added for Watch solve (show() in measure). */
(function () {
/* solvers/solver.js — "measure-and-correct" reflector solver (paint mode).
 *
 * The built-in solver (RF.ModeA) is a good *seed*: exact solid-angle flux accounting, each spoke's
 * curve fitted inside the envelope, every facet curved to match its zone.  What it cannot know is
 * what the ray tracer then does with that geometry — the delivered field is a blurred, mis-centred
 * version of the paint, and that is the uniformity and coverage we measure (U₀ ≈ 0.47 against a
 * noise ceiling of 0.8).
 *
 * The blur itself is not a tuning mistake, it is the geometry: a facet's tile size and the flux it
 * catches both scale with its solid angle, so nothing inside the envelope can sharpen the pattern
 * (see NOTES.md).  What *is* free is where the flux goes, and that is what this solver searches,
 * on the real engine, scoring every candidate with tools.trace:
 *   1. structure — rebuild the seed for a few paint contrasts (paint**γ); γ = 1 is the as-painted
 *      design, so the search can only leave it if the measurement says so;
 *   2. a coarse grid, then a pattern search, over an affine of the aim pattern: a scale λ about the
 *      paint centroid (λ > 1 spreads the flux outwards, which is what a hard-edged paint under a blur
 *      wants) and a shift (the delivered field's centre of mass is not the painted one on an
 *      asymmetric reflector);
 *   3. re-measure the best few candidates with the full ray budget on the scene's own seed — the
 *      same estimator the app scores with — and ship the winner of that;
 *   4. validate the result exactly as RF.Solvers.verify does, on the compiled geometry, and re-cut
 *      or drop any facet left inside the envelope or the LED clearance.
 *
 * An earlier version fitted every facet individually to the traced field through the tile model
 * (Gauss–Newton on aim and tile size).  It is gone: it measured worse every time, for reasons
 * recorded in NOTES.md.
 *
 * Deterministic: no RNG anywhere, and the amount of search comes from settings, not the clock (the
 * wall-clock guard only ever stops it early, and is set far above the normal cost).  Both the host's
 * ray budget and its time budget are tracked and respected.
 */
(function () {
  'use strict';
  var RF = globalThis.RF;
  var V = RF.V, Geo = RF.Geo, Solver = RF.Solver, Engine = RF.Engine;
  // the app stops a solve that runs over its wall-clock or ray budget, so both are spent explicitly
  var now = (typeof performance !== 'undefined' && performance.now) ? function () { return performance.now(); }
                                                             : function () { return Date.now(); };
  var D2R = Math.PI / 180;

  // ------------------------------------------------------------------ 3×3 symmetric solve
  /* A is row-major [a00 a01 a02; a10 a11 a12; a20 a21 a22], symmetric.  Gaussian elimination with
   * partial pivoting on the 3×4 augmented system [A | b] (stride 4).                           */
  function solveSym3(A, b) {
    var M = [A[0], A[1], A[2], b[0], A[3], A[4], A[5], b[1], A[6], A[7], A[8], b[2]];
    for (var c = 0; c < 3; c++) {
      var p = c;
      for (var r = c + 1; r < 3; r++) if (Math.abs(M[4 * r + c]) > Math.abs(M[4 * p + c])) p = r;
      if (Math.abs(M[4 * p + c]) < 1e-300) return null;
      if (p !== c) for (var q = 0; q < 4; q++) { var t = M[4 * c + q]; M[4 * c + q] = M[4 * p + q]; M[4 * p + q] = t; }
      var piv = M[4 * c + c];
      for (var r2 = c + 1; r2 < 3; r2++) {
        var f = M[4 * r2 + c] / piv;
        if (!f) continue;
        for (var q2 = c; q2 < 4; q2++) M[4 * r2 + q2] -= f * M[4 * c + q2];
      }
    }
    var x = [0, 0, 0];
    for (var r3 = 2; r3 >= 0; r3--) {
      var acc = M[4 * r3 + 3];
      for (var q3 = r3 + 1; q3 < 3; q3++) acc -= M[4 * r3 + q3] * x[q3];
      x[r3] = acc / M[4 * r3 + r3];
    }
    return x;
  }

  // ------------------------------------------------------------------ rebuild one facet
  /* A facet is (P, S0, Z, di) plus the four directions from the source that its aperture corners
   * subtend.  Re-aiming (new Z) or re-curving (new di) keeps the same solid angle — hence the same
   * flux share — and we re-solve the corner rays on the new quadric.  If the result leaves the
   * envelope or the LED clearance, the aperture is shrunk (corner directions pulled toward the chief
   * direction); if even that fails the change is rejected and the facet keeps its previous pose.   */
  function buildFacet(f, Z, di) {
    for (var shrink = 1; shrink >= 0.6; shrink *= 0.93) {
      var dirs = f.dirs, i;
      if (shrink < 1) {
        dirs = f.dirs.map(function (d) {
          return V.norm([f.cdir[0] + (d[0] - f.cdir[0]) * shrink,
                         f.cdir[1] + (d[1] - f.cdir[1]) * shrink,
                         f.cdir[2] + (d[2] - f.cdir[2]) * shrink]);
        });
      }
      var fq = di === null ? Geo.facetQuadric(f.P, f.S0, Z, null) : Geo.facetQuadric(f.P, f.S0, Z, di);
      var k = V.dot(fq.n, V.sub(f.P, f.S0));
      var pts3 = [], ok = true;
      for (i = 0; i < dirs.length; i++) {
        var p = null;
        if (di === null) {
          var den = V.dot(fq.n, dirs[i]);
          if (den < 0) p = V.madd(f.S0, dirs[i], k / den);
        } else {
          var roots = Geo.quadricRay(fq.A, fq.b, f.P, f.S0, dirs[i]).filter(function (t) { return t > 0; });
          if (roots.length) {
            var want = f.edgeR[i];
            p = V.madd(f.S0, dirs[i], roots.reduce(function (m, t) { return Math.abs(t - want) < Math.abs(m - want) ? t : m; }, Infinity));
          }
        }
        if (!p || !isFinite(p[0] + p[1] + p[2])) { ok = false; break; }
        pts3.push(p);
      }
      if (!ok) continue;
      if (!legal(f, fq, pts3)) continue;
      return { pts3: pts3, di: di };
    }
    return null;
  }

  /* Legality is checked on the REAL surface, the way the app checks it: the clip polygon's corners
   * are not enough — a curved facet bulges away from its chordal edges.  So the polygon is mapped
   * into the facet's own (ex, ey) frame, its edges are sampled, and every sample is projected back
   * onto the quadric (RF.Solver.surfPoint) before the envelope and the LED clearance are tested.  */
  /* Legality, tested the way RF.Solvers.verify tests it.
   *
   * verify walks the facet's *outline polygon* (a tessellation of the clip on the real surface), fans
   * samples over it, and for each sample either takes the ray hit on the real surface or — if the ray
   * misses — the sample's own distance; that value is compared with the LED clearance, and every
   * outline point is checked against the envelope.  Three things follow, and all three are easy to
   * get wrong:
   *   · a *curved* facet is convex toward the LED, so chords between outline points cut inside the
   *     surface and can be nearer to the LED than any surface point.  The clearance test here is
   *     the ray on the real surface; the chords are settled exactly, on the compiled outline, by
   *     the final validation pass (validateAndRepair) below;
   *   · the surface bulges outside the chordal polygon, so the surface points must be inside the
   *     envelope even when the chords are;
   *   · the corners alone are not enough: the facet's interior can dip inside the clearance.
   * The clearance ray test is skipped when a conservative bound (distance to P minus the facet's own
   * radius) already proves the facet is clear, which is the usual case and keeps this cheap.     */
  function legal(f, fq, pts3) {
    var env = f.env, keep = f.keep, S0 = f.S0, P = f.P, i, a, b;
    var dP = V.dist(P, S0);
    if (!Geo.envInside(env, P, -1e-9) || dP < keep * (1 + 1e-9)) return false;
    var fr = Solver.facetFrame(fq, null), ex = fr.ex, ey = fr.ey, n = pts3.length;
    var R = 0;
    for (i = 0; i < n; i++) R = Math.max(R, V.dist(pts3[i], P));
    var needRay = dP - R <= keep * 1.02;          // only then can anything be inside the clearance
    var guard = keep > 0 ? keep * (1 + 1e-4) : 0;
    var c3 = [0, 0, 0];
    for (i = 0; i < n; i++) c3 = V.add(c3, V.mul(pts3[i], 1 / n));
    var kPlane = fq.flat ? V.dot(fq.n, V.sub(P, S0)) : 0;

    function check(q) {
      if (!Geo.envInside(env, q, 1e-7)) return false;                       // the chord
      var d = V.sub(q, P);
      var X = fq.flat ? q : surfAt(fq, P, ex, ey, V.dot(d, ex), V.dot(d, ey));
      if (!X || !isFinite(X[0] + X[1] + X[2])) return false;
      if (!Geo.envInside(env, X, 1e-7)) return false;                       // the surface above it
      if (!needRay) return true;
      var dir = V.sub(q, S0), len = V.len(dir);
      if (!(len > 0)) return true;
      dir = V.mul(dir, 1 / len);
      var t;
      if (fq.flat) { var den = V.dot(fq.n, dir); if (den >= 0) return false; t = kPlane / den; }
      else {
        var roots = Geo.quadricRay(fq.A, fq.b, P, S0, dir).filter(function (r) { return r > 0; });
        if (!roots.length) return false;
        t = Math.min.apply(null, roots);
      }
      return t >= guard;
    }
    var M = 4;
    for (i = 0; i < n; i++) {
      var p1 = pts3[i], p2 = pts3[(i + 1) % n];
      for (a = 0; a <= M; a++)                                            // the edges
        if (!check([p1[0] + (p2[0] - p1[0]) * a / M, p1[1] + (p2[1] - p1[1]) * a / M, p1[2] + (p2[2] - p1[2]) * a / M])) return false;
      for (a = 0; a <= M; a++) for (b = 0; a + b <= M; b++)                // and the interior
        if (!check(V.add(c3, V.add(V.mul(V.sub(p1, c3), a / M), V.mul(V.sub(p2, c3), b / M))))) return false;
    }
    return true;
  }
  /* a point of the facet's real (possibly curved) surface, from its coordinates in the facet frame */
  function surfAt(fq, P, ex, ey, x, y) {
    if (fq.flat) return [P[0] + ex[0] * x + ey[0] * y, P[1] + ex[1] * x + ey[1] * y, P[2] + ex[2] * x + ey[2] * y];
    var sp = Solver.surfPoint(fq, P, ex, ey, x, y);
    return sp ? sp.X : null;
  }

  // ------------------------------------------------------------------ one facet's footprint
  function apertureOf(f) {
    var fq = Geo.facetQuadric(f.P, f.S0, f.Z, f.flat ? null : f.di);
    var fr = Solver.facetFrame(fq, null);
    return Solver.apertureCov({ kind: 'poly', pts3: f.pts3 }, f.P, fr.ex, fr.ey);
  }
  /* Landing centre on the target, its covariance and its inverse.  Falls back to a flat facet if the
   * curved one cannot be evaluated.  */
  function footprint(f, T, src) {
    var apCov = apertureOf(f);
    var m = Solver.tileModel(T, src, { P: f.P, S0: f.S0, Z: f.Z, flat: f.flat, di: f.flat ? null : f.di, apCov: apCov });
    if (!m.ok) {
      m = Solver.tileModel(T, src, { P: f.P, S0: f.S0, Z: f.Z, flat: true, apCov: apCov });
      if (!m.ok) return null;
      f.flat = true; f.di = null;
    }
    var c = m.cov, det = c[0] * c[2] - c[1] * c[1];
    if (!(det > 1e-24) || !isFinite(det)) return null;
    return { c: m.center, cov: c, inv: [c[2] / det, -c[1] / det, c[0] / det], sigma: m.sigma, minSigma: m.sigmaS };
  }

  function ratioRaw(G, T01, rp, tot) {
    var out = new Float64Array(rp * rp);
    for (var k = 0; k < rp * rp; k++) out[k] = T01[k] > 0 ? G[k] / tot / T01[k] : 0;
    return out;
  }

  /* the ratio field (delivered/intended per painted cell), smoothed over the paint grid */
  function smoothRatio(G, T01, rp, tot, sCells) {
    var rad = Math.max(1, Math.ceil(2.5 * sCells)), ker = new Float64Array(2 * rad + 1), k0 = 0, i;
    for (i = -rad; i <= rad; i++) { ker[i + rad] = Math.exp(-0.5 * (i / sCells) * (i / sCells)); k0 += ker[i + rad]; }
    for (i = 0; i < ker.length; i++) ker[i] /= k0;
    var raw = ratioRaw(G, T01, rp, tot);
    var tmp = new Float64Array(rp * rp), out = new Float64Array(rp * rp);
    var a, b, acc, j, i2;
    for (j = 0; j < rp; j++) for (i2 = 0; i2 < rp; i2++) {
      acc = 0;
      for (a = -rad; a <= rad; a++) { b = i2 + a; if (b < 0 || b >= rp) continue; acc += ker[a + rad] * raw[j * rp + b]; }
      tmp[j * rp + i2] = acc;
    }
    for (i2 = 0; i2 < rp; i2++) for (j = 0; j < rp; j++) {
      acc = 0;
      for (a = -rad; a <= rad; a++) { b = j + a; if (b < 0 || b >= rp) continue; acc += ker[a + rad] * tmp[b * rp + i2]; }
      out[j * rp + i2] = acc;
    }
    return out;
  }

  RF.Solvers.register({
    id: 'flux-corrected',
    name: 'Flux: measure & correct',
    version: '1.0',
    modes: ['paint'],
    settings: [
      { key: 'budget', label: 'Facet budget', type: 'range', min: 1, max: 2000, step: 1, default: 100 },
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, max: 500, step: 1, default: 0, help: 'keep every facet at least this far from the LED; the envelope LED clearance (input.envelope.keepOut) is a separate hard limit' },
      { key: 'reflectivity', label: 'Reflectivity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.9 },
      { key: 'rounds', label: 'Search rounds', type: 'range', min: 1, max: 12, step: 1, default: 7, help: 'pattern-search rounds over the aim scale and shift' },
      { key: 'contrast', label: 'Paint contrasts', type: 'number', min: 0, max: 8, step: 0.1, default: 3.5, help: 'highest paint**γ contrast tried for the flux partition (γ = 1 is the as-painted design)' },
      { key: 'rays', label: 'Rays per candidate', type: 'range', min: 4000, max: 400000, step: 4000, default: 80000, help: 'ray count for every traced candidate (same seed ⇒ common random numbers)' },
      { key: 'covW', label: 'Coverage weight', type: 'number', min: 0, max: 2, step: 0.05, default: 0.25, help: 'how much beam coverage counts next to U₀' },
      { key: 'delW', label: 'Delivered weight', type: 'number', min: 0, max: 2, step: 0.05, default: 0.25, help: 'how much delivered light counts next to U₀' },
      { key: 'peakW', label: 'Peak weight', type: 'number', min: 0, max: 2, step: 0.05, default: 0.15, help: 'how much peak intensity counts next to U₀' },
      { key: 'blkW', label: 'Blocked-light weight', type: 'number', min: 0, max: 2, step: 0.05, default: 0, help: 'penalty on facet light that lands on another facet instead of the target' },
      { key: 'vote', label: 'Traces per candidate', type: 'range', min: 1, max: 4, step: 1, default: 2, help: 'traces averaged per candidate (fixed seeds) — more averaging, steadier ranking' },
      { key: 'smooth', label: 'Ranking smoothing (cells)', type: 'number', min: 0, max: 4, step: 0.1, default: 0, help: 'smooth the ratio field before ranking candidates; 0 scores the raw grid exactly as the app does' },
      { key: 'finalRays', label: 'Rays for the final check', type: 'range', min: 4000, max: 400000, step: 4000, default: 200000 },
    ],

    solve: function (input, s, tools) {
      var notes = [];
      var src = input.source, env = input.envelope;
      var T = Engine.designFrame(input.target);
      var rp = input.paint.res, paint = input.paint.cells;
      var budget = Math.max(1, Math.min(2000, s.budget | 0));
      var keep = Math.max(env.keepOut || 0, s.minDistance || 0, 1.5 * RF.Source.boundingRadius(src));
      var refl = Math.max(0, Math.min(1, +s.reflectivity));
      var SIG = 3;

      // ---- the painted field, normalised, and its centroid
      var sum = 0, k;
      for (k = 0; k < rp * rp; k++) if (paint[k] > 0) sum += paint[k];
      if (!(sum > 0)) return { surfaces: [], intent: [], notes: ['nothing painted'] };
      var T01 = new Float64Array(rp * rp);
      for (k = 0; k < rp * rp; k++) T01[k] = paint[k] > 0 ? paint[k] / sum : 0;
      var cellU = new Float64Array(rp * rp), cellV = new Float64Array(rp * rp);
      for (k = 0; k < rp * rp; k++) { var cij = Engine.cellCenter(T, k % rp, (k / rp) | 0); cellU[k] = cij[0]; cellV[k] = cij[1]; }
      var cu = 0, cv = 0;
      for (k = 0; k < rp * rp; k++) { cu += T01[k] * cellU[k]; cv += T01[k] * cellV[k]; }

      // ---- how much of a facet's tile covers a paint cell (used to report per-facet intent)
      function kernel(f, id) {
        var du = cellU[id] - f.c[0], dv = cellV[id] - f.c[1];
        var q = du * (f.inv[0] * du + f.inv[1] * dv) + dv * (f.inv[1] * du + f.inv[2] * dv);
        return q <= SIG * SIG ? Math.exp(-0.5 * q) : 0;
      }

      function lists() {                                 // cells each facet's tile reaches
        return facets.map(function (f) {
          var rad = Math.ceil(SIG * f.sigma / T.half * rp) + 1;
          var ci = Math.round((f.c[0] + T.half) / (2 * T.half) * rp), cj = Math.round((f.c[1] + T.half) / (2 * T.half) * rp);
          var out = [];
          for (var j = Math.max(0, cj - rad); j <= Math.min(rp - 1, cj + rad); j++)
            for (var i2 = Math.max(0, ci - rad); i2 <= Math.min(rp - 1, ci + rad); i2++) {
              var id = j * rp + i2;
              if (kernel(f, id) > 0) out.push(id);
            }
          return out;
        });
      }

      // ---- turn a ModeA design into solver facet records
      function buildFacets(gen) {
        var out = [], nDrop = 0;
        for (var i = 0; i < gen.surfaces.length; i++) {
          var sf = gen.surfaces[i];
          if (!sf.clip || sf.clip.kind !== 'poly' || sf.clip.pts3.length < 3) continue;
          var f = {
            id: sf.id, P: sf.P.slice(), S0: sf.S0.slice(), Z: sf.Z.slice(),
            flat: false, di: sf.di, sc: 1,
            dirs: sf.clip.pts3.map(function (p) { return V.norm(V.sub(p, sf.S0)); }),
            edgeR: sf.clip.pts3.map(function (p) { return V.dist(p, sf.S0); }),
            pts3: sf.clip.pts3.map(function (p) { return p.slice(); }),
            cdir: V.norm(V.sub(sf.P, sf.S0)),
            env: env, keep: keep, w: (sf.info && sf.info.flux) || 0,
            c: [0, 0], inv: [1, 0, 1], sigma: 1, minSigma: 0, aim: [0, 0], aim0: [0, 0],
          };
          // the seed is checked with the same strict test the app uses (ModeA only tests the four
          // corners, and a steeply tilted facet can dip inside the LED clearance between them);
          // buildFacet shrinks the aperture until it is legal, or the facet is dropped
          var b0 = buildFacet(f, f.Z, sf.flat ? null : sf.di);
          if (!b0) { nDrop++; continue; }
          f.pts3 = b0.pts3; f.di = b0.di; f.flat = b0.di === null;
          var fp = footprint(f, T, src);
          if (!fp) { nDrop++; continue; }
          f.c = fp.c; f.inv = fp.inv; f.sigma = fp.sigma; f.minSigma = fp.minSigma;
          var a = Engine.worldToTargetUV(T, f.Z);
          f.aim = [a[0], a[1]]; f.aim0 = [a[0], a[1]];
          out.push(f);
        }
        var ws = out.reduce(function (a, x) { return a + x.w; }, 0);
        if (ws > 0) for (i = 0; i < out.length; i++) out[i].w /= ws;
        else for (i = 0; i < out.length; i++) out[i].w = 1 / Math.max(1, out.length);
        for (i = 0; i < out.length; i++) out[i].i = i;
        if (nDrop && !gen.report) gen.report = {};
        if (nDrop) gen.report.repaired = nDrop;
        return out;
      }
      // re-aim one facet to a target (u,v) on the design plane, keeping the geometry legal
      function applyAim(f, a) {
        var Z = Engine.targetUVtoWorld(T, a[0], a[1]), b = buildFacet(f, Z, f.flat ? null : f.di);
        if (!b) return false;
        f.Z = Z; f.pts3 = b.pts3; f.aim = [a[0], a[1]];
        var fp = footprint(f, T, src);
        if (!fp && !f.flat) {
          // the curved tile cannot be evaluated here: fall back to a flat facet, re-cut and re-checked
          f.flat = true; f.di = null;
          b = buildFacet(f, Z, null);
          if (!b) return false;
          f.pts3 = b.pts3;
          fp = footprint(f, T, src);
        }
        if (!fp) return false;
        f.c = fp.c; f.inv = fp.inv; f.sigma = fp.sigma; f.minSigma = fp.minSigma;
        return true;
      }
      // ---- the objective, measured on the real engine: U₀ over the paint, plus beam coverage and
      // delivered light (both are traded against U₀ by explicit weights), plus a peak term so the
      // search does not buy uniformity by throwing the hot spot away.  Same seed every call, so
      // candidates differ by geometry, not by dice.
      var wCov = s.covW, wDel = s.delW, wPk = s.peakW, wBlk = s.blkW, pkRef = 0;
      var smoothC = Math.max(0, Math.min(4, +s.smooth || 0));   // 0 = score the raw grid, as the app does
      var spent = 0, rayCap = isFinite(tools.budget.rays) ? tools.budget.rays * 0.85 : Infinity;
      /* One measurement = `vote` traces on different (fixed) seeds, averaged cell by cell before
       * the statistics are read.  U₀ is a 5th percentile over a few thousand cells that hold a
       * handful of rays each, so a single trace's p05 is noisy at the ±0.03 level — larger than the
       * differences the search is choosing between.  Averaging the fields (not the statistics)
       * halves that, and the seeds are fixed, so it stays deterministic. */
      var vote = Math.max(1, Math.min(4, s.vote | 0 || 2));
      var perTrace = Math.max(2000, Math.round(searchRays / vote));
      // Watch solve (display only): each measured design, with the trace it already has, at most once a second.
      // Reads `facets` through surfacesOf (which copies nothing it changes), so the result is the same either way.
      var lastShow = 0, showLabel = 'seed';
      function show(tr) {
        if (!tools || !tools.preview || tools.preview.none) return;
        var t = Date.now(); if (t - lastShow < 1000) return; lastShow = t;
        try { tools.preview(surfacesOf(facets, refl), { label: showLabel, trace: tr, note: 'candidate measured on the real engine' }); } catch (e) { /* display only */ }
      }
      function measure(rayCount, votes) {
        var nv = votes || vote;
        var n = Math.max(2000, Math.round((rayCount || searchRays) / nv));
        if (spent + n * nv > rayCap) return null;                // never run the host out of rays
        spent += n * nv;
        var G = null, blk = 0, k2;
        for (var vI = 0; vI < nv; vI++) {
          var tr = tools.trace(surfacesOf(facets, refl), { rays: n, seed: (input.seed | 0) + 1013 * vI });
          var Gv = tr.res === rp ? Float64Array.from(tr.grid) : Engine.toPaintGrid(Float64Array.from(tr.grid), tr.res, rp);
          if (!G) { G = Gv; continue; }
          for (k2 = 0; k2 < rp * rp; k2++) G[k2] += Gv[k2];
        }
        show(tr);
        // light one facet caught that then landed on another (the tracer's re-hit share is the
        // solver-visible form of the app's "blocked")
        var e = tr.energy || {};
        blk = e.intercepted > 0 ? (e.reHit || 0) / e.intercepted : 0;
        var tot = 0, lit = [];
        for (k2 = 0; k2 < rp * rp; k2++) { tot += G[k2]; if (G[k2] > 0) lit.push(G[k2]); }
        if (!(tot > 0)) return null;
        var rat = [], mean = 0, k3;
        for (k3 = 0; k3 < rp * rp; k3++) if (paint[k3] > 0) { var r = G[k3] / tot / T01[k3]; rat.push(r); mean += r; }
        if (!rat.length) return null;
        mean /= rat.length;
        var sm = smoothC > 0 ? smoothRatio(G, T01, rp, tot, smoothC) : ratioRaw(G, T01, rp, tot);
        var cov = 0, k4;
        for (k4 = 0; k4 < rp * rp; k4++) if (paint[k4] > 0 && sm[k4] >= 0.5 * mean) cov++;
        rat = [];
        for (k4 = 0; k4 < rp * rp; k4++) if (paint[k4] > 0) rat.push(sm[k4]);
        rat.sort(function (a, b) { return a - b; });
        var u0 = Engine.pctl(rat, 0.05) / (mean || 1);
        var del = tot / src.power;
        lit.sort(function (a, b) { return a - b; });
        var pk = Engine.pctl(lit, 0.995);
        return { u0: u0, cov: cov / rat.length, del: del, pk: pk, blk: blk,
                 score: u0 + wCov * (cov / rat.length) + wDel * del + wPk * (pk / (pkRef || pk)) - wBlk * blk };
      }

      /* The app's own legality test, run here on the compiled geometry so a facet that ModeA or a
       * re-aim left inside the envelope or the LED clearance is caught and repaired before it ships.
       * This mirrors RF.Solvers.verify: the outline polygon, an edge fan per polygon, and the ray
       * from the LED measured on the real surface. */
      function validate(surfs) {
        var out = [], G;
        try { G = Geo.compile(surfs); } catch (e) { return out; }
        var S0 = src.pos, tol = 1e-6 * Math.max.apply(null, env.half), M = 4;
        for (var k = 0; k < G.n; k++) {
          var id = G.metas[k].id, outE = false, outK = false;
          for (var pi = 0; pi < G.poly.length; pi++) { /* clip polys are per surface; outline below */ }
          var polys = Geo.outline(G, k);
          for (var oi = 0; oi < polys.length; oi++) {
            var poly = polys[oi], i2, a2, b2;
            for (i2 = 0; i2 < poly.length; i2++) if (!Geo.envInside(env, poly[i2], tol)) { outE = true; break; }
            if ((env.keepOut || 0) <= 0) continue;
            var c = V.mul(poly.reduce(function (acc, q) { return V.add(acc, q); }, [0, 0, 0]), 1 / poly.length);
            for (i2 = 0; i2 < poly.length && !outK; i2++) {
              var p1 = poly[i2], p2 = poly[(i2 + 1) % poly.length];
              for (a2 = 0; a2 <= M && !outK; a2++) for (b2 = 0; a2 + b2 <= M; b2++) {
                var q2 = V.add(c, V.add(V.mul(V.sub(p1, c), a2 / M), V.mul(V.sub(p2, c), b2 / M)));
                var dq = V.norm(V.sub(q2, S0));
                var t = Geo.intersect(G.D, G.poly, k, S0[0], S0[1], S0[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
                if ((t >= 0 ? t : V.dist(q2, S0)) < (env.keepOut || 0) * (1 - 1e-6)) { outK = true; break; }
              }
            }
          }
          if (outE || outK) {
            var fi = -1;
            for (i2 = 0; i2 < facets.length; i2++) if (facets[i2].id === id) { fi = i2; break; }
            if (fi >= 0) out.push(fi);
          }
        }
        return out;
      }

      // ---- whole-design bookkeeping (the search may jump between structures, so a snapshot is the
      // whole facet list, not just a pose)
      function snapshot() {
        return facets.map(function (x) {
          var y = {};
          for (var p in x) {
            var val = x[p];
            y[p] = Array.isArray(val) ? val.slice() : (Array.isArray(val && val[0]) ? val.map(function (q) { return q.slice(); }) : val);
          }
          return y;
        });
      }
      function restore(sn) { facets = sn; }

      var t0 = now();
      var deadline = Math.min(isFinite(tools.budget.ms) ? tools.budget.ms * 0.7 : 1e9, 40000);
      var searchRays = Math.max(4000, Math.min(400000, s.rays | 0));
      var facets = null, bestFacets = null, best = null, nTrace = 0, shortlist = [], fallback = null, seedPk = 0, seedFacets = null;
      var SHORT = 6;                       // how many candidates the final re-measurement picks from
      function offer(m, snap) {
        best = m; bestFacets = snap;
        if (shortlist.length && shortlist[0].s >= m.score) return;
        var sn = snap || snapshot();
        shortlist.push({ s: m.score, snap: sn });
        shortlist.sort(function (a, b) { return b.s - a.s; });
        if (shortlist.length > SHORT) shortlist.length = SHORT;
      }
      function left() { return now() - t0 < deadline; }

      // ================================================================ phase 0: structure
      /* ModeA hands every facet a share of the painted flux.  With a real (blurred) image, the share
       * that best fills the paint is not proportional to the paint itself, so the seed is rebuilt
       * for a few *contrasts* of the paint — paint**γ — and the best structure is kept.  γ = 1 is
       * exactly the built-in design, so this can only move away from it if the measurement says so. */
      var gmax = Math.max(1, Math.min(8, +s.contrast || 1));
      var gset = {};
      [1, Math.sqrt(gmax), gmax, 1 / Math.sqrt(gmax), 1 / gmax].forEach(function (g) {
        if (isFinite(g) && g >= 0.05 && g <= gmax + 1e-9) gset[Math.round(g * 1e4)] = g;
      });
      var gammas = Object.keys(gset).map(function (q) { return gset[q]; }).sort(function (a, b) { return a - b; });
      for (var gi = 0; gi < gammas.length; gi++) {
        var gam = gammas[gi];
        var p2 = gam === 1 ? paint : paint.map(function (w) { return w > 0 ? Math.pow(w, gam) : 0; });
        var gen = RF.ModeA.generate({
          source: src, target: input.target, envelope: env,
          modeA: { paint: p2, budget: budget, facetType: 'curved', reflectivity: refl, minDistance: s.minDistance || 0 },
        });
        facets = buildFacets(gen);
        if (!facets.length) continue;
        if (!fallback) fallback = snapshot();               // in case nothing can be measured
        if (gam === 1 && !seedFacets) seedFacets = snapshot();   // the as-painted reference design
        showLabel = 'structure γ ' + (gi + 1) + '/' + gammas.length;
        var m0 = measure(searchRays);
        if (!m0) continue;
        nTrace++;
        if (!best || m0.score > best.score) offer(m0, snapshot());
        if (gam === 1) seedPk = m0.pk;      // the as-painted design is the peak reference
        if (gam === 1) {
          if (gen.report && gen.report.warnings && gen.report.warnings.length) notes.push('seed: ' + gen.report.warnings.join('; '));
          if (gen.report && gen.report.repaired) notes.push(gen.report.repaired + ' seed facet(s) were inside the envelope or the LED clearance and were shrunk or dropped');
        }
      }
      if (!bestFacets) {                                   // out of ray budget before anything measured
        if (!fallback) return { surfaces: [], intent: [], notes: ['no facet fits inside the envelope at least ' + keep.toFixed(1) + ' mm from the LED (check minDistance and the envelope)'] };
        bestFacets = fallback;
        notes.push('ray budget too small to measure candidates — the as-painted design is used');
      }
      restore(bestFacets);
      pkRef = seedPk;                        // the peak term is relative to the best structure found

      // ================================================================ phase 1: aim affine
      /* Where the pattern actually lands is set by the aim, and one global dof dominates: the scale
       * of the aim pattern about the paint centroid, plus a shift.  λ > 1 spreads the flux outwards,
       * which is what a hard-edged paint under a blur wants (its rim is dim and its core hot);
       * λ < 1 does the opposite.  The shift re-centres the *delivered* field, which is not the same
       * as the painted one on an asymmetric reflector.  A deterministic pattern search over
       * (λ, tu, tv), each candidate measured on the real engine. */
      var nReject = 0;
      function setAffine(l, a, b) {
        var n = 0;
        for (var i3 = 0; i3 < facets.length; i3++) {
          var f = facets[i3];
          var na = [cu + l * (f.aim0[0] - cu) + a, cv + l * (f.aim0[1] - cv) + b];
          if (applyAim(f, na)) n++;
          else { nReject++; f.aim0 = [(f.aim[0] - a - cu) / l + cu, (f.aim[1] - b - cv) / l + cv]; }
        }
        return n;
      }
      /* one trial of the pattern search: apply, measure, keep the design if it is the best so far */
      function tryAffineBatch(l, a, b, rays) {
        if (!setAffine(l, a, b)) return null;
        var m = measure(rays);
        nTrace++;
        if (m && (!best || m.score > best.score + 1e-4)) offer(m);
        else if (m) {
          var sn = snapshot();
          shortlist.push({ s: m.score, snap: sn });
          shortlist.sort(function (a, b) { return b.s - a.s; });
          if (shortlist.length > SHORT) shortlist.length = SHORT;
        }
        return m;
      }
      function trial(p) {
        if (!setAffine(p[0], p[1], p[2])) return null;
        var m = measure(searchRays);
        nTrace++;
        if (m && (!best || m.score > best.score + 1e-4)) offer(m);
        else if (m) {                                       // keep the field's best candidates
          var sn = snapshot();
          shortlist.push({ s: m.score, snap: sn });
          shortlist.sort(function (a, b) { return b.s - a.s; });
          if (shortlist.length > SHORT) shortlist.length = SHORT;
        }
        return m;
      }
      var FR = [-1, -0.5, 0, 0.5, 1], rounds = Math.max(1, Math.min(12, s.rounds | 0));
      var cur = [1, 0, 0], curScore = best.score;
      /* Stage A — a coarse grid over the two strong dof (aim scale × vertical shift).  A grid does
       * not commit to a direction on one noisy reading, which a pattern search does. */
      if (left()) {
        var gl = [0.7, 0.85, 1, 1.15, 1.35], gv = [-0.3, -0.15, 0, 0.15, 0.3], gridBest = null;
        for (var a1 = 0; a1 < gl.length; a1++) for (var b1 = 0; b1 < gv.length; b1++) {
          if (!left()) break;
          showLabel = 'aim grid ' + (a1 * gv.length + b1 + 1) + '/' + (gl.length * gv.length);
          var mg = tryAffineBatch(gl[a1], 0, gv[b1] * T.half, Math.round(searchRays / 2));
          if (mg && (!gridBest || mg.score > gridBest.score)) { gridBest = { p: [gl[a1], 0, gv[b1] * T.half], m: mg }; }
        }
        if (gridBest && gridBest.m.score > curScore) { cur = gridBest.p; curScore = gridBest.m.score; }
        setAffine(cur[0], cur[1], cur[2]);
      }
      /* Stage B — pattern-search refinement of (scale, v-shift, u-shift), shrinking steps. */
      for (var round = 0; round < rounds; round++) {
        if (!left()) { notes.push('pattern search stopped after ' + round + ' of ' + rounds + ' rounds — time budget'); break; }
        var st = T.half * 0.30 * Math.pow(0.62, round);            // shift step, mm on the target
        var sl = 0.22 * Math.pow(0.62, round);                     // relative scale step
        var axes = [[0, sl, 0], [2, st, 2], [1, st, 1]];           // [param, step, mode]
        for (var ax = 0; ax < axes.length; ax++) {
          var step = axes[ax][1], mode = axes[ax][2], pick = null;
          for (var fj = 0; fj < FR.length; fj++) {
            var p = cur.slice();
            if (mode === 0) p[0] = Math.max(0.2, Math.min(2.5, cur[0] * (1 + FR[fj] * step)));
            else p[mode] = cur[mode] + FR[fj] * step;
            showLabel = 'round ' + (round + 1) + '/' + rounds;
            var m = trial(p);
            if (m && (!pick || m.score > pick.m.score)) pick = { p: p, m: m };
          }
          if (pick && pick.m.score > curScore + 1e-4) { cur = pick.p; curScore = pick.m.score; }
          setAffine(cur[0], cur[1], cur[2]);                       // put the winning pose back on the facets
        }
        tools.progress(0.2 + 0.7 * (round + 1) / rounds);
      }
      // ---- the search ranks on a noisy U₀, so the few best designs are re-measured with more rays
      // and the winner of *that* is what ships.  Common random numbers, so it is still geometry.
      var finalRays = Math.max(searchRays, Math.min(400000, s.finalRays | 0 || 3 * searchRays));
      var fb = null, fbs = -Infinity;
      for (var q9 = 0; q9 < shortlist.length; q9++) {
        if (now() - t0 > deadline + 5000 || spent + finalRays > rayCap) break;
        restore(shortlist[q9].snap);
        // one trace on the scene's own seed at the full ray count: the same estimator the app
        // scores with, so the last choice is made on the scored quantity itself
        showLabel = 'final ' + (q9 + 1) + '/' + shortlist.length;
        var mf2 = measure(finalRays, 1);
        nTrace++;
        if (mf2 && mf2.score > fbs) { fbs = mf2.score; fb = shortlist[q9].snap; best = mf2; }
      }
      if (fb) bestFacets = fb; else restore(bestFacets);
      // the as-painted design, measured the same way, so the notes can say what changed
      var seedScore = null;
      if (seedFacets && spent + finalRays <= rayCap && now() - t0 <= deadline + 8000) {
        var keepBest = bestFacets;
        restore(seedFacets);
        showLabel = 'as-painted reference';
        seedScore = measure(finalRays, 1);
        restore(keepBest);
        nTrace++;
      }

      // ---- final validation, on the compiled geometry, exactly as RF.Solvers.verify measures it,
      // with a repair loop: a facet that is inside the envelope or the LED clearance has its
      // aperture shrunk (it keeps its aim, so it still lights its zone) until it is legal, and is
      // dropped if it cannot be.
      tools.progress(0.95);
      for (var pass2 = 0; pass2 < 4; pass2++) {
        var bad = validate(surfacesOf(facets, refl));
        if (!bad.length) break;
        for (var bi = 0; bi < bad.length; bi++) {
          var fb2 = facets[bad[bi]];
          var fixed = false;
          for (var sh = 0.85; sh >= 0.45 && !fixed; sh *= 0.8) {
            fb2.dirs = fb2.dirs.map(function (d) {
              return V.norm([fb2.cdir[0] + (d[0] - fb2.cdir[0]) * sh, fb2.cdir[1] + (d[1] - fb2.cdir[1]) * sh, fb2.cdir[2] + (d[2] - fb2.cdir[2]) * sh]);
            });
            var bb = buildFacet(fb2, fb2.Z, fb2.flat ? null : fb2.di);
            if (bb) { fb2.pts3 = bb.pts3; fixed = true; }
          }
          fb2.bad = !fixed;
        }
        facets = facets.filter(function (x) { return !x.bad; });
        for (var ri = 0; ri < facets.length; ri++) facets[ri].i = ri;
        if (bad.length) notes.push((bad.length) + ' facet(s) re-cut to fit the envelope and the LED clearance' +
          (pass2 === 3 ? ' (repair limit reached)' : ''));
      }

      // ================================================================ emit
      // (the facets carry the validation repairs — do not restore the pre-repair snapshot)
      // the affine that actually produced the emitted design (least squares over the facets)
      var num = 0, den = 0, tuF = 0, tvF = 0;
      for (var q8 = 0; q8 < facets.length; q8++) {
        var fg2 = facets[q8];
        num += (fg2.aim[0] - cu) * (fg2.aim0[0] - cu) + (fg2.aim[1] - cv) * (fg2.aim0[1] - cv);
        den += (fg2.aim0[0] - cu) * (fg2.aim0[0] - cu) + (fg2.aim0[1] - cv) * (fg2.aim0[1] - cv);
      }
      var lamF = den > 1e-6 ? num / den : 1;
      if (!(lamF > 0.2 && lamF < 2.5)) lamF = 1;      // too few facets to fit a scale to
      for (q8 = 0; q8 < facets.length; q8++) {
        tuF += fg2.aim[0] - cu - lamF * (fg2.aim0[0] - cu); tvF += fg2.aim[1] - cv - lamF * (fg2.aim0[1] - cv);
      }
      tuF /= Math.max(1, facets.length); tvF /= Math.max(1, facets.length);
      var idxE = lists();
      var surfaces = [], intent = [];
      for (var e = 0; e < facets.length && surfaces.length < budget; e++) {
        var fe = facets[e];
        surfaces.push({
          type: 'facet', id: fe.id, group: 'A', P: fe.P, S0: fe.S0, Z: fe.Z, flat: fe.flat,
          di: fe.flat ? null : fe.di, clip: { kind: 'poly', pts3: fe.pts3 },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
          info: { flux: fe.w, sigma: fe.sigma },
        });
        var listE = idxE[e], bestK = 0, b5;
        for (b5 = 0; b5 < listE.length; b5++) bestK = Math.max(bestK, kernel(fe, listE[b5]));
        var cellsOut = [];
        if (bestK > 0) for (b5 = 0; b5 < listE.length; b5++) {
          var idE = listE[b5];
          if (paint[idE] <= 0) continue;
          var gE = kernel(fe, idE) / bestK;
          if (gE > 0.1) cellsOut.push([idE, gE * paint[idE]]);
        }
        cellsOut.sort(function (x, y) { return y[1] - x[1]; });
        if (cellsOut.length > 600) cellsOut.length = 600;
        intent.push({ facet: fe.id, cells: cellsOut });
      }
      notes.push(facets.length + '/' + budget + ' facets · aim scale λ ' + lamF.toFixed(3) +
        ' shift (' + tuF.toFixed(1) + ', ' + tvF.toFixed(1) + ') mm · ' + nTrace +
        ' traced candidates in ' + Math.round(now() - t0) + ' ms');
      notes.push('measured: U₀ ' + best.u0.toFixed(3) + ', beam ' + (100 * best.cov).toFixed(1) +
        '%, delivered ' + (100 * best.del).toFixed(1) + '%, blocked ' + (100 * best.blk).toFixed(1) + '%' +
        (seedScore ? '  —  the as-painted design measures U₀ ' + seedScore.u0.toFixed(3) + ', beam ' +
          (100 * seedScore.cov).toFixed(1) + '%, delivered ' + (100 * seedScore.del).toFixed(1) +
          '%, peak ' + (best.pk / (seedScore.pk || best.pk)).toFixed(2) + '×' : ''));
      if (nReject) notes.push(nReject + ' re-aim(s) rejected: the geometry would leave the envelope or the LED clearance');
      return { surfaces: surfaces, intent: intent, notes: notes };
    },
  });

  function surfacesOf(facets, refl) {
    return facets.map(function (f) {
      return {
        type: 'facet', id: f.id, group: 'A', P: f.P, S0: f.S0, Z: f.Z, flat: f.flat,
        di: f.flat ? null : f.di, clip: { kind: 'poly', pts3: f.pts3 },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false }, info: { flux: f.w },
      };
    });
  }
})();
})();
