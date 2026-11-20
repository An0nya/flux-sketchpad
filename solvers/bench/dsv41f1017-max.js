/* solvers/solver.js — "Paint tiles": a static, image-based faceted-reflector solver for Flux paint mode.
 *
 * OPTICS USED (exact, no tracing):
 *  - Every facet is an ellipsoid of revolution with foci at the LED S0 and at its aim point Z on
 *    the target.  It images the LED onto Z; the image area is set by étendue,
 *        A_img = (D/r)^2 * A_led * cos(theta) / cos(target tilt),
 *    at facet distance r from the LED.  The aperture sets only the captured flux:
 *        Phi = q * A_ap,   q = |n.d| * I(theta) / (pi r^2)   per mm^2,
 *    for a Lambertian LED (I = cos theta).
 *
 * ALGORITHM
 *  1. Tile the usable envelope wall with N facets of roughly equal area.  Usable = the part of the
 *     wall the LED actually lights, not too close to it, and not in front of the beam (so facets do
 *     not block each other or the outgoing light).  A facet's aperture is its wall tile polygon
 *     (a convex clip), so it needs no room "inside" the envelope and it hugs the wall.
 *  2. Equal intensity: the delivered illuminance from a facet is I = Phi/A_img = q*A_ap/A_img.
 *     q/A_img is independent of distance, so with equal tiles I varies only with the oblique
 *     incidence factor.  Choose the global I at the tightest facet and give each facet the aperture
 *     that produces it.  Then the delivered pattern is proportional to the sampler density,
 *     independent of which facet gets which aim.
 *  3. Aim points are sampled from the painted cells with density proportional to the paint level,
 *     so the expected delivered light is exactly proportional to the painting.  A deterministic
 *     shuffle pairs aims with facets (equal intensity makes the pairing irrelevant).
 *  4. Verify the real surface against the envelope and the LED clearance; shrink offenders.
 *
 * No tracing happens in solve().
 */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V;
  const D2R = Math.PI / 180;
  const norm = (x) => V.norm(x);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function hash01(i, j) {
    let h = Math.imul(i | 0, 0x9e3779b1) ^ Math.imul(j | 0, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function shuffle(arr, seed) {
    let s = seed | 0;
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), q = arr[i]; arr[i] = arr[j]; arr[j] = q; }
    return arr;
  }

  // ---------------------------------------------------------------- source helpers
  function ledArea(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? Math.PI * src.radius * src.radius : (src.w || 1) * (src.h || 1);
    if (src.shape === 'cylinder') return Math.PI * src.radius * src.radius;
    return Math.PI * src.radius * src.radius;
  }
  function relIntensity(src, ct) {
    if (src.dist === 'lambertian') return Math.max(0, ct);
    if (src.dist === 'gaussian') { const s = Math.max(0.1, src.sigma || 30) * D2R, th = Math.acos(clamp(ct, -1, 1)); return Math.exp(-th * th / (2 * s * s)); }
    return 1;
  }

  // ---------------------------------------------------------------- paint
  function paintInfo(paint, res, size) {
    const cell = size / res;
    let mass = 0, area = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = paint[j * res + i];
      if (w > 0) { mass += w * cell * cell; area += cell * cell; }
    }
    return { res, cell, mass, area, paint };
  }
  function makePaintAt(P) {
    const R = P.res, c = P.cell, half = R * c / 2, pa = P.paint;
    return (u, v) => {
      const x = (u + half) / c - 0.5, y = (v + half) / c - 0.5;
      const i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
      const g = (i, j) => (i < 0 || j < 0 || i >= R || j >= R) ? 0 : pa[j * R + i];
      return g(i0, j0) * (1 - fx) * (1 - fy) + g(i0 + 1, j0) * fx * (1 - fy) + g(i0, j0 + 1) * (1 - fx) * fy + g(i0 + 1, j0 + 1) * fx * fy;
    };
  }


  // Paint with the aim mask eroded by r cells (aims kept away from the outer boundary, where a big
  // spot would spill into the dark gaps).
  function erodePaint(P, r) {
    if (!(r > 0)) return P.paint;
    const R = P.res, src = P.paint, out = new Float64Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      if (!(src[j * R + i] > 0)) continue;
      let ok = true;
      for (let dj = -r; dj <= r && ok; dj++) for (let di = -r; di <= r; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= R || jj >= R || !(src[jj * R + ii] > 0)) { ok = false; break; }
      }
      if (ok) out[j * R + i] = src[j * R + i];
    }
    return out;
  }

  // Jittered hex lattice covering the painted area uniformly in AREA (about n points).
  function makeAimsUniform(P, n, jitter, seed) {
    const R = P.res, c = P.cell, half = R * c / 2, paintAt = makePaintAt(P);
    let s = Math.sqrt(2 * P.area / (Math.sqrt(3) * Math.max(1, n)));
    let best = [];
    for (let it = 0; it < 20; it++) {
      const pts = [];
      const dy = s * Math.sqrt(3) / 2, dx = s;
      const nj = Math.ceil((R * c) / dy) + 2, ni = Math.ceil((R * c) / dx) + 2;
      for (let jj = -1; jj < nj; jj++) for (let ii = -1; ii < ni; ii++) {
        const h1 = hash01(ii * 3 + 11 + 7919 * it, jj * 5 + 7 + seed), h2 = hash01(jj * 7 + 3 + 104729 * it, ii * 11 + 13 + seed * 7);
        const u = -half + (ii + 0.5) * dx + (jj & 1 ? dx * 0.5 : 0) + (h1 - 0.5) * jitter * dx;
        const v = -half + (jj + 0.5) * dy + (h2 - 0.5) * jitter * dy;
        if (Math.abs(u) >= half || Math.abs(v) >= half) continue;
        const lv = paintAt(u, v);
        if (lv > 1e-9) pts.push([u, v, lv]);
      }
      best = pts;
      if (pts.length >= n * 0.97 && pts.length <= n * 1.03) break;
      if (pts.length > n) s *= Math.sqrt(pts.length / n) * 1.02;
      else s *= 0.96;
    }
    if (best.length > n) { const step = best.length / n, out = []; for (let k = 0; k < n; k++) out.push(best[Math.floor(k * step)]); best = out; }
    return best;
  }

  // Jittered hex lattice thinned with probability ∝ paint (a blue-noise-ish mass sample: no clumps)
  function latticeAims(P, n, seed, jitter) {
    const R = P.res, c = P.cell, half = R * c / 2, paint = P.paint, paintAt = makePaintAt(P);
    let pmax = 0; for (let k = 0; k < R * R; k++) pmax = Math.max(pmax, paint[k]);
    if (!(pmax > 0)) return [];
    let s = Math.sqrt(P.area / Math.max(1, n));
    let best = [];
    for (let it = 0; it < 20; it++) {
      const pts = [];
      const dy = s * Math.sqrt(3) / 2, dx = s;
      const nj = Math.ceil((R * c) / dy) + 2, ni = Math.ceil((R * c) / dx) + 2;
      for (let jj = -1; jj < nj; jj++) for (let ii = -1; ii < ni; ii++) {
        const h1 = hash01(ii * 3 + 11 + 7919 * it, jj * 5 + 7 + seed), h2 = hash01(jj * 7 + 3 + 104729 * it, ii * 11 + 13 + seed * 7);
        const u = -half + (ii + 0.5) * dx + (jj & 1 ? dx * 0.5 : 0) + (h1 - 0.5) * jitter * dx;
        const v = -half + (jj + 0.5) * dy + (h2 - 0.5) * jitter * dy;
        if (Math.abs(u) >= half || Math.abs(v) >= half) continue;
        const lv = paintAt(u, v);
        if (lv <= 1e-9) continue;
        if (hash01(ii * 13 + 5, jj * 17 + 9 + seed) * pmax >= lv) continue;   // thin ∝ paint
        pts.push([u, v, lv]);
      }
      best = pts;
      if (pts.length >= n * 0.97 && pts.length <= n * 1.03) break;
      if (pts.length > n) s *= Math.sqrt(pts.length / n) * 1.02;
      else s *= 0.96;
    }
    if (best.length > n) {
      // keep the n with the largest minimum spacing: simple deterministic thinning by a random key
      const step = best.length / n, out = [];
      for (let k = 0; k < n; k++) out.push(best[Math.floor(k * step)]);
      best = out;
    }
    return best;
  }
  // Sample n aim points from the paint mass distribution (density ∝ paint), jittered within cells.
  function sampleAims(P, n, seed) {
    const R = P.res, c = P.cell, half = R * c / 2, paint = P.paint;
    const cells = [], cdf = new Float64Array(R * R + 1);
    let acc = 0;
    for (let k = 0; k < R * R; k++) { const w = Math.max(0, paint[k]); if (w > 0) { cells.push(k); cdf[cells.length] = (acc += w); } }
    if (!(acc > 0)) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = Math.min(acc * (1 - 1e-12), ((i + 0.5 + 0.7 * hash01(i + 11, seed)) / n) * acc);
      let lo = 0, hi = cells.length;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= u) lo = m; else hi = m; }
      const k = cells[Math.min(cells.length - 1, lo)], ii = k % R, jj = (k - ii) / R;
      const uu = -half + (ii + 0.3 + 0.4 * hash01(i * 3 + 7, seed + 1)) * c;
      const vv = -half + (jj + 0.3 + 0.4 * hash01(i * 5 + 13, seed + 2)) * c;
      out.push([uu, vv, paint[k]]);
    }
    return out;
  }

  // ---------------------------------------------------------------- facet geometry checks
  function facetAim(P, S0, Z) {
    const d = norm(V.sub(P, S0)), r = V.dist(P, S0);
    const tt = norm(V.sub(Z, P)), Dt = V.dist(Z, P);
    const n = norm(V.add(V.mul(d, -1), tt));
    return { d, r, tt, Dt, n, cosInc: Math.abs(V.dot(n, d)) };
  }
  function imageArea(src, T, d, r, Dt, tt) {
    const la = ledArea(src);
    const proj = Math.abs(V.dot(norm(src.axis), d));
    return Math.max(1, (Dt / r) * (Dt / r) * la * proj / Math.max(0.25, Math.abs(V.dot(tt, T.n))));
  }

  // Real surface points of a compiled polygon facet (faithful to what the host verifies)
  function surfaceSamples(surface, G, k) {
    const m = G.metas[k], fr = m.frame, P = fr.P, ex = fr.ex, ey = fr.ey, ez = fr.ez;
    const at = (x, y) => {
      const z = RF.Geo.localSag(G.D, k * RF.Geo.STRIDE, x, y);
      return [P[0] + ex[0] * x + ey[0] * y + ez[0] * z, P[1] + ex[1] * x + ey[1] * y + ez[1] * z, P[2] + ex[2] * x + ey[2] * y + ez[2] * z];
    };
    const pts = [];
    if (surface.clip && surface.clip.kind === 'disc') {
      const r = surface.clip.r;
      pts.push(at(0, 0));
      for (const ring of [0.5, 1]) for (let a = 0; a < 24; a++) {
        const al = 2 * Math.PI * a / 24, rr = r * ring;
        pts.push(at(rr * Math.cos(al), rr * Math.sin(al)));
      }
      return pts;
    }
    const poly = m.poly2 || [[0, 0]];
    let cx = 0, cy = 0; for (const q of poly) { cx += q[0]; cy += q[1]; } cx /= poly.length; cy /= poly.length;
    pts.push(at(cx, cy));
    for (const q of poly) { pts.push(at(q[0], q[1])); pts.push(at((q[0] + cx) / 2, (q[1] + cy) / 2)); }
    return pts;
  }
  function validate(env, surfaces, G, keep, emitters) {
    const bad = new Set();
    for (let k = 0; k < surfaces.length; k++) {
      const pts = surfaceSamples(surfaces[k], G, k);
      for (const p of pts) {
        if (!isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) { bad.add(k); break; }
        if (!RF.Geo.envInside(env, p, 1e-9)) { bad.add(k); break; }
        let kb = false;
        for (const S of emitters) if (V.dist(p, S) < keep * 0.999) { kb = true; break; }
        if (kb) { bad.add(k); break; }
      }
    }
    return bad;
  }
  function scalePoly(pts3, c, f) { return pts3.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, c[2] + (p[2] - c[2]) * f]); }
  function polyArea2(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }

  // ---------------------------------------------------------------- box wall tiling
  const FACES = [];
  for (let ax = 0; ax < 3; ax++) for (const side of [-1, 1]) FACES.push({ ax, side, i: (ax + 1) % 3, j: (ax + 2) % 3 });

  function tileBox(ctx, spacing) {
    const { env, src, a, tdir, keep, frontCut } = ctx;
    const c = env.center, h = env.half, S0 = src.pos;
    const cells = [];
    for (const f of FACES) {
      const w = [0, 0, 0]; w[f.ax] = f.side;
      const hi = h[f.i], hj = h[f.j], hx = hi - 0.25, hy = hj - 0.25;
      if (!(hx > 0.4 && hy > 0.4)) continue;
      const nx = Math.max(1, Math.ceil(2 * hx / spacing)), ny = Math.max(1, Math.ceil(2 * hy / spacing));
      const sx = 2 * hx / nx, sy = 2 * hy / ny;
      for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
        const u = -hx + (ix + 0.5) * sx, v = -hy + (iy + 0.5) * sy;
        const Q = [c[0], c[1], c[2]]; Q[f.ax] += f.side * h[f.ax]; Q[f.i] += u; Q[f.j] += v;
        const d = norm(V.sub(Q, S0)), r = V.dist(Q, S0);
        const ct = V.dot(d, a);
        if (ct <= 0.03) continue;
        if (V.dot(d, tdir) > frontCut) continue;
        if (r < keep + 1.5) continue;
        cells.push({ Q, w, spacing: 0.5 * (sx + sy), face: f, ct, r, d, i: f.i, j: f.j });
      }
    }
    return cells;
  }


  // Conservative radius of a disc in the facet's tangent plane that stays inside the envelope
  // (including the facet's sag).  Box: analytic per-axis room; else a short march.
  function fitRadius(env, P, n, rPos) {
    const ex = V.inPlane(n, null), ey = V.cross(n, ex);
    const c = env.center, h = env.half;
    const sagK = 1 / (4 * Math.max(1, rPos));
    if (env.shape === 'box') {
      let rho = 0;
      for (let it = 0; it < 3; it++) {
        let rr = 1e9;
        for (let a = 0; a < 3; a++) {
          let room = h[a] - Math.abs(P[a] - c[a]) - Math.abs(n[a]) * sagK * rho * rho - 0.3;
          if (room < 0) room = 0;
          const em = Math.hypot(ex[a], ey[a]);
          if (em > 1e-9) rr = Math.min(rr, room / em);
        }
        rho = Math.max(0, rr);
      }
      return rho;
    }
    let rho = 1e9;
    for (let k = 0; k < 10; k++) {
      const al = 2 * Math.PI * k / 10, e = V.add(V.mul(ex, Math.cos(al)), V.mul(ey, Math.sin(al)));
      let lo = 0, hi = 0.6;
      while (hi < 140) {
        const q = V.add(P, V.mul(e, hi)); q[0] -= sagK * hi * hi * n[0]; q[1] -= sagK * hi * hi * n[1]; q[2] -= sagK * hi * hi * n[2];
        if (!RF.Geo.envInside(env, q)) break; hi *= 2;
      }
      for (let it = 0; it < 10; it++) {
        const m = 0.5 * (lo + hi), q = V.add(P, V.mul(e, m));
        q[0] -= sagK * m * m * n[0]; q[1] -= sagK * m * m * n[1]; q[2] -= sagK * m * m * n[2];
        if (RF.Geo.envInside(env, q)) lo = m; else hi = m;
      }
      rho = Math.min(rho, lo);
    }
    return Math.max(0, rho - 0.3);
  }


  // Distance-to-edge transform on the paint grid (mm): how far a painted cell is from a paint-level
  // change or an unpainted cell.  Its median is a robust scale of the painting's finest features,
  // used to cap the working spot size on finely detailed paintings.
  function paintEdgeScale(P) {
    const R = P.res, c = P.cell, pa = P.paint;
    let pmax = 0;
    for (let k = 0; k < R * R; k++) pmax = Math.max(pmax, pa[k]);
    if (!(pmax > 0)) return 0;
    const INF = 1e9, d = new Float64Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i;
      if (!(pa[k] > 0)) { d[k] = 0; continue; }
      let edge = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= R || jj >= R) { edge = true; break; }
        const q = pa[jj * R + ii];
        if (q <= 0 || Math.abs(q - pa[k]) > 0.16 * pmax) { edge = true; break; }
      }
      d[k] = edge ? 0 : INF;
    }
    // two-pass chamfer (1, sqrt2)
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i; if (!(d[k] < INF)) continue;
      if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a);
      if (j > 0) d[k] = Math.min(d[k], d[k - R] + a);
      if (i > 0 && j > 0) d[k] = Math.min(d[k], d[k - R - 1] + b);
      if (i < R - 1 && j > 0) d[k] = Math.min(d[k], d[k - R + 1] + b);
    }
    for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) {
      const k = j * R + i; if (!(d[k] < INF)) continue;
      if (i < R - 1) d[k] = Math.min(d[k], d[k + 1] + a);
      if (j < R - 1) d[k] = Math.min(d[k], d[k + R] + a);
      if (i < R - 1 && j < R - 1) d[k] = Math.min(d[k], d[k + R + 1] + b);
      if (i > 0 && j < R - 1) d[k] = Math.min(d[k], d[k + R - 1] + b);
    }
    const vals = [];
    for (let k = 0; k < R * R; k++) if (pa[k] > 0) vals.push(Math.min(d[k], R) * c);
    vals.sort((x, y) => x - y);
    return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
  }

  // ---------------------------------------------------------------- direct-light shield
  // A small absorbing patch just in front of the LED on the target axis.  A planar LED emits into its
  // front hemisphere, and the target plane is perpendicular to its axis, so its upper half receives
  // direct light: that is pure spill (it cannot be painted).  The patch blocks the cone that would
  // reach the target while leaving the reflected beams (which come from behind/above) untouched.
  function makeShield(input, T, Nmax) {
    const src = input.source, env = input.envelope, S0 = src.pos;
    const t = norm(V.sub(T.C, S0));
    const a = norm(src.axis);
    // Only useful when the target is near the LED's horizon: then the LED's direct light would
    // flood half the target and a shield can remove it without touching the reflected beams.
    // For a forward-emitting LED the direct light is the useful light; blocking it would be wrong.
    if (Math.abs(V.dot(t, a)) > 0.35) return null;
    const half = input.target.size / 2, D = input.target.distance;
    // does direct light reach the lit side of the target at all?
    const topC = V.add(T.C, V.mul(T.tv, half));
    if (V.dot(norm(V.sub(topC, S0)), a) <= 0.02) return null;
    const iv = RF.Geo.envInterval(env, S0, t);
    const room = Math.min(iv[1] > iv[0] ? iv[1] : 0, D);
    if (!(room > 2)) return null;
    let x0 = Math.max(env.keepOut + 1.5, Math.min(10, 0.35 * room));
    if (x0 > room - 1) x0 = room - 1;
    if (!(x0 > 0.8)) return null;
    const ex = norm(V.sub(T.tu, V.mul(t, V.dot(T.tu, t)))), ey = norm(V.sub(T.tv, V.mul(t, V.dot(T.tv, t))));
    const P = V.add(S0, V.mul(t, x0));
    const hu = (x0 / D) * half * 1.04 + 0.25, hv = (x0 / D) * half * 1.04 + 0.25;
    // rectangle from just below v=0 up to the target's top edge
    const rect = [];
    for (const [su, sv] of [[-1, -0.04], [1, -0.04], [1, 1], [-1, 1]]) rect.push(V.add(P, V.add(V.mul(ex, su * hu), V.mul(ey, sv * hv))));
    return { type: 'plane', id: 'SHIELD', group: 'A', P, n: V.mul(t, -1), clip: { kind: 'poly', pts3: rect },
      optics: { interaction: 'absorb', twoSided: true } };
  }

  // ---------------------------------------------------------------- main
  function solve(input, settings) {
    const src = input.source, env = input.envelope, T = RF.Engine.designFrame(input.target);
    const paint = (input.paint && input.paint.cells) ? input.paint.cells : input.paint;
    const pr = (input.paint && input.paint.res) || input.target.res;
    const P = paintInfo(paint, pr, input.target.size);
    const notes = [];
    const Nmax = Math.max(1, input.limits.maxFacets | 0);
    const reflect = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const sources = (input.sources && input.sources.length ? input.sources : [src]);
    const emitters = sources.map((s) => s.pos);
    if (!(P.mass > 0)) return { surfaces: [], intent: [], notes: ['no painted cells: nothing to build'] };

    const a = norm(src.axis), [bu, bv] = V.basis(a);
    const tdir = norm(V.sub(T.C, src.pos));
    const frontCut = clamp(settings.frontCut === undefined ? 0.2 : settings.frontCut, -0.6, 0.8);
    const N = Math.min(Nmax, Math.max(4, Math.round(Nmax * (settings.facets || 1))));
    const ctx = { env, src, a, tdir, keep, frontCut, T, bu, bv };

    // ---- tile the box walls: choose spacing so the usable cell count is close to N
    let cells = [];
    if (env.shape === 'box') {
      let lo = 0.5, hi = Math.max(...env.half) * 2 / Math.max(1, Math.sqrt(N) / 2);
      for (let it = 0; it < 16; it++) {
        const mid = 0.5 * (lo + hi);
        const cc = tileBox(ctx, mid);
        cells = cc;
        if (cc.length > N * 1.04) lo = mid; else if (cc.length < N * 0.9) hi = mid; else break;
      }
      // if it overshot, drop the smallest-flux cells deterministically
      if (cells.length > N) {
        cells.sort((x, y) => (y.ct / (y.r * y.r)) - (x.ct / (x.r * x.r)) || x.Q[0] - y.Q[0]);
        cells = cells.slice(0, N);
      }
      cells.sort((x, y) => x.Q[0] - y.Q[0] || x.Q[1] - y.Q[1] || x.Q[2] - y.Q[2]);
    } else {
      notes.push('non-box envelope: using the direction-sampling fallback');
      return solveFallback(input, settings, P, notes);
    }
    if (!cells.length) return { surfaces: [], intent: [], notes: ['no usable wall cells'] };

    // ---- uniform-spot mode: one common spot area, a uniform aim lattice, and a direct flux per
    // facet (flux ∝ paint × spot area).  The sum of the lattice's equal spots is the painting
    // convolved with one spot, with no placement variance.  Only usable when enough wall facets can
    // produce a spot no larger than the common one (else the layout is statistics-based).
    const uniformMode = settings.method === 'uniform';
    let cellsU = cells, A_spotU = 0;
    if (uniformMode) {
      const kerU = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
      const A_minU = Math.max(Math.PI * 0.25 * kerU.mm * kerU.mm * clamp(settings.kernelBoost === undefined ? 1.5 : settings.kernelBoost, 0.4, 8), P.area * clamp(settings.overlap === undefined ? 10 : settings.overlap, 0.5, 12) / Math.max(1, cells.length));
      const Z0 = RF.Engine.targetUVtoWorld(T, 0, 0);
      const prov = cells.map((cell) => {
        const P0 = V.add(cell.Q, V.mul(cell.w, -0.3));
        const g0 = facetAim(P0, src.pos, Z0);
        const Aimg0 = imageArea(src, T, g0.d, g0.r, g0.Dt, g0.tt);
        return { cell, Aimg0 };
      });
      const sortedA = prov.map((q) => q.Aimg0).sort((x, y) => x - y);
      A_spotU = Math.max(A_minU, sortedA[Math.floor(sortedA.length * 0.9)] || 1);
      const keepU = prov.filter((q) => q.Aimg0 <= A_spotU * 1.03 && q.cell.spacing > 0.5);
      if (keepU.length >= 8) { cellsU = keepU.map((q) => q.cell); }
    }
    // ---- aims from the paint mass distribution
    const jitterA = clamp(settings.jitter === undefined ? 0.8 : settings.jitter, 0, 1);
    const erodeR = Math.max(0, Math.round(settings.erode || 0));
    const Pa = erodeR > 0 ? Object.assign({}, P, { paint: erodePaint(P, erodeR) }) : P;
    let aims;
    if (uniformMode) aims = makeAimsUniform(Pa, cellsU.length, jitterA, 9001 + (input.seed | 0));
    else aims = settings.sampler === 'lattice' ? latticeAims(Pa, cellsU.length, 9001 + (input.seed | 0), jitterA) : sampleAims(Pa, cellsU.length, 9001 + (input.seed | 0));
    if (aims.length < 6) aims = sampleAims(P, cellsU.length, 9001 + (input.seed | 0));
    while (aims.length < cellsU.length) { const aa = aims[aims.length % Math.max(1, aims.length)]; aims.push([aa[0] + 0.01, aa[1], aa[2]]); }
    // Assignment: the highest facets (those whose beams graze the ceiling) get the lowest aims, so
    // every reflected beam leaves its wall instead of skimming the neighbour.  A permutation of a
    // paint-mass sample keeps every facet's aim distribution ∝ paint, so the expectation is unchanged.
    const assignMode = settings.assign === undefined ? 'height' : settings.assign;
    if (uniformMode) {
      aims = aims.slice(0, cellsU.length);
      aims.sort((x, y) => y[2] - x[2]);
      shuffle(cellsU, 4242 + (input.seed | 0));
    } else if (assignMode === 'height') {
      aims.sort((x, y) => x[1] - y[1]);
      cellsU.sort((x, y) => (y.Q[2] - x.Q[2]) || (Math.abs(y.Q[1]) - Math.abs(x.Q[1])));
    } else {
      shuffle(cellsU, 4242 + (input.seed | 0));
    }

    // ---- per-facet aim geometry, position, aperture and intensity
    const pack = clamp(settings.pack === undefined ? 0.42 : settings.pack, 0.1, 0.7);
    const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const kerArea = Math.max(1, Math.PI * 0.25 * ker.mm * ker.mm);
    const overlapT = clamp(settings.overlap === undefined ? 10 : settings.overlap, 0.5, 12);
    let A_min = Math.max(kerArea * clamp(settings.kernelBoost === undefined ? 1.5 : settings.kernelBoost, 0.4, 8), P.area * overlapT / Math.max(1, cells.length));
    if ((settings.spotMM || 0) > 0) A_min = Math.max(A_min, settings.spotMM * settings.spotMM);
    const capF = clamp(settings.featureCap === undefined ? 2.5 : settings.featureCap, 0, 10);
    if (capF > 0) { const dEdge = paintEdgeScale(P); if (dEdge > 0) A_min = Math.min(A_min, Math.PI * 0.25 * (capF * dEdge) ** 2); }
    const meta = [];
    for (let k = 0; k < cellsU.length; k++) {
      const cell = cellsU[k], [u, v, lv] = aims[k];
      const Z = RF.Engine.targetUVtoWorld(T, u, v);
      const rho0 = Math.max(0.5, cell.spacing * pack);
      // inset the centre so the whole disc (plus its sag) sits inside the envelope
      // first aim with a provisional centre
      let P = V.add(cell.Q, V.mul(cell.w, -0.3));
      let g = facetAim(P, src.pos, Z);
      const tilt = Math.sqrt(Math.max(0, 1 - V.dot(g.n, cell.w) ** 2));   // in-plane extent toward the wall / mm
      const inset = 0.3 + rho0 * tilt + rho0 * rho0 / (4 * Math.max(1, g.r));
      P = V.add(cell.Q, V.mul(cell.w, -inset));
      g = facetAim(P, src.pos, Z);
      if (g.r < keep + 0.5) continue;
      const Aimg = imageArea(src, T, g.d, g.r, g.Dt, g.tt);
      const q = g.cosInc * relIntensity(src, Math.max(0, V.dot(g.d, a))) / (Math.PI * g.r * g.r);
      const AapMax = Math.PI * rho0 * rho0;
      const A_spot = uniformMode ? Math.max(A_spotU, Aimg) : Math.max(Aimg, A_min);
      meta.push({ cell, P, Z, g, Aimg, q, AapMax, rho0, lv, A_spot, I: q * AapMax / A_spot });
    }
    // Intensity balance.  With aims sampled ∝ paint and assigned independently, the expected field
    // is p * F / mass for ANY per-facet intensities; equalising them only lowers the variance.  The
    // 'equalize' knob picks the intensity-quantile that all facets are clipped to (0 = use every
    // aperture at full size = maximum flux, 1 = the tightest facet sets the scale).
    const eqv = clamp(settings.equalize === undefined ? 0.5 : settings.equalize, 0, 1);
    const drop = clamp(settings.drop === undefined ? 0 : settings.drop, 0, 0.7);
    const gain = clamp(settings.capture === undefined ? 1 : settings.capture, 0.02, 1);
    let Fpred = 0, I = 0;
    if (uniformMode) {
      // bottleneck pairing: strongest facets to the highest paint levels
      meta.sort((x, y) => y.I - x.I);
      aims.sort((x, y) => y[2] - x[2]);
      for (let k = 0; k < meta.length; k++) {
        const m = meta[k], [u, v, lv] = aims[k] || [0, 0, 1];
        m.lv = lv;
        m.Z = RF.Engine.targetUVtoWorld(T, u, v);
        const g = facetAim(m.P, src.pos, m.Z);
        const Aimg = imageArea(src, T, g.d, g.r, g.Dt, g.tt);
        const q = g.cosInc * relIntensity(src, Math.max(0, V.dot(g.d, a))) / (Math.PI * g.r * g.r);
        m.g = g; m.Aimg = Aimg; m.q = q;
        m.A_spot = Math.max(A_spotU, Aimg);
        m.I = q * m.AapMax / m.A_spot;
      }
      let C = Infinity;
      for (const m of meta) C = Math.min(C, m.I / Math.max(0.02, m.lv));
      if (!(C > 0) || !isFinite(C)) C = 0;
      C *= gain;
      for (const m of meta) {
        const flux = C * Math.max(0.02, m.lv) * m.A_spot;
        m.Aap = Math.min(m.AapMax, flux / Math.max(1e-12, m.q));
        Fpred += m.q * m.Aap;
      }
    } else if (eqv <= 0) {
      for (const m of meta) { m.Aap = m.AapMax * gain; Fpred += m.q * m.Aap; }
    } else {
      // drop the least capable facets: one very weak facet otherwise sets the intensity for all
      meta.sort((x, y) => y.I - x.I);
      const keep = Math.max(4, Math.round(meta.length * (1 - drop)));
      meta.length = keep;
      const Ii = meta.map((m) => m.I).sort((x, y) => x - y);
      I = eqv >= 1 ? Ii[0] : Ii[Math.floor(eqv * Math.max(0, Ii.length - 1))];
      if (!(I > 0) || !isFinite(I)) I = 0;
      I *= gain;
      for (const m of meta) { m.Aap = Math.min(m.AapMax, I * m.A_spot / Math.max(1e-12, m.q)); Fpred += m.q * m.Aap; }
    }
    // defocus each facet so its spot on the target has area A_spot (radius R) instead of the LED image:
    // a beam focused at di < Dt spreads to R ≈ r_img + rho*(Dt-di)/di at the target.
    for (const m of meta) {
      const rho = Math.sqrt(Math.max(0, m.Aap / Math.PI));
      const R = Math.sqrt(Math.max(0, m.A_spot / Math.PI)), ri = Math.sqrt(Math.max(0, m.Aimg / Math.PI));
      if (!(rho > 0.05) || R <= ri * 1.02) { m.di = m.g.Dt; continue; }
      let di = m.g.Dt / (1 + (R - ri) / rho);
      di = Math.max(di, 2.6 * rho, 0.04 * m.g.Dt);
      m.di = Math.min(di, m.g.Dt);
    }

    // ---- build surfaces
    const surfs = [], intent = [];
    for (let k = 0; k < meta.length; k++) {
      const m = meta[k];
      const rad = Math.sqrt(Math.max(0, m.Aap / Math.PI));
      if (!(rad > 0.3)) continue;
      const id = 'F' + k;
      surfs.push({ type: 'facet', id, group: 'A', P: m.P, S0: src.pos, Z: m.Z, di: m.di, flat: false,
        clip: { kind: 'disc', r: rad }, optics: { interaction: 'reflect', reflectivity: reflect, twoSided: false } });
      intent.push({ facet: id, cells: [] });
    }
    notes.push(surfs.length + ' wall facets · spot ' + (2 * Math.sqrt(A_min / Math.PI)).toFixed(0) + ' mm · capture prediction ' + Fpred.toFixed(3) + ' · kernel ' + ker.mm.toFixed(1) + ' mm');

    // ---- verify envelope + clearance; shrink/reject offenders
    let G = null;
    for (let pass = 0; pass < 14; pass++) {
      if (!surfs.length) break;
      G = RF.Geo.compile(surfs);
      const bad = validate(env, surfs, G, keep, emitters);
      if (!bad.size) break;
      for (const k of bad) {
        const cl = surfs[k].clip;
        if (cl.kind === 'disc') cl.r *= 0.62;
        else { const c = cl.pts3.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / cl.pts3.length); cl.pts3 = scalePoly(cl.pts3, c, 0.72); }
      }
      for (let i = surfs.length - 1; i >= 0; i--) {
        const cl = surfs[i].clip;
        if (cl.kind === 'disc' ? cl.r < 0.25 : (cl.pts3.length < 3 || polyArea2(cl.pts3.map((p) => [p[0], p[1]])) < 0.02)) surfs.splice(i, 1);
      }
    }
    // ---- direct-light shield (an absorbing part; free of the facet budget)
    const shield = settings.shield === false ? null : makeShield(input, T, Nmax);
    if (shield) {
      const test = surfs.concat([shield]);
      let ok = false;
      try {
        const GG = RF.Geo.compile(test);
        const bad = validate(env, test, GG, keep, emitters);
        ok = !bad.has(test.length - 1);
      } catch (e) { ok = false; }
      if (ok) surfs.push(shield);
      else notes.push('shield did not fit the envelope');
    }
    intent.length = 0;
    for (const s of surfs) intent.push({ facet: s.id, cells: [] });
    return { surfaces: surfs, intent, notes };
  }

  // ---------------------------------------------------------------- fallback for non-box envelopes
  // Same optics as the box path, but positions are sampled along LED directions up to the boundary
  // and inset until a disc of the wanted size fits.  Used for cylinder / ellipsoid envelopes.
  function solveFallback(input, settings, P, notes) {
    const src = input.source, env = input.envelope, T = RF.Engine.designFrame(input.target);
    const a = norm(src.axis), [bu, bv] = V.basis(a);
    const tdir = norm(V.sub(T.C, src.pos));
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const Nmax = Math.max(1, input.limits.maxFacets | 0);
    const N = Math.min(Nmax, Math.max(4, Math.round(Nmax * (settings.facets || 1))));
    const reflect = input.limits.reflectivity;
    const la = ledArea(src);
    const FIB = Math.PI * (3 - Math.sqrt(5));
    const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const kerArea = Math.max(1, Math.PI * 0.25 * ker.mm * ker.mm);
    const overlapT = clamp(settings.overlap === undefined ? 10 : settings.overlap, 0.5, 12);
    let A_min = Math.max(kerArea * clamp(settings.kernelBoost === undefined ? 1.5 : settings.kernelBoost, 0.4, 8), P.area * overlapT / Math.max(1, N));
    if ((settings.spotMM || 0) > 0) A_min = Math.max(A_min, settings.spotMM * settings.spotMM);
    const capF = clamp(settings.featureCap === undefined ? 2.5 : settings.featureCap, 0, 10);
    if (capF > 0) { const dEdge = paintEdgeScale(P); if (dEdge > 0) A_min = Math.min(A_min, Math.PI * 0.25 * (capF * dEdge) ** 2); }
    const eqv = clamp(settings.equalize === undefined ? 0.5 : settings.equalize, 0, 1);
    const gain = clamp(settings.capture === undefined ? 1 : settings.capture, 0.02, 1);
    const pack = clamp(settings.pack === undefined ? 0.42 : settings.pack, 0.1, 0.7);

    // ---- direction candidates
    const cands = [];
    const ND = 2600;
    for (let i = 0; i < ND; i++) {
      const z = 1 - 2 * (i + 0.5) / ND, rr = Math.sqrt(Math.max(0, 1 - z * z)), th = i * FIB + 1e-4;
      const dz = [rr * Math.cos(th), rr * Math.sin(th), z];
      const d = norm([bu[0] * dz[0] + bv[0] * dz[1] + a[0] * dz[2], bu[1] * dz[0] + bv[1] * dz[1] + a[1] * dz[2], bu[2] * dz[0] + bv[2] * dz[1] + a[2] * dz[2]]);
      const ct = V.dot(d, a);
      if (ct <= 0.03 || V.dot(d, tdir) > 0.2) continue;
      const iv = RF.Geo.envInterval(env, src.pos, d);
      if (!(iv[1] > iv[0]) || !isFinite(iv[1])) continue;
      const tWall = iv[1];
      if (tWall < keep + 2) continue;
      const toT0 = V.sub(T.C, V.add(src.pos, V.mul(d, tWall))), Dt0 = V.len(toT0), tt0 = V.mul(toT0, 1 / Dt0);
      const n0 = norm(V.add(V.mul(d, -1), tt0));
      const cosInc0 = Math.abs(V.dot(n0, d));
      if (cosInc0 < 0.08) continue;
      // patch area of one of N equal solid-angle cells on the boundary
      const patch = Math.max(4, 2 * Math.PI * tWall * tWall / (N * Math.max(0.25, cosInc0)));
      const rho0 = Math.min(tWall * 0.25, Math.max(0.6, pack * Math.sqrt(patch / Math.PI)));
      // inset until a disc of radius rho0 fits
      let inset = 0.3, Pq = null, g = null, afit = 0;
      for (let it = 0; it < 6; it++) {
        const t = tWall - inset;
        if (t < keep + 0.5) break;
        Pq = V.add(src.pos, V.mul(d, t));
        if (!RF.Geo.envInside(env, Pq)) { inset += 1; continue; }
        const Z0 = RF.Engine.targetUVtoWorld(T, 0, 0);
        g = facetAim(Pq, src.pos, Z0);
        afit = fitRadius(env, Pq, g.n, g.r);
        if (afit >= rho0) break;
        inset += Math.max(0.8, rho0 - afit + 0.4);
      }
      if (!Pq || !g || afit < 0.6) continue;
      const rho = Math.min(rho0, afit);
      const Aimg = imageArea(src, T, g.d, g.r, g.Dt, g.tt);
      const q = g.cosInc * relIntensity(src, Math.max(0, V.dot(g.d, a))) / (Math.PI * g.r * g.r);
      cands.push({ P: Pq, d, t: g.r, n: g.n, Aimg, q, ct, Dt: g.Dt, tt: g.tt, AapMax: Math.PI * rho * rho, rho });
    }
    if (!cands.length) return { surfaces: [], intent: [], notes: ['no usable facet position inside the envelope'] };
    // ---- select with a minimum angular separation (distinct solid angle)
    cands.sort((x, y) => (y.AapMax * y.q) - (x.AapMax * x.q));
    const chosen = [], cosSep = Math.cos(clamp(settings.spread === undefined ? 8 : settings.spread, 1, 30) * D2R);
    for (const c of cands) { if (chosen.length >= N) break; if (chosen.every((o) => V.dot(c.d, o.d) <= cosSep)) chosen.push(c); }
    if (!chosen.length) chosen.push(cands[0]);
    // ---- aims + assignment (paint-mass sample; random permutation keeps each facet's marginal ∝ paint)
    let aims = sampleAims(P, chosen.length, 9001 + (input.seed | 0));
    while (aims.length < chosen.length) { const aa = aims[aims.length % Math.max(1, aims.length)] || [0, 0, 1]; aims.push([aa[0] + 0.01, aa[1], aa[2]]); }
    shuffle(chosen, 4242 + (input.seed | 0));
    const meta = [];
    for (let k = 0; k < chosen.length; k++) {
      const c = chosen[k], [u, v, lv] = aims[k];
      const Z = RF.Engine.targetUVtoWorld(T, u, v);
      const g = facetAim(c.P, src.pos, Z);
      const Aimg = imageArea(src, T, g.d, g.r, g.Dt, g.tt);
      const q = g.cosInc * relIntensity(src, Math.max(0, V.dot(g.d, a))) / (Math.PI * g.r * g.r);
      const A_spot = Math.max(Aimg, A_min);
      meta.push({ c, Z, g, Aimg, q, A_spot, lv, I: q * c.AapMax / A_spot });
    }
    let I = Infinity;
    if (eqv <= 0) I = Infinity; else {
      const Ii = meta.map((m) => m.I).sort((x, y) => x - y);
      I = eqv >= 1 ? Ii[0] : Ii[Math.floor(eqv * Math.max(0, Ii.length - 1))];
    }
    if (!(I > 0)) I = 0;
    I *= gain;
    const surfs = [], intent = [];
    for (const m of meta) {
      const Aap = eqv <= 0 ? m.c.AapMax * gain : Math.min(m.c.AapMax, I * m.A_spot / Math.max(1e-12, m.q));
      const rad = Math.sqrt(Math.max(0, Aap / Math.PI));
      if (!(rad > 0.3)) continue;
      const rho = rad, R = Math.sqrt(Math.max(0, m.A_spot / Math.PI)), ri = Math.sqrt(Math.max(0, m.Aimg / Math.PI));
      let di = m.g.Dt;
      if (rho > 0.05 && R > ri * 1.02) {
        di = m.g.Dt / (1 + (R - ri) / rho);
        di = Math.max(di, 2.6 * rho, 0.04 * m.g.Dt);
        di = Math.min(di, m.g.Dt);
      }
      const id = 'F' + surfs.length;
      surfs.push({ type: 'facet', id, group: 'A', P: m.c.P, S0: src.pos, Z: m.Z, di, flat: false,
        clip: { kind: 'disc', r: rad }, optics: { interaction: 'reflect', reflectivity: reflect, twoSided: false } });
      intent.push({ facet: id, cells: [] });
    }
    // verify / shrink
    let G = null;
    for (let pass = 0; pass < 14; pass++) {
      if (!surfs.length) break;
      G = RF.Geo.compile(surfs);
      const bad = validate(env, surfs, G, keep, emittersOf(input));
      if (!bad.size) break;
      for (const k of bad) surfs[k].clip.r *= 0.65;
      for (let i = surfs.length - 1; i >= 0; i--) if (surfs[i].clip.r < 0.25) surfs.splice(i, 1);
    }
    const shield = settings.shield === false ? null : makeShield(input, T, Nmax);
    if (shield) {
      try {
        const test = surfs.concat([shield]);
        const GG = RF.Geo.compile(test);
        const bad = validate(env, test, GG, keep, emittersOf(input));
        if (!bad.has(test.length - 1)) surfs.push(shield);
      } catch (e) { /* omit */ }
    }
    intent.length = 0;
    for (const s of surfs) intent.push({ facet: s.id, cells: [] });
    notes.push(surfs.length + ' facets (direction/disc fallback) · spot ' + (2 * Math.sqrt(A_min / Math.PI)).toFixed(0) + ' mm');
    return { surfaces: surfs, intent, notes };
  }

  function emittersOf(input) { return (input.sources && input.sources.length ? input.sources : [input.source]).map((s) => s.pos); }

  RF.Solvers.register({
    id: 'bench-dsv41f1017-max--paint-tile', name: 'Paint tiles (static)', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'facets', label: 'Facet fraction of cap', type: 'range', min: 0.1, max: 1, step: 0.05, default: 1 },
      { key: 'capture', label: 'Flux scale', type: 'range', min: 0.02, max: 1, step: 0.01, default: 1 },
      { key: 'frontCut', label: 'Front exclusion (cos)', type: 'range', min: -0.6, max: 0.8, step: 0.05, default: 0.2 },
      { key: 'pack', label: 'Aperture packing', type: 'range', min: 0.1, max: 0.7, step: 0.01, default: 0.42 },
      { key: 'assign', label: 'Aim assignment', type: 'select', options: [{ value: 'height', label: 'height-sorted' }, { value: 'random', label: 'random' }], default: 'random' },
      { key: 'sampler', label: 'Aim sampler', type: 'select', options: [{ value: 'mass', label: 'paint-mass' }, { value: 'lattice', label: 'area lattice' }], default: 'mass' },
      { key: 'erode', label: 'Erode aim mask (cells)', type: 'range', min: 0, max: 6, step: 1, default: 0 },
      { key: 'shield', label: 'Direct-light shield', type: 'checkbox', default: true },
      { key: 'overlap', label: 'Target spot overlap', type: 'range', min: 0.5, max: 12, step: 0.25, default: 10 },
      { key: 'equalize', label: 'Intensity balance', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'drop', label: 'Drop weakest facets', type: 'range', min: 0, max: 0.7, step: 0.05, default: 0 },
      { key: 'kernelBoost', label: 'Kernel size boost', type: 'range', min: 0.4, max: 8, step: 0.1, default: 1.5 },
      { key: 'spotMM', label: 'Fixed spot size (mm, 0=auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'spread', label: 'Direction spread (deg)', type: 'range', min: 1, max: 30, step: 0.5, default: 8 },
      { key: 'featureCap', label: 'Feature-scale spot cap (x)', type: 'range', min: 0, max: 10, step: 0.25, default: 2.5 },
      { key: 'method', label: 'Spot method', type: 'select', options: [{ value: 'statistical', label: 'mass sample (statistical)' }, { value: 'uniform', label: 'uniform lattice + direct flux' }], default: 'statistical' },
    ],
    solve,
  });

  // ---------------------------------------------------------------- optional tuner (-auto)
  /* A second solver that picks paint-tile's settings for a goal by tracing a handful of candidates
   * (allowed only for ids ending in -auto).  All candidates are solved with the same static
   * algorithm, are traced with the SAME SEED so their differences are geometry rather than dice,
   * and the winner is returned unchanged (so it is subject to exactly the same host verification).
   *
   *  faithful  : maximise the paint fidelity F1.
   *  throw     : F1 first, then more light on the paint and more throw (gated by F1 > 0.5).
   *  efficient : F1 first, then more light, more peak and fewer facets (gated by F1 > 0.5).
   *
   * The first candidate is always the tuned static default, so losing the tracer (an older host, a
   * ray budget too small) falls back to the static solver's settings.
   */
  const AUTO_CANDIDATES = {
    faithful: [
      {},
      { overlap: 12 },
      { overlap: 8 },
      { overlap: 10, pack: 0.40 },
      { overlap: 10, equalize: 0.65 },
    ],
    throw: [
      { overlap: 8, pack: 0.48 },
      { overlap: 10, pack: 0.45 },
      { overlap: 6, pack: 0.52 },
      { overlap: 8, pack: 0.42 },
      { overlap: 12, pack: 0.46 },
    ],
    efficient: [
      { overlap: 10, pack: 0.48 },
      { overlap: 8, pack: 0.52 },
      { overlap: 6, pack: 0.55 },
      { overlap: 10, pack: 0.42 },
      { overlap: 10, pack: 0.46, facets: 0.75 },
    ],
  };

  function autoSolve(input, settings, tools) {
    const staticDef = RF.Solvers.get('bench-dsv41f1017-max--paint-tile');
    if (!staticDef) return solve(input, settings);
    const base = RF.Solvers.defaults(staticDef);
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const minDistance = Math.max(0, +settings.minDistance || 0);
    const list = AUTO_CANDIDATES[goal].map((c) => Object.assign({}, base, c, { minDistance }));
    const seed = input.seed | 0;
    const budgetRays = tools && tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : 6e6;
    const want = Math.max(20000, Math.min(500000, +settings.rays || 180000));
    const per = Math.max(20000, Math.min(want, Math.floor(budgetRays / (list.length + 7))));
    const run = (cs) => { try { return solve(input, cs); } catch (e) { return null; } };
    const trace = (out, rays) => {
      if (!out || !tools || typeof tools.trace !== 'function') return null;
      try { return tools.trace(out.surfaces, { rays, seed }); } catch (e) { return null; }
    };
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const out = run(list[i]);
      if (out) rows.push({ i, cs: list[i], out, tr: trace(out, per) });
    }
    if (!rows.length) return solve(input, list[0]);
    const maxOf = (get) => Math.max(1e-9, ...rows.map((r) => get(r) || 0));
    const maxOn = maxOf((r) => r.tr && r.tr.fidelity ? r.tr.fidelity.onPaint : 0);
    const maxPeak = maxOf((r) => r.tr && r.tr.peakCd ? r.tr.peakCd : 0);
    const maxThrow = maxOf((r) => r.tr && r.tr.throwM ? r.tr.throwM : 0);
    const nFacets = (r) => r.out.surfaces.filter((s) => ((s.optics && s.optics.interaction) || 'reflect') === 'reflect').length;
    const value = (r) => {
      const tr = r.tr, f = tr && tr.fidelity ? tr.fidelity.fidelity : 0;
      if (goal === 'faithful') return f;
      const g = clamp((f - 0.5) / 0.25, 0, 1);
      const on = tr && tr.fidelity ? tr.fidelity.onPaint / maxOn : 0;
      if (goal === 'throw') return f + g * (0.45 * on + 0.15 * ((tr && tr.throwM || 0) / maxThrow));
      return f + g * (0.30 * on + 0.20 * ((tr && tr.peakCd || 0) / maxPeak) + 0.02 * (1 - nFacets(r) / Math.max(1, input.limits.maxFacets)));
    };
    const scored = rows.filter((r) => r.tr);
    if (!scored.length) return rows[0].out;              // no tracer: the tuned static default
    scored.sort((a, b) => value(b) - value(a) || a.i - b.i);
    const top = scored.slice(0, 2);
    const per2 = Math.max(per, Math.min(500000, per * 3));
    if (per2 > per) for (const r of top) { const tr2 = trace(r.out, per2); if (tr2) r.tr = tr2; }
    top.sort((a, b) => value(b) - value(a) || a.i - b.i);
    const best = top[0], out = best.out, tr = best.tr;
    const diff = Object.keys(best.cs).filter((k) => best.cs[k] !== base[k]).map((k) => k + '=' + best.cs[k]).join(', ') || 'static defaults';
    const fm = tr && tr.fidelity ? ' · F ' + (tr.fidelity.fidelity * 100).toFixed(1) + '% · on paint ' + (tr.fidelity.onPaint * 100).toFixed(1) + '% · peak ' + Math.round(tr.peakCd || 0) + ' cd' : '';
    out.notes = (out.notes || []).concat(['auto(' + goal + '): ' + diff + fm]);
    return out;
  }

  RF.Solvers.register({
    id: 'bench-dsv41f1017-max--paint-tile-auto', name: 'Paint tiles (auto-tuned)', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: [{ value: 'faithful', label: 'faithful (fidelity)' }, { value: 'throw', label: 'throw (light + reach)' }, { value: 'efficient', label: 'efficient (light + peak)' }], default: 'faithful' },
      { key: 'rays', label: 'Rays per candidate', type: 'number', min: 20000, max: 500000, step: 10000, default: 180000 },
    ],
    solve: autoSolve,
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
