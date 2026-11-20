/* solvers/solver.js — "foldplane": a static faceted-reflector solver.
 *
 * Idea (see solvers/NOTES.md):
 *  · The LED points along its axis; the target is far away in another direction.  Every facet has to
 *    fold the beam, and the natural place to do that is ONE plane whose normal is the bisector of
 *    (LED axis) and (throw direction).  A plane is blocking-free by construction: the reflected rays
 *    leave toward the +n half-space and a flat plane is never re-hit by its own reflections, and the
 *    LED sees every point of it (no mutual shadowing).
 *  · Sharpness is set by the facet's distance r from the LED: the LED image on the target is
 *    ~ ledSize · q / r  (q = facet→target).  Étendue — no curvature beats it.  So the plane is tiled
 *    only where r ≥ rMin, and rMin is chosen by an analytic model of the delivered pattern.
 *  · The pattern is painted by AIMING: each facet is an ellipsoid with foci (LED, aim point), so it
 *    paints a sharp image of the LED centred on its aim.  Aims are allocated by a fixed-weight greedy
 *    match of  Σ w_f · K_f(z − z_f)  to the paint, w_f = the flux the facet catches, K_f = its LED image.
 *  · No rays are traced: the delivered pattern is predicted with the same box kernels and scored with
 *    RF.Photometry.fidelity on the prediction, to pick rMin and the plane offset.
 */
