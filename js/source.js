/* source.js — light source model: geometry (sampled, never approximated), emission axis in any
 * 3D direction, angular distribution, flux integrals used by the solver, and drawing outlines.
 *
 * src = { kind: 'point'|'planar'|'volume', shape: 'rect'|'disc' (planar) | 'sphere'|'cylinder'
 *         (volume), pos:[3], axis:[3] (any direction, normalised on use), roll (deg, rotates the
 *         rectangle about the axis), w, h (rect), radius (disc/sphere/cylinder), length
 *         (cylinder, along the axis), power, dist: 'lambertian'|'gaussian'|'cone'|'isotropic',
 *         sigma (deg, gaussian), halfAngle (deg, cone),
 *         emission: 'volume' | 'surface' (volume sources only) }
 *
 * A volume source emits one of two ways.  'volume' (the default): from points spread through the body, in
 * directions set by `dist` about the axis, independent of the point — an optically thin glow (a gas discharge,
 * a fluorescent tube, an arc).  'surface': an OPAQUE body whose skin is Lambertian (a tightly wound filament
 * coil): points on the surface, directions cosine-weighted about the local outward normal, `dist` unused.  Its
 * intensity is then ∝ the body's projected area — a long coil is dark end-on (I ∝ sinθ off the axis) — and
 * its luminance is the same from every direction.
 *
 * Planar emitters radiate into the front hemisphere only (a die cannot emit through its own
 * substrate), so every distribution is truncated at 90° for them.  Point and volume sources may
 * emit into the full sphere.  The emitter itself is NOT an occluder in the trace.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const D2R = Math.PI / 180;

  function frame(src) {
    const a = V.norm(src.axis);
    const [u0, v0] = V.basis(a);
    const r = (src.roll || 0) * D2R;
    const u = V.add(V.mul(u0, Math.cos(r)), V.mul(v0, Math.sin(r)));
    const v = V.cross(a, u);
    return { a, u, v };
  }

  const opaque = (src) => src.kind === 'volume' && src.emission === 'surface';
  // surface area of an opaque volume source, and the share of it on a cylinder's side (vs its two end caps)
  function skinArea(src) { return src.shape === 'cylinder' ? 2 * Math.PI * src.radius * (src.length + src.radius) : 4 * Math.PI * src.radius * src.radius; }
  function thetaMax(src) {
    if (opaque(src)) return Math.PI;
    const cap = src.kind === 'planar' ? 90 : 180;
    if (src.dist === 'lambertian') return 90 * D2R;
    if (src.dist === 'cone') return Math.min(cap, Math.max(0.01, src.halfAngle)) * D2R;
    return cap * D2R;
  }

  // Relative radiant intensity (per steradian) at polar angle theta from the emission axis.
  function intensity(src, theta) {
    const tm = thetaMax(src);
    if (theta > tm + 1e-12) return 0;
    if (opaque(src)) return src.shape === 'cylinder'           // projected area (mm²): side + end caps
      ? 2 * src.radius * src.length * Math.sin(theta) + Math.PI * src.radius * src.radius * Math.abs(Math.cos(theta)) : Math.PI * src.radius * src.radius;
    switch (src.dist) {
      case 'lambertian': return Math.max(0, Math.cos(theta));
      case 'gaussian': { const s = Math.max(0.1, src.sigma) * D2R; return Math.exp(-theta * theta / (2 * s * s)); }
      default: return 1;                                   // cone, isotropic (uniform per sr)
    }
  }

  // ∫ I dΩ over the sphere
  function totalIntegral(src) {
    const tm = thetaMax(src);
    if (opaque(src)) return Math.PI * skinArea(src);              // ∫ projected area dΩ = π × surface area (Cauchy), matching intensity()
    if (src.dist === 'lambertian') return Math.PI;
    if (src.dist === 'cone' || src.dist === 'isotropic') return 2 * Math.PI * (1 - Math.cos(tm));
    const N = 4096; let s = 0;
    for (let i = 0; i < N; i++) { const t = (i + 0.5) / N * tm; s += intensity(src, t) * Math.sin(t); }
    return 2 * Math.PI * s * tm / N;
  }

  /* Sampler: precomputed once per run.  Directions are drawn with pdf ∝ I(θ) sinθ (i.e.
   * proportional to intensity per solid angle), so every ray carries equal power.           */
  function makeSampler(src) {
    const fr = frame(src), tm = thetaMax(src);
    const S = { src, fr, tm, kind: src.kind, shape: src.shape, dist: src.dist, cosMax: Math.cos(tm), table: null };
    if (src.dist === 'gaussian') {
      const N = 8192, cdf = new Float64Array(N + 1);
      let acc = 0, prev = 0;
      for (let i = 1; i <= N; i++) {
        const t = i / N * tm, f = intensity(src, t) * Math.sin(t);
        acc += 0.5 * (prev + f) * (tm / N); prev = f; cdf[i] = acc;
      }
      for (let i = 0; i <= N; i++) cdf[i] /= acc;
      S.table = cdf; S.N = N;
    }
    S.opaque = opaque(src);
    if (S.opaque && src.shape === 'cylinder') S.pSide = src.length / (src.length + src.radius);   // side area ÷ total
    S.pos = src.pos.slice();
    S.w = src.w; S.h = src.h; S.R = src.radius; S.L = src.length;
    return S;
  }

  // Sample polar angle cos from uniform x ∈ [0,1)
  function sampleCos(S, x) {
    if (S.dist === 'lambertian') return Math.sqrt(1 - x);               // pdf ∝ cosθ sinθ
    if (S.dist === 'gaussian') {
      const c = S.table; let lo = 0, hi = S.N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= x) lo = m; else hi = m; }
      const f = (x - c[lo]) / Math.max(1e-300, c[hi] - c[lo]);
      return Math.cos((lo + f) / S.N * S.tm);
    }
    return 1 - x * (1 - S.cosMax);                                       // uniform per sr in cone
  }

  // Writes origin (o) and direction (d) for uniforms x0..x4.
  function sampleRay(S, x0, x1, x2, x3, x4, o, d) {
    const fr = S.fr, p = S.pos;
    if (S.opaque) {                                    // a point on the skin, a cosine-weighted direction about its normal
      let n, t1, t2, q;
      if (S.shape === 'cylinder') {
        if (x0 < S.pSide) {
          const a = 2 * Math.PI * x1, c = Math.cos(a), s = Math.sin(a), h = (x2 - 0.5) * S.L;
          n = [c * fr.u[0] + s * fr.v[0], c * fr.u[1] + s * fr.v[1], c * fr.u[2] + s * fr.v[2]];
          t1 = fr.a; t2 = [-s * fr.u[0] + c * fr.v[0], -s * fr.u[1] + c * fr.v[1], -s * fr.u[2] + c * fr.v[2]];
          q = [S.R * n[0] + h * fr.a[0], S.R * n[1] + h * fr.a[1], S.R * n[2] + h * fr.a[2]];
        } else {
          const top = (x0 - S.pSide) / (1 - S.pSide) < 0.5, sg = top ? 1 : -1, r = S.R * Math.sqrt(x2), a = 2 * Math.PI * x1, cu = r * Math.cos(a), cv = r * Math.sin(a);
          n = [sg * fr.a[0], sg * fr.a[1], sg * fr.a[2]]; t1 = fr.u; t2 = fr.v;
          q = [cu * fr.u[0] + cv * fr.v[0] + sg * S.L / 2 * fr.a[0], cu * fr.u[1] + cv * fr.v[1] + sg * S.L / 2 * fr.a[1], cu * fr.u[2] + cv * fr.v[2] + sg * S.L / 2 * fr.a[2]];
        }
      } else {
        const ct = 1 - 2 * x1, st = Math.sqrt(Math.max(0, 1 - ct * ct)), a = 2 * Math.PI * x2;
        n = [st * Math.cos(a), st * Math.sin(a), ct]; [t1, t2] = V.basis(n); q = [S.R * n[0], S.R * n[1], S.R * n[2]];
      }
      const c = Math.sqrt(1 - x3), s = Math.sqrt(x3), ph = 2 * Math.PI * x4, cu = s * Math.cos(ph), cv = s * Math.sin(ph);
      for (let i = 0; i < 3; i++) { d[i] = c * n[i] + cu * t1[i] + cv * t2[i]; o[i] = p[i] + q[i]; }
      return;
    }
    let px = p[0], py = p[1], pz = p[2];
    if (S.kind === 'planar') {
      if (S.shape === 'disc') {
        const r = S.R * Math.sqrt(x0), a = 2 * Math.PI * x1, cu = r * Math.cos(a), cv = r * Math.sin(a);
        px += cu * fr.u[0] + cv * fr.v[0]; py += cu * fr.u[1] + cv * fr.v[1]; pz += cu * fr.u[2] + cv * fr.v[2];
      } else {
        const cu = (x0 - 0.5) * S.w, cv = (x1 - 0.5) * S.h;
        px += cu * fr.u[0] + cv * fr.v[0]; py += cu * fr.u[1] + cv * fr.v[1]; pz += cu * fr.u[2] + cv * fr.v[2];
      }
    } else if (S.kind === 'volume') {
      if (S.shape === 'cylinder') {
        const r = S.R * Math.sqrt(x0), a = 2 * Math.PI * x1, cu = r * Math.cos(a), cv = r * Math.sin(a), ca = (x2 - 0.5) * S.L;
        px += cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0]; py += cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1]; pz += cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2];
      } else {                                                           // uniform in the ball
        const r = S.R * Math.cbrt(x0), ct = 1 - 2 * x1, st = Math.sqrt(Math.max(0, 1 - ct * ct)), a = 2 * Math.PI * x2;
        px += r * st * Math.cos(a); py += r * st * Math.sin(a); pz += r * ct;
      }
    }
    const ct = sampleCos(S, x3), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = 2 * Math.PI * x4;
    const cu = st * Math.cos(ph), cv = st * Math.sin(ph);
    d[0] = cu * fr.u[0] + cv * fr.v[0] + ct * fr.a[0];
    d[1] = cu * fr.u[1] + cv * fr.v[1] + ct * fr.a[1];
    d[2] = cu * fr.u[2] + cv * fr.v[2] + ct * fr.a[2];
    o[0] = px; o[1] = py; o[2] = pz;
  }

  // Covariance (world 3×3, row-major) of the emitting points — used by the first-order tile model.
  function extentCov(src) {
    const fr = frame(src), C = new Array(9).fill(0);
    const addOuter = (e, s) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] += s * e[i] * e[j]; };
    if (src.kind === 'planar') {
      if (src.shape === 'disc') { addOuter(fr.u, src.radius * src.radius / 4); addOuter(fr.v, src.radius * src.radius / 4); }
      else { addOuter(fr.u, src.w * src.w / 12); addOuter(fr.v, src.h * src.h / 12); }
    } else if (src.kind === 'volume') {
      if (src.shape === 'cylinder') {
        addOuter(fr.u, src.radius * src.radius / 4); addOuter(fr.v, src.radius * src.radius / 4); addOuter(fr.a, src.length * src.length / 12);
      } else { const s = src.radius * src.radius / 5; addOuter([1, 0, 0], s); addOuter([0, 1, 0], s); addOuter([0, 0, 1], s); }
    }
    return C;
  }

  function boundingRadius(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? src.radius : Math.hypot(src.w, src.h) / 2;
    if (src.kind === 'volume') return src.shape === 'cylinder' ? Math.hypot(src.radius, src.length / 2) : src.radius;
    return 0;
  }
  // Characteristic linear size of the emitter (for reports): max projected width
  function extentSize(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.max(src.w, src.h);
    if (src.kind === 'volume') return src.shape === 'cylinder' ? Math.max(2 * src.radius, src.length) : 2 * src.radius;
    return 0;
  }
  // Emitting area (planar) or projected cross-section (volume) — for the étendue estimate
  function emittingArea(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? Math.PI * src.radius * src.radius : src.w * src.h;
    if (src.kind === 'volume') return src.shape === 'cylinder' ? 2 * src.radius * src.length : Math.PI * src.radius * src.radius;
    return 0;
  }

  // Drawing primitives in world space
  function outline(src) {
    const fr = frame(src), p = src.pos, out = { kind: src.kind, shape: src.shape, pos: p, axis: fr.a, polys: [], circles: [] };
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const ring = (r, ca) => { const q = []; for (let i = 0; i < 24; i++) { const t = i / 24 * 2 * Math.PI; q.push(at(r * Math.cos(t), r * Math.sin(t), ca)); } return q; };
    if (src.kind === 'planar') {
      if (src.shape === 'disc') out.polys.push(ring(src.radius, 0));
      else out.polys.push([at(-src.w / 2, -src.h / 2, 0), at(src.w / 2, -src.h / 2, 0), at(src.w / 2, src.h / 2, 0), at(-src.w / 2, src.h / 2, 0)]);
    } else if (src.kind === 'volume') {
      if (src.shape === 'cylinder') {
        const a = ring(src.radius, -src.length / 2), b = ring(src.radius, src.length / 2);
        out.polys.push(a, b);
        out.lines = [];
        for (let i = 0; i < 24; i += 3) out.lines.push([a[i], b[i]]);
        out.cyl = { a, b };
      } else out.circles.push({ c: p, r: src.radius });
    }
    return out;
  }

  RF.Source = { frame, thetaMax, intensity, totalIntegral, makeSampler, sampleRay, extentCov, boundingRadius, extentSize, emittingArea, outline };
})(typeof globalThis !== 'undefined' ? globalThis : this);
