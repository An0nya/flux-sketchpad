/* mosaic — a static paint solver.
 *
 * Idea: the envelope skin is a shell of possible mirror sites.  A facet at distance r from the LED,
 * aimed at the target, images the LED onto the target: the "stamp" is the LED's reflected image,
 * a parallelogram about 2·D/r across (D = throw).  So
 *   · put every facet as FAR from the LED as the envelope allows  → smallest possible stamps;
 *   · lay the aims on a grid over the painting, spacing ≈ stamp/2  → smooth, gap-free coverage;
 *   · solve for non-negative flux per facet against the painting  → the pattern (ISRA, no tracing);
 *   · size each facet from its flux and the inverse-square catch  → the geometry.
 * Everything is analytic: the stamp of a facet is computed from the LED's extent vectors reflected
 * in the mirror plane and projected onto the target, so the fit runs on a real forward model.
 */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V;

  // ---------------------------------------------------------------- small helpers
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

  // Half-extent vectors of the emitter (world).  Two are enough: the stamp is their image.
  function ledExtents(src) {
    const fr = RF.Source.frame(src);
    if (src.kind === 'planar') {
      if (src.shape === 'disc') return [V.mul(fr.u, src.radius), V.mul(fr.v, src.radius)];
      return [V.mul(fr.u, src.w / 2), V.mul(fr.v, src.h / 2)];
    }
    if (src.kind === 'volume') {
      if (src.shape === 'cylinder') {
        const c = [[fr.u, src.radius], [fr.v, src.radius], [fr.a, src.length / 2]].sort((p, q) => q[1] - p[1]);
        return [V.mul(c[0][0], c[0][1]), V.mul(c[1][0], c[1][1])];
      }
      return [V.mul(fr.u, src.radius), V.mul(fr.v, src.radius)];
    }
    return [[0, 0, 0], [0, 0, 0]];
  }

  // Relative radiant intensity, normalised so the peak over the sphere is 1.
  function intensityFn(src) {
    let peak = 1e-9;
    for (let k = 0; k <= 90; k++) peak = Math.max(peak, RF.Source.intensity(src, k * Math.PI / 180));
    return (d) => RF.Source.intensity(src, Math.acos(clamp(V.dot(d, RF.Source.frame(src).a), -1, 1))) / peak;
  }
  // Total flux the LED puts into a unit solid angle at direction d (lm/sr), from its power.
  function intensityPerSr(src) {
    const fr = RF.Source.frame(src), tm = RF.Source.thetaMax(src);
    let I = 0; const N = 180;                                  // ∫ I dΩ over the emitting cap
    for (let k = 0; k < N; k++) {
      const t0 = tm * k / N, t1 = tm * (k + 1) / N, tm2 = (t0 + t1) / 2;
      I += RF.Source.intensity(src, tm2) * 2 * Math.PI * Math.sin(tm2) * (t1 - t0);
    }
    const k = I > 1e-12 ? src.power / I : 0;
    return (d) => k * RF.Source.intensity(src, Math.acos(clamp(V.dot(d, fr.a), -1, 1)));
  }

  // Distance from the LED to the envelope skin along d (0 if d escapes nowhere).
  function rSkin(env, L, d) {
    const iv = RF.Geo.envInterval(env, L, d);
    return isFinite(iv[1]) && iv[1] > 0 ? iv[1] : 0;
  }

  // ---------------------------------------------------------------- the stamp model
  /* stamp(L, e1, e2, P, Z, T, cell) → the LED's image on the target, in paint-cell units:
   *   c = centre [ci, cj], a/b = the two half-edge vectors [du, dv].
   * The mirror at P sends the LED centre to Z; an LED point offset by e lands at Z + m·R(e)
   * (m = di/r, R = reflection in the mirror plane), projected onto the target plane along the beam. */
  function stamp(L, e1, e2, P, Z, T, cell) {
    const r = V.dist(P, L), di = V.dist(Z, P);
    const sh = V.mul(V.sub(L, P), 1 / r), ah = V.mul(V.sub(Z, P), 1 / di);
    const n = V.norm(V.add(sh, ah)), m = di / r;
    const nt = T.n, k = V.dot(ah, nt);
    const img = (e) => {
      const q = V.sub(e, V.mul(n, 2 * V.dot(e, n)));           // reflect the offset in the mirror
      const w = Math.abs(k) > 1e-9 ? V.sub(q, V.mul(ah, V.dot(q, nt) / k)) : q;   // project along the beam
      return [V.dot(w, T.tu) * m / cell, V.dot(w, T.tv) * m / cell];
    };
    const c = V.sub(Z, T.C);
    return {
      c: [(V.dot(c, T.tu) + T.half) / cell - 0.5, (V.dot(c, T.tv) + T.half) / cell - 0.5],
      a: img(e1), b: img(e2), r, di, n, m,
      cos_i: Math.abs(V.dot(n, sh)),                          // cosine of the incidence angle
    };
  }

  // x-extent of the parallelogram {c + s·a + t·b, s,t∈[-1,1]} at ordinate v (cell units).
  function xSpan(c, a, b, v) {
    const p = [[c[0] - a[0] - b[0], c[1] - a[1] - b[1]], [c[0] + a[0] - b[0], c[1] + a[1] - b[1]],
               [c[0] + a[0] + b[0], c[1] + a[1] + b[1]], [c[0] - a[0] + b[0], c[1] - a[1] + b[1]]];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const q = p[i], w = p[(i + 1) % 4];
      const v0 = Math.min(q[1], w[1]), v1 = Math.max(q[1], w[1]);
      if (v < v0 - 1e-12 || v > v1 + 1e-12) continue;
      const t = Math.abs(w[1] - q[1]) < 1e-12 ? 0.5 : (v - q[1]) / (w[1] - q[1]);
      const x = q[0] + (w[0] - q[0]) * t;
      if (x < lo) lo = x; if (x > hi) hi = x;
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /* Add one facet's stamp to a column of the design matrix: exact overlap in u, the v direction
   * subdivided KV times per cell row.  The column is normalised to sum 1 (a flux fraction). */
  function rasterStamp(col, R, st, KV) {
    const c = st.c, a = st.a, b = st.b;
    const vs = [c[1] - a[1] - b[1], c[1] + a[1] - b[1], c[1] + a[1] + b[1], c[1] - a[1] + b[1]];
    let vmin = Math.min.apply(null, vs), vmax = Math.max.apply(null, vs);
    if (!(vmax > vmin)) { vmax = vmin + 1e-6; }
    const j0 = clamp(Math.floor(vmin), 0, R - 1), j1 = clamp(Math.ceil(vmax) - 1, 0, R - 1);
    for (let j = j0; j <= j1; j++) for (let k = 0; k < KV; k++) {
      const sp = xSpan(c, a, b, j + (k + 0.5) / KV); if (!sp) continue;
      const i0 = clamp(Math.floor(sp[0]), 0, R - 1), i1 = clamp(Math.ceil(sp[1]) - 1, 0, R - 1);
      for (let i = i0; i <= i1; i++) {
        const ox = Math.min(i + 1, sp[1]) - Math.max(i, sp[0]);
        if (ox > 0) col[j * R + i] += ox / KV;
      }
    }
    const s = sum(col); if (s > 0) for (let i = 0; i < col.length; i++) col[i] /= s;
    return s > 0;
  }

  /* Separable box blur by prefix sums, O(R^2) whatever the width.  Used to model a deliberately
   * defocused mirror: the LED image is then smeared by (aperture)x|d_target-d_image|/d_image, which
   * turns each hard-edged stamp into a soft one and lets neighbours blend instead of tiling. */
  function stBox(st, R) {                                 // the stamp's cell bounding box [i0,i1,j0,j1]
    const c = st.c, a = st.a, b = st.b;
    const us = [c[0] - a[0] - b[0], c[0] + a[0] - b[0], c[0] + a[0] + b[0], c[0] - a[0] + b[0]];
    const vs = [c[1] - a[1] - b[1], c[1] + a[1] - b[1], c[1] + a[1] + b[1], c[1] - a[1] + b[1]];
    return [clamp(Math.floor(Math.min.apply(null, us)), 0, R - 1), clamp(Math.ceil(Math.max.apply(null, us)) - 1, 0, R - 1),
            clamp(Math.floor(Math.min.apply(null, vs)), 0, R - 1), clamp(Math.ceil(Math.max.apply(null, vs)) - 1, 0, R - 1)];
  }
  let blurScratch = null;
  function boxBlur(col, R, half, box) {
    const n = Math.round(half); if (!(n > 0)) return col;
    if (!blurScratch || blurScratch.length < col.length) blurScratch = new Float64Array(col.length);
    const tmp = blurScratch, w = 2 * n + 1;
    // output window = the stamp's box grown by n; the horizontal pass must also fill the n rows above
    // and below it, because the vertical pass reaches that far into tmp (which is reused, so any cell
    // it could read has to be written this time round).
    const oi0 = Math.max(0, box[0] - n), oi1 = Math.min(R - 1, box[1] + n);
    const oj0 = Math.max(0, box[2] - n), oj1 = Math.min(R - 1, box[3] + n);
    const hj0 = Math.max(0, box[2] - 2 * n), hj1 = Math.min(R - 1, box[3] + 2 * n);
    for (let j = hj0; j <= hj1; j++) {                  // horizontal
      let acc = 0; const base = j * R;
      for (let i = oi0 - n; i <= oi0 + n; i++) acc += col[base + clamp(i, 0, R - 1)];
      for (let i = oi0; i <= oi1; i++) {
        tmp[base + i] = acc / w;
        acc += col[base + clamp(i + n + 1, 0, R - 1)] - col[base + clamp(i - n, 0, R - 1)];
      }
    }
    for (let i = oi0; i <= oi1; i++) {                  // vertical
      let acc = 0;
      for (let j = oj0 - n; j <= oj0 + n; j++) acc += tmp[clamp(j, 0, R - 1) * R + i];
      for (let j = oj0; j <= oj1; j++) {
        col[j * R + i] = acc / w;
        acc += tmp[clamp(j + n + 1, 0, R - 1) * R + i] - tmp[clamp(j - n, 0, R - 1) * R + i];
      }
    }
    return col;
  }
  // ---------------------------------------------------------------- candidate mirror sites
  function fibDirs(n) {                                     // unit vectors, even over the sphere
    const out = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < n; k++) {
      const z = 1 - 2 * (k + 0.5) / n, rr = Math.sqrt(Math.max(0, 1 - z * z)), th = ga * k;
      out.push([rr * Math.cos(th), rr * Math.sin(th), z]);
    }
    return out;
  }

  /* Sites = directions the LED actually emits into, pushed out to the envelope skin.  The score
   * prefers a long lever (sharp stamps), real emission, and a real turn of the ray (a grazing
   * mirror catches nothing and smears). */
  function candidateSites(src, env, L, T, rMin, nDir, rTgt, minI, minTurn, escP) {
    const fr = RF.Source.frame(src), rel = intensityFn(src);
    const tdir = V.norm(V.sub(T.C, L));
    let rBest = 1e-9;
    const cands = [];
    for (const q of fibDirs(nDir)) {
      const d = V.add(V.mul(fr.a, q[2]), V.add(V.mul(fr.u, q[0]), V.mul(fr.v, q[1])));
      const I = rel(d); if (I < minI) continue;
      const r = rSkin(env, L, d); if (r < rMin) continue;
      const g = Math.acos(clamp(V.dot(d, tdir), -1, 1));      // ray turn: 180 deg = straight back
      const turn = Math.sin(g / 2);                            // = cos of the incidence angle
      if (turn < minTurn) continue;
      const reff = Math.max(rMin, Math.min(r - 1, rTgt || r));
      // A mirror on the far side of the LED shoots its beam back through the whole array and loses
      // half of it to neighbours.  cos^2(g/2) is the cheap static proxy for "exits at once".
      const esc = escP > 0 ? Math.pow((1 + V.dot(d, tdir)) / 2, escP) : 1;
      cands.push({ d, r, reff, I, turn, esc });
      if (reff > rBest) rBest = reff;
    }
    for (const c of cands) { const q = c.reff / rBest; c.score = q * q * (0.25 + c.I) * c.turn * c.esc; }
    return cands;
  }

  // Greedy well-spread pick: the largest angular separation that still yields n sites.
  function selectSites(cands, n, sepLo, sepHi) {
    const order = cands.slice().sort((p, q) => q.score - p.score);
    const pick = (sep) => {
      const cs = Math.cos(sep), chosen = [];
      for (const c of order) {
        let ok = true;
        for (let i = 0; i < chosen.length; i++) if (V.dot(chosen[i].d, c.d) > cs) { ok = false; break; }
        if (ok) chosen.push(c);
        if (chosen.length >= n) break;
      }
      return chosen;
    };
    let lo = sepLo, hi = sepHi, best = pick(lo);
    for (let k = 0; k < 16; k++) {
      const m = (lo + hi) / 2, p = pick(m);
      if (p.length >= n) { best = p; lo = m; } else hi = m;
    }
    return best.slice(0, n);
  }

  // ---------------------------------------------------------------- aims over the painting
  function paintBox(paint, R) {
    let a = R, b = -1, c = R, d = -1;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) {
      if (i < a) a = i; if (i > b) b = i; if (j < c) c = j; if (j > d) d = j;
    }
    return b < a ? null : [a, b, c, d];
  }
  function localMean(paint, R, ci, cj, W) {                   // mean paint under a W x W cell box
    const h = W / 2; let s = 0, acc = 0;
    for (let j = Math.max(0, Math.floor(cj - h)); j < Math.min(R, Math.ceil(cj + h)); j++)
      for (let i = Math.max(0, Math.floor(ci - h)); i < Math.min(R, Math.ceil(ci + h)); i++) {
        const ox = Math.min(i + 1, ci + h) - Math.max(i, ci - h), oy = Math.min(j + 1, cj + h) - Math.max(j, cj - h);
        if (ox > 0 && oy > 0) { s += ox * oy; acc += paint[j * R + i] * ox * oy; }
      }
    return s > 0 ? acc / s : 0;
  }
  /* Connected components of the paint (4-neighbour, cells with value > 0).  A stencil of separate
   * blobs wants one aim per blob, dead centre; a square lattice straddles them and lights the gaps. */
  function paintComponents(paint, R, minCells) {
    const lab = new Int32Array(R * R); lab.fill(-1);
    const stack = new Int32Array(R * R), comps = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k0 = j * R + i; if (paint[k0] <= 0 || lab[k0] >= 0) continue;
      const id = comps.length; let top = 0, cnt = 0, si = 0, sj = 0, sum = 0;
      stack[top++] = k0; lab[k0] = id;
      while (top) {
        const k = stack[--top], kj = (k / R) | 0, ki = k - kj * R;
        cnt++; si += ki; sj += kj; sum += paint[k];
        if (ki > 0)     { const q = k - 1; if (paint[q] > 0 && lab[q] < 0) { lab[q] = id; stack[top++] = q; } }
        if (ki < R - 1) { const q = k + 1; if (paint[q] > 0 && lab[q] < 0) { lab[q] = id; stack[top++] = q; } }
        if (kj > 0)     { const q = k - R; if (paint[q] > 0 && lab[q] < 0) { lab[q] = id; stack[top++] = q; } }
        if (kj < R - 1) { const q = k + R; if (paint[q] > 0 && lab[q] < 0) { lab[q] = id; stack[top++] = q; } }
      }
      if (cnt >= minCells) comps.push({ ci: si / cnt, cj: sj / cnt, n: cnt, m: sum / cnt, tot: sum });
    }
    return comps;
  }

  /* Aim points: a square lattice over the painting, spacing chosen so the count lands on the
   * budget.  Only lattice points whose stamp footprint touches paint are kept. */
  function aimGrid(paint, R, n, W, padFrac) {
    const bb = paintBox(paint, R); if (!bb) return [];
    const a = bb[0], b = bb[1], c = bb[2], d = bb[3], pad = (padFrac === undefined ? 0.5 : padFrac) * W;
    const grid = (s) => {
      const out = [], i0 = a - pad, i1 = b + pad, j0 = c - pad, j1 = d + pad;
      const ni = Math.max(1, Math.round((i1 - i0) / s)), nj = Math.max(1, Math.round((j1 - j0) / s));
      const su = (i1 - i0) / ni, sv = (j1 - j0) / nj;
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const ci = i0 + (i + 0.5) * su, cj = j0 + (j + 0.5) * sv;
        const m = localMean(paint, R, ci, cj, W);
        if (m > 0) out.push({ ci, cj, m });
      }
      return out;
    };
    let lo = 0.4, hi = Math.max(b - a, d - c) + W, best = grid(hi);
    for (let k = 0; k < 28; k++) {
      const m2 = (lo + hi) / 2, g = grid(m2);
      if (g.length > n) lo = m2; else { hi = m2; best = g; }
    }
    if (best.length > n) best = best.slice().sort((p, q) => q.m - p.m).slice(0, n);
    // A lattice point can sit in a gap between strokes while its W-box still holds ink.  Slide it onto
    // the ink centroid of its neighbourhood, unless another aim already covers that spot: on a sparse
    // scene every aim would collapse onto the same few blobs (measured: sparse-spot-16 78.6 -> 70.4).
    {
      const rw = Math.max(2, W / 2), rl = Math.max(2, W / 3);
      const moved = [];
      for (const q of best) {
        let sw = 0, si = 0, sj = 0;
        const i0 = Math.max(0, Math.round(q.ci - rw)), i1 = Math.min(R - 1, Math.round(q.ci + rw));
        const j0 = Math.max(0, Math.round(q.cj - rw)), j1 = Math.min(R - 1, Math.round(q.cj + rw));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const du = i - q.ci, dv = j - q.cj; if (du * du + dv * dv > rw * rw) continue;
          const v = paint[j * R + i]; if (!(v > 0)) continue;
          sw += v; si += v * i; sj += v * j;
        }
        if (sw > 0) { q.ci = Math.round(si / sw); q.cj = Math.round(sj / sw); }
        let clash = false;
        for (const o2 of moved) { const du = o2[0] - q.ci, dv = o2[1] - q.cj; if (du * du + dv * dv < rl * rl) { clash = true; break; } }
        if (clash) { q.skip = true; } else moved.push([q.ci, q.cj]);
      }
      const seen = new Set();
      for (let k = best.length - 1; k >= 0; k--) { const key = best[k].ci + ',' + best[k].cj; if (seen.has(key)) best.splice(k, 1); else seen.add(key); }
    }
    // Sparse stencil: put an aim on every blob's centroid first, then fill the budget with lattice
    // points that are not already covered.  Centroids sit ON the paint; lattice points straddle it.
    let comps = paintComponents(paint, R, Math.max(2, 0.05 * W * W));
    if (comps.length > n) comps = comps.slice().sort((a, b) => b.m - a.m).slice(0, n);   // the n heaviest blobs
    if (comps.length >= 2) {
      const out = comps.map((c) => ({ ci: c.ci, cj: c.cj, m: c.m }));
      for (const q of best) {
        if (out.length >= n) break;
        let near = false;
        for (const c of comps) { const du = q.ci - c.ci, dv = q.cj - c.cj; if (du * du + dv * dv < 0.36 * W * W) { near = true; break; } }
        if (!near) out.push(q);
      }
      return out;
    }
    return best;
  }


  // Does a rectangular facet of half-size hx, centred rr along d from the LED and spanning ex/ey,
  // stay inside the envelope and clear of the LED?  The envelope need not be a box and the LED need
  // not be at its centre, so test the corners directly (the patch is convex and nearly flat).
  function facetFits(env, L, d, rr, ex, ey, hx, keep, tol) {
    const P = V.add(L, V.mul(d, rr));
    if (rr < keep) return false;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = V.add(P, V.add(V.mul(ex, sx * hx), V.mul(ey, sy * hx)));
      if (!RF.Geo.envInside(env, p, tol) || V.dist(p, L) < keep) return false;
    }
    return true;
  }
  // How far out can a facet of half-size hx sit before its corners leave the envelope?  Each corner
  // sweeps its own ray out of the LED; a corner ray that starts outside (the LED hugs a wall) has no
  // usable interval at all.
  function rLimCorners(env, L, d, ex, ey, hx) {
    let rlim = Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = V.add(V.mul(ex, sx * hx), V.mul(ey, sy * hx));
      const iv = RF.Geo.envInterval(env, V.add(L, c), d);
      rlim = Math.min(rlim, iv[0] <= 1e-9 && isFinite(iv[1]) && iv[1] > 0 ? iv[1] : 0);
    }
    return isFinite(rlim) ? rlim : 0;
  }
  // Largest half-size up to hi that fits (0 if even a hair does not).
  function fitHx(env, L, d, rr, ex, ey, hi, keep, tol) {
    if (!facetFits(env, L, d, rr, ex, ey, hi, keep, tol)) {
      let lo = 0, h = hi;
      for (let k = 0; k < 18; k++) { const m = 0.5 * (lo + h); if (facetFits(env, L, d, rr, ex, ey, m, keep, tol)) lo = m; else h = m; }
      return lo;
    }
    return hi;
  }

  // ---------------------------------------------------------------- sparse design matrix + fit
  function sparsify(col) {
    let n = 0; for (let i = 0; i < col.length; i++) if (col[i] > 0) n++;
    const idx = new Int32Array(n), val = new Float64Array(n); let k = 0;
    for (let i = 0; i < col.length; i++) if (col[i] > 0) { idx[k] = i; val[k] = col[i]; k++; }
    return { idx, val };
  }
  // ISRA: multiplicative non-negative least squares, optionally with a per-facet ceiling.
  function isra(cols, y, w, cap, iters) {
    const n = cols.length, m = y.length, Ay = new Float64Array(n), den = new Float64Array(n);
    for (let k = 0; k < n; k++) { const c = cols[k]; let s = 0; for (let t = 0; t < c.idx.length; t++) s += c.val[t] * y[c.idx[t]]; Ay[k] = s; }
    const cur = new Float64Array(m);
    for (let it = 0; it < iters; it++) {
      cur.fill(0);
      for (let k = 0; k < n; k++) { const wk = w[k]; if (!(wk > 0)) continue; const c = cols[k]; for (let t = 0; t < c.idx.length; t++) cur[c.idx[t]] += wk * c.val[t]; }
      for (let k = 0; k < n; k++) { const c = cols[k]; let s = 0; for (let t = 0; t < c.idx.length; t++) s += c.val[t] * cur[c.idx[t]]; den[k] = s; }
      for (let k = 0; k < n; k++) { const v = den[k] > 1e-15 ? w[k] * Ay[k] / den[k] : 0; w[k] = cap ? Math.min(v, cap[k]) : v; }
    }
    return w;
  }

  // What fraction of a facet's beam actually leaves the array?  With limits.bounces = 1 the app drops
  // any ray that meets a second surface, so a mirror shooting back through its neighbours loses that
  // light entirely.  Sample the aperture (4x4) and march each sample toward the aim, testing every other
  // facet's quad.  Checked against the tracer (solvers/dev/esc-test.js): weighted-mean escape agrees to
  // <0.005 and the per-facet correlation is 0.98-0.99, for ~2 ms.
  function escapeFracs(F, L) {
    const n = F.length, fr = new Array(n);
    for (let i = 0; i < n; i++) {
      const f = F[i];
      const sh = V.norm(V.sub(L, f.P)), ah = V.norm(V.sub(f.Z, f.P));
      const nn = V.norm(V.add(sh, ah));
      const ref = Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const u = V.norm(V.cross(nn, ref)), v = V.cross(nn, u);
      fr[i] = { P: f.P, n: nn, u, v, t: ah, hx: Math.max(f.hx || 0, 0.05), drop: !!f.drop };
    }
    const SS = [-0.75, -0.25, 0.25, 0.75], esc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const A = fr[i];
      if (A.drop) { esc[i] = 1; continue; }
      let hit = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const oa = SS[a] * A.hx, ob = SS[b] * A.hx;
        const ox = A.P[0] + A.u[0] * oa + A.v[0] * ob, oy = A.P[1] + A.u[1] * oa + A.v[1] * ob, oz = A.P[2] + A.u[2] * oa + A.v[2] * ob;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const B = fr[j]; if (B.drop) continue;
          const den = A.t[0] * B.n[0] + A.t[1] * B.n[1] + A.t[2] * B.n[2];
          if (Math.abs(den) < 1e-9) continue;                      // a back face swallows it too (bounce cap)
          const s2 = ((B.P[0] - ox) * B.n[0] + (B.P[1] - oy) * B.n[1] + (B.P[2] - oz) * B.n[2]) / den;
          if (!(s2 > 1e-6)) continue;
          const qx = ox + A.t[0] * s2 - B.P[0], qy = oy + A.t[1] * s2 - B.P[1], qz = oz + A.t[2] * s2 - B.P[2];
          if (Math.abs(qx * B.u[0] + qy * B.u[1] + qz * B.u[2]) <= B.hx && Math.abs(qx * B.v[0] + qy * B.v[1] + qz * B.v[2]) <= B.hx) { hit++; break; }
        }
      }
      esc[i] = 1 - hit / 16;
    }
    return esc;
  }

  // ---------------------------------------------------------------- the solver
  // The static solver's knobs.  Hoisted so the tuner below can start from the same defaults.
  const SETTINGS = [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, max: 80, step: 0.5, default: 0, help: 'Extra clearance around the LED, on top of the envelope keep-out.' },
      { key: 'inset', label: 'Skin inset (mm)', type: 'number', min: 0, max: 20, step: 0.5, default: 1, help: 'How far facet centres sit inside the envelope skin.' },
      { key: 'cover', label: 'Stamp cover factor', type: 'number', min: 0.6, max: 2.5, step: 0.05, default: 1, help: 'Stamp width = cover x 2 sqrt(painted area / facets). Bigger = smoother, softer.' },
      { key: 'sizeFrac', label: 'Facet size / distance', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.35, help: 'Cap on half-size / LED distance: bigger catches more light but smears the stamp (magnification varies across the facet).' },
      { key: 'gapFrac', label: 'Packing (of site spacing)', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.98, help: 'Facet width as a fraction of the distance to its nearest neighbour.' },
      { key: 'aimScale', label: 'Aim density', type: 'number', min: 0.25, max: 8, step: 0.25, default: 1, help: 'Aims per stamp-width cell: >1 keeps every mirror on its own aim (smoother washes, more overlap).' },
      { key: 'sharp', label: 'Sharpening', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, help: 'Fit target = painting blurred by sharp x stamp. Lower asks the fit for sharper edges.' },
      { key: 'iters', label: 'Fit iterations', type: 'number', min: 10, max: 600, step: 10, default: 150 },
      { key: 'minStamp', label: 'Min stamp (cells)', type: 'number', min: 0.2, max: 8, step: 0.1, default: 0.8, help: 'Floor on the modelled stamp width; a point source would otherwise image to nothing.' },
      { key: 'minI', label: 'Min LED intensity (of peak)', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.12, help: 'Skip mirror directions the LED barely lights: they catch nothing and starve the whole array.' },
      { key: 'minTurn', label: 'Min cos(incidence)', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.35, help: 'Skip grazing mirrors (a ray that barely turns): they catch little and smear.' },
      { key: 'satQ', label: 'Saturate weakest (quantile)', type: 'number', min: 0, max: 0.4, step: 0.01, default: 0.08, help: 'Fraction of facets allowed to fall short of the fitted flux, to keep the array bright.' },
      { key: 'escP', label: 'Escape bias', type: 'number', min: 0, max: 3, step: 0.25, default: 0, help: 'Penalise mirrors whose beam cuts back through the array: score x cos^(2p)(turn/2). 0 = off.' },
      { key: 'aimPad', label: 'Aim overscan (x stamp)', type: 'number', min: 0, max: 0.75, step: 0.05, default: 0, help: 'How far outside the painting aims may sit. Half a stamp lights the edge cells fully but spills past them; 0 keeps every stamp centre on the paint.' },
      { key: 'areaFrac', label: 'Aim spacing from ink (0=box, 1=ink)', type: 'number', min: 0, max: 1, step: 0.05, default: 1, help: 'How much the aim spacing (and so the stamp size) follows the painted ink rather than the painting\'s bounding box. Stencils want 1, solid washes are happy with either.' },
      { key: 'defocus', label: 'Defocus (cells of blur)', type: 'number', min: 0, max: 12, step: 0.5, default: 4, help: 'Image the LED short of the target so every stamp lands soft-edged instead of a hard tile. 0 = sharp focus.' },
      { key: 'pruneQ', label: 'Prune below (x median catch)', type: 'number', min: 0, max: 0.8, step: 0.05, default: 0, help: 'Discard mirrors that cannot deliver their share of the painting; the rest run brighter. 0 = keep all.' },
      { key: 'escDrop', label: 'Drop if escape below', type: 'number', min: 0, max: 0.6, step: 0.05, default: 0, help: 'Discard mirrors whose beam is mostly swallowed by neighbours; 0 = keep and re-aim the flux instead.' },
      { key: 'escPasses', label: 'Blocking-aware fit passes', type: 'number', min: 0, max: 3, step: 1, default: 0, help: 'Re-run the flux fit with each mirror\'s statically computed beam-escape fraction. 0 = off.' },
      { key: 'dbg', label: 'Debug notes', type: 'checkbox', default: false },
      { key: 'shapeLock', label: 'Lock stamp shape (debug)', type: 'checkbox', default: false },
      { key: 'flatW', label: 'Flat weights (debug)', type: 'checkbox', default: false },
      { key: 'uniR', label: 'Uniform radius percentile', type: 'number', min: 0, max: 0.5, step: 0.05, default: 0 },
    ];

  RF.Solvers.register({
    id: 'bench-qwen38max-r2--mosaic', name: 'Mosaic', version: '0.2', modes: ['paint'],
    settings: SETTINGS,
    solve(input, settings, tools) { return bestOf(input, settings, tools); },
  });

  // ---------------------------------------------------------------- score a design without tracing
  // The app's own fidelity(), fed the pattern the intent promises.  No rays: pure arithmetic on the
  // columns we already built, so it is legal inside solve() and cheap enough to try a few shapes.
  function modelScore(input, out, rays, settings) {
    try {
      const R = input.paint.res, n = R * R, pat = new Float64Array(n);
      let tot = 0;
      const esc = out.esc || null;
      for (let i = 0; i < out.intent.length; i++) {
        const it = out.intent[i], e = esc ? esc[i] : 1;
        for (let t = 0; t < it.cells.length; t++) { const c = it.cells[t]; pat[c[0]] += c[1] * e; tot += c[1] * e; }
      }
      if (!(tot > 0)) return null;
      const scene = { source: input.source, sources: input.sources || [input.source], target: input.target, envelope: input.envelope, modeA: { paint: input.paint.cells } };
      const srcs = input.sources && input.sources.length ? input.sources : [input.source];
      let pw = 0; for (const q of srcs) pw += q.power || 0;
      const P = { res: R, power: pw || 1, T: RF.Engine.targetFrame(input.target) };
      const N = rays || 1e6, e0 = P.power / N;
      const gridR = settings && settings.noiseModel === false ? pat : poissonise(pat, e0, 12345);
      const ctx = { gridD: new Float64Array(n), gridR, N, E: { emitted: P.power, direct: 0, reflected: tot } };
      const f = RF.Photometry.fidelity(scene, P, ctx);
      return f ? { fid: f.fidelity, ceil: f.fidelityNoiseCeiling, within: f.within, gaps: f.gapsDark, lm: tot } : null;
    } catch (e) { return null; }
  }

  // The app scores a TRACE, so a design is only as good as its photon statistics.  Emulate them:
  // each paint cell's modelled energy becomes a Poisson draw of the same mean (normal approximation,
  // fixed seed so solve() stays deterministic).  Without this the model prefers pretty-but-dim designs.
  function poissonise(pat, e0, seed) {
    if (!(e0 > 0)) return pat;
    const out = new Float64Array(pat.length);
    let s = (seed | 0) || 1;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let k = 0; k < pat.length; k++) {
      const mu = pat[k] / e0;
      if (!(mu > 0)) { out[k] = 0; continue; }
      const u1 = Math.max(1e-12, rnd()), u2 = rnd();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283185307179586 * u2);
      out[k] = Math.max(0, mu + Math.sqrt(mu) * z) * e0;
    }
    return out;
  }

  // The stamp size is a trade: big stamps overlap more (a smooth wash, fewer holes) but smear the
  // painting (lit gaps).  Which side wins depends entirely on the picture, so try a few and keep the
  // one the app's own metric likes best.
  const COVERS = [[0.7, 1], [1, 1], [1.25, 2], [1.5, 3], [2, 6], [2.6, 10]];
  const TURNS = [0.35, 0.45];
  const SHAPES = [];
  for (const c of COVERS) for (const t of TURNS) SHAPES.push([c[0], c[1], null, t]);
  // After the coarse grid, walk the remaining knobs one at a time and keep anything the model likes
  // better.  Cheap (one design per probe) and it is what lets one file suit a wash and a fine stencil.
  const POLISH = [[{ minI: 0.06 }, { minI: 0.12 }, { minI: 0.25 }], [{ sharp: 0.15 }, { sharp: 0.3 }, { sharp: 0.5 }],
    [{ defocus: 0 }, { defocus: 2 }, { defocus: 4 }, { defocus: 8 }],
    [{ areaFrac: 0 }, { areaFrac: 0.35 }, { areaFrac: 1 }],
    [{ aimPad: 0 }, { aimPad: 0.25 }, { aimPad: 0.5 }],
    [{ aimScale: 0.5 }, { aimScale: 1 }, { aimScale: 2 }, { aimScale: 3 }, { aimScale: 6 }],
    [{ cover: 0.7 }, { cover: 1 }, { cover: 1.25 }, { cover: 1.5 }, { cover: 2 }, { cover: 2.6 }]];
  function bestOf(input, settings, tools) {
    const rays = (tools && tools.budget && tools.budget.rays) || 1e6;
    const log = [];
    let cur = {};
    const run = (over) => {
      const merged = Object.assign({}, cur, over);
      const cfg = Object.assign({}, settings, merged);
      let out; try { out = designOne(input, cfg, tools); } catch (e) { return null; }
      const sc = modelScore(input, out, rays, cfg);
      const label = Object.keys(merged).map((k) => k + ' ' + merged[k]).join(', ');
      log.push((label || 'base') + ': ' + (sc ? sc.fid.toFixed(3) : 'x') + (sc ? ' (w ' + sc.within.toFixed(2) + ' g ' + sc.gaps.toFixed(2) + ' ceil ' + (sc.ceil === null ? 'n/a' : sc.ceil.toFixed(2)) + ' ' + sc.lm.toFixed(0) + ' lm)' : ''));
      return { rank: sc ? sc.fid : -1, out, sc, cfg, label };
    };
    let best = null;
    const shapes = settings.shapeLock ? [[settings.cover, settings.aimScale, settings.minTurn]] : SHAPES;
    for (const sh of shapes) {
      const over = { cover: sh[0], aimScale: sh[1], minTurn: sh[3] === undefined ? settings.minTurn : sh[3] };
      const r = run(over);
      if (r && (!best || r.rank > best.rank + 0.015)) { best = r; cur = over; }   // keep the simpler shape unless the model is clear; the polish starts FROM this winner
    }
    if (!best) return designOne(input, settings, tools);
    for (const dim of POLISH) for (const over of dim) {
      const r = run(over);
      if (r && r.rank > best.rank + 0.015) { best = r; cur = Object.assign({}, cur, over); }   // only move on a real margin: the model cannot resolve ties
    }
    if (settings.dbg) best.out.notes.push('DBG search | ' + log.join(' | '));
    if (best.sc) best.out.notes.push('chosen ' + (best.label || 'base') + ' — model fidelity ' + best.sc.fid.toFixed(3) +
      ' (within ' + best.sc.within.toFixed(3) + ' gaps ' + best.sc.gaps.toFixed(3) + ', noise ceiling ' + (best.sc.ceil === null ? 'n/a' : best.sc.ceil.toFixed(3)) + ', modelled catch ' + best.sc.lm.toFixed(0) + ' lm)');
    return best.out;
  }

  // ---------------------------------------------------------------- one design pass
  function designOne(input, settings, tools) {
      const src = input.source, env = input.envelope, tgt = input.target;
      const L = src.pos, T = RF.Engine.targetFrame(tgt);
      const R = input.paint.res, paint = Float64Array.from(input.paint.cells);
      const cell = 2 * T.half / R, N = Math.max(1, input.limits.maxFacets | 0);
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const refl = input.limits.reflectivity;
      // Deliberate defocus: image the LED at di < d_target so each stamp arrives soft-edged.
      const blurHalf = (settings.defocus || 0) / 2;                  // in cells
      const defocusDi = (f) => {
        const dt = V.dist(f.Z, f.P), bmm = (settings.defocus || 0) * cell;
        if (!(bmm > 0) || !(f.hx > 0)) return dt;
        return dt / (1 + bmm / (2 * f.hx));
      };
      const ex = ledExtents(src), e1 = ex[0], e2 = ex[1];
      const Iper = intensityPerSr(src);
      const notes = [], envTol = 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
      const uvOf = (ci, cj) => RF.Engine.targetUVtoWorld(T, (ci + 0.5) * cell - T.half, (cj + 0.5) * cell - T.half);
      const D = V.dist(T.C, L);

      // ---- 1. how big a stamp do we need?  N stamps on a lattice of spacing s cover the painting
      //         when each stamp is ~2s across.  s follows from the painted area and the budget; the
      //         LED distance that gives that stamp follows from W = 2 D / r.  Mirrors off the LED's
      //         axis see it foreshortened, so the real stamp is smaller: iterate r to compensate.
      const bb = paintBox(paint, R);
      if (!bb) return { surfaces: [], intent: [], notes: ['the painting is empty'] };
      // Aim spacing follows from the PAINTED area, not its bounding box: a stencil that fills a tenth
      // of its box wants ten times finer aims (and ten times smaller stamps) than a solid rectangle.
      const boxA = (bb[1] - bb[0] + 1) * (bb[3] - bb[2] + 1);
      let inkA = 0;
      for (let j = bb[2]; j <= bb[3]; j++) for (let i = bb[0]; i <= bb[1]; i++) { const v = paint[j * R + i]; if (v > 0) inkA += v < 1 ? v : 1; }
      if (inkA < 1) inkA = boxA;
      const af = clamp(settings.areaFrac === undefined ? 1 : settings.areaFrac, 0, 1);
      const area = boxA * (1 - af) + inkA * af;      // 0 = size aims by the bounding box, 1 = by the ink
      const sAim = Math.sqrt(area / N);
      const Wneed = Math.max(settings.minStamp, settings.cover * 2 * sAim);
      const rMin = Math.max(keep + 0.5, 1);
      let rTgt = 2 * D / (Wneed * cell), cands = [], sites = [], Weff = Wneed;
      for (let pass = 0; pass < 3; pass++) {
        cands = candidateSites(src, env, L, T, rMin, 3000, rTgt, settings.minI, settings.minTurn, settings.escP);
        if (!cands.length) break;
        sites = selectSites(cands, N, 0.02, 1.3);
        if (!sites.length) break;
        if (settings.uniR > 0) {                                  // one radius for all: identical stamps
          const rs = sites.map((x) => x.reff).sort((a, b) => a - b);   // tile the painting without ripple
          const rUse = rs[Math.min(rs.length - 1, Math.floor(settings.uniR * rs.length))];
          sites = sites.filter((x) => x.reff >= rUse - 1e-9);
          for (const x of sites) x.reff = rUse;
        }
        let acc = 0;                                              // mean stamp area at these sites
        const Zc = T.C;
        for (const st0 of sites) {
          const P = V.add(L, V.mul(st0.d, st0.reff));
          const q = stamp(L, e1, e2, P, Zc, T, cell);
          acc += 4 * Math.abs(q.a[0] * q.b[1] - q.a[1] * q.b[0]);
        }
        Weff = Math.max(settings.minStamp, Math.sqrt(acc / sites.length));
        if (Math.abs(Weff - Wneed) < 0.08 * Wneed) break;
        rTgt = clamp(rTgt * Weff / Wneed, rMin, rTgt * 1.6);      // stamps too small -> move in
      }
      if (!cands.length) return { surfaces: [], intent: [], notes: ['no envelope direction both lit by the LED and clear of its keep-out'] };
      let aims = aimGrid(paint, R, sites.length, Weff, settings.aimPad);
      if (!aims.length) return { surfaces: [], intent: [], notes: ['the painting is empty'] };
      const n = sites.length;

      // ---- 3. aims and groups.  A lattice at ~stamp/2 keeps the columns of the fit independent;
      //         a coarse painting (or a big stamp) needs fewer aims than the budget allows, and the
      //         spare mirrors then stack on an aim and add their light to it instead of sitting dark.
      const nA = clamp(Math.round(settings.aimScale * area / Math.max(0.25, 0.25 * Weff * Weff)), 1, Math.max(1, Math.min(n, aims.length)));
      aims = aimGrid(paint, R, nA, Weff, settings.aimPad);
      if (!aims.length) return { surfaces: [], intent: [], notes: ['the painting is empty'] };
      const nS = sites.length, m = aims.length;
      // how many mirrors each aim wants: in proportion to the light the painting asks for there,
      // so the flux ceiling of every aim grows with its weight instead of capping the whole array
      const dem = aims.map((a) => localMean(paint, R, a.ci, a.cj, Weff));
      let dTot = 0; for (const d of dem) dTot += d;
      const slots = dem.map((d) => (dTot > 0 ? Math.max(1, Math.round(nS * d / dTot)) : 1));
      for (let guard = 0; guard < 4 * nS; guard++) {
        let t = 0; for (let j = 0; j < m; j++) t += slots[j];
        if (t === nS) break;
        if (t < nS) { let b = 0; for (let j = 1; j < m; j++) if (dem[j] * slots[b] > dem[b] * slots[j]) b = j; slots[b]++; }
        else { let b = -1; for (let j = 0; j < m; j++) if (slots[j] > 1 && (b < 0 || dem[j] / slots[j] < dem[b] / slots[b])) b = j; if (b < 0) break; slots[b]--; }
      }
      const lat = (p) => { const q = V.sub(p, L); return [V.dot(q, T.tu), V.dot(q, T.tv)]; };
      const sl = sites.map((s) => lat(V.add(L, V.mul(s.d, s.reff))));
      const sn = sl.map((o) => Math.hypot(o[0], o[1]) || 1);
      const al = aims.map((a) => { const w = V.sub(uvOf(a.ci, a.cj), T.C); return [V.dot(w, T.tu), V.dot(w, T.tv)]; });
      const an = al.map((o) => Math.hypot(o[0], o[1]) || 1);
      const pairs = [];
      for (let i = 0; i < nS; i++) for (let j = 0; j < m; j++) pairs.push([-(sl[i][0] * al[j][0] + sl[i][1] * al[j][1]) / (sn[i] * an[j]), i, j]);
      pairs.sort((p, q) => p[0] - q[0]);
      const gOf = new Array(nS).fill(-1), filled = new Array(m).fill(0);
      for (const p of pairs) { if (gOf[p[1]] >= 0 || filled[p[2]] >= slots[p[2]]) continue; gOf[p[1]] = p[2]; filled[p[2]]++; }
      for (let i = 0; i < nS; i++) if (gOf[i] < 0) for (let j = 0; j < m; j++) if (filled[j] < slots[j] + 2) { gOf[i] = j; filled[j]++; break; }

      // ---- 4. geometry + one design-matrix column per facet
      const F = [];
      for (let i = 0; i < nS; i++) {
        if (gOf[i] < 0) continue;
        const s = sites[i], aim = aims[gOf[i]], Z = uvOf(aim.ci, aim.cj);
        let rr = s.reff;
        let P = V.add(L, V.mul(s.d, rr));
        let st = stamp(L, e1, e2, P, Z, T, cell);
        let sep = 9;
        for (let k = 0; k < nS; k++) if (k !== i) { const dd = Math.acos(clamp(V.dot(s.d, sites[k].d), -1, 1)); if (dd < sep) sep = dd; }
        let hxMax = Math.min(settings.sizeFrac * st.r, 0.5 * settings.gapFrac * st.r * sep);
        // the mirror has to fit where it sits: the envelope may be tight around the LED (an LED on the
        // envelope floor leaves no room below it), so measure the room instead of assuming it.
        const ref0 = V.norm(V.sub(Z, P)), ex0 = V.inPlane(st.n, ref0), ey0 = V.cross(st.n, ex0);
        // Where along this direction does the mirror catch the most light?  Room is not monotone: an
        // LED that hugs a wall leaves no room beside it but plenty further out, while the envelope skin
        // caps the far end.  Try a few radii and keep the best solid angle (hx / rr), ties to the longer
        // lever because it stamps a sharper image.
        const keep1 = keep * (1 + 1e-6), rOut = Math.max(rMin, s.r - settings.inset);
        let best = null;
        for (const q of [1, 1.4, 0.75, 2, 0.5, 0.35]) {
          const rt = clamp(rr * q, rMin, rOut);
          if (rt * Math.max(0.05, st.cos_i) < keep1) continue;       // the patch itself would crowd the LED
          const hxt = fitHx(env, L, s.d, rt, ex0, ey0, hxMax * rt / rr, keep1, envTol);   // smear and packing caps scale with radius
          if (hxt < 0.25) continue;
          const sc2 = hxt / rt;
          if (!best || sc2 > best.sc * 1.05) best = { rr: rt, hx: hxt, sc: sc2 };   // stay put unless clearly better
        }
        if (!best) continue;                                        // no room for a usable mirror here
        rr = best.rr; hxMax = best.hx;
        P = V.add(L, V.mul(s.d, rr)); st = stamp(L, e1, e2, P, Z, T, cell);
        const areaC = 4 * Math.abs(st.a[0] * st.b[1] - st.a[1] * st.b[0]);
        const cd = new Float64Array(R * R);
        if (!rasterStamp(cd, R, st, 6)) continue;
        if (blurHalf > 0) { boxBlur(cd, R, blurHalf, stBox(st, R)); const sb = sum(cd); if (sb > 0) for (let q = 0; q < cd.length; q++) cd[q] /= sb; }
        const catchPerArea = refl * Iper(s.d) * Math.max(0.02, st.cos_i) / (st.r * st.r);
        F.push({ s, rr, P, Z, st, aim, g: gOf[i], ex: ex0, ey: ey0, sep, W: Math.max(settings.minStamp, Math.sqrt(areaC)), hxMax, catchPerArea, phiMax: 4 * hxMax * hxMax * catchPerArea, col: sparsify(cd) });
      }
      if (!F.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };
      const Wmean = F.reduce((a, f) => a + f.W, 0) / F.length;
      // ---- 5. flux per facet: capped non-negative fit, iterated so weak mirrors are not asked
      // for more than they can catch.  One column per aim: the facets stacked on it, mixed in
      // proportion to the light each can actually DELIVER (catch x escape).
      const y = settings.sharp > 0 ? RF.Photometry.boxBlur(paint, R, settings.sharp * Wmean) : Float64Array.from(paint);
      const yTot = sum(y) || 1;                                   // unit total: w is then a flux fraction,
      for (let i = 0; i < y.length; i++) y[i] /= yTot;            // directly comparable with the caps
      let lam = 0, wTot = 0, phi = [], cols = [], live = [], wLast = null;
      const fitPass = (esc) => {
        for (let i = 0; i < F.length; i++) { const f = F[i]; f.esc = esc ? esc[i] : 1; f.catchEff = f.catchPerArea * f.esc; f.phiMax = 4 * f.hxMax * f.hxMax * f.catchEff; }
        const gPhi = new Float64Array(m), gd = [];
        for (let g = 0; g < m; g++) gd.push(new Float64Array(R * R));
        for (const f of F) gPhi[f.g] += f.phiMax;
        for (const f of F) { const q = gPhi[f.g] > 0 ? f.phiMax / gPhi[f.g] : 0, o = gd[f.g]; for (let t = 0; t < f.col.idx.length; t++) o[f.col.idx[t]] += q * f.col.val[t]; }
        live = []; for (let g = 0; g < m; g++) if (gPhi[g] > 0) live.push(g);
        cols = live.map((g) => sparsify(gd[g]));
        phi = live.map((g) => gPhi[g]);
        const gSlot = new Int32Array(m).fill(-1); live.forEach((g, k) => { gSlot[g] = k; });
        let w = new Float64Array(cols.length);
        for (let k = 0; k < cols.length; k++) w[k] = localMean(paint, R, aims[live[k]].ci, aims[live[k]].cj, Wmean) + 1e-6;
        if (settings.flatW) { for (let i = 0; i < w.length; i++) w[i] = 1 / w.length; }
        for (let round = 0; round < (settings.flatW ? 1 : 4); round++) {
          let s2 = 0; for (let i = 0; i < w.length; i++) s2 += w[i];
          const ratios = [];
          for (let i = 0; i < w.length; i++) { const u = w[i] / s2; if (u > 1e-9) ratios.push(phi[i] / u); }
          ratios.sort((p2, q2) => p2 - q2);
          lam = ratios.length ? ratios[clamp(Math.floor(settings.satQ * ratios.length), 0, ratios.length - 1)] : 0;
          if (!isFinite(lam) || lam <= 0) break;
          const cap = new Float64Array(cols.length);
          for (let i = 0; i < cols.length; i++) cap[i] = phi[i] / lam;
          w = isra(cols, y, w, cap, round === 0 ? settings.iters | 0 : 60);
        }
        wLast = w;
        wTot = 0; for (let i = 0; i < w.length; i++) wTot += w[i];
        for (const f of F) {
          const k = gSlot[f.g];
          f.flux = k < 0 ? 0 : Math.min(lam * w[k] / wTot * f.phiMax / phi[k], f.phiMax);
          f.hx = Math.max(0.05, Math.sqrt(f.flux / Math.max(1e-12, f.catchEff)) / 2);
        }
      };
      fitPass(null);
      // A mirror that cannot deliver its share drags the whole array down: the fit scales everything to
      // the weakest.  Prune the hopeless ones and let the survivors run brighter.
      if (settings.pruneQ > 0) {
        const ph = F.filter((f) => !f.drop).map((f) => f.phiMax).sort((a, b) => a - b);
        const med = ph.length ? ph[ph.length >> 1] : 0;
        let pruned = 0;
        if (med > 0) for (const f of F) if (!f.drop && f.phiMax < settings.pruneQ * med) { f.drop = true; pruned++; }
        if (pruned) { fitPass(null); notes.push((settings.dbg ? 'DBG ' : '') + 'pruned ' + pruned + ' mirrors below ' + settings.pruneQ + 'x the median catch'); }
      }
      const escPasses = settings.escPasses === undefined ? 0 : settings.escPasses | 0;
      for (let pass = 0; pass < escPasses; pass++) {
        const e = escapeFracs(F, L);
        if (settings.escDrop > 0) {                              // a mirror that cannot shoot out is dead weight
          let dropped = 0;
          for (let i = 0; i < F.length; i++) if (!F[i].drop && e[i] < settings.escDrop) { F[i].drop = true; dropped++; }
          if (dropped) notes.push((settings.dbg ? 'DBG ' : '') + 'dropped ' + dropped + ' facets whose beam is swallowed by the array (escape < ' + settings.escDrop + ')');
        }
        fitPass(e);
      }
      if (settings.dbg) {
        const w = wLast;
        const seps = F.map((f) => f.sep), hxs = F.map((f) => f.hxMax), phis = phi, us = Array.from(w).map((x) => x / wTot);
        const st = (a) => { const b = a.slice().sort((p2, q2) => p2 - q2); return b[0].toFixed(3) + '/' + b[b.length >> 1].toFixed(3) + '/' + b[b.length - 1].toFixed(3); };
        let arg = 0; for (let i = 1; i < phis.length; i++) if (phis[i] / us[i] < phis[arg] / us[arg]) arg = i;
        notes.push('DBG groups ' + cols.length + ' sep ' + st(seps) + ' hxMax ' + st(hxs) + ' phiG ' + st(phis) + ' u ' + st(us) + ' lam ' + lam.toFixed(1) +
          ' worst g' + arg + ' phi ' + phis[arg].toFixed(2) + ' u ' + us[arg].toFixed(4));
        const es = F.map((f) => f.esc === undefined ? 1 : f.esc);
        notes.push('DBG escape ' + st(es) + ' mean ' + (es.reduce((a, b) => a + b, 0) / es.length).toFixed(3));
        notes.push('DBG phiMax ' + st(F.map((f) => f.phiMax)) + ' hxMax ' + st(F.map((f) => f.hxMax)) + ' hx ' + st(F.map((f) => f.hx)) +
          ' catch ' + st(F.map((f) => f.catchPerArea)) + ' rr ' + st(F.map((f) => f.rr)) + ' sumPhi ' + F.reduce((a, f) => a + f.phiMax, 0).toFixed(0) +
          ' sumFlux ' + F.reduce((a, f) => a + f.flux, 0).toFixed(0));
      }

      // ---- 6. emit, then self-verify against the envelope and the keep-out (geometry only)
      const build = () => F.filter((f) => !f.drop).map((f, i) => {
        f.id = 'M' + i;
        return {
          type: 'facet', id: f.id, group: 'A', P: f.P, S0: L, Z: f.Z, di: defocusDi(f),
          clip: { kind: 'rect', hx: f.hx, hy: f.hx, ref: V.norm(V.sub(f.Z, f.P)) },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        };
      });
      const tol = 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
      const bad = (surfaces) => {
        const G = RF.Geo.compile(surfaces), out = new Set();
        for (let k = 0; k < G.n; k++) for (const poly of RF.Geo.outline(G, k)) for (const p of poly) {
          if (!RF.Geo.envInside(env, p, tol) || V.dist(p, L) < keep * (1 - 1e-6)) out.add(G.metas[k].id);
        }
        return out;
      };
      let surfaces = build(), shrink = 0, pulled = 0;
      for (let pass = 0; pass < 20; pass++) {
        const b = bad(surfaces); if (!b.size) break;
        for (const f of F) if (f.id && b.has(f.id)) {
          f.hx = fitHx(env, L, f.s.d, f.rr, f.ex, f.ey, f.hx * 0.98, keep * (1 + 1e-6), envTol);
          if (f.hx < 0.2) { f.drop = true; continue; }
          if (pass % 3 === 2 && f.rr > rMin + 0.25) { f.rr = Math.max(rMin + 0.2, f.rr - Math.max(0.4, 0.08 * f.rr)); pulled++; }
          f.P = V.add(L, V.mul(f.s.d, f.rr));
        }
        shrink++; surfaces = build();
      }
      const left = bad(surfaces);                                 // never ship a violation
      if (left.size) { for (const f of F) if (f.id && left.has(f.id)) f.drop = true; surfaces = build(); }

      // ---- 7. intent: where each facet's own stamp says its light goes
      const esc = escapeFracs(F, L);
      const intent = [];
      let placed = 0, fluxTot = 0;
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        if (f.drop) { intent.push({ facet: null, cells: [] }); continue; }
        const flux = 4 * f.hx * f.hx * (f.catchEff === undefined ? f.catchPerArea : f.catchEff);
        placed++; fluxTot += flux;
        const col = f.col, cells = [];
        for (let t = 0; t < col.idx.length; t++) if (col.val[t] > 2e-4) cells.push([col.idx[t], flux * col.val[t]]);
        intent.push({ facet: f.id, cells });
      }
      const rs = F.filter((f) => !f.drop).map((f) => f.st.r);
      notes.push(placed + ' facets, r ' + Math.round(Math.min.apply(null, rs)) + '-' + Math.round(Math.max.apply(null, rs)) +
        ' mm (target ' + rTgt.toFixed(0) + '), stamp ~' + Wmean.toFixed(1) + ' cells (want ' + Weff.toFixed(1) + '), ' + aims.length + ' aims in ' + m + ' groups (slots ' + Math.min.apply(null, slots) + '-' + Math.max.apply(null, slots) + '), s ' + sAim.toFixed(2) + ' cells' +
        (shrink ? ', ' + shrink + ' envelope repair passes (' + pulled + ' pulls)' : ''));
      notes.push('modelled catch ' + Math.round(fluxTot) + ' lm of ' + Math.round(src.power) + ' lm (' +
        Math.round(100 * fluxTot / src.power) + '%), facet half-size ' +
        Math.min.apply(null, F.filter((f) => !f.drop).map((f) => f.hx)).toFixed(1) + '-' +
        Math.max.apply(null, F.filter((f) => !f.drop).map((f) => f.hx)).toFixed(1) + ' mm');
      return { surfaces, intent, notes, esc };
  }

  // ---------------------------------------------------------------- the tuner (step 3, optional)
  // The same static algorithm, but this solver MAY trace.  It builds a handful of complete designs that
  // differ only in the knobs the noise-aware model is known to mis-rank (see NOTES.md: defocus, cover x
  // aimScale, areaFrac, aimPad), traces every one with the SAME seed — so the differences between them are
  // geometry, not dice — and keeps whichever serves the goal.
  //   faithful   rank on the app's own fidelity;
  //   throw      rank on throw distance, but only among designs within `floor` of the best fidelity;
  //   efficient  rank on the share of the LED's light that lands on paint, same floor.
  // The floor means a goal can never buy a beam that no longer looks like the painting.
  const TUNE = [
    { label: 'model choice', over: {} },
    { label: 'soft focus', over: { defocus: 8 } },
    { label: 'sharp focus', over: { defocus: 0 } },
    { label: 'aims from box', over: { areaFrac: 0 } },
    { label: 'aim overscan', over: { aimPad: 0.25 } },
    { label: 'big stamps', over: { shapeLock: true, cover: 1.5, aimScale: 1, minTurn: 0.45 } },
    { label: 'small stamps', over: { shapeLock: true, cover: 0.7, aimScale: 1, minTurn: 0.35 } },
    { label: 'packed skin', over: { gapFrac: 1, satQ: 0.02 } },
  ];

  function tuneMetric(goal, tr) {
    const f = (tr && tr.fidelity) || {};
    if (goal === 'throw') return isFinite(tr.throwM) && tr.throwM > 0 ? tr.throwM : 0;
    if (goal === 'efficient') return f.onPaint || 0;
    return f.fidelity || 0;
  }

  RF.Solvers.register({
    id: 'bench-qwen38max-r2--mosaic-auto', name: 'Mosaic (auto)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful - match the painting' },
        { value: 'throw', label: 'Throw - reach as far as it can' },
        { value: 'efficient', label: 'Efficient - most light on the paint' }],
        help: 'What the tuner optimises. Throw and efficiency are only traded against fidelity down to the floor below.' },
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, max: 80, step: 0.5, default: 0, help: 'Extra clearance around the LED, on top of the envelope keep-out.' },
      { key: 'probes', label: 'Designs to trace', type: 'number', min: 1, max: 8, step: 1, default: 6, help: 'How many candidate designs to build and trace; the ray budget is split between them (same seed, so they are compared on equal dice).' },
      { key: 'floor', label: 'Fidelity floor (of best)', type: 'number', min: 0.5, max: 1, step: 0.05, default: 0.85, help: 'For throw/efficient: skip any design scoring below this fraction of the best fidelity on offer.' },
      { key: 'dbg', label: 'Debug notes', type: 'checkbox', default: false },
    ],
    solve(input, settings, tools) {
      const t0 = Date.now();
      const goal = settings.goal || 'faithful';
      const defs = {}; for (const d of SETTINGS) if (d.default !== undefined) defs[d.key] = d.default;
      const base = Object.assign(defs, settings);
      const nC = Math.max(1, Math.min(TUNE.length, Math.round(base.probes || 6)));
      const bud = (tools && tools.budget) || {};
      const raysTot = bud.rays || 1e6, msTot = bud.ms || 0;
      const raysEach = Math.max(20000, Math.min(250000, Math.floor(0.9 * raysTot / nC)));
      const hardMs = (msTot > 0 ? Math.min(msTot, 55000) : 55000) * 0.75;   // leave room for the probe already running
      const rows = [];
      for (let k = 0; k < nC; k++) {
        if (Date.now() - t0 > hardMs) break;                       // never run into the 60 s wall
        if (tools && tools.progress) tools.progress(0.9 * (k + 0.3) / nC);
        const cand = TUNE[k], cfg = Object.assign({}, base, cand.over);
        let out = null; try { out = bestOf(input, cfg, tools); } catch (e) { out = null; }
        if (!out || !out.surfaces || !out.surfaces.length) { rows.push({ cand: cand, out: out, tr: null }); continue; }
        let tr = null;
        if (Date.now() - t0 <= hardMs) { try { tr = tools.trace(out.surfaces, { rays: raysEach, seed: input.seed }); } catch (e) { tr = null; } }
        rows.push({ cand: cand, out: out, tr: tr });
      }
      const built = rows.filter((r) => r.out && r.out.surfaces && r.out.surfaces.length);
      if (!built.length) return { surfaces: [], intent: [], notes: ['tuner: no candidate design could be built'] };
      let fBest = 0;
      for (const r of rows) if (r.tr && r.tr.fidelity) fBest = Math.max(fBest, r.tr.fidelity.fidelity || 0);
      const fl = clamp(base.floor === undefined ? 0.85 : base.floor, 0, 1);
      let pick = -1, pickV = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; if (!r.tr || !r.tr.fidelity) continue;
        if (goal !== 'faithful' && (r.tr.fidelity.fidelity || 0) < fl * fBest) continue;
        const v = tuneMetric(goal, r.tr);
        if (v > pickV) { pickV = v; pick = i; }
      }
      if (pick < 0) for (let i = 0; i < rows.length; i++) {          // nothing cleared the floor: be faithful
        const r = rows[i]; if (!r.tr || !r.tr.fidelity) continue;
        const v = r.tr.fidelity.fidelity || 0; if (v > pickV) { pickV = v; pick = i; }
      }
      if (pick < 0) for (let i = 0; i < rows.length; i++) if (rows[i].out && rows[i].out.surfaces && rows[i].out.surfaces.length) { pick = i; break; }
      const w = rows[pick], notes = ((w.out && w.out.notes) || []).slice();
      const nt = rows.filter((r) => r.tr && r.tr.fidelity).length;
      notes.push('tuner goal "' + goal + '": traced ' + nt + ' of ' + rows.length + ' designs at ' +
        Math.round(raysEach / 1000) + 'k rays each (one seed), picked "' + w.cand.label + '"' +
        (w.tr && w.tr.fidelity ? ' - fidelity ' + (100 * w.tr.fidelity.fidelity).toFixed(1) + '%, on paint ' +
        (100 * (w.tr.fidelity.onPaint || 0)).toFixed(1) + '%, peak ' + Math.round(w.tr.peakCd || 0) + ' cd, throw ' +
        Math.round(w.tr.throwM || 0) + ' m' : '') + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      if (base.dbg) for (const r of rows) notes.push('  probe "' + r.cand.label + '": ' + (r.tr && r.tr.fidelity ?
        'fid ' + (100 * r.tr.fidelity.fidelity).toFixed(1) + '% (within ' + (100 * r.tr.fidelity.within).toFixed(1) +
        '% gaps ' + (100 * r.tr.fidelity.gapsDark).toFixed(1) + '%) onPaint ' + (100 * (r.tr.fidelity.onPaint || 0)).toFixed(1) +
        '% peak ' + Math.round(r.tr.peakCd || 0) + ' cd throw ' + Math.round(r.tr.throwM || 0) + ' m' + (r === w ? '  <== picked' : '') :
        (r.out && r.out.surfaces && r.out.surfaces.length ? 'built, not traced' : 'no design')));
      if (tools && tools.progress) tools.progress(1);
      return { surfaces: w.out.surfaces, intent: w.out.intent || [], notes: notes };
    },
  });

  root.__mosaicHelpers = { paintComponents, escapeFracs, ledExtents, intensityFn, intensityPerSr, rSkin, stamp, rasterStamp, xSpan, clamp, sum, fibDirs, candidateSites, selectSites, aimGrid, isra, paintBox, localMean, sparsify };
})(typeof globalThis !== 'undefined' ? globalThis : this);
