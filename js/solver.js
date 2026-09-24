/* solver.js — shared optics for the inverse modes: the first-order TILE MODEL, facet construction
 * from design intent, curvature (vergence) solve for a requested tile size, direction maps, and
 * the flux-weighted zone partition of a painted target.
 *
 * TILE MODEL (first order, used by the solvers and the feasibility report; the ray tracer is what
 * produces the actual picture).  A facet's tile on the target is the image of the source convolved
 * with the facet's aperture footprint.  Linearising the exact reflection about the chief ray:
 *   Σ_tile = J_A Σ_A J_Aᵀ + J_S Σ_S J_Sᵀ
 * J_A = ∂(landing u,v)/∂(aperture x,y) for rays from the source centre (exact curved normals);
 * J_S = ∂(landing)/∂(source point) for chief rays through the facet centre;
 * Σ_A, Σ_S = covariances of the uniform aperture and of the sampled emitter.
 * For a flat facet in the far field this reduces to (a + s)·m with m = d_target/d_source; a curved
 * facet changes J_A (focusing drives it to 0) and leaves J_S — the source image — in place, which
 * is exactly why the minimum tile is the magnified source.  Jacobians are central differences on
 * the exact geometry, so obliquity, tilt and curvature are carried, not assumed.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, Geo } = RF;
  const E = () => RF.Engine;

  // ---------------------------------------------------------------- facet surface helpers
  function facetFrame(fq, ref) { const ex = V.inPlane(fq.n, ref || null); return { ex, ey: V.cross(fq.n, ex) }; }
  function mulA(A, x) { return [A[0] * x[0] + A[1] * x[1] + A[2] * x[2], A[3] * x[0] + A[4] * x[1] + A[5] * x[2], A[6] * x[0] + A[7] * x[1] + A[8] * x[2]]; }
  // Point & unit normal (oriented to fq.n) on the facet surface above local (x, y)
  function surfPoint(fq, P, ex, ey, x, y) {
    const base = [P[0] + ex[0] * x + ey[0] * y, P[1] + ex[1] * x + ey[1] * y, P[2] + ex[2] * x + ey[2] * y];
    if (fq.flat) return { X: base, n: fq.n };
    const roots = Geo.quadricRay(fq.A, fq.b, P, base, fq.n);
    if (!roots.length) return null;
    const z = roots.reduce((m, t) => (Math.abs(t) < Math.abs(m) ? t : m), Infinity);
    const X = V.madd(base, fq.n, z);
    let g = V.add(V.mul(mulA(fq.A, V.sub(X, P)), 2), fq.b);
    g = V.norm(g); if (V.dot(g, fq.n) < 0) g = V.neg(g);
    return { X, n: g };
  }
  // Landing (u, v) on the target plane of the ray Sp → X reflected about normal nrm
  function land(T, Sp, X, nrm) {
    const d = V.norm(V.sub(X, Sp)), r = V.reflect(d, nrm);
    const den = V.dot(r, T.n);
    if (!(den < 0)) return null;
    const t = V.dot(V.sub(T.C, X), T.n) / den;
    return E().worldToTargetUV(T, V.madd(X, r, t));
  }

  /* f = { P, S0, Z, flat, di, apCov:[cxx,cxy,cyy] (facet frame), ref }  src = scene.source
   * Returns { ok, center:[u,v], cov:[uu,uv,vv], covA, covS, sigma, sigmaA, sigmaS }          */
  function tileModel(T, src, f) {
    const fq = Geo.facetQuadric(f.P, f.S0, f.Z, f.flat ? null : f.di);
    const { ex, ey } = facetFrame(fq, f.ref);
    const rs = V.dist(f.P, f.S0);
    const h = 1e-4 * Math.max(rs, 1e-300);
    const c0 = surfPoint(fq, f.P, ex, ey, 0, 0);
    const L0 = land(T, f.S0, c0.X, c0.n);
    if (!L0) return { ok: false };
    const lx = (x, y) => { const s = surfPoint(fq, f.P, ex, ey, x, y); return s && land(T, f.S0, s.X, s.n); };
    const a1 = lx(h, 0), a2 = lx(-h, 0), b1 = lx(0, h), b2 = lx(0, -h);
    if (!a1 || !a2 || !b1 || !b2) return { ok: false };
    const JA = [[(a1[0] - a2[0]) / (2 * h), (b1[0] - b2[0]) / (2 * h)], [(a1[1] - a2[1]) / (2 * h), (b1[1] - b2[1]) / (2 * h)]];
    const JS = [[0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < 3; a++) {
      const d = [0, 0, 0]; d[a] = h;
      const p1 = land(T, V.add(f.S0, d), c0.X, c0.n), p2 = land(T, V.sub(f.S0, d), c0.X, c0.n);
      if (!p1 || !p2) return { ok: false };
      JS[0][a] = (p1[0] - p2[0]) / (2 * h); JS[1][a] = (p1[1] - p2[1]) / (2 * h);
    }
    const ca = f.apCov || [0, 0, 0];
    const SA = [[ca[0], ca[1]], [ca[1], ca[2]]];
    const covA = congruent2(JA, SA);
    const SS = RF.Source.extentCov(src);
    const covS = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const s = SS[3 * i + j]; if (!s) continue;
      covS[0] += JS[0][i] * s * JS[0][j]; covS[1] += JS[0][i] * s * JS[1][j]; covS[2] += JS[1][i] * s * JS[1][j];
    }
    const cov = [covA[0] + covS[0], covA[1] + covS[1], covA[2] + covS[2]];
    const sig = (c) => Math.sqrt(Math.max(0, (c[0] + c[2]) / 2));
    return { ok: true, center: L0, cov, covA, covS, sigma: sig(cov), sigmaA: sig(covA), sigmaS: sig(covS), JA, n: fq.n, ex, ey };
  }
  function congruent2(J, S) {      // J S Jᵀ for 2×2
    const a = J[0][0] * S[0][0] + J[0][1] * S[1][0], b = J[0][0] * S[0][1] + J[0][1] * S[1][1];
    const c = J[1][0] * S[0][0] + J[1][1] * S[1][0], d = J[1][0] * S[0][1] + J[1][1] * S[1][1];
    return [a * J[0][0] + b * J[0][1], a * J[1][0] + b * J[1][1], c * J[1][0] + d * J[1][1]];
  }
  // Aperture covariance from a clip in the facet frame
  function apertureCov(clip, P, ex, ey) {
    if (clip.kind === 'rect') return [clip.hx * clip.hx / 3, 0, clip.hy * clip.hy / 3];
    if (clip.kind === 'disc') return [clip.r * clip.r / 4, 0, clip.r * clip.r / 4];
    const pts = clip.pts3.map((q) => { const d = V.sub(q, P); return [V.dot(d, ex), V.dot(d, ey)]; });
    const m = RF.U.polyMoments(pts);
    // moments about the facet centre P (not the polygon centroid): add the offset
    return [m.cxx + m.cx * m.cx, m.cxy + m.cx * m.cy, m.cyy + m.cy * m.cy];
  }

  /* Choose the image distance di of a curved (ellipsoidal) facet so its tile sigma matches
   * sigmaT.  Vergence w = 1/di.  w = 0: paraboloid (collimating).  w = 1/|Z−P|: the source centre
   * is imaged onto the aim point — smallest tile, = the magnified source.  w beyond that: crossed
   * focus, tile grows again.  Convex (diverging) facets are not generated; the crossed branch
   * reaches every larger tile size instead.                                                   */
  function solveVergence(T, src, f, sigmaT) {
    const dt = V.dist(f.P, f.Z);
    const at = (w) => tileModel(T, src, Object.assign({}, f, { flat: false, di: w === 0 ? Infinity : 1 / w }));
    const wF = 1 / dt;
    const mF = at(wF);
    if (!mF.ok) return { ok: false };
    if (sigmaT <= mF.sigma) return { ok: true, di: dt, sigma: mF.sigma, clamped: true, sigmaMin: mF.sigma, branch: 'focus' };
    const m0 = at(0);
    let lo, hi, branch;
    if (m0.ok && sigmaT <= m0.sigma) { lo = 0; hi = wF; branch = 'uncrossed'; }       // σ decreasing in w
    else {
      branch = 'crossed'; lo = wF; hi = wF * 2;
      let guard = 0;
      while (at(hi).ok && at(hi).sigma < sigmaT && guard++ < 60) hi *= 2;
    }
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi), m = at(mid);
      const s = m.ok ? m.sigma : Infinity;
      if (branch === 'uncrossed') { if (s > sigmaT) lo = mid; else hi = mid; }
      else { if (s < sigmaT) lo = mid; else hi = mid; }
    }
    const w = 0.5 * (lo + hi), m = at(w);
    return { ok: m.ok, di: w === 0 ? Infinity : 1 / w, sigma: m.sigma, clamped: false, sigmaMin: mF.sigma, branch };
  }

  // ---------------------------------------------------------------- direction frames
  // Polar frame around w0 with e1, e2 aligned to the target's u, v where possible.
  function polarFrame(w0, T) {
    let e1 = V.sub(T.tu, V.mul(w0, V.dot(T.tu, w0)));
    if (V.len(e1) < 1e-6) e1 = V.basis(w0)[0];
    e1 = V.norm(e1);
    const e2 = V.cross(w0, e1);
    // keep e2 roughly along +v so "up in the reflector" means "up on the target"
    if (V.dot(e2, T.tv) < 0) return { w0, e1: V.neg(e1), e2: V.neg(e2) };
    return { w0, e1, e2 };
  }
  function dirOf(F, th, ph) {
    const s = Math.sin(th), c = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
    return [c * F.w0[0] + s * (cp * F.e1[0] + sp * F.e2[0]), c * F.w0[1] + s * (cp * F.e1[1] + sp * F.e2[1]), c * F.w0[2] + s * (cp * F.e1[2] + sp * F.e2[2])];
  }
  // Azimuthal equal-area map of a direction around w0 → (p, q)
  function areaMap(F, d) {
    const th = Math.acos(Math.max(-1, Math.min(1, V.dot(d, F.w0))));
    const ph = Math.atan2(V.dot(d, F.e2), V.dot(d, F.e1));
    const r = 2 * Math.sin(th / 2);
    return [r * Math.cos(ph), r * Math.sin(ph)];
  }
  // Relative intensity toward world direction d (the source's actual distribution)
  function intensityToward(src, fr, d) {
    const c = Math.max(-1, Math.min(1, V.dot(d, fr.a)));
    return RF.Source.intensity(src, Math.acos(c));
  }

  // ---------------------------------------------------------------- painted pattern analysis
  function paintInfo(scene) {
    const T = E().designFrame(scene.target), res = T.res, paint = scene.modeA.paint;
    const cell = 2 * T.half / res;
    let sum = 0, su = 0, sv = 0, n = 0;
    const cells = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = paint[j * res + i];
      if (w > 0) { const [u, v] = E().cellCenter(T, i, j); cells.push({ i, j, u, v, w, idx: j * res + i }); sum += w; su += w * u; sv += w * v; n++; }
    }
    return { T, res, cell, cells, sum, n, cu: sum ? su / sum : 0, cv: sum ? sv / sum : 0, paintAt: (i, j) => paint[j * res + i] };
  }

  /* Sequential equal-flux partition (semi-discrete transport, orientation preserving).
   * items: facets [{w, p, q}] (w = the facet's actual intercepted flux).  Painted cells are split
   * into columns by u holding the same flux fractions as the facet columns sorted by p, then each
   * column into rows by v matching the facets sorted by q.  A cell straddling a cut is shared
   * fractionally, so every zone receives exactly its facet's share of the painted flux.       */
  function partitionZones(items, info) {
    const N = items.length;
    if (!N || !info.cells.length) return [];
    const ncol = Math.max(1, Math.round(Math.sqrt(N)));
    const order = items.map((it, k) => k).sort((a, b) => items[a].p - items[b].p || items[a].q - items[b].q || a - b);
    const cols = [];
    for (let c = 0; c < ncol; c++) {
      const a = Math.floor(c * N / ncol), b = Math.floor((c + 1) * N / ncol);
      const ks = order.slice(a, b).sort((x, y) => items[x].q - items[y].q || items[x].p - items[y].p || x - y);
      if (ks.length) cols.push(ks);
    }
    const Wf = items.reduce((s, it) => s + it.w, 0);
    const cells = info.cells.slice().sort((a, b) => a.u - b.u || a.v - b.v);
    const total = info.sum;
    const zones = new Array(N);
    // split a weighted, sorted list into consecutive chunks with target weights
    function split(list, targets) {
      const out = targets.map(() => []);
      let t = 0, acc = 0, tgt = targets[0];
      for (const c of list) {
        let rem = c.w;
        while (rem > 1e-15 * total) {
          if (t >= targets.length - 1) { out[targets.length - 1].push(Object.assign({}, c, { w: rem })); rem = 0; break; }
          const room = tgt - acc;
          if (rem <= room) { out[t].push(Object.assign({}, c, { w: rem })); acc += rem; rem = 0; }
          else { if (room > 0) out[t].push(Object.assign({}, c, { w: room })); rem -= Math.max(0, room); t++; acc = 0; tgt = targets[t]; }
        }
      }
      return out;
    }
    const colW = cols.map((ks) => ks.reduce((s, k) => s + items[k].w, 0) / Wf * total);
    const colCells = split(cells, colW);
    cols.forEach((ks, ci) => {
      const cc = colCells[ci].sort((a, b) => a.v - b.v || a.u - b.u);
      const rowW = ks.map((k) => items[k].w / Wf * total);
      const rows = split(cc, rowW);
      ks.forEach((k, ri) => { zones[k] = zoneStats(rows[ri], info); });
    });
    return zones;
  }
  function zoneStats(list, info) {
    let W = 0, u = 0, v = 0;
    for (const c of list) { W += c.w; u += c.w * c.u; v += c.w * c.v; }
    if (W <= 0) return { empty: true, cells: [], W: 0 };
    u /= W; v /= W;
    let uu = 0, uv = 0, vv = 0;
    for (const c of list) { uu += c.w * (c.u - u) ** 2; uv += c.w * (c.u - u) * (c.v - v); vv += c.w * (c.v - v) ** 2; }
    const cs = info.cell * info.cell / 12;             // a cell's own extent
    uu = uu / W + cs; vv = vv / W + cs; uv /= W;
    // aim at the centroid unless it falls on an unpainted cell: then the nearest painted member
    let aim = [u, v];
    const res = info.res, ci = Math.floor((u + info.T.half) / info.cell), cj = Math.floor((v + info.T.half) / info.cell);
    const painted = ci >= 0 && cj >= 0 && ci < res && cj < res && info.paintAt(ci, cj) > 0;
    if (!painted) {
      let best = Infinity;
      for (const c of list) { const d = (c.u - u) ** 2 + (c.v - v) ** 2; if (d < best) { best = d; aim = [c.u, c.v]; } }
    }
    return { cells: list, W, centroid: [u, v], aim, cov: [uu, uv, vv], sigma: Math.sqrt((uu + vv) / 2) };
  }

  RF.Solver = {
    facetFrame, surfPoint, land, tileModel, apertureCov, solveVergence,
    polarFrame, dirOf, areaMap, intensityToward, paintInfo, partitionZones,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
