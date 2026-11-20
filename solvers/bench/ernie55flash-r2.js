/* Flux — a static, paint-driven faceted-reflector solver.
 *
 * Physics used (all analytic, no rays):
 *   A facet is an ellipsoid with foci at the LED and at its aim point, so it images the LED onto the aim.
 *   The image is the LED itself magnified by m = (facet→aim)/(LED→facet): a sharp-edged copy of the LED,
 *   so a facet paints a uniform patch of side w = m·s (s = LED size) centred on its aim; its area A sets
 *   how much flux it delivers:  Φ = power·A·cosθ_emit·cosθ_inc/(π·r²).
 *
 * Design:
 *   1. goal = the painting blurred by the smallest image the LED can make (the physics' resolution limit);
 *   2. facets sit on a sphere around the LED, on the cap facing away from the target (their beams leave
 *      through the empty front, so they cannot hit each other), spread uniformly so the patches do not
 *      overlap; the radius is the largest one that still leaves enough spot coverage and flux;
 *   3. equal-flux aims from a weighted k-means of the painting, then an EM refinement: every facet's aim
 *      moves to the centroid of the painted mass it actually lights (this aligns the spot edges with the
 *      painting's edges and kills the spill);
 *   4. a box-constrained non-negative least squares for the facet fluxes (0 ≤ Φ ≤ what its patch can catch),
 *      scaled up to the area limit (fidelity is scale-invariant; the light/peak scores improve).
 */
