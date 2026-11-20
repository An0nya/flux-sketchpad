/* solvers/solver.js — Non-blocking astigmatic mosaic reflector solver for Flux.
 *
 * Pure static optical geometry (zero ray-tracing inside solve()):
 *   1. Fits a smooth, outward-flaring generalized paraboloid shell r(α, φ) = 2 f(α, φ) / (1 − cos α)
 *      with ∂f/∂α ≤ 0 around the throw axis so adjacent facets have zero mutual shadowing from S0 and
 *      zero step-backface blocking of reflected rays, while balancing flux capture against LED pinhole
 *      image sharpness relative to the painting's stroke/gap geometry.
 *   2. Partitions the active emission cone into M ≤ maxFacets convex spherical quads of equal LED flux.
 *   3. Decomposes the painted target (with optional plateau + hotspot layer splitting and connected-component
 *      recursive flux-exact KD tiling), matches shell facets to target tiles via full 2×2 anisotropic LED
 *      image covariance (Jonker-Volgenant assignment), sets astigmatic Coddington vergences vg = [v1, v2],
 *      and runs fast deterministic analytical trapezoid deconvolution passes on the paint grid.
 *   4. Validates and trims every compiled quadric surface against the exact envelope and emitter clearances.
 */
(function () {
  'use strict';
  const V = RF.V, Geo = RF.Geo, Src = RF.Source, Eng = RF.Engine, Phot = RF.Photometry, U = RF.U;

  // ------------------------------------------------------------------ 1. 2D Paint Geometry & Features
  function chamferSignedDist(paint, R) {
    const n = R * R, INF = 1e6;
    const dIn = new Float32Array(n), dOut = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (paint[k] > 0) { dIn[k] = INF; dOut[k] = 0; }
      else { dIn[k] = 0; dOut[k] = INF; }
    }
    const pass = (d, borderZero) => {
      const s2 = Math.SQRT2;
      const at = (i, j) => (i < 0 || j < 0 || i >= R || j >= R ? (borderZero ? 0 : INF) : d[j * R + i]);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
        const k = j * R + i; if (d[k] === 0) continue;
        d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + s2, at(i + 1, j - 1) + s2);
      }
      for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) {
        const k = j * R + i; if (d[k] === 0) continue;
        d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + s2, at(i - 1, j + 1) + s2);
      }
    };
    // Target borders are NOT dark gaps (light past the target edge escapes, never penalizes gapsDark)
    pass(dIn, false);
    pass(dOut, false);
    const sd = new Float32Array(n);
    for (let k = 0; k < n; k++) sd[k] = paint[k] > 0 ? dIn[k] - 0.5 : -(dOut[k] - 0.5);
    const hasUnpainted = paint.some((w) => !(w > 0));
    return { sd, hasUnpainted };
  }

  function analyzePaint(paint, R, T, S0, kerCells) {
    const n = R * R, cellSize = (2 * T.half) / R;
    let pSum = 0, pMax = 0, nPaint = 0, uSum = 0, vSum = 0;
    const vals = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = paint[j * R + i];
      if (!(w > 0)) continue;
      nPaint++; pSum += w; if (w > pMax) pMax = w;
      const u = -T.half + (i + 0.5) * cellSize, v = -T.half + (j + 0.5) * cellSize;
      uSum += w * u; vSum += w * v;
      vals.push(w);
    }
    if (!nPaint || !(pSum > 0)) return { empty: true };
    vals.sort((a, b) => a - b);
    const uCenter = uSum / pSum, vCenter = vSum / pSum;
    const ZCenter = Eng.targetUVtoWorld(T, uCenter, vCenter);
    const t0 = V.norm(V.sub(ZCenter, S0)), L0 = V.dist(ZCenter, S0);

    // Orthonormal frame (t0, e1, e2) with e1 aligned with target +u, e2 with target +v
    let e1 = V.sub(T.tu, V.mul(t0, V.dot(T.tu, t0)));
    if (V.len(e1) < 1e-6) e1 = V.basis(t0)[0]; else e1 = V.norm(e1);
    let e2 = V.cross(t0, e1);
    if (V.dot(e2, T.tv) < 0) { e2 = V.neg(e2); e1 = V.cross(e2, t0); }

    // Maximum angular half-cone of painted cells around t0 as seen from S0
    let maxBeta = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      if (!(paint[j * R + i] > 0)) continue;
      const u = -T.half + (i + 0.5) * cellSize, v = -T.half + (j + 0.5) * cellSize;
      const Z = Eng.targetUVtoWorld(T, u, v), d = V.norm(V.sub(Z, S0));
      const ang = Math.acos(U.clamp(V.dot(d, t0), -1, 1));
      if (ang > maxBeta) maxBeta = ang;
    }

    const { sd, hasUnpainted } = chamferSignedDist(paint, R);
    // Ridge / skeleton widths of painted features
    const ridge = [];
    let maxSd = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i; if (!(paint[k] > 0)) continue;
      const s = sd[k]; if (s > maxSd) maxSd = s;
      let isPeak = true;
      for (let b = -1; b <= 1 && isPeak; b++) for (let a = -1; a <= 1; a++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < R && jj < R && sd[jj * R + ii] > s + 1e-4) { isPeak = false; break; }
      }
      if (isPeak) ridge.push(2 * s);
    }
    ridge.sort((a, b) => a - b);
    const medStrokeCells = ridge.length ? ridge[Math.floor(0.5 * (ridge.length - 1))] : 2 * maxSd;
    const p75StrokeCells = ridge.length ? ridge[Math.floor(0.75 * (ridge.length - 1))] : 2 * maxSd;
    const featCells = Math.max(kerCells * 1.25, Math.min(2 * maxSd, 0.6 * medStrokeCells + 0.4 * p75StrokeCells));
    const featMm = Math.max(cellSize, featCells * cellSize);

    const pTyp = pSum / nPaint;
    const p20 = vals[Math.floor(0.20 * (vals.length - 1))];
    let plateauCount = 0, boostCount = 0, boostMass = 0;
    const boostMask = new Float32Array(n);
    for (let k = 0; k < n; k++) if (paint[k] > 0) {
      if (paint[k] >= 0.85 * p20 && paint[k] <= 1.15 * p20) plateauCount++;
      if (paint[k] > 1.35 * p20) { boostCount++; boostMass += paint[k] - p20; boostMask[k] = paint[k] - p20; }
    }
    const hasHotspotLayer = plateauCount >= 0.35 * nPaint && boostCount >= 1 && pMax >= 1.5 * p20 && boostMass >= 0.04 * pSum;
    let hotspotWidthMm = Infinity;
    if (hasHotspotLayer) {
      const bsd = chamferSignedDist(boostMask, R).sd;
      let bMax = 0;
      for (let k = 0; k < n; k++) if (boostMask[k] > 0 && bsd[k] > bMax) bMax = bsd[k];
      if (bMax > 0) hotspotWidthMm = Math.max(2 * cellSize, 2 * bMax * cellSize);
    }

    return {
      empty: false, nPaint, pSum, pMax, pTyp, p20, hasHotspotLayer, boostMass, hotspotWidthMm,
      uCenter, vCenter, ZCenter, t0, L0, e1, e2, maxBeta,
      sd, hasUnpainted: nPaint < n && hasUnpainted, cellSize,
      medStrokeCells, maxSd, maxPaintWidthMm: 2 * maxSd * cellSize, featCells, featMm, kerCells, kerMm: kerCells * cellSize,
    };
  }

  // ------------------------------------------------------------------ 2. Source Helpers (Multi-Emitter Safe)
  function buildSourceModel(sources) {
    const totP = sources.reduce((a, s) => a + Math.max(0, s.power || 0), 0) || 1;
    let S0 = [0, 0, 0];
    for (const s of sources) { const w = Math.max(0, s.power || 0) / totP; S0 = V.madd(S0, s.pos, w); }
    const parts = sources.map((s) => {
      const area = Src.emittingArea(s);
      const effSide = area > 0 ? Math.sqrt(area) : Src.extentSize(s);
      return {
        src: s, w: Math.max(0, s.power || 0) / totP,
        fr: Src.frame(s), totI: Src.totalIntegral(s) || 1, cov: Src.extentCov(s),
        size: Src.extentSize(s), effSide, planar: s.kind === 'planar',
      };
    });
    // Combined world 3x3 covariance around S0
    const C = new Array(9).fill(0);
    for (const p of parts) {
      const d = V.sub(p.src.pos, S0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] += p.w * (p.cov[3 * i + j] + d[i] * d[j]);
    }
    // Normalized angular density dP/dOmega(u) (integrates to 1 over sphere)
    function dirDensity(u) {
      let s = 0;
      for (const p of parts) {
        const ct = U.clamp(V.dot(u, p.fr.a), -1, 1);
        const I = Src.intensity(p.src, Math.acos(ct));
        if (I > 0) s += p.w * (I / p.totI);
      }
      return s;
    }
    // Characteristic geometric-mean image width at distance r, target distance L0, along direction u
    function imageWidthMm(u, r, L0) {
      let w2 = 0;
      for (const p of parts) {
        const ct = Math.abs(V.dot(u, p.fr.a));
        const eff = p.effSide * (p.planar ? Math.sqrt(Math.max(0.16, ct)) : 1);
        w2 += p.w * eff * eff;
      }
      return (L0 / Math.max(1e-3, r)) * Math.sqrt(w2);
    }
    return { S0, totP, parts, cov3: C, dirDensity, imageWidthMm };
  }

  // Exact 2x2 source-image covariance on target (u, v) for a facet at P aiming at Z
  function sourceTargetCov(cov3, S0, P, Z, T) {
    const sv = V.sub(S0, P), r = V.len(sv) || 1, sh = V.mul(sv, 1 / r);
    const av = V.sub(Z, P), L = V.len(av) || 1, ah = V.mul(av, 1 / L);
    const n = V.norm(V.add(sh, ah));
    const aDotN = V.dot(ah, T.n);
    const invAN = Math.abs(aDotN) > 1e-6 ? 1 / aDotN : -1;
    // Columns of 2x3 Jacobian J_S mapping ds -> (du, dv)
    const J = [[0, 0, 0], [0, 0, 0]];
    for (let c = 0; c < 3; c++) {
      const ds = [c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0];
      const dsp = V.sub(ds, V.mul(sh, V.dot(ds, sh)));
      const din = V.mul(dsp, -1 / r);
      const dout = V.sub(din, V.mul(n, 2 * V.dot(din, n)));
      const dX = V.mul(V.sub(dout, V.mul(ah, V.dot(dout, T.n) * invAN)), L);
      J[0][c] = V.dot(dX, T.tu);
      J[1][c] = V.dot(dX, T.tv);
    }
    let suu = 0, suv = 0, svv = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const cij = cov3[3 * i + j];
      suu += J[0][i] * cij * J[0][j];
      suv += J[0][i] * cij * J[1][j];
      svv += J[1][i] * cij * J[1][j];
    }
    return [Math.max(0, suu), suv, Math.max(0, svv)];
  }

  // ------------------------------------------------------------------ 3. Radial Room & Optimal Non-Blocking Shell
  function makeEnvShrink(env, shrink) {
    return Object.assign({}, env, { half: env.half.map((h) => Math.max(0.5, Math.min(h * shrink, h - 0.5))) });
  }

  function makeKeepBalls(sources, env, minDist) {
    const keepBase = Math.max(env.keepOut || 0, minDist || 0);
    const balls = [];
    for (const s of sources) {
      const rSafe = keepBase + 0.12;
      balls.push({ c: s.pos.slice(), r: rSafe });
      // If source was domed with dome.z != 0, apparent() may have shifted pos along axis; guard along axis too
      if (s.domeMag) {
        const fr = Src.frame(s), rDome = (env.keepOut || 0) + 1.2;
        balls.push({ c: V.madd(s.pos, fr.a, -0.8), r: rDome });
        balls.push({ c: V.madd(s.pos, fr.a, 0.8), r: rDome });
      }
    }
    return { keepBase, balls };
  }

  // Valid radial interval [rLo, rHi] from S0 along unit dir inside shrunk envelope, Voronoi bay planes & outside keep balls
  function radialRoom(envS, S0, dir, balls, bayPlanes) {
    const iv = Geo.envInterval(envS, S0, dir);
    let lo = Math.max(0.2, iv[0]), hi = iv[1];
    if (!(hi > lo)) return null;
    if (bayPlanes && bayPlanes.length) {
      for (let p = 0; p < bayPlanes.length; p++) {
        const pl = bayPlanes[p]; // (S0 + t*dir - pl.p) · pl.n <= 0
        const b = V.dot(V.sub(S0, pl.p), pl.n), a = V.dot(dir, pl.n);
        if (Math.abs(a) < 1e-12) { if (b > 0) return null; continue; }
        const t = -b / a;
        if (a > 0) hi = Math.min(hi, t);
        else lo = Math.max(lo, t);
        if (!(hi > lo + 0.1)) return null;
      }
    }
    for (let b = 0; b < balls.length; b++) {
      const C = balls[b].c, R = balls[b].r;
      const ox = S0[0] - C[0], oy = S0[1] - C[1], oz = S0[2] - C[2];
      const B = 2 * (ox * dir[0] + oy * dir[1] + oz * dir[2]);
      const K = ox * ox + oy * oy + oz * oz - R * R;
      const disc = B * B - 4 * K;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc), t1 = 0.5 * (-B - sq), t2 = 0.5 * (-B + sq);
      if (t2 <= lo || t1 >= hi) continue;
      if (t1 <= lo && t2 >= hi) return null;
      if (t1 <= lo) lo = t2;
      else if (t2 >= hi) hi = t1;
      else {
        // Ball splits interval in two: keep the farther sub-interval if it has room (sharper image!)
        if (hi - t2 >= t1 - lo) lo = t2; else hi = t1;
      }
      if (!(hi > lo + 0.1)) return null;
    }
    return [lo, hi];
  }

  function fitShell(srcMod, pa, env, sources, settings, bayPlanes) {
    const S0 = srcMod.S0, t0 = pa.t0, e1 = pa.e1, e2 = pa.e2;
    const envS = makeEnvShrink(env, 0.98);
    const { keepBase, balls } = makeKeepBalls(sources, env, settings.minDistance);
    const alphaMin = Math.max(18 * Math.PI / 180, Math.min(65 * Math.PI / 180, 2 * pa.maxBeta + 4 * Math.PI / 180));
    const NA = 72, NP = 72;
    const dAlpha = (Math.PI - alphaMin) / NA, dPhi = (2 * Math.PI) / NP;

    // Precompute room and source flux weight on (NA x NP) grid
    const rLo = new Float32Array(NA * NP), rHi = new Float32Array(NA * NP), wFlux = new Float32Array(NA * NP);
    const alphas = new Float64Array(NA), cosA = new Float64Array(NA), sinA = new Float64Array(NA);
    const uGrid = new Float64Array(NA * NP * 3);
    let rEnvMax = 1, totSphereFlux = 0, wBest = Infinity;
    for (let a = 0; a < NA; a++) {
      const al = alphaMin + (a + 0.5) * dAlpha;
      alphas[a] = al; cosA[a] = Math.cos(al); sinA[a] = Math.sin(al);
    }
    for (let b = 0; b < NP; b++) {
      const ph = (b + 0.5) * dPhi, cp = Math.cos(ph), sp = Math.sin(ph);
      const rad = [cp * e1[0] + sp * e2[0], cp * e1[1] + sp * e2[1], cp * e1[2] + sp * e2[2]];
      for (let a = 0; a < NA; a++) {
        const ca = cosA[a], sa = sinA[a];
        const u = [ca * t0[0] + sa * rad[0], ca * t0[1] + sa * rad[1], ca * t0[2] + sa * rad[2]];
        const idx = a * NP + b, q = 3 * idx;
        uGrid[q] = u[0]; uGrid[q + 1] = u[1]; uGrid[q + 2] = u[2];
        const dens = srcMod.dirDensity(u);
        const wf = dens * sa * dAlpha * dPhi;
        wFlux[idx] = wf;
        totSphereFlux += wf;
        const rm = radialRoom(envS, S0, u, balls, bayPlanes);
        if (rm) {
          rLo[idx] = rm[0]; rHi[idx] = rm[1];
          if (rm[1] > rEnvMax) rEnvMax = rm[1];
          if (wf > 0) {
            const wb = srcMod.imageWidthMm(u, 0.92 * rm[1], pa.L0);
            if (wb < wBest) wBest = wb;
          }
        }
      }
    }
    if (!isFinite(wBest)) wBest = pa.kerMm;

    // Quality weight of placing a facet at distance r along direction u
    const hasGaps = pa.hasUnpainted;
    const cullScale = settings.glareCull !== undefined ? settings.glareCull : 1.0;
    // Maximum usable LED image width before flat-top glare spills beyond paint + halo into dark gaps
    const wUsable = hasGaps
      ? cullScale * Math.max(1.25 * pa.maxPaintWidthMm + 1.50 * pa.kerMm, 1.85 * wBest)
      : Infinity;

    let Wres = hasGaps
      ? Math.min(pa.featMm, Math.max(2.2 * pa.kerMm, 3.5 * pa.cellSize))
      : 0.28 * (pa.cellSize * (pa.sd.length > 0 ? Math.sqrt(pa.sd.length) : 100));
    if (pa.hasHotspotLayer && isFinite(pa.hotspotWidthMm)) Wres = Math.min(Wres, 1.15 * pa.hotspotWidthMm);
    Wres = Math.max(pa.cellSize, Wres);

    function sharpQuality(u, r) {
      const mild = 1 + 0.30 * Math.min(1, r / rEnvMax);
      const wImg = srcMod.imageWidthMm(u, r, pa.L0);
      const eta = Wres / Math.max(Wres, wImg);
      const base = (hasGaps ? eta * eta * eta : eta * eta) * mild;
      return wImg <= wUsable ? base : base * 0.04 * Math.pow(wUsable / wImg, 2);
    }

    // Search f_apex and smooth azimuthal flare f_rim(phi) >= f_apex (up to 3.0x for off-center LEDs!)
    const fMin = Math.max(1.2, 0.25 * Math.max(1, keepBase));
    const fMax = Math.max(fMin * 2, rEnvMax * 1.05);
    const NF = 34;
    const cands = [];
    let maxUsableFlux = 0, maxRawFlux = 0;

    for (let fi = 0; fi < NF; fi++) {
      const fApex = fMin * Math.pow(fMax / fMin, fi / (NF - 1));
      const rawRim = new Float64Array(NP);
      for (let b = 0; b < NP; b++) {
        let bestCol = -1, bestM = 1.0;
        for (let mi = 0; mi < 11; mi++) {
          const m = 1.0 + 0.20 * mi, fRim = fApex * m;
          let sc = 0;
          for (let a = 0; a < NA; a++) {
            const idx = a * NP + b, wf = wFlux[idx];
            if (!(wf > 0) || !(rHi[idx] > 0)) continue;
            const ca = cosA[a], f = fApex + (fRim - fApex) * 0.5 * (1 + ca);
            const r = (2 * f) / (1 - ca);
            if (r >= rLo[idx] && r <= rHi[idx]) {
              const q = 3 * idx;
              sc += wf * sharpQuality([uGrid[q], uGrid[q + 1], uGrid[q + 2]], r);
            }
          }
          if (sc > bestCol) { bestCol = sc; bestM = m; }
        }
        rawRim[b] = fApex * bestM;
      }
      // Circular Gaussian smooth rawRim over phi so azimuthal curvature stays gentle, floored at fApex
      const smRim = new Float64Array(NP);
      for (let b = 0; b < NP; b++) {
        let sw = 0, sf = 0;
        for (let d = -6; d <= 6; d++) {
          const w = Math.exp(-0.5 * (d / 3.0) * (d / 3.0));
          sw += w; sf += w * rawRim[(b + d + NP) % NP];
        }
        smRim[b] = Math.max(fApex, sf / sw);
      }
      // Evaluate usable flux, raw flux, and resolution-weighted score of (fApex, smRim)
      let totSc = 0, rawFl = 0, usableFl = 0;
      for (let a = 0; a < NA; a++) {
        const ca = cosA[a], half1p = 0.5 * (1 + ca), denom = 1 - ca;
        for (let b = 0; b < NP; b++) {
          const idx = a * NP + b, wf = wFlux[idx];
          if (!(wf > 0) || !(rHi[idx] > 0)) continue;
          const r = (2 * (fApex + (smRim[b] - fApex) * half1p)) / denom;
          if (r >= rLo[idx] && r <= rHi[idx]) {
            const q = 3 * idx;
            const u = [uGrid[q], uGrid[q + 1], uGrid[q + 2]];
            rawFl += wf;
            if (srcMod.imageWidthMm(u, r, pa.L0) <= wUsable) usableFl += wf;
            totSc += wf * sharpQuality(u, r);
          }
        }
      }
      if (usableFl > maxUsableFlux) maxUsableFlux = usableFl;
      if (rawFl > maxRawFlux) maxRawFlux = rawFl;
      cands.push({ fApex, smRim, rawFl, usableFl, totSc });
    }

    const thinScene = hasGaps && pa.maxPaintWidthMm < 1.5 * pa.kerMm;
    const useUsable = maxUsableFlux > 0.08 * maxRawFlux;
    const refMax = useUsable ? maxUsableFlux : maxRawFlux;
    const fluxFloor = (thinScene ? 0.62 : 0.78) * refMax;
    let bestCand = cands[0], bestVal = -1;
    for (const c of cands) {
      const fl = useUsable ? c.usableFl : c.rawFl;
      const penalty = fl >= fluxFloor ? 1.0 : Math.pow(fl / Math.max(1e-12, fluxFloor), 2.5);
      const val = c.totSc * penalty;
      if (val > bestVal) { bestVal = val; bestCand = c; }
    }
    let bestFApex = bestCand.fApex, bestFRim = bestCand.smRim;

    const depthScale = settings.shellDepth || 1.0;
    bestFApex *= depthScale;
    for (let b = 0; b < NP; b++) bestFRim[b] *= depthScale;

    function fAt(alpha, phi) {
      let pn = phi % (2 * Math.PI); if (pn < 0) pn += 2 * Math.PI;
      const x = (pn / (2 * Math.PI)) * NP - 0.5;
      const b0 = Math.floor(x), frac = x - b0;
      const i0 = ((b0 % NP) + NP) % NP, i1 = (i0 + 1) % NP;
      const fRim = bestFRim[i0] * (1 - frac) + bestFRim[i1] * frac;
      return bestFApex + (fRim - bestFApex) * 0.5 * (1 + Math.cos(alpha));
    }
    function rShell(alpha, phi) {
      const d = Math.max(1e-6, 1 - Math.cos(alpha));
      return (2 * fAt(alpha, phi)) / d;
    }
    function uOf(alpha, phi) {
      const ca = Math.cos(alpha), sa = Math.sin(alpha), cp = Math.cos(phi), sp = Math.sin(phi);
      const rx = cp * e1[0] + sp * e2[0], ry = cp * e1[1] + sp * e2[1], rz = cp * e1[2] + sp * e2[2];
      return [ca * t0[0] + sa * rx, ca * t0[1] + sa * ry, ca * t0[2] + sa * rz];
    }

    // Cull close-in floodlight zones whose LED image exceeds wUsable while keeping a safe minimum flux floor
    let imgCapMm = Infinity;
    if (hasGaps) {
      const samples = [];
      let shellFlux = 0;
      for (let a = 0; a < NA; a++) {
        const al = alphas[a];
        for (let b = 0; b < NP; b++) {
          const idx = a * NP + b, wf = wFlux[idx];
          if (!(wf > 0) || !(rHi[idx] > 0)) continue;
          const ph = (b + 0.5) * dPhi, r = rShell(al, ph);
          if (r >= rLo[idx] && r <= rHi[idx]) {
            const q = 3 * idx;
            const wImg = srcMod.imageWidthMm([uGrid[q], uGrid[q + 1], uGrid[q + 2]], r, pa.L0);
            samples.push([wImg, wf]);
            shellFlux += wf;
          }
        }
      }
      if (samples.length && shellFlux > 0) {
        samples.sort((x, y) => x[0] - y[0]);
        const minKeepFlux = Math.min(0.88 * shellFlux, Math.max(0.50 * shellFlux, 0.24 * totSphereFlux));
        let accF = 0, floorCap = wUsable;
        for (let i = 0; i < samples.length; i++) {
          accF += samples[i][1];
          if (accF >= minKeepFlux) { floorCap = Math.max(wUsable, samples[i][0]); break; }
        }
        imgCapMm = floorCap;
      }
    }

    function validAt(alpha, phi) {
      if (alpha < alphaMin || alpha > Math.PI) return false;
      const u = uOf(alpha, phi);
      if (!(srcMod.dirDensity(u) > 1e-12)) return false;
      const rm = radialRoom(envS, S0, u, balls, bayPlanes);
      if (!rm) return false;
      const r = rShell(alpha, phi);
      if (!(r >= rm[0] && r <= rm[1])) return false;
      if (isFinite(imgCapMm) && srcMod.imageWidthMm(u, r, pa.L0) > imgCapMm) return false;
      return true;
    }

    return { alphaMin, fApex: bestFApex, fRim: bestFRim, rEnvMax, keepBase, balls, bayPlanes, envS, rShell, uOf, validAt };
  }

  // ------------------------------------------------------------------ 4. Equal-Flux Spherical Cone Partitioner
  function hamiltonCounts(weights, totalM, minEach) {
    const K = weights.length;
    if (!K || totalM <= 0) return [];
    const base = minEach ? 1 : 0;
    if (base * K >= totalM) {
      // Pick top totalM by weight
      const out = new Array(K).fill(0);
      const ord = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < Math.min(K, totalM); k++) out[ord[k][1]] = 1;
      return out;
    }
    const rem = totalM - base * K;
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map((w) => base + (rem * w) / wSum);
    const cnt = raw.map((x) => Math.floor(x));
    let left = totalM - cnt.reduce((a, b) => a + b, 0);
    const frac = raw.map((x, i) => [x - cnt[i], i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < left; k++) cnt[frac[k][1]]++;
    return cnt;
  }

  function partitionShellCones(shell, srcMod, maxFacets) {
    const NA = 120, NP = 144;
    const aMin = shell.alphaMin, dA = (Math.PI - aMin) / NA, dP = (2 * Math.PI) / NP;
    const F = new Float64Array(NA * NP), valid = new Uint8Array(NA * NP);
    const rowFlux = new Float64Array(NA);
    let totFlux = 0, activeOmega = 0, aFirst = -1, aLast = -1;

    for (let a = 0; a < NA; a++) {
      const al = aMin + (a + 0.5) * dA, sa = Math.sin(al);
      let rf = 0;
      for (let b = 0; b < NP; b++) {
        const ph = (b + 0.5) * dP, idx = a * NP + b;
        if (!shell.validAt(al, ph)) continue;
        valid[idx] = 1;
        const u = shell.uOf(al, ph);
        const f = srcMod.dirDensity(u) * sa * dA * dP;
        F[idx] = f; rf += f;
        activeOmega += sa * dA * dP;
      }
      rowFlux[a] = rf;
      if (rf > 0) { if (aFirst < 0) aFirst = a; aLast = a; }
      totFlux += rf;
    }

    if (!(totFlux > 0) || aFirst < 0) return { cones: [], validGrid: { NA, NP, aMin, dA, dP, valid } };

    // Choose number of alpha bands K so facets have ~1:1 angular aspect ratio
    const alphaSpan = (aLast - aFirst + 1) * dA;
    const idealTileAng = Math.sqrt(Math.max(1e-4, activeOmega) / maxFacets);
    const Kwant = U.clamp(Math.round(alphaSpan / Math.max(0.05, idealTileAng)), 1, Math.min(maxFacets, aLast - aFirst + 1));

    // Split active alpha rows [aFirst..aLast] into Kwant bands by cumulative flux
    const bandBounds = [aFirst];
    let acc = 0;
    for (let r = 1; r < Kwant; r++) {
      const target = (r / Kwant) * totFlux;
      let cur = bandBounds[bandBounds.length - 1];
      while (cur < aLast - (Kwant - r) && acc + rowFlux[cur] < target) { acc += rowFlux[cur]; cur++; }
      if (cur <= bandBounds[bandBounds.length - 1]) { acc += rowFlux[cur]; cur++; }
      bandBounds.push(cur);
    }
    bandBounds.push(aLast + 1);

    const bands = [];
    for (let r = 0; r + 1 < bandBounds.length; r++) {
      const a0 = bandBounds[r], a1 = bandBounds[r + 1];
      let bf = 0;
      for (let a = a0; a < a1; a++) bf += rowFlux[a];
      if (bf > 0) bands.push({ a0, a1, flux: bf });
    }
    const bandCounts = hamiltonCounts(bands.map((b) => b.flux), maxFacets, true);

    const cones = [];
    for (let bi = 0; bi < bands.length; bi++) {
      let mBand = bandCounts[bi];
      if (mBand <= 0) continue;
      const { a0, a1 } = bands[bi];
      const g = new Float64Array(NP);
      let activeBins = 0;
      for (let b = 0; b < NP; b++) {
        let s = 0;
        for (let a = a0; a < a1; a++) s += F[a * NP + b];
        g[b] = s;
        if (s > 0) activeBins++;
      }
      if (!activeBins) continue;

      // Find largest empty gap in phi so active intervals don't straddle wrap-around
      let bStart = 0;
      if (activeBins < NP) {
        let bestGap = 0, curGap = 0, gapEnd = 0;
        for (let k = 0; k < 2 * NP; k++) {
          if (g[k % NP] <= 0) { curGap++; if (curGap > bestGap) { bestGap = curGap; gapEnd = k; } }
          else curGap = 0;
        }
        bStart = (gapEnd - Math.floor(bestGap / 2) + NP) % NP;
      } else {
        // Full 360-deg ring: ensure at least 3 wedges if maxFacets allows, else cap wedge span <= 120 deg
        // Wait: never exceed total budget! If mBand < 3 on a full ring, keep mBand as is only if we split <= 170 deg
        bStart = (bi % 2) * Math.floor(NP / (2 * Math.max(1, mBand)));
      }

      // Collect contiguous active runs in phi starting from bStart
      const runs = [];
      let cur = null;
      for (let k = 0; k < NP; k++) {
        const b = (bStart + k) % NP;
        if (g[b] > 0) {
          if (!cur) cur = { startK: k, len: 0, flux: 0, vals: [] };
          cur.len++; cur.flux += g[b]; cur.vals.push(g[b]);
        } else if (cur) { runs.push(cur); cur = null; }
      }
      if (cur) runs.push(cur);
      if (!runs.length) continue;

      const runCounts = hamiltonCounts(runs.map((r) => r.flux), mBand, false);
      for (let ri = 0; ri < runs.length; ri++) {
        const nSeg = runCounts[ri];
        if (nSeg <= 0) continue;
        const run = runs[ri];
        // Cumulative flux along run.vals (each bin has width dP)
        const cdf = new Float64Array(run.len + 1);
        for (let i = 0; i < run.len; i++) cdf[i + 1] = cdf[i] + run.vals[i];
        const runTot = cdf[run.len] || 1;
        const phiBase = bStart * dP + run.startK * dP;

        for (let s = 0; s < nSeg; s++) {
          const fLo = (s / nSeg) * runTot, fHi = ((s + 1) / nSeg) * runTot;
          const interpPhi = (val) => {
            let lo = 0, hi = run.len;
            while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] <= val) lo = mid; else hi = mid; }
            const denom = Math.max(1e-30, cdf[hi] - cdf[lo]);
            return phiBase + (lo + U.clamp((val - cdf[lo]) / denom, 0, 1)) * dP;
          };
          let p0 = interpPhi(fLo), p1 = interpPhi(fHi);
          // Convex polygon clip cannot span >= 165 deg in phi; clamp if mBand was 1 or 2 on a wide arc
          if (p1 - p0 > 160 * Math.PI / 180) {
            const pm = 0.5 * (p0 + p1), half = 80 * Math.PI / 180;
            p0 = pm - half; p1 = pm + half;
          }

          // Trim [alpha0, alpha1] to the actual valid sub-range in this [p0, p1] sector
          let subA0 = a1, subA1 = a0 - 1;
          const nTestP = 3;
          for (let a = a0; a < a1; a++) {
            const al = aMin + (a + 0.5) * dA;
            let okCount = 0;
            for (let q = 0; q < nTestP; q++) if (shell.validAt(al, p0 + ((q + 0.5) / nTestP) * (p1 - p0))) okCount++;
            if (okCount >= 2) { if (a < subA0) subA0 = a; if (a > subA1) subA1 = a; }
          }
          if (subA1 < subA0) { subA0 = a0; subA1 = a1 - 1; }
          const al0 = aMin + subA0 * dA, al1 = aMin + (subA1 + 1) * dA;

          // 4x4 quadrature for exact captured flux & flux-weighted mean direction
          let flux = 0, ux = 0, uy = 0, uz = 0, aMean = 0, pMean = 0;
          const NQ = 4;
          for (let qa = 0; qa < NQ; qa++) {
            const al = al0 + ((qa + 0.5) / NQ) * (al1 - al0), sa = Math.sin(al);
            for (let qp = 0; qp < NQ; qp++) {
              const ph = p0 + ((qp + 0.5) / NQ) * (p1 - p0);
              if (!shell.validAt(al, ph)) continue;
              const u = shell.uOf(al, ph);
              const df = srcMod.dirDensity(u) * sa * ((al1 - al0) / NQ) * ((p1 - p0) / NQ);
              flux += df;
              ux += df * u[0]; uy += df * u[1]; uz += df * u[2];
              aMean += df * al; pMean += df * ph;
            }
          }
          if (!(flux > 1e-9)) continue;
          const uBar = V.norm([ux, uy, uz]);
          const alBar = aMean / flux, phBar = pMean / flux;
          let rBar = shell.rShell(alBar, phBar);
          const rm = radialRoom(shell.envS, srcMod.S0, uBar, shell.balls, shell.bayPlanes);
          if (rm) rBar = U.clamp(rBar, rm[0], rm[1]);
          const P = V.madd(srcMod.S0, uBar, rBar);

          // Cone boundary directions (3 vertices if touching back pole alpha -> pi, else 4)
          const atPole = al1 > Math.PI - 1.5 * dA;
          const corners = atPole
            ? [shell.uOf(al0, p0), shell.uOf(al0, p1), shell.uOf(Math.min(Math.PI - 1e-4, al1), 0.5 * (p0 + p1))]
            : [shell.uOf(al0, p0), shell.uOf(al0, p1), shell.uOf(al1, p1), shell.uOf(al1, p0)];

          cones.push({ al0, al1, p0, p1, alBar, phBar, rBar, uBar, P, flux, corners, S0: srcMod.S0, cov3: srcMod.cov3, powerShare: 1 });
        }
      }
    }

    return { cones, totFlux, validGrid: { NA, NP, aMin, dA, dP, valid } };
  }

  // Direct un-intercepted LED flux landing on each paint cell
  function computeDirectGrid(srcMod, pa, T, R, validGrid) {
    const out = new Float64Array(R * R);
    const cellSize = pa.cellSize, cellArea = cellSize * cellSize;
    const { NA, NP, aMin, dA, dP, valid } = validGrid;
    const S0 = srcMod.S0, t0 = pa.t0, e1 = pa.e1, e2 = pa.e2;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const u = -T.half + (i + 0.5) * cellSize, v = -T.half + (j + 0.5) * cellSize;
      const Z = Eng.targetUVtoWorld(T, u, v);
      const dv = V.sub(Z, S0), dist2 = V.dot(dv, dv), dist = Math.sqrt(dist2) || 1;
      const dir = V.mul(dv, 1 / dist);
      const cosT = -V.dot(dir, T.n);
      if (!(cosT > 0)) continue;
      // Check if dir is intercepted by our reflector shell
      const al = Math.acos(U.clamp(V.dot(dir, t0), -1, 1));
      if (al >= aMin) {
        let ph = Math.atan2(V.dot(dir, e2), V.dot(dir, e1));
        if (ph < 0) ph += 2 * Math.PI;
        const ia = Math.min(NA - 1, Math.floor((al - aMin) / dA));
        const ib = Math.floor((ph / (2 * Math.PI)) * NP) % NP;
        if (valid[ia * NP + ib]) continue; // Caught by reflector!
      }
      const dens = srcMod.dirDensity(dir);
      if (dens > 0) out[j * R + i] = dens * (cellArea * cosT) / dist2;
    }
    return out;
  }

  // ------------------------------------------------------------------ 5. Target Tile Decomposition & Assignment
  function connectedComponents(weights, R) {
    const n = R * R, seen = new Uint8Array(n), comps = [];
    const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const stack = [];
    for (let k = 0; k < n; k++) {
      if (!(weights[k] > 0) || seen[k]) continue;
      seen[k] = 1; stack.push(k);
      const cells = []; let mass = 0;
      while (stack.length) {
        const c = stack.pop(); cells.push(c); mass += weights[c];
        const ic = c % R, jc = (c / R) | 0;
        for (let d = 0; d < 8; d++) {
          const ii = ic + N8[d][0], jj = jc + N8[d][1];
          if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue;
          const q = jj * R + ii;
          if (weights[q] > 0 && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      comps.push({ cells, mass });
    }
    return comps;
  }

  // Recursive flux-exact KD-split of a list of weighted cells into `count` compact tiles
  function kdSplitCells(cells, weights, R, T, sd, count, isBoost) {
    if (count <= 0 || !cells.length) return [];
    const cellSize = (2 * T.half) / R;
    if (count === 1 || cells.length === 1) {
      let wSum = 0, uSum = 0, vSum = 0, uu = 0, vv = 0, uv = 0;
      let iMin = R, iMax = -1, jMin = R, jMax = -1, sdSum = 0;
      for (let idx = 0; idx < cells.length; idx++) {
        const k = cells[idx], w = weights[k];
        const i = k % R, j = (k / R) | 0;
        if (i < iMin) iMin = i; if (i > iMax) iMax = i;
        if (j < jMin) jMin = j; if (j > jMax) jMax = j;
        const u = -T.half + (i + 0.5) * cellSize, v = -T.half + (j + 0.5) * cellSize;
        wSum += w; uSum += w * u; vSum += w * v;
        uu += w * u * u; vv += w * v * v; uv += w * u * v;
        sdSum += w * Math.max(0.5, sd[k]);
      }
      const uc = uSum / (wSum || 1), vc = vSum / (wSum || 1);
      const cuu = Math.max((cellSize * cellSize) / 12, uu / (wSum || 1) - uc * uc + (cellSize * cellSize) / 12);
      const cvv = Math.max((cellSize * cellSize) / 12, vv / (wSum || 1) - vc * vc + (cellSize * cellSize) / 12);
      const cuv = uv / (wSum || 1) - uc * vc;
      // Principal orientation of tile (handles diagonal strokes cleanly!)
      const theta = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
      const ct = Math.cos(theta), st = Math.sin(theta);
      const l1 = Math.max((cellSize * cellSize) / 12, cuu * ct * ct + 2 * cuv * ct * st + cvv * st * st);
      const l2 = Math.max((cellSize * cellSize) / 12, cuu * st * st - 2 * cuv * ct * st + cvv * ct * ct);
      const w1 = Math.sqrt(12 * l1), w2 = Math.sqrt(12 * l2);

      // Check proximity to an ACTUAL unpainted dark gap (target borders are NOT dark gaps!)
      const midJ = Math.floor(0.5 * (jMin + jMax)), midI = Math.floor(0.5 * (iMin + iMax));
      const touchLeft = iMin > 0 && !(weights[midJ * R + (iMin - 1)] > 0);
      const touchRight = iMax < R - 1 && !(weights[midJ * R + (iMax + 1)] > 0);
      const touchBot = jMin > 0 && !(weights[(jMin - 1) * R + midI] > 0);
      const touchTop = jMax < R - 1 && !(weights[(jMax + 1) * R + midI] > 0);
      const borderLeft = iMin === 0, borderRight = iMax === R - 1, borderBot = jMin === 0, borderTop = jMax === R - 1;

      return [{
        cells, mass: wSum, u: uc, v: vc,
        u0: -T.half + iMin * cellSize, u1: -T.half + (iMax + 1) * cellSize,
        v0: -T.half + jMin * cellSize, v1: -T.half + (jMax + 1) * cellSize,
        wu: (iMax - iMin + 1) * cellSize, wv: (jMax - jMin + 1) * cellSize,
        theta, ct, st, w1, w2,
        meanSdMm: (sdSum / (wSum || 1)) * cellSize,
        touchLeft, touchRight, touchBot, touchTop,
        borderLeft, borderRight, borderBot, borderTop, isBoost: !!isBoost,
      }];
    }

    // Bounding span of cells
    let iMin = R, iMax = -1, jMin = R, jMax = -1, totW = 0;
    for (let idx = 0; idx < cells.length; idx++) {
      const k = cells[idx], i = k % R, j = (k / R) | 0;
      if (i < iMin) iMin = i; if (i > iMax) iMax = i;
      if (j < jMin) jMin = j; if (j > jMax) jMax = j;
      totW += weights[k];
    }
    // Check if there is an empty row or column gap to split cleanly across non-convex shapes (like U, X, rings)
    let splitAxis = (iMax - iMin) >= (jMax - jMin) ? 0 : 1;
    const mLeft = Math.floor(count / 2), mRight = count - mLeft;
    const wantFrac = mLeft / count;

    const sorted = cells.slice().sort((a, b) => {
      const ca = splitAxis === 0 ? (a % R) : ((a / R) | 0);
      const cb = splitAxis === 0 ? (b % R) : ((b / R) | 0);
      if (ca !== cb) return ca - cb;
      const sa = splitAxis === 0 ? ((a / R) | 0) : (a % R);
      const sb = splitAxis === 0 ? ((b / R) | 0) : (b % R);
      return sa - sb;
    });

    let acc = 0, cut = 1;
    const targetW = wantFrac * totW;
    for (let idx = 0; idx < sorted.length - 1; idx++) {
      acc += weights[sorted[idx]];
      cut = idx + 1;
      if (acc >= targetW) break;
    }
    const leftCells = sorted.slice(0, cut), rightCells = sorted.slice(cut);
    // Re-split each half into connected sub-components if splitting non-convex shapes created pieces
    return kdSplitCells(leftCells, weights, R, T, sd, mLeft, isBoost)
      .concat(kdSplitCells(rightCells, weights, R, T, sd, mRight, isBoost));
  }

  function buildTargetTiles(paint, R, T, pa, M) {
    const n = R * R;
    const layers = [];
    if (pa.hasHotspotLayer && M >= 6) {
      const base = new Float64Array(n), boost = new Float64Array(n);
      let baseSum = 0, boostSum = 0;
      for (let k = 0; k < n; k++) if (paint[k] > 0) {
        const b = Math.min(paint[k], pa.p20), h = Math.max(0, paint[k] - pa.p20);
        base[k] = b; boost[k] = h;
        baseSum += b; boostSum += h;
      }
      const mBoost = U.clamp(Math.round((M * boostSum) / (baseSum + boostSum)), 1, M - 2);
      const mBase = M - mBoost;
      layers.push({ w: base, sum: baseSum, count: mBase, sd: pa.sd, isBoost: false });
      const boostSd = chamferSignedDist(boost, R).sd;
      layers.push({ w: boost, sum: boostSum, count: mBoost, sd: boostSd, isBoost: true });
    } else {
      layers.push({ w: Float64Array.from(paint), sum: pa.pSum, count: M, sd: pa.sd, isBoost: false });
    }

    const tiles = [];
    for (const lay of layers) {
      const comps = connectedComponents(lay.w, R);
      const compCounts = hamiltonCounts(comps.map((c) => c.mass), lay.count, false);
      for (let ci = 0; ci < comps.length; ci++) {
        if (compCounts[ci] <= 0) continue;
        const sub = kdSplitCells(comps[ci].cells, lay.w, R, T, lay.sd, compCounts[ci], lay.isBoost);
        for (const t of sub) tiles.push(t);
      }
    }
    return tiles;
  }

  // Exact Jonker-Volgenant / Shortest Augmenting Path Linear Assignment O(N^3) (< 0.5 ms for N=100)
  function linearAssignment(cost, N) {
    if (N <= 1) return [0];
    if (N > 180) {
      // Sub-quadratic greedy + 2-opt refinement for large scaling budgets (N=200..400)
      const used = new Uint8Array(N), p = new Int32Array(N);
      const ord = Array.from({ length: N }, (_, i) => i);
      for (let ii = 0; ii < N; ii++) {
        const i = ord[ii]; let bestJ = -1, bestC = Infinity;
        const row = i * N;
        for (let j = 0; j < N; j++) if (!used[j] && cost[row + j] < bestC) { bestC = cost[row + j]; bestJ = j; }
        used[bestJ] = 1; p[i] = bestJ;
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < N; i++) {
          for (let k = i + 1; k < N; k++) {
            const ji = p[i], jk = p[k];
            if (cost[i * N + jk] + cost[k * N + ji] + 1e-9 < cost[i * N + ji] + cost[k * N + jk]) {
              p[i] = jk; p[k] = ji;
            }
          }
        }
      }
      return Array.from(p);
    }
    const u = new Float64Array(N + 1), v = new Float64Array(N + 1);
    const p = new Int32Array(N + 1), way = new Int32Array(N + 1);
    const minv = new Float64Array(N + 1), used = new Uint8Array(N + 1);
    for (let i = 1; i <= N; i++) {
      p[0] = i;
      let j0 = 0;
      minv.fill(Infinity);
      used.fill(0);
      do {
        used[j0] = 1;
        const i0 = p[j0], row = (i0 - 1) * N;
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= N; j++) {
          if (used[j]) continue;
          const cur = cost[row + (j - 1)] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= N; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
    }
    const ans = new Array(N);
    for (let j = 1; j <= N; j++) if (p[j] > 0) ans[p[j] - 1] = j - 1;
    return ans;
  }

  function matchFacetsToTiles(cones, tiles, srcMod, pa, T) {
    const M = cones.length;
    const cost = new Float64Array(M * M);
    const totFlux = cones.reduce((a, c) => a + c.flux, 0) || 1;
    const totMass = tiles.reduce((a, t) => a + t.mass, 0) || 1;
    const cell = pa.cellSize;

    // Precompute each cone's 2x2 source image covariance at paint center
    const sigs = cones.map((c) => sourceTargetCov(c.cov3 || srcMod.cov3, c.S0 || srcMod.S0, c.P, pa.ZCenter, T));

    for (let m = 0; m < M; m++) {
      const c = cones[m], [suu, suv, svv] = sigs[m];
      const dP = V.sub(c.P, c.S0 || srcMod.S0);
      const pu = V.dot(dP, pa.e1) / (shellScale(pa) || 1), pv = V.dot(dP, pa.e2) / (shellScale(pa) || 1);
      const fShare = (c.flux * (c.powerShare || 1)) / totFlux;

      for (let t = 0; t < M; t++) {
        const tl = tiles[t], ct = tl.ct, st = tl.st;
        // Source pinhole image full widths along tile's principal axes (e1_t, e2_t) and target (u, v)
        const s1 = Math.max(0, suu * ct * ct + 2 * suv * ct * st + svv * st * st);
        const s2 = Math.max(0, suu * st * st - 2 * suv * ct * st + svv * ct * ct);
        const ws1 = Math.sqrt(12 * s1), ws2 = Math.sqrt(12 * s2);
        const wsu = Math.sqrt(12 * suu), wsv = Math.sqrt(12 * svv);

        let pen = 0;
        if (pa.hasUnpainted || tl.isBoost) {
          // Safe blur width along tile axes before spilling into dark gap or outside hotspot
          const safe1 = tl.isBoost ? Math.max(pa.kerMm, tl.w1) : Math.max(pa.kerMm, 2.2 * tl.meanSdMm, (tl.touchLeft || tl.touchRight || tl.touchBot || tl.touchTop) ? 2.0 * tl.meanSdMm : 8 * tl.meanSdMm);
          const safe2 = tl.isBoost ? Math.max(pa.kerMm, tl.w2) : Math.max(pa.kerMm, 2.0 * tl.meanSdMm);
          if (ws1 > safe1) pen += Math.pow((ws1 - safe1) / cell, 2);
          if (ws2 > safe2) pen += 1.5 * Math.pow((ws2 - safe2) / cell, 2);
          if (tl.touchLeft || tl.touchRight) {
            const safeU = Math.max(pa.kerMm, 2.2 * tl.meanSdMm);
            if (wsu > safeU) pen += 1.2 * Math.pow((wsu - safeU) / cell, 2);
            else pen += 0.08 * (wsu / cell);
          }
          if (tl.touchBot || tl.touchTop) {
            const safeV = Math.max(pa.kerMm, 2.2 * tl.meanSdMm);
            if (wsv > safeV) pen += 1.2 * Math.pow((wsv - safeV) / cell, 2);
            else pen += 0.08 * (wsv / cell);
          }
          if (tl.isBoost) pen += 0.25 * ((ws1 + ws2) / cell);
        } else {
          pen += 0.02 * ((ws1 + ws2) / cell);
        }

        // Flux vs tile-mass consistency + mild uncrossed geometric tie-breaker
        const mShare = tl.mass / totMass;
        pen += 8.0 * Math.pow((fShare - mShare) * M, 2);
        const tu = (tl.u - pa.uCenter) / (T.half || 1), tv = (tl.v - pa.vCenter) / (T.half || 1);
        pen += 0.03 * ((pu - tu) * (pu - tu) + (pv - tv) * (pv - tv));

        cost[m * M + t] = pen;
      }
    }
    return linearAssignment(cost, M);
  }
  function shellScale(pa) { return Math.max(10, 0.03 * pa.L0); }

  // ------------------------------------------------------------------ 6. Analytical Trapezoid Forward Model & Polish
  // Evaluates 1D integral over cell [c - hCell, c + hCell] of (Box(W_ap) * Box(W_src))(x - mu), normalized to sum = 1
  function trapCell1D(xCell, hCell, mu, wAp, wSrc) {
    const wA = Math.max(1e-6, Math.max(wAp, wSrc)), wB = Math.max(1e-6, Math.min(wAp, wSrc));
    const rOut = 0.5 * (wA + wB), rIn = 0.5 * (wA - wB);
    const a = Math.abs(xCell - mu);
    if (a - hCell >= rOut) return 0;
    // Midpoint + 2-point Gauss quadrature across the cell for smooth exact energy conservation
    const g = 0.5773502691896257 * hCell;
    let s = 0;
    for (let k = -1; k <= 1; k += 2) {
      const d = Math.abs(xCell + k * g - mu);
      const val = d <= rIn ? 1 / wA : d < rOut ? (rOut - d) / (wA * wB) : 0;
      s += val;
    }
    return s * hCell; // integrates to 1 over all cells
  }

  function polishAllocations(allocs, paint, R, T, pa, directGrid, reflectivity, settings) {
    const n = R * R, cellSize = pa.cellSize, hCell = 0.5 * cellSize;
    const insetGain = settings.edgeInset !== undefined ? settings.edgeInset : 0.55;
    const spreadScale = settings.spreadScale !== undefined ? settings.spreadScale : 1.0;
    const passes = settings.polishPasses !== undefined ? (settings.polishPasses | 0) : 8;

    // Smooth signed-distance field for gradient ascent onto medial-axis ridges / safe interior clearance
    const sdSmooth = Phot.boxBlur(pa.sd, R, 1);
    const sampleGrid = (arr, u, v) => {
      const x = U.clamp((u + T.half) / cellSize - 0.5, 0, R - 1.0001);
      const y = U.clamp((v + T.half) / cellSize - 0.5, 0, R - 1.0001);
      const i = x | 0, j = y | 0, fx = x - i, fy = y - j;
      const i1 = Math.min(R - 1, i + 1), j1 = Math.min(R - 1, j + 1);
      return (1 - fy) * ((1 - fx) * arr[j * R + i] + fx * arr[j * R + i1])
           + fy * ((1 - fx) * arr[j1 * R + i] + fx * arr[j1 * R + i1]);
    };
    const climbToSafeRidge = (uStart, vStart, reqMm) => {
      let u = uStart, v = vStart, hitRidge = false;
      let curMm = sampleGrid(pa.sd, u, v) * cellSize;
      const step = 0.45 * cellSize, h = cellSize;
      for (let s = 0; s < 18 && curMm < reqMm; s++) {
        const gx = sampleGrid(sdSmooth, u + h, v) - sampleGrid(sdSmooth, u - h, v);
        const gy = sampleGrid(sdSmooth, u, v + h) - sampleGrid(sdSmooth, u, v - h);
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-4) { hitRidge = true; break; }
        const nu = u + step * (gx / gl), nv = v + step * (gy / gl);
        const ci = U.clamp(Math.floor((nu + T.half) / cellSize), 0, R - 1);
        const cj = U.clamp(Math.floor((nv + T.half) / cellSize), 0, R - 1);
        if (!(paint[cj * R + ci] > 0)) { hitRidge = true; break; }
        const nextMm = sampleGrid(pa.sd, nu, nv) * cellSize;
        if (nextMm <= curMm + 0.015 * cellSize) { hitRidge = true; break; } // Reached medial-axis ridge!
        u = nu; v = nv; curMm = nextMm;
      }
      return [u, v, Math.max(0, curMm), hitRidge];
    };

    // Initialize aim (u, v) and aperture spread (wu, wv) with medial-axis inset & ribbon vs wash classification
    for (const al of allocs) {
      const tl = al.tile;
      const [suu, suv, svv] = al.sig;
      const wsu = Math.sqrt(12 * suu), wsv = Math.sqrt(12 * svv);
      al.wsu = wsu; al.wsv = wsv;

      let u0 = tl.u0, u1 = tl.u1, v0 = tl.v0, v1 = tl.v1;
      if (pa.hasUnpainted && !tl.isBoost) {
        const inU = insetGain * Math.max(0, 0.5 * (wsu - pa.kerMm));
        const inV = insetGain * Math.max(0, 0.5 * (wsv - pa.kerMm));
        const maxInU = 0.45 * (u1 - u0), maxInV = 0.45 * (v1 - v0);
        if (tl.touchLeft) u0 += Math.min(inU, maxInU);
        if (tl.touchRight) u1 -= Math.min(inU, maxInU);
        if (tl.touchBot) v0 += Math.min(inV, maxInV);
        if (tl.touchTop) v1 -= Math.min(inV, maxInV);
      } else if (tl.isBoost) {
        const shrinkU = Math.min(0.45 * (u1 - u0), 0.35 * wsu);
        const shrinkV = Math.min(0.45 * (v1 - v0), 0.35 * wsv);
        if (tl.touchLeft) u0 += shrinkU;
        if (tl.touchRight) u1 -= shrinkU;
        if (tl.touchBot) v0 += shrinkV;
        if (tl.touchTop) v1 -= shrinkV;
      }

      let aimU = 0.5 * (u0 + u1), aimV = 0.5 * (v0 + v1);
      let curSdMm = sampleGrid(pa.sd, aimU, aimV) * cellSize;
      let hitRidge = false;
      const twoSidedTile = (tl.touchLeft && tl.touchRight) || (tl.touchBot && tl.touchTop);
      if (pa.hasUnpainted && !tl.isBoost) {
        const reqMm = Math.max(0, 0.50 * Math.max(wsu, wsv) - 0.55 * pa.kerMm);
        // Only climb onto ridge when the feature itself is narrower than 2*reqMm (e.g. spots, bars, strokes),
        // or the tile straddles both sides; one-sided edges of wide washes use smooth axis-aligned inset + polish!
        if (curSdMm < reqMm && (pa.maxPaintWidthMm < 2.8 * reqMm + 1.5 * pa.kerMm || twoSidedTile || pa.medStrokeCells < 14)) {
          const climbed = climbToSafeRidge(tl.u, tl.v, reqMm);
          if (climbed[3] || twoSidedTile || pa.medStrokeCells < 10) {
            aimU = climbed[0]; aimV = climbed[1]; curSdMm = climbed[2]; hitRidge = climbed[3];
          }
        }
      }

      // True narrow feature ONLY when ridge/two-sided thickness < 1.12 * LED image (never on one-sided edge of wide wash!)
      const narrowFeat = pa.hasUnpainted && !tl.isBoost && ((hitRidge || twoSidedTile) && 2 * curSdMm < 1.12 * Math.max(wsu, wsv));
      const strokeRibbon = pa.hasUnpainted && !tl.isBoost && pa.medStrokeCells < 10 && tl.w1 > 1.45 * tl.w2;
      const diag = (narrowFeat || strokeRibbon) && (Math.abs(Math.sin(2 * tl.theta)) > 0.22 || tl.w1 > 1.35 * tl.w2);

      if (diag) {
        al.diag = true;
        al.u = aimU; al.v = aimV;
        al.axAngle = tl.theta;
        const ct = tl.ct, st = tl.st;
        const ws1 = Math.sqrt(12 * Math.max(0, suu * ct * ct + 2 * suv * ct * st + svv * st * st));
        const ws2 = Math.sqrt(12 * Math.max(0, suu * st * st - 2 * suv * ct * st + svv * ct * ct));
        al.ws1 = ws1; al.ws2 = ws2;
        const endCap = (tl.touchLeft && tl.touchRight) && (tl.touchBot && tl.touchTop);
        const lenAvail = endCap ? Math.max(0, 2 * curSdMm + 0.55 * pa.kerMm - ws1) : tl.w1 * (ws1 < 0.75 * tl.w1 ? 1.15 : 1.0);
        const widAvail = Math.max(0, Math.min(tl.w2, 2 * curSdMm + 0.55 * pa.kerMm - ws2));
        al.wAp1 = Math.max(0, spreadScale * lenAvail);
        al.wAp2 = Math.max(0, spreadScale * widAvail);
      } else if (narrowFeat) {
        al.diag = false;
        al.u = aimU; al.v = aimV;
        al.axAngle = 0;
        al.ws1 = wsu; al.ws2 = wsv;
        const capU = (tl.touchLeft && tl.touchRight) ? Math.max(0, 2 * curSdMm + 0.55 * pa.kerMm - wsu) : (u1 - u0);
        const capV = (tl.touchBot && tl.touchTop) ? Math.max(0, 2 * curSdMm + 0.55 * pa.kerMm - wsv) : (v1 - v0);
        al.wAp1 = spreadScale * Math.max(0, Math.min(u1 - u0, capU));
        al.wAp2 = spreadScale * Math.max(0, Math.min(v1 - v0, capV));
      } else {
        al.diag = false;
        al.u = aimU; al.v = aimV;
        al.axAngle = 0;
        al.ws1 = wsu; al.ws2 = wsv;
        const thinU = pa.hasUnpainted && (u1 - u0) < 0.85 * wsu && (tl.touchLeft && tl.touchRight);
        const thinV = pa.hasUnpainted && (v1 - v0) < 0.85 * wsv && (tl.touchBot && tl.touchTop);
        const wu = Math.max(0, u1 - u0), wv = Math.max(0, v1 - v0);
        let ap1 = thinU || (tl.isBoost && wu < wsu) ? 0 : spreadScale * wu;
        let ap2 = thinV || (tl.isBoost && wv < wsv) ? 0 : spreadScale * wv;
        if (!tl.isBoost) {
          if (tl.borderLeft && !tl.borderRight && wsu > 0.5 * (tl.u1 - tl.u0)) {
            ap1 *= 0.25;
            al.u = Math.max(tl.u0 + 0.15 * (tl.u1 - tl.u0), Math.min(al.u, -T.half + 0.48 * wsu));
          } else if (tl.borderRight && !tl.borderLeft && wsu > 0.5 * (tl.u1 - tl.u0)) {
            ap1 *= 0.25;
            al.u = Math.min(tl.u1 - 0.15 * (tl.u1 - tl.u0), Math.max(al.u, T.half - 0.48 * wsu));
          }
          if (tl.borderBot && !tl.borderTop && wsv > 0.5 * (tl.v1 - tl.v0)) {
            ap2 *= 0.25;
            al.v = Math.max(tl.v0 + 0.15 * (tl.v1 - tl.v0), Math.min(al.v, -T.half + 0.48 * wsv));
          } else if (tl.borderTop && !tl.borderBot && wsv > 0.5 * (tl.v1 - tl.v0)) {
            ap2 *= 0.25;
            al.v = Math.min(tl.v1 - 0.15 * (tl.v1 - tl.v0), Math.max(al.v, T.half - 0.48 * wsv));
          }
        }
        al.wAp1 = ap1; al.wAp2 = ap2;
      }
      al.eRefl = reflectivity * al.cone.flux * (al.cone.powerShare || 1);
    }

    if (passes <= 0 || !allocs.length) return;

    // Exact scorer blur kernel Ballow for gap allowance + gentle edge reference T*
    const Ballow = Phot.boxBlur(paint, R, pa.kerCells);
    const Bker = Phot.boxBlur(paint, R, Math.max(0.5, 0.75 * pa.kerCells));
    const Tref = new Float64Array(n);
    let tSum = 0;
    for (let k = 0; k < n; k++) {
      if (!(paint[k] > 0)) continue;
      const s = pa.sd[k];
      const w = s < 1.5 && pa.hasUnpainted ? 0.5 * (paint[k] + Math.min(paint[k], Bker[k])) : paint[k];
      Tref[k] = w; tSum += w;
    }
    let totDelivered = 0;
    for (const al of allocs) totDelivered += al.eRefl;
    for (let k = 0; k < n; k++) if (paint[k] > 0) totDelivered += directGrid[k];
    const scaleT = tSum > 0 ? totDelivered / tSum : 1;
    for (let k = 0; k < n; k++) Tref[k] *= scaleT;

    const allowGap = new Float64Array(n);
    for (let k = 0; k < n; k++) if (!(paint[k] > 0)) {
      allowGap[k] = scaleT * Math.max(1.08 * Ballow[k], 0.070 * pa.pTyp);
    }

    const G = new Float64Array(n), ratio = new Float64Array(n);
    const uCenters = new Float64Array(R);
    for (let i = 0; i < R; i++) uCenters[i] = -T.half + (i + 0.5) * cellSize;

    const wx = new Float64Array(R), wy = new Float64Array(R);

    for (let it = 0; it < passes; it++) {
      G.set(directGrid);

      // Accumulate analytical trapezoid footprints
      for (let m = 0; m < allocs.length; m++) {
        const al = allocs[m], E = al.eRefl;
        if (al.diag) {
          const ct = Math.cos(al.axAngle), st = Math.sin(al.axAngle);
          const rad = 0.5 * Math.hypot(al.wAp1 + al.ws1, al.wAp2 + al.ws2) + cellSize;
          const i0 = Math.max(0, Math.floor((al.u - rad + T.half) / cellSize));
          const i1 = Math.min(R - 1, Math.ceil((al.u + rad + T.half) / cellSize));
          const j0 = Math.max(0, Math.floor((al.v - rad + T.half) / cellSize));
          const j1 = Math.min(R - 1, Math.ceil((al.v + rad + T.half) / cellSize));
          let norm = 0;
          for (let j = j0; j <= j1; j++) {
            const dv = uCenters[j] - al.v;
            for (let i = i0; i <= i1; i++) {
              const du = uCenters[i] - al.u;
              const x1 = du * ct + dv * st, x2 = -du * st + dv * ct;
              norm += trapCell1D(x1, hCell, 0, al.wAp1, al.ws1) * trapCell1D(x2, hCell, 0, al.wAp2, al.ws2);
            }
          }
          const sc = norm > 1e-12 ? E / Math.max(1, norm) : 0;
          for (let j = j0; j <= j1; j++) {
            const dv = uCenters[j] - al.v;
            for (let i = i0; i <= i1; i++) {
              const du = uCenters[i] - al.u;
              const x1 = du * ct + dv * st, x2 = -du * st + dv * ct;
              G[j * R + i] += sc * trapCell1D(x1, hCell, 0, al.wAp1, al.ws1) * trapCell1D(x2, hCell, 0, al.wAp2, al.ws2);
            }
          }
        } else {
          const rU = 0.5 * (al.wAp1 + al.ws1) + cellSize, rV = 0.5 * (al.wAp2 + al.ws2) + cellSize;
          const i0 = Math.max(0, Math.floor((al.u - rU + T.half) / cellSize));
          const i1 = Math.min(R - 1, Math.ceil((al.u + rU + T.half) / cellSize));
          const j0 = Math.max(0, Math.floor((al.v - rV + T.half) / cellSize));
          const j1 = Math.min(R - 1, Math.ceil((al.v + rV + T.half) / cellSize));
          let sx = 0, sy = 0;
          for (let i = i0; i <= i1; i++) { const v = trapCell1D(uCenters[i], hCell, al.u, al.wAp1, al.ws1); wx[i] = v; sx += v; }
          for (let j = j0; j <= j1; j++) { const v = trapCell1D(uCenters[j], hCell, al.v, al.wAp2, al.ws2); wy[j] = v; sy += v; }
          const sc = (sx > 1e-12 && sy > 1e-12) ? E / Math.max(1, sx * sy) : 0;
          for (let j = j0; j <= j1; j++) {
            const ey = sc * wy[j], row = j * R;
            if (!(ey > 0)) continue;
            for (let i = i0; i <= i1; i++) G[row + i] += ey * wx[i];
          }
        }
      }

      for (let k = 0; k < n; k++) {
        if (paint[k] > 0) ratio[k] = U.clamp(Tref[k] / Math.max(1e-12, G[k]), 0.05, 4.5);
        else ratio[k] = G[k] <= allowGap[k] ? 0.68 : 0.0;
      }

      const dampPos = 0.45, dampW = 0.30;
      for (let m = 0; m < allocs.length; m++) {
        const al = allocs[m];
        if (al.diag) {
          const ct = Math.cos(al.axAngle), st = Math.sin(al.axAngle);
          const rad = 0.5 * Math.hypot(al.wAp1 + al.ws1, al.wAp2 + al.ws2) + cellSize;
          const i0 = Math.max(0, Math.floor((al.u - rad + T.half) / cellSize));
          const i1 = Math.min(R - 1, Math.ceil((al.u + rad + T.half) / cellSize));
          const j0 = Math.max(0, Math.floor((al.v - rad + T.half) / cellSize));
          const j1 = Math.min(R - 1, Math.ceil((al.v + rad + T.half) / cellSize));
          let kSum = 0, wSum = 0, mu0U = 0, mu0V = 0, muU = 0, muV = 0;
          for (let j = j0; j <= j1; j++) {
            const vc = uCenters[j], dv = vc - al.v, row = j * R;
            for (let i = i0; i <= i1; i++) {
              const uc = uCenters[i], du = uc - al.u;
              const x1 = du * ct + dv * st, x2 = -du * st + dv * ct;
              const kv = trapCell1D(x1, hCell, 0, al.wAp1, al.ws1) * trapCell1D(x2, hCell, 0, al.wAp2, al.ws2);
              if (!(kv > 0)) continue;
              const w = kv * ratio[row + i];
              kSum += kv; mu0U += kv * uc; mu0V += kv * vc;
              wSum += w; muU += w * uc; muV += w * vc;
            }
          }
          if (kSum > 1e-12 && wSum > 1e-12) {
            const dU = muU / wSum - mu0U / kSum, dV = muV / wSum - mu0V / kSum;
            const newU = al.u + dampPos * dU, newV = al.v + dampPos * dV;
            const ci = U.clamp(Math.floor((newU + T.half) / cellSize), 0, R - 1);
            const cj = U.clamp(Math.floor((newV + T.half) / cellSize), 0, R - 1);
            if (paint[cj * R + ci] > 0) { al.u = newU; al.v = newV; }
          }
          continue;
        }

        const rU = 0.5 * (al.wAp1 + al.ws1) + cellSize, rV = 0.5 * (al.wAp2 + al.ws2) + cellSize;
        const i0 = Math.max(0, Math.floor((al.u - rU + T.half) / cellSize));
        const i1 = Math.min(R - 1, Math.ceil((al.u + rU + T.half) / cellSize));
        const j0 = Math.max(0, Math.floor((al.v - rV + T.half) / cellSize));
        const j1 = Math.min(R - 1, Math.ceil((al.v + rV + T.half) / cellSize));
        for (let i = i0; i <= i1; i++) wx[i] = trapCell1D(uCenters[i], hCell, al.u, al.wAp1, al.ws1);
        for (let j = j0; j <= j1; j++) wy[j] = trapCell1D(uCenters[j], hCell, al.v, al.wAp2, al.ws2);

        let wTot = 0, kTot = 0, mu0U = 0, mu0V = 0, muU = 0, muV = 0;
        for (let j = j0; j <= j1; j++) {
          const wyj = wy[j]; if (!(wyj > 0)) continue;
          const vc = uCenters[j], row = j * R;
          for (let i = i0; i <= i1; i++) {
            const kVal = wyj * wx[i];
            if (!(kVal > 0)) continue;
            const uc = uCenters[i];
            kTot += kVal; mu0U += kVal * uc; mu0V += kVal * vc;
            const w = kVal * ratio[row + i];
            wTot += w; muU += w * uc; muV += w * vc;
          }
        }
        if (!(wTot > 1e-12) || !(kTot > 1e-12)) continue;
        mu0U /= kTot; mu0V /= kTot;
        muU /= wTot; muV /= wTot;

        let var0U = 0, var0V = 0, varU = 0, varV = 0;
        for (let j = j0; j <= j1; j++) {
          const wyj = wy[j]; if (!(wyj > 0)) continue;
          const vc = uCenters[j], dv0 = vc - mu0V, dvr = vc - muV, row = j * R;
          for (let i = i0; i <= i1; i++) {
            const kVal = wyj * wx[i];
            if (!(kVal > 0)) continue;
            const uc = uCenters[i], du0 = uc - mu0U, dur = uc - muU;
            var0U += kVal * du0 * du0; var0V += kVal * dv0 * dv0;
            const w = kVal * ratio[row + i];
            varU += w * dur * dur; varV += w * dvr * dvr;
          }
        }
        var0U /= kTot; var0V /= kTot;
        varU /= wTot; varV /= wTot;

        const maxShiftU = Math.max(3 * cellSize, 1.0 * al.tile.wu + 0.45 * al.ws1);
        const maxShiftV = Math.max(3 * cellSize, 1.0 * al.tile.wv + 0.45 * al.ws2);
        const newU = U.clamp(al.u + dampPos * (muU - mu0U), al.tile.u - maxShiftU, al.tile.u + maxShiftU);
        const newV = U.clamp(al.v + dampPos * (muV - mu0V), al.tile.v - maxShiftV, al.tile.v + maxShiftV);
        if (!pa.hasUnpainted) {
          al.u = U.clamp(newU, -T.half * 0.98, T.half * 0.98);
          al.v = U.clamp(newV, -T.half * 0.98, T.half * 0.98);
        } else {
          const ci = U.clamp(Math.floor((newU + T.half) / cellSize), 0, R - 1);
          const cj = U.clamp(Math.floor((newV + T.half) / cellSize), 0, R - 1);
          if (paint[cj * R + ci] > 0) { al.u = newU; al.v = newV; }
        }

        const scaleVarU = var0U > 1e-9 ? U.clamp(varU / var0U, 0.42, 2.0) : 1;
        const scaleVarV = var0V > 1e-9 ? U.clamp(varV / var0V, 0.42, 2.0) : 1;
        const curTotU2 = al.wAp1 * al.wAp1 + al.ws1 * al.ws1;
        const curTotV2 = al.wAp2 * al.wAp2 + al.ws2 * al.ws2;
        const wantApU = Math.sqrt(Math.max(0, curTotU2 * scaleVarU - al.ws1 * al.ws1));
        const wantApV = Math.sqrt(Math.max(0, curTotV2 * scaleVarV - al.ws2 * al.ws2));
        const maxAp = 2 * T.half;
        al.wAp1 = U.clamp((1 - dampW) * al.wAp1 + dampW * wantApU, 0, maxAp);
        al.wAp2 = U.clamp((1 - dampW) * al.wAp2 + dampW * wantApV, 0, maxAp);
      }
    }
  }

  // ------------------------------------------------------------------ 7. 3D Quadric Surface Construction & Strict Validation
  function convexHull2D(pts) {
    if (pts.length <= 3) return pts.slice();
    const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function buildConeClipPts(P, S0, Z, vg, di, flat, ax, corners, shrinkFactor) {
    const u0 = V.norm(V.sub(P, S0)), r0 = V.dist(P, S0);
    const fq = flat ? Geo.facetQuadric(P, S0, Z, null)
      : Array.isArray(vg) ? Geo.facetQuadric2(P, S0, Z, vg, ax)
      : Geo.facetQuadric(P, S0, Z, di);
    const n = fq.n, ex = V.inPlane(n, null), ey = V.cross(n, ex);
    const pDotN = V.dot(V.sub(P, S0), n);

    const pts2 = [];
    for (let i = 0; i < corners.length; i++) {
      const cDir = shrinkFactor < 1 ? V.norm(V.lerp(u0, corners[i], shrinkFactor)) : corners[i];
      // Intersect ray S0 + t * cDir with tangent plane first, then refine on quadric near r0
      const den = V.dot(cDir, n);
      let t = den < -1e-4 ? pDotN / den : r0;
      t = U.clamp(t, 0.45 * r0, 2.2 * r0);
      if (!fq.flat) {
        const roots = Geo.quadricRay(fq.A, fq.b, P, S0, cDir);
        let best = NaN, bestDiff = Infinity;
        for (const rt of roots) if (rt > 0.35 * r0 && rt < 2.5 * r0 && Math.abs(rt - t) < bestDiff) {
          bestDiff = Math.abs(rt - t); best = rt;
        }
        if (isFinite(best) && bestDiff < 0.35 * r0) t = best;
      }
      const q3 = V.madd(S0, cDir, t), d = V.sub(q3, P);
      pts2.push([V.dot(d, ex), V.dot(d, ey)]);
    }
    const hull2 = convexHull2D(pts2);
    return hull2.map(([x, y]) => V.add(P, V.add(V.mul(ex, x), V.mul(ey, y))));
  }

  // Strictly mirrors RF.Solvers.verify() with an extra safety margin so host verification NEVER fails
  function surfaceStrictlyValid(surf, env, sources, minDist) {
    let G;
    try { G = Geo.compile([surf]); } catch (e) { return false; }
    const keep = Math.max(env.keepOut || 0, minDist || 0);
    const keepStrict = keep > 0 ? keep * (1 + 1e-4) + 1e-3 : 0;
    const tolEnv = -1e-4;
    for (const poly of Geo.outline(G, 0)) {
      if (poly.length < 3) return false;
      for (const p of poly) {
        if (!isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return false;
        if (!Geo.envInside(env, p, tolEnv)) return false;
      }
      if (keepStrict > 0) {
        for (const s of sources) {
          const S = s.pos;
          for (const p of poly) if (V.dist(p, S) < keepStrict) return false;
          const c = V.mul(poly.reduce((a, q) => V.add(a, q), [0, 0, 0]), 1 / poly.length), M = 5;
          for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            for (let a = 0; a <= M; a++) for (let b = 0; a + b <= M; b++) {
              const q = V.add(c, V.add(V.mul(V.sub(p1, c), a / M), V.mul(V.sub(p2, c), b / M)));
              const dq = V.norm(V.sub(q, S));
              const t = Geo.intersect(G.D, G.poly, 0, S[0], S[1], S[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
              if (t >= 0 && t < keepStrict) return false;
            }
          }
        }
      }
    }
    return true;
  }

  function makeFacetSurface(id, al, S0, T, reflectivity, env, sources, minDist) {
    const cone = al.cone, P = cone.P;
    const Z = Eng.targetUVtoWorld(T, al.u, al.v);
    const av = V.sub(Z, P), L = V.len(av) || 1, ah = V.mul(av, 1 / L);
    const ct = Math.cos(al.axAngle || 0), st = Math.sin(al.axAngle || 0);
    const E1 = V.add(V.mul(T.tu, ct), V.mul(T.tv, st));

    // Beam transverse frame (b1, b2) matching facetQuadric2
    let b1 = V.sub(E1, V.mul(ah, V.dot(E1, ah)));
    if (V.len(b1) < 1e-9) b1 = V.basis(ah)[0]; else b1 = V.norm(b1);
    const b2 = V.cross(ah, b1);

    // Measure effective projected beam aperture of initial tangent-clipped polygon
    const ptsInit = buildConeClipPts(P, S0, Z, null, L, true, null, cone.corners, 1.0);
    if (ptsInit.length < 3) return null;
    const proj2 = ptsInit.map((q) => { const d = V.sub(q, P); return [V.dot(d, b1), V.dot(d, b2)]; });
    const mom = U.polyMoments(proj2);
    const h2Eff1 = Math.max(1e-3, Math.sqrt(12 * Math.max(0, mom.cxx)));
    const h2Eff2 = Math.max(1e-3, Math.sqrt(12 * Math.max(0, mom.cyy)));

    // Obliquity factor from beam cross-section onto target plane along E1, E2
    const aDotN = V.dot(ah, T.n), invAN = Math.abs(aDotN) > 1e-6 ? 1 / aDotN : -1;
    const projOnTarget = (bVec) => {
      const dX = V.sub(bVec, V.mul(ah, V.dot(bVec, T.n) * invAN));
      return Math.hypot(V.dot(dX, T.tu), V.dot(dX, T.tv)) || 1;
    };
    const g1 = 1 / projOnTarget(b1), g2 = 1 / projOnTarget(b2);

    const v1 = (1 / L) * (1 - (g1 * al.wAp1) / h2Eff1);
    const v2 = (1 / L) * (1 - (g2 * al.wAp2) / h2Eff2);

    const buildCandidate = (Puse, shrink, blendFlat) => {
      const r0 = V.dist(Puse, S0);
      const vFlat = -1 / Math.max(1e-3, r0);
      const cv1 = (1 - blendFlat) * v1 + blendFlat * vFlat;
      const cv2 = (1 - blendFlat) * v2 + blendFlat * vFlat;
      const iso = Math.abs(cv1 - cv2) <= 1e-5 * (Math.abs(cv1) + Math.abs(cv2) + 1 / L) && cv1 > 1e-9;
      const vg = iso ? undefined : [cv1, cv2];
      const di = iso ? 1 / cv1 : null;
      const pts3 = buildConeClipPts(Puse, S0, Z, vg, di, false, E1, cone.corners, shrink);
      if (pts3.length < 3) return null;
      const rec = {
        type: 'facet', id, group: 'A', P: Puse.slice(), S0: S0.slice(), Z: Z.slice(),
        flat: false, di, clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity, twoSided: false },
      };
      if (vg) { rec.vg = vg; rec.ax = E1.slice(); }
      return rec;
    };

    // Try exact surface first; if boundary corner/sag touches envelope or keepOut, shrink or nudge P slightly inward
    const shrinks = [1.0, 0.94, 0.86, 0.76, 0.64, 0.50, 0.35];
    for (let si = 0; si < shrinks.length; si++) {
      const s = buildCandidate(P, shrinks[si], 0);
      if (s && surfaceStrictlyValid(s, env, sources, minDist)) return s;
    }
    for (let si = 2; si < shrinks.length; si++) {
      const s = buildCandidate(P, shrinks[si], 0.8);
      if (s && surfaceStrictlyValid(s, env, sources, minDist)) return s;
    }
    for (const pull of [0.06, 0.13]) {
      const Ppull = V.lerp(P, S0, pull);
      for (const sh of [0.65, 0.45, 0.30]) {
        const s = buildCandidate(Ppull, sh, 0.85);
        if (s && surfaceStrictlyValid(s, env, sources, minDist)) return s;
      }
    }
    return null;
  }

  function buildIntentCells(al, paint, R, T, cellSize) {
    const hCell = 0.5 * cellSize;
    const rU = 0.5 * (al.wAp1 + al.ws1) + cellSize, rV = 0.5 * (al.wAp2 + al.ws2) + cellSize;
    const i0 = Math.max(0, Math.floor((al.u - rU + T.half) / cellSize));
    const i1 = Math.min(R - 1, Math.ceil((al.u + rU + T.half) / cellSize));
    const j0 = Math.max(0, Math.floor((al.v - rV + T.half) / cellSize));
    const j1 = Math.min(R - 1, Math.ceil((al.v + rV + T.half) / cellSize));
    const list = [];
    for (let j = j0; j <= j1; j++) {
      const vc = -T.half + (j + 0.5) * cellSize;
      const wy = trapCell1D(vc, hCell, al.v, al.wAp2, al.ws2);
      if (!(wy > 0)) continue;
      for (let i = i0; i <= i1; i++) {
        const k = j * R + i;
        if (!(paint[k] > 0)) continue;
        const uc = -T.half + (i + 0.5) * cellSize;
        const w = wy * trapCell1D(uc, hCell, al.u, al.wAp1, al.ws1);
        if (w > 1e-5) list.push([k, w]);
      }
    }
    list.sort((a, b) => b[1] - a[1]);
    return list.slice(0, 24);
  }

  // ------------------------------------------------------------------ 8. Static Solve Entry Point
  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'shellDepth', label: 'Shell focal scale', type: 'range', min: 0.5, max: 1.5, step: 0.05, default: 1.0 },
    { key: 'glareCull', label: 'Glare cull tolerance', type: 'range', min: 0.5, max: 2.0, step: 0.05, default: 1.0 },
    { key: 'spreadScale', label: 'Tile spread factor', type: 'range', min: 0.2, max: 1.6, step: 0.05, default: 1.0 },
    { key: 'edgeInset', label: 'Dark-edge inset', type: 'range', min: 0.0, max: 1.2, step: 0.05, default: 0.55 },
    { key: 'polishPasses', label: 'Analytical balance passes', type: 'range', min: 0, max: 12, step: 1, default: 7 },
  ];

  // Partition emitters into single-linkage spatial clusters when widely separated (> max(8 mm, 3.5 * dieSize))
  function clusterEmitters(sources) {
    if (sources.length <= 1) return [sources];
    const maxExt = Math.max(...sources.map((s) => Src.extentSize(s) || 1));
    const sep = Math.max(8, 3.5 * maxExt);
    const parent = sources.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
      if (V.dist(sources[i].pos, sources[j].pos) <= sep) parent[find(i)] = find(j);
    }
    const map = new Map();
    for (let i = 0; i < sources.length; i++) {
      const r = find(i);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(sources[i]);
    }
    return [...map.values()];
  }

  function solveStatic(input, settings) {
    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const reflectivity = input.limits.reflectivity;
    const env = input.envelope;
    const sources = (input.sources && input.sources.length) ? input.sources : [input.source];
    const T = Eng.designFrame(input.target);
    const R = input.paint.res, paint = input.paint.cells;
    const ker = Phot.achievableKernel({ source: input.source, envelope: env, target: input.target });

    const globalSrcMod = buildSourceModel(sources);
    const pa = analyzePaint(paint, R, T, globalSrcMod.S0, Math.max(0.5, ker.cells || 0.5));
    if (pa.empty) return { surfaces: [], intent: [], notes: ['Empty paint: 0 facets placed.'] };

    const groups = clusterEmitters(sources);
    let cones = [], totFluxWeighted = 0, fApexNote = 0, directGrid = new Float64Array(R * R);

    if (groups.length === 1) {
      const shell = fitShell(globalSrcMod, pa, env, sources, settings, null);
      const part = partitionShellCones(shell, globalSrcMod, maxFacets);
      cones = part.cones;
      totFluxWeighted = part.totFlux || 0;
      fApexNote = shell.fApex;
      directGrid = computeDirectGrid(globalSrcMod, pa, T, R, part.validGrid);
    } else {
      const totP = globalSrcMod.totP || 1;
      const groupMods = groups.map((g) => buildSourceModel(g));
      const bays = groupMods.map((gm, gi) => {
        const planes = [];
        for (let hj = 0; hj < groupMods.length; hj++) if (hj !== gi) {
          const d = V.sub(groupMods[hj].S0, gm.S0), dl = V.len(d);
          if (dl > 1e-4) {
            const n = V.mul(d, 1 / dl);
            const mid = V.madd(V.mul(V.add(gm.S0, groupMods[hj].S0), 0.5), n, -0.5);
            planes.push({ p: mid, n });
          }
        }
        const paLocal = analyzePaint(paint, R, T, gm.S0, Math.max(0.5, ker.cells || 0.5));
        const shell = fitShell(gm, paLocal, env, sources, settings, planes);
        return { gm, paLocal, shell, pShare: gm.totP / totP };
      });
      const bayBudgets = hamiltonCounts(bays.map((b) => Math.max(1e-6, b.pShare)), maxFacets, false);
      for (let bi = 0; bi < bays.length; bi++) {
        if (bayBudgets[bi] <= 0) continue;
        const { gm, paLocal, shell, pShare } = bays[bi];
        const part = partitionShellCones(shell, gm, bayBudgets[bi]);
        for (const c of part.cones) { c.S0 = gm.S0; c.cov3 = gm.cov3; c.powerShare = pShare; cones.push(c); }
        totFluxWeighted += pShare * (part.totFlux || 0);
        fApexNote += pShare * shell.fApex;
        const dg = computeDirectGrid(gm, paLocal, T, R, part.validGrid);
        for (let k = 0; k < dg.length; k++) directGrid[k] += pShare * dg[k];
      }
    }

    if (!cones.length) return { surfaces: [], intent: [], notes: ['No valid radial room inside envelope / outside clearance.'] };

    const M = cones.length;
    const tiles = buildTargetTiles(paint, R, T, pa, M);
    while (tiles.length < M) tiles.push(Object.assign({}, tiles[tiles.length - 1] || { u: pa.uCenter, v: pa.vCenter, u0: pa.uCenter - pa.cellSize, u1: pa.uCenter + pa.cellSize, v0: pa.vCenter - pa.cellSize, v1: pa.vCenter + pa.cellSize, wu: 2 * pa.cellSize, wv: 2 * pa.cellSize, theta: 0, ct: 1, st: 0, w1: 2 * pa.cellSize, w2: 2 * pa.cellSize, meanSdMm: pa.cellSize, mass: 1, isBoost: false }));
    if (tiles.length > M) tiles.length = M;

    const match = matchFacetsToTiles(cones, tiles, globalSrcMod, pa, T);
    const allocs = cones.map((cone, m) => {
      const tile = tiles[match[m]];
      const Zt = Eng.targetUVtoWorld(T, tile.u, tile.v);
      return { cone, tile, sig: sourceTargetCov(cone.cov3 || globalSrcMod.cov3, cone.S0 || globalSrcMod.S0, cone.P, Zt, T) };
    });

    polishAllocations(allocs, paint, R, T, pa, directGrid, reflectivity, settings);

    const surfaces = [], intent = [];
    let dropped = 0;
    for (let m = 0; m < allocs.length; m++) {
      const id = 'F' + m;
      const S0use = allocs[m].cone.S0 || globalSrcMod.S0;
      const surf = makeFacetSurface(id, allocs[m], S0use, T, reflectivity, env, sources, settings.minDistance);
      const cells = buildIntentCells(allocs[m], paint, R, T, pa.cellSize);
      if (surf) {
        surfaces.push(surf);
        intent.push({ facet: id, cells });
      } else {
        dropped++;
        intent.push({ facet: null, cells });
      }
    }

    const notes = [
      surfaces.length + '/' + maxFacets + ' astigmatic shell facets · f_apex ' + fApexNote.toFixed(1) + ' mm · shell capture ' + (100 * totFluxWeighted).toFixed(1) + '%' + (pa.hasHotspotLayer ? ' · 2-layer (wash + hotspot)' : '') + (groups.length > 1 ? ' · ' + groups.length + ' emitter bays' : ''),
      'paint stroke ~' + pa.featCells.toFixed(1) + ' cells (' + pa.featMm.toFixed(1) + ' mm), min LED kernel ' + pa.kerCells.toFixed(1) + ' cells' + (dropped ? ' · ' + dropped + ' trimmed' : ''),
    ];
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-gemini4carbon-flex--mosaic',
    name: 'Astigmatic Shell Mosaic',
    version: '1.2',
    modes: ['paint'],
    settings: SETTINGS,
    solve: solveStatic,
  });

  // ------------------------------------------------------------------ 9. Trace-Driven Auto-Tuner (mosaic-auto)
  // Exempt from static restriction (`-auto` suffix); tunes static knobs + closed-loop working paint via CRN traces.
  const AUTO_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    {
      key: 'goal', label: 'Optimization goal', type: 'select', default: 'faithful',
      options: [
        { value: 'faithful', label: 'Faithful pattern' },
        { value: 'throw', label: 'Maximum throw / peak cd' },
        { value: 'efficient', label: 'Maximum on-paint efficiency' },
      ],
    },
  ];

  function solveAuto(input, settings, tools) {
    const tStart = Date.now();
    const minDist = settings && settings.minDistance !== undefined ? settings.minDistance : 0;
    const goal = (settings && settings.goal) || 'faithful';
    const seed = input.seed | 0;
    const maxRays = (tools && tools.budget && isFinite(tools.budget.rays)) ? tools.budget.rays : 4000000;
    const maxMs = (tools && tools.budget && isFinite(tools.budget.ms)) ? tools.budget.ms : 30000;

    // Fallback if host provides no trace tool
    if (!tools || typeof tools.trace !== 'function') {
      return solveStatic(input, { minDistance: minDist, shellDepth: 1.0, glareCull: 1.0, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 });
    }

    const basePaint = input.paint.cells.slice();
    const R = input.paint.res, nCells = R * R;
    const raysPerEval = Math.max(40000, Math.min(125000, Math.floor(maxRays / 14)));
    let raysUsed = 0;

    function canTrace() {
      return (raysUsed + raysPerEval <= maxRays * 0.96) && (Date.now() - tStart < maxMs * 0.85);
    }

    let refPeak = 0, refOnPaint = 0;
    function updateRefs(tr) {
      if (!tr) return;
      if ((tr.peakCd || 0) > refPeak) refPeak = tr.peakCd;
      if (tr.fidelity && (tr.fidelity.onPaint || 0) > refOnPaint) refOnPaint = tr.fidelity.onPaint;
    }
    function scoreTrace(tr) {
      const fd = tr && tr.fidelity;
      if (!fd) return -1;
      const fid = fd.fidelity || 0, onP = fd.onPaint || 0, pk = tr.peakCd || 0;
      if (goal === 'throw') {
        const pkNorm = refPeak > 0 ? pk / refPeak : 0;
        return (fid >= 0.35 ? 1 : fid / 0.35) * (0.78 * pkNorm + 0.22 * fid);
      }
      if (goal === 'efficient') {
        const gate = U.clamp((fid - 0.45) / 0.30, 0.1, 1.0);
        return 0.45 * fid + 0.55 * gate * (refOnPaint > 0 ? onP / refOnPaint : onP);
      }
      // goal === 'faithful': mirrors TASK.md composite rubric (fidelity primary, efficiency & peak once F > 0.50)
      const g = U.clamp((fid - 0.50) / 0.25, 0, 1);
      const xOn = refOnPaint > 0 ? Math.min(2, onP / refOnPaint) * 0.5 : onP;
      const xPk = refPeak > 0 ? Math.min(2, pk / refPeak) * 0.5 : 0;
      return fid + g * 0.14 * (0.75 * xOn + 0.25 * xPk);
    }

    // Candidate parameter schedule tailored to goal
    const schedule = goal === 'throw'
      ? [
          { shellDepth: 1.0, glareCull: 1.0, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 },
          { shellDepth: 1.20, glareCull: 0.90, spreadScale: 0.30, edgeInset: 0.70, polishPasses: 4 },
          { shellDepth: 1.32, glareCull: 0.85, spreadScale: 0.15, edgeInset: 0.80, polishPasses: 2 },
          { shellDepth: 1.05, glareCull: 1.05, spreadScale: 0.20, edgeInset: 0.75, polishPasses: 3 },
          { shellDepth: 0.90, glareCull: 1.20, spreadScale: 0.25, edgeInset: 0.65, polishPasses: 3 },
        ]
      : goal === 'efficient'
      ? [
          { shellDepth: 1.0, glareCull: 1.0, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 },
          { shellDepth: 0.82, glareCull: 1.50, spreadScale: 0.90, edgeInset: 0.75, polishPasses: 9 },
          { shellDepth: 0.72, glareCull: 1.85, spreadScale: 0.85, edgeInset: 0.85, polishPasses: 10 },
          { shellDepth: 0.92, glareCull: 1.30, spreadScale: 0.95, edgeInset: 0.65, polishPasses: 8 },
          { shellDepth: 1.08, glareCull: 1.15, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 },
        ]
      : [
          { shellDepth: 1.0, glareCull: 1.0, spreadScale: 0.96, edgeInset: 0.58, polishPasses: 8 },
          { shellDepth: 1.12, glareCull: 0.84, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 },
          { shellDepth: 1.25, glareCull: 0.72, spreadScale: 0.92, edgeInset: 0.65, polishPasses: 8 },
          { shellDepth: 0.88, glareCull: 1.22, spreadScale: 0.95, edgeInset: 0.62, polishPasses: 9 },
          { shellDepth: 1.0, glareCull: 1.0, spreadScale: 0.80, edgeInset: 0.78, polishPasses: 9 },
          { shellDepth: 1.05, glareCull: 1.15, spreadScale: 1.12, edgeInset: 0.45, polishPasses: 9 },
        ];

    const evals = [];
    for (let ci = 0; ci < schedule.length; ci++) {
      if (!canTrace()) break;
      const cfg = Object.assign({ minDistance: minDist }, schedule[ci]);
      const inp = Object.assign({}, input, { paint: { res: R, cells: basePaint } });
      const out = solveStatic(inp, cfg);
      if (!out.surfaces.length) continue;
      const tr = tools.trace(out.surfaces, { rays: raysPerEval, seed, paint: basePaint });
      raysUsed += raysPerEval;
      evals.push({ cfg, out, tr });
      if (tools.progress) tools.progress(Math.min(0.70, ((ci + 1) / (schedule.length + 3))));
    }

    if (!evals.length) {
      return solveStatic(input, { minDistance: minDist, shellDepth: 1.0, glareCull: 1.0, spreadScale: 1.0, edgeInset: 0.55, polishPasses: 8 });
    }

    // Re-score all evaluated candidates with common reference peaks
    for (const ev of evals) updateRefs(ev.tr);
    let best = evals[0], bestSc = -Infinity;
    for (const ev of evals) {
      const sc = scoreTrace(ev.tr);
      if (sc > bestSc) { bestSc = sc; best = ev; }
    }
    if (tools.preview) tools.preview(best.out.surfaces, { label: 'grid best (' + goal + ')', trace: best.tr });

    // Closed-loop Monte-Carlo residual pre-warping (compensates exact 3D die/coil occlusion & dome/oblique tails!)
    if (goal !== 'throw') {
      let workPaint = basePaint.slice();
      for (let round = 0; round < 2; round++) {
        if (!canTrace()) break;
        const fd = best.tr && best.tr.fidelity;
        if (!fd || !fd.ratioAt || !fd.verdict) break;
        const nextPaint = workPaint.slice();
        const rawAdj = new Float64Array(nCells).fill(1);
        for (let k = 0; k < nCells; k++) {
          if (!(basePaint[k] > 0)) continue;
          const rat = fd.ratioAt[k];
          if (!(rat > 0 && isFinite(rat))) continue;
          // Gently boost under-lit cells (verdict 1) and attenuate over-lit cells (verdict 2)
          const mult = Math.pow(U.clamp(1 / rat, 0.55, 1.75), 0.48);
          rawAdj[k] = mult;
        }
        // Smooth multiplicative adjustment over 1 cell so shot noise is never amplified
        const smAdj = Phot.boxBlur(rawAdj, R, 1);
        for (let k = 0; k < nCells; k++) {
          if (basePaint[k] > 0) nextPaint[k] = U.clamp(workPaint[k] * smAdj[k], 0.12 * basePaint[k], 3.5 * basePaint[k]);
        }
        // Also erode 1-cell boundary slightly where adjacent unpainted gaps failed (verdict === 3)
        for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) {
          const k = j * R + i;
          if (!(basePaint[k] > 0)) continue;
          let badGap = 0;
          if (fd.verdict[k - 1] === 3) badGap++;
          if (fd.verdict[k + 1] === 3) badGap++;
          if (fd.verdict[k - R] === 3) badGap++;
          if (fd.verdict[k + R] === 3) badGap++;
          if (badGap > 0) nextPaint[k] *= Math.max(0.35, 1 - 0.22 * badGap);
        }

        const inp = Object.assign({}, input, { paint: { res: R, cells: nextPaint } });
        const candOut = solveStatic(inp, best.cfg);
        if (!candOut.surfaces.length) break;
        const candTr = tools.trace(candOut.surfaces, { rays: raysPerEval, seed, paint: basePaint });
        raysUsed += raysPerEval;
        updateRefs(candTr);
        bestSc = scoreTrace(best.tr);
        const candSc = scoreTrace(candTr);
        if (candSc > bestSc + 1e-4) {
          bestSc = candSc;
          best = { cfg: best.cfg, out: candOut, tr: candTr };
          workPaint = nextPaint;
          if (tools.preview) tools.preview(best.out.surfaces, { label: 'calibrated round ' + (round + 1), trace: best.tr });
        } else break;
        if (tools.progress) tools.progress(0.75 + 0.12 * (round + 1));
      }
    }

    if (tools.progress) tools.progress(1.0);
    const notes = (best.out.notes || []).slice();
    const fd = best.tr && best.tr.fidelity;
    notes.push('auto-tuned (' + goal + ', ' + Math.round(raysUsed / 1000) + 'k CRN rays) · depth ' + best.cfg.shellDepth.toFixed(2) + ', cull ' + best.cfg.glareCull.toFixed(2) + ', spread ' + best.cfg.spreadScale.toFixed(2) + (fd ? ' · pilot fid ' + (100 * fd.fidelity).toFixed(1) + '%' : ''));
    return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-gemini4carbon-flex--mosaic-auto',
    name: 'Astigmatic Shell Mosaic (Auto)',
    version: '1.2',
    modes: ['paint'],
    settings: AUTO_SETTINGS,
    solve: solveAuto,
  });
})();
