/* solver.js — a faceted reflector designed straight from the painting (static: no rays are traced).
 *
 * Idea
 * ----
 * A facet at P that must send the LED's light to a target point Z has its normal fixed: the bisector of
 * (facet → LED) and (facet → Z).  Its image of the LED is stigmatic (an ellipsoid with foci at the LED and
 * at Z), so its spot on the target is as small as physics allows: LED size × aim distance / facet distance.
 * The design is therefore (1) where the facets sit and (2) where each one aims.
 *
 *  1. WHERE — a dish.  The seamless reflector for this problem is the ellipsoid with foci at the LED and
 *     at the target centre: every point of it reflects the LED straight at the target, so its normal is
 *     exactly the facet normal we need and the reflected beams leave the surface cleanly.  Its near
 *     vertex sits f mm behind the LED and it opens toward the target; the dish is the part of that
 *     surface inside the envelope, outside the LED clearance and inside the LED's emission cone.
 *     Facets tile the dish in angular cells seen from the LED (uniform in cos-angle × azimuth, roughly
 *     square).  Because a dish position fixes both the radius and the height along the target axis, no
 *     facet ever sits in another's reflected beam — the classic reason a reflector bowl works and a
 *     surface parallel to the beam does not (a flat ceiling of facets loses a third of its light).
 *     Each facet's aperture is the true cross-section of its cell's cone with its own tilted plane, so
 *     the flux it catches is integrated directly (quadrature over that polygon — no tracing), and
 *     partial cells at the envelope wall are clipped, not dropped.
 *  2. WHERE IT AIMS — the painting.  A facet paints the LED's image, so the target sees the painting
 *     blurred by the image size (LED size × aim distance / facet distance).  The aim density is the
 *     painting *deconvolved* by that box, which puts the extra flux just inside an edge that a blurred
 *     edge loses, and never outside the paint (the gaps must stay dark).  Aims are laid out over the
 *     painted cells in proportion to that density; facets are matched to aims by flux (LPT) so every aim
 *     receives the same light.
 *
 * Deterministic: same input + settings ⇒ same surfaces.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const V = RF.V;
  const D2R = Math.PI / 180;
  const TAU = 2 * Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  function h01(a, b, c) {
    const h = RF.rng.fmix32(Math.imul(a | 0, 0x27d4eb2f) ^ Math.imul((b | 0) + 1, 0x9e3779b1) ^ Math.imul((c | 0) + 7, 0x85ebca6b));
    return (h >>> 0) / 4294967296;
  }

  // Deconvolve the paint by a separable box of width w cells (multiplicative, limited, kept inside the paint).
  function deconvolve(paint, R, w, iters, cap) {
    const n = R * R, a = Float64Array.from(paint);
    if (!(w > 1.02) || !(iters > 0)) return a;
    const mask = new Uint8Array(n);
    for (let k = 0; k < n; k++) mask[k] = paint[k] > 0 ? 1 : 0;
    for (let it = 0; it < iters; it++) {
      const b = RF.Photometry.boxBlur(a, R, w);
      for (let k = 0; k < n; k++) {
        if (!mask[k]) { a[k] = 0; continue; }
        const f = clamp(paint[k] / Math.max(b[k], 1e-12), 0.4, 2.5);
        a[k] = clamp(a[k] * f, 0, cap * paint[k]);
      }
    }
    return a;
  }

  const BASE_SETTINGS = [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'dishDepth', label: 'Dish depth (mm; 0 = auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'depthKeep', label: 'Auto depth: light kept', type: 'range', min: 0.3, max: 1, step: 0.05, default: 0.7 },
      { key: 'maxTheta', label: 'Max polar angle from the LED axis (deg)', type: 'range', min: 10, max: 89, step: 1, default: 75 },
      { key: 'minCos', label: 'Min incidence cosine', type: 'range', min: 0.1, max: 0.9, step: 0.05, default: 0.35 },
      { key: 'imgFactor', label: 'Max image blur (× best possible; 0 = auto)', type: 'range', min: 0, max: 12, step: 0.5, default: 0 },
      { key: 'minRfrac', label: 'Min facet distance (× farthest)', type: 'range', min: 0, max: 0.98, step: 0.02, default: 0 },
      { key: 'aimGroups', label: 'Facets per aim', type: 'range', min: 1, max: 6, step: 1, default: 1 },
      { key: 'spotMode', label: 'Spot sizing', type: 'select', options: [{ value: 'size', label: 'common size' }, { value: 'level', label: 'common level' }], default: 'size' },
      { key: 'spotOverlap', label: 'Spot overlap', type: 'range', min: 0.5, max: 24, step: 0.5, default: 5 },
      { key: 'levelPct', label: 'Common level: drop dimmest (%)', type: 'range', min: 0, max: 90, step: 5, default: 20 },
      { key: 'lightBias', label: 'Auto choice: weight on light on paint', type: 'range', min: 0, max: 3, step: 0.1, default: 0.5 },
      { key: 'aimMode', label: 'Aim placement', type: 'select', options: [{ value: 'greedy', label: 'greedy on the predicted beam' }, { value: 'density', label: 'proportional to the paint' }], default: 'greedy' },
      { key: 'deconv', label: 'Deconvolution passes', type: 'range', min: 0, max: 40, step: 1, default: 12 },
      { key: 'kernelScale', label: 'Kernel scale', type: 'range', min: 0.4, max: 2, step: 0.05, default: 1 },
      { key: 'refine', label: 'Aim refinement passes', type: 'range', min: 0, max: 6, step: 1, default: 2 },
      { key: 'aimJitter', label: 'Aim jitter (cells)', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
      { key: 'nearBoost', label: 'Near-edge spill allowance', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
      { key: 'inset', label: 'Envelope inset (mm)', type: 'number', min: 0, max: 10, step: 0.5, default: 1.5 },
  ];
  const DEFAULTS = (() => { const o = {}; for (const f of BASE_SETTINGS) o[f.key] = f.default; return o; })();

  RF.Solvers.register({
    id: 'bench-particle1-r3--facetbowl', name: 'Facet dish (paint)', version: '0.3', modes: ['paint'],
    settings: BASE_SETTINGS,

    solve: designSolve,
  });

  function designSolve(input, settings) {
      const S = settings, notes = [];
      const src = input.source, L = src.pos.slice();
      const fr = RF.Source.frame(src), ax = fr.a, uu = fr.u, vv = fr.v;
      const env = input.envelope;
      const keep = Math.max(env.keepOut || 0, +S.minDistance || 0);
      const T = RF.Engine.targetFrame(input.target);
      const Rp = input.paint.res | 0, paint = input.paint.cells;
      const cellW = (2 * T.half) / Rp;
      const lim = input.limits || {};
      const maxFacets = Math.max(1, Math.min(4000, (lim.maxFacets | 0) || 1));
      const refl = lim.reflectivity !== undefined ? lim.reflectivity : 0.9;
      const a0 = V.norm(V.sub(T.C, L));                    // the axis of the dish: LED → target centre
      const cD = Math.max(1e-6, V.dist(T.C, L));
      const totalInt = RF.Source.totalIntegral(src) || 1;
      const srcSize = RF.Source.extentSize(src) || 0;
      const [p1, p2] = V.basis(a0);

      // ---------------------------------------------------------------- the painting
      const painted = [];
      let sumP = 0;
      for (let k = 0; k < Rp * Rp; k++) if (paint[k] > 0) { painted.push(k); sumP += paint[k]; }
      if (!painted.length) return { surfaces: [], intent: [], notes: ['nothing painted: no facets placed'] };

      // ---------------------------------------------------------------- direction helpers
      let thCap = Math.min(+S.maxTheta * D2R, Math.min(RF.Source.thetaMax(src), Math.PI));
      const minCos0 = clamp(+S.minCos, 0.05, 0.99);
      let minCosEff = minCos0;
      const dirU = (u, ph) => {
        const st = Math.sqrt(Math.max(0, 1 - u * u)), cp = Math.cos(ph), sp = Math.sin(ph);
        return [a0[0] * u + p1[0] * cp * st + p2[0] * sp * st,
                a0[1] * u + p1[1] * cp * st + p2[1] * sp * st,
                a0[2] * u + p1[2] * cp * st + p2[2] * sp * st];
      };
      // radius of the dish along direction sh (ellipsoid |P−L| + |P−T| = 2a, a = c/2 + f)
      const dishR = (f, sh) => {
        const a = cD / 2 + f, u = V.dot(sh, a0), den = 2 * (2 * a - cD * u);
        if (!(den > 1e-9)) return Infinity;
        const r = (4 * a * a - cD * cD) / den;
        return r > 0 ? r : Infinity;
      };
      const envR = (sh) => { const iv = RF.Geo.envInterval(env, L, sh); const r = Math.min(iv[1], 1e7); return r > 0 ? r : 0; };
      const srcI = (sh) => RF.Source.intensity(src, Math.acos(clamp(V.dot(sh, ax), -1, 1)));

      // validity of a dish direction: emission, clearance, glancing limit, inside the envelope
      let rFloor = 0;
      const dishOK = (f, sh) => {
        if (!(srcI(sh) > 1e-6)) return false;
        if (Math.acos(clamp(V.dot(sh, ax), -1, 1)) > thCap) return false;
        const r = dishR(f, sh);
        if (!(r > Math.max(keep + 0.6, rFloor)) || !isFinite(r)) return false;
        const n = V.norm(V.add(V.neg(sh), a0));
        if (V.dot(n, V.neg(sh)) < minCosEff) return false;
        if (!RF.Geo.envInside(env, V.madd(L, sh, r), -2e-3)) return false;
        return true;
      };

      // ---------------------------------------------------------------- pick the dish depth f
      const fScan = [];
      {
        // reference length: how far the envelope lets a facet sit from the LED (90th pct over the cone)
        const ds = [];
        for (let i = 0; i < 400; i++) {
          const u = -1 + 2 * (i + 0.5) / 400, ph = i * 2.399963;
          const sh = dirU(u, ph);
          if (!(srcI(sh) > 1e-6)) continue;
          const r = envR(sh);
          if (r > 0) ds.push(r);
        }
        ds.sort((a, b) => a - b);
        const rRef = ds.length ? ds[Math.floor(ds.length * 0.9)] : 40;
        const NCELL = 240;
        const fLo = Math.max(1, 0.06 * rRef), fHi = Math.max(fLo + 1, 1.1 * rRef);
        // coarse coverage of each candidate depth: covered flux × (a nudge toward sharper, larger dishes)
        for (let t = 0; t <= 10; t++) {
          const f = fLo + (fHi - fLo) * t / 10;
          let val = 0;
          for (let i = 0; i < NCELL; i++) {
            const u = -1 + 2 * (i + 0.5) / NCELL, ph = i * 2.399963;
            const sh = dirU(u, ph);
            if (!dishOK(f, sh)) continue;
            const dOm = (2 / NCELL) * 0.7;
            val += srcI(sh) * dOm;
          }
          fScan.push({ f, val });
        }
      }
      const valMax = Math.max(...fScan.map((x) => x.val));
      let fAuto = fScan[0].f;
      for (const x of fScan) if (x.val >= +S.depthKeep * valMax) fAuto = x.f;      // the deepest dish that keeps most light
      const f = +S.dishDepth > 0 ? +S.dishDepth : fAuto;
      if (!(dishR(f, dirU(-1, 0)) > 0)) return { surfaces: [], intent: [], notes: ['no usable dish direction'] };
      // facets close to the LED paint a huge, blurred image of it: keep the far part of the dish
      let rFar = 0;
      for (let i = 0; i < 1200; i++) {
        const u = -1 + 2 * (i + 0.5) / 1200, ph = i * 2.399963;
        const sh = dirU(u, ph);
        rFloor = 0;
        if (!dishOK(f, sh)) continue;
        rFar = Math.max(rFar, dishR(f, sh));
      }
      rFloor = Math.max(keep + 0.5, rFar * clamp(+S.minRfrac, 0, 0.98));
      // the smallest image the LED allows in this envelope (the scorer's own yardstick).  Facets much
      // blurrier than that cannot paint the pattern: skip them when there is still dish left to use.
      const kerMM = (RF.Photometry.achievableKernel ? RF.Photometry.achievableKernel({ source: src, target: input.target, envelope: env }).mm : 0) || 0;
      // solid angle of usable dish directions (weighted by the LED's intensity) for a given radius floor
      const cover = (rf) => {
        const keepR = rFloor; rFloor = rf;
        let sum = 0;
        for (let i = 0; i < 900; i++) {
          const u = -1 + 2 * (i + 0.5) / 900, ph = i * 2.399963;
          const sh = dirU(u, ph);
          if (dishOK(f, sh)) sum += srcI(sh) * (2 / 900) * 0.7;
        }
        rFloor = keepR;
        return sum;
      };
      const rBase = rFloor, cov0 = cover(rBase);
      // radius floor for a wanted image/achievable-image ratio (0 = none), backed off while too little dish is left
      const rFloorFor = (imgF) => {
        if (!(imgF > 0) || !(kerMM > 0) || !(cov0 > 0)) return rBase;
        let rImg = cD * srcSize / (imgF * kerMM);
        if (!(rImg > rBase) || !(rImg < rFar * 0.97)) return rBase;
        for (let t = 0; t < 12 && rImg > rBase; t++) {
          if (cover(rImg) >= 0.35 * cov0) break;
          rImg *= 0.88;
        }
        return Math.max(rBase, rImg);
      };

      // ---------------------------------------------------------------- flux of an aperture polygon
      function polyFlux(pts, n) {
        if (pts.length < 3) return 0;
        let cx = 0, cy = 0, cz = 0;
        for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
        const cen = [cx / pts.length, cy / pts.length, cz / pts.length];
        let flux = 0;
        for (let i = 0; i < pts.length; i++) {
          const A = cen, B = pts[i], C = pts[(i + 1) % pts.length];
          const e1 = V.sub(B, A), e2 = V.sub(C, A), area = 0.5 * V.len(V.cross(e1, e2));
          if (!(area > 0)) continue;
          const m1 = V.lerp(A, B, 0.5), m2 = V.lerp(B, C, 0.5), m3 = V.lerp(C, A, 0.5);
          for (const p of [m1, m2, m3]) {                        // 3-point rule: exact for linear integrands
            const d = V.sub(p, L), r = V.len(d);
            if (!(r > 1e-6)) continue;
            const sh = V.mul(d, 1 / r), cosIn = -V.dot(sh, n);
            if (cosIn <= 0) continue;
            flux += srcI(sh) * cosIn * (area / 3) / (r * r);
          }
        }
        return flux * src.power / totalInt;
      }
      // clip a convex polygon to the envelope (box: exact; other shapes: drop what does not fit)
      const INSET = Math.max(0.05, +S.inset || 0);
      function clipEnv(pts, n) {
        if (env.shape !== 'box') {
          for (const p of pts) if (!RF.Geo.envInside(env, p, -2e-3) || V.dist(p, L) < keep * 1.002) return null;
          return pts;
        }
        const ax3 = [0, 1, 2];
        let poly = pts;
        for (const a of ax3) for (const sg of [-1, 1]) {
          const lim3 = sg > 0 ? env.center[a] + env.half[a] - INSET : env.center[a] - env.half[a] + INSET;
          const out = [];
          for (let i = 0; i < poly.length; i++) {
            const P0 = poly[i], P1 = poly[(i + 1) % poly.length];
            const d0 = (P0[a] - lim3) * sg, d1 = (P1[a] - lim3) * sg;      // >0 = outside
            if (d0 <= 0) out.push(P0);
            if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
              const t = d0 / (d0 - d1);
              out.push(V.lerp(P0, P1, t));
            }
          }
          if (out.length < 3) return null;
          poly = out;
        }
        for (const p of poly) if (V.dist(p, L) < keep * 1.002) return null;
        return poly;
      }
      // the aperture of the cell whose cone corners are cdirs, on the facet plane at P with normal n
      function conePoly(P, n, cdirs) {
        const dP = V.sub(P, L), out = [];
        for (const cd of cdirs) {
          const den = V.dot(cd, n);
          if (Math.abs(den) < 1e-7) return null;
          const t = V.dot(dP, n) / den;
          if (!(t > 0)) return null;
          out.push(V.madd(L, cd, t));
        }
        return out;
      }
      // polyArea of a planar polygon (3D)
      function polyArea(pts) {
        let a = [0, 0, 0];
        for (let i = 1; i + 1 < pts.length; i++) a = V.add(a, V.cross(V.sub(pts[i], pts[0]), V.sub(pts[i + 1], pts[0])));
        return 0.5 * V.len(a);
      }
      // spotLin: wanted linear size (mm) of the patch of target this facet paints.  A facet focuses the LED
      // to a point at distance di; the target plane then sees the beam at (di vs L) defocus, so the spot is
      // max(LED image, aperture projection) and we can choose how big.
      function buildFacet(sh, cell, Z, spotLin) {
        const r = dishR(f, sh);
        if (!(r > keep + 0.3) || !isFinite(r)) return null;
        const P = V.madd(L, sh, r);
        const aim = V.norm(V.sub(Z, P));
        const n = V.norm(V.add(V.neg(sh), aim));
        const cosIn = V.dot(n, V.neg(sh));
        if (cosIn < 0.2) return null;
        let raw = conePoly(P, n, cell.cdirs);
        if (!raw) return null;
        let q = clipEnv(raw, n);
        if (!q && env.shape !== 'box') {                 // curved envelope: shrink the cell onto the wall
          let t = 0.85;
          for (let k = 0; k < 9 && !q; k++, t *= 0.82) {
            const cd = cell.cdirs.map((c2) => V.norm(V.lerp(sh, c2, t)));
            raw = conePoly(P, n, cd);
            if (raw) q = clipEnv(raw, n);
          }
        }
        if (!q || q.length < 3) return null;
        const flux = polyFlux(q, n);
        if (!(flux > 0)) return null;
        const dist = V.dist(Z, P);
        const img = (dist / Math.max(1e-6, r)) * srcSize;
        const aPerp = Math.max(1e-6, polyArea(q) * cosIn);
        let di = dist;
        if (spotLin > img) {
          const k = (spotLin - img) / Math.sqrt(aPerp);              // L/di - 1
          di = dist / (1 + k);
        }
        let rad = 0;
        for (const p of q) rad = Math.max(rad, V.dist(p, P));
        return { P, n, q, r, flux, rad, di, img, aPerp, dist, imgArea: Math.max(1e-9, img * img) };
      }

      // ---------------------------------------------------------------- tile the dish
      // find the cells (rings of uniform cos-angle, split along the azimuth where the dish is usable)
      const cellsOf = (du) => {
        const out = [];
        const NR = Math.max(1, Math.round(2 / du));
        const dU = 2 / NR;
        for (let k = 0; k < NR; k++) {
          const u0 = -1 + k * dU, u1 = u0 + dU, uc = 0.5 * (u0 + u1);
          const st = Math.sqrt(Math.max(1e-4, 1 - uc * uc));
          const dph = Math.min(TAU, dU / st);
          const M = Math.max(3, Math.round(TAU / dph)), step = TAU / M;
          // usable azimuth runs
          const NPHI = Math.max(M, 24);
          const ok = new Uint8Array(NPHI);
          for (let m = 0; m < NPHI; m++) ok[m] = dishOK(f, dirU(uc, (m + 0.5) / NPHI * TAU)) ? 1 : 0;
          if (!ok.some((x) => x)) continue;
          let m0 = -1;
          for (let m = 0; m < NPHI; m++) if (!ok[m]) { m0 = m; break; }
          const runs = [];
          if (m0 < 0) runs.push([0, TAU]);
          else for (let s = 1; s <= NPHI; s++) {
            const m = (m0 + s) % NPHI;
            if (ok[m] && !ok[(m - 1 + NPHI) % NPHI]) {
              let len = 0;
              while (len < NPHI && ok[(m + len) % NPHI]) len++;
              runs.push([(m / NPHI) * TAU, ((m + len) / NPHI) * TAU]);
            }
          }
          for (const [pa, pb] of runs) {
            const len = pb - pa;
            const mm = Math.max(1, Math.round(len / step));
            for (let j = 0; j < mm; j++) {
              const p0 = pa + len * j / mm, p1 = pa + len * (j + 1) / mm;
              out.push({ u0, u1, uc, p0, p1, sh: dirU(uc, 0.5 * (p0 + p1)) });
            }
          }
        }
        return out;
      };
      // a cell is used when its cone corners all fit the facet; make the aperture from its corners
      const cellFacet = (cell, Z, spotLin) => {
        const cdirs = [dirU(cell.u0, cell.p0), dirU(cell.u1, cell.p0), dirU(cell.u1, cell.p1), dirU(cell.u0, cell.p1)];
        cell.cdirs = cdirs;
        return buildFacet(cell.sh, cell, Z, spotLin);
      };
      // ---------------------------------------------------------------- one design at a given sharpness floor
      const nWant = Math.min(maxFacets, 2000);
      const kerCells = clamp((RF.Photometry.achievableKernel ? RF.Photometry.achievableKernel({ source: src, target: input.target, envelope: env }).cells : 3) || 1, 0.5, 40);
      const Ballow = RF.Photometry.boxBlur(paint, Rp, kerCells);
      const typLevel = sumP / Math.max(1, painted.length);
      const nearMask = (() => {                                   // unpainted cells within the gap band
        const band = Math.ceil(kerCells) + 2, R = Rp;
        const m = new Uint8Array(R * R), tmp = new Uint8Array(R * R);
        for (let k of painted) m[k] = 1;
        for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
          if (!m[j * R + i]) continue;
          for (let q = Math.max(0, i - band); q <= Math.min(R - 1, i + band); q++) tmp[j * R + q] = 1;
        }
        for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
          if (!tmp[j * R + i]) continue;
          for (let q = Math.max(0, j - band); q <= Math.min(R - 1, j + band); q++) tmp[q * R + i] |= 2;
        }
        const out = [];
        for (let k = 0; k < R * R; k++) if (!paint[k] && tmp[k] === 3) out.push(k);
        return out;
      })();
      // the score's own F1, computed on our predicted beam: share of painted cells hit within ×/÷1.25
      // (against the paint or the paint blurred by the smallest possible image) and share of the near
      // gaps left dark.  Choosing between candidate designs with this needs no ray tracing at all.
      function proxyF(D) {
        let num = 0, den = 0;
        for (const k of painted) { num += D[k]; den += paint[k]; }
        const base = den > 0 ? num / den : 0;
        if (!(base > 0)) return 0;
        let best = 0;
        for (const mul of [0.6, 0.7, 0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6]) {
          const sc = base * mul;
          let pass = 0, cnt = 0;
          for (const k of painted) {
            const rr = sc * paint[k], rb = sc * Ballow[k];
            cnt++;
            if (D[k] >= 0.8 * Math.min(rr, rb) && D[k] <= 1.25 * Math.max(rr, rb)) pass++;
          }
          const w = cnt ? pass / cnt : 0;
          const ramp = 0.3 * sc * typLevel;
          let gC = 0;
          for (const k of nearMask) {
            const allow = sc * Math.max(1.25 * Ballow[k], 0.1 * typLevel);
            if (D[k] <= allow) gC += 1;
            else if (D[k] < allow + ramp) gC += 1 - (D[k] - allow) / ramp;
          }
          const d = nearMask.length ? gC / nearMask.length : 1;
          const F = w + d > 0 ? (2 * w * d) / (w + d) : 0;
          if (F > best) best = F;
        }
        return best;
      }
      // build every facet, lay the aims out and predict the beam; returns null when nothing fits
      let facFlux = 0;
      function designOnce(rfTry) {
        rFloor = rfTry;
        let cells = [], facetsOf = [], want = 0, aimCells = [], aimPt = [], aimOf = [], groups = [], order = [], load = null;
        facFlux = 0;
        let spotLin = 0;
        {
          let du = 0.5;
          for (let it = 0; it < 6; it++) {
            cells = cellsOf(du);
            facetsOf = [];
            for (const cell of cells) {
              const fct = cellFacet(cell, T.C, 0);
              if (fct) { cell.fct = fct; facetsOf.push(cell); }
            }
            if (!facetsOf.length) break;
            const ratio = facetsOf.length / nWant;
            if (ratio < 0.75 && du > 0.06) { du *= Math.sqrt(Math.max(0.3, ratio)); continue; }
            if (ratio > 1.6) { du *= Math.sqrt(Math.min(3, ratio)); continue; }
            break;
          }
          // nothing fits the dish as configured: relax (radius floor, damping, a shallower dish) so some
          // light still reaches the paint rather than returning an empty design
          for (let att = 0; att < 3 && !facetsOf.length; att++) {
            rFloor = keep + 0.4;
            if (att) thCap = Math.min(Math.PI * 0.98, thCap * 1.25), minCosEff = Math.min(minCosEff, 0.12);
            for (let it = 0, du2 = 0.4; it < 6; it++) {
              facetsOf = [];
              for (const cell of cellsOf(du2)) {
                const fct = cellFacet(cell, T.C, 0);
                if (fct) { cell.fct = fct; facetsOf.push(cell); }
              }
              if (facetsOf.length) break;
              du2 *= 1.6;
            }
          }
          if (!facetsOf.length) return null;
          if (facetsOf.length > nWant) {                       // keep the ones that carry most light
            facetsOf.sort((a, b) => b.fct.flux - a.fct.flux);
            facetsOf.length = nWant;
          }
        }
        rFloor = rfTry;
        let paintArea = 0;
        for (const k of painted) paintArea += cellW * cellW;
        // Each facet paints a spot whose peak level is flux / spot area.  Give every facet the SAME level
        // (as high as its geometry allows) by defocusing the brighter ones: then the delivered brightness is
        // simply the number of spots covering a cell, i.e. the aim density — uniform by construction.  The
        // scale is free (the score fits a global exposure), so only this ratio matters.
        want = Math.sqrt(Math.max(0.1, +S.spotOverlap || 1) * paintArea / facetsOf.length);
        if (S.spotMode === 'level') {                                     // equal delivered level for every facet
          const cap = facetsOf.map((c) => c.fct.flux / c.fct.imgArea);
          const capS = cap.slice().sort((a, b) => a - b);
          const rho0 = capS[Math.min(capS.length - 1, Math.floor(capS.length * clamp(+S.levelPct, 0, 95) / 100))];
          let keepList = facetsOf.filter((c, i) => cap[i] >= rho0 * 0.999);
          if (keepList.length < Math.min(12, facetsOf.length)) keepList = facetsOf.slice();
          facetsOf.length = 0; facetsOf.push(...keepList);
          for (const c of facetsOf) c.spotLin = Math.sqrt(Math.max(c.fct.imgArea, c.fct.flux / rho0));
        } else {                                                          // one common spot size
          for (const c of facetsOf) c.spotLin = Math.max(Math.sqrt(c.fct.imgArea), want);
        }
        spotLin = facetsOf.reduce((s, c) => s + c.spotLin, 0) / facetsOf.length;
        facFlux = facetsOf.reduce((s, c) => s + c.fct.flux, 0);

        // ---------------------------------------------------------------- aims
        // Every facet throws a patch of light of known size and flux onto the target, so the delivered
        // pattern can be *predicted* (a box the size of that facet's spot, holding its flux).  The aims are
        // then chosen greedily: the brightest facet paints wherever the predicted pattern is furthest below
        // the painting (and, at negative target, furthest above the dark gaps).  This is the deconvolution
        // done numerically — extra flux lands just inside an edge, nothing lands outside the paint — and it
        // keeps neighbours' spots complementary instead of stacking where the density happens to be high.
        const blurs = facetsOf.map((c) => (V.dist(T.C, c.fct.P) / Math.max(1e-6, c.fct.r)) * srcSize).sort((a, b) => a - b);
        const blurMM = blurs[blurs.length >> 1] * (+S.kernelScale || 1);
        const wCells = blurMM / cellW;
        aimCells = [];
        aimPt = [];
        if (S.aimMode === 'density') {
          // simple: aims spread over the painted cells in proportion to the paint (optionally deconvolved)
          const dens = deconvolve(paint, Rp, wCells, Math.round(+S.deconv || 0), 6);
          const nAim = Math.max(1, facetsOf.length);
          let densSum = 0;
          for (const k of painted) densSum += dens[k];
          const scale = densSum > 0 ? nAim / densSum : 0;
          let acc = 0, row = 0;
          const rows = [];
          for (const k of painted) { const j = (k / Rp) | 0; (rows[j] || (rows[j] = [])).push(k); }
          for (let j = 0; j < Rp; j++) {
            const list = rows[j];
            if (!list) continue;
            if (row++ & 1) list.reverse();
            for (const k of list) { acc += dens[k] * scale; while (acc >= 1 - 1e-9) { acc -= 1; aimCells.push(k); } }
          }
          if (aimCells.length > nAim) aimCells.length = nAim;
          else if (aimCells.length < nAim) {
            const ord = painted.slice().sort((a, b) => dens[b] - dens[a] || a - b);
            for (let q = 0; aimCells.length < nAim; q++) aimCells.push(ord[q % ord.length]);
          }
          for (const q of facetsOf) q.aim = 0;
          aimCells.forEach((k, q) => { facetsOf[q % facetsOf.length].aim = q; });
        } else {
          const n = Rp * Rp;
          const typ = sumP / Math.max(1, painted.length);                  // a typical painted cell's level
          const alpha = facFlux / Math.max(1e-12, sumP);                  // target level per unit paint weight
          const Tk = new Float64Array(n), D = new Float64Array(n);
          for (const k of painted) Tk[k] = paint[k] * alpha;
          const gapPen = 0.10 * typ * alpha;                               // dark gaps must stay under ~10%
          // the scorer forgives spill where the painting's own (smallest possible) image reaches: give those
          // cells a neutral target so an aim may sit at an edge without the greedy penalising it
          const kerCells = clamp((RF.Photometry.achievableKernel ? RF.Photometry.achievableKernel({ source: src, target: input.target, envelope: env }).cells : wCells) || 1, 0.5, 40);
          const Ballow = RF.Photometry.boxBlur(paint, Rp, kerCells);
          const nearBoost = clamp(+S.nearBoost || 0, 0, 2);
          const ord = facetsOf.map((c, i) => i).sort((x, y) => facetsOf[y].fct.flux - facetsOf[x].fct.flux || x - y);
          const SAT = new Float64Array((Rp + 1) * (Rp + 1));
          const stamp = (Dg, c, sCells, lvl, R, sgn) => {
            const i0 = Math.max(0, Math.round(c.aimCell % R + 0.5 - sCells / 2)), i1 = Math.min(R, Math.round(c.aimCell % R + 0.5 + sCells / 2));
            const j0 = Math.max(0, Math.round((c.aimCell - (c.aimCell % R)) / R + 0.5 - sCells / 2)), j1 = Math.min(R, Math.round((c.aimCell - (c.aimCell % R)) / R + 0.5 + sCells / 2));
            for (let j = j0; j < j1; j++) for (let ii = i0; ii < i1; ii++) Dg[j * R + ii] += sgn * lvl;
          };
          const rebuildSAT = () => {
            const W = Rp + 1;
            for (let j = 0; j < Rp; j++) {
              let rowsum = 0;
              for (let ii = 0; ii < Rp; ii++) {
                const k = j * Rp + ii;
                const gp = Ballow[k] > 0 ? -gapPen * (1 - nearBoost) + nearBoost * 1.25 * Ballow[k] * alpha : -gapPen;
                rowsum += (paint[k] > 0 ? Tk[k] - D[k] : gp - D[k]);
                SAT[(j + 1) * W + ii + 1] = SAT[j * W + ii + 1] + rowsum;
              }
            }
          };
          for (const i of ord) {
            const c = facetsOf[i];
            const sCells = Math.max(1, c.spotLin / cellW), hs = sCells / 2;
            rebuildSAT();
            const boxSum = (ci, cj) => {
              const i0 = Math.max(0, Math.round(ci - hs)), i1 = Math.min(Rp, Math.round(ci + hs));
              const j0 = Math.max(0, Math.round(cj - hs)), j1 = Math.min(Rp, Math.round(cj + hs));
              if (i1 <= i0 || j1 <= j0) return -Infinity;
              const W = Rp + 1;
              return SAT[j1 * W + i1] - SAT[j0 * W + i1] - SAT[j1 * W + i0] + SAT[j0 * W + i0];
            };
            let bi = 0, bj = 0, best = -Infinity;
            for (let j = 0; j < Rp; j++) for (let ii = 0; ii < Rp; ii++) {
              const v = boxSum(ii + 0.5, j + 0.5);
              if (v > best + 1e-12) { best = v; bi = ii; bj = j; }
            }
            c.aimCell = bj * Rp + bi;
            const lvl = c.fct.flux / (sCells * sCells);
            stamp(D, c, sCells, lvl, Rp, +1);
          }
          // coordinate refinement: lift each spot out and drop it where the predicted pattern wants it most
          for (let pass = 0; pass < Math.round(+S.refine || 0); pass++) {
            const seq = ord.slice();
            if (pass & 1) seq.reverse();
            for (const i of seq) {
              const c = facetsOf[i];
              const sCells = Math.max(1, c.spotLin / cellW);
              const lvl = c.fct.flux / (sCells * sCells);
              stamp(D, c, sCells, lvl, Rp, -1);
              rebuildSAT();
              const hs = sCells / 2;
              const boxSum = (ci, cj) => {
                const i0 = Math.max(0, Math.round(ci - hs)), i1 = Math.min(Rp, Math.round(ci + hs));
                const j0 = Math.max(0, Math.round(cj - hs)), j1 = Math.min(Rp, Math.round(cj + hs));
                if (i1 <= i0 || j1 <= j0) return -Infinity;
                const W = Rp + 1;
                return SAT[j1 * W + i1] - SAT[j0 * W + i1] - SAT[j1 * W + i0] + SAT[j0 * W + i0];
              };
              const ci0 = c.aimCell % Rp, cj0 = (c.aimCell - ci0) / Rp;
              let bi = ci0, bj = cj0, best = -Infinity;
              for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
                const ii = ci0 + di, jj = cj0 + dj;
                if (ii < 0 || jj < 0 || ii >= Rp || jj >= Rp) continue;
                const v = boxSum(ii + 0.5, jj + 0.5) - (dj === 0 && di === 0 ? 0 : 1e-9 * Math.abs(di + dj));
                if (v > best + 1e-12) { best = v; bi = ii; bj = jj; }
              }
              c.aimCell = bj * Rp + bi;
              stamp(D, c, sCells, lvl, Rp, +1);
            }
          }
          ord.forEach((i, q) => { aimCells.push(facetsOf[i].aimCell); aimOf[i] = q; });
        }
        const jit = clamp(+S.aimJitter || 0, 0, 1);
        for (let q = 0; q < aimCells.length; q++) {
          const k = aimCells[q], i = k % Rp, j = (k - i) / Rp;
          const u = -T.half + (i + 0.5 + (h01(i, j, q) - 0.5) * jit) * cellW;
          const v = -T.half + (j + 0.5 + (h01(j, i, q + 977) - 0.5) * jit) * cellW;
          aimPt.push(RF.Engine.targetUVtoWorld(T, u, v));
        }
        // which facet paints which aim
        if (S.aimMode === 'density') {                          // one facet per aim, in order
          aimOf = new Array(facetsOf.length).fill(0);
          for (let q = 0; q < aimCells.length; q++) aimOf[q % facetsOf.length] = q;
        }
        // predicted beam at the aims (for the design yardstick, in both aim modes)
        const Dpred = new Float64Array(Rp * Rp);
        for (const c of facetsOf) {
          const sCells = Math.max(1, c.spotLin / cellW), lvl = c.fct.flux / (sCells * sCells);
          const k = c.aimCell === undefined ? 0 : c.aimCell;
          const i0 = Math.max(0, Math.round(k % Rp + 0.5 - sCells / 2)), i1 = Math.min(Rp, Math.round(k % Rp + 0.5 + sCells / 2));
          const j0 = Math.max(0, Math.round(Math.floor(k / Rp) + 0.5 - sCells / 2)), j1 = Math.min(Rp, Math.round(Math.floor(k / Rp) + 0.5 + sCells / 2));
          for (let j = j0; j < j1; j++) for (let ii = i0; ii < i1; ii++) Dpred[j * Rp + ii] += lvl;
        }
        let onPaint = 0;
        for (const k of painted) onPaint += Dpred[k];
        onPaint /= Math.max(1e-12, src.power);
        return { facetsOf, aimCells, aimPt, aimOf, D: Dpred, proxy: proxyF(Dpred) + clamp(+S.lightBias, 0, 5) * onPaint, onPaint, blurMM, spotLin, wCells, flux: facFlux };
      }

      // ---------------------------------------------------------------- pick the sharpest design that still
      // paints the pattern (the trade-off is always: sharper images need facets farther from the LED, and
      // fewer of those see the LED at all)
      let bestD = null;
      const imgPin = +S.imgFactor || 0;
      const grid = imgPin > 0 ? [imgPin] : [9, 6.5, 5, 3.5, 2.2];
      const tried = [];
      for (const g of grid) {
        const rf = rFloorFor(g);
        if (tried.some((x) => Math.abs(x - rf) < 0.05)) continue;
        tried.push(rf);
        const d = designOnce(rf);
        if (!d || !d.facetsOf.length) continue;
        if (!bestD || d.proxy > bestD.proxy + 1e-4) { bestD = d; bestD.imgF = g; }
      }
      if (!bestD) return { surfaces: [], intent: [], notes: ['no facet fits the envelope on the dish'] };
      const facetsOf = bestD.facetsOf, aimCells = bestD.aimCells, aimPt = bestD.aimPt, aimOf = bestD.aimOf;
      const blurMM = bestD.blurMM, spotLin = bestD.spotLin, wCells = bestD.wCells;
      facFlux = bestD.flux;
      // ---------------------------------------------------------------- final geometry
      const surfaces = [], intent = [];
      for (let i = 0; i < facetsOf.length && surfaces.length < maxFacets; i++) {
        const q = aimOf[i];
        if (!(q >= 0) || q >= aimPt.length) continue;
        const cell = facetsOf[i];
        const g = cellFacet(cell, aimPt[q], cell.spotLin);
        if (!g) continue;
        const id = 'F' + surfaces.length;
        surfaces.push({
          type: 'facet', id, group: 'A', P: g.P, S0: L, Z: aimPt[q], di: g.di, flat: false,
          clip: { kind: 'poly', pts3: g.q, ref: cell.sh },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        });
        intent.push({ facet: id, cells: [[aimCells[q], g.flux / Math.max(1e-12, facFlux)]] });
      }

      notes.push(surfaces.length + ' facets on a dish f=' + f.toFixed(1) + ' mm (' + (S.dishDepth > 0 ? 'set' : 'auto'), 'caught ' + (100 * facFlux / src.power).toFixed(1) + '% of the LED, ' + aimPt.length + ' aims');
      notes.push('image blur picked ' + bestD.imgF + '× best, facets from r=' + (bestD.rFloor || rFloor).toFixed(0) + ' mm; facet distance ' + (rFloor).toFixed(0) + '…' + rFar.toFixed(0) + ' mm, image ' + blurMM.toFixed(1) + ' mm (' + wCells.toFixed(1) + ' cells), spot ' + spotLin.toFixed(1) + ' mm, dish direction ' + V.toAzEl(a0).map((x) => x.toFixed(0)).join('/') + '°, polar cap ' + (thCap / D2R).toFixed(0) + '°');
      return { surfaces, intent, notes };
  }

  /* ------------------------------------------------------------------ the tuner (optional)
   * `facetbowl-auto` runs the same static design at a handful of settings, traces each with the real
   * engine and keeps the one that best meets the chosen goal.  It is allowed to trace (the task exempts
   * ids ending in -auto), it uses ONE seed for every candidate, so candidates differ by geometry and not
   * by dice, and it returns a static-solver design unchanged — so the envelope, the LED clearance and the
   * facet budget hold exactly as they do for `facetbowl`. */
  const GOALS = [
    { value: 'faithful', label: 'faithful: the painting, exactly' },
    { value: 'throw', label: 'throw: the most intense spot' },
    { value: 'efficient', label: 'efficient: the most light on the paint' },
  ];
  // the axes that actually trade against each other: image sharpness (how far the facets sit ⇒ how much
  // light they can still catch), how big a patch each facet paints, and how far round the LED we go
  const CANDIDATES = [
    { imgFactor: 2.2, spotOverlap: 4, maxTheta: 75 },
    { imgFactor: 3.5, spotOverlap: 4, maxTheta: 75 },
    { imgFactor: 5, spotOverlap: 5, maxTheta: 75 },
    { imgFactor: 6.5, spotOverlap: 5, maxTheta: 75 },
    { imgFactor: 9, spotOverlap: 5, maxTheta: 75 },
    { imgFactor: 9, spotOverlap: 5, maxTheta: 85 },
    { imgFactor: 9, spotOverlap: 2.5, maxTheta: 85 },
    { imgFactor: 6.5, spotOverlap: 3.5, maxTheta: 80, depthKeep: 0.6 },
    { imgFactor: 0, spotOverlap: 5, maxTheta: 75 },          // the static solver's own choice
  ];
  RF.Solvers.register({
    id: 'bench-particle1-r3--facetbowl-auto', name: 'Facet dish (auto-tuned)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: GOALS, default: 'faithful' },
      { key: 'rays', label: 'Rays per candidate test', type: 'number', min: 20000, max: 400000, step: 10000, default: 120000 },
    ],
    solve(input, settings, tools) {
      const seed = (input.seed | 0) || 1;
      const rays = Math.max(20000, Math.min(400000, +settings.rays || 120000));
      const goal = settings.goal;
      let best = null, bestScore = -Infinity, fallback = null;
      const log = [];
      for (let i = 0; i < CANDIDATES.length; i++) {
        const c = CANDIDATES[i];
        const st = Object.assign({}, DEFAULTS, { minDistance: +settings.minDistance || 0 }, c);
        let out;
        try { out = designSolve(input, st); } catch (e) { continue; }
        if (!out || !out.surfaces.length) continue;
        if (!fallback) fallback = out;
        let tr = null;
        try { tr = tools.trace(out.surfaces, { rays, seed }); } catch (e) { tr = null; }
        if (!tr || !tr.fidelity) continue;
        const f = tr.fidelity;
        // goal score: the goal's own quantity, each with the fidelity floor that keeps a beam that
        // does not look like the painting from winning on brightness alone
        const gate = clamp(((f.fidelity || 0) - 0.40) / 0.20, 0, 1);
        const sc = goal === 'throw' ? (tr.peakCd || 0) * (0.25 + 0.75 * gate)
          : goal === 'efficient' ? (f.onPaint || 0) * (0.25 + 0.75 * gate)
          : (f.fidelity || 0) * Math.min(1, (f.onPaint || 0) / 0.08);
        log.push('candidate ' + i + ' (imgFactor ' + c.imgFactor + ', spot ' + c.spotOverlap + ', θ ' + c.maxTheta + '°): ' +
          'fidelity ' + (100 * (f.fidelity || 0)).toFixed(1) + '%, on paint ' + (100 * (f.onPaint || 0)).toFixed(1) +
          '%, peak ' + Math.round(tr.peakCd || 0) + ' cd → ' + sc.toFixed(2));
        if (sc > bestScore) { bestScore = sc; best = out; }
      }
      if (!best) best = fallback || designSolve(input, Object.assign({}, DEFAULTS, { minDistance: +settings.minDistance || 0 }));
      const chosen = best === fallback && !(best.notes || []).length ? 'fallback' : 'best';
      best.notes = ['auto: goal ' + goal + ' → ' + chosen + ' score ' + (isFinite(bestScore) ? bestScore.toFixed(2) : '—') + ', ' + CANDIDATES.length + ' candidates, ' + rays + ' rays each']
        .concat(best.notes || []).concat(log);
      return best;
    },
  });
})();