(function () {
  'use strict';
  const RF = (typeof globalThis !== 'undefined' ? globalThis : this).RF;
  if (!RF || !RF.Solvers) return;
  const V = RF.V;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /* ------------------------------------------------------------------ envelope helpers */
  function maxPatch(env, P, n, ref, margin) {
    const ex = V.inPlane(n, ref || [0, 0, 1]), ey = cross(n, ex);
    const sgn = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    if (env.shape === 'box') {
      const c = env.center, h = env.half;
      let t = Infinity;
      for (const s of sgn) {
        const d = [s[0] * ex[0] + s[1] * ey[0], s[0] * ex[1] + s[1] * ey[1], s[0] * ex[2] + s[1] * ey[2]];
        for (let i = 0; i < 3; i++) {
          const di = d[i], pi = P[i] - c[i];
          if (Math.abs(di) < 1e-12) { if (Math.abs(pi) > h[i]) return 0; continue; }
          const ti = di > 0 ? (h[i] - pi) / di : (-h[i] - pi) / di;
          if (ti < t) t = ti;
        }
      }
      return Math.max(0, t - margin);
    }
    const inside = (hh) => {
      for (const s of sgn) {
        const p = [P[0] + hh * (s[0] * ex[0] + s[1] * ey[0]), P[1] + hh * (s[0] * ex[1] + s[1] * ey[1]), P[2] + hh * (s[0] * ex[2] + s[1] * ey[2])];
        if (!RF.Geo.envInside(env, p, 0)) return false;
      }
      return true;
    };
    if (!inside(0)) return 0;
    let lo = 0, hi = 1;
    while (hi < 1e5 && inside(hi)) { lo = hi; hi *= 2; }
    for (let k = 0; k < 28; k++) { const m = 0.5 * (lo + hi); if (inside(m)) lo = m; else hi = m; }
    return Math.max(0, lo - margin);
  }

  /* ------------------------------------------------------------------ distance transform (chamfer 3-4) */
  function paintDistance(paint, R) {
    const INF = 1e9, d = new Float64Array(R * R);
    for (let k = 0; k < R * R; k++) d[k] = paint[k] > 0 ? INF : 0;
    const D1 = 1, D2 = Math.SQRT2;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i; if (d[k] === 0) continue;
      let m = d[k];
      if (i > 0) m = Math.min(m, d[k - 1] + D1);
      if (j > 0) { m = Math.min(m, d[k - R] + D1); if (i > 0) m = Math.min(m, d[k - R - 1] + D2); if (i < R - 1) m = Math.min(m, d[k - R + 1] + D2); }
      d[k] = m;
    }
    for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) {
      const k = j * R + i; if (d[k] === 0) continue;
      let m = d[k];
      if (i < R - 1) m = Math.min(m, d[k + 1] + D1);
      if (j < R - 1) { m = Math.min(m, d[k + R] + D1); if (i < R - 1) m = Math.min(m, d[k + R + 1] + D2); if (i > 0) m = Math.min(m, d[k + R - 1] + D2); }
      d[k] = m;
    }
    return d;
  }

  /* ------------------------------------------------------------------ weighted k-means (equal mass) */
  function kmeans(pts, N, rnd) {
    const n = pts.length;
    if (!n) return [];
    N = Math.min(N, n);
    const cen = [], d2 = new Float64Array(n).fill(Infinity);
    let first = 0, best = -1;
    for (let i = 0; i < n; i++) if (pts[i].w > best) { best = pts[i].w; first = i; }
    cen.push({ u: pts[first].u, v: pts[first].v });
    const used = new Uint8Array(n); used[first] = 1;
    for (let c = 1; c < N; c++) {
      let tot = 0;
      const last = cen[c - 1];
      for (let i = 0; i < n; i++) {
        const dx = pts[i].u - last.u, dy = pts[i].v - last.v, d = dx * dx + dy * dy;
        if (d < d2[i]) d2[i] = d;
        tot += pts[i].w * d2[i];
      }
      let pick = -1;
      if (tot > 0) { let t = rnd() * tot; for (let i = 0; i < n; i++) { t -= pts[i].w * d2[i]; if (t <= 0) { pick = i; break; } } }
      if (pick < 0 || used[pick] || d2[pick] <= 0) {
        let bd = -1;
        for (let i = 0; i < n; i++) if (!used[i] && d2[i] > bd) { bd = d2[i]; pick = i; }
      }
      if (pick < 0) for (let i = 0; i < n; i++) if (!used[i]) { pick = i; break; }
      if (pick < 0) break;
      used[pick] = 1;
      cen.push({ u: pts[pick].u, v: pts[pick].v });
    }
    const assign = new Int32Array(n).fill(-1);
    const Nc = cen.length;
    for (let it = 0; it < 30; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < Nc; j++) {
          const dx = pts[i].u - cen[j].u, dy = pts[i].v - cen[j].v, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bj = j; }
        }
        if (assign[i] !== bj) { assign[i] = bj; changed = true; }
      }
      const su = new Float64Array(Nc), sv = new Float64Array(Nc), sw = new Float64Array(Nc);
      for (let i = 0; i < n; i++) { const j = assign[i], w = pts[i].w; su[j] += w * pts[i].u; sv[j] += w * pts[i].v; sw[j] += w; }
      for (let j = 0; j < Nc; j++) if (sw[j] > 0) { cen[j].u = su[j] / sw[j]; cen[j].v = sv[j] / sw[j]; }
      if (!changed && it > 3) break;
    }
    const out = [];
    for (let j = 0; j < Nc; j++) {
      const cells = []; let mass = 0;
      for (let i = 0; i < n; i++) if (assign[i] === j) { cells.push(i); mass += pts[i].w; }
      if (cells.length) out.push({ u: cen[j].u, v: cen[j].v, mass, cells });
    }
    return out;
  }

  /* ------------------------------------------------------------------ main */
  function solve(input, settings) {
    settings = settings || {};
    const src = input.source, env = input.envelope, tgt = input.target;
    const power = Math.max(1e-9, src.power || 1);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const margin = settings.margin !== undefined ? settings.margin : 0.3;
    const gapWeight = settings.gapWeight !== undefined ? settings.gapWeight : 0.15;
    const spotScale = settings.spotScale !== undefined ? settings.spotScale : 0.9;
    const covGoal = settings.covGoal !== undefined ? settings.covGoal : 1.5;
    const tileFill = settings.tileFill !== undefined ? settings.tileFill : 0.55;
    const fillGoal = settings.fillGoal !== undefined ? settings.fillGoal : 0.05;
    let emIters = settings.emIters !== undefined ? settings.emIters : 4;
    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;

    const T = RF.Engine.targetFrame(tgt);
    const R = T.res, half = T.half, cell = (2 * half) / R;
    const tu = T.tu, tv = T.tv, C = T.C;
    const toWorld = (u, v) => [C[0] + tu[0] * u + tv[0] * v, C[1] + tu[1] * u + tv[1] * v, C[2] + tu[2] * u + tv[2] * v];

    const paint = input.paint.cells;
    const ker = RF.Photometry.achievableKernel({ source: src, target: tgt, envelope: env });
    const kern = Math.max(0.35, ker.cells || 0.35);
    const goal = RF.Photometry.boxBlur(Float64Array.from(paint), R, kern);

    const ptsAll = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = paint[j * R + i];
      if (w > 0) ptsAll.push({ u: -half + (i + 0.5) * cell, v: -half + (j + 0.5) * cell, w, k: j * R + i });
    }
    const totalPaint = ptsAll.reduce((s, p) => s + p.w, 0);
    if (!ptsAll.length || !(totalPaint > 0)) return { surfaces: [], intent: [], notes: ['no paint'] };

    // LED image / flux model
    const axis = V.norm(src.axis), fr = RF.Source.frame(src);
    const lw = (src.shape === 'disc' || src.shape === 'sphere') ? 2 * (src.radius || 1) : (src.w || 1);
    const lh = (src.shape === 'disc' || src.shape === 'sphere') ? 2 * (src.radius || 1) : (src.h || 1);
    const sEff = Math.sqrt(lw * lh);
    const paintArea = ptsAll.length * cell * cell;
    const D = Math.max(1, tgt.distance);

    const aim0 = [tgt.distance, 0, 0];
    const xMax = settings.xMax !== undefined ? settings.xMax : -0.02;

    function capAt(r) {
      const out = [];
      const M = 6000;
      for (let i = 0; i < M; i++) {
        const z = 1 - 2 * (i + 0.5) / M, sr = Math.sqrt(Math.max(0, 1 - z * z)), ph = i * 2.39996323;
        const u = [axis[0] * z + sr * (Math.cos(ph) * fr.u[0] + Math.sin(ph) * fr.v[0]),
                   axis[1] * z + sr * (Math.cos(ph) * fr.u[1] + Math.sin(ph) * fr.v[1]),
                   axis[2] * z + sr * (Math.cos(ph) * fr.u[2] + Math.sin(ph) * fr.v[2])];
        const emit = dot(u, axis);
        if (emit < 0.08) continue;
        if (u[0] > xMax) continue;                    // the front cannot aim forward and blocks the rest
        let rr = r;
        if (settings.place === 'boundary') {
          const iv = RF.Geo.envInterval(env, src.pos, u);
          if (!(iv[0] <= iv[1]) || iv[0] > 0) continue;
          rr = iv[1] - margin;
          if (rr < keep + margin) continue;
        }
        const P = [src.pos[0] + u[0] * rr, src.pos[1] + u[1] * rr, src.pos[2] + u[2] * rr];
        if (!RF.Geo.envInside(env, P, 0)) continue;
        const s = [-u[0], -u[1], -u[2]];
        const a = unit(sub(aim0, P));
        const n = unit([s[0] + a[0], s[1] + a[1], s[2] + a[2]]);
        const cosF = dot(n, s);
        if (cosF < 0.12) continue;
        const q = emit * cosF;
        if (q < 0.1) continue;
        const hmax = maxPatch(env, P, n, tu, margin);
        if (hmax < 0.4) continue;
        out.push({ u, P, emit, cosF, q, hmax, r: rr });
      }
      return out;
    }

    // farthest envelope point from the LED in the upper hemisphere
    let rAbsolute = 0;
    for (let i = 0; i < 4000; i++) {
      const z = 1 - 2 * (i + 0.5) / 4000, rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = i * 2.39996323;
      const u = [axis[0] * z + rr * (Math.cos(ph) * fr.u[0] + Math.sin(ph) * fr.v[0]),
                 axis[1] * z + rr * (Math.cos(ph) * fr.u[1] + Math.sin(ph) * fr.v[1]),
                 axis[2] * z + rr * (Math.cos(ph) * fr.u[2] + Math.sin(ph) * fr.v[2])];
      if (dot(u, axis) < 0.1) continue;
      const iv = RF.Geo.envInterval(env, src.pos, u);
      if (iv[0] <= iv[1] && iv[1] > rAbsolute) rAbsolute = iv[1];
    }
    const N = Math.min(maxFacets, ptsAll.length);
    let rCov = rAbsolute;
    {
      const targetW = Math.sqrt(covGoal * paintArea / Math.max(1, N));
      const den = targetW - 0.5 * spotScale * sEff;
      rCov = den > 1e-6 ? spotScale * sEff * D / den : rAbsolute;
    }
    const rTry = Math.max(5, Math.min(rAbsolute - margin, rCov));

    const areaAt = (rr) => {
      const c = capAt(rr);
      if (c.length < N) return null;
      let r2sum = 0;
      for (const q of c) r2sum += q.r * q.r;
      const capArea = 4 * Math.PI / 6000 * r2sum;
      const hT = 0.5 * tileFill * Math.sqrt(capArea / Math.max(1, N));
      const step = Math.max(1, Math.floor(c.length / N));
      let tot = 0;
      for (let i = 0; i < c.length && i / step < N; i += step) {
        const q = Math.max(0.02, c[i].q);
        tot += power * 4 * hT * hT * q / (Math.PI * c[i].r * c[i].r);
      }
      return { c, capArea, hT, tot };
    };
    let chosen = null, rUsed = rTry;
    if (settings.place === 'boundary') {
      const a = areaAt(rTry);
      if (a) chosen = a;
    }
    if (!chosen && settings.sphere && settings.sphere > 0) { const a = areaAt(settings.sphere); if (a) { chosen = a; rUsed = settings.sphere; } }
    if (!chosen && settings.place !== 'boundary') {
      for (let k = 0; k < 16 && !chosen; k++) {
        const rr = rTry * (1 - 0.06 * k);
        if (rr < keep + 2 * margin) break;
        const a = areaAt(rr);
        if (a && a.tot >= fillGoal * power) { chosen = a; rUsed = rr; }
      }
    }
    if (!chosen && settings.place !== 'boundary') for (let k = 0; k < 16 && !chosen; k++) {
      const rr = rTry * (1 - 0.06 * k);
      if (rr < keep + 2 * margin) break;
      const a = areaAt(rr); if (a) { chosen = a; rUsed = rr; }
    }
    if (!chosen || !chosen.c.length) return { surfaces: [], intent: [], notes: ['no usable facet positions'] };

    // ---- aims
    const dist = paintDistance(paint, R);
    const rnd = mulberry32((input.seed | 0) || 12345);
    let aims0 = [];
    let useGrid = settings.aimMode === 'grid';
    if (settings.aimMode === 'auto' || settings.aimMode === undefined) {
      const w0 = spotScale * sEff * (D + 0.5 * rUsed) / rUsed;
      let g = Math.max(2, Math.min(12, Math.round(w0 / cell)));
      let nb = 0;
      for (let j0 = 0; j0 < R; j0 += g) for (let i0 = 0; i0 < R; i0 += g) {
        let any = 0;
        for (let j = j0; j < Math.min(R, j0 + g); j++) for (let i = i0; i < Math.min(R, i0 + g); i++) if (paint[j * R + i] > 0) any = 1;
        nb += any;
      }
      useGrid = nb >= 0.6 * N;
    }
    if (useGrid) {
      // block aims: tile the painting with (g×g)-cell blocks aligned to the cell grid, so the
      // spots' edges land on cell boundaries and the block average is the best g-cell approximation
      const w0 = spotScale * sEff * (D + 0.5 * rUsed) / rUsed;
      let g = Math.max(2, Math.round(w0 / cell));
      if (g % 2) g++;
      g = Math.min(g, 8);
      const blocks = [];
      for (let j0 = 0; j0 < R; j0 += g) for (let i0 = 0; i0 < R; i0 += g) {
        let mass = 0, su = 0, sv = 0;
        for (let j = j0; j < Math.min(R, j0 + g); j++) for (let i = i0; i < Math.min(R, i0 + g); i++) {
          const w = paint[j * R + i];
          if (w > 0) { mass += w; su += w * (-half + (i + 0.5) * cell); sv += w * (-half + (j + 0.5) * cell); }
        }
        if (mass > 0) blocks.push({ u: su / mass, v: sv / mass, mass, cells: [] });
      }
      blocks.sort((a, b) => b.mass - a.mass);
      aims0 = blocks.slice(0, N);
    } else {
      const clusters = kmeans(ptsAll, N, rnd);
      aims0 = clusters.filter((c) => c.mass > 0 && c.cells.length > 0).map((c) => ({ u: c.u, v: c.v, mass: c.mass, cells: c.cells }));
    }
    // push the aims in by half a spot so the spot edges (sharp: the LED image) land on the painting's edge
    if (!useGrid) {
      const w0 = spotScale * sEff * (D + 0.5 * rUsed) / rUsed;
      const need = w0 / (2 * cell);
      for (const a of aims0) {
        const ci = clamp(Math.round((a.v + half) / cell - 0.5), 0, R - 1), cj = clamp(Math.round((a.u + half) / cell - 0.5), 0, R - 1);
        const k = cj * R + ci, d = dist[k];
        if (d >= need || d <= 0) continue;
        const gx = (dist[cj * R + Math.min(R - 1, ci + 1)] - dist[cj * R + Math.max(0, ci - 1)]) / 2;
        const gy = (dist[Math.min(R - 1, cj + 1) * R + ci] - dist[Math.max(0, cj - 1) * R + ci]) / 2;
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-6) continue;
        const du = (gx / gl) * (need - d) * cell, dv = (gy / gl) * (need - d) * cell;
        a.u = clamp(a.u + du, -half + 0.1 * cell, half - 0.1 * cell);
        a.v = clamp(a.v + dv, -half + 0.1 * cell, half - 0.1 * cell);
      }
    }
    if (!aims0.length) return { surfaces: [], intent: [], notes: ['no aims'] };
    const NA = aims0.length;
    const hTile = chosen.hT || 1;
    const step = Math.max(1, Math.floor(chosen.c.length / NA));
    const pos = [];
    for (let i = 0; i < chosen.c.length && pos.length < NA; i += step) pos.push(chosen.c[i]);
    const NP = pos.length;

    // ---- facets (position + aim pairing)
    const facets = [];
    for (let k = 0; k < NP; k++) {
      const a = aims0[k % aims0.length];
      const c = pos[k];
      const Z = toWorld(a.u, a.v);
      const s = unit(sub(src.pos, c.P));
      const az = unit(sub(Z, c.P));
      const n = unit([s[0] + az[0], s[1] + az[1], s[2] + az[2]]);
      const cosF = dot(n, s);
      const emit = dot(c.u, axis);
      const di = len(sub(Z, c.P));
      const hmax = Math.min(maxPatch(env, c.P, n, tu, margin), hTile);
      facets.push({ a, au: a.u, av: a.v, Z, P: c.P, n, s, emit, cosF, di, hmax, r: c.r, u: c.u, w: spotScale * sEff * di / c.r });
    }
    const nF = facets.length;

    // ---- cells that matter: painted + a band around the paint
    const near = new Uint8Array(R * R);
    {
      const rb = Math.ceil(kern) + 2;
      const dil = (m, along) => {
        const out = new Uint8Array(R * R);
        for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
          if (!m[j * R + i]) continue;
          const c0 = along ? i : j;
          for (let q2 = Math.max(0, c0 - rb); q2 <= Math.min(R - 1, c0 + rb); q2++) out[along ? j * R + q2 : q2 * R + i] = 1;
        }
        return out;
      };
      const m0 = new Uint8Array(R * R);
      for (const p of ptsAll) m0[p.k] = 1;
      near.set(dil(dil(m0, true), false));
    }
    const cells = [];
    for (let k = 0; k < R * R; k++) if (near[k]) cells.push(k);
    const cellIndex = new Int32Array(R * R).fill(-1);
    cells.forEach((k, i) => (cellIndex[k] = i));
    const ng = cells.length;
    const pw = new Float64Array(ng), gv = new Float64Array(ng), pu = new Float64Array(ng), pv = new Float64Array(ng);
    for (let i = 0; i < ng; i++) {
      const k = cells[i];
      pw[i] = paint[k] > 0 ? 1 : gapWeight;
      gv[i] = goal[k];
      pu[i] = -half + ((k % R) + 0.5) * cell;
      pv[i] = -half + (((k / R) | 0) + 0.5) * cell;
    }

    if (useGrid) emIters = 0;
    // ---- sparse spot lists + weighted NNLS, with an EM refinement of the aims
    let e = new Float64Array(nF);
    let eMax = new Float64Array(nF);
    const buildLists = () => {
      const lists = [];
      for (let f = 0; f < nF; f++) {
        const s = facets[f], list = [], hw = s.w / 2;
        const i0 = clamp(Math.floor((s.au - hw + half) / cell), 0, R - 1);
        const i1 = clamp(Math.ceil((s.au + hw + half) / cell) - 1, 0, R - 1);
        const j0 = clamp(Math.floor((s.av - hw + half) / cell), 0, R - 1);
        const j1 = clamp(Math.ceil((s.av + hw + half) / cell) - 1, 0, R - 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const ci = cellIndex[j * R + i]; if (ci >= 0) list.push(ci); }
        lists.push(list);
      }
      return lists;
    };
    const solveNNLS = (lists) => {
      const cellFacets = [];
      for (let i = 0; i < ng; i++) cellFacets.push([]);
      for (let f = 0; f < nF; f++) for (const ci of lists[f]) cellFacets[ci].push(f);
      const b = new Float64Array(nF);
      const Gm = [];
      for (let i = 0; i < nF; i++) Gm.push(new Map());
      for (let ci = 0; ci < ng; ci++) {
        const wgt = pw[ci]; if (!(wgt > 0)) continue;
        const fs = cellFacets[ci];
        for (let x = 0; x < fs.length; x++) {
          const i = fs[x], wi = 1 / (facets[i].w * facets[i].w);
          b[i] += wgt * gv[ci] * wi;
          for (let y = x; y < fs.length; y++) {
            const j = fs[y], v = wgt * wi / (facets[j].w * facets[j].w);
            Gm[i].set(j, (Gm[i].get(j) || 0) + v);
            if (j !== i) Gm[j].set(i, (Gm[j].get(i) || 0) + v);
          }
        }
      }
      e = new Float64Array(nF);
      for (let sweep = 0; sweep < 300; sweep++) {
        let maxd = 0;
        for (let i = 0; i < nF; i++) {
          let grad = b[i];
          for (const [j, v] of Gm[i]) grad -= v * e[j];
          const diag = Gm[i].get(i) || 1;
          const ne = clamp(e[i] + grad / diag, 0, eMax[i]);
          const d = Math.abs(ne - e[i]); if (d > maxd) maxd = d;
          e[i] = ne;
        }
        if (maxd < 1e-13) break;
      }
      // design on the cells
      const D = new Float64Array(ng);
      for (let f = 0; f < nF; f++) {
        if (!(e[f] > 0)) continue;
        const iv = e[f] / (facets[f].w * facets[f].w);
        for (const ci of lists[f]) D[ci] += iv;
      }
      return D;
    };
    // capacity per facet (patch area × solid angle × cos)
    const setCap = () => {
      for (let f = 0; f < nF; f++) {
        const s = facets[f], q = Math.max(0.02, s.emit * s.cosF);
        const h = Math.max(0.2, Math.min(s.hmax, hTile));
        s.h = h;
        eMax[f] = power * 4 * h * h * q / (Math.PI * s.r * s.r);
      }
    };
    setCap();

    let lists = buildLists();
    let Dcell = solveNNLS(lists);
    for (let it = 0; it < emIters; it++) {
      // move every aim to the centroid of the painted mass it lights
      const numU = new Float64Array(nF), numV = new Float64Array(nF), den = new Float64Array(nF);
      const cellFacets = [];
      for (let i = 0; i < ng; i++) cellFacets.push([]);
      for (let f = 0; f < nF; f++) for (const ci of lists[f]) cellFacets[ci].push(f);
      for (let ci = 0; ci < ng; ci++) {
        const pv0 = paint[cells[ci]];
        if (!(pv0 > 0)) continue;
        const fs = cellFacets[ci];
        let sw = 0;
        for (const f of fs) if (e[f] > 0) sw += e[f] / (facets[f].w * facets[f].w);
        if (!(sw > 0)) continue;
        for (const f of fs) {
          if (!(e[f] > 0)) continue;
          const share = (e[f] / (facets[f].w * facets[f].w)) / sw;
          const wgt = pv0 * share;
          numU[f] += wgt * pu[ci]; numV[f] += wgt * pv[ci]; den[f] += wgt;
        }
      }
      let moved = 0;
      for (let f = 0; f < nF; f++) {
        if (!(den[f] > 0)) continue;
        const nu = numU[f] / den[f], nv = numV[f] / den[f];
        const au = facets[f].au, av = facets[f].av;
        const du = nu - au, dv = nv - av;
        if (du * du + dv * dv > 1e-6) moved++;
        facets[f].au = clamp(nu, -half + 0.2 * cell, half - 0.2 * cell);
        facets[f].av = clamp(nv, -half + 0.2 * cell, half - 0.2 * cell);
        facets[f].Z = toWorld(facets[f].au, facets[f].av);
      }
      if (!moved) break;
      lists = buildLists();
      Dcell = solveNNLS(lists);
    }

    // ---- scale up to the area limit (fidelity is scale invariant)
    let sc = 0;
    for (let i = 0; i < nF; i++) if (e[i] > 0 && eMax[i] > 0) sc = Math.max(sc, e[i] / eMax[i]);
    if (sc > 0 && isFinite(sc)) { const k2 = 1 / sc; for (let i = 0; i < nF; i++) e[i] *= k2; }

    // ---- build surfaces
    const surfaces = [], intent = [];
    let placedFlux = 0;
    for (let f = 0; f < nF; f++) {
      const s = facets[f];
      if (!(e[f] > 0)) continue;
      const q = Math.max(0.02, s.emit * s.cosF);
      const area = Math.PI * e[f] * s.r * s.r / (power * q);
      const h = Math.min(0.5 * Math.sqrt(area), s.hmax);
      if (!(h > 0.15)) continue;
      const id = 'F' + f;
      surfaces.push({
        type: 'facet', id, group: 'A', P: s.P, S0: src.pos.slice(), Z: s.Z,
        flat: false, di: s.di,
        clip: { kind: 'rect', hx: h, hy: h, ref: tu },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      placedFlux += power * 4 * h * h * q / (Math.PI * s.r * s.r);
      const a = s.a;
      intent.push({ facet: id, cells: a.cells.map((ci) => [ptsAll[ci].k, 1]) });
    }
    const notes = [];
    notes.push('r ' + rUsed.toFixed(1) + ' · spots ' + facets[0].w.toFixed(1) + '–' + facets[nF - 1].w.toFixed(1) + ' mm · cap ' + chosen.c.length + ' · aims ' + aims0.length + ' · facets ' + surfaces.length + ' · flux ' + placedFlux.toFixed(0) + '/' + power.toFixed(0) + ' lm');
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-ernie55flash-r2--flux',
    name: 'Flux (k-means + NNLS)',
    version: '0.3',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'margin', label: 'Envelope margin (mm)', type: 'number', min: 0, step: 0.05, default: 0.3 },
      { key: 'sphere', label: 'Facet sphere radius (mm, 0 = auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'place', label: 'Facet placement', type: 'select', options: [{ value: 'sphere', label: 'sphere' }, { value: 'boundary', label: 'envelope' }], default: 'sphere' },
      { key: 'aimMode', label: 'Aim placement', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'grid', label: 'grid' }, { value: 'kmeans', label: 'k-means' }], default: 'auto' },
      { key: 'spotScale', label: 'Spot size calibration', type: 'range', min: 0.4, max: 1.3, step: 0.02, default: 0.9 },
      { key: 'covGoal', label: 'Spot coverage goal', type: 'range', min: 1, max: 4, step: 0.1, default: 1.5 },
      { key: 'tileFill', label: 'Facet tiling fill', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.55 },
      { key: 'gapWeight', label: 'Gap weight in fit', type: 'range', min: 0, max: 1, step: 0.05, default: 0.15 },
      { key: 'emIters', label: 'Aim refinement rounds', type: 'range', min: 0, max: 8, step: 1, default: 4 },
      { key: 'fillGoal', label: 'Flux goal', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.05 },
    ],
    solve,
  });

  /* ================================================================== tuner (optional, step 3)
   * `flux-auto` picks the static solver's settings for a goal.  It may trace (its id ends in -auto):
   * every candidate is solved with the static algorithm, traced with the SAME seed (common random
   * numbers, so differences are geometry, not dice), scored by the goal, and the winner's geometry is
   * returned.  The static solver's own defaults are one candidate, so the tuner can only win.
   *
   * goals: faithful = the fidelity F1; throw = peak intensity + reach; efficient = share of the LED's
   * light that lands on the painting (+ a little of the brightness ceiling).
   */
  const AUTO_CANDIDATES = [
    {},
    { spotScale: 0.75 }, { spotScale: 1.05 }, { spotScale: 1.2 },
    { covGoal: 1.2 }, { covGoal: 2.0 },
    { tileFill: 0.4 }, { tileFill: 0.75 },
    { emIters: 0 }, { emIters: 8 },
    { aimMode: 'grid' }, { aimMode: 'kmeans' },
    { gapWeight: 0.05 }, { gapWeight: 0.3 },
    { fillGoal: 0.02 }, { fillGoal: 0.15 },
  ];
  function autoScore(goal, tr) {
    const f = tr && tr.fidelity;
    const fid = f ? (isFinite(f.fidelity) ? f.fidelity : 0) : 0;
    if (goal === 'throw') {
      const p = Math.max(1, tr && tr.peakCd || 0), th = Math.max(1, tr && tr.throwM || 0);
      return Math.log10(p) + 0.4 * Math.log10(th) + 0.05 * fid;
    }
    if (goal === 'efficient') {
      const on = f && isFinite(f.onPaint) ? f.onPaint : 0;
      const ceil = tr && isFinite(tr.ofCeiling) ? tr.ofCeiling : 0;
      return on + 0.15 * ceil + 0.05 * fid;
    }
    return fid + 0.02 * (f && isFinite(f.onPaint) ? f.onPaint : 0);
  }
  async function solveAuto(input, settings, tools) {
    settings = settings || {};
    const goal = settings.goal || 'faithful';
    const rays = clamp(Math.round(settings.rays || 150000), 20000, 800000);
    const finalRays = clamp(Math.round(rays * 4), 40000, 1600000);
    const seed = input.seed | 0;
    const cands = AUTO_CANDIDATES.slice();
    const tried = [];
    let firstErr = null;
    for (const c of cands) {
      const st = Object.assign({}, settings, c);
      let out = null;
      try { out = solve(input, st); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      let tr = null;
      try { tr = tools.trace(out.surfaces, { rays, seed }); } catch (e) { tr = null; if (!firstErr) firstErr = String(e && e.message || e); }
      if (!tr) continue;
      tried.push({ st, out, sc: autoScore(goal, tr), tr, rays });
    }
    if (!tried.length) { const o = solve(input, settings); if (firstErr && o && o.notes) o.notes.push('auto: trace failed: ' + firstErr); return o; }
    tried.sort((a, b) => b.sc - a.sc || (a.st.spotScale || 0) - (b.st.spotScale || 0));
    // re-trace the top few with 4× the rays: the coarse scores are noisy, the finalists are not
    const finalists = tried.slice(0, 3);
    for (const f of finalists) {
      let tr = null;
      try { tr = tools.trace(f.out.surfaces, { rays: finalRays, seed }); } catch (e) { tr = null; }
      if (tr) { f.sc = autoScore(goal, tr); f.tr = tr; f.rays = finalRays; }
    }
    finalists.sort((a, b) => b.sc - a.sc || (a.st.spotScale || 0) - (b.st.spotScale || 0));
    const win = finalists[0];
    const wd = Object.keys(win.st).filter((k) => k !== 'goal' && k !== 'rays' && k !== 'minDistance');
    win.out.notes = (win.out.notes || []).concat(['auto: goal ' + goal + ' · ' + tried.length + ' candidates · winner {' + wd.map((k) => k + '=' + win.st[k]).join(', ') + '}']);
    return win.out;
  }
  RF.Solvers.register({
    id: 'bench-ernie55flash-r2--flux-auto',
    name: 'Flux auto (tuned: faithful / throw / efficient)',
    version: '0.1',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: [{ value: 'faithful', label: 'faithful (paint fidelity)' }, { value: 'throw', label: 'throw (peak + reach)' }, { value: 'efficient', label: 'efficient (light on paint)' }], default: 'faithful' },
      { key: 'rays', label: 'Rays per candidate', type: 'range', min: 20000, max: 600000, step: 10000, default: 150000 },
    ],
    solve: solveAuto,
  });
})();