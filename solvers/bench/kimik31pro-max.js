/* Flux paint solver — deterministic, static reflector design.
 * One focused facet per weighted paint cluster; aperture area supplies that cluster's flux.
 * No rays are traced by this file. */
(function () {
  'use strict';
  const V = RF.V, Geo = RF.Geo, E = RF.Engine, Src = RF.Source;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot;

  function gridShape(M, w, h) {
    let best = null;
    for (let nx = 1; nx <= M; nx++) {
      const ny = Math.floor(M / nx); if (!ny) continue;
      const n = nx * ny; if (n < Math.max(1, Math.floor(M * 0.72))) continue;
      const px = w / nx, py = h / ny, aspect = Math.min(px, py) / Math.max(px, py);
      const score = aspect + 0.04 * n / M;
      if (!best || score > best.score + 1e-12) best = { nx, ny, n, px, py, score };
    }
    return best || { nx: 1, ny: 1, n: 1, px: w, py: h };
  }

  function projectedHalf(env, e) {
    const h = env.half;
    if (env.shape === 'ellipsoid') return Math.sqrt(h[0] * h[0] * e[0] * e[0] + h[1] * h[1] * e[1] * e[1] + h[2] * h[2] * e[2] * e[2]);
    return Math.abs(e[0]) * h[0] + Math.abs(e[1]) * h[1] + Math.abs(e[2]) * h[2];
  }

  function opticalNormal(P, S, Z) {
    const sh = V.norm(sub(S, P)), ah = V.norm(sub(Z, P)), n = add(sh, ah), l = V.len(n);
    return l > 1e-8 ? { n: mul(n, 1 / l), sh, ah, cos: dot(n, sh) / l } : null;
  }

  // Cone flux / total emitted flux, before reflectivity and before occlusion.
  function coneFlux(src, P, Z, hx, hy, ref) {
    const o = opticalNormal(P, src.pos, Z); if (!o) return 0;
    const ex = V.inPlane(o.n, ref), ey = V.cross(o.n, ex), N = 3, dA = 4 * hx * hy / (N * N);
    const total = Src.totalIntegral(src); let f = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const x = ((a + 0.5) / N * 2 - 1) * hx, y = ((b + 0.5) / N * 2 - 1) * hy;
      const Q = add(P, add(mul(ex, x), mul(ey, y))), d = sub(Q, src.pos), r2 = dot(d, d);
      if (!(r2 > 1e-16)) continue;
      const r = Math.sqrt(r2), dn = mul(d, 1 / r), ct = Math.max(0, -dot(dn, o.n));
      const theta = Math.acos(clamp(dot(dn, V.norm(src.axis)), -1, 1));
      f += Src.intensity(src, theta) * ct / r2 * dA;
    }
    return Math.max(0, f / total);
  }

  function surfaceOf(id, src, p, Z, hx, hy, ref, reflectivity) {
    return { type: 'facet', id, group: 'A', P: p.P.slice(), S0: src.pos.slice(), Z: Z.slice(), flat: false,
      di: V.dist(p.P, Z), clip: { kind: 'rect', hx, hy, ref: ref.slice() },
      optics: { interaction: 'reflect', reflectivity, twoSided: false } };
  }

  function geometryOK(s, env, sources, keep) {
    const scale = Math.max(...env.half), margin = Math.max(1e-5, scale * 2e-5);
    if (!Geo.envInside(env, s.P, -2e-5)) return false;
    let G;
    try { G = Geo.compile([s]); } catch (_) { return false; }
    for (const poly of Geo.outline(G, 0)) {
      for (const q of poly) if (!Geo.envInside(env, q, -2e-5)) return false;
      for (const src of sources) {
        const S = src.pos, k = Math.max(keep, env.keepOut || 0) + margin;
        if (V.dist(s.P, S) < k) return false;
        for (const q of poly) if (V.dist(q, S) < k) return false;
        // A sphere is not convex from outside: also inspect the real surface on a small centroid fan.
        const c = mul(poly.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / poly.length);
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          for (const t of [0.25, 0.5, 0.75]) {
            const q = add(c, mul(sub(add(a, b), mul(c, 2)), t));
            const d = V.norm(sub(q, S));
            const hit = Geo.intersect(G.D, G.poly, 0, S[0], S[1], S[2], d[0], d[1], d[2], 1e-9, Infinity);
            if (hit >= 0 && hit < k) return false;
          }
        }
      }
    }
    return true;
  }

  function fitSurface(s, env, sources, keep, hx0, hy0) {
    const sx = Math.max(...env.half), tiny = Math.max(1e-5, sx * 1e-6);
    let hx = hx0, hy = hy0;
    for (let k = 0; k < 18; k++) {
      s.clip.hx = hx; s.clip.hy = hy;
      if (geometryOK(s, env, sources, keep)) return { hx, hy };
      hx *= 0.82; hy *= 0.82;
      if (Math.max(hx, hy) < tiny) break;
    }
    return null;
  }

  // Deterministic weighted Lloyd quantisation in target millimetres.
  function paintClusters(paint, T, M, iterations) {
    const R = paint.res, p = paint.cells, cells = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i, w = +p[k] || 0; if (!(w > 0)) continue;
      const uv = E.cellCenter(T, i, j); cells.push({ k, u: uv[0], v: uv[1], w });
    }
    M = Math.min(M, cells.length);
    if (!M) return [];
    const centres = [], nearest = new Float64Array(cells.length).fill(Infinity);
    let first = 0; for (let i = 1; i < cells.length; i++) if (cells[i].w > cells[first].w) first = i;
    centres.push({ u: cells[first].u, v: cells[first].v });
    while (centres.length < M) {
      let pick = -1, best = -1;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], q = centres[centres.length - 1], d2 = (c.u - q.u) ** 2 + (c.v - q.v) ** 2;
        if (d2 < nearest[i]) nearest[i] = d2;
        const score = nearest[i] * Math.sqrt(c.w);
        if (score > best + 1e-12) { best = score; pick = i; }
      }
      if (pick < 0 || !(best > 0)) {
        const used = new Set(centres.map((c) => c.k)); pick = cells.findIndex((c, i) => !used.has(c.k));
        if (pick < 0) break;
      }
      centres.push({ u: cells[pick].u, v: cells[pick].v, k: cells[pick].k });
    }
    let assign = new Int32Array(cells.length);
    for (let it = 0; it < iterations; it++) {
      const sums = centres.map(() => ({ u: 0, v: 0, w: 0, n: 0 }));
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; let b = 0, bd = Infinity;
        for (let m = 0; m < centres.length; m++) {
          const q = centres[m], d = (c.u - q.u) ** 2 + (c.v - q.v) ** 2;
          if (d < bd) { bd = d; b = m; }
        }
        assign[i] = b; const s = sums[b]; s.u += c.u * c.w; s.v += c.v * c.w; s.w += c.w; s.n++;
      }
      for (let m = 0; m < centres.length; m++) if (sums[m].w > 0) {
        centres[m].u = sums[m].u / sums[m].w; centres[m].v = sums[m].v / sums[m].w;
      }
    }
    const out = centres.map((c, m) => ({ u: c.u, v: c.v, mass: 0, cells: [], m }));
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], q = out[assign[i]]; q.mass += c.w; q.cells.push([c.k, c.w]);
    }
    return out.filter((q) => q.mass > 0);
  }

  // O(8 M²), rather than a cubic assignment solve: try the eight quarter-turn/reflection
  // orientations, and greedily match important clusters first. Local aims make a smooth bank;
  // the log-capacity term discourages a small facet being asked for a large cluster.
  function smoothPairs(places, clusters) {
    const n = Math.min(places.length, clusters.length), pu = [], pv = [];
    // Bank bases are common within a bank; project around the mean without allocating in the cost loop.
    const meanP = places.reduce((a, q) => add(a, q.P), [0, 0, 0]).map((x) => x / places.length);
    for (let i = 0; i < n; i++) { const d = sub(places[i].P, meanP); pu[i] = dot(d, places[i].e1); pv[i] = dot(d, places[i].e2); }
    const standard = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length, s = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((x) => (x - m) / s); };
    const x0 = standard(pu.slice(0, n)), y0 = standard(pv.slice(0, n)), cx = standard(clusters.slice(0, n).map((c) => c.u)), cy = standard(clusters.slice(0, n).map((c) => c.v));
    const capMean = places.slice(0, n).reduce((a, p) => a + Math.log(Math.max(1e-300, p.cap)), 0) / n;
    const massMean = clusters.slice(0, n).reduce((a, c) => a + Math.log(Math.max(1e-300, c.mass)), 0) / n;
    const lc = places.slice(0, n).map((p) => Math.log(Math.max(1e-300, p.cap)) - capMean), lm = clusters.slice(0, n).map((c) => Math.log(Math.max(1e-300, c.mass)) - massMean);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => clusters[b].mass - clusters[a].mass || a - b);
    let best = null;
    for (let o = 0; o < 8; o++) {
      const swap = o & 1, sx = o & 2 ? -1 : 1, sy = o & 4 ? -1 : 1;
      const px = x0.map((x, i) => sx * (swap ? y0[i] : x0[i])), py = y0.map((y, i) => sy * (swap ? x0[i] : y0[i]));
      const free = new Uint8Array(n).fill(1), pair = new Int32Array(n).fill(-1); let total = 0;
      for (const c of order) {
        let pick = -1, score = Infinity;
        for (let p = 0; p < n; p++) if (free[p]) {
          const d = (px[p] - cx[c]) ** 2 + (py[p] - cy[c]) ** 2, mismatch = lc[p] - lm[c];
          const s = d + 0.12 * mismatch * mismatch;
          if (s < score - 1e-12) { score = s; pick = p; }
        }
        free[pick] = 0; pair[pick] = c; total += score;
      }
      if (!best || total < best.total) best = { pair, total };
    }
    return places.slice(0, n).map((p, i) => ({ p, c: clusters[best.pair[i]] }));
  }

  function pointInPoly(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  function projectDirections(dirs, c, ex, ey) {
    const out = [], at = (d) => { const z = dot(d, c); return [dot(d, ex) / z, dot(d, ey) / z]; }, horizon = 0.02;
    for (let i = 0; i < dirs.length; i++) {
      const a = dirs[i], b = dirs[(i + 1) % dirs.length], za = dot(a, c), zb = dot(b, c), ina = za > horizon, inb = zb > horizon;
      if (ina) out.push(at(a));
      if (ina !== inb) { const d = V.norm(add(a, mul(sub(b, a), (horizon - za) / (zb - za)))); out.push(at(d)); }
    }
    return out;
  }

  // Deterministic angular-area quadrature of mutual source shadowing. Direction polygons are
  // clipped ahead of the gnomonic horizon; samples count union overlap only once.
  function shadowRetention(surfaces, S, N) {
    if (!(N > 1) || surfaces.length < 2) return surfaces.map(() => 1);
    const G = Geo.compile(surfaces), data = surfaces.map((s, k) => {
      const c = V.norm(sub(s.P, S)), basis = V.basis(c), ex = basis[0], ey = basis[1];
      const dirs = Geo.outline(G, k)[0].map((p) => V.norm(sub(p, S))), poly = projectDirections(dirs, c, ex, ey);
      const ang = Math.max(...dirs.map((d) => Math.acos(clamp(dot(d, c), -1, 1))));
      return { c, ex, ey, dirs, poly, ang, r: V.dist(s.P, S), bb: [Math.min(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[1]))] };
    });
    return data.map((f, i) => {
      const samples = [];
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        const p = [f.bb[0] + (a + 0.5) / N * (f.bb[1] - f.bb[0]), f.bb[2] + (b + 0.5) / N * (f.bb[3] - f.bb[2])];
        if (pointInPoly(p, f.poly)) samples.push({ p, blocked: false });
      }
      for (let j = 0; j < data.length; j++) if (j !== i && data[j].r < f.r) {
        const g = data[j]; if (f.ang + g.ang < Math.PI && dot(f.c, g.c) < Math.cos(f.ang + g.ang)) continue;
        const poly = projectDirections(g.dirs, f.c, f.ex, f.ey); if (poly.length < 3) continue;
        const bb = [Math.min(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[1]))];
        for (const s of samples) if (!s.blocked && s.p[0] >= bb[0] && s.p[0] <= bb[1] && s.p[1] >= bb[2] && s.p[1] <= bb[3] && pointInPoly(s.p, poly)) s.blocked = true;
      }
      return samples.length ? 1 - samples.filter((s) => s.blocked).length / samples.length : 1;
    });
  }

  function reflectedUV(P, n, S, T) {
    const d = V.norm(sub(P, S)), r = add(d, mul(n, -2 * dot(d, n))), den = dot(r, T.n);
    if (Math.abs(den) < 1e-12) return [NaN, NaN];
    const t = dot(sub(T.C, P), T.n) / den, Q = add(P, mul(r, t));
    return t > 0 ? E.worldToTargetUV(T, Q) : [NaN, NaN];
  }

  // Normalised finite-source image on the paint grid. For a planar die this is a linearly
  // mapped rectangle/disc; for a volume it is a covariance Gaussian. No light rays are sampled.
  function imageKernel(s, src, T, R) {
    const n = Geo.facetQuadric(s.P, s.S0, s.Z, null).n, centre = reflectedUV(s.P, n, s.S0, T);
    if (!centre.every(isFinite)) return new Float64Array(R * R);
    const out = new Float64Array(R * R), cw = 2 * T.half / R, eps = 1e-3;
    if (src.kind === 'point') {
      const i = clamp(Math.floor((centre[0] + T.half) / cw), 0, R - 1), j = clamp(Math.floor((centre[1] + T.half) / cw), 0, R - 1); out[j * R + i] = 1; return out;
    }
    if (src.kind !== 'planar') {
      const J = [];
      for (let a = 0; a < 3; a++) {
        const e = [0, 0, 0]; e[a] = eps;
        const up = reflectedUV(s.P, n, add(s.S0, e), T), dn = reflectedUV(s.P, n, sub(s.S0, e), T);
        J.push([(up[0] - dn[0]) / (2 * eps), (up[1] - dn[1]) / (2 * eps)]);
      }
      if (!J.flat().every(isFinite)) return out;
      const C = Src.extentCov(src), cov = [0, 0, 0];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (C[3 * a + b]) {
        cov[0] += J[a][0] * C[3 * a + b] * J[b][0]; cov[1] += J[a][0] * C[3 * a + b] * J[b][1]; cov[2] += J[a][1] * C[3 * a + b] * J[b][1];
      }
      cov[0] = Math.max(cw * cw / 16, cov[0]); cov[2] = Math.max(cw * cw / 16, cov[2]);
      const det = Math.max(1e-20, cov[0] * cov[2] - cov[1] * cov[1]), radU = 4 * Math.sqrt(cov[0] + Math.abs(cov[1])), radV = 4 * Math.sqrt(cov[2] + Math.abs(cov[1]));
      const i0 = Math.max(0, Math.floor((centre[0] - radU + T.half) / cw)), i1 = Math.min(R - 1, Math.ceil((centre[0] + radU + T.half) / cw));
      const j0 = Math.max(0, Math.floor((centre[1] - radV + T.half) / cw)), j1 = Math.min(R - 1, Math.ceil((centre[1] + radV + T.half) / cw));
      let sum = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const u = -T.half + (i + 0.5) * cw - centre[0], v = -T.half + (j + 0.5) * cw - centre[1];
        const q = (cov[2] * u * u - 2 * cov[1] * u * v + cov[0] * v * v) / det, z = Math.exp(-0.5 * q); out[j * R + i] = z; sum += z;
      }
      // Preserve the on-target fraction: the untruncated Gaussian integrates to 2π√det.
      const full = 2 * Math.PI * Math.sqrt(det) / (cw * cw);
      if (full > 0) for (let k = 0; k < out.length; k++) out[k] /= full;
      return out;
    }
    const fr = Src.frame(src), A = [];
    for (const [ei, e] of [fr.u, fr.v].entries()) {
      const up = reflectedUV(s.P, n, add(s.S0, mul(e, eps)), T), dn = reflectedUV(s.P, n, sub(s.S0, mul(e, eps)), T);
      const size = src.shape === 'disc' ? 2 * src.radius : (ei ? src.h : src.w);
      A.push([(up[0] - dn[0]) / (2 * eps) * size, (up[1] - dn[1]) / (2 * eps) * size]);
    }
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    if (!(Math.abs(det) > 1e-16) || !A.flat().every(isFinite)) return out;
    const rad = Math.max(Math.abs(A[0][0]) + Math.abs(A[1][0]), Math.abs(A[0][1]) + Math.abs(A[1][1])) + 2 * cw;
    const i0 = Math.max(0, Math.floor((centre[0] - rad + T.half) / cw)), i1 = Math.min(R - 1, Math.ceil((centre[0] + rad + T.half) / cw));
    const j0 = Math.max(0, Math.floor((centre[1] - rad + T.half) / cw)), j1 = Math.min(R - 1, Math.ceil((centre[1] + rad + T.half) / cw));
    const full = Math.abs(det) * (src.shape === 'disc' ? Math.PI / 4 : 1) / (cw * cw), N = 4;
    let sum = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      const u = -T.half + (i + (a + 0.5) / N) * cw - centre[0], v = -T.half + (j + (b + 0.5) / N) * cw - centre[1];
      const x = (u * A[1][1] - v * A[1][0]) / det, y = (v * A[0][0] - u * A[0][1]) / det;
      if (src.shape === 'disc' ? x * x + y * y < 0.25 : Math.abs(x) < 0.5 && Math.abs(y) < 0.5) { out[j * R + i] += 1 / (N * N); sum += 1 / (N * N); }
    }
    // k holds target-cell coverage fractions. Divide by the FULL image area in cells,
    // not by the clipped sum: rays beyond the target are spill, not delivered flux.
    if (full > 0) for (let k = 0; k < out.length; k++) out[k] /= full;
    return out;
  }

  function balanceFlux(made, initial, input, T, passes, blend, aimPasses, aimStep) {
    const R = input.paint.res | 0, n = R * R; if (!(passes > 0) || !made.length) return initial;
    const kernels = made.map((m) => imageKernel(m.s, input.source, T, R)), paint = input.paint.cells;
    const aims = made.map((m) => ({ u: m.cluster.u, v: m.cluster.v })), cw = 2 * T.half / R;
    const ker = RF.Photometry.achievableKernel({ source: input.source, envelope: input.envelope, target: input.target });
    const B = RF.Photometry.boxBlur(paint, R, ker.cells), D = new Float64Array(n), W = new Float64Array(n);
    let sd = 0, painted = 0, typ0 = 0;
    for (let k = 0; k < n; k++) { D[k] = (1 - blend) * (paint[k] || 0) + blend * B[k]; sd += D[k]; if (paint[k] > 0) { painted++; typ0 += D[k]; } }
    if (!(sd > 0)) return initial;
    for (let k = 0; k < n; k++) D[k] /= sd;
    const typ = typ0 / Math.max(1, painted) / sd, rb = Math.ceil(ker.cells) + 2, near = new Uint8Array(n);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0)
      for (let b = Math.max(0, j - rb); b <= Math.min(R - 1, j + rb); b++) for (let a = Math.max(0, i - rb); a <= Math.min(R - 1, i + rb); a++) near[b * R + a] = 1;
    for (let k = 0; k < n; k++) {
      const den = Math.max(D[k], 0.25 * typ) ** 2;
      W[k] = paint[k] > 0 ? 1 / den : near[k] ? 0.45 / den : 0.008 / Math.max(1e-300, typ * typ);
    }
    const x = initial.slice(), Y = new Float64Array(n); let sx = 0;
    for (const q of x) sx += q; if (!(sx > 0)) return initial;
    for (let i = 0; i < x.length; i++) { x[i] /= sx; const K = kernels[i]; for (let k = 0; k < n; k++) Y[k] += x[i] * K[k]; }
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < x.length; i++) {
        const old = x[i], K0 = kernels[i];
        if (pass < (aimPasses || 0)) {
          // Remove this image, then choose its best local aim and exact nonnegative weight.
          for (let k = 0; k < n; k++) Y[k] -= old * K0[k];
          let best = null;
          for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
            const u = aims[i].u + du * aimStep * cw, v = aims[i].v + dv * aimStep * cw;
            const Z = E.targetUVtoWorld(T, u, v), s = du || dv ? Object.assign({}, made[i].s, { Z }) : made[i].s;
            const K = du || dv ? imageKernel(s, input.source, T, R) : K0;
            let num = 0, den = 0;
            for (let k = 0; k < n; k++) if (K[k] > 1e-15) { num += W[k] * K[k] * (D[k] - Y[k]); den += W[k] * K[k] * K[k]; }
            const next = den > 0 ? Math.max(0, num / den) : 0, score = -2 * next * num + next * next * den;
            if (!best || score < best.score - 1e-20) best = { score, K, next, u, v, Z };
          }
          kernels[i] = best.K; x[i] = best.next; aims[i].u = best.u; aims[i].v = best.v;
          made[i].s.Z = best.Z; made[i].s.di = V.dist(made[i].s.P, best.Z);
          for (let k = 0; k < n; k++) Y[k] += best.next * best.K[k];
        } else {
          let num = 0, den = 0;
          for (let k = 0; k < n; k++) if (K0[k] > 1e-15) { const r = D[k] - Y[k] + old * K0[k]; num += W[k] * K0[k] * r; den += W[k] * K0[k] * K0[k]; }
          if (!(den > 0)) { if (old) for (let k = 0; k < n; k++) Y[k] -= old * K0[k]; x[i] = 0; continue; }
          const next = Math.max(0, 0.3 * old + 0.7 * num / den), dx = next - old;
          if (Math.abs(dx) > 1e-18) { x[i] = next; for (let k = 0; k < n; k++) if (K0[k]) Y[k] += dx * K0[k]; }
        }
      }
    }
    let sum = 0; for (const q of x) sum += q; return sum > 0 ? x.map((q) => q / sum) : initial;
  }

  function allocate(clusters, places, use) {
    const n = Math.min(clusters.length, places.length); if (!n) return [];
    const cp = clusters.slice(0, n), pp = places.slice(0, n), totalCap = pp.reduce((a, p) => a + p.cap, 0);
    const target = Math.min(totalCap, Math.max(0, use) * totalCap), x = new Array(n).fill(0), active = new Set(Array.from({ length: n }, (_, i) => i));
    let left = target;
    for (let round = 0; round < n + 1 && active.size && left > 1e-15; round++) {
      let mass = 0; for (const i of active) mass += cp[i].mass;
      if (!(mass > 0)) break;
      const lambda = left / mass, capped = [];
      for (const i of active) if (lambda * cp[i].mass > pp[i].cap * (1 - 1e-12)) capped.push(i);
      if (!capped.length) { for (const i of active) x[i] = lambda * cp[i].mass; left = 0; break; }
      for (const i of capped) { x[i] = pp[i].cap; left -= x[i]; active.delete(i); }
    }
    return x;
  }

  function solve(input, settings) {
    const src = input.source, sources = input.sources && input.sources.length ? input.sources : [src];
    const env = input.envelope, S = src.pos, keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const Mmax = Math.max(0, input.limits.maxFacets | 0), R = input.paint.res | 0;
    if (!Mmax || !R || !input.paint.cells.some((x) => x > 0)) return { surfaces: [], intent: [], notes: ['No facets requested, or the painting is empty.'] };
    const T = E.designFrame(Object.assign({}, input.target, { res: R })); T.res = R;
    const patternKind = RF.Modes && RF.Modes.classify ? RF.Modes.classify(input.paint.cells, R, 1).kind : 'general';
    const aimPasses = patternKind === 'text' ? Math.min(2, settings.aimPasses) : settings.aimPasses;
    const aimStep = patternKind === 'text' ? Math.min(1.5, settings.aimStep) : settings.aimStep;
    let paintedMass = 0, u0 = 0, v0 = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = +input.paint.cells[j * R + i] || 0; if (!(w > 0)) continue;
      const uv = E.cellCenter(T, i, j); paintedMass += w; u0 += uv[0] * w; v0 += uv[1] * w;
    }
    const Zc = E.targetUVtoWorld(T, u0 / paintedMass, v0 / paintedMass), scale = Math.max(...env.half);
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], V.norm(src.axis), V.neg(V.norm(src.axis))];
    const unique = [];
    for (const b of axes) if (V.len(b) > 0.5 && !unique.some((a) => dot(a, b) > 0.9999)) unique.push(b);
    const forcedBanks = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }, forced = forcedBanks[settings.bank];
    let best = null;
    for (const b of unique) {
      if (forced && dot(b, forced) < 0.9999) continue;
      const basis = V.basis(b), e1 = basis[0], e2 = basis[1];
      const w = 2 * projectedHalf(env, e1), h = 2 * projectedHalf(env, e2), gs = gridShape(Mmax, w, h);
      if (!(gs.px > 1e-6 && gs.py > 1e-6)) continue;
      const places = [];
      for (let iy = 0; iy < gs.ny; iy++) for (let ix = 0; ix < gs.nx; ix++) {
        const u = -w / 2 + (ix + 0.5) * gs.px, v = -h / 2 + (iy + 0.5) * gs.py;
        const O = add(env.center, add(mul(e1, u), mul(e2, v))), iv = Geo.envInterval(env, O, b);
        if (!(isFinite(iv[1]) && iv[1] >= iv[0])) continue;
        const boundary = add(O, mul(b, iv[1])), rr = Math.max(1, V.dist(boundary, S));
        // At very small facet caps, do not let a whole-wall aperture swallow the LED clearance.
        const hx = Math.min(gs.px * settings.aperture * 0.5, rr * 0.22), hy = Math.min(gs.py * settings.aperture * 0.5, rr * 0.22);
        let o = opticalNormal(boundary, S, Zc); if (!o || o.cos < 0.22) continue;
        // A tilted facet centred on the wall would mostly lie outside it. Inset by its actual
        // tangent-frame extent along the bank normal, plus a conservative curved-sag allowance.
        const ex0 = V.inPlane(o.n, e1), ey0 = V.cross(o.n, ex0);
        const tangent = Math.abs(dot(ex0, b)) * hx + Math.abs(dot(ey0, b)) * hy;
        const margin = Math.max(0.002, scale * 0.0002) + tangent + 1.5 * (hx * hx + hy * hy) / rr;
        const P = add(boundary, mul(b, -margin));
        if (!Geo.envInside(env, P, -1e-6) || V.dist(P, S) < keep + margin) continue;
        o = opticalNormal(P, S, Zc); if (!o || o.cos < 0.22) continue;
        const theta = Math.acos(clamp(dot(V.norm(sub(P, S)), V.norm(src.axis)), -1, 1));
        if (!(Src.intensity(src, theta) > 0)) continue;
        const cap = coneFlux(src, P, Zc, hx, hy, e1); if (!(cap > 1e-12)) continue;
        places.push({ P, b, e1, e2, hx, hy, cap });
      }
      if (!places.length) continue;
      const cap = places.reduce((a, p) => a + p.cap, 0), coverage = places.length / gs.n;
      const score = cap * clamp(coverage * 1.25, 0, 1);
      if (!best || score > best.score + 1e-12) best = { b, e1, e2, places, score, cap, coverage };
    }
    if (!best) return { surfaces: [], intent: [{ facet: null, cells: input.paint.cells.map((w, k) => [k, w]).filter((c) => c[1] > 0) }], notes: ['No envelope bank can accept a useful reflection toward this painting.'] };

    best.places.sort((a, b) => b.cap - a.cap || a.P[0] - b.P[0] || a.P[1] - b.P[1] || a.P[2] - b.P[2]);
    let clusters = paintClusters(input.paint, T, best.places.length, settings.clusterPasses);
    clusters.sort((a, b) => b.mass - a.mass || a.u - b.u || a.v - b.v);
    const pairs = settings.layout === 'smooth' ? smoothPairs(best.places, clusters) : best.places.slice(0, clusters.length).map((p, i) => ({ p, c: clusters[i] }));
    const made = [], unplaced = [];
    for (let i = 0; i < pairs.length; i++) {
      const c = pairs[i].c, p = pairs[i].p, Z = E.targetUVtoWorld(T, c.u, c.v), id = 'F' + i;
      const s = surfaceOf(id, src, p, Z, p.hx, p.hy, p.e1, input.limits.reflectivity);
      const fit = fitSurface(s, env, sources, keep, p.hx, p.hy);
      if (!fit) { unplaced.push({ facet: null, cells: c.cells }); continue; }
      const cap = coneFlux(src, p.P, Z, fit.hx, fit.hy, p.e1);
      if (!(cap > 1e-12)) { unplaced.push({ facet: null, cells: c.cells }); continue; }
      made.push({ s, cluster: c, cap, hx: fit.hx, hy: fit.hy, ref: p.e1 });
    }
    const liveClusters = made.map((m) => m.cluster);
    if (aimPasses > 0) {
      const initial = allocate(liveClusters, made.map((m) => ({ cap: m.cap })), settings.fluxUse);
      balanceFlux(made, initial, input, T, Math.max(settings.imagePasses, aimPasses), settings.edgeBlend, aimPasses, aimStep);
      for (const m of made) {
        const fit = fitSurface(m.s, env, sources, keep, m.hx, m.hy);
        if (fit) { m.hx = fit.hx; m.hy = fit.hy; m.cap = coneFlux(src, m.s.P, m.s.Z, m.hx, m.hy, m.ref); }
        else m.cap = 0;
      }
    }
    const Nocc = made.length > 220 ? Math.min(8, settings.shadowSamples) : settings.shadowSamples;
    const retention = shadowRetention(made.map((m) => m.s), S, Nocc);
    for (let i = 0; i < made.length; i++) made[i].ret = clamp(retention[i], 0.02, 1);
    const caps = made.map((m) => ({ cap: m.cap * m.ret }));
    let wanted = allocate(liveClusters, caps, settings.fluxUse);
    const balanced = balanceFlux(made, wanted, input, T, settings.imagePasses, settings.edgeBlend, 0, aimStep);
    wanted = allocate(balanced.map((mass) => ({ mass })), caps, settings.fluxUse);
    const surfaces = [], intent = unplaced.slice();
    let predicted = 0;
    for (let i = 0; i < made.length; i++) {
      const m = made[i], want = wanted[i] || 0; if (!(want > 1e-14)) continue;
      const isolatedWant = want / m.ret;
      let f = Math.sqrt(clamp(isolatedWant / m.cap, 0, 1)), hx = m.hx * f, hy = m.hy * f;
      let q = coneFlux(src, m.s.P, m.s.Z, hx, hy, m.ref);
      if (q > 1e-15) {
        f = Math.sqrt(clamp(isolatedWant / q, 0, 1)); hx = Math.min(m.hx, hx * f); hy = Math.min(m.hy, hy * f);
        q = coneFlux(src, m.s.P, m.s.Z, hx, hy, m.ref);
      }
      m.s.clip.hx = hx; m.s.clip.hy = hy; surfaces.push(m.s); intent.push({ facet: m.s.id, cells: m.cluster.cells }); predicted += q * m.ret;
    }
    const notes = ['Static focused-cluster reflector: ' + surfaces.length + ' facets, bank [' + best.b.map((x) => x.toFixed(2)).join(',') + '], predicted caught flux ' + (100 * predicted).toFixed(1) + '% before reflectivity (bank isolated capacity ' + (100 * best.cap).toFixed(1) + '%).',
      'Paint quantisation: ' + liveClusters.length + ' weighted clusters (' + patternKind + ', ' + aimPasses + ' aim passes); ' + unplaced.length + ' unplaced. Effective LED clearance ' + keep.toFixed(2) + ' mm.'];
    return { surfaces, intent, notes };
  }

  const STATIC_SETTINGS = [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'aperture', label: 'Maximum aperture / bank pitch', type: 'range', min: 0.35, max: 0.98, step: 0.01, default: 0.86 },
      { key: 'fluxUse', label: 'Available cone flux used', type: 'range', min: 0.3, max: 1, step: 0.01, default: 0.88 },
      { key: 'layout', label: 'Aim-to-bank assignment', type: 'select', options: [{ value: 'smooth', label: 'Smooth optical surface' }, { value: 'capacity', label: 'Capacity first' }], default: 'capacity' },
      { key: 'shadowSamples', label: 'Angular shadow quadrature per axis (0 disables)', type: 'range', min: 0, max: 24, step: 4, default: 12 },
      { key: 'bank', label: 'Envelope bank', type: 'select', options: ['auto', '+x', '-x', '+y', '-y', '+z', '-z'], default: 'auto' },
      { key: 'aimPasses', label: 'Analytical aim refinement passes', type: 'range', min: 0, max: 4, step: 1, default: 4 },
      { key: 'aimStep', label: 'Aim refinement step (paint cells)', type: 'range', min: 0.5, max: 4, step: 0.5, default: 2.5 },
      { key: 'imagePasses', label: 'Finite-image flux balancing passes', type: 'range', min: 0, max: 20, step: 1, default: 6 },
      { key: 'edgeBlend', label: 'Blurred edge reference blend', type: 'range', min: 0, max: 1, step: 0.05, default: 0.85 },
      { key: 'clusterPasses', label: 'Paint clustering passes', type: 'range', min: 2, max: 12, step: 1, default: 7 },
  ];
  RF.Solvers.register({
    id: 'bench-kimik31pro-max--focused-clusters', name: 'Focused paint clusters (static)', version: '0.3', modes: ['paint'],
    settings: STATIC_SETTINGS, solve,
  });

  // Optional traced tuner. Only this -auto registration calls tools.trace; the static solver above
  // remains purely algebraic. Candidates differ only in the static solver's exposed settings.
  function autoSolve(input, settings, tools) {
    const base = {}; for (const f of STATIC_SETTINGS) base[f.key] = f.default;
    base.minDistance = settings.minDistance;
    const goal = settings.goal, rays = Math.max(1, settings.rays | 0), records = [], errors = [], seen = new Set();
    const budgetMs = tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 60000;
    const deadline = Date.now() + Math.max(1000, Math.min(50000, budgetMs - 1000));
    const rayLimit = tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : Infinity;
    let raysUsed = 0;

    function rank(list) {
      const maxOP = Math.max(1e-300, ...list.map((r) => r.onPaint)), maxPeak = Math.max(1e-300, ...list.map((r) => r.peak));
      for (const r of list) {
        const light = r.onPaint / maxOP, peak = r.peak / maxPeak;
        if (goal === 'throw') r.score = peak * (0.25 + 0.75 * clamp(r.fid / 0.70, 0, 1));
        else if (goal === 'efficient') r.score = light * (0.35 + 0.65 * clamp(r.fid / 0.70, 0, 1));
        else r.score = r.fid + 0.02 * light;
      }
      return list.slice().sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }

    function candidate(label, changes) {
      const config = Object.assign({}, base, changes || {}, { minDistance: settings.minDistance });
      const key = JSON.stringify(config); if (seen.has(key) || Date.now() >= deadline || raysUsed + rays > rayLimit) return false;
      seen.add(key);
      let out;
      try { out = solve(input, config); } catch (e) { errors.push(label + ': ' + e.message); return false; }
      if (!out || !Array.isArray(out.surfaces) || !out.surfaces.length) { errors.push(label + ': no surfaces'); return false; }
      if (Date.now() >= deadline) return false;
      let tr;
      try {
        tr = tools.trace(out.surfaces, { rays, seed: input.seed | 0, paint: input.paint.cells }); raysUsed += rays;
      } catch (e) { errors.push(label + ': ' + e.message); return false; }
      const f = tr.fidelity || {}, rec = { label, config, out, tr, fid: f.fidelity || 0, onPaint: f.onPaint || 0, peak: tr.peakCd || 0 };
      records.push(rec);
      if (tools.preview) tools.preview(out.surfaces, { label: label + ' · ' + goal, trace: tr, note: 'Static-geometry candidate ' + records.length });
      if (tools.progress) tools.progress(Math.min(0.95, records.length / 12));
      return true;
    }

    const banks = settings.bankSearch ? ['auto', '+x', '-x', '+y', '-y', '+z', '-z'] : ['auto'];
    for (const bank of banks) candidate('bank ' + bank, Object.assign({ bank }, goal === 'faithful' ? {} : { fluxUse: 1 }));
    if (!records.length) {
      const out = solve(input, base); out.notes = ['Auto could not trace a candidate; returning the static default.'].concat(out.notes || [], errors);
      return out;
    }
    const winner = rank(records)[0], bank = winner.config.bank;
    const variants = goal === 'throw' ? [
      { fluxUse: 1, aimPasses: 2, imagePasses: 4 },
      { fluxUse: 1, aperture: 0.94 },
      { fluxUse: 1, aperture: 0.70, aimPasses: 4 },
      { fluxUse: 1, aimPasses: 0, imagePasses: 0 },
      { fluxUse: 1, layout: 'smooth' },
    ] : goal === 'efficient' ? [
      { fluxUse: 1 },
      { fluxUse: 1, aperture: 0.94, aimPasses: 2, imagePasses: 4 },
      { fluxUse: 0.96, aperture: 0.74, aimPasses: 4 },
      { fluxUse: 1, aimPasses: 0, imagePasses: 0 },
      { fluxUse: 1, layout: 'smooth' },
    ] : [
      { aimPasses: 2, aimStep: 1.5, imagePasses: 8 },
      { aimPasses: 4, aimStep: 1.5, imagePasses: 8 },
      { edgeBlend: 0.55 },
      { aperture: 0.74, fluxUse: 0.94 },
      { layout: 'smooth' },
    ];
    for (let i = 0; i < variants.length; i++) candidate('refine ' + (i + 1) + ' @ ' + bank, Object.assign({ bank }, variants[i]));
    // Confirm only the finalists with substantially less shot noise; geometry construction is reused.
    const finalists = rank(records).slice(0, 3), confirmRays = Math.min(1000000, rays * 3);
    for (const rec of finalists) {
      if (confirmRays <= rays || Date.now() >= deadline || raysUsed + confirmRays > rayLimit) continue;
      try {
        const tr = tools.trace(rec.out.surfaces, { rays: confirmRays, seed: input.seed | 0, paint: input.paint.cells }); raysUsed += confirmRays;
        const f = tr.fidelity || {}; rec.tr = tr; rec.fid = f.fidelity || 0; rec.onPaint = f.onPaint || 0; rec.peak = tr.peakCd || 0; rec.evalRays = confirmRays;
        if (tools.preview) tools.preview(rec.out.surfaces, { label: 'confirm ' + rec.label + ' · ' + goal, trace: tr });
      } catch (e) { errors.push('confirm ' + rec.label + ': ' + e.message); }
    }
    const best = rank(finalists)[0], f = best.tr.fidelity || {};
    const summary = 'Auto ' + goal + ': ' + records.length + ' candidates, ' + (raysUsed / 1e6).toFixed(2) + 'M common-seed rays; chose ' + best.label +
      ' · fidelity ' + (100 * best.fid).toFixed(1) + '% · on paint ' + (100 * best.onPaint).toFixed(1) + '% · peak ' + Math.round(best.peak) + ' cd' + (best.evalRays ? ' · confirmed at ' + best.evalRays.toLocaleString() + ' rays.' : '.');
    return Object.assign({}, best.out, { notes: [summary].concat(best.out.notes || [], errors.slice(0, 3)) });
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro-max--focused-clusters-auto', name: 'Focused clusters (traced tuner)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
      { key: 'rays', label: 'Rays per candidate', type: 'number', min: 50000, max: 1000000, step: 50000, default: 300000 },
      { key: 'bankSearch', label: 'Search envelope banks', type: 'checkbox', default: true },
    ],
    solve: autoSolve,
  });
})();