(function () {
  'use strict';
  const V = RF.V;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ---------------------------------------------------------------- paint-grid helpers
  // Fractional box blur along one axis, unit sum, prefix-sum based: O(R²).
  function blurAxis(g, R, w, alongX) {
    if (!(w > 1e-6)) return Float64Array.from(g);
    const h = w / 2, out = new Float64Array(R * R), pre = new Float64Array(R + 1);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) pre[i + 1] = pre[i] + (alongX ? g[j * R + i] : g[i * R + j]);
      for (let i = 0; i < R; i++) {
        const a = i + 0.5 - h, b = i + 0.5 + h;
        const ia = Math.floor(a), ib = Math.floor(b);
        let s = 0;
        if (ib === ia) s = (b - a) * (pre[ia + 1] - pre[ia]);
        else {
          s = pre[ib] - pre[ia + 1];                       // whole cells ia+1 .. ib-1
          s += (ia + 1 - a) * (pre[ia + 1] - pre[ia]);      // partial left cell
          s += (b - ib) * (pre[ib + 1] - pre[ib]);          // partial right cell
        }
        out[alongX ? j * R + i : i * R + j] = s / w;
      }
    }
    return out;
  }
  const blur2 = (g, R, wx, wy) => blurAxis(blurAxis(g, R, wx, true), R, wy, false);
  // unnormalised correlation with a box kernel (for the greedy: argmax is what matters)
  const corrBox = (g, R, wx, wy) => { const b = blur2(g, R, wx, wy); const s = wx * wy; for (let i = 0; i < b.length; i++) b[i] *= s; return b; };

  // add w · box(wx,wy) centred on cell (i0,j0) into G (clipped at the grid edge)
  function stamp(G, R, i0, j0, wx, wy, w, sign) {
    const hx = wx / 2, hy = wy / 2, s = sign * w / (wx * wy);
    const a0 = i0 + 0.5 - hx, b0 = i0 + 0.5 + hx, c0 = j0 + 0.5 - hy, d0 = j0 + 0.5 + hy;
    for (let j = Math.max(0, Math.floor(c0)); j < Math.min(R, Math.ceil(d0)); j++) {
      const oy = Math.min(d0, j + 1) - Math.max(c0, j); if (!(oy > 0)) continue;
      for (let i = Math.max(0, Math.floor(a0)); i < Math.min(R, Math.ceil(b0)); i++) {
        const ox = Math.min(b0, i + 1) - Math.max(a0, i); if (!(ox > 0)) continue;
        G[j * R + i] += s * ox * oy;
      }
    }
  }

  /* Matching pursuit over aims AND weights.  fac: [{w, ku, kv}] where w is the MOST the facet can
   * deliver (its captured flux, in paint units).  fidelity() fits its own exposure, so only the SHAPE
   * matters: for a box kernel normalised to sum 1, the least-squares coefficient is exactly
   * corrBox(res) at the chosen centre, so each facet is asked for min(what fits best, what it can give)
   * and then physically shrunk to that.  Returns aims [{i,j,w}] (w = 0 ⇒ the facet is not needed). */
  function allocateAims(paint, R, fac, order, wCap, sweeps) {
    const res = Float64Array.from(paint), aims = new Array(fac.length);
    const cap = wCap === undefined ? 1 : wCap;
    for (const f of order) {
      const { w, ku, kv } = fac[f];
      const C = corrBox(res, R, ku, kv);
      let bi = -1, bv = -Infinity;
      for (let k = 0; k < C.length; k++) if (C[k] > bv) { bv = C[k]; bi = k; }
      if (bi < 0) bi = (R * R / 2) | 0;
      const wUse = Math.max(0, Math.min(w * cap, bv));
      aims[f] = { i: bi % R, j: (bi / R) | 0, w: wUse, wMax: w };
      if (wUse > 0) stamp(res, R, bi % R, (bi / R) | 0, ku, kv, wUse, -1);
    }
    // back-fitting sweeps: re-optimise each atom's centre and weight with all the others held fixed.
    // Greedy placement is order-dependent; two or three sweeps recover most of what that costs.
    for (let sw = 0; sw < (sweeps === undefined ? 3 : sweeps); sw++) {
      let moved = 0;
      for (const f of order) {
        const { ku, kv } = fac[f], a = aims[f];
        if (a.w > 0) stamp(res, R, a.i, a.j, ku, kv, a.w, +1);      // lift this atom out
        const C = corrBox(res, R, ku, kv);
        let bi = -1, bv = -Infinity;
        for (let k = 0; k < C.length; k++) if (C[k] > bv) { bv = C[k]; bi = k; }
        const wUse = Math.max(0, Math.min(fac[f].w * cap, bv));
        const ni = bi % R, nj = (bi / R) | 0;
        if (ni !== a.i || nj !== a.j || wUse !== a.w) moved++;
        a.i = ni; a.j = nj; a.w = wUse;
        if (wUse > 0) stamp(res, R, ni, nj, ku, kv, wUse, -1);
      }
      if (!moved) break;
    }
    return aims;
  }
  // the predicted delivered grid
  function predictGrid(R, fac, aims) {
    const G = new Float64Array(R * R);
    for (let f = 0; f < fac.length; f++) stamp(G, R, aims[f].i, aims[f].j, fac[f].ku, fac[f].kv, aims[f].w === undefined ? fac[f].w : aims[f].w, 1);
    return G;
  }


  // ---- occlusion: a facet is useless if another facet sits in its beam, and it is harmful if it sits
  // in someone else's.  Test segment-vs-quad and greedily keep a mutually non-occluding set.
  function hitsQuad(O, D, tMax, f, pad, padK) {
    padK = padK || 0;
    const den = D[0] * f.n[0] + D[1] * f.n[1] + D[2] * f.n[2];
    if (Math.abs(den) < 1e-9) return false;
    const t = ((f.P[0] - O[0]) * f.n[0] + (f.P[1] - O[1]) * f.n[1] + (f.P[2] - O[2]) * f.n[2]) / den;
    if (!(t > 0.8 && t < tMax - 0.8)) return false;
    const hx = O[0] + D[0] * t - f.P[0], hy = O[1] + D[1] * t - f.P[1], hz = O[2] + D[2] * t - f.P[2];
    const u = hx * f.ex[0] + hy * f.ex[1] + hz * f.ex[2];
    const v = hx * f.ey[0] + hy * f.ey[1] + hz * f.ey[2];
    const hxx = (f.hx === undefined ? f.half : f.hx) + pad + padK * f.half, hyy = (f.hy === undefined ? f.half : f.hy) + pad + padK * f.half;
    return u > -hxx && u < hxx && v > -hyy && v < hyy;
  }
  function occlusionGreedy(cands, N, L, Z, pad, padK) {
    padK = padK === undefined ? 0 : padK;
    const order = cands.slice().sort((a, b) => b.flux - a.flux);
    const kept = [];
    for (const c of order) {
      if (kept.length >= N) break;
      const D = [Z[0] - c.P[0], Z[1] - c.P[1], Z[2] - c.P[2]];
      const tMax = Math.sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
      const Dn = [D[0] / tMax, D[1] / tMax, D[2] / tMax];
      const Dl = [c.P[0] - L[0], c.P[1] - L[1], c.P[2] - L[2]];
      const rl = Math.sqrt(Dl[0] * Dl[0] + Dl[1] * Dl[1] + Dl[2] * Dl[2]);
      const Dln = [Dl[0] / rl, Dl[1] / rl, Dl[2] / rl];
      let bad = false;
      for (const k of kept) {
        if (hitsQuad(c.P, Dn, tMax, k, pad, padK) || hitsQuad(k.P, k.Dn, k.tMax, c, pad, padK) ||
            hitsQuad(L, Dln, rl, k, pad, padK) || hitsQuad(L, k.Dln, k.rl, c, pad, padK)) { bad = true; break; }
      }
      if (bad) continue;
      c.Dn = Dn; c.tMax = tMax; c.Dln = Dln; c.rl = rl;
      kept.push(c);
    }
    for (const k of kept) { delete k.Dn; delete k.tMax; delete k.Dln; delete k.rl; }
    return kept;
  }

  // ---------------------------------------------------------------- shell geometry
  // A facet's flux is  rho*I(theta)*dOmega  — it depends only on the SOLID ANGLE the facet subtends at
  // the LED, not on how far away it is.  Its image size is ledSize*q/r — sharper the farther it is.
  // So: tile the LED's emitting hemisphere with equal-solid-angle cells and push every facet as far
  // out as the envelope allows.  No two facets share a ray (distinct cells) so nothing self-shadows.
  function envExit(L, u, env, lo, hi) {
    if (RF.Geo.envInside(env, add(L, mul(u, hi)), 0)) return hi;
    if (!RF.Geo.envInside(env, add(L, mul(u, lo)), 0)) return 0;
    for (let k = 0; k < 26; k++) { const m = 0.5 * (lo + hi); if (RF.Geo.envInside(env, add(L, mul(u, m)), 0)) lo = m; else hi = m; }
    return lo;
  }

  // ---------------------------------------------------------------- scene geometry

  // Compile-and-check loop: every outline point of every facet must be inside the envelope.
  function fitEnvelope(surfaces, env, intent) {
    const tol = 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
    const bad = new Set();
    for (let pass = 0; pass < 6; pass++) {
      let G;
      const list = surfaces.filter((s) => !bad.has(s.id));
      try { G = RF.Geo.compile(list); } catch (e) { return 0; }
      const idx = new Map(); list.forEach((s, i) => idx.set(s.id, i));
      const offenders = [];
      for (const s of list) {
        const k = idx.get(s.id); let out = false;
        for (const poly of RF.Geo.outline(G, k)) for (const p of poly) if (!RF.Geo.envInside(env, p, tol)) { out = true; break; }
        if (out) offenders.push(s);
      }
      if (!offenders.length) { surfaces.length = 0; for (const s of list) surfaces.push(s); return list.length; }
      for (const s of offenders) {
        s.clip.hx *= 0.75; s.clip.hy *= 0.75;
        if (s.clip.hx < 0.2) { bad.add(s.id); if (intent) { const i = intent.findIndex((q) => q.facet === s.id); if (i >= 0) intent.splice(i, 1); } }
      }
    }
    const list = surfaces.filter((s) => !bad.has(s.id));
    surfaces.length = 0; for (const s of list) surfaces.push(s);
    return list.length;
  }
  function solve(input, settings, tools) {
    const t0 = Date.now();
    const env = input.envelope, src = input.source, L = src.pos.slice();
    const SF = RF.Source.frame(src), ax = SF.a;
    const T = RF.Engine.targetFrame(input.target);
    const Rp = input.paint.res | 0, paint = input.paint.cells;
    // Aims land on integer cells of the prediction grid, and a box atom 2 cells wide cannot make a
    // smooth layer on that lattice.  Run the fit on a supersampled grid so the aims get sub-cell
    // placement, then average back down for the fidelity call (which works at the paint's own res).
    const ssg = new Map();
    function gridFor(ss) {                       // supersampled paint grid + its downsampler
      if (ssg.has(ss)) return ssg.get(ss);
      const Rs = Rp * ss;
      let paintS = paint;
      if (ss > 1) {
        paintS = new Float64Array(Rs * Rs);
        for (let j = 0; j < Rp; j++) for (let i = 0; i < Rp; i++) {
          const v = paint[j * Rp + i] / (ss * ss); if (!v) continue;
          for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) paintS[(j * ss + b) * Rs + i * ss + a] = v;
        }
      }
      const down = (Gs) => {
        if (ss === 1) return Gs;
        const G = new Float64Array(Rp * Rp);
        for (let j = 0; j < Rp; j++) for (let i = 0; i < Rp; i++) {
          let t = 0; for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) t += Gs[(j * ss + b) * Rs + i * ss + a];
          G[j * Rp + i] = t / (ss * ss);
        }
        return G;
      };
      const g = { ss, Rs, paintS, down, cellS: cell / ss };
      ssg.set(ss, g); return g;
    }
    const SSmax = Math.max(1, Math.min(6, Math.round(+settings.superMax || 3)));
    const SSf = Math.max(1, Math.min(SSmax, Math.round(+settings.super || 3)));
    const SSs = Math.max(1, Math.min(SSmax, Math.round(+settings.superSearch || 1)));
    const N = Math.max(1, input.limits.maxFacets | 0), rho = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const cell = 2 * T.half / Rp;                       // mm per paint cell
    const notes = [];

    // LED "size" that sets the image scale (the smaller side, as in the scorer's kernel)
    const ledSize = (src.kind === 'planar')
      ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w || 1, src.h || 1))
      : (src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius);
    // LED half-extent vectors (world) for the image shape
    const e1 = SF.u, e2 = SF.v;
    const hw = (src.shape === 'rect' ? (src.w || 1) : 2 * (src.radius || 0.5)) / 2;
    const hh = (src.shape === 'rect' ? (src.h || 1) : 2 * (src.radius || 0.5)) / 2;

    // throw direction (LED → target centre) and the fold plane's normal
    const thr = nrm(sub(T.C, L));
    let mdir = ax.slice();                              // direction from the LED to the mirror
    if (len(sub(thr, mdir)) < 0.25) {                   // LED already points at the target: fold sideways
      const b = V.basis(thr); mdir = nrm(add(mul(thr, 0.35), b[0]));
    }
    const nrm0 = nrm(sub(thr, mdir));                   // facet normal ≈ bisector(−mdir, thr)
    // in-plane axes: ex ≈ the target's "up" projected into the plane, ey = n × ex
    const ex = V.inPlane(nrm0, T.tv), ey = V.cross(nrm0, ex);

    // ---- candidate sampling of the plane: P = Q + p·ex + q·ey, Q = L − d·n
    const envR = Math.max(env.half[0], env.half[1], env.half[2]);
    const span = 2 * (envR + len(sub(env.center, L)));   // generous in-plane extent
    const fine = Math.max(0.5, span / 160);              // fine sampling step for area estimates

    // analytic flux (lm) of a facet of area A at P with normal n
    const cdPerSr = src.power / RF.Source.totalIntegral(src);
    function fluxAt(P, n, A) {
      const d = sub(P, L), r2 = dot(d, d); if (!(r2 > 1e-9)) return 0;
      const r = Math.sqrt(r2), dh = [d[0] / r, d[1] / r, d[2] / r];
      const ct = dot(dh, ax); if (ct <= 0) return 0;
      const I = cdPerSr * RF.Source.intensity(src, Math.acos(clamp(ct, -1, 1)));
      const cm = Math.max(0, -dot(n, dh));               // facet normal faces the LED
      return rho * I * A * cm / r2;
    }
    // LED image size on the target (cells) for a facet at P aiming at Z
    function imageSize(P, Z) {
      const sv = sub(P, L), r = len(sv); if (!(r > 1e-6)) return [1, 1];
      const q = len(sub(Z, P)), m = q / r;
      const ah = nrm(sub(Z, P));
      const n = nrm(add(mul(sv, -1 / r), ah));           // facet normal (bisector)
      const refl = (v) => sub(v, mul(n, 2 * dot(v, n)));  // mirror image of a vector
      // map the LED's two half-extent vectors, project onto the target plane (u,v)
      let mu = 0, mv = 0;
      for (const [vec, half] of [[e1, hw], [e2, hh]]) {
        const d = mul(refl(vec), m * half);               // image half-extent (world, at the image plane)
        mu = Math.max(mu, Math.abs(dot(d, T.tu)) + Math.abs(dot(d, T.n)) * 0);
        mv = Math.max(mv, Math.abs(dot(d, T.tv)));
      }
      return [Math.max(0.6, 2 * mu / cell), Math.max(0.6, 2 * mv / cell)];
    }

    // ---- evaluate one design (plane offset d, minimum facet distance rMin)
    function buildDesign(d, rMin, nWant, opts) {
      const Q = sub(L, mul(nrm0, d));
      const margin0 = opts.margin === undefined ? 0.35 : opts.margin;   // mm inside the envelope
      const envMin = Math.min(...env.half) || 1, mTol = -margin0 / envMin;
      // sample the plane on a fine grid, keep the points that are inside the envelope with a margin
      const pts = [];
      const nf = Math.ceil(span / fine);
      for (let a = -nf; a <= nf; a++) for (let b = -nf; b <= nf; b++) {
        const P = add(Q, add(mul(ex, a * fine), mul(ey, b * fine)));
        if (!RF.Geo.envInside(env, P, mTol)) continue;
        const r = V.dist(P, L); if (r < rMin) continue;
        const dh = nrm(sub(P, L)); if (dot(dh, ax) <= 0.05) continue;      // LED emits forward only
        pts.push({ P, r, a: a * fine, b: b * fine });
      }
      if (!pts.length) return null;
      const areaGood = pts.length * fine * fine;
      let s = Math.max(fine, Math.sqrt(areaGood / Math.max(1, nWant)));   // tile size for nWant facets
      // Tile the plane on a grid of step s.  A facet is TILTED (its normal is the bisector of the
      // LED and aim directions), so a facet of area s² would overlap its neighbours as seen from the
      // LED: two facets cannot share one ray.  Size each facet by the solid angle its tile really
      // subtends:  A_f·cosθ_facet = fill²·s²·cosθ_plane  ⇒  A_f = fill²·s²·(n0·d̂)/(n·d̂).
      const fill = opts.fill === undefined ? 0.94 : opts.fill;
      let tiles = tilePlane(s);
      // Facets whose outline would leave the envelope are dropped, so a grid sized for nWant tiles
      // usually yields fewer.  Shrink the step until the budget is actually used: same covered area,
      // more (smaller) facets to paint with.
      for (let it = 0; it < 4 && tiles.length < nWant; it++) {
        const f = Math.sqrt(tiles.length / nWant) * 0.94;
        const s2 = Math.max(fine, s * f); if (s2 >= s * 0.995) break;
        const t2 = tilePlane(s2); if (t2.length <= tiles.length) break;
        s = s2; tiles = t2;
      }
      function tilePlane(s) {
      const nb = Math.ceil(span / s) + 1, tiles = [];
      for (let a = -nb; a <= nb; a++) for (let b = -nb; b <= nb; b++) {
        const P = add(Q, add(mul(ex, (a + 0.5) * s), mul(ey, (b + 0.5) * s)));
        const r = V.dist(P, L);
        if (r < rMin) continue;
        const dh = nrm(sub(P, L)); const ct = dot(dh, ax); if (ct <= 0.05) continue;
        const cosView = Math.max(0, -dot(nrm0, dh));                 // plane foreshortening = d/r
        if (cosView < 0.02) continue;
        // facet normal for an aim at the target centre
        const Z0 = T.C, ah = nrm(sub(Z0, P)), n = nrm(add(mul(dh, -1), ah));
        const cm = Math.max(0.05, -dot(n, dh));
        const A = fill * fill * s * s * cosView / cm;
        const half = Math.sqrt(A) / 2;
        if (!(half > 0.15)) continue;
        let ok = true;
        for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
          const C = add(P, add(mul(ex, sa * half), mul(ey, sb * half)));
          if (!RF.Geo.envInside(env, C, mTol)) { ok = false; break; }
        }
        if (!ok) continue;
        if (r < keep + half + 0.3) continue;
        const fl = fluxAt(P, n, A);
        const [ku, kv] = imageSize(P, Z0);
        tiles.push({ P, r, n, A, half, flux: fl, ku, kv, ct, ex, ey });
      }
      return tiles;
      }
      if (!tiles.length) return null;
      tiles.sort((p, q) => q.flux - p.flux);
      const fac = occlusionGreedy(tiles, nWant, L, T.C, 0.6, 0);
      return { d, rMin, s, half: 0, fac, area: areaGood };
    }

    // ---- predicted fidelity of a design (analytic, no rays)
    function predicted(design, sweeps, ssWant) {
      // Sub-cell aims only matter when the blobs are a few cells wide; a 20-cell blob is already
      // smooth, and supersampling it just costs time (the fit is O((ss*R)^2) per atom per sweep).
      const mk = design.fac.reduce((a, f) => a + f.ku, 0) / Math.max(1, design.fac.length);
      const ss = Math.max(1, Math.min(ssWant || 1, mk < 4 ? SSmax : mk < 8 ? Math.min(2, SSmax) : 1));
      const gg = gridFor(ss), Rs = gg.Rs, paintS = gg.paintS, downsample = gg.down, cellS = gg.cellS;
      const fac = design.fac;
      const wsum = fac.reduce((a, f) => a + f.flux, 0) || 1;
      const tot = paint.reduce((a, b) => a + b, 0) || 1;
      // an ellipsoidal facet images the LED, but an extended source at a small r is aberrated: the real
      // blob is a little wider than the paraxial image.  Inflate the predicted kernel to match.
      const bk = +settings.blurK > 0 ? +settings.blurK : 1;
      // aberration adds a fixed ANGLE, so a fixed size on the target (mm), not a fixed number of cells
      const ba = (+settings.blurAdd || 0) + (+settings.blurMm || 0) / cell;
      const items = fac.map((f) => ({ w: f.flux / wsum * tot, ku: (f.ku * bk + ba) * gg.ss, kv: (f.kv * bk + ba) * gg.ss }));
      const order = items.map((_, i) => i).sort((a, b) => items[b].w - items[a].w);
      const aims = allocateAims(paintS, Rs, items, order, 1, sweeps);
      const G = downsample(predictGrid(Rs, items, aims));
      let fid = null;
      try {
        const sc = { modeA: { paint }, target: input.target, source: src, envelope: env };
        const P = { res: Rp, power: src.power, T };
        const ctx = { gridD: G, gridR: new Float64Array(Rp * Rp), N: 1e6, next: 1e6, E: { emitted: 1, direct: 0, reflected: 1 } };
        fid = RF.Photometry.fidelity(sc, P, ctx);
      } catch (e) { fid = null; }
      // Coma: each facet is an off-axis patch of the ellipsoid through (LED, aim, P).  The further the
      // aim sits from the target centre the more the real image smears, and the box-kernel model cannot
      // see it.  Re-score the same allocation with a smear proportional to that off-axis angle.
      const comaK = +settings.comaK || 0;
      if (comaK > 0 && fid) {
        const it2 = fac.map((f, k) => {
          const a = aims[k] || { i: 0, j: 0 };
          const cu = -T.half + (a.i + 0.5) * cellS, cv = -T.half + (a.j + 0.5) * cellS;
          const Z = add(T.C, add(mul(T.tu, cu), mul(T.tv, cv)));
          const v1 = sub(Z, f.P), v2 = sub(T.C, f.P);
          const l1 = len(v1) || 1, l2 = len(v2) || 1;
          const cs = Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)));
          const extra = comaK * l1 * Math.sqrt(1 - cs * cs) * (f.half / Math.max(1e-6, f.r)) / cellS;
          return { w: a.w === undefined ? items[k].w : a.w, ku: items[k].ku + extra, kv: items[k].kv + extra };
        });
        try {
          const G2 = downsample(predictGrid(Rs, it2, aims));
          const sc = { modeA: { paint }, target: input.target, source: src, envelope: env };
          const P = { res: Rp, power: src.power, T };
          const ctx = { gridD: G2, gridR: new Float64Array(Rp * Rp), N: 1e6, next: 1e6, E: { emitted: 1, direct: 0, reflected: 1 } };
          const f2 = RF.Photometry.fidelity(sc, P, ctx);
          if (f2 && f2.fidelity < fid.fidelity) fid = f2;
        } catch (e) { /* keep the un-smeared score */ }
      }
      if (typeof globalThis !== 'undefined') (globalThis.__preds = globalThis.__preds || []).push({ G: G.slice(), items, aims, fid, R: Rp, d: design.d, rMin: design.rMin, flux: wsum });
      const nCap = aims.reduce((k, a) => k + (a.w > 0 && a.wMax > 0 && a.w >= 0.999 * a.wMax ? 1 : 0), 0);
      const nZero = aims.reduce((k, a) => k + (a.w > 0 ? 0 : 1), 0);
      return { items, aims, fid, flux: wsum, nCap, nZero, Rs, ss: gg.ss };
    }

      function shellDesign(N, opts) {
      const cmMin = +settings.cmMin > 0 ? +settings.cmMin : 0.08;
      const mTol = 0.02, sh1 = V.basis(ax)[0], sh2 = V.cross(ax, sh1);
      const fill = opts.fill === undefined ? 0.94 : opts.fill;
      const cMin = opts.cMin === undefined ? 0.02 : opts.cMin;
      const dens = opts.dens || 2.5;                       // candidate cells per facet of budget
      const nC = Math.max(3, Math.round(Math.sqrt(N * dens * 0.6))), nP = Math.max(4, Math.round(N * dens / nC));
      const dp = 2 * Math.PI / nP;
      // A lambertian LED puts rho*I0*cos(theta)*dOmega into a cell, and dOmega = d(cos theta)*dphi, so a
      // grid uniform in cos theta gives facets whose flux falls 50:1 from the pole to the rim.  The
      // matching pursuit can only scale an atom DOWN, so low-flux facets cannot paint bright cells.
      // Equalising the flux means equal steps in cos^2(theta).
      const eqF = settings.eqFlux === 0 ? 0 : 1;
      const dcU = (1 - cMin) / nC, u2 = (1 - cMin * cMin) / nC;
      const rBig = 4 * Math.max(env.half[0], env.half[1], env.half[2]);
      const Z0 = T.C, cand = [];
      const rScales = (opts.rScales || [0.97, 0.86, 0.74, 0.6, 0.45]).slice(0, opts.nRS || (+settings.nRS > 0 ? +settings.nRS : 5));
      for (let a = 0; a < nC; a++) {
        const c = eqF ? Math.sqrt(Math.max(0, 1 - (a + 0.5) * u2)) : 1 - (a + 0.5) * dcU;
        const dc = eqF ? (Math.sqrt(Math.max(0, 1 - a * u2)) - Math.sqrt(Math.max(0, 1 - (a + 1) * u2))) : dcU;
        const dOm = dc * dp;
        const st = Math.sqrt(Math.max(0, 1 - c * c));
        for (let b = 0; b < nP; b++) {
          const ph = (b + 0.5) * dp;
          const u = add(mul(ax, c), add(mul(sh1, st * Math.cos(ph)), mul(sh2, st * Math.sin(ph))));
          const rOut = envExit(L, u, env, keep + 0.6, rBig);
          if (rOut <= keep + 1.5) continue;
          // facet frame directions (independent of r)
          const w = add(mul(sh1, Math.cos(ph)), mul(sh2, Math.sin(ph)));
          const et = nrm(add(mul(ax, -st), mul(w, c)));
          const ep = nrm(V.cross(ax, u));
          const dTh = dc / Math.max(1e-3, st);             // cell side in theta
          for (const rs of rScales) {
            const r = Math.max(keep + 0.8, rs * rOut);
            const P = add(L, mul(u, r));
            const ah = nrm(sub(Z0, P)), n = nrm(sub(ah, u));
            const cm = -dot(n, u); if (!(cm > cmMin)) continue;   // fold angle <= 2*acos(cmMin)
            // The cell is a rectangle on the sphere (r·dtheta along e_theta, r·sintheta·dphi along
            // e_phi).  The facet that intercepts exactly that cone is the rectangle whose sides are
            // those lengths divided by how much each direction is foreshortened into the facet plane.
            let pth = sub(et, mul(n, dot(et, n))), pph = sub(ep, mul(n, dot(ep, n)));
            const lth = len(pth), lph = len(pph);
            if (!(lth > 0.05) || !(lph > 0.05)) continue;
            const ex = mul(pth, 1 / lth), ey = V.cross(n, ex);
            const hx = fill * r * dTh / (2 * lth), hy = fill * r * st * dp / (2 * lph);
            if (!(hx > 0.12) || !(hy > 0.12)) continue;
            const half = Math.max(hx, hy);
            if (r < keep + half + 0.3) continue;
            let ok = true;
            for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
              const C = add(P, add(mul(ex, sa * hx), mul(ey, sb * hy)));
              if (!RF.Geo.envInside(env, C, mTol)) { ok = false; break; }
            }
            if (!ok) continue;                             // a smaller r (smaller facet) may still fit
            const A = 4 * hx * hy, q = V.dist(P, Z0);
            const flux = rho * src.power * c / Math.PI * A * cm / (r * r);
            const [ku, kv] = imageSize(P, Z0);
            cand.push({ P, r, n, A, half, hx, hy, ex, ey, flux, ku, kv, ct: c, q });
          }
        }
      }
      const fac = occlusionGreedy(cand, N, L, Z0, +(opts.pad === undefined ? 0.6 : opts.pad), +(opts.padK === undefined ? 0 : opts.padK));
      return { kind: 'shell', fac, dOm: dp, n: fac.length };
    }

    // ---- search: plane offset × minimum facet distance
    const dCands = [], rCands = [];
    const dMax = Math.max(4, 2 * envR);
    const nD = clamp(+settings.planeScan | 0 || 5, 1, 15);
    for (let i = 0; i < nD; i++) dCands.push(dMax * (0.12 + 0.86 * i / Math.max(1, nD - 1)));
    const rLo = Math.max(keep + 1, ledSize * 4), rHi = Math.max(rLo * 1.2, 2.6 * envR);
    const nR = clamp(+settings.distScan | 0 || 3, 1, 12);
    for (let i = 0; i < nR; i++) rCands.push(rLo * Math.pow(rHi / rLo, i / Math.max(1, nR - 1)));

    if (+settings.forceD > 0) { dCands.length = 0; dCands.push(+settings.forceD); }
    if (+settings.forceR > 0) { rCands.length = 0; rCands.push(+settings.forceR); }
    const geom = String(settings.geom || 'auto');
    const jobs = [];
    if (geom !== 'shell') for (const d of dCands) for (const rMin of rCands) jobs.push({ tag: 'plane d=' + d.toFixed(1) + ' rMin=' + rMin.toFixed(1), mk: () => buildDesign(d, rMin, N, {}) });
    if (geom !== 'plane') {
      const densList = +settings.dens > 0 ? [+settings.dens] : [1.6, 2.5];
      const padList = +settings.pad > 0 ? [+settings.pad] : [0.6];
      for (const dens of densList) for (const pad of padList) for (const nrs of (+settings.nRS > 0 ? [+settings.nRS] : [5, 2])) jobs.push({ tag: 'shell dens=' + dens + ' pad=' + pad + ' nRS=' + nrs, mk: () => shellDesign(N, { dens, pad, padK: +settings.padK || 0, nRS: nrs }) });
    }

    let best = null;
    const pool = [], seen = new Set();
    for (const job of jobs) {
      let design = null;
      try { design = job.mk(); } catch (e) { if (globalThis.__cand) globalThis.__cand.push({ tag: 'ERR ' + job.tag + ' ' + e.message, n: 0, F: 0, flux: 0, obj: -1 }); }
      if (!design || design.fac.length < Math.max(4, 0.5 * N)) continue;
      // several (d, rMin) pairs collapse to the same facet set; fitting it twice is pure waste
      const fp = design.fac.length + '|' + design.fac.reduce((a, f) => a + Math.round(f.P[0] * 8) * 31 + Math.round(f.P[1] * 8) * 7 + Math.round(f.P[2] * 8), 0);
      if (seen.has(fp)) continue; seen.add(fp);
      const pr = predicted(design, +settings.searchSweeps >= 0 ? +settings.searchSweeps : 1, SSs);
      if (!pr.fid) continue;
      const F = pr.fid.fidelity, flux = pr.flux;
      // objective: fidelity first, flux as a tie-breaker (log-scaled, saturating)
      // the box-kernel model cannot see that more, smaller facets give the fit finer aim granularity,
      // so designs that leave budget unused are quietly over-rated: nudge the objective by usage.
      const obj = F + (+settings.fluxWeight || 0.25) * Math.log(1 + flux / (src.power * 0.05)) / Math.log(1 + 1 / 0.05)
        + (+settings.useWeight === 0 ? 0 : (+settings.useWeight || 0.05)) * (design.fac.length / N);
      if (globalThis.__cand) globalThis.__cand.push({ tag: job.tag, n: design.fac.length, F, flux, obj, wi: pr.fid.within, ga: pr.fid.gapsDark, fc: pr.fid.farCredit, fg: pr.fid.farGlare, sp: pr.fid.spill });
      pool.push({ obj, design, pr, F, flux, tag: job.tag });
      if (!best || obj > best.obj) best = pool[pool.length - 1];
      if (Date.now() - t0 > 0.75 * (+settings.timeBudgetMs || 20000)) break;
    }
    if (!best) {
      // fallback: whatever fits
      for (const d of dCands) { const design = buildDesign(d, keep + 1, N, {}); if (design && design.fac.length) { best = { design, pr: predicted(design, 3, SSf), F: 0, flux: 0, tag: 'plane fallback' }; break; } }
    }
    if (!best) return { surfaces: [], intent: [], notes: ['no facet position found inside the envelope'] };

    // ---- emit surfaces
    // the search ranks with a cheap fit; re-rank the top few with the full back-fitting fit
    pool.sort((a, b) => b.obj - a.obj);
    let reBest = null;
    for (const c of pool.slice(0, 3)) {
      const pr2 = predicted(c.design, +settings.finalSweeps > 0 ? +settings.finalSweeps : 3, SSs);
      if (!pr2 || !pr2.fid) continue;
      const F2 = pr2.fid.fidelity;
      const obj2 = F2 + (+settings.fluxWeight || 0.25) * Math.log(1 + pr2.flux / (src.power * 0.05)) / Math.log(1 + 1 / 0.05)
        + (+settings.useWeight === 0 ? 0 : (+settings.useWeight || 0.05)) * (c.design.fac.length / N);
      if (!reBest || obj2 > reBest.obj) reBest = { obj: obj2, design: c.design, pr: pr2, F: F2, flux: pr2.flux, tag: c.tag };
    }
    if (reBest) best = reBest;
    if (globalThis.__cand && reBest) globalThis.__cand.push({ tag: '* ' + reBest.tag, n: reBest.design.fac.length, F: reBest.F, flux: reBest.flux, obj: reBest.obj });
    const design = best.design;
    const pr = predicted(design, +settings.finalSweeps > 0 ? +settings.finalSweeps : 3, SSf);
    const surfaces = [], intent = [];
    const exr = ex, eyr = ey;
    const cellE = pr.Rs ? cell * Rp / pr.Rs : cell;   // aim grid may be supersampled
    // aimBlend pulls every aim toward the brightest painted cell: fidelity falls, peak cd and throw
    // rise.  It is the tuner's lever for the throw goal — the static (fidelity-first) solver leaves it 0.
    const bl = Math.max(0, Math.min(1, +settings.aimBlend || 0));
    let cuP = 0, cvP = 0;
    if (bl > 0) {
      let bi = 0, bv = -1;
      for (let k = 0; k < paint.length; k++) if (paint[k] > bv) { bv = paint[k]; bi = k; }
      cuP = -T.half + ((bi % Rp) + 0.5) * cell; cvP = -T.half + (((bi / Rp) | 0) + 0.5) * cell;
    }
    let nDrop = 0;
    for (let k = 0; k < design.fac.length; k++) {
      const f = design.fac[k], aim = pr.aims[k], it = pr.items[k];
      // the pursuit asked this facet for aim.w of the paint's light; it can deliver it.w.  Flux is
      // proportional to area, so shrink the patch to sqrt(aim.w/it.w) — a facet that is not needed
      // (aim.w ~ 0) is left out entirely rather than parked somewhere it would only add spill.
      const frac = it.w > 0 ? aim.w / it.w : 0;
      if (!(frac > 0.02)) { nDrop++; continue; }
      const hf = f.half * Math.sqrt(Math.min(1, frac));
      let cu = -T.half + (aim.i + 0.5) * cellE, cv = -T.half + (aim.j + 0.5) * cellE;
      if (bl > 0) { cu += (cuP - cu) * bl; cv += (cvP - cv) * bl; }
      const Z = add(T.C, add(mul(T.tu, cu), mul(T.tv, cv)));
      const di = len(sub(Z, f.P));
      const id = 'F' + k;
      surfaces.push({
        type: 'facet', id, group: 'A', P: f.P, S0: L.slice(), Z, di, flat: false,
        clip: { kind: 'rect', hx: hf * ((f.hx || f.half) / f.half), hy: hf * ((f.hy || f.half) / f.half), ref: f.ex || exr },
        optics: { interaction: 'reflect', reflectivity: rho, twoSided: false },
      });
      // the intent must name the cell the facet is actually aimed at (aims live on the fit grid, and
      // aimBlend may have moved the aim), so convert back through the target coordinates
      const ai = Math.max(0, Math.min(Rp - 1, Math.floor((cu + T.half) / cell)));
      const aj = Math.max(0, Math.min(Rp - 1, Math.floor((cv + T.half) / cell)));
      intent.push({ facet: id, cells: [[aj * Rp + ai, aim.w]] });
    }
    if (nDrop) notes.push(nDrop + ' facets not needed by the fit and left out');
    // ---- hard-constraint safety net: the real outline (curved surface, subdivided edges) must stay
    // inside the envelope.  Shrink a facet that pokes out; drop it if shrinking cannot save it.
    const kept = fitEnvelope(surfaces, env, intent);
    if (kept < surfaces.length) notes.push('shrunk/dropped ' + (surfaces.length - kept) + ' facets to stay inside the envelope');

    notes.push('geometry: ' + best.tag + (design.s ? ', tile ' + design.s.toFixed(1) + ' mm' : '') + ', facet ' +
      (2 * design.fac.reduce((a, f) => a + f.half, 0) / design.fac.length).toFixed(1) + ' mm mean');
    notes.push('predicted fidelity ' + (pr.fid ? (100 * pr.fid.fidelity).toFixed(1) + '% (within ' + (100 * pr.fid.within).toFixed(1) + '%, gaps ' + (100 * pr.fid.gapsDark).toFixed(1) + '%)' : 'n/a') +
      ', predicted captured flux ' + best.flux.toFixed(0) + ' lm (' + (100 * best.flux / src.power).toFixed(1) + '% of the LED)' +
      (pr.nCap === undefined ? '' : ', weight-capped ' + pr.nCap + ', unused ' + pr.nZero));
    notes.push(surfaces.length + ' facets, image ' + (design.fac.reduce((a, f) => a + f.ku, 0) / design.fac.length).toFixed(1) + '×' +
      (design.fac.reduce((a, f) => a + f.kv, 0) / design.fac.length).toFixed(1) + ' cells mean, r ' +
      Math.min(...design.fac.map((f) => f.r)).toFixed(0) + '–' + Math.max(...design.fac.map((f) => f.r)).toFixed(0) + ' mm');
    return { surfaces, intent, notes };
  }

  const STATIC_SETTINGS = [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'planeScan', label: 'Plane-offset candidates', type: 'range', min: 1, max: 15, step: 1, default: 5 },
      { key: 'distScan', label: 'Distance candidates', type: 'range', min: 1, max: 12, step: 1, default: 3 },
      { key: 'fluxWeight', label: 'Flux weight in the search', type: 'range', min: 0, max: 1, step: 0.05, default: 0.25 },
      { key: 'forceD', label: 'Force plane offset (0=auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'forceR', label: 'Force min facet distance (0=auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'geom', label: 'Geometry', type: 'select', options: ['auto', 'plane', 'shell'], default: 'auto' },
      { key: 'dens', label: 'Shell candidate density (0=auto)', type: 'number', min: 0, step: 0.1, default: 0 },
      { key: 'pad', label: 'Occlusion clearance (mm, 0=auto)', type: 'number', min: 0, step: 0.1, default: 0 },
      { key: 'cmMin', label: 'Min cos(half fold angle)', type: 'number', min: 0.05, step: 0.05, default: 0.08 },
      { key: 'blurK', label: 'Predicted kernel inflation ×', type: 'number', min: 0.5, step: 0.05, default: 1 },
      { key: 'nRS', label: 'Shell radii tried per cell', type: 'range', min: 1, max: 5, step: 1, default: 5 },
      { key: 'superMax', label: 'Aim-grid supersampling cap', type: 'range', min: 1, max: 6, step: 1, default: 3 },
      { key: 'super', label: 'Aim-grid supersampling (final fit)', type: 'range', min: 1, max: 6, step: 1, default: 3 },
      { key: 'superSearch', label: 'Aim-grid supersampling (while searching)', type: 'range', min: 1, max: 6, step: 1, default: 1 },
      { key: 'eqFlux', label: 'Equal-flux shell bands (cos^2 theta)', type: 'range', min: 0, max: 1, step: 1, default: 0 },
      { key: 'comaK', label: 'Off-axis aim smear (coma) coefficient', type: 'number', min: 0, step: 0.01, default: 0.5 },
      { key: 'blurMm', label: 'Predicted kernel inflation +mm on target', type: 'number', min: 0, step: 0.5, default: 2.5 },
      { key: 'blurAdd', label: 'Predicted kernel inflation +cells', type: 'number', min: 0, step: 0.1, default: 0 },
      { key: 'useWeight', label: 'Budget-usage nudge', type: 'number', min: 0, step: 0.01, default: 0.05 },
      { key: 'finalSweeps', label: 'Back-fitting sweeps on the chosen design', type: 'range', min: 1, max: 12, step: 1, default: 3 },
      { key: 'searchSweeps', label: 'Back-fitting sweeps while searching', type: 'range', min: 0, max: 3, step: 1, default: 1 },
      { key: 'padK', label: 'Occlusion clearance (× facet half-size)', type: 'number', min: 0, step: 0.05, default: 0.15 },
      { key: 'aimBlend', label: 'Pull aims toward the brightest cell (tuner lever)', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
      { key: 'timeBudgetMs', label: 'Search time budget (ms)', type: 'number', min: 100, step: 100, default: 20000 },
  ];

  RF.Solvers.register({

    id: 'bench-qwen38max-r3--foldplane', name: 'Fold plane (static)', version: '0.1', modes: ['paint'],
    settings: STATIC_SETTINGS,
    solve,
  });

  // ------------------------------------------------------------------ tuner (TASK step 3)
  // The static solver picks between candidate settings with an ANALYTIC prediction of the fidelity.
  // The prediction is good (±1-2 points on the scenes measured) but it is a model: it cannot see
  // spill, blocking or the real blob shape.  This second registration makes the same choices by
  // TRACING each candidate with the app's own scorer instead.  Same seed for every candidate, so
  // the differences are geometry, not dice.  It changes no setting of the static solver — it only
  // decides which of them to hand over.
  const VARIANTS = {
    // faithful: span the two geometry families, the model's blur/coma assumptions and the fit's effort
    faithful: [{}, { geom: 'shell' }, { blurMm: 4 }, { fluxWeight: 0.6 }, { searchSweeps: 2, finalSweeps: 6 },
      { super: 1 }, { comaK: 0 }, { padK: 0 }],
    // throw = 2*sqrt(peak cd): concentrate everything on the brightest painted cell, then capture hard
    throw: [{ aimBlend: 1, dens: 1.0 }, { aimBlend: 1 }, { aimBlend: 1, fluxWeight: 0.9 }, { aimBlend: 1, padK: 0.45 },
      { aimBlend: 0.6 }, { aimBlend: 0.6, dens: 1.0 }, {}, { dens: 1.0 }],
    // efficient = lumens on target: capture as much of the LED as the envelope allows, block as little
    efficient: [{ dens: 1.0 }, { dens: 0.7 }, { dens: 1.0, padK: 0 }, { padK: 0 }, { fluxWeight: 0.9 },
      { nRS: 2 }, { geom: 'shell', dens: 1.3 }, {}],
  };

  function goalScore(goal, tr) {
    if (!tr) return -Infinity;
    if (goal === 'throw') return isFinite(tr.throwM) ? tr.throwM : 0;
    if (goal === 'efficient') return isFinite(tr.lmOnTarget) ? tr.lmOnTarget : 0;
    return tr.fidelity && isFinite(tr.fidelity.fidelity) ? tr.fidelity.fidelity : 0;
  }
  function goalLabel(goal, v) {
    if (goal === 'throw') return (v / 1000).toFixed(2) + ' km throw';
    if (goal === 'efficient') return v.toFixed(0) + ' lm on target';
    return (100 * v).toFixed(1) + '% fidelity';
  }

  // A cheap trace is a noisy trace, and most of the variants below land on the same geometry anyway.
  // So: screen every distinct candidate at a low ray count (same seed ⇒ paired comparison, the noise
  // is common), then re-trace only the top few properly and decide there.
  function geomHash(surfaces) {
    let h = 2166136261;
    for (const f of surfaces) {
      const c = f.clip || {};
      const v = [f.P[0], f.P[1], f.P[2], f.Z[0], f.Z[1], f.Z[2], c.hx || 0, c.hy || 0];
      for (let i = 0; i < v.length; i++) { h ^= Math.round(v[i] * 4) & 0xffff; h = Math.imul(h, 16777619) >>> 0; }
    }
    return h + ':' + surfaces.length;
  }

  function solveAuto(input, settings, tools) {
    const goal = VARIANTS[settings.goal] ? settings.goal : 'faithful';
    const seed = Math.round(+settings.autoSeed || 90210);
    const raysScreen = Math.max(2000, Math.round(+settings.autoRays || 30000));
    const raysFinal = Math.max(raysScreen, Math.round(+settings.autoRaysFinal || 200000));
    const maxTry = Math.max(1, Math.round(+settings.autoMax || 8));
    const nFinal = Math.max(1, Math.round(+settings.autoFinal || 3));
    const msBudget = (tools && tools.budget && isFinite(tools.budget.ms) && tools.budget.ms > 0) ? tools.budget.ms : 60000;
    const t0 = Date.now(), left = () => msBudget - (Date.now() - t0);
    const log = [], tagOf = (o) => Object.keys(o).length ? Object.keys(o).map((k) => k + '=' + o[k]).join(',') : 'defaults';
    const cands = [], seen = new Set();
    const list = VARIANTS[goal].slice(0, maxTry);

    // ---- stage 1: build + screen
    for (let k = 0; k < list.length; k++) {
      if (k && left() < 0.35 * msBudget) { log.push('... screened ' + k + ' of ' + list.length + ' variants (time budget)'); break; }
      const st = Object.assign({}, settings, list[k]);
      let out;
      try {
        out = solve(input, st, tools);
      } catch (e) { log.push(tagOf(list[k]) + ': solve failed — ' + String(e && e.message || e).slice(0, 50)); continue; }
      if (!out || !out.surfaces || !out.surfaces.length) { log.push(tagOf(list[k]) + ': no surfaces'); continue; }
      const h = geomHash(out.surfaces);
      if (seen.has(h)) { log.push(tagOf(list[k]) + ': same geometry as an earlier variant, skipped'); continue; }
      seen.add(h);
      let sc = -Infinity;
      try {
        const tr = tools.trace(out.surfaces, { rays: raysScreen, seed });
        sc = goalScore(goal, tr);
      } catch (e) { log.push(tagOf(list[k]) + ': trace failed — ' + String(e && e.message || e).slice(0, 50)); continue; }
      cands.push({ tag: tagOf(list[k]), out, sc, base: !Object.keys(list[k]).length });
      log.push(tagOf(list[k]) + ' → ' + goalLabel(goal, sc) + ' @' + (raysScreen / 1000) + 'k rays');
      if (tools && tools.progress) try { tools.progress(0.6 * (k + 1) / list.length); } catch (e) {}
    }
    if (!cands.length) return solve(input, settings, tools);   // tracing unavailable: fall back to static

    // ---- stage 2: re-trace the top few at full ray count and decide there
    cands.sort((a, b) => b.sc - a.sc);
    const finalists = cands.slice(0, Math.min(nFinal, cands.length));
    const baseC = cands.find((c) => c.base);
    if (baseC && !finalists.includes(baseC)) finalists.push(baseC);   // always re-measure the static answer
    let best = null;
    if (raysFinal > raysScreen && left() > 0.15 * msBudget) {
      for (let k = 0; k < finalists.length; k++) {
        if (k && left() < 0.08 * msBudget) break;
        const c = finalists[k];
        try {
          const tr = tools.trace(c.out.surfaces, { rays: raysFinal, seed, occlusion: goal !== 'faithful' });
          c.sc2 = goalScore(goal, tr);
          c.tr = tr;
          log.push('  final ' + c.tag + ' → ' + goalLabel(goal, c.sc2) + ' @' + (raysFinal / 1000) + 'k rays');
        } catch (e) { c.sc2 = c.sc; log.push('  final ' + c.tag + ': ' + String(e && e.message || e).slice(0, 50)); }
        if (!best || c.sc2 > best.sc2) best = c;
        if (tools && tools.progress) try { tools.progress(0.6 + 0.4 * (k + 1) / finalists.length); } catch (e) {}
      }
    }
    if (!best) { best = finalists[0]; best.sc2 = best.sc; }   // no time left to re-trace: keep the screen winner
    // No-regret guard: the static default is a known-good answer, and a screening/final trace is a
    // noisy measurement.  Only switch away from it when the challenger is better by a real margin.
    const base = finalists.find((c) => c.base) || cands.find((c) => c.base);
    if (base && best !== base && base.sc2 !== undefined) {
      const margin = (+settings.autoMargin >= 0 ? +settings.autoMargin : 0.01) * Math.max(1e-9, Math.abs(base.sc2));
      if (best.sc2 - base.sc2 < margin) {
        log.push('  ' + best.tag + ' beats the static default by only ' + goalLabel(goal, best.sc2 - base.sc2) +
          ' (< ' + (100 * (+settings.autoMargin >= 0 ? +settings.autoMargin : 0.01)).toFixed(1) + '%): keeping the default');
        best = base;
      }
    }
    const o = best.out;
    o.notes = (o.notes || []).concat([
      'tuner: goal ' + goal + ' — screened ' + cands.length + ' distinct variant' + (cands.length === 1 ? '' : 's') +
      ' at ' + (raysScreen / 1000) + 'k rays, re-traced the top ' + finalists.length + ' at ' + (raysFinal / 1000) +
      'k (seed ' + seed + '), picked ' + best.tag + ' → ' + goalLabel(goal, best.sc2),
    ].concat(log.map((l) => '  · ' + l)));
    return o;
  }

  RF.Solvers.register({
    id: 'bench-qwen38max-r3--foldplane-auto', name: 'Fold plane (tuned)', version: '0.1', modes: ['paint'],
    settings: STATIC_SETTINGS.concat([
      { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
      { key: 'autoRays', label: 'Screening rays per candidate', type: 'range', min: 2000, max: 400000, step: 2000, default: 30000 },
      { key: 'autoRaysFinal', label: 'Rays for the finalists', type: 'range', min: 2000, max: 2000000, step: 10000, default: 200000 },
      { key: 'autoFinal', label: 'Finalists re-traced', type: 'range', min: 1, max: 6, step: 1, default: 3 },
      { key: 'autoMax', label: 'Candidates traced', type: 'range', min: 1, max: 12, step: 1, default: 8 },
      { key: 'autoMargin', label: 'Margin needed to leave the static default (fraction)', type: 'range', min: 0, max: 0.2, step: 0.005, default: 0.01 },
      { key: 'autoSeed', label: 'Tuner trace seed', type: 'number', min: 1, step: 1, default: 90210 },
    ]),
    solve: solveAuto,
  });
})();
