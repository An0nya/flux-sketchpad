/* Flux Paint Solver — Static Analytic Flux-to-Paint Superposition
 *
 * Strategy:
 * 1. Tile the valid reflector directions around the LED on the outer envelope shell (minus the
 *    target-facing exit aperture and LED clearance) into N <= maxFacets equal-flux convex quads.
 *    Placing facets on the outer shell minimizes LED image size (sharpest spots), maximizes
 *    aperture area (brightness theorem), eliminates LED-to-facet shadowing, and leaves the exit
 *    aperture open to minimize reflected-ray blocking.
 * 2. For each facet, compute its exact flux and its analytic LED-image footprint on the target
 *    plane (from the 2x2 reflection Jacobian).
 * 3. Optimize the aim point (u_i, v_i) of each facet via coordinate descent on a coarse working
 *    grid so the superposed irradiance matches the painted pattern within +/-25% while keeping
 *    adjacent unpainted gaps dark.
 */
const BASE_SETTINGS = [
  { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
  { key: 'exitCos', label: 'Exit aperture cos threshold', type: 'range', min: 0.1, max: 0.8, step: 0.05, default: 0.35 },
  { key: 'flare', label: 'Paraboloid flare (0=box, 1=full)', type: 'range', min: 0, max: 1.0, step: 0.05, default: 0.95 },
  { key: 'defocus', label: 'Defocus factor', type: 'range', min: 0, max: 0.5, step: 0.02, default: 0.0 },
  { key: 'gapWeight', label: 'Gap penalty weight', type: 'range', min: 0.5, max: 6.0, step: 0.25, default: 2.5 },
  { key: 'passes', label: 'Aim optimization passes', type: 'range', min: 1, max: 12, step: 1, default: 5 },
];

function solveStatic(input, settings) {
    const V = RF.V;
    const Geo = RF.Geo;
    const Source = RF.Source;
    const Engine = RF.Engine;

    const src = input.source;
    const sources = input.sources && input.sources.length ? input.sources : [src];
    const env = input.envelope;
    const T = Engine.targetFrame(input.target);
    const fr = Source.frame(src);
    const S0 = src.pos;

    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const envScale = Math.max(env.half[0], env.half[1], env.half[2]);
    const insetFrac = 0.94;
    const flare = settings.flare !== undefined ? settings.flare : 0.95;

    const paint = input.paint.cells;
    const R = input.paint.res | 0;
    const cellW = (2 * T.half) / R;

    // Helper: outward normal of envelope at boundary point p
    function envNormal(p) {
      const c = env.center, h = env.half;
      const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      if (env.shape === 'box') {
        let bestAx = 0, bestRatio = -1;
        for (let ax = 0; ax < 3; ax++) {
          const r = Math.abs(d[ax]) / Math.max(1e-9, h[ax]);
          if (r > bestRatio) { bestRatio = r; bestAx = ax; }
        }
        const n = [0, 0, 0];
        n[bestAx] = d[bestAx] >= 0 ? 1 : -1;
        return n;
      }
      if (env.shape === 'ellipsoid') {
        return V.norm([d[0] / (h[0] * h[0]), d[1] / (h[1] * h[1]), d[2] / (h[2] * h[2])]);
      }
      const ax = env.axis === undefined ? 2 : env.axis;
      const i = (ax + 1) % 3, j = (ax + 2) % 3;
      const rAx = Math.abs(d[ax]) / Math.max(1e-9, h[ax]);
      const rRad = Math.hypot(d[i] / Math.max(1e-9, h[i]), d[j] / Math.max(1e-9, h[j]));
      if (rAx >= rRad) {
        const n = [0, 0, 0];
        n[ax] = d[ax] >= 0 ? 1 : -1;
        return n;
      }
      const n = [0, 0, 0];
      n[i] = d[i] / (h[i] * h[i]);
      n[j] = d[j] / (h[j] * h[j]);
      return V.norm(n);
    }

    const targetDir = V.norm(V.sub(T.C, S0));
    const exitCos = settings.exitCos;

    // Estimate paraboloid focal length f from the envelope's upper rim radius (75th pct of valid directions)
    const rimF = [];
    const [uT, vT] = V.basis(targetDir);
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * 2 * Math.PI;
      const dSide = V.norm(V.add(V.mul(targetDir, 0.25), V.mul(V.add(V.mul(uT, Math.cos(ang)), V.mul(vT, Math.sin(ang))), Math.sqrt(1 - 0.25 * 0.25))));
      const [tin, tout] = Geo.envInterval(env, S0, dSide);
      if (tout > Math.max(0, tin, keep * 1.5)) {
        rimF.push(0.5 * tout * insetFrac * (1 - 0.25));
      }
    }
    rimF.sort((a, b) => a - b);
    const fParab = rimF.length > 0 ? rimF[Math.floor(0.75 * (rimF.length - 1))] : envScale * 0.4;
    const thetaMax = Source.thetaMax(src);
    const totalInt = Math.max(1e-12, Source.totalIntegral(src));

    // Build CDF for polar angle theta so u in [0, 1] is uniform in emitted flux
    const NTH = 512;
    const cdf = new Float64Array(NTH + 1);
    const thGrid = new Float64Array(NTH + 1);
    for (let i = 0; i <= NTH; i++) thGrid[i] = (i / NTH) * thetaMax;
    for (let i = 1; i <= NTH; i++) {
      const t0 = thGrid[i - 1], t1 = thGrid[i], tm = 0.5 * (t0 + t1);
      const f = Source.intensity(src, tm) * Math.sin(tm) * (t1 - t0);
      cdf[i] = cdf[i - 1] + f;
    }
    const cdfMax = cdf[NTH] || 1;
    for (let i = 0; i <= NTH; i++) cdf[i] /= cdfMax;

    function thetaOfU(u) {
      if (u <= 0) return 0;
      if (u >= 1) return thetaMax;
      let lo = 0, hi = NTH;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cdf[m] <= u) lo = m; else hi = m;
      }
      const f = (u - cdf[lo]) / Math.max(1e-12, cdf[hi] - cdf[lo]);
      return thGrid[lo] + f * (thGrid[hi] - thGrid[lo]);
    }

    function dirOf(theta, phi) {
      const st = Math.sin(theta), ct = Math.cos(theta);
      const cp = Math.cos(phi), sp = Math.sin(phi);
      return [
        ct * fr.a[0] + st * (cp * fr.u[0] + sp * fr.v[0]),
        ct * fr.a[1] + st * (cp * fr.u[1] + sp * fr.v[1]),
        ct * fr.a[2] + st * (cp * fr.u[2] + sp * fr.v[2]),
      ];
    }

    function shellRadius(d, tout) {
      const rBox = tout * insetFrac;
      if (!(flare > 0)) return rBox;
      const fwd = V.dot(d, targetDir);
      const rPar = (2 * fParab) / Math.max(0.15, 1 - fwd);
      const rBlend = rBox * (1 - flare) + Math.min(rBox, rPar) * flare;
      return Math.min(rBox, rBlend);
    }

    // Check if direction d is a valid reflector direction and return radius r
    function evalDir(d) {
      const [tin, tout] = Geo.envInterval(env, S0, d);
      if (!(tout > 0) || tout <= tin) return null;
      const rMin = Math.max(0, tin, keep * 1.02);
      const r = shellRadius(d, tout);
      if (r <= rMin) return null;
      const P = V.add(S0, V.mul(d, tout));
      const nEnv = envNormal(P);
      if (V.dot(nEnv, targetDir) > exitCos) return null;
      if (V.dot(d, targetDir) > 0.92) return null; // too close to forward axis
      const P_in = V.add(S0, V.mul(d, r));
      // Check all emitters' clearance
      for (const s of sources) {
        if (V.dist(P_in, s.pos) < keep * 1.01) return null;
      }
      return { r, P: P_in };
    }

    // Sample valid domain on a fine (u, phi) grid to find valid flux and partition into maxFacets
    const NU = Math.max(12, Math.min(48, Math.round(Math.sqrt(maxFacets) * 2.2)));
    const NPHI = Math.max(24, Math.min(96, Math.round(Math.sqrt(maxFacets) * 4.5)));
    const bands = [];
    let totalValidWeight = 0;

    for (let iu = 0; iu < NU; iu++) {
      const u0 = iu / NU, u1 = (iu + 1) / NU, um = 0.5 * (u0 + u1);
      const tm = thetaOfU(um);
      const valid = new Uint8Array(NPHI);
      let count = 0;
      for (let ip = 0; ip < NPHI; ip++) {
        const phi = ((ip + 0.5) / NPHI) * 2 * Math.PI;
        if (evalDir(dirOf(tm, phi))) { valid[ip] = 1; count++; }
      }
      if (!count) continue;
      // Find contiguous arcs in phi (wrapping around 2*PI)
      const arcs = [];
      let start = -1;
      for (let ip = 0; ip < NPHI; ip++) {
        if (valid[ip] && start < 0) start = ip;
        else if (!valid[ip] && start >= 0) { arcs.push([start, ip]); start = -1; }
      }
      if (start >= 0) arcs.push([start, NPHI]);
      if (arcs.length >= 2 && arcs[0][0] === 0 && arcs[arcs.length - 1][1] === NPHI) {
        arcs[0][0] = arcs[arcs.length - 1][0] - NPHI;
        arcs.pop();
      }
      for (const [a0, a1] of arcs) {
        const w = (a1 - a0) / NPHI * (u1 - u0);
        bands.push({ u0, u1, phi0: (a0 / NPHI) * 2 * Math.PI, phi1: (a1 / NPHI) * 2 * Math.PI, w });
        totalValidWeight += w;
      }
    }

    if (!bands.length || !(totalValidWeight > 0)) {
      return { surfaces: [], intent: [], notes: ['no valid reflector directions found'] };
    }

    // Allocate facets to bands proportional to flux weight
    const counts = bands.map((b) => Math.max(0, Math.floor((b.w / totalValidWeight) * maxFacets)));
    let assigned = counts.reduce((a, b) => a + b, 0);
    // Distribute remaining facets by largest fractional remainder
    const remainders = bands.map((b, idx) => ({ idx, rem: (b.w / totalValidWeight) * maxFacets - counts[idx] }));
    remainders.sort((a, b) => b.rem - a.rem);
    for (let k = 0; k < remainders.length && assigned < maxFacets; k++) {
      counts[remainders[k].idx]++;
      assigned++;
    }

    // Build candidate facet patches
    const patches = [];
    for (let bi = 0; bi < bands.length; bi++) {
      const m = counts[bi];
      if (m <= 0) continue;
      const b = bands[bi];
      const th0 = thetaOfU(b.u0), th1 = thetaOfU(b.u1), thm = 0.5 * (th0 + th1);
      // Pole cap (u0 === 0 and full 2*PI arc): build a single convex polygon around the pole if m === 1
      if (b.u0 === 0 && Math.abs((b.phi1 - b.phi0) - 2 * Math.PI) < 1e-4 && m <= 2) {
        const dm = fr.a.slice();
        const centerEval = evalDir(dm);
        if (centerEval) {
          const pts3 = [];
          const nSides = 8;
          let ok = true;
          for (let s = 0; s < nSides; s++) {
            const ang = (s / nSides) * 2 * Math.PI;
            const cd = dirOf(th1, ang);
            const [tin, tout] = Geo.envInterval(env, S0, cd);
            if (!(tout > 0) || tout <= tin) { ok = false; break; }
            const pt = V.add(S0, V.mul(cd, shellRadius(cd, tout)));
            for (const sItem of sources) if (V.dist(pt, sItem.pos) < keep * 1.02) { ok = false; break; }
            if (!ok) break;
            pts3.push(pt);
          }
          if (ok && pts3.length >= 3) {
            patches.push({
              id: 'F' + patches.length,
              P: centerEval.P,
              r: centerEval.r,
              d_in: dm,
              pts3,
              flux: src.power * refl * b.w,
            });
            continue;
          }
        }
      }
      for (let k = 0; k < m; k++) {
        const p0 = b.phi0 + (k / m) * (b.phi1 - b.phi0);
        const p1 = b.phi0 + ((k + 1) / m) * (b.phi1 - b.phi0);
        const pm = 0.5 * (p0 + p1);
        const dm = dirOf(thm, pm);
        const centerEval = evalDir(dm);
        if (!centerEval) continue;

        const cornerDirs = b.u0 === 0
          ? [dirOf(0, 0), dirOf(th1, p1), dirOf(th1, p0)]
          : [dirOf(th0, p0), dirOf(th0, p1), dirOf(th1, p1), dirOf(th1, p0)];
        const pts3 = [];
        let ok = true;
        for (const cd of cornerDirs) {
          const [tin, tout] = Geo.envInterval(env, S0, cd);
          if (!(tout > 0) || tout <= tin) { ok = false; break; }
          let rc = shellRadius(cd, tout);
          // Ensure corner is inside envelope and outside keepOut
          let pt = V.add(S0, V.mul(cd, rc));
          // Shrink toward center P if too close to any emitter
          for (const s of sources) {
            const distS = V.dist(pt, s.pos);
            if (distS < keep * 1.02) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
          if (!Geo.envInside(env, pt, -1e-4)) {
            pt = V.add(centerEval.P, V.mul(V.sub(pt, centerEval.P), 0.95));
          }
          pts3.push(pt);
        }
        if (!ok || pts3.length < 3) continue;

        // Estimate flux caught by this patch (in lumens)
        const flux = src.power * refl * (b.w / m);
        patches.push({
          id: 'F' + patches.length,
          P: centerEval.P,
          r: centerEval.r,
          d_in: dm,
          pts3,
          flux,
        });
      }
    }

    if (!patches.length) {
      return { surfaces: [], intent: [], notes: ['no valid facet patches placed'] };
    }

    // Downsample paint to working grid W x W for fast optimization
    const W = Math.min(50, R);
    const workPaint = new Float64Array(W * W);
    const workCellW = (2 * T.half) / W;
    let sumPaint = 0;
    for (let j = 0; j < R; j++) {
      const wj = Math.min(W - 1, Math.floor((j / R) * W));
      for (let i = 0; i < R; i++) {
        const wi = Math.min(W - 1, Math.floor((i / R) * W));
        workPaint[wj * W + wi] += paint[j * R + i];
      }
    }
    let litCount = 0;
    for (let k = 0; k < W * W; k++) {
      sumPaint += workPaint[k];
      if (workPaint[k] > 0) litCount++;
    }
    if (!(sumPaint > 0)) {
      return { surfaces: [], intent: [], notes: ['paint is empty'] };
    }

    // Distance transform / edge margin in working grid (in cells)
    // Mark painted cells vs gap band cells
    const isPaint = new Uint8Array(W * W);
    for (let k = 0; k < W * W; k++) if (workPaint[k] > 0) isPaint[k] = 1;

    // Estimate each patch's physical radius wf from its polygon corners
    for (const p of patches) {
      let rMax = 0;
      for (const q of p.pts3) rMax = Math.max(rMax, V.dist(q, p.P));
      p.wf = Math.max(0.5, rMax * 0.75);
    }

    // Compute sharp LED spot half-extents (hu, hv) at target center
    const ledSize = Source.extentSize(src);
    const lw = Math.max(0.1, ledSize[0] || 1);
    const lh = Math.max(0.1, ledSize[1] || lw);

    function sharpSpotAxes(patch, Z) {
      const sv = V.sub(S0, patch.P), r = V.len(sv), sh = V.mul(sv, 1 / r);
      const zv = V.sub(Z, patch.P), Dt = V.len(zv), ah = V.mul(zv, 1 / Dt);
      const n = V.norm(V.add(sh, ah));
      const reflVec = (v) => V.sub(v, V.mul(n, 2 * V.dot(v, n)));
      const mapVec = (ds) => {
        const dsp = V.sub(ds, V.mul(sh, V.dot(ds, sh)));
        const w = V.mul(reflVec(dsp), -1 / r);
        const den = V.dot(ah, T.n);
        const proj = Math.abs(den) > 1e-4 ? V.sub(w, V.mul(ah, V.dot(w, T.n) / den)) : w;
        const dz = V.mul(proj, Dt);
        return [V.dot(dz, T.tu), V.dot(dz, T.tv)];
      };
      const e1 = mapVec(V.mul(fr.u, 0.5 * lw));
      const e2 = mapVec(V.mul(fr.v, 0.5 * lh));
      const hu = Math.max(0.5, Math.abs(e1[0]) + Math.abs(e2[0]));
      const hv = Math.max(0.5, Math.abs(e1[1]) + Math.abs(e2[1]));
      return { hu, hv, Dt };
    }

    // Adaptive defocus: if sharp LED images are too small to tile the painted area without holes,
    // defocus facets slightly (di < Dt) so aperture blur fills the gaps smoothly.
    const paintedArea = litCount * workCellW * workCellW;
    let sharpAreaSum = 0;
    for (const p of patches) {
      const sp = sharpSpotAxes(p, T.C);
      p.sharpHu = sp.hu;
      p.sharpHv = sp.hv;
      sharpAreaSum += 4 * sp.hu * sp.hv;
    }
    const targetCoverage = 1.8 * paintedArea;
    let autoBlur = 0;
    if (sharpAreaSum < targetCoverage && patches.length > 0) {
      const avgH = Math.sqrt(sharpAreaSum / (4 * patches.length));
      const neededH = Math.sqrt(targetCoverage / (4 * patches.length));
      const needBlur = Math.max(0, neededH - avgH);
      const avgWf = patches.reduce((s, p) => s + p.wf, 0) / patches.length;
      autoBlur = Math.min(0.85, needBlur / Math.max(1, avgWf));
    }
    const userDef = settings.defocus || 0;
    const defocusRatio = Math.max(userDef, autoBlur);

    // Precompute candidate aim points on the painted working cells
    const candIdx = [];
    for (let k = 0; k < W * W; k++) {
      if (workPaint[k] > 0) candIdx.push(k);
    }
    // Subsample candidates if too many
    const step = Math.max(1, Math.floor(candIdx.length / 150));
    const cands = [];
    for (let c = 0; c < candIdx.length; c += step) {
      const k = candIdx[c];
      const ci = k % W, cj = (k / W) | 0;
      const u = -T.half + (ci + 0.5) * workCellW;
      const v = -T.half + (cj + 0.5) * workCellW;
      cands.push({
        k,
        u,
        v,
        Z: Engine.targetUVtoWorld(T, u, v),
      });
    }

    // Check if reflected ray from P to Z exits the envelope through the exit aperture without crossing the shell
    function isUnblocked(P, Z) {
      const dOut = V.norm(V.sub(Z, P));
      const [, tout] = Geo.envInterval(env, P, dOut);
      if (!(tout > 0)) return false;
      const Pexit = V.add(P, V.mul(dOut, tout));
      if (V.dot(envNormal(Pexit), targetDir) <= exitCos * 0.8) return false;
      // Check interior steps along P -> Pexit stay inside the star-shaped shell
      for (let s = 1; s <= 5; s++) {
        const t = (s / 6) * tout;
        const Q = V.add(P, V.mul(dOut, t));
        const qv = V.sub(Q, S0);
        const rq = V.len(qv);
        if (rq < 1e-6) continue;
        const dq = V.mul(qv, 1 / rq);
        const [, tqOut] = Geo.envInterval(env, S0, dq);
        if (tqOut > 0 && rq > shellRadius(dq, tqOut) * 0.93) return false;
      }
      return true;
    }

    // Total flux and target scaling: total predicted flux on workPaint should match sumPaint * scale
    const totalFlux = patches.reduce((s, p) => s + p.flux, 0);
    const desired = new Float64Array(W * W);
    const scale = totalFlux / sumPaint;
    for (let k = 0; k < W * W; k++) desired[k] = workPaint[k] * scale;

    // Spot kernel: flat-top box with smooth 0.5-cell anti-aliased edge (matches real uniform LED image)
    function stamp(grid, u, v, hu, hv, flux, sign) {
      const cu = (u + T.half) / workCellW - 0.5;
      const cv = (v + T.half) / workCellW - 0.5;
      const riu = hu / workCellW;
      const riv = hv / workCellW;
      const i0 = Math.max(0, Math.floor(cu - riu - 0.5));
      const i1 = Math.min(W - 1, Math.ceil(cu + riu + 0.5));
      const j0 = Math.max(0, Math.floor(cv - riv - 0.5));
      const j1 = Math.min(W - 1, Math.ceil(cv + riv + 0.5));
      let wsum = 0;
      for (let j = j0; j <= j1; j++) {
        const wy = Math.max(0, Math.min(1, riv + 0.5 - Math.abs(j - cv)));
        if (wy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const wx = Math.max(0, Math.min(1, riu + 0.5 - Math.abs(i - cu)));
          wsum += wx * wy;
        }
      }
      if (!(wsum > 0)) return;
      const f = (sign * flux) / wsum;
      for (let j = j0; j <= j1; j++) {
        const wy = Math.max(0, Math.min(1, riv + 0.5 - Math.abs(j - cv)));
        if (wy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const wx = Math.max(0, Math.min(1, riu + 0.5 - Math.abs(i - cu)));
          grid[j * W + i] += f * wx * wy;
        }
      }
    }

    // Compute local delta loss for placing a spot at (u, v, hu, hv, flux) onto current grid
    const gapW = settings.gapWeight;
    function evalLossDelta(grid, u, v, hu, hv, flux) {
      const cu = (u + T.half) / workCellW - 0.5;
      const cv = (v + T.half) / workCellW - 0.5;
      const riu = hu / workCellW;
      const riv = hv / workCellW;
      const i0 = Math.max(0, Math.floor(cu - riu - 0.5));
      const i1 = Math.min(W - 1, Math.ceil(cu + riu + 0.5));
      const j0 = Math.max(0, Math.floor(cv - riv - 0.5));
      const j1 = Math.min(W - 1, Math.ceil(cv + riv + 0.5));
      let wsum = 0;
      for (let j = j0; j <= j1; j++) {
        const wy = Math.max(0, Math.min(1, riv + 0.5 - Math.abs(j - cv)));
        if (wy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const wx = Math.max(0, Math.min(1, riu + 0.5 - Math.abs(i - cu)));
          wsum += wx * wy;
        }
      }
      if (!(wsum > 0)) return 1e30;
      const f = flux / wsum;
      let delta = 0;
      for (let j = j0; j <= j1; j++) {
        const wy = Math.max(0, Math.min(1, riv + 0.5 - Math.abs(j - cv)));
        if (wy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const wx = Math.max(0, Math.min(1, riu + 0.5 - Math.abs(i - cu)));
          const add = f * wx * wy;
          if (add <= 0) continue;
          const idx = j * W + i;
          const g0 = grid[idx], g1 = g0 + add, d = desired[idx];
          const w = d > 0 ? 1.0 : gapW;
          delta += w * ((g1 - d) * (g1 - d) - (g0 - d) * (g0 - d));
        }
      }
      return delta;
    }

    // Initialize aim points greedily in descending order of spot sharpness (largest r first)
    const order = patches.map((_, i) => i).sort((a, b) => patches[b].r - patches[a].r);
    const grid = new Float64Array(W * W);
    for (const pi of order) {
      const p = patches[pi];
      const blurMm = defocusRatio * p.wf;
      const hu = p.sharpHu + blurMm;
      const hv = p.sharpHv + blurMm;
      p.validCands = cands.filter((c) => isUnblocked(p.P, c.Z));
      if (!p.validCands.length) p.validCands = cands;
      let bestC = p.validCands[0], bestDelta = 1e30;
      for (const c of p.validCands) {
        const d = evalLossDelta(grid, c.u, c.v, hu, hv, p.flux);
        if (d < bestDelta) { bestDelta = d; bestC = c; }
      }
      p.aimU = bestC.u;
      p.aimV = bestC.v;
      p.hu = hu;
      p.hv = hv;
      stamp(grid, p.aimU, p.aimV, p.hu, p.hv, p.flux, 1);
    }

    // Coordinate descent refinement passes
    const passes = settings.passes | 0;
    for (let pass = 0; pass < passes; pass++) {
      for (const pi of order) {
        const p = patches[pi];
        stamp(grid, p.aimU, p.aimV, p.hu, p.hv, p.flux, -1);
        let bestC = null, bestDelta = 1e30;
        for (const c of p.validCands) {
          const d = evalLossDelta(grid, c.u, c.v, p.hu, p.hv, p.flux);
          if (d < bestDelta) { bestDelta = d; bestC = c; }
        }
        if (bestC) { p.aimU = bestC.u; p.aimV = bestC.v; }
        stamp(grid, p.aimU, p.aimV, p.hu, p.hv, p.flux, 1);
      }
    }

    // Build output surfaces and intent, shrinking any corner/surface that touches envelope or clearance
    const surfaces = [];
    const intent = [];
    const minKeepSq = (keep * (1 + 1e-4)) ** 2;
    function surfOk(s) {
      const G = Geo.compile([s]);
      for (const poly of Geo.outline(G, 0)) {
        for (const q of poly) {
          if (!Geo.envInside(env, q, -1e-6)) return false;
          if (keep > 0) for (const srcItem of sources) {
            const dx = q[0] - srcItem.pos[0], dy = q[1] - srcItem.pos[1], dz = q[2] - srcItem.pos[2];
            if (dx * dx + dy * dy + dz * dz < minKeepSq) return false;
          }
        }
      }
      return true;
    }
    for (const p of patches) {
      const Z = Engine.targetUVtoWorld(T, p.aimU, p.aimV);
      const Dt = V.dist(Z, p.P);
      const di = defocusRatio > 0 ? Dt / (1 + defocusRatio) : Dt;
      let P_use = p.P;
      let pts_use = p.pts3;
      let surf = {
        type: 'facet',
        id: p.id,
        group: 'A',
        P: P_use,
        S0,
        Z,
        flat: false,
        di,
        clip: { kind: 'poly', pts3: pts_use },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      };
      // If compiled outline pokes outside envelope or inside keepOut, pull radially toward S0 (preserves solid angle!)
      for (let attempt = 0; attempt < 8 && !surfOk(surf); attempt++) {
        const pull = 1 - 0.025 * (attempt + 1);
        P_use = V.add(S0, V.mul(V.sub(p.P, S0), pull));
        pts_use = p.pts3.map((q) => V.add(S0, V.mul(V.sub(q, S0), pull)));
        const dtUse = V.dist(Z, P_use);
        surf = Object.assign({}, surf, { P: P_use, di: defocusRatio > 0 ? dtUse / (1 + defocusRatio) : dtUse, clip: { kind: 'poly', pts3: pts_use } });
      }
      if (!surfOk(surf)) continue;
      surfaces.push(surf);
      const pi = Math.max(0, Math.min(R - 1, Math.floor((p.aimU + T.half) / cellW)));
      const pj = Math.max(0, Math.min(R - 1, Math.floor((p.aimV + T.half) / cellW)));
      intent.push({ facet: p.id, cells: [[pj * R + pi, 1]] });
    }

    return {
      surfaces,
      intent,
      notes: [
        patches.length + ' facets on outer shell (' + Math.round(totalFlux) + ' lm est.)',
      ],
    };
}

