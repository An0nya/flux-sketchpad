/* Bundled model solver: Opus 5.5, Flux solver benchmark run 2026-09-27 (workspace work-opus55-flux-solver-20260927-0154).
 * Copied verbatim from that run's solvers/solver.js (sha256 0d414f39e4d4…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* Mosaic — a static paint solver for Flux.
 *
 * Idea: a curved facet paints a small picture on the target: the LED's image (its size set by how far the facet
 * is from the LED) smeared by the facet's own outline when it is defocused.  Both are closed-form geometry, so
 * the solver can predict each facet's footprint ("blob") without tracing a ray, and then lay the blobs down like
 * mosaic tiles until their sum looks like the painting.
 *
 *   1. Tiles.   The LED's emission is split into ~maxFacets angular tiles of (roughly) equal flux, in an
 *               equal-area map of directions centred on "straight back from the target".  Left open: directions
 *               that leave through the envelope's front (the beam's exit) and a cone about the beam axis (openAngle).
 *               Each tile becomes one facet, its outline the tile's cone, so facets tile the LED's view without
 *               shadowing each other.
 *   1b. Shell.  How far out each facet sits.  Seen from the target, facet outlines must not overlap, or one facet's
 *               light runs into the next: along each meridian a facet's height above the beam axis must grow toward
 *               the front (what a paraboloid does).  Every tile starts at the envelope wall; rear tiles are lowered
 *               until that holds.  Remaining crossings are found per aim by marching a few rays (geometry only).
 *   1c. Blocker. If the LED's direct light would light the gaps (an LED facing the target), one flat mirror in
 *               front of it sends that light back.
 *   2. Blobs.   Per facet: the LED image (LED points → chief ray through the facet centre → target) plus the
 *               aperture seen through the ellipsoid's second focus (defocus magnification m; m = 0 is sharp focus).
 *               A few sizes per facet, rasterised on the paint grid at sub-cell phases.
 *   3. Mosaic.  Greedy matching pursuit on the paint grid: each facet goes where (and at the size) it most lowers
 *               a cost that mirrors the scorer — painted cells inside ×/÷1.25 of the paint, gap cells near the paint
 *               under 10% of a typical painted cell, light elsewhere mildly wasteful — then a few sweeps that lift
 *               each facet and re-place it.  A facet that only makes things worse is not placed.
 *   4. Output.  Ellipsoid facets aimed at the chosen point, di from m, fitted inside the envelope.
 *
 * No tracing: every footprint is corner/sample geometry (reflect a direction, meet a plane), deterministic.
 */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- envelope helpers
  function exitDist(env, S, d) {
    const iv = RF.Geo.envInterval(env, S, d);
    return iv[1] >= iv[0] && iv[1] > 0 ? iv[1] : -1;
  }
  function envNormal(env, p) {
    const c = env.center, h = env.half, d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    if (env.shape === 'box') {
      let best = -1, ax = 0;
      for (let i = 0; i < 3; i++) { const q = Math.abs(d[i]) / h[i]; if (q > best) { best = q; ax = i; } }
      const n = [0, 0, 0]; n[ax] = d[ax] >= 0 ? 1 : -1; return n;
    }
    if (env.shape === 'ellipsoid') return V.norm([d[0] / (h[0] * h[0]), d[1] / (h[1] * h[1]), d[2] / (h[2] * h[2])]);
    const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
    const cap = Math.abs(d[ax]) / h[ax], rad = Math.hypot(d[i] / h[i], d[j] / h[j]);
    const n = [0, 0, 0];
    if (cap >= rad) { n[ax] = d[ax] >= 0 ? 1 : -1; return n; }
    n[i] = d[i] / (h[i] * h[i]); n[j] = d[j] / (h[j] * h[j]); return V.norm(n);
  }

  // Deterministic sample points over the emitter (its image is what a facet paints).
  function ledPoints(src, n) {
    const fr = RF.Source.frame(src), p = src.pos, out = [];
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const g = (i) => (i + 0.5) / n - 0.5;
    if (src.kind === 'planar') {
      if (src.shape === 'disc') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = 2 * g(i), y = 2 * g(j); if (x * x + y * y <= 1) out.push(at(x * src.radius, y * src.radius, 0)); } }
      else for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(at(g(i) * src.w, g(j) * src.h, 0));
    } else if (src.kind === 'volume') {
      if (src.shape === 'cylinder') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) { const x = 2 * g(i), y = 2 * g(j); if (x * x + y * y <= 1) out.push(at(x * src.radius, y * src.radius, ((k + 0.5) / 3 - 0.5) * src.length)); } }
      else for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) { const x = 2 * g(i), y = 2 * g(j), z = 2 * g(k); if (x * x + y * y + z * z <= 1) out.push(at(x * src.radius, y * src.radius, z * src.radius)); }
    }
    return out.length ? out : [p.slice()];
  }

  // ---------------------------------------------------------------- the mosaic's cost (module level: one hot function
  // for every solve, so V8 keeps it optimised when a worker solves scene after scene)
  // Per paint cell: painted (kind 1) — quadratic outside the tolerance band [lo, hi] plus a small pull toward the
  // target; gap near the paint (kind 2) — quadratic above 0.8 × its allowance; elsewhere — a small cost for stray light.
  function cellCost(M, c, g) {
    const k = M.kind[c];
    if (k === 1) { const t = M.tgt[c], r = (g - t) / t; let e = 0.05 * r * r; if (g < M.lo[c]) { const q = (M.lo[c] - g) / t; e += q * q; } else if (g > M.hi[c]) { const q = (g - M.hi[c]) / t; e += q * q; } return e; }
    if (k === 2) { const o = g - 0.8 * M.allow[c]; return o > 0 ? M.lamG * (o / M.ramp) * (o / M.ramp) : 0; }
    const q = g / M.sTyp; return M.lamF * q * q;
  }
  // change in total cost if a blob (raster rs, flux phi) is added at cell (I, J)
  function blobDelta(M, rs, I, J, phi) {
    const R = M.R, kind = M.kind, tgt = M.tgt, lo = M.lo, hi = M.hi, allow = M.allow, gv = M.gv, E0 = M.E0;
    const lamG = M.lamG, ramp = M.ramp, lamF = M.lamF, sTyp = M.sTyp, di = rs.di, dj = rs.dj, w = rs.w, n = w.length;
    let dE = 0;
    for (let e = 0; e < n; e++) {
      const x = I + di[e], y = J + dj[e]; if (x < 0 || y < 0 || x >= R || y >= R) continue;
      const c = y * R + x, g = gv[c] + phi * w[e], k = kind[c]; let ce;
      if (k === 1) { const t = tgt[c], r = (g - t) / t; ce = 0.05 * r * r; if (g < lo[c]) { const q = (lo[c] - g) / t; ce += q * q; } else if (g > hi[c]) { const q = (g - hi[c]) / t; ce += q * q; } }
      else if (k === 2) { const o = g - 0.8 * allow[c]; ce = o > 0 ? lamG * (o / ramp) * (o / ramp) : 0; }
      else { const q = g / sTyp; ce = lamF * q * q; }
      dE += ce - E0[c];
    }
    return dE;
  }

  function solve(input, st) {
    const notes = [];
    // dev-only timing hook: a no-op unless a harness defines globalThis.__mosaicProf (never affects the output)
    const PR = typeof globalThis !== 'undefined' && globalThis.__mosaicProf; let tP = PR ? Date.now() : 0;
    const prof = (k) => { if (PR) { const t = Date.now(); PR[k] = (PR[k] || 0) + t - tP; tP = t; } };
    const src = input.source, env = input.envelope, L0 = src.pos.slice();
    const maxF = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, st.minDistance || 0);
    const margin = st.wallMargin;
    const T = RF.Engine.targetFrame(input.target);
    const R = input.paint.res | 0, paint = input.paint.cells, nC = R * R, cellMm = 2 * T.half / R;

    // ---------------------------------------------------------------- the painting
    let mass = 0, cnt = 0, su = 0, sv = 0;
    for (let k = 0; k < nC; k++) if (paint[k] > 0) { mass += paint[k]; cnt++; su += paint[k] * (k % R); sv += paint[k] * ((k / R) | 0); }
    if (!cnt) return { surfaces: [], intent: [], notes: ['nothing painted'] };
    const typ = mass / cnt;
    let px0 = R, px1 = -1, py0 = R, py1 = -1;
    for (let k = 0; k < nC; k++) if (paint[k] > 0) { const i = k % R, j = (k / R) | 0; px0 = Math.min(px0, i); px1 = Math.max(px1, i); py0 = Math.min(py0, j); py1 = Math.max(py1, j); }
    const paintMinor = Math.min(px1 - px0 + 1, py1 - py0 + 1);
    const ker = RF.Photometry.achievableKernel(input);
    const Bl = RF.Photometry.boxBlur(paint, R, ker.cells);
    const rb = Math.ceil(ker.cells) + 2;
    const dil = (m, alongX) => { const out = new Uint8Array(nC); for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { if (!m[j * R + i]) continue; const c = alongX ? i : j; for (let q = Math.max(0, c - rb); q <= Math.min(R - 1, c + rb); q++) out[alongX ? j * R + q : q * R + i] = 1; } return out; };
    const band = dil(dil(Uint8Array.from(paint, (w) => (w > 0 ? 1 : 0)), true), false);
    let gapN = 0; for (let k = 0; k < nC; k++) if (band[k] && !(paint[k] > 0)) gapN++;

    const world = (x, y) => { const u = -T.half + (x + 0.5) * cellMm, v = -T.half + (y + 0.5) * cellMm; return V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v))); };
    const toCell = (Q) => { const d = V.sub(Q, T.C); return [(V.dot(d, T.tu) + T.half) / cellMm - 0.5, (V.dot(d, T.tv) + T.half) / cellMm - 0.5]; };
    const hitPlane = (O, d) => { const den = V.dot(d, T.n); if (!(den < -1e-12)) return null; const t = V.dot(V.sub(T.C, O), T.n) / den; return t > 0 ? V.madd(O, d, t) : null; };
    const C0 = world(su / mass, sv / mass), tHat = V.norm(V.sub(C0, L0));

    // ---------------------------------------------------------------- directions: equal-area map about "straight back"
    const G = st.dirGrid | 0, sp = 4 / G, dOm = sp * sp;
    const bH = V.neg(tHat), [e1, e2] = V.basis(bH);
    const dirOf = (X, Y) => {
      const rho = Math.hypot(X, Y); if (rho >= 2) return null; if (rho < 1e-12) return bH.slice();
      const psi = 2 * Math.asin(rho / 2), s = Math.sin(psi) / rho, c = Math.cos(psi);
      return V.norm([c * bH[0] + s * (X * e1[0] + Y * e2[0]), c * bH[1] + s * (X * e1[1] + Y * e2[1]), c * bH[2] + s * (X * e1[2] + Y * e2[2])]);
    };
    const gridOf = (d) => {
      const psi = Math.acos(clamp(V.dot(d, bH), -1, 1)), rho = 2 * Math.sin(psi / 2), x1 = V.dot(d, e1), y1 = V.dot(d, e2), l = Math.hypot(x1, y1);
      const X = l < 1e-12 ? 0 : rho * x1 / l, Y = l < 1e-12 ? 0 : rho * y1 / l;
      const gx = Math.floor((X + 2) / sp), gy = Math.floor((Y + 2) / sp);
      return gx >= 0 && gy >= 0 && gx < G && gy < G ? gy * G + gx : -1;
    };
    const fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src);
    const dens = (d) => RF.Source.intensity(src, Math.acos(clamp(V.dot(d, fr.a), -1, 1))) / Itot;   // share of LED flux per sr

    const nG = G * G, dirs = new Float64Array(3 * nG), flux = new Float64Array(nG), usable = new Uint8Array(nG);
    let mouthFlux = 0; const rEnvI = new Float64Array(nG), dirI = (i) => [dirs[3 * i], dirs[3 * i + 1], dirs[3 * i + 2]];
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx, d = dirOf(-2 + (gx + 0.5) * sp, -2 + (gy + 0.5) * sp); if (!d) continue;
      dirs[3 * i] = d[0]; dirs[3 * i + 1] = d[1]; dirs[3 * i + 2] = d[2];
      const f = dens(d) * dOm; flux[i] = f; if (!(f > 0)) continue;
      const te = exitDist(env, L0, d); if (te <= 0) continue;
      if (V.dot(envNormal(env, V.madd(L0, d, te)), tHat) > st.mouthCos) { mouthFlux += f; continue; }   // the beam's exit: keep open
      if (te * (1 - margin) < keep * 1.1 + 0.5) continue;
      usable[i] = 1; rEnvI[i] = te * (1 - margin);
    }

    // The open cone (openAngle about the beam axis) keeps facets out of the region in front of the others (see the
    // shell below).  Fallback for an LED that faces the target: if the cone leaves under half of what the envelope
    // could cover, narrow it until it doesn't.
    let cone = st.openAngle;
    {
      const inCone = (i, deg) => deg < 180 && dirs[3 * i] * tHat[0] + dirs[3 * i + 1] * tHat[1] + dirs[3 * i + 2] * tHat[2] > Math.cos(deg * Math.PI / 180);
      let all = 0; for (let i = 0; i < nG; i++) if (usable[i]) all += flux[i];
      const kept = (deg) => { let k = 0; for (let i = 0; i < nG; i++) if (usable[i] && !inCone(i, deg)) k += flux[i]; return k; };
      while (cone > 0 && kept(cone) < 0.5 * all) cone -= 5;
      for (let i = 0; i < nG; i++) if (usable[i] && inCone(i, cone)) { usable[i] = 0; mouthFlux += flux[i]; }
    }
    let usedFlux = 0, nUse = 0;
    for (let i = 0; i < nG; i++) if (usable[i]) { usedFlux += flux[i]; nUse++; }
    if (!nUse) return { surfaces: [], intent: [], notes: ['no usable directions inside the envelope'] };

    prof('dirs');
    // ---------------------------------------------------------------- equal-weight k-d tiles
    const meanF = usedFlux / nUse, wOf = (i) => flux[i] + st.areaMix * meanF;
    const leaves = [];
    const jac = (gx, gy, ax) => {   // angular length of one grid step along X (ax 0) or Y (ax 1)
      const X = -2 + (gx + 0.5) * sp, Y = -2 + (gy + 0.5) * sp, e = sp * 0.5;
      const a = ax ? dirOf(X, Y - e) : dirOf(X - e, Y), b = ax ? dirOf(X, Y + e) : dirOf(X + e, Y);
      return a && b ? V.dist(a, b) : sp;
    };
    function split(list, n) {
      if (n <= 1 || list.length < 2) { leaves.push(list); return; }
      let x0 = G, x1 = -1, y0 = G, y1 = -1, W = 0;
      for (const i of list) { const gx = i % G, gy = (i / G) | 0; if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gy < y0) y0 = gy; if (gy > y1) y1 = gy; W += wOf(i); }
      const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
      const ax = (x1 - x0 + 1) * jac(cx, cy, 0) >= (y1 - y0 + 1) * jac(cx, cy, 1) ? 0 : 1;
      const key = (i) => (ax ? ((i / G) | 0) : i % G);
      const s = list.slice().sort((a, b) => key(a) - key(b) || a - b);
      const n1t = Math.floor(n / 2), goal = W * n1t / n;
      let acc = 0, k = 0, bestK = -1, bestErr = Infinity;
      while (k < s.length) {
        const kv = key(s[k]); while (k < s.length && key(s[k]) === kv) { acc += wOf(s[k]); k++; }
        if (k < s.length && Math.abs(acc - goal) < bestErr) { bestErr = Math.abs(acc - goal); bestK = k; }
      }
      if (bestK <= 0) { leaves.push(list); return; }
      let wl = 0; for (let q = 0; q < bestK; q++) wl += wOf(s[q]);
      const n1 = clamp(Math.round(n * wl / W), 1, n - 1);
      split(s.slice(0, bestK), n1); split(s.slice(bestK), n - n1);
    }
    const all = []; for (let i = 0; i < nG; i++) if (usable[i]) all.push(i);
    split(all, maxF);

    const owner = new Int32Array(nG).fill(-1), tiles = [];
    for (const list of leaves) {
      let x0 = G, x1 = -1, y0 = G, y1 = -1, dc = [0, 0, 0];
      for (const i of list) { const gx = i % G, gy = (i / G) | 0; x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); y0 = Math.min(y0, gy); y1 = Math.max(y1, gy); dc = V.madd(dc, [dirs[3 * i], dirs[3 * i + 1], dirs[3 * i + 2]], flux[i] + 1e-12); }
      let phi = 0; for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) phi += flux[gy * G + gx];
      const Xa = -2 + x0 * sp, Xb = -2 + (x1 + 1) * sp, Ya = -2 + y0 * sp, Yb = -2 + (y1 + 1) * sp;
      const cornerDirs = [dirOf(Xa, Ya), dirOf(Xb, Ya), dirOf(Xb, Yb), dirOf(Xa, Yb)];
      if (cornerDirs.some((d) => !d) || !(phi > 0)) continue;
      const d = V.norm(dc), te = exitDist(env, L0, d); if (te <= 0) continue;
      const id = tiles.length;
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) owner[gy * G + gx] = id;
      tiles.push({ id, d, r0: te * (1 - margin), phi: phi * refl, cornerDirs, rect: [Xa, Xb, Ya, Yb] });
    }

    // ---------------------------------------------------------------- facet geometry for an aim point
    function geomAt(tile, aimW, r) {
      const P = V.madd(L0, tile.d, r), s = V.norm(V.sub(L0, P)), a = V.norm(V.sub(aimW, P)), n = V.norm(V.add(s, a));
      const PL = V.dot(V.sub(P, L0), n), corners = [];
      for (const cd of tile.cornerDirs) { const den = V.dot(cd, n); if (!(den < -0.05) || PL / den > 3 * r) return null; corners.push(V.madd(L0, cd, PL / den)); }   // grazing corner: degenerate facet
      return { P, s, a, n, corners };
    }
    function fit(tile, aimW) {
      let r = tile.r0;
      for (let it = 0; it < 8; it++) {
        const g = geomAt(tile, aimW, r); if (!g) return null;
        let f = 1;
        for (const q of g.corners) { const d = V.sub(q, L0), l = V.len(d), te = exitDist(env, L0, V.mul(d, 1 / l)); if (te <= 0) return null; f = Math.min(f, te * (1 - margin) / l); }
        if (f >= 0.9999) {
          const minC = Math.min(...g.corners.map((q) => V.dist(q, L0)));
          if (minC < keep * 1.04 + 0.3 || -V.dot(V.sub(g.P, L0), g.n) < keep * 1.04 + 0.3 && minC < keep * 2) return null;
          return { r, g };
        }
        r *= f;
      }
      return null;
    }

    prof('tiles');
    // ---------------------------------------------------------------- shell: the farthest facets whose exits don't overlap
    // Seen from the target, facet outlines must not overlap, or one facet's reflected light runs into another.  Along
    // a meridian (a radial line of the direction map: rear → front), the facet surface's distance from the beam axis,
    // ρ = r·sinψ, must keep growing toward the front — a paraboloid does exactly this.  Between neighbouring tiles on a
    // meridian that is r_a·A ≤ r_b·B.  Start every tile at its envelope limit, lower rear tiles until all hold, and
    // drop a tile that would have to come inside the LED clearance.
    const keepMin = keep * 1.04 + 0.3;
    for (const tile of tiles) {
      const F = fit(tile, C0); tile.ok = !!F; if (!F) continue;
      tile.rEnv = F.r; tile.n0 = F.g.n; tile.dn = V.dot(tile.d, F.g.n);
      tile.rMin = keepMin / Math.min(Math.abs(tile.dn), ...tile.cornerDirs.map((cd) => tile.dn / V.dot(cd, tile.n0)));
      if (!(tile.rMin <= tile.rEnv)) tile.ok = false;
    }
    const cf = (tile, d) => tile.dn / V.dot(d, tile.n0);                        // plane distance along d, per unit r
    const sinB = (i) => Math.sqrt(Math.max(0, 1 - (dirs[3 * i] * bH[0] + dirs[3 * i + 1] * bH[1] + dirs[3 * i + 2] * bH[2]) ** 2));
    const nBin = Math.max(24, Math.round(2 * Math.PI * 1.6 / sp)), bins = Array.from({ length: nBin }, () => []);
    for (let i = 0; i < nG; i++) {
      const o = owner[i]; if (o < 0 || !tiles[o].ok) continue;
      const X = -2 + (i % G + 0.5) * sp, Y = -2 + (((i / G) | 0) + 0.5) * sp;
      bins[Math.min(nBin - 1, Math.floor((Math.atan2(Y, X) / (2 * Math.PI) + 0.5) * nBin))].push([Math.hypot(X, Y), i]);
    }
    const cons = new Map();
    for (const bin of bins) {
      bin.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (let q = 1; q < bin.length; q++) {
        const i = bin[q - 1][1], j = bin[q][1], a = owner[i], b = owner[j]; if (a === b) continue;
        const A = cf(tiles[a], dirI(i)) * sinB(i), Bv = cf(tiles[b], dirI(j)) * sinB(j);
        if (!(A > 1e-9) || !(Bv > 0)) continue;
        const key = a * 1000003 + b, prev = cons.get(key);
        if (!prev || Bv / A < prev[2]) cons.set(key, [a, b, Bv / A]);
      }
    }
    // a transition both ways (a before b on one meridian, b before a on another) means the tiles sit side by side,
    // not one behind the other: no ordering between them
    const radOf = (t) => Math.hypot((t.rect[0] + t.rect[1]) / 2, (t.rect[2] + t.rect[3]) / 2);
    const conList = [...cons.values()].filter(([a, b]) => !cons.has(b * 1000003 + a) && radOf(tiles[b]) > radOf(tiles[a])).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const act = tiles.map((t) => t.ok);
    for (let round = 0; round < 40; round++) {
      for (const t of tiles) t.r = t.rEnv;
      for (let it = 0; it < 2000; it++) {
        let ch = false;
        for (const [a, b, ratio] of conList) { if (!act[a] || !act[b]) continue; const lim = tiles[b].r * ratio * (1 - st.clearance); if (tiles[a].r > lim * (1 + 1e-9)) { tiles[a].r = lim; ch = true; } }
        if (!ch) break;
      }
      let worst = -1, wv = 1;
      for (const t of tiles) if (act[t.id] && t.r / t.rMin < wv) { wv = t.r / t.rMin; worst = t.id; }
      if (worst < 0) break;
      act[worst] = false;                                                        // one at a time: dropping it may free others
    }
    for (let i = 0; i < nG; i++) if (owner[i] >= 0 && !act[owner[i]]) owner[i] = -1;
    let shellShrink = 0, shellN = 0; for (const t of tiles) if (act[t.id]) { shellShrink += t.r / t.rEnv; shellN++; }

    prof('shell');
    // ---------------------------------------------------------------- blob models
    const ledPts = ledPoints(src, st.ledSamples | 0);
    const alphas = [0, 0.35, 0.75, 1.25, 2, 3].filter((a) => a <= st.maxDefocus + 1e-9);
    const NA = 6;   // aperture samples per side
    const fac = [];
    for (const tile of tiles) {
      if (!act[tile.id]) continue;
      const g0 = geomAt(tile, C0, tile.r); if (!g0) continue;
      const F0 = { r: tile.r, g: g0 }, g = g0, aim0 = toCell(C0);
      const led = [];
      for (const x of ledPts) { const e = V.norm(V.sub(g.P, x)), Q = hitPlane(g.P, V.reflect(e, g.n)); if (Q) { const c = toCell(Q); led.push([c[0] - aim0[0], c[1] - aim0[1]]); } }
      if (!led.length) continue;
      const ap = [];
      const PL = V.dot(V.sub(g.P, L0), g.n);
      for (let a = 0; a < NA; a++) for (let b = 0; b < NA; b++) {
        const X = tile.rect[0] + (a + 0.5) / NA * (tile.rect[1] - tile.rect[0]), Y = tile.rect[2] + (b + 0.5) / NA * (tile.rect[3] - tile.rect[2]);
        const d = dirOf(X, Y); if (!d) continue; const den = V.dot(d, g.n); if (!(den < -0.05)) continue;
        const w = dens(d); if (w > 0) ap.push([V.madd(L0, d, PL / den), w]);
      }
      if (!ap.length) continue;
      const D = V.dist(C0, g.P);
      const spread = (pts) => { let mx = 0, my = 0, W = 0; for (const p of pts) { mx += p[2] * p[0]; my += p[2] * p[1]; W += p[2]; } mx /= W; my /= W; let v = 0; for (const p of pts) v += p[2] * ((p[0] - mx) ** 2 + (p[1] - my) ** 2); return Math.sqrt(6 * v / W); };
      const apOff = (m) => {
        const I = V.madd(g.P, g.a, D / (1 - m)), out = [];
        for (const [q, w] of ap) { const Q = m === 0 ? C0 : hitPlane(q, V.norm(V.sub(I, q))); if (Q) { const c = toCell(Q); out.push([c[0] - aim0[0], c[1] - aim0[1], w]); } }
        return out;
      };
      const ledExt = spread(led.map((p) => [p[0], p[1], 1])), apUnit = spread(apOff(-1)) || 1e-9;
      const sizes = alphas.map((al) => {
        const m = al === 0 ? 0 : -al * ledExt / apUnit, apo = apOff(m);
        let W = 0; for (const p of apo) W += p[2];
        const pts = []; for (const o of led) for (const p of apo) pts.push([o[0] + p[0], o[1] + p[1], p[2] / (W * led.length)]);
        return { m, pts, ext: spread(pts) };
      });
      // a blob wider than the painting's short side can only spill: keep sharp focus always, larger sizes only if they fit
      const useful = sizes.filter((z, i) => i === 0 || z.ext <= st.maxBlobFrac * paintMinor);
      fac.push({ tile, phi: tile.phi, sizes: useful, ext0: sizes[0].ext, r: F0.r });
    }
    if (!fac.length) return { surfaces: [], intent: [], notes: ['no facet fits the envelope'] };

    prof('blobs');
    // sub-cell phases, then rasterise every (facet, size, phase)
    const exts = fac.map((f) => f.ext0).sort((a, b) => a - b), medExt = exts[exts.length >> 1];
    const PH = clamp(Math.ceil(st.phaseRes / Math.max(0.25, medExt)), 1, st.maxPhases | 0), phases = [];
    for (let a = 0; a < PH; a++) for (let b = 0; b < PH; b++) phases.push([(a + 0.5) / PH - 0.5, (b + 0.5) / PH - 0.5]);
    let ph0 = 0; phases.forEach((p, i) => { if (Math.hypot(p[0], p[1]) < Math.hypot(phases[ph0][0], phases[ph0][1]) - 1e-12) ph0 = i; });
    function raster(pts, px, py) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) { const x = p[0] + px, y = p[1] + py; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const ox = Math.floor(x0), oy = Math.floor(y0), w = Math.floor(x1) - ox + 2, h = Math.floor(y1) - oy + 2, buf = new Float64Array(w * h);
      for (const p of pts) {
        const x = p[0] + px - ox, y = p[1] + py - oy, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
        buf[j * w + i] += p[2] * (1 - fx) * (1 - fy); buf[j * w + i + 1] += p[2] * fx * (1 - fy);
        buf[(j + 1) * w + i] += p[2] * (1 - fx) * fy; buf[(j + 1) * w + i + 1] += p[2] * fx * fy;
      }
      // drop the faint tail (< tailCut × the blob's peak cell), rescaled so the blob still carries all its flux
      let mx = 0, tot = 0, kept = 0; for (const v of buf) { if (v > mx) mx = v; tot += v; }
      const di = [], dj = [], wt = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (buf[j * w + i] > st.tailCut * mx) { di.push(i + ox); dj.push(j + oy); wt.push(buf[j * w + i]); kept += buf[j * w + i]; }
      return { di: Int16Array.from(di), dj: Int16Array.from(dj), w: Float64Array.from(wt, (v) => v * tot / kept) };
    }
    for (const f of fac) for (const s of f.sizes) { s.ras = phases.map((ph) => raster(s.pts, ph[0], ph[1])); s.stride = Math.max(1, Math.floor(s.ext / st.strideDiv)); s.pts = null; }

    prof('raster');
    // ---------------------------------------------------------------- the cost the mosaic minimises (mirrors the scorer)
    let phiTot = 0; for (const f of fac) phiTot += f.phi;
    const S = st.fill * phiTot / mass, tight = st.tight;
    const kind = new Int8Array(nC), tgt = new Float64Array(nC), lo = new Float64Array(nC), hi = new Float64Array(nC), allow = new Float64Array(nC);
    for (let k = 0; k < nC; k++) {
      if (paint[k] > 0) { kind[k] = 1; tgt[k] = S * paint[k]; lo[k] = 0.8 * S * Math.min(paint[k], Bl[k]) * (1 + tight); hi[k] = 1.25 * S * Math.max(paint[k], Bl[k]) / (1 + tight); }
      else if (band[k]) { kind[k] = 2; allow[k] = S * Math.max(1.25 * Bl[k], 0.1 * typ); }
    }
    const lamG = st.gapWeight * cnt / Math.max(1, gapN), ramp = 0.3 * S * typ, lamF = st.farWeight, sTyp = S * typ;
    const gv = new Float64Array(nC), E0 = new Float64Array(nC);
    const M = { R, kind, tgt, lo, hi, allow, lamG, ramp, lamF, sTyp, gv, E0 };
    const cost = (c, g) => cellCost(M, c, g);

    // direct light from the LED (uncovered directions reach the target unreflected): a fixed baseline
    const cellArea = cellMm * cellMm;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const W = world(i, j), dv = V.sub(W, L0), dist = V.len(dv), d = V.mul(dv, 1 / dist), gi = gridOf(d);
      if (gi >= 0 && owner[gi] >= 0) continue;
      gv[j * R + i] = dens(d) * cellArea * Math.abs(V.dot(d, T.n)) / (dist * dist);
    }
    // Direct light that would light the gaps (an LED facing the target): put one flat mirror just in front of the LED,
    // square to the beam axis, covering the cone toward the painting and its gap band, so that light goes straight
    // back instead.  It sits in the open cone, where no facet is, and far inside the others' exit heights.
    let blocker = null;
    {
      let hot = 0, gapC = 0; for (let k = 0; k < nC; k++) if (kind[k] === 2) { gapC++; if (gv[k] > 0.3 * allow[k]) hot++; }
      if (st.blocker && gapC && hot > 0.05 * gapC) {
        const [u1, u2] = V.basis(tHat), ledR = RF.Source.boundingRadius(src);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < nC; k++) if (band[k]) {
          const d = V.sub(world(k % R, (k / R) | 0), L0), t = V.dot(d, tHat), h = 0.75 * cellMm / t;
          const a = V.dot(d, u1) / t, b = V.dot(d, u2) / t; a0 = Math.min(a0, a - h); a1 = Math.max(a1, a + h); b0 = Math.min(b0, b - h); b1 = Math.max(b1, b + h);
        }
        const te = exitDist(env, L0, tHat), rb = Math.max(keepMin * 1.15, keepMin + 2 * ledR);
        if (te > 0 && rb < te * (1 - margin) - 0.5 && a1 - a0 < 3 && b1 - b0 < 3) {
          const P = V.madd(L0, tHat, rb), m = ledR * 1.2;
          const at = (a, b) => V.add(P, V.add(V.mul(u1, a), V.mul(u2, b)));
          blocker = { type: 'facet', id: 'B0', P, S0: L0.slice(), Z: V.madd(L0, tHat, -1000), di: null, flat: true,
            clip: { kind: 'poly', pts3: [at(a0 * rb - m, b0 * rb - m), at(a1 * rb + m, b0 * rb - m), at(a1 * rb + m, b1 * rb + m), at(a0 * rb - m, b1 * rb + m)] },
            optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
          for (let k = 0; k < nC; k++) { const d = V.sub(world(k % R, (k / R) | 0), L0), t = V.dot(d, tHat), a = V.dot(d, u1) / t, b = V.dot(d, u2) / t; if (t > 0 && a > a0 && a < a1 && b > b0 && b < b1) gv[k] = 0; }
        }
      }
    }
    let directOn = 0; for (let k = 0; k < nC; k++) if (paint[k] > 0) directOn += gv[k];
    for (let k = 0; k < nC; k++) E0[k] = cost(k, gv[k]);

    prof('direct');
    // blocking: march rays from the facet's corners and centre toward an aim; a ray that crosses another facet's
    // surface inside that facet's cone is lost.  Evaluated on a coarse grid of aims over the paint, looked up per cell.
    const cand = []; let bx0 = R, bx1 = 0, by0 = R, by1 = 0;
    for (let k = 0; k < nC; k++) if (paint[k] > 0) { cand.push(k); const i = k % R, j = (k / R) | 0; bx0 = Math.min(bx0, i); bx1 = Math.max(bx1, i); by0 = Math.min(by0, j); by1 = Math.max(by1, j); }
    const NB = 7, STEPS = 40, bgx = (a) => bx0 + (bx1 - bx0) * a / (NB - 1), bgy = (b) => by0 + (by1 - by0) * b / (NB - 1);
    function blockedFrac(f, W) {
      const k = f.tile.id, g = geomAt(f.tile, C0, f.r), starts = [g.P, ...g.corners.map((q) => V.lerp(q, g.P, 0.08))];
      let nb = 0;
      for (const S of starts) {
        const u = V.norm(V.sub(W, S)), te = exitDist(env, S, u); if (te <= 0) continue;
        let prevO = -2, prevS = 0;
        for (let s = 1; s <= STEPS; s++) {
          const Q = V.madd(S, u, te * s / STEPS), dq = V.sub(Q, L0), lq = V.len(dq), d = V.mul(dq, 1 / lq), gi = gridOf(d), o = gi >= 0 ? owner[gi] : -1;
          if (o < 0 || o === k) { prevO = o; continue; }
          const sg = lq > tiles[o].r * cf(tiles[o], d) ? 1 : -1;
          if (o === prevO && sg !== prevS) { nb++; break; }
          prevO = o; prevS = sg;
        }
      }
      return nb / starts.length;
    }
    let blockedAims = 0, allAims = 0;
    for (const f of fac) {
      const bg = new Float64Array(NB * NB);
      for (let b = 0; b < NB; b++) for (let a = 0; a < NB; a++) { bg[b * NB + a] = blockedFrac(f, world(bgx(a), bgy(b))); allAims++; if (bg[b * NB + a] > 0) blockedAims++; }
      const keepF = new Float64Array(nC);
      for (const c of cand) {
        const a = bx1 > bx0 ? Math.round((c % R - bx0) / (bx1 - bx0) * (NB - 1)) : 0, b = by1 > by0 ? Math.round((((c / R) | 0) - by0) / (by1 - by0) * (NB - 1)) : 0;
        keepF[c] = 1 - bg[b * NB + a];
      }
      f.keepF = keepF;
    }

    prof('blocking');
    // ---------------------------------------------------------------- the mosaic: greedy placement + sweeps
    function apply(f, sgn) {
      const s = f.sizes[f.at.si], rs = s.ras[f.at.ph], I = f.at.c % R, J = (f.at.c / R) | 0, a = sgn * f.at.phi;
      for (let e = 0; e < rs.w.length; e++) { const x = I + rs.di[e], y = J + rs.dj[e]; if (x < 0 || y < 0 || x >= R || y >= R) continue; const c = y * R + x; gv[c] += a * rs.w[e]; if (gv[c] < 0) gv[c] = 0; E0[c] = cost(c, gv[c]); }
    }
    // global search on a stride of ~ext/strideDiv cells; local (a window around `near`, every cell) when refining
    const evalAt = (rs, I, J, phi) => blobDelta(M, rs, I, J, phi);
    // Global (first placement): scan (size × cell) on a stride of ~ext/strideDiv at the centre phase, keep the best
    // TOPK per size, then try every phase on those cells and their neighbours.  Local (refinement, `near` = current
    // spot): every phase on every cell of a window around it.
    const TOPK = 2, isPainted = new Uint8Array(nC); for (const c of cand) isPainted[c] = 1;
    function best(f, near, sweep) {
      let bE = -1e-12 * cnt, bAt = null;
      const tryAt = (si, I, J, ph) => {
        if (I < 0 || J < 0 || I >= R || J >= R) return; const c = J * R + I; if (!isPainted[c]) return;
        const kf = f.keepF[c]; if (kf < st.minClear) return;
        const phi = f.phi * kf, dE = evalAt(f.sizes[si].ras[ph], I, J, phi); if (dE < bE) { bE = dE; bAt = { si, c, ph, phi }; }
      };
      if (near) {
        const I0 = near.c % R, J0 = (near.c / R) | 0;
        for (let si = 0; si < f.sizes.length; si++) {
          if (sweep > 0 && Math.abs(si - near.si) > 1) continue;                   // later sweeps: only neighbouring sizes
          const s = f.sizes[si], st2 = Math.max(1, Math.floor(s.stride / 3 / (1 << sweep))), win = Math.max(1, Math.ceil(s.ext * 0.3 / (1 << sweep)));
          for (let J = J0 - win; J <= J0 + win; J += st2) for (let I = I0 - win; I <= I0 + win; I += st2) for (let ph = 0; ph < s.ras.length; ph++) tryAt(si, I, J, ph);
        }
        return bAt;
      }
      for (let si = 0; si < f.sizes.length; si++) {
        const s = f.sizes[si], st2 = s.stride, rs = s.ras[ph0], top = [];
        for (const c of cand) {
          const I = c % R, J = (c / R) | 0;
          if (st2 > 1 && (I % st2 || J % st2)) continue;
          const kf = f.keepF[c]; if (kf < st.minClear) continue;
          const dE = evalAt(rs, I, J, f.phi * kf);
          if (top.length < TOPK || dE < top[top.length - 1][0]) { top.push([dE, c]); top.sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (top.length > TOPK) top.pop(); }
        }
        for (const [, c0] of top) { const I1 = c0 % R, J1 = (c0 / R) | 0, w = Math.max(1, Math.floor(st2 / 2)); for (let J = J1 - w; J <= J1 + w; J++) for (let I = I1 - w; I <= I1 + w; I++) for (let ph = 0; ph < s.ras.length; ph++) tryAt(si, I, J, ph); }
      }
      return bAt;
    }
    const order = fac.map((f, i) => i).sort((a, b) => fac[b].ext0 - fac[a].ext0 || a - b);
    for (const i of order) { const f = fac[i]; f.at = best(f); if (f.at) apply(f, 1); }
    for (let sw = 0; sw < st.sweeps; sw++) for (const i of order) { const f = fac[i], was = f.at; if (was) apply(f, -1); f.at = best(f, was, sw); if (f.at) apply(f, 1); }

    // model's own view of the result (for notes; the runner's trace is the real verdict)
    let inB = 0, gapOk = 0, onP = 0;
    for (let k = 0; k < nC; k++) { if (kind[k] === 1) { onP += gv[k]; if (gv[k] >= 0.8 * Math.min(tgt[k], S * Bl[k]) && gv[k] <= 1.25 * Math.max(tgt[k], S * Bl[k])) inB++; } else if (kind[k] === 2 && gv[k] <= allow[k]) gapOk++; }

    prof('mosaic');
    // ---------------------------------------------------------------- output
    const surfaces = [], intent = [], opt = { interaction: 'reflect', reflectivity: refl, twoSided: false };
    let dropped = 0;
    if (blocker) { surfaces.push(blocker); intent.push({ facet: blocker.id, cells: [] }); notes.push('direct light would light the gaps: a flat blocker in front of the LED sends it back'); }
    for (const f of fac) {
      if (!f.at) { dropped++; continue; }
      if (surfaces.length >= maxF) { dropped++; continue; }                          // the blocker used one of the budget
      const ph = phases[f.at.ph], I = f.at.c % R, J = (f.at.c / R) | 0, W = world(I + ph[0], J + ph[1]);
      const g1 = geomAt(f.tile, W, f.r); if (!g1) { dropped++; continue; }
      let F1 = { r: f.r, g: g1 };
      const m = f.sizes[f.at.si].m, id = 'M' + surfaces.length;
      const mk = (F) => { const D = V.dist(W, F.g.P); return { type: 'facet', id, P: F.g.P, S0: L0.slice(), Z: W, di: D / (1 - m), flat: false, clip: { kind: 'poly', pts3: F.g.corners }, optics: Object.assign({}, opt) }; };
      let s = mk(F1);
      // the real (curved) surface must sit inside the envelope and outside the clearance: check its outline, pull in if not
      for (let it = 0; ; it++) {
        const Gc = RF.Geo.compile([s]); let bad = false;
        for (const poly of RF.Geo.outline(Gc, 0)) for (const p of poly) if (!RF.Geo.envInside(env, p, 0) || V.dist(p, L0) < keep * 1.02) bad = true;
        if (!bad) break;
        const g2 = it < 12 ? geomAt(f.tile, W, F1.r * 0.97) : null; if (!g2) { s = null; break; }   // still outside after 12 pulls: leave it out
        F1 = { r: F1.r * 0.97, g: g2 }; s = mk(F1);
      }
      if (!s) { dropped++; continue; }
      surfaces.push(s);
      const rs = f.sizes[f.at.si].ras[f.at.ph], cells = [];
      for (let e = 0; e < rs.w.length; e++) { const x = I + rs.di[e], y = J + rs.dj[e]; if (x >= 0 && y >= 0 && x < R && y < R) cells.push([y * R + x, +rs.w[e].toFixed(4)]); }
      intent.push({ facet: id, cells });
    }
    notes.push(surfaces.length + ' facets placed of ' + fac.length + ' tiles (' + dropped + ' left out: no placement helped) · LED flux on tiles ' + (100 * phiTot / refl).toFixed(1) + '%, through the open front ' + (100 * mouthFlux).toFixed(1) + '%');
    notes.push('open cone ' + cone + '° · shell: ' + shellN + ' tiles kept, mean distance ' + (100 * shellShrink / Math.max(1, shellN)).toFixed(0) + '% of the envelope limit · aims blocked (any ray) ' + (100 * blockedAims / Math.max(1, allAims)).toFixed(0) + '%');
    // last line of defence: the host's own constraint check (envelope, LED clearance on the real surface).  It is a
    // geometry test, not a light trace.  Anything it flags is left out rather than shipped.
    const vf = RF.Solvers.verify({ envelope: env, source: src, target: input.target, modeA: { budget: maxF } }, { surfaces, intent });
    const badIds = new Set([...vf.violations.envelope, ...vf.violations.keepOut]);
    if (badIds.size) {
      notes.push(badIds.size + ' facet(s) failed the envelope/clearance check and were left out');
      for (let q = surfaces.length - 1; q >= 0; q--) if (badIds.has(surfaces[q].id)) { surfaces.splice(q, 1); intent.splice(q, 1); }
    }
    const hist = {}; for (const f of fac) if (f.at) { const k = f.at.si; hist[k] = (hist[k] || 0) + 1; }
    notes.push('blob sizes used (index: count) ' + JSON.stringify(hist));
    notes.push('model: painted cells in band ' + (100 * inB / cnt).toFixed(1) + '%, gaps dark ' + (100 * gapOk / Math.max(1, gapN)).toFixed(1) + '%, on paint ' + (100 * onP).toFixed(1) + '% (direct ' + (100 * directOn).toFixed(2) + '%) · phases ' + PH + '×' + PH + ', median LED image ' + medExt.toFixed(2) + ' cells');
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'opus-mosaic', name: 'Mosaic (static)', version: '0.5', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'fill', label: 'Target level (× available flux)', type: 'range', min: 0.3, max: 1.5, step: 0.05, default: 0.9 },
      { key: 'gapWeight', label: 'Dark-gap weight', type: 'range', min: 0, max: 8, step: 0.25, default: 1 },
      { key: 'farWeight', label: 'Stray-light weight', type: 'range', min: 0, max: 1, step: 0.01, default: 0.02 },
      { key: 'tight', label: 'Tolerance safety margin', type: 'range', min: 0, max: 0.2, step: 0.01, default: 0.06 },
      { key: 'maxDefocus', label: 'Max defocus (× LED image)', type: 'range', min: 0, max: 3, step: 0.05, default: 2 },
      { key: 'openAngle', label: 'Open cone toward the target (deg)', type: 'range', min: 0, max: 180, step: 1, default: 90 },
      { key: 'mouthCos', label: 'Open front (cos)', type: 'range', min: -0.2, max: 1, step: 0.05, default: 0.5 },
      { key: 'areaMix', label: 'Tile area mix', type: 'range', min: 0, max: 2, step: 0.05, default: 0.15 },
      { key: 'wallMargin', label: 'Wall margin (fraction)', type: 'range', min: 0.005, max: 0.2, step: 0.005, default: 0.02 },
      { key: 'clearance', label: 'Exit clearance between facets', type: 'range', min: 0, max: 0.2, step: 0.005, default: 0.005 },
      { key: 'minClear', label: 'Min unblocked share of a facet', type: 'range', min: 0, max: 1, step: 0.05, default: 0.6 },
      { key: 'maxBlobFrac', label: 'Largest blob (× paint short side)', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
      { key: 'blocker', label: 'Block direct light that would light the gaps', type: 'checkbox', default: true },
      { key: 'sweeps', label: 'Re-placement sweeps', type: 'range', min: 0, max: 6, step: 1, default: 4 },
      { key: 'dirGrid', label: 'Direction grid', type: 'range', min: 60, max: 400, step: 10, default: 200 },
      { key: 'ledSamples', label: 'LED samples per side', type: 'range', min: 2, max: 8, step: 1, default: 5 },
      { key: 'phaseRes', label: 'Sub-cell phase resolution', type: 'range', min: 1, max: 24, step: 0.5, default: 12 },
      { key: 'maxPhases', label: 'Max sub-cell phases per axis', type: 'range', min: 1, max: 8, step: 1, default: 4 },
      { key: 'tailCut', label: 'Blob tail cut (× peak cell)', type: 'range', min: 0, max: 0.2, step: 0.005, default: 0.02 },
      { key: 'strideDiv', label: 'Candidate stride divisor', type: 'range', min: 2, max: 20, step: 1, default: 4 },
    ],
    solve(input, settings) { return solve(input, settings); },
  });

  // ================================================================ the tuner (optional step 3)
  // Everything above is the static solver, unchanged.  The tuner only picks the static solver's settings for a goal:
  // it runs the static solve() with candidate settings and traces each result with tools.trace (same seed every
  // call, so candidates differ by geometry, not dice).  The search is a fixed coordinate descent over six knobs, so
  // the tuner is deterministic too: screen at `screenRays`, then re-trace the best three at `finalRays` and keep one.
  //
  // Goals.  The score treats efficiency relative to a reference solver it doesn't show; the tuner uses its own
  // default-settings design as that reference (op0, pk0), with the task's efficiency gate g(F):
  //   faithful   J = F  (+ a hair of on-paint light to break ties)
  //   efficient  J = F + g(F)·0.5·(0.7·min(2, onPaint/op0) + 0.3·min(2, peak/pk0)) / 2   — the score's own shape
  //   throw      J = F + g(F)·0.5·(0.1·min(2, onPaint/op0) + 0.9·min(2, peak/pk0)) / 2   — peak candela first
  const TUNE_KNOBS = [
    ['openAngle', [75, 80, 85, 95, 100, 105]], ['fill', [0.8, 1.0]], ['gapWeight', [0.6, 1.6]],
    ['maxDefocus', [1.25, 3]], ['tight', [0.02, 0.12]], ['areaMix', [0.05, 0.4]],
  ];
  const GOAL_W = { faithful: null, efficient: [0.7, 0.3], throw: [0.1, 0.9] };
  RF.Solvers.register({
    id: 'opus-mosaic-auto', name: 'Mosaic auto-tuner', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful (fidelity first)' }, { value: 'efficient', label: 'Efficient (light on the paint)' }, { value: 'throw', label: 'Throw (peak intensity)' }] },
      { key: 'screenRays', label: 'Rays per candidate', type: 'number', min: 50000, step: 50000, default: 600000 },
      { key: 'finalRays', label: 'Rays for the final three', type: 'number', min: 50000, step: 50000, default: 1000000 },
    ],
    async solve(input, settings, tools) {
      const def = RF.Solvers.get('opus-mosaic');
      const base = Object.assign(RF.Solvers.defaults(def), { minDistance: settings.minDistance });
      const design = (over) => solve(RF.U.deepCopy(input), RF.Solvers.sanitize(def, Object.assign({}, base, over)));
      if (!tools || typeof tools.trace !== 'function') { const o = design({}); o.notes.unshift('auto: no tracer available, static defaults used'); return o; }
      // a static solve grows with the facet cap (~2 s at 400): above 150 facets tune only the open cone, to stay inside 60 s
      const knobs = input.limits.maxFacets > 150 ? TUNE_KNOBS.slice(0, 1) : TUNE_KNOBS;
      const seed = input.seed | 0, w = GOAL_W[settings.goal] || null, cache = new Map(), total = 1 + knobs.reduce((a, k) => a + k[1].length, 0) + 3;
      let done = 0, op0 = 0, pk0 = 0;
      const run = async (over, rays) => {
        const key = JSON.stringify(over) + '@' + rays; if (cache.has(key)) return cache.get(key);
        const out = design(over), tr = await tools.trace(out.surfaces, { rays, seed }), f = tr.fidelity || {};
        const r = { over, out, rays, F: f.fidelity || 0, op: f.onPaint || 0, pk: tr.peakCd || 0 };
        cache.set(key, r); done++; if (tools.progress) tools.progress(Math.min(0.99, done / total));
        return r;
      };
      const J = (r) => {
        if (!w) return r.F + 0.01 * (op0 > 0 ? r.op / op0 : 0);
        const g = clamp((r.F - 0.5) / 0.25, 0, 1), ro = op0 > 0 ? Math.min(2, r.op / op0) : 0, rp = pk0 > 0 ? Math.min(2, r.pk / pk0) : 0;
        return r.F + g * 0.5 * (w[0] * ro + w[1] * rp) / 2;
      };
      const R0 = settings.screenRays, R1 = settings.finalRays;
      let best = await run({}, R0); op0 = best.op; pk0 = best.pk;
      for (const [k, vals] of knobs) {
        let kb = best;
        for (const v of vals) { const r = await run(Object.assign({}, best.over, { [k]: v }), R0); if (J(r) > J(kb) + 1e-9) kb = r; }
        best = kb;
      }
      const screened = [...cache.values()].sort((a, b) => J(b) - J(a) || JSON.stringify(a.over).localeCompare(JSON.stringify(b.over)));
      let pick = screened[0];
      if (R1 !== R0) {
        const fin = []; for (const r of screened.slice(0, 3)) fin.push(await run(r.over, R1));
        fin.sort((a, b) => J(b) - J(a) || JSON.stringify(a.over).localeCompare(JSON.stringify(b.over)));
        pick = fin[0];
      }
      const out = pick.out, fmt = (r) => 'fidelity ' + (100 * r.F).toFixed(1) + '%, on paint ' + (100 * r.op).toFixed(1) + '%, peak ' + Math.round(r.pk).toLocaleString('en-US') + ' cd';
      out.notes = ['auto (' + (settings.goal || 'faithful') + '): ' + (Object.keys(pick.over).length ? JSON.stringify(pick.over) : 'static defaults') + ' · ' + fmt(pick) + ' at ' + pick.rays.toLocaleString('en-US') + ' rays',
        'auto: ' + done + ' candidates traced; static defaults gave ' + fmt(cache.get('{}@' + R0)) + ' at ' + R0.toLocaleString('en-US') + ' rays'].concat(out.notes);
      return out;
    },
  });
})();
})();
