/* Bundled model solver: GPT-6 Sol (Codex), Flux solver benchmark run 2026-09-26 (workspace work-sol6-codex-flux-solver-20260926-0446).
 * Copied verbatim from that run's solvers/solver.js (sha256 ea81cb9027bc…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* Flux: static, finite-source reflector design. No ray tracing is used here.
 * A common forward-opening paraboloid supplies non-overlapping placement cells.
 * Each cell becomes an ellipsoidal mirror; a first-order image model allocates
 * its aperture. This file depends only on the documented RF solver environment.
 */
(function () {
  'use strict';
  const { V, Geo, Source, Engine } = RF;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const world = (T, u, v) => V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));

  function aims(paint, size, count) {
    const R = paint.res, cell = size / R, samples = [];
    for (let k = 0; k < R * R; k++) if (paint.cells[k] > 0) {
      const w = Math.pow(paint.cells[k], 0.35);
      samples.push({ k, x: ((k % R) + 0.5) * cell - size / 2,
        y: (Math.floor(k / R) + 0.5) * cell - size / 2, w });
    }
    count = Math.min(count, samples.length);
    if (!count) return [];
    const nearest = (x, y) => {
      let best = samples[0], d = Infinity;
      for (const p of samples) { const q = (p.x - x) ** 2 + (p.y - y) ** 2; if (q < d) { d = q; best = p; } }
      return best;
    };
    // Farthest-point seeding avoids aligning all centres with row-major stripes.
    const centres = [], distance = new Float64Array(samples.length).fill(Infinity);
    let next = Math.floor(samples.length / 2);
    for (let i = 0; i < count; i++) {
      const p = samples[next]; centres.push({ x: p.x, y: p.y });
      let far = -1;
      for (let j = 0; j < samples.length; j++) {
        const s = samples[j], d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        distance[j] = Math.min(distance[j], d);
        const merit = distance[j] * Math.sqrt(s.w);
        if (merit > far) { far = merit; next = j; }
      }
    }
    for (let pass = 0; pass < 12; pass++) {
      const acc = centres.map(() => ({ x: 0, y: 0, w: 0, cells: [] }));
      for (const p of samples) {
        let best = 0, d = Infinity;
        for (let i = 0; i < count; i++) {
          const c = centres[i], dd = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
          if (dd < d) { d = dd; best = i; }
        }
        const a = acc[best]; a.x += p.w * p.x; a.y += p.w * p.y; a.w += p.w; a.cells.push(p.k);
      }
      for (let i = 0; i < count; i++) if (acc[i].w > 0) {
        const a = acc[i], x = a.x / a.w, y = a.y / a.w;
        const ix = Math.floor((x + size / 2) / cell), iy = Math.floor((y + size / 2) / cell);
        const p = ix >= 0 && iy >= 0 && ix < R && iy < R && paint.cells[iy * R + ix] > 0 ? { x, y } : nearest(x, y);
        centres[i] = { x: p.x, y: p.y, cells: a.cells, area: a.cells.length * cell * cell };
      }
    }
    return centres;
  }

  function bowl(input, centre, keep, reach) {
    const L = input.source.pos, axis = V.norm(V.sub(centre, L));
    const dirs = [], maxR = Math.max(...input.envelope.half) * 4 + V.dist(L, input.envelope.center);
    // Angular integration of emission and envelope capacity, NOT an optical trace.
    // No source samples, mirror intersections, reflected paths or target hits.
    for (let i = 0; i < 1536; i++) {
      const z = 1 - 2 * (i + 0.5) / 1536, t = i * 2.399963229728653;
      const d = [Math.sqrt(1 - z * z) * Math.cos(t), Math.sqrt(1 - z * z) * Math.sin(t), z];
      const w = Source.intensity(input.source, Math.acos(clamp(V.dot(d, V.norm(input.source.axis)), -1, 1)));
      if (!(w > 0)) continue;
      const iv = Geo.envInterval(input.envelope, L, d), b = (1 - V.dot(axis, d)) / 2;
      if (iv[1] > Math.max(keep, iv[0]) && b > 0.02) dirs.push({ w, b, lo: Math.max(keep, iv[0]) * b, hi: iv[1] * b });
    }
    let f = maxR / 8, merit = -1;
    const maxF = dirs.reduce((m, d) => Math.max(m, d.hi), 0);
    for (let j = 1; j <= 40; j++) {
      const q = maxF * j / 41;
      let m = 0;
      for (const d of dirs) if (q > d.lo && q < d.hi) m += d.w * Math.pow(q / d.b, 1.5);
      if (m > merit) { merit = m; f = q; }
    }
    f = Math.max(maxR * 1e-5, f * reach);
    const [U, W] = V.basis(axis);
    const point = (u, v) => V.add(L, V.add(V.mul(axis, (u * u + v * v) / (4 * f) - f), V.add(V.mul(U, u), V.mul(W, v))));
    const bounds = [[Infinity, -Infinity], [Infinity, -Infinity]];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const e = input.envelope, q = V.sub(V.add(e.center, [x * e.half[0], y * e.half[1], z * e.half[2]]), L);
      for (const [i, b] of [[0, U], [1, W]]) { const p = V.dot(q, b); bounds[i][0] = Math.min(bounds[i][0], p); bounds[i][1] = Math.max(bounds[i][1], p); }
    }
    return { f, axis, U, W, point, bounds };
  }

  function placements(input, B, keep, count) {
    const e = input.envelope, L = input.source.pos, bounds = B.bounds;
    const valid = (u, v) => {
      const P = B.point(u, v), d = V.sub(P, L), r = V.len(d);
      return r > keep * 1.01 && Geo.envInside(e, P, -0.002) && Source.intensity(input.source,
        Math.acos(clamp(V.dot(V.mul(d, 1 / r), V.norm(input.source.axis)), -1, 1))) > 0.005;
    };
    let cells = 0;
    for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++)
      if (valid(bounds[0][0] + (i + 0.5) / 48 * (bounds[0][1] - bounds[0][0]), bounds[1][0] + (j + 0.5) / 48 * (bounds[1][1] - bounds[1][0]))) cells++;
    const area = (bounds[0][1] - bounds[0][0]) * (bounds[1][1] - bounds[1][0]) * cells / 2304;
    if (!(area > 0)) return [];
    let pitch = Math.sqrt(area / (count * 1.08)), out;
    for (let pass = 0; pass < 5; pass++) {
      out = [];
      const nx = Math.ceil((bounds[0][1] - bounds[0][0]) / pitch), ny = Math.ceil((bounds[1][1] - bounds[1][0]) / pitch);
      const px = (bounds[0][1] - bounds[0][0]) / nx, py = (bounds[1][1] - bounds[1][0]) / ny;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const u = bounds[0][0] + (i + 0.5) * px, v = bounds[1][0] + (j + 0.5) * py;
        if (valid(u, v)) {
          const P = B.point(u, v), r = V.dist(P, L);
          const intensity = Source.intensity(input.source, Math.acos(clamp(V.dot(V.norm(V.sub(P, L)), V.norm(input.source.axis)), -1, 1)));
          out.push({ P, u, v, px, py, r, merit: intensity / r });
        }
      }
      if (out.length >= count) break;
      pitch *= 0.88;
    }
    out.sort((a, b) => b.merit - a.merit || a.u - b.u || a.v - b.v);
    return out.slice(0, count);
  }

  // Analytic linear image map: changing the source position changes the
  // incident direction, reflection transforms that change, and the target
  // plane removes its component along the chief outgoing direction.
  function imageMap(P, Z, L, T, n, direction) {
    const r = V.dist(P, L), D = V.dist(P, Z), d = V.norm(V.sub(P, L)), a = V.norm(V.sub(Z, P));
    const ds = V.mul(V.sub(direction, V.mul(d, V.dot(d, direction))), -1 / r);
    const da = V.reflect(ds, n);
    const at = V.mul(V.sub(da, V.mul(a, V.dot(T.n, da) / V.dot(T.n, a))), D);
    return [V.dot(at, T.tu), V.dot(at, T.tv)];
  }
  function targetProjection(direction, a, T) {
    const q = V.sub(direction, V.mul(a, V.dot(T.n, direction) / V.dot(T.n, a)));
    return [V.dot(q, T.tu), V.dot(q, T.tv)];
  }

  function makeFacet(input, T, B, p, aim, index, keep, fill, spread) {
    const L = input.source.pos, Z = world(T, aim.x, aim.y), P = p.P, a = V.norm(V.sub(Z, P));
    const sh = V.norm(V.sub(L, P)), n = V.norm(V.add(sh, a)), D = V.dist(Z, P);
    if (V.dot(n, sh) < 0.08 || Math.abs(V.dot(T.n, a)) < 0.05) return null;
    const project = (d) => V.sub(d, V.mul(n, V.dot(d, n)));
    let du = V.mul(project(V.add(B.U, V.mul(B.axis, p.u / (2 * B.f)))), p.px * fill / 2);
    let dv = V.mul(project(V.add(B.W, V.mul(B.axis, p.v / (2 * B.f)))), p.py * fill / 2);
    const covariance = [0, 0, 0], C = Source.extentCov(input.source), maps = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => imageMap(P, Z, L, T, n, v));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      covariance[0] += C[3 * i + j] * maps[i][0] * maps[j][0];
      covariance[1] += C[3 * i + j] * maps[i][0] * maps[j][1];
      covariance[2] += C[3 * i + j] * maps[i][1] * maps[j][1];
    }
    const apU = targetProjection(du, a, T), apV = targetProjection(dv, a, T);
    const apVar = (apU[0] ** 2 + apU[1] ** 2 + apV[0] ** 2 + apV[1] ** 2) / 3;
    const desired = aim.area * spread * spread;
    const q = Math.sqrt(Math.max(0, 2 * desired - covariance[0] - covariance[2]) / Math.max(1e-12, apVar));
    const di = D / (1 + Math.min(q, 12));
    const fq = Geo.facetQuadric(P, L, Z, di);
    const A = Math.sqrt(sum(fq.A.map((x) => x * x)));
    const safe = (scale) => {
      const u = V.mul(du, scale), v = V.mul(dv, scale), R = Math.max(V.len(V.add(u, v)), V.len(V.sub(u, v)));
      if (2 * A * R >= 0.8) return false;
      // Frobenius norm bounds the quadratic form. The near-sheet sag cannot
      // exceed the small root of A*z²-z+A*R²=0.
      const sag = A > 0 ? 2 * A * R * R / (1 + Math.sqrt(1 - 4 * A * A * R * R)) : 0;
      if (p.r - Math.hypot(R, sag) < keep * 1.001) return false;
      const h = u.map((x, i) => Math.abs(x) + Math.abs(v[i]) + Math.abs(n[i]) * sag + Math.max(...input.envelope.half) * 1e-5);
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
        if (!Geo.envInside(input.envelope, V.add(P, [x * h[0], y * h[1], z * h[2]]), -1e-5)) return false;
      return true;
    };
    let scale = 1;
    if (!safe(scale)) { let lo = 0, hi = 1; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (safe(m)) lo = m; else hi = m; } scale = lo; }
    if (scale < 0.08) return null;
    du = V.mul(du, scale); dv = V.mul(dv, scale);
    const area = 4 * V.len(V.cross(du, dv));
    const w = Source.intensity(input.source, Math.acos(clamp(V.dot(V.neg(sh), V.norm(input.source.axis)), -1, 1)));
    const capacity = input.limits.reflectivity * w * area * V.dot(sh, n) / (p.r * p.r * Source.totalIntegral(input.source));
    return { P, Z, n, du, dv, di, D, covariance, capacity, aim, index, placement: p };
  }

  function gaussianKernel(input, T, facet, scale) {
    const R = input.paint.res, cell = input.target.size / R, a = V.norm(V.sub(facet.Z, facet.P));
    const q = 1 - facet.D / facet.di, u = targetProjection(V.mul(facet.du, scale * q), a, T), v = targetProjection(V.mul(facet.dv, scale * q), a, T);
    let [xx, xy, yy] = facet.covariance;
    xx += (u[0] ** 2 + v[0] ** 2) / 3 + cell * cell / 18;
    xy += (u[0] * u[1] + v[0] * v[1]) / 3;
    yy += (u[1] ** 2 + v[1] ** 2) / 3 + cell * cell / 18;
    const det = Math.max(1e-12, xx * yy - xy * xy), norm = cell * cell / (2 * Math.PI * Math.sqrt(det));
    const cx = (facet.aim.x + input.target.size / 2) / cell, cy = (facet.aim.y + input.target.size / 2) / cell;
    const hx = 3.4 * Math.sqrt(xx) / cell, hy = 3.4 * Math.sqrt(yy) / cell, indices = [], values = [];
    for (let j = Math.max(0, Math.floor(cy - hy)); j < Math.min(R, Math.ceil(cy + hy)); j++)
      for (let i = Math.max(0, Math.floor(cx - hx)); i < Math.min(R, Math.ceil(cx + hx)); i++) {
        let density = 0;
        for (const sx of [0.25, 0.75]) for (const sy of [0.25, 0.75]) {
          const dx = (i + sx - cx) * cell, dy = (j + sy - cy) * cell;
          density += Math.exp(-0.5 * (yy * dx * dx - 2 * xy * dx * dy + xx * dy * dy) / det) * norm / 4;
        }
        if (density > 1e-8) { indices.push(j * R + i); values.push(density); }
      }
    return { indices, values };
  }

  function polygonKernel(input, T, f, scale) {
    const src = input.source;
    if (src.kind !== 'planar') return gaussianKernel(input, T, f, scale);
    const fr = Source.frame(src), a = V.norm(V.sub(f.Z, f.P));
    const sourceU = imageMap(f.P, f.Z, src.pos, T, f.n, fr.u).map((x) => x * (src.shape === 'disc' ? src.radius : src.w / 2));
    const sourceV = imageMap(f.P, f.Z, src.pos, T, f.n, fr.v).map((x) => x * (src.shape === 'disc' ? src.radius : src.h / 2));
    const q = (1 - f.D / f.di) * scale;
    const apU = targetProjection(V.mul(f.du, q), a, T), apV = targetProjection(V.mul(f.dv, q), a, T);
    const areaOf = (poly) => Math.abs(poly.reduce((s, p, i) => { const v = poly[(i + 1) % poly.length]; return s + p[0] * v[1] - p[1] * v[0]; }, 0)) / 2;
    const rectangle = (u, v) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [u[0] * x + v[0] * y, u[1] * x + v[1] * y]);
    let primary = src.shape === 'disc' ? Array.from({ length: 32 }, (_, i) => {
      const t = 2 * Math.PI * i / 32; return [sourceU[0] * Math.cos(t) + sourceV[0] * Math.sin(t), sourceU[1] * Math.cos(t) + sourceV[1] * Math.sin(t)];
    }) : rectangle(sourceU, sourceV);
    let secondaryU = apU, secondaryV = apV, discSecondary = false;
    if (areaOf(rectangle(apU, apV)) > areaOf(primary)) {
      primary = rectangle(apU, apV); secondaryU = sourceU; secondaryV = sourceV; discSecondary = src.shape === 'disc';
    }
    const area = areaOf(primary), R = input.paint.res, cell = input.target.size / R;
    if (area < cell * cell * 1e-6) return gaussianKernel(input, T, f, scale);
    const offsets = [];
    if (Math.hypot(...secondaryU) + Math.hypot(...secondaryV) < cell * 0.025) offsets.push([0, 0, 1]);
    else if (discSecondary) {
      for (let i = 0; i < 32; i++) { const r = Math.sqrt((i + 0.5) / 32), t = i * 2.399963229728653;
        offsets.push([r * (secondaryU[0] * Math.cos(t) + secondaryV[0] * Math.sin(t)), r * (secondaryU[1] * Math.cos(t) + secondaryV[1] * Math.sin(t)), 1 / 32]); }
    } else {
      // Five-node Gauss-Legendre quadrature integrates the other uniform aperture.
      const nodes = [-0.9061798459, -0.5384693101, 0, 0.5384693101, 0.9061798459], weights = [0.1184634425, 0.2393143352, 0.2844444444, 0.2393143352, 0.1184634425];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) offsets.push([
        nodes[i] * secondaryU[0] + nodes[j] * secondaryV[0], nodes[i] * secondaryU[1] + nodes[j] * secondaryV[1], weights[i] * weights[j]]);
    }
    const clip = (poly, axis, bound, greater) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], pin = greater ? p[axis] >= bound : p[axis] <= bound, qin = greater ? q[axis] >= bound : q[axis] <= bound;
        if (pin) out.push(p);
        if (pin !== qin) { const t = (bound - p[axis]) / (q[axis] - p[axis]); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
      return out;
    };
    const grid = new Map();
    for (const [dx, dy, w] of offsets) {
      const poly = primary.map((p) => [(p[0] + dx + f.aim.x + input.target.size / 2) / cell, (p[1] + dy + f.aim.y + input.target.size / 2) / cell]);
      const loX = Math.max(0, Math.floor(Math.min(...poly.map((p) => p[0])))), hiX = Math.min(R, Math.ceil(Math.max(...poly.map((p) => p[0]))));
      const loY = Math.max(0, Math.floor(Math.min(...poly.map((p) => p[1])))), hiY = Math.min(R, Math.ceil(Math.max(...poly.map((p) => p[1]))));
      for (let j = loY; j < hiY; j++) for (let i = loX; i < hiX; i++) {
        const p = clip(clip(clip(clip(poly, 0, i, true), 0, i + 1, false), 1, j, true), 1, j + 1, false);
        if (p.length >= 3) { const k = j * R + i; grid.set(k, (grid.get(k) || 0) + areaOf(p) * cell * cell * w / area); }
      }
    }
    return { indices: Array.from(grid.keys()), values: Array.from(grid.values()) };
  }

  function fit(paint, kernels, caps, exposure, gapWeight, passes) {
    const n = paint.length, grid = new Float64Array(n), x = new Float64Array(kernels.length);
    const norm = kernels.map((k) => k.values.reduce((s, v, j) => s + v * v * (paint[k.indices[j]] > 0 ? 1 / Math.max(0.15, paint[k.indices[j]]) : gapWeight), 0));
    for (let pass = 0; pass < passes; pass++) for (let i = 0; i < kernels.length; i++) {
      const k = kernels[i]; let dot = 0;
      for (let j = 0; j < k.indices.length; j++) {
        const at = k.indices[j], w = paint[at] > 0 ? 1 / Math.max(0.15, paint[at]) : gapWeight;
        dot += w * k.values[j] * (paint[at] - grid[at]);
      }
      const next = clamp(x[i] + dot / Math.max(1e-15, norm[i]), 0, exposure > 0 ? caps[i] / exposure : 1e30), dx = next - x[i];
      x[i] = next;
      for (let j = 0; j < k.indices.length; j++) grid[k.indices[j]] += dx * k.values[j];
    }
    return x;
  }

  function refine(input, settings, T, B, keep, facets, kernels, weights, caps, exposure, kernel) {
    const paint = input.paint.cells, cell = input.target.size / input.paint.res;
    const penalty = (k) => paint[k] > 0 ? 1 / Math.max(0.15, paint[k]) : settings.gapWeight;
    for (let pass = 0; pass < settings.refine; pass++) {
      const grid = new Float64Array(paint.length);
      for (let i = 0; i < kernels.length; i++) for (let j = 0; j < kernels[i].indices.length; j++) grid[kernels[i].indices[j]] += weights[i] * kernels[i].values[j];
      for (let i = 0; i < facets.length; i++) {
        const old = kernels[i], f = facets[i];
        for (let j = 0; j < old.indices.length; j++) grid[old.indices[j]] -= weights[i] * old.values[j];
        const step = Math.min(cell * 0.7, Math.sqrt(f.aim.area) * 0.25) / (pass + 1);
        let best = { facet: f, kernel: old, weight: weights[i], improvement: -Infinity };
        for (const [dx, dy] of [[0, 0], [-step, 0], [step, 0], [0, -step], [0, step]]) {
          const aim = { ...f.aim, x: f.aim.x + dx, y: f.aim.y + dy };
          const ix = Math.floor((aim.x + input.target.size / 2) / cell), iy = Math.floor((aim.y + input.target.size / 2) / cell), R = input.paint.res;
          if (ix < 0 || iy < 0 || ix >= R || iy >= R || !(paint[iy * R + ix] > 0)) continue;
          const candidate = dx === 0 && dy === 0 ? f : makeFacet(input, T, B, f.placement, aim, f.index, keep, settings.fill, settings.spread);
          if (!candidate) continue;
          const scale = Math.sqrt(clamp(weights[i] * exposure / candidate.capacity, 0, 1));
          const k = dx === 0 && dy === 0 ? old : kernel(input, T, candidate, scale);
          let dot = 0, norm = 0;
          for (let j = 0; j < k.indices.length; j++) { const at = k.indices[j], v = k.values[j], w = penalty(at); dot += w * v * (paint[at] - grid[at]); norm += w * v * v; }
          const weight = clamp(dot / Math.max(norm, 1e-15), 0, exposure > 0 ? candidate.capacity / exposure : 1e30);
          const improvement = 2 * weight * dot - weight * weight * norm;
          if (improvement > best.improvement) best = { facet: candidate, kernel: k, weight, improvement };
        }
        facets[i] = best.facet; kernels[i] = best.kernel; weights[i] = best.weight; caps[i] = best.facet.capacity;
        for (let j = 0; j < best.kernel.indices.length; j++) grid[best.kernel.indices[j]] += best.weight * best.kernel.values[j];
      }
      // Aperture area changes the defocused image. Update that analytic image
      // before the next fit; this is algebraic image fitting, never tracing.
      kernels = facets.map((f, i) => kernel(input, T, f, Math.sqrt(clamp(weights[i] * exposure / caps[i], 0, 1))));
      weights = fit(paint, kernels, caps, exposure, settings.gapWeight, 40);
    }
    return { kernels, weights };
  }

  function solve(input, settings) {
    const count = Math.max(0, Math.floor(input.limits.maxFacets)), paint = input.paint;
    const keep = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0), surfaces = [], intent = [];
    if (!count || !(input.limits.reflectivity > 0) || !paint.cells.some((x) => x > 0)) return { surfaces, intent, notes: ['Empty painting, zero reflectivity, or zero facet allowance.'] };
    const T = Engine.designFrame(input.target), targetAims = aims(paint, input.target.size, count);
    const mass = sum(paint.cells), R = paint.res, cell = input.target.size / R;
    let u = 0, v = 0;
    for (let k = 0; k < paint.cells.length; k++) { u += paint.cells[k] * (((k % R) + 0.5) * cell - input.target.size / 2); v += paint.cells[k] * ((Math.floor(k / R) + 0.5) * cell - input.target.size / 2); }
    const B = bowl(input, world(T, u / mass, v / mass), keep, settings.reach);
    const positions = placements(input, B, keep, targetAims.length);
    if (!positions.length) return { surfaces, intent: targetAims.map((a) => ({ facet: null, cells: a.cells.map((k) => [k, paint.cells[k]]) })), notes: ['No emitting bowl area fits the requested clearance.'] };
    const selectedAims = positions.length < targetAims.length ? aims(paint, input.target.size, positions.length) : targetAims;
    // A deterministic shuffle spreads differently oriented source images across
    // the painting instead of giving one side all the narrow/broad images.
    positions.sort((a, b) => b.r - a.r || a.u - b.u);
    const facets = [];
    for (let i = 0; i < positions.length; i++) {
      const j = (i * 0.6180339887498949) % 1;
      const available = selectedAims.map((a, k) => ({ a, k })).filter((x) => !x.a.used);
      const aim = available[Math.min(available.length - 1, Math.floor(j * available.length))].a; aim.used = true;
      const facet = makeFacet(input, T, B, positions[i], aim, i, keep, settings.fill, settings.spread);
      if (facet) facets.push(facet);
      else intent.push({ facet: null, cells: aim.cells.map((k) => [k, paint.cells[k]]) });
    }
    if (!facets.length) return { surfaces, intent, notes: ['No safe facet apertures fit.'] };
    const caps = facets.map((f) => f.capacity);
    const kernel = settings.imageModel === 'polygon' ? polygonKernel : gaussianKernel;
    let kernels = facets.map((f) => kernel(input, T, f, 1));
    let weights = fit(paint.cells, kernels, caps, 0, settings.gapWeight, 50);
    const ratios = weights.map((x, i) => x > 0.0001 ? caps[i] / x : Infinity).filter(Number.isFinite).sort((a, b) => a - b);
    const exposure = (ratios[Math.floor(ratios.length * 0.4)] || 0) * settings.utilization;
    for (let pass = 0; pass < 3; pass++) {
      weights = fit(paint.cells, kernels, caps, exposure, settings.gapWeight, 40);
      kernels = facets.map((f, i) => kernel(input, T, f, Math.sqrt(clamp(weights[i] * exposure / caps[i], 0, 1))));
    }
    ({ kernels, weights } = refine(input, settings, T, B, keep, facets, kernels, weights, caps, exposure, kernel));
    let used = 0;
    for (let i = 0; i < facets.length; i++) {
      const f = facets[i], fraction = clamp(weights[i] * exposure / caps[i], 0, 1);
      if (fraction < 0.001) { intent.push({ facet: null, cells: f.aim.cells.map((k) => [k, paint.cells[k]]) }); continue; }
      const scale = Math.sqrt(fraction), du = V.mul(f.du, scale), dv = V.mul(f.dv, scale), id = 'F' + f.index;
      const pts3 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => V.add(f.P, V.add(V.mul(du, a), V.mul(dv, b))));
      surfaces.push({ type: 'facet', id, P: f.P, S0: input.source.pos.slice(), Z: f.Z, flat: false, di: f.di,
        clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } });
      intent.push({ facet: id, cells: f.aim.cells.map((k) => [k, paint.cells[k]]) }); used += caps[i] * fraction;
    }
    return { surfaces, intent, notes: [
      'Static bowl + finite-source image fit; no ray tracing in solve().',
      'Bowl focal length ' + B.f.toFixed(2) + ' mm; ' + surfaces.length + ' facets; analytic collected share ' + (100 * used).toFixed(2) + '% (estimate, not measured).',
      'Whole curved patches bounded conservatively inside the envelope and outside ' + keep.toFixed(2) + ' mm clearance.'
    ] };
  }

  RF.Solvers.register({ id: 'finite-image', name: 'Finite-image bowl', version: '1.0', modes: ['paint'], settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'reach', label: 'Bowl distance factor', type: 'range', min: 0.6, max: 1.6, step: 0.05, default: 1 },
    { key: 'fill', label: 'Aperture fill', type: 'range', min: 0.3, max: 0.98, step: 0.02, default: 0.9 },
    { key: 'spread', label: 'Image spread / aim spacing', type: 'range', min: 0, max: 0.9, step: 0.05, default: 0.5 },
    { key: 'gapWeight', label: 'Dark-gap penalty', type: 'range', min: 0.2, max: 5, step: 0.2, default: 1.4 },
    { key: 'utilization', label: 'Collection fraction', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.8 },
    { key: 'imageModel', label: 'Analytic image model', type: 'select', options: ['polygon', 'gaussian'], default: 'polygon' },
    { key: 'refine', label: 'Analytic aim refinement', type: 'range', min: 0, max: 3, step: 1, default: 2 },
  ], solve });
})();