RF.Solvers.register({
  id: 'bench-gemini4hydrogen--analytic-flux',
  name: 'Analytic Flux Superposition',
  version: '0.1',
  modes: ['paint'],
  settings: BASE_SETTINGS,
  solve(input, settings) {
    return solveStatic(input, settings);
  },
});

RF.Solvers.register({
  id: 'bench-gemini4hydrogen--analytic-flux-auto',
  name: 'Analytic Flux Superposition (Tuned)',
  version: '0.1',
  modes: ['paint'],
  settings: BASE_SETTINGS,
  solve(input, settings, tools) {
    const V = RF.V;
    const Engine = RF.Engine;
    const T = Engine.targetFrame(input.target);
    const paint = input.paint.cells;
    const R = input.paint.res | 0;
    const cellW = (2 * T.half) / R;
    const rayBudget = (tools && tools.budget && tools.budget.rays) || 300000;
    let raysUsed = 0;
    const traceRays = Math.min(25000, Math.max(5000, Math.floor(rayBudget / 12)));

    function runTrace(surfs, rays) {
      if (!tools || typeof tools.trace !== 'function' || raysUsed + rays > rayBudget) return null;
      raysUsed += rays;
      return tools.trace(surfs, { rays, seed: input.seed });
    }

    // 1. Sweep key geometric/superposition hyperparameters
    const candidates = [
      { flare: settings.flare, defocus: settings.defocus, gapWeight: settings.gapWeight },
      { flare: 0.45, defocus: 0.0, gapWeight: 2.5 },
      { flare: 0.75, defocus: 0.0, gapWeight: 2.5 },
      { flare: 1.00, defocus: 0.0, gapWeight: 2.0 },
      { flare: 1.00, defocus: 0.35, gapWeight: 2.0 },
    ];

    let bestOut = solveStatic(input, settings);
    let bestTr = runTrace(bestOut.surfaces, traceRays);
    let bestScore = bestTr && bestTr.fidelity ? bestTr.fidelity.fidelity : 0;
    let bestCfg = candidates[0];

    for (let i = 1; i < candidates.length; i++) {
      if (raysUsed + traceRays > rayBudget) break;
      const cfg = Object.assign({}, settings, candidates[i]);
      const out = solveStatic(input, cfg);
      if (!out.surfaces.length) continue;
      const tr = runTrace(out.surfaces, traceRays);
      const sc = tr && tr.fidelity ? tr.fidelity.fidelity : 0;
      if (sc > bestScore) {
        bestScore = sc;
        bestOut = out;
        bestTr = tr;
        bestCfg = candidates[i];
      }
    }

    // 2. Iterative trace-guided aim refinement: shift facets from over-lit cells toward under-lit cells
    if (bestTr && bestTr.fidelity && bestOut.surfaces.length > 0) {
      let curOut = bestOut;
      let curTr = bestTr;
      const defRatio = bestCfg.defocus || 0;

      for (let round = 0; round < 5 && raysUsed + traceRays <= rayBudget; round++) {
        const fid = curTr.fidelity;
        if (!fid || !fid.ratioAt || !fid.verdict) break;

        // Collect under-lit painted cells and over-lit painted cells
        const under = [], over = [];
        for (let k = 0; k < R * R; k++) {
          if (!(paint[k] > 0)) continue;
          const r = fid.ratioAt[k];
          if (fid.verdict[k] < 0 || r < 0.78) under.push({ k, r });
          else if (fid.verdict[k] > 0 || r > 1.28) over.push({ k, r });
        }
        if (!under.length || !over.length) break;
        under.sort((a, b) => a.r - b.r);

        // Map each facet's aimed cell to its ratio
        const overSet = new Set(over.map((x) => x.k));
        const movable = [];
        for (let fi = 0; fi < curOut.surfaces.length; fi++) {
          const intItem = curOut.intent[fi];
          const cIdx = intItem && intItem.cells && intItem.cells[0] ? intItem.cells[0][0] : -1;
          const r = cIdx >= 0 ? fid.ratioAt[cIdx] : 1;
          if (overSet.has(cIdx) || r > 1.25 || !(paint[cIdx] > 0)) {
            movable.push({ fi, r });
          }
        }
        if (!movable.length) break;
        movable.sort((a, b) => b.r - a.r);

        const nMove = Math.min(8, movable.length, under.length);
        const nextSurfs = curOut.surfaces.map((s) => Object.assign({}, s));
        const nextIntent = curOut.intent.map((it) => ({ facet: it.facet, cells: it.cells.slice() }));

        for (let m = 0; m < nMove; m++) {
          const fi = movable[m].fi;
          const dstK = under[m % under.length].k;
          const ci = dstK % R, cj = (dstK / R) | 0;
          const u = -T.half + (ci + 0.5) * cellW;
          const v = -T.half + (cj + 0.5) * cellW;
          const Z = Engine.targetUVtoWorld(T, u, v);
          const s = nextSurfs[fi];
          const Dt = V.dist(Z, s.P);
          s.Z = Z;
          s.di = defRatio > 0 ? Dt / (1 + defRatio) : Dt;
          nextIntent[fi].cells = [[dstK, 1]];
        }

        const candTr = runTrace(nextSurfs, traceRays);
        const candScore = candTr && candTr.fidelity ? candTr.fidelity.fidelity : 0;
        if (candScore > bestScore + 0.002) {
          bestScore = candScore;
          curOut = { surfaces: nextSurfs, intent: nextIntent, notes: curOut.notes };
          curTr = candTr;
          bestOut = curOut;
        } else {
          break;
        }
      }
    }

    bestOut.notes = (bestOut.notes || []).concat([
      'tuned (' + raysUsed.toLocaleString() + ' rays, est. fidelity ' + (100 * bestScore).toFixed(1) + '%)',
    ]);
    return bestOut;
  },
});
