/* Mosaic solver — static, no tracing inside solve().
 *
 * 1. FACETS.  Directions from the LED are sampled on a quasi-regular spiral over the LED's emission cone.
 *    Each direction leaves the envelope at a point; that point (pushed just far enough inside that the tilted
 *    aperture still fits) is the facet centre.  The facet's normal bisects "towards the LED" and "towards the
 *    aim", so it specularly images the LED onto the target.  The aperture a direction owns follows from the
 *    solid angle it represents, so together the facets tile the part of the envelope that can reach the target
 *    without spilling its own beam onto the other facets.
 *
 * 2. FOOTPRINT MODEL.  A facet images the LED on the target with magnification d/r; the image is the LED's
 *    projected shape (foreshortened across the plane of incidence), optionally defocused to a chosen spot size.
 *    All of it is computed in closed form — the design is a pure calculation.
 *
 * 3. FILL.  Greedy "matching pursuit": each facet's flux is placed at the aim that best reduces the weighted
 *    squared error against the painted level, then a few sweeps re-place every facet with the others' light
 *    accounted for.  The model target is the painting; the model light is the sum of the footprints.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- LED directions
  // Quasi-regular spiral over the cone cos θ ∈ [ctMin, 1].  kind 'uniform': equal solid angle per point;
  // 'flux': equal LED flux per point (density ∝ intensity).
  function sampleDirections(src, n, ctMin, pw) {
    const V = RF.V, axis = V.norm(src.axis);
    const tm = RF.Source.thetaMax(src);
    const cMax = Math.cos(tm);
    const lo = Math.max(ctMin, cMax > 0 ? cMax : 0.02), hi = 1;
    if (!(hi > lo)) return [];
    const M = 512, acc = new Float64Array(M + 1);
    const cs = (i) => lo + (hi - lo) * i / M;
    let s = 0;
    for (let i = 1; i <= M; i++) {
      const w = pw > 0 ? Math.pow(Math.max(1e-9, RF.Source.intensity(src, Math.acos(0.5 * (cs(i) + cs(i - 1))))), pw) : 1;
      s += w * (cs(i) - cs(i - 1));                                // dΩ = dφ dc
      acc[i] = s;
    }
    if (!(s > 0)) return [];
    for (let i = 0; i <= M; i++) acc[i] /= s;
    const cdf = (c) => {
      const u = (c - lo) / (hi - lo) * M;
      const i = clamp(Math.floor(u), 0, M - 1), f = clamp(u - i, 0, 1);
      return acc[i] * (1 - f) + acc[i + 1] * f;
    };
    const [e1, e2] = V.basis(axis), out = [], GA = 0.6180339887498949;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      let a = lo, b = hi;
      for (let it = 0; it < 40; it++) { const m = 0.5 * (a + b); if (cdf(m) < u) a = m; else b = m; }
      const c = clamp(0.5 * (a + b), lo, hi), sn = Math.sqrt(Math.max(0, 1 - c * c)), ph = 2 * Math.PI * ((i * GA) % 1);
      out.push(V.norm(V.add(V.mul(axis, c), V.add(V.mul(e1, sn * Math.cos(ph)), V.mul(e2, sn * Math.sin(ph))))));
    }
    return out;
  }

  // 2π ∫ I(cosθ)^p dc over the cone: the total "weighted" solid angle the directions divide up
  function coneWeight(src, ctMin, pw) {
    const tm = RF.Source.thetaMax(src), lo = Math.max(ctMin, Math.cos(tm) > 0 ? Math.cos(tm) : 0.02), hi = 1;
    const M = 512; let s = 0;
    for (let i = 1; i <= M; i++) {
      const c0 = lo + (hi - lo) * (i - 1) / M, c1 = lo + (hi - lo) * i / M;   // dΩ = dφ dc
      const w = pw > 0 ? Math.pow(Math.max(1e-9, RF.Source.intensity(src, Math.acos(0.5 * (c0 + c1)))), pw) : 1;
      s += w * (c1 - c0);
    }
    return 2 * Math.PI * s;
  }

  // ---------------------------------------------------------------- source extents (footprint model)
  function sourceExtents(src) {
    const C = RF.Source.extentCov(src);
    return (e) => { let t = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t += e[i] * C[3 * i + j] * e[j]; return 2 * Math.sqrt(Math.max(0, 3 * t)); };
  }

  RF.Solvers.register({
    id: 'bench-particle1-r4--mosaic', name: 'Mosaic (static footprint fill)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'ctMin', label: 'Min LED cosine', type: 'range', min: 0.05, max: 0.95, step: 0.05, default: 0.2 },
      { key: 'maxImg', label: 'Largest footprint (× smallest achievable image)', type: 'range', min: 1, max: 20, step: 0.5, default: 6 },
      { key: 'fluxPow', label: 'Flux equalising (0 = equal solid angle, 1 = equal flux)', type: 'range', min: 0, max: 1, step: 0.05, default: 1 },
      { key: 'frontFrac', label: 'Allowed in front of the LED', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
      { key: 'fill', label: 'Aperture fill', type: 'range', min: 0.4, max: 1.0, step: 0.02, default: 0.92 },
      { key: 'spot', label: 'Spot size (× aim spacing)', type: 'range', min: 0, max: 6, step: 0.1, default: 2.6 },
      { key: 'gapWeight', label: 'Gap weight', type: 'range', min: 0, max: 8, step: 0.5, default: 2 },
      { key: 'minSep', label: 'Min aim separation (model cells)', type: 'range', min: 0, max: 4, step: 0.5, default: 1 },
      { key: 'passes', label: 'Aim refinement passes', type: 'range', min: 0, max: 10, step: 1, default: 4 },
      { key: 'coarse', label: 'Model grid divisor', type: 'range', min: 1, max: 4, step: 1, default: 2 },
    ],

    solve(input, settings, tools) {
      const V = RF.V, Geo = RF.Geo, E = RF.Engine;
      const src = input.source, L = V.copy(src.pos), axis = V.norm(src.axis);
      const env = input.envelope;
      const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
      const budget = Math.max(1, input.limits.maxFacets | 0);
      const Rr = input.limits.reflectivity;
      const T = E.targetFrame(input.target);
      const paintRes = input.paint.res | 0, paint = input.paint.cells;
      const cellMM = 2 * T.half / paintRes;
      const notes = [];
      const Zc = T.C.slice();
      const ad = V.norm(V.sub(Zc, L));                                 // throw direction

      // ---- model grid (target, coarse)
      const div = clamp(Math.round(settings.coarse), 1, 4);
      const G = Math.max(8, Math.round(paintRes / div));
      const gCell = 2 * T.half / G;
      const gpaint = new Float64Array(G * G);
      for (let j = 0; j < paintRes; j++) for (let i = 0; i < paintRes; i++) {
        const gi = Math.min(G - 1, Math.floor(i * G / paintRes)), gj = Math.min(G - 1, Math.floor(j * G / paintRes));
        gpaint[gj * G + gi] += paint[j * paintRes + i] / (div * div);
      }
      const paintCells = [];
      let sp = 0;
      for (let k = 0; k < G * G; k++) { sp += gpaint[k]; if (gpaint[k] > 0) paintCells.push(k); }
      if (!paintCells.length) return { surfaces: [], intent: [], notes: ['no painting: nothing to do'] };

      // ---- 1. facet positions
      const ctMin = clamp(+settings.ctMin, 0.02, 0.99);
      const frontFrac = clamp(+settings.frontFrac, 0, 1);
      const nSamp = Math.max(8, Math.round(budget * 4));
      const fluxPow = clamp(+settings.fluxPow, 0, 1);
      const dirs = sampleDirections(src, nSamp, ctMin, fluxPow);
      const fill = clamp(+settings.fill, 0.2, 1);
      const ext = sourceExtents(src);
      // the smallest LED image any facet in this envelope could paint (the scorer's own scale): a footprint
      // much wider than that only smears the painting, so the worst offenders can be left out
      const ker = RF.Photometry && RF.Photometry.achievableKernel ? RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target }) : null;
      const maxImgMM = ker ? clamp(+settings.maxImg, 1, 20) * Math.max(0.5, ker.cells) * cellMM : Infinity;
      const NS = 12;
      const rim = (P, n, a) => {
        const [bu, bv] = V.basis(n), out = [];
        for (let q = 0; q < NS; q++) { const t = 2 * Math.PI * q / NS; out.push(V.add(P, V.add(V.mul(bu, a * Math.cos(t)), V.mul(bv, a * Math.sin(t))))); }
        return out;
      };
      // footprint of a facet centred at P that sees the LED along d: image size on the target and the image
      // distance di (shortened from d0 to defocus to `spotMM`).  `sag` is how far its rim curves toward the wall.
      const footprint = (P, d, a, aimZ) => {
        const r = V.dist(P, L), d0 = V.dist(aimZ, P);
        const ct = clamp(V.dot(d, axis), 0, 1);
        const mp = V.sub(d, V.mul(axis, V.dot(d, axis)));
        const ml = V.len(mp);
        const m = ml > 1e-6 ? V.mul(mp, 1 / ml) : V.basis(axis)[0];
        const sg = V.cross(axis, m);
        let eMer = (d0 / r) * ext(m) * ct, eSag = (d0 / r) * ext(sg);
        const want = Math.max(spotMM, Math.min(eMer, eSag));
        let di = d0;
        if (want > Math.min(eMer, eSag) + 1e-9) {
          const rho = 0.5 * (want - Math.min(eMer, eSag));
          di = d0 / (1 + rho / Math.max(0.5, a));
        }
        eMer = Math.max(eMer, want); eSag = Math.max(eSag, want);
        const rhoC = Math.max(1e-3, 2 * r * di / (r + di));
        return { eMer, eSag, di, m, sg, ct, rhoC, aimZ };
      };
      // exact surface points of the aperture rim (the mirror is a quadric: its rim leaves the chord plane)
      const rimSurface = (P, di, a, aimZ, nRim) => {
        const fq = Geo.facetQuadric(P, L, aimZ, di);
        const n = fq.n, [ex, ey] = V.basis(n), ez = n;
        const Q = RF.M3.congruent(fq.A, ex, ey, ez);
        const Lq = [V.dot(fq.b, ex), V.dot(fq.b, ey), V.dot(fq.b, ez)];
        const out = [];
        const NR = nRim || NS;
        for (let q = 0; q < NR; q++) {
          const t = 2 * Math.PI * q / NR, x = a * Math.cos(t), y = a * Math.sin(t);
          const bq = 2 * (Q[2] * x + Q[5] * y) + Lq[2];
          const c = Q[0] * x * x + Q[4] * y * y + 2 * Q[1] * x * y + Lq[0] * x + Lq[1] * y;
          const rr = RF.U.quadRoots(Q[8], bq, c);
          let z = 0;
          if (rr.length) { z = rr.reduce((m, t2) => (Math.abs(t2) < Math.abs(m) ? t2 : m), Infinity); if (!isFinite(z)) z = 0; }
          out.push(V.add(P, V.add(V.add(V.mul(ex, x), V.mul(ey, y)), V.mul(ez, z))));
        }
        return out;
      };
      const fits = (P, a, fp, nRim) => {
        if (V.dist(P, L) < keep * 1.02) return false;
        for (const q of rimSurface(P, fp.di, a * 1.1, fp.aimZ, nRim)) {
          if (!Geo.envInside(env, q, -3e-3)) return false;
          if (V.dist(q, L) < keep * 1.01) return false;
        }
        return true;
      };
      const valid = [];
      for (const d of dirs) {
        const tout = Geo.envInterval(env, L, d)[1];
        if (!(tout > keep * 1.02) || !isFinite(tout)) continue;
        const P0 = V.add(L, V.mul(d, tout));
        if (V.dot(V.sub(P0, L), ad) > frontFrac * tout) continue;       // not in the outgoing beam's way
        const sh = V.mul(d, -1);
        const n0 = V.norm(V.add(sh, V.norm(V.sub(Zc, P0))));
        const cosS = V.dot(n0, sh);
        if (!(cosS > 0.1)) continue;
        if (isFinite(maxImgMM)) {                                   // footprint far too wide to paint anything
          const r0 = tout, d0 = V.dist(Zc, P0), ct = clamp(V.dot(d, axis), 0, 1);
          const mp = V.sub(d, V.mul(axis, V.dot(d, axis))), ml = V.len(mp);
          const m = ml > 1e-6 ? V.mul(mp, 1 / ml) : V.basis(axis)[0];
          const eNat = (d0 / r0) * Math.max(ext(m) * ct, ext(V.cross(axis, m)));
          if (eNat > maxImgMM) continue;
        }
        valid.push({ d, tout, sh, cosS });
      }
      if (!valid.length) return { surfaces: [], intent: [], notes: ['no usable facet directions'] };
      const nValid = valid.length;
      const coneOm = coneWeight(src, ctMin, fluxPow);
      const nUse = Math.min(budget, valid.length);
      const OmBase = fill * coneOm * (nValid / Math.max(1, dirs.length)) / nUse;
      // Spot size: with N footprints over a painted area A the aim spacing is √(A/N); a spot a couple of spacings
      // across sums to a smooth field.  (For a big painting the LED's own image is already larger: it wins.)
      const ApCells = paintCells.length * div * div;
      const sEst = Math.max(1, Math.sqrt(ApCells / Math.max(1, nUse)));
      const spotMM = Math.max(0, +settings.spot) * sEst * cellMM;
      const stride = valid.length / nUse;

      // largest inset radius at which this aperture is fully inside the envelope and clear of the LED
      const fitFacet = (v, aimZ, a0) => {
        const d = v.d, rlo = Math.max(keep * 1.02, 1e-3), rhi = v.tout;
        let a = a0;
        for (let shrink = 0; shrink < 8; shrink++) {
          let okR = -1, prev = -1;
          const M = 20;
          for (let q = M; q >= 0; q--) {
            const r = rlo + (rhi - rlo) * q / M, P = V.add(L, V.mul(d, r));
            if (fits(P, a, footprint(P, d, a, aimZ))) { okR = r; prev = q < M ? rlo + (rhi - rlo) * (q + 1) / M : r; break; }
          }
          if (okR > 0 && prev > okR) {
            for (let it = 0; it < 12; it++) {
              const m = 0.5 * (okR + prev), P = V.add(L, V.mul(d, m));
              if (fits(P, a, footprint(P, d, a, aimZ))) okR = m; else prev = m;
            }
          }
          if (okR > 0) { const P = V.add(L, V.mul(d, okR)); return { P, a, fp: footprint(P, d, a, aimZ) }; }
          a *= 0.82;
        }
        return null;
      };
      const fluxOf = (P, a, aimZ) => {
        const r = V.dist(P, L);
        const sh = V.norm(V.sub(L, P)), ah = V.norm(V.sub(aimZ, P)), n = V.norm(V.add(sh, ah));
        const cosS = Math.max(0, V.dot(n, sh));
        const half = Math.acos(clamp(V.dot(V.norm(V.sub(P, L)), axis), -1, 1));
        return { f: RF.Source.intensity(src, half) * Math.PI * a * a * cosS / (r * r), r, cosS, sh, n };
      };

      // Share of a facet's outgoing cone that lands on another facet (the trace's "blocked" light).  Static
      // geometry only: a ray from the facet centre along the aim, plus rays on the edge of its cone.
      const blockedFrac = (fi, list) => {
        const om = Math.PI * fi.a * fi.a * Math.max(0.05, fi.cosS) / (fi.r * fi.r);
        if (fi.aimZ) {
          const ah = V.norm(V.sub(fi.aimZ, fi.P));
          const [e1, e2] = V.basis(ah);
          const th = Math.acos(clamp(1 - om / (2 * Math.PI), -1, 1));
          const dirs = [ah];
          for (let k = 0; k < 6; k++) {
            const ph = 2 * Math.PI * k / 6;
            dirs.push(V.norm(V.add(V.mul(ah, Math.cos(th)), V.add(V.mul(e1, Math.sin(th) * Math.cos(ph)), V.mul(e2, Math.sin(th) * Math.sin(ph))))));
          }
          let nb = 0;
          for (const rr of dirs) {
            for (const fj of list) {
              if (fj === fi) continue;
              const den = V.dot(rr, fj.n);
              if (Math.abs(den) < 1e-6) continue;
              const t = V.dot(V.sub(fj.P, fi.P), fj.n) / den;
              if (!(t > 1e-3)) continue;
              if (V.dist(V.add(fi.P, V.mul(rr, t)), fj.P) <= fj.a) { nb++; break; }
            }
          }
          return nb / dirs.length;
        }
        return 0;
      };

      const facets = [];
      const placeAll = (aimOf) => {
        facets.length = 0;
        for (let k = 0; k < nUse; k++) {
          const v = valid[Math.round(k * stride)];
          const aimZ = aimOf ? aimOf(k) : Zc;
          const ip = fluxPow > 0 ? Math.pow(Math.max(1e-9, RF.Source.intensity(src, Math.acos(clamp(V.dot(v.d, axis), -1, 1)))), fluxPow) : 1;
          const a0 = Math.sqrt(Math.max(1e-6, (OmBase / ip) * v.tout * v.tout / (Math.PI * v.cosS)));
          let res = fitFacet(v, aimZ, a0);
          if (!res) continue;
          // no gross overlap with facets already placed
          let clash = true;
          for (let guard = 0; guard < 10 && clash; guard++) {
            clash = false;
            for (const c of facets) if (V.dist(c.P, res.P) < 0.8 * (c.a + res.a)) { clash = true; break; }
            if (clash) { res.a *= 0.9; const r2 = fitFacet(v, aimZ, res.a); if (!r2) { clash = true; break; } res = r2; }
          }
          if (clash || res.a < 0.4) continue;
          const fl = fluxOf(res.P, res.a, aimZ);
          if (!(fl.f > 0)) continue;
          facets.push({ v, P: res.P, a: res.a, fp: res.fp, f: fl.f, f0: fl.f, r: fl.r, sh: fl.sh, n: fl.n, cosS: fl.cosS, d: v.d, aimZ });
        }
      };
      placeAll(null);
      for (const f of facets) { const fl = fluxOf(f.P, f.a, Zc); f.sh = fl.sh; f.n = fl.n; f.cosS = fl.cosS; f.f0 = fl.f; f.f = fl.f; }
      notes.push(facets.length + ' facets (' + valid.length + '/' + dirs.length + ' directions usable)');

      // ---- 2. footprints + greedy aim filling
      const aimZOf = (z) => {
        const zi = z % G, zj = (z - zi) / G;
        return E.targetUVtoWorld(T, -T.half + (zi + 0.5) * gCell, -T.half + (zj + 0.5) * gCell);
      };
      const buildKernels = () => {
        const out = [];
        for (const f of facets) {
          f.di = f.fp.di;
          const eMer = f.fp.eMer, eSag = f.fp.eSag;
          const ah = V.norm(V.sub(f.aimZ || Zc, f.P));
          const mn = V.cross(f.sh, ah);
          let mt = V.cross(mn, T.n);
          mt = V.len(mt) > 1e-6 ? V.norm(mt) : T.tu;
          const st = V.norm(V.cross(T.n, mt));
          const mu = [V.dot(mt, T.tu), V.dot(mt, T.tv)], su = [V.dot(st, T.tu), V.dot(st, T.tv)];
          // a uniform square image of width e has the same second moment as a Gaussian of sigma e/√12
          const sm = 0.289 * eMer / gCell, ss = 0.289 * eSag / gCell;
          const cuu = sm * sm * mu[0] * mu[0] + ss * ss * su[0] * su[0];
          const cvv = sm * sm * mu[1] * mu[1] + ss * ss * su[1] * su[1];
          const cuv = sm * sm * mu[0] * mu[1] + ss * ss * su[0] * su[1];
          const det = Math.max(1e-9, cuu * cvv - cuv * cuv);
          const Rg = Math.max(1, Math.ceil(3 * Math.max(sm, ss)));
          const patch = [];
          let sum = 0;
          for (let dj = -Rg; dj <= Rg; dj++) for (let di = -Rg; di <= Rg; di++) {
            const q = (cvv * di * di - 2 * cuv * di * dj + cuu * dj * dj) / det;
            const w = Math.exp(-0.5 * q);
            if (w < 1e-3) continue;
            patch.push([di, dj, w]); sum += w;
          }
          for (const pp of patch) pp[2] /= sum;
          out.push({ patch, Rg });
        }
        return out;
      };
      const wgt = new Float64Array(G * G);
      const gapW = Math.max(0, +settings.gapWeight);
      const passes = clamp(Math.round(settings.passes), 0, 10);
      const doFill = () => {
        const N = facets.length;
        const Ftot = facets.reduce((acc, f) => acc + f.f, 0);
        const T1 = Ftot / Math.max(1e-9, sp);
        const Tflux = new Float64Array(G * G);
        for (let k = 0; k < G * G; k++) Tflux[k] = T1 * gpaint[k];
        for (let k = 0; k < G * G; k++) wgt[k] = gpaint[k] > 0 ? 1 / Math.max(1e-12, Tflux[k] * Tflux[k]) : gapW / Math.max(1e-12, T1 * T1);
        const kernels = buildKernels();
        const Em = new Float64Array(G * G);
        // aim separation: keep the footprints from clumping (a clump leaves holes elsewhere)
        const sep = Math.max(0, +settings.minSep);
        const sepOff = [], occ = new Float64Array(G * G);
        const SR = Math.floor(sep);
        for (let dj = -SR; dj <= SR; dj++) for (let di = -SR; di <= SR; di++) if (Math.hypot(di, dj) <= sep + 1e-9) sepOff.push([di, dj]);
        const cost = (i, noSep) => {
          let best = Infinity, bz = -1;
          const k = kernels[i], f = facets[i].f;
          for (const z of paintCells) {
            if (!noSep && sep > 0 && occ[z] > 0) continue;
            const zi = z % G, zj = (z - zi) / G;
            let dd = 0;
            for (let q = 0; q < k.patch.length; q++) {
              const pp = k.patch[q], ii = zi + pp[0], jj = zj + pp[1];
              if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
              const c = jj * G + ii, e0 = Em[c] - Tflux[c], e = e0 + f * pp[2];
              dd += wgt[c] * (e * e - e0 * e0);
            }
            if (dd < best) { best = dd; bz = z; }
          }
          return bz;
        };
        const pick = (i) => { const z = cost(i, false); return z >= 0 ? z : cost(i, true); };
        const place = (i, z, sign) => {
          const k = kernels[i], f = facets[i].f * sign, zi = z % G, zj = (z - zi) / G;
          for (let q = 0; q < k.patch.length; q++) {
            const pp = k.patch[q], ii = zi + pp[0], jj = zj + pp[1];
            if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
            Em[jj * G + ii] += f * pp[2];
          }
          for (const [di, dj] of sepOff) { const ii = zi + di, jj = zj + dj; if (ii >= 0 && jj >= 0 && ii < G && jj < G) occ[jj * G + ii] += sign; }
          facets[i].aim = z;
        };
        for (let i = 0; i < N; i++) place(i, pick(i), +1);
        for (let p = 0; p < passes; p++) {
          for (let q = 0; q < N; q++) {
            const i = (q * 7 + p * 3) % N, z0 = facets[i].aim;
            place(i, z0, -1);
            place(i, pick(i), +1);
          }
        }
        return Ftot;
      };
      let Ftot = doFill();
      // one calibration round: the aperture fit depends on the aim, so re-fit every facet to its real aim
      for (let round = 0; round < 3; round++) {
        let moved = 0, dead = 0;
        for (const f of facets) {
          const aimZ = aimZOf(f.aim);
          let a = f.a, res = fitFacet(f.v, aimZ, a);
          for (let k = 0; k < 3 && !res; k++) { a *= 0.72; res = fitFacet(f.v, aimZ, a); }
          if (!res) { f.dead = true; dead++; continue; }
          if (V.dist(res.P, f.P) > 1e-6 || Math.abs(res.a - f.a) > 1e-6) moved++;
          f.P = res.P; f.a = res.a; f.fp = res.fp;
          const fl = fluxOf(f.P, f.a, aimZ);
          f.f0 = fl.f; f.r = fl.r; f.sh = fl.sh; f.n = fl.n; f.cosS = fl.cosS; f.aimZ = aimZ;
        }
        if (dead) { const alive = facets.filter((f) => !f.dead); facets.length = 0; for (const f of alive) facets.push(f); }
        for (const f of facets) f.f = f.f0 * (1 - 0.9 * blockedFrac(f, facets));   // light that hits another facet is gone
        Ftot = doFill();
        if (!dead && moved <= facets.length * 0.05) break;
      }
      // hard guarantee: the last fill moved some aims, so re-check every facet against its own final aim
      {
        let dropped = 0;
        for (const f of facets) {
          const aimZ = aimZOf(f.aim);
          let a = f.a, ok = null;
          for (let k = 0; k < 10 && !ok; k++) { const fp = footprint(f.P, f.d, a, aimZ); if (fits(f.P, a, fp, 36)) ok = { a, fp }; else a *= 0.85; }
          if (!ok) { f.dead = true; dropped++; continue; }
          f.a = ok.a; f.fp = ok.fp; f.aimZ = aimZ;
          const fl = fluxOf(f.P, f.a, aimZ);
          f.f = fl.f; f.r = fl.r; f.sh = fl.sh;
        }
        if (dropped) { const alive = facets.filter((f) => !f.dead); facets.length = 0; for (const f of alive) facets.push(f); }
        if (dropped) notes.push(dropped + ' facets dropped at the final fit');
      }
      notes.push('flux ' + Ftot.toFixed(3));

      // ---- 3. surfaces
      const surfaces = [], intent = [];
      for (let i = 0; i < facets.length; i++) {
        const f = facets[i];
        const z = f.aim, zi = z % G, zj = (z - zi) / G;
        const u = -T.half + (zi + 0.5) * gCell, v = -T.half + (zj + 0.5) * gCell;
        const Z = E.targetUVtoWorld(T, u, v);
        const sh = V.norm(V.sub(L, f.P)), ah = V.norm(V.sub(Z, f.P));
        const n = V.norm(V.add(sh, ah));
        const [bu, bv] = V.basis(n);
        const pts = [];
        for (let q = 0; q < NS; q++) { const t = 2 * Math.PI * q / NS; pts.push(V.add(f.P, V.add(V.mul(bu, f.a * Math.cos(t)), V.mul(bv, f.a * Math.sin(t))))); }
        const id = 'M' + i;
        const fp = footprint(f.P, f.d, f.a, Z);        // final image distance for this aim
        surfaces.push({ type: 'facet', id, group: 'A', P: f.P, S0: L, Z, di: fp.di, flat: false,
          clip: { kind: 'poly', pts3: pts }, optics: { interaction: 'reflect', reflectivity: Rr, twoSided: false } });
        const pi = clamp(Math.floor((u + T.half) / (2 * T.half) * paintRes), 0, paintRes - 1);
        const pj = clamp(Math.floor((v + T.half) / (2 * T.half) * paintRes), 0, paintRes - 1);
        intent.push({ facet: id, cells: [[pj * paintRes + pi, 1]] });
      }
      notes.push('model grid ' + G + '² (' + paintCells.length + ' painted cells)');

      // ---- 4. self-check with the host's own rules (outline inside the envelope, away from every emitter,
      //        and it compiles): drop anything that would fail a hard constraint
      let kept = surfaces, keptIntent = intent;
      try {
        const envTol = 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
        const SS = (input.sources && input.sources.length ? input.sources : [src]).map((q) => q.pos);
        const Gv = Geo.compile(surfaces);
        const bad = new Set();
        for (let k = 0; k < Gv.n; k++) {
          let out = false;
          for (const poly of Geo.outline(Gv, k)) {
            for (const q of poly) {
              if (!Geo.envInside(env, q, envTol)) { out = true; break; }
              for (const S of SS) if (V.dist(q, S) < keep * (1 - 1e-4)) { out = true; break; }
              if (out) break;
            }
            if (out) break;
            // interior points, measured on the real surface exactly as the host does
            const c = V.mul(poly.reduce((a, q) => V.add(a, q), [0, 0, 0]), 1 / poly.length);
            for (const S of SS) {
              for (let i = 0; i < poly.length && !out; i++) {
                const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
                for (let a = 0; a <= 4 && !out; a++) for (let b = 0; a + b <= 4; b++) {
                  const q = V.add(c, V.add(V.mul(V.sub(p1, c), a / 4), V.mul(V.sub(p2, c), b / 4))), dq = V.norm(V.sub(q, S));
                  const t = Geo.intersect(Gv.D, Gv.poly, k, S[0], S[1], S[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
                  if (t >= 0 && t < keep * (1 - 1e-4)) { out = true; break; }
                }
              }
              if (out) break;
            }
          }
          if (out) bad.add(Gv.metas[k].id);
        }
        if (bad.size) {
          kept = surfaces.filter((sf) => !bad.has(sf.id));
          const ids = new Set(kept.map((sf) => sf.id));
          keptIntent = intent.filter((it) => it.facet === null || ids.has(it.facet));
          notes.push(bad.size + ' facets dropped by the self-check');
        }
      } catch (e) { notes.push('self-check skipped: ' + e.message); }
      return { surfaces: kept, intent: keptIntent, notes };
    },
  });

  /* ------------------------------------------------------------------ optional tuner
   * The same static algorithm, tuned by tracing.  A handful of settings candidates are designed, traced with the
   * SAME seed (so differences between them are geometry, not dice) and the one the goal prefers is returned.  A
   * solver whose id ends in -auto is allowed to trace inside solve(); the static `mosaic` above is not.
   *
   * Two stages, because one short trace cannot separate candidates that are within its own shot noise:
   *   stage 1 — every candidate at `rays` (a screening pass)
   *   stage 2 — the best few, re-traced at a judge sample (at least 1 M rays, i.e. the sample the scene is scored
   *             at), and the winner chosen from those numbers.  The fidelity metric is nonlinear (a fitted
   *             exposure, ×/÷1.25 bands), so rankings are only trustworthy at the judge sample.
   * Goals (all judged on the same traced facts the scorer uses):
   *   faithful  — fidelity (the painting reproduced best)
   *   throw     — onPaint (most of the LED's light landed on the painting)
   *   efficient — the task's own score shape, with the best candidate standing in for the unseen reference:
   *                F + 0.5·g·X with F = fidelity·light, light = min(1, onPaint/(0.1·ref onPaint)),
   *                X = 0.7·min(2, onPaint/ref onPaint)/2 + 0.3·min(2, peak/ref peak)/2
   */
  RF.Solvers.register({
    id: 'bench-particle1-r4--mosaic-auto', name: 'Mosaic (tuned: traces candidates)', version: '0.3', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful',
        options: [
          { value: 'faithful', label: 'Faithful (match the painting)' },
          { value: 'throw', label: 'Throw (most light on the painting)' },
          { value: 'efficient', label: 'Efficient (painting + light + peak)' },
        ] },
      { key: 'rays', label: 'Screening rays per candidate', type: 'range', min: 40000, max: 400000, step: 20000, default: 120000 },
    ],

    solve(input, settings, tools) {
      const base = RF.Solvers.get('bench-particle1-r4--mosaic');
      if (!base) return { surfaces: [], intent: [], notes: ['static mosaic solver not loaded'] };
      const defs = {};
      for (const f of base.settings) defs[f.key] = f.default;
      const seed = input.seed | 0;
      const goal = settings.goal === 'throw' || settings.goal === 'efficient' ? settings.goal : 'faithful';
      const rays = Math.max(20000, Math.min(400000, Math.round(+settings.rays || 120000)));
      const minD = settings.minDistance || 0;
      const rounded = (n) => Math.round(n / 50000) * 50000;
      // a small, deliberately varied set: the axes that actually moved fidelity / light in development
      const variants = [
        {},
        { spot: 1.6 },
        { spot: 4.0 },
        { fill: 0.85 },
        { minSep: 0 },
        { minSep: 1.5, gapWeight: 1 },
        { ctMin: 0.3, maxImg: 4 },
        { fluxPow: 0.6, spot: 3.0 },
      ];
      const rows = [];
      const design = (v) => {
        try { return base.solve(input, RF.Solvers.sanitize(base, Object.assign({}, defs, { minDistance: minD }, v)), {}); } catch (e) { return null; }
      };
      const trial = (out, n) => {
        try { return tools.trace(out.surfaces, { rays: n, seed }); } catch (e) { return null; }
      };
      const facts = (tr) => (tr && tr.fidelity
        ? { fid: tr.fidelity.fidelity || 0, on: tr.fidelity.onPaint || 0, cd: tr.peakCd || 0 }
        : null);

      const cands = [];
      for (let i = 0; i < variants.length; i++) {
        const out = design(variants[i]);
        if (!out || !out.surfaces || !out.surfaces.length) { rows.push('#' + i + ' ' + JSON.stringify(variants[i]) + ' → no usable design'); continue; }
        const tr = trial(out, rays), fa = facts(tr);
        cands.push({ i, out, tr, fa });
        if (tools.preview) tools.preview(out.surfaces, { label: 'candidate ' + (i + 1) + '/' + variants.length, note: fa ? ('screening: fidelity ' + (100 * fa.fid).toFixed(1) + '% · on paint ' + (100 * fa.on).toFixed(1) + '%') : 'not traced', trace: tr || undefined });
      }
      if (!cands.length) {                                            // tracing unavailable: the plain tuned design
        const out = design({}) || { surfaces: [], intent: [], notes: [] };
        out.notes = (out.notes || []).concat(['goal ' + goal + ': no candidate could be traced, plain design returned']);
        return out;
      }
      // stage 2: re-trace the leaders at 3x the screening sample.  Screening key: the goal's own quantity, with a
      // small prior for the tuned defaults (only leave them for a gain that is not screening noise).
      const screen = (c) => {
        if (!c.fa) return -Infinity;
        const base0 = goal === 'throw' ? c.fa.on : c.fa.fid;
        return base0 - (c.i === 0 ? 0 : 0.01);
      };
      cands.sort((a, b) => screen(b) - screen(a));
      const finalists = cands.slice(0, Math.min(3, cands.length)).filter((c) => c.fa);
      const judgeRays = Math.min(2e6, Math.max(1000000, rounded(8 * rays)));
      for (const c of finalists) { const tr = trial(c.out, judgeRays); if (tr) { c.tr = tr; c.fa = facts(tr) || c.fa; } }
      // the reference proxy for the relative goals: the best candidate on this scene
      let refOn = 0, refCd = 0;
      for (const c of cands) if (c.fa) { refOn = Math.max(refOn, c.fa.on); refCd = Math.max(refCd, c.fa.cd); }
      const score = (c) => {
        if (!c.fa) return -Infinity;
        const { fid, on, cd } = c.fa;
        let s;
        if (goal === 'throw') s = on;
        else if (goal === 'efficient') {
          const light = refOn > 0 ? Math.min(1, on / (0.1 * refOn)) : 1;
          const F = fid * light;
          const g = Math.max(0, Math.min(1, (F - 0.5) / 0.25));
          const X = (refOn > 0 ? 0.35 * Math.min(2, on / refOn) : 0.35) + (refCd > 0 ? 0.15 * Math.min(2, cd / refCd) : 0.15);
          s = F + 0.5 * g * X;
        } else s = fid * (refOn > 0 ? Math.min(1, on / (0.1 * refOn)) : 1);      // fidelity only counts for a lit design
        // The tuned defaults stay unless a candidate beats them by more than the judge sample can resolve
        // (the judge numbers of the top few are usually within ~1 point of each other).
        return s - (c.i === 0 ? 0 : 0.012);
      };
      const field = finalists.length ? finalists : cands;
      let best = field[0];
      for (const c of field) if (score(c) > score(best)) best = c;
      for (const c of cands) rows.push('#' + c.i + ' ' + JSON.stringify(variants[c.i]) + ' → ' + (c.fa ? ('fidelity ' + (100 * c.fa.fid).toFixed(1) + '% · on paint ' + (100 * c.fa.on).toFixed(1) + '% · peak ' + Math.round(c.fa.cd) + ' cd') : 'not traced') + (finalists.includes(c) ? ' [final]' : ''));
      const out = best.out;
      out.notes = (out.notes || []).concat(
        ['mosaic-auto: goal ' + goal + ', ' + cands.length + ' candidates screened at ' + rays.toLocaleString() + ' rays, ' + finalists.length + ' re-traced at ' + judgeRays.toLocaleString(),
         'chosen: #' + best.i + ' ' + JSON.stringify(variants[best.i])], rows);
      return out;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