/* Optional tuner. Appended separately so the scored static solver above is
 * unchanged. Only this -auto registration calls tools.trace(). */
(function () {
  'use strict';
  const staticDef = RF.Solvers.get('finite-image');
  const staticDefaults = RF.Solvers.defaults(staticDef);
  const definitions = [
    { name: 'baseline', changes: {} },
    { name: 'edge fidelity', changes: { gapWeight: 2.2, utilization: 0.65, refine: 3 } },
    { name: 'collection', changes: { fill: 0.96, utilization: 1.15, refine: 3 } },
    { name: 'longer distance', changes: { reach: 1.15, utilization: 0.85, refine: 3 } },
  ];
  const numeric = (x) => typeof x === 'number' && Number.isFinite(x) ? x : null;
  function metrics(trace) {
    const f = trace && trace.fidelity;
    if (!f || numeric(f.fidelity) === null || numeric(f.onPaint) === null || numeric(f.gapsDark) === null) return null;
    if ([f.fidelity, f.onPaint, f.gapsDark].some((x) => x < 0 || x > 1 + 1e-6)) return null;
    return { fidelity: f.fidelity, onPaint: f.onPaint, gapsDark: f.gapsDark,
      peakCd: numeric(trace.peakCd), peakNoise: numeric(trace.peakNoise),
      fidelityNoiseCeiling: numeric(f.fidelityNoiseCeiling) };
  }
  function rank(rows, goal) {
    const measured = rows.filter((r) => r.metrics);
    if (!measured.length) return [];
    const bestF = Math.max(...measured.map((r) => r.metrics.fidelity));
    const reference = measured.find((r) => r.index === 0) || measured[0];
    const brightEnough = reference.metrics.onPaint * 0.25;
    const bestShape = measured.slice().sort((a, b) => b.metrics.fidelity - a.metrics.fidelity || a.index - b.index)[0];
    // At each ranking stage, throw/efficiency retain that stage's best shape
    // to within six fidelity points and eight gap-darkness points. Finalists
    // are rechecked against baseline, not every pilot candidate at high rays.
    // A low-flux candidate cannot win by being almost dark. These are selection
    // rules, not scorer modifications.
    const eligible = measured.filter((r) => r.metrics.onPaint >= brightEnough &&
      (goal === 'faithful' || (r.metrics.fidelity >= bestF - 0.06 && r.metrics.gapsDark >= bestShape.metrics.gapsDark - 0.08)));
    const pool = eligible.length ? eligible : [bestShape];
    const value = (r) => {
      const m = r.metrics;
      if (goal === 'efficient') return m.onPaint;
      if (goal === 'throw') return m.peakCd !== null && m.peakCd > 0 && m.peakNoise !== null ? m.peakCd / (1 + m.peakNoise) : -Infinity;
      return m.fidelity;
    };
    return pool.sort((a, b) => value(b) - value(a) || b.metrics.fidelity - a.metrics.fidelity || b.metrics.onPaint - a.metrics.onPaint || a.index - b.index);
  }

  async function tune(input, settings, tools) {
    const baseSettings = { ...staticDefaults, minDistance: settings.minDistance };
    const baseline = staticDef.solve(input, baseSettings);
    const finish = (row, rows, rays, why) => ({ ...row.output,
      notes: [
        'Autotuner goal ' + settings.goal + ': ' + row.name + '; ' + rays.toLocaleString() + ' internal tracing rays. ' + why,
        'Selected static settings: ' + JSON.stringify(row.settings),
        ...rows.map((r) => r.metrics ? r.name + ': pilot/final ' + r.rays.toLocaleString() + ' rays; fidelity ' + (100 * r.metrics.fidelity).toFixed(2) + '%; on paint ' + (100 * r.metrics.onPaint).toFixed(2) + '%; gaps dark ' + (100 * r.metrics.gapsDark).toFixed(2) + '%; peak ' + (r.metrics.peakCd === null ? 'unavailable' : r.metrics.peakCd.toFixed(0) + ' cd +/- ' + (r.metrics.peakNoise === null ? 'unavailable' : (100 * r.metrics.peakNoise).toFixed(1) + '%')) : r.name + ': ' + (r.failure || 'not measured')),
        ...(row.output.notes || []).map((n) => 'Static design: ' + n),
      ],
      extras: { auto: { goal: settings.goal, chosen: row.name, chosenSettings: row.settings, rays,
        candidates: rows.map((r) => ({ name: r.name, settings: r.settings, rays: r.rays || 0, metrics: r.metrics || null,
          pilotRays: r.pilotRays || 0, pilotMetrics: r.pilotMetrics || null, failure: r.failure || null })) } },
    });
    const baseRow = { index: 0, name: definitions[0].name, settings: baseSettings, output: baseline };
    if (!baseline.surfaces.length) return finish(baseRow, [baseRow], 0, 'No static geometry to tune.');
    if (!tools || typeof tools.trace !== 'function') return finish(baseRow, [baseRow], 0, 'Trace tool unavailable; returned the static baseline.');
    const budget = tools.budget && numeric(tools.budget.rays) !== null ? Math.max(0, Math.floor(tools.budget.rays)) : 20000000;
    const requested = Math.max(1000, Math.min(1000000, Math.floor(settings.pilotRays || 200000)));
    // Deterministic allocation; never make choices from wall-clock timing.
    const pilotRays = Math.min(requested, Math.floor(budget / 6));
    if (pilotRays < 1000) return finish(baseRow, [baseRow], 0, 'Insufficient ray budget; returned the static baseline.');
    const finalRays = Math.min(1000000, Math.max(pilotRays, Math.floor((budget - 4 * pilotRays) / 2)));
    const verifyScene = { source: input.source, target: input.target,
      envelope: { ...input.envelope, keepOut: Math.max(input.envelope.keepOut || 0, settings.minDistance || 0) },
      modeA: { budget: input.limits.maxFacets, paint: input.paint.cells, reflectivity: input.limits.reflectivity } };
    const rows = []; let used = 0;
    const measure = async (row, rays) => {
      // Count the attempt before calling the host: an exception can occur after
      // it has consumed the rays. Never overspend by retrying a failed trace.
      used += rays; row.rays = rays;
      try {
        const raw = await tools.trace(row.output.surfaces, { rays, seed: input.seed });
        const m = metrics(raw);
        if (!m) { row.failure = 'trace returned missing/nonfinite fidelity data'; row.metrics = null; }
        else { row.metrics = m; row.failure = null; }
      } catch (e) { row.failure = 'trace failed: ' + String(e && e.message || e); row.metrics = null; }
    };
    for (let i = 0; i < definitions.length; i++) {
      const d = definitions[i], s = { ...baseSettings, ...d.changes };
      const row = i === 0 ? baseRow : { index: i, name: d.name, settings: s };
      try {
        if (i > 0) row.output = staticDef.solve(input, s);
        const v = RF.Solvers.verify(verifyScene, row.output);
        if (v.errors.length || v.intentErrors.length || v.violations.envelope.length || v.violations.keepOut.length || v.violations.budget) row.failure = 'candidate failed geometry verification';
        else if (!row.output.surfaces.length) row.failure = 'candidate has no geometry';
        else await measure(row, pilotRays);
      } catch (e) { row.failure = 'candidate failed: ' + String(e && e.message || e); }
      row.pilotRays = row.rays || 0; row.pilotMetrics = row.metrics || null;
      rows.push(row);
      if (typeof tools.progress === 'function') tools.progress((i + 1) / 6);
    }
    const ordered = rank(rows, settings.goal);
    if (!ordered.length) return finish(baseRow, rows, used, 'No usable trace measurements; returned the static baseline.');
    // Confirm the pilot winner against the baseline at equal, higher ray counts.
    // If baseline wins the pilot, compare it with the next eligible candidate.
    const finalists = [ordered[0]];
    const challenger = ordered[0].index === 0 ? ordered.find((r) => r.index !== 0) : rows.find((r) => r.index === 0 && r.metrics);
    if (challenger) finalists.push(challenger);
    for (let i = 0; i < finalists.length; i++) {
      if (used + finalRays <= budget && finalRays > pilotRays) await measure(finalists[i], finalRays);
      if (typeof tools.progress === 'function') tools.progress((5 + i) / 6);
    }
    // Rank only equal-resolution finalists. A failed final measurement cannot
    // beat a measured candidate by reusing an optimistic pilot estimate.
    const valid = finalists.filter((r) => r.metrics);
    const highestRays = valid.reduce((m, r) => Math.max(m, r.rays), 0);
    const selected = rank(valid.filter((r) => r.rays === highestRays), settings.goal)[0] || baseRow;
    if (typeof tools.progress === 'function') tools.progress(1);
    const confirmed = finalists.length === 2 && finalists.every((r) => r.metrics && r.rays === highestRays);
    return finish(selected, rows, used, confirmed ? 'Winner confirmed against the static baseline with a common seed.' : 'Confirmation incomplete; returned the best available measured candidate or static fallback.');
  }

  RF.Solvers.register({ id: 'finite-image-auto', name: 'Finite-image bowl auto', version: '1.0', modes: ['paint'], settings: [
    { ...staticDef.settings[0] },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    { key: 'pilotRays', label: 'Pilot rays per candidate', type: 'number', min: 1000, max: 1000000, step: 10000, default: 200000 },
  ], solve: tune });
})();
})();
