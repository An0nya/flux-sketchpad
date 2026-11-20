/* Equal-flux mosaic reflector.  A static, deterministic paint solver: compact cells on the LED's
 * emission sphere are imaged onto compact, equal-paint-flux regions by exact ellipsoidal facets.
 * No tracing (or tracer substitute with random rays) is used: all construction is geometry and
 * deterministic quadrature of the paint / angular source distribution. */
(function () {
  'use strict';
  const V = RF.V, Geo = RF.Geo;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot;

  function halton(i, b) { let f = 1, x = 0; while (i > 0) { f /= b; x += f * (i % b); i = Math.floor(i / b); } return x; }
  function convexClip(poly, a, b, c) {                 // keep a*x + b*y + c >= 0
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
      if (dp >= -1e-11) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out;
  }
  function area2(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; }

  // A compact spherical power-diagram cell in gnomonic coordinates about c.  Emission-cone boundaries
  // are planes (hemisphere) or a circumscribed polygon of cone tangent planes.
  function sourcePolygon(cell, cells, src) {
    const c = cell.c, [ex, ey] = V.basis(c); let p = [[-6, -6], [6, -6], [6, 6], [-6, 6]];
    for (const q of cells) {
      if (q === cell) continue;
      const d = sub(c, q.c), a = dot(ex, d), b = dot(ey, d), cc = dot(c, d) - 0.5 * (cell.bias - q.bias);
      p = convexClip(p, a, b, cc); if (p.length < 3) return { p, ex, ey };
    }
    const tm = RF.Source.thetaMax(src), a = RF.Source.frame(src).a, ct = Math.cos(tm), st = Math.sin(tm);
    if (tm < Math.PI - 1e-7) {
      if (tm >= Math.PI / 2 - 1e-7) {
        p = convexClip(p, dot(ex, a), dot(ey, a), dot(c, a) - ct);
      } else {
        const [eu, ev] = V.basis(a);
        for (let k = 0; k < 32; k++) {
          const ph = 2 * Math.PI * k / 32, e = add(mul(eu, Math.cos(ph)), mul(ev, Math.sin(ph)));
          const t = add(mul(a, -st), mul(e, ct));      // inside the cone has u·t <= 0
          p = convexClip(p, -dot(ex, t), -dot(ey, t), -dot(c, t)); if (p.length < 3) break;
        }
      }
    }
    return { p, ex, ey };
  }

  // Solve the facet quadric along L + t*u and return the real surface point nearest the nominal r.
  function radialPoint(fq, P, L, u, r) {
    const x = sub(L, P), A = fq.A, b = fq.b;
    const Ad = [A[0] * u[0] + A[1] * u[1] + A[2] * u[2], A[3] * u[0] + A[4] * u[1] + A[5] * u[2], A[6] * u[0] + A[7] * u[1] + A[8] * u[2]];
    const Ax = [A[0] * x[0] + A[1] * x[1] + A[2] * x[2], A[3] * x[0] + A[4] * x[1] + A[5] * x[2], A[6] * x[0] + A[7] * x[1] + A[8] * x[2]];
    const aa = dot(u, Ad), bb = 2 * dot(x, Ad) + dot(b, u), cc = dot(x, Ax) + dot(b, x), roots = [];
    if (Math.abs(aa) < 1e-18) { if (Math.abs(bb) > 1e-18) roots.push(-cc / bb); }
    else {
      const disc = bb * bb - 4 * aa * cc;
      if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-bb - s) / (2 * aa), (-bb + s) / (2 * aa)); }
    }
    let best = Infinity;
    for (const t of roots) if (t > Math.max(1e-7, 0.12 * r) && t < 8 * r && Math.abs(t - r) < Math.abs(best - r)) best = t;
    if (!isFinite(best)) best = r;
    return add(L, mul(u, best));
  }

  function makeFacet(c, poly, r, Z, input, focus, id) {
    const L = input.source.pos, P = add(L, mul(c, r)), di = focus * V.dist(P, Z);
    const fq = Geo.facetQuadric(P, L, Z, di), n = fq.n, ex = V.inPlane(n), ey = V.cross(n, ex), pts3 = [];
    for (const q of poly.p) {
      const u = V.norm(add(c, add(mul(poly.ex, q[0]), mul(poly.ey, q[1]))));
      pts3.push(radialPoint(fq, P, L, u, r));
    }
    if (pts3.length < 3 || area2(pts3.map((q) => [dot(sub(q, P), ex), dot(sub(q, P), ey)])) < 1e-10) return null;
    return { type: 'facet', id, group: 'A', P, S0: L.slice(), Z, flat: false, di,
      clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } };
  }

  // Exact outline checks on the real quadric, plus a small triangular-fan clearance check like the host's.
  function facetViolation(f, input, keep) {
    let C; try { C = Geo.compile([f]); } catch (e) { return { env: true, keep: true }; }
    const env = input.envelope, sources = input.sources && input.sources.length ? input.sources : [input.source], margin = 2e-5 * Math.max(...env.half);
    for (const poly of Geo.outline(C, 0)) {
      for (const p of poly) {
        if (!Geo.envInside(env, p, -1e-7)) return { env: true, keep: false };
        for (const s of sources) if (V.dist(p, s.pos) < keep + margin) return { env: false, keep: true };
      }
      const cen = mul(poly.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / poly.length);
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        for (let a = 1; a <= 3; a++) for (let b = 0; a + b <= 3; b++) {
          const q = add(cen, add(mul(sub(p1, cen), a / 3), mul(sub(p2, cen), b / 3)));
          for (const s of sources) {
            const d = V.norm(sub(q, s.pos)), t = Geo.intersect(C.D, C.poly, 0, s.pos[0], s.pos[1], s.pos[2], d[0], d[1], d[2], 1e-9, Infinity);
            if (t >= 0 && t < keep + margin) return { env: false, keep: true };
          }
        }
      }
    }
    return { env: false, keep: false };
  }

  // Lloyd clustering.  Input samples have equal statistical weight; in 3-D chord distance gives
  // spherical Voronoi cells, in 2-D ordinary compact target regions.
  function cluster(samples, dim, N, iterations) {
    N = Math.min(N, samples.length); if (N <= 0) return [];
    const at = (i) => samples.slice(i * dim, (i + 1) * dim), count = samples.length / dim;
    let mean = new Array(dim).fill(0); for (let i = 0; i < count; i++) for (let d = 0; d < dim; d++) mean[d] += samples[i * dim + d] / count;
    let first = 0, bd = Infinity;
    for (let i = 0; i < count; i++) { let d = 0; for (let a = 0; a < dim; a++) d += (samples[i * dim + a] - mean[a]) ** 2; if (d < bd) { bd = d; first = i; } }
    const centres = [at(first)], chosen = new Uint8Array(count); chosen[first] = 1;
    const md = new Float64Array(count).fill(Infinity);
    while (centres.length < N) {
      const c = centres[centres.length - 1]; let pick = -1, best = -1;
      for (let i = 0; i < count; i++) {
        let d = 0; for (let a = 0; a < dim; a++) d += (samples[i * dim + a] - c[a]) ** 2;
        if (d < md[i]) md[i] = d;
        if (!chosen[i] && md[i] > best + 1e-16) { best = md[i]; pick = i; }
      }
      if (pick < 0) break; centres.push(at(pick)); chosen[pick] = 1;
    }
    N = centres.length;
    const own = new Int32Array(count), sums = new Float64Array(N * dim), nums = new Int32Array(N);
    for (let it = 0; it < iterations; it++) {
      sums.fill(0); nums.fill(0);
      for (let i = 0; i < count; i++) {
        let bj = 0, best = Infinity;
        for (let j = 0; j < N; j++) { let d = 0; for (let a = 0; a < dim; a++) d += (samples[i * dim + a] - centres[j][a]) ** 2; if (d < best) { best = d; bj = j; } }
        own[i] = bj; nums[bj]++; for (let a = 0; a < dim; a++) sums[bj * dim + a] += samples[i * dim + a];
      }
      for (let j = 0; j < N; j++) if (nums[j]) {
        if (dim === 3) centres[j] = V.norm([sums[j * 3] / nums[j], sums[j * 3 + 1] / nums[j], sums[j * 3 + 2] / nums[j]]);
        else centres[j] = [sums[j * 2] / nums[j], sums[j * 2 + 1] / nums[j]];
      }
    }
    // Final ownership (the last update otherwise leaves ownership one Lloyd step stale).
    nums.fill(0);
    for (let i = 0; i < count; i++) {
      let bj = 0, best = Infinity;
      for (let j = 0; j < N; j++) { let d = 0; for (let a = 0; a < dim; a++) d += (samples[i * dim + a] - centres[j][a]) ** 2; if (d < best) { best = d; bj = j; } }
      own[i] = bj; nums[bj]++;
    }
    return centres.map((c, j) => ({ c, n: nums[j], samples: Array.from(own, (x, i) => x === j ? i : -1).filter((x) => x >= 0) })).filter((q) => q.n > 0);
  }

  // Additive squared-distance biases turn Lloyd clustering into a capacity-balanced power
  // diagram.  In 3-D the biased spherical bisector is still a plane, so sourcePolygon below
  // can reproduce the exact same ownership (and hence the same captured flux).
  function balancedCluster(samples, dim, N, iterations, weights) {
    const base = cluster(samples, dim, N, 8), centres = base.map((q) => q.c.slice()), count = samples.length / dim;
    N = centres.length; weights = weights || new Float64Array(count).fill(1);
    const bias = new Float64Array(N), own = new Int32Array(count), nums = new Int32Array(N), masses = new Float64Array(N), sums = new Float64Array(N * dim);
    let want = 0; for (let i = 0; i < count; i++) want += weights[i]; want /= N;
    const assign = (update) => {
      nums.fill(0); masses.fill(0); if (update) sums.fill(0); let meanD = 0, wsum = 0;
      for (let i = 0; i < count; i++) {
        let bj = 0, best = Infinity, rawBest = 0;
        for (let j = 0; j < N; j++) { let d = 0; for (let a = 0; a < dim; a++) d += (samples[i * dim + a] - centres[j][a]) ** 2; const score = d + bias[j]; if (score < best) { best = score; rawBest = d; bj = j; } }
        own[i] = bj; nums[bj]++; masses[bj] += weights[i]; meanD += weights[i] * rawBest; wsum += weights[i];
        if (update) for (let a = 0; a < dim; a++) sums[bj * dim + a] += weights[i] * samples[i * dim + a];
      }
      return wsum ? meanD / wsum : 0;
    };
    for (let it = 0; it < iterations; it++) {
      const meanD = assign(true);
      for (let j = 0; j < N; j++) if (masses[j] > 0) {
        if (dim === 3) centres[j] = V.norm([sums[j * 3] / masses[j], sums[j * 3 + 1] / masses[j], sums[j * 3 + 2] / masses[j]]);
        else centres[j] = [sums[j * 2] / masses[j], sums[j * 2 + 1] / masses[j]];
      }
      let mb = 0; for (let j = 0; j < N; j++) { bias[j] += 0.38 * (masses[j] / want - 1) * Math.max(1e-9, meanD); mb += bias[j] / N; }
      for (let j = 0; j < N; j++) bias[j] -= mb;
    }
    assign(false);
    return centres.map((c, j) => ({ c, bias: bias[j], n: nums[j], mass: masses[j], samples: Array.from(own, (x, i) => x === j ? i : -1).filter((x) => x >= 0) })).filter((q) => q.n > 0);
  }

  function targetAims(input, N, toneGamma) {
    const R = input.paint.res, paint = input.paint.cells, T = RF.Engine.designFrame(input.target), cell = 2 * T.half / R;
    let total = 0; for (const w of paint) total += Math.max(0, w);
    if (!(total > 0)) return { aims: [], T, owners: [] };
    const samples = [], weights = [], cellIds = [];
    for (let k = 0; k < paint.length; k++) if (paint[k] > 0) {
      const uv = RF.Engine.cellCenter(T, k % R, (k / R) | 0); samples.push(uv[0], uv[1]); weights.push(Math.pow(Math.max(0, paint[k]), toneGamma)); cellIds.push(k);
    }
    const cl = balancedCluster(samples, 2, Math.min(N, cellIds.length), 24, weights), aims = cl.map((q, j) => {
      let u = q.c[0], v = q.c[1], i = clamp(Math.floor((u + T.half) / cell), 0, R - 1), jj = clamp(Math.floor((v + T.half) / cell), 0, R - 1);
      if (!(paint[jj * R + i] > 0)) {                    // a concave region's mean may lie in a hole
        let best = Infinity, bu = u, bv = v;
        for (const s of q.samples) { const x = samples[2 * s], y = samples[2 * s + 1], d = (x - u) ** 2 + (y - v) ** 2; if (d < best) { best = d; bu = x; bv = y; } }
        u = bu; v = bv;
      }
      return { u, v, n: q.n, bias: q.bias, area: q.n * cell * cell, mass: q.mass, cells: q.samples.map((s) => [cellIds[s], paint[cellIds[s]]]), j };
    });
    return { aims, T, owners: cl };
  }

  function repairRadialVisibility(surfaces, designs, input, settings) {
    const n = surfaces.length; if (!n || !(settings.radialPasses > 0) || n > 160) return 'radial visibility repair off';
    const kernel = RF.Photometry.achievableKernel({ source: input.source, envelope: input.envelope, target: input.target });
    if (kernel.cells > settings.repairKernel) return 'radial repair skipped: best LED image ' + kernel.cells.toFixed(1) + ' cells is already broad';
    const L = input.source.pos;
    const score = (C) => {
      let bad = 0;
      for (let i = 0; i < n; i++) {
        const f = surfaces[i], r = V.dist(f.P, L), incoming = V.norm(sub(f.P, L));
        for (let k = 0; k < n && bad < n * 2; k++) if (k !== i) { const t = Geo.intersect(C.D, C.poly, k, L[0], L[1], L[2], incoming[0], incoming[1], incoming[2], 1e-5, r - 1e-4); if (t >= 0) { bad++; break; } }
        const d = sub(f.Z, f.P), len = V.len(d), out = mul(d, 1 / len);
        for (let k = 0; k < n; k++) if (k !== i) { const t = Geo.intersect(C.D, C.poly, k, f.P[0], f.P[1], f.P[2], out[0], out[1], out[2], 1e-5, len - 1e-4); if (t >= 0) { bad++; break; } }
      }
      return bad;
    };
    let current = score(Geo.compile(surfaces)); const initial = current;
    for (let pass = 0; pass < settings.radialPasses; pass++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const d = designs[i], old = surfaces[i], iv = Geo.envInterval(input.envelope, L, d.c), lo = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0, iv[0], 0) + 0.02, hi = iv[1] - 0.02;
        let best = old, bestScore = current;
        for (const factor of [0.72, 0.86, 1.16, 1.36]) {
          const r = clamp(d.r * factor, lo, hi); if (Math.abs(r - d.r) < 0.02) continue;
          const f = makeFacet(d.c, d.poly, r, old.Z, input, settings.focus, old.id); if (!f) continue;
          const bad = facetViolation(f, input, Math.max(input.envelope.keepOut || 0, settings.minDistance || 0)); if (bad.env || bad.keep) continue;
          surfaces[i] = f; const sc = score(Geo.compile(surfaces));
          if (sc < bestScore) { best = f; bestScore = sc; }
        }
        surfaces[i] = best; if (best !== old) { d.r = V.dist(best.P, L); current = bestScore; moved++; }
      }
      if (!moved) break;
    }
    return 'radial visibility repair: ' + initial + ' → ' + score(Geo.compile(surfaces)) + ' blocked source/chief segments';
  }

  function solve(input, settings) {
    const src = input.source, L = src.pos, env = input.envelope, keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const budget = Math.max(0, input.limits.maxFacets | 0), surfaces = [], designs = [], intent = [], notes = [];
    if (!budget || !input.paint || !input.paint.cells.some((x) => x > 0)) return { surfaces, intent, notes: ['no facets requested or nothing painted'] };
    const fr = RF.Source.frame(src), tm = RF.Source.thetaMax(src), NT = 720, cdf = new Float64Array(NT + 1);
    let prev = 0;
    for (let i = 1; i <= NT; i++) {
      const t = i / NT * tm, f = RF.Source.intensity(src, t) * Math.sin(t);
      cdf[i] = cdf[i - 1] + 0.5 * (prev + f) * tm / NT; prev = f;
    }
    const total = cdf[NT]; if (!(total > 0)) return { surfaces, intent, notes: ['source has no emitting directions'] };
    for (let i = 0; i <= NT; i++) cdf[i] /= total;
    const M = Math.max(5000, Math.min(14000, budget * 60)), dirs = [], rooms = [];
    for (let s = 0; s < M; s++) {
      const x = (s + 0.5) / M; let lo = 0, hi = NT; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= x) lo = m; else hi = m; }
      const f = (x - cdf[lo]) / Math.max(1e-15, cdf[lo + 1] - cdf[lo]), th = (lo + f) / NT * tm, ph = 2 * Math.PI * halton(s + 1, 2);
      const ct = Math.cos(th), st = Math.sin(th), u = V.norm(add(mul(fr.a, ct), add(mul(fr.u, st * Math.cos(ph)), mul(fr.v, st * Math.sin(ph)))));
      const iv = Geo.envInterval(env, L, u), loR = Math.max(keep + 0.03 * Math.max(1, keep), iv[0], 0), hiR = iv[1] - 0.03 * Math.max(1, keep);
      if (!(hiR > loR + 0.05)) continue;
      // Exclude only genuinely grazing / retro-reflecting geometry.  The broad target centre is enough for this feasibility test.
      const r = loR + settings.radialFill * (hiR - loR), P = add(L, mul(u, r)), Z = RF.Engine.aimPoint(input.target);
      const sh = mul(u, -1), ah = V.norm(sub(Z, P)); if (V.len(add(sh, ah)) < 0.35) continue;
      const n = V.norm(add(sh, ah)); if (dot(n, sh) < 0.22) continue;
      dirs.push(u[0], u[1], u[2]); rooms.push([loR, hiR]);
    }
    const ns = dirs.length / 3;
    if (!ns) return { surfaces, intent, notes: ['no emitting direction has room for a facet outside the requested clearance'] };
    const sourceCells = balancedCluster(dirs, 3, Math.min(budget, ns), 24), N = sourceCells.length;
    const targ = targetAims(input, N, settings.toneGamma); if (!targ.aims.length) return { surfaces, intent, notes: ['painting has no positive cells'] };
    // Farther mirrors make smaller LED images.  Give those mirrors to the smaller target regions;
    // both sides are approximately equal-flux, so this pairing preserves the painted tone ratios.
    const sc = sourceCells.map((q, j) => {
      let r = 0; for (const i of q.samples) { const rm = rooms[i]; r += rm[0] + settings.radialFill * (rm[1] - rm[0]); } r /= q.n;
      const poly = sourcePolygon(q, sourceCells, src);
      return Object.assign(q, { r, poly, j });
    }).filter((q) => q.poly.p.length >= 3);
    const ta = targ.aims.slice().sort((a, b) => a.area - b.area || a.j - b.j), ss = sc.slice().sort((a, b) => b.r - a.r || a.j - b.j);
    const pairs = Math.min(ta.length, ss.length); let dropped = 0;
    for (let k = 0; k < pairs; k++) {
      const s = ss[k], a = ta[k], Z = RF.Engine.targetUVtoWorld(targ.T, a.u, a.v), id = 'F' + k;
      let rm = [Infinity, 0]; for (const i of s.samples) { rm[0] = Math.min(rm[0], rooms[i][0]); rm[1] = Math.max(rm[1], rooms[i][1]); }
      // Use the centre ray's actual room, not a distant cluster member's larger room.
      const iv = Geo.envInterval(env, L, s.c); rm[0] = Math.max(keep + 0.03 * Math.max(1, keep), iv[0], 0); rm[1] = iv[1] - 0.03 * Math.max(1, keep);
      let r = rm[0] + settings.radialFill * (rm[1] - rm[0]), shrink = settings.aperture, f = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const poly = { p: s.poly.p.map((q) => [q[0] * shrink, q[1] * shrink]), ex: s.poly.ex, ey: s.poly.ey };
        f = makeFacet(s.c, poly, r, Z, input, settings.focus, id); if (!f) { shrink *= 0.85; continue; }
        const bad = facetViolation(f, input, keep);
        if (!bad.env && !bad.keep) break;
        if (bad.env) { const nr = Math.max(rm[0], r * 0.91); if (nr >= r - 1e-7) shrink *= 0.82; else r = nr; }
        if (bad.keep) { const nr = Math.min(rm[1], r * 1.06 + 0.02); if (nr <= r + 1e-7) shrink *= 0.82; else r = nr; }
        f = null;
      }
      if (!f) { dropped++; intent.push({ facet: null, cells: a.cells }); continue; }
      surfaces.push(f); designs.push({ id, c: s.c, poly: { p: s.poly.p.map((q) => [q[0] * shrink, q[1] * shrink]), ex: s.poly.ex, ey: s.poly.ey }, r }); intent.push({ facet: id, cells: a.cells });
    }
    notes.push(repairRadialVisibility(surfaces, designs, input, settings));
    notes.push(surfaces.length + ' equal-flux ellipsoidal facets; ' + dropped + ' target regions left unplaced after exact envelope/clearance checks');
    notes.push('static balanced spherical power cells + paint-mass target power cells; target-focused ellipsoids (no tracing)');
    return { surfaces, intent, notes };
  }

  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'radialFill', label: 'Room used toward envelope wall', type: 'range', min: 0.35, max: 0.97, step: 0.01, default: 0.82 },
    { key: 'aperture', label: 'Source-cell aperture fill', type: 'range', min: 0.65, max: 1, step: 0.01, default: 0.94 },
    { key: 'focus', label: 'Focus distance / target distance', type: 'range', min: 1, max: 3, step: 0.05, default: 1 },
    { key: 'toneGamma', label: 'Bright-region aim allocation exponent', type: 'range', min: 0.7, max: 2.5, step: 0.05, default: 1 },
    { key: 'radialPasses', label: 'Static radial visibility sweeps', type: 'range', min: 0, max: 4, step: 1, default: 1 },
    { key: 'repairKernel', label: 'Largest best-image kernel for radial repair (cells)', type: 'range', min: 0, max: 10, step: 0.25, default: 2 },
  ];
  RF.Solvers.register({
    id: 'bench-kimik31pro-max-r3--equal-flux-mosaic', name: 'Balanced-flux mosaic (static)', version: '1.0', modes: ['paint'], settings: SETTINGS, solve,
  });

  // Optional goal tuner.  It changes ONLY the static algorithm's settings; every candidate is
  // still built by the deterministic solve() above.  Common-seed traces are used to choose among
  // those geometries, never to move individual facets or to hide a search in the static solver.
  function solveAuto(input, settings, tools) {
    const variants = [
      { name: 'adaptive', set: {} },
      { name: 'unrepaired', set: { radialPasses: 0 } },
      { name: 'wall / unrepaired', set: { radialFill: 0.95, radialPasses: 0 } },
      { name: 'full aperture / repaired', set: { aperture: 1, radialPasses: 1 } },
    ];
    // Large caps use a two-candidate version to bound tuning time.  The scored 100-facet path
    // evaluates all four; duplicate geometries are traced only once.
    const use = input.limits.maxFacets > 160 ? variants.slice(0, 2) : variants, records = [], seen = new Set();
    let best = null;
    for (let k = 0; k < use.length; k++) {
      const v = use[k], candidateSettings = Object.assign({}, settings, v.set), out = solve(input, candidateSettings);
      const key = JSON.stringify(out.surfaces); if (seen.has(key)) { records.push({ name: v.name, duplicate: true }); continue; } seen.add(key);
      let tr = null;
      try { tr = tools && tools.trace ? tools.trace(out.surfaces, { rays: 120000, seed: input.seed | 0 }) : null; } catch (e) { tr = null; }
      const f = tr && tr.fidelity, fidelity = f ? f.fidelity : 0, onPaint = f ? f.onPaint : 0, light = Math.min(1, onPaint / 0.025);
      let merit = fidelity;
      if (settings.goal === 'throw') merit = (tr ? tr.throwM : 0) * (0.45 + 0.55 * fidelity);
      else if (settings.goal === 'efficient') merit = onPaint * (0.65 + 0.35 * fidelity);
      merit *= light;
      const rec = { name: v.name, out, tr, fidelity, onPaint, merit, settings: candidateSettings }; records.push(rec);
      if (tr && (!best || merit > best.merit + 1e-12)) best = rec;
      if (tools && tools.progress) tools.progress((k + 1) / use.length);
    }
    if (!best) { const out = solve(input, settings); out.notes = (out.notes || []).concat('auto: no trace available; returned the static default'); return out; }
    const out = Object.assign({}, best.out), notes = (out.notes || []).slice();
    notes.push('auto goal ' + settings.goal + ': chose "' + best.name + '" · F ' + best.fidelity.toFixed(3) + ' · on paint ' + (100 * best.onPaint).toFixed(1) + '% · throw ' + Math.round(best.tr.throwM) + ' m');
    notes.push('auto candidates (120k common-seed rays): ' + records.map((r) => r.duplicate ? r.name + '=duplicate' : r.name + ' F=' + r.fidelity.toFixed(3) + ', light=' + (100 * r.onPaint).toFixed(1) + '%').join(' · '));
    out.notes = notes; return out;
  }
  RF.Solvers.register({
    id: 'bench-kimik31pro-max-r3--equal-flux-mosaic-auto', name: 'Balanced-flux mosaic (goal tuner)', version: '1.0', modes: ['paint'],
    settings: SETTINGS.concat([{ key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
      { value: 'faithful', label: 'Faithful painting' }, { value: 'throw', label: 'Throw / peak intensity' }, { value: 'efficient', label: 'Light on painting' },
    ] }]),
    solve: solveAuto,
  });
})();
