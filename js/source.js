/* source.js — light source model: geometry (sampled, never approximated), emission axis in any
 * 3D direction, angular distribution, flux integrals used by the solver, and drawing outlines.
 *
 * src = { kind: 'point'|'planar'|'volume'|'arc', shape: 'rect'|'disc' (planar) | 'sphere'|'cylinder'
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
 *
 * Arc: length is the electrode gap; pos is its midpoint and axis follows the electrode line. arc.bow
 * is the centre sagitta along arc.up projected perpendicular to axis. A parabolic centreline carries a
 * circular Gaussian cross-section (arc.fwhm, truncated at 3σ); axial density is
 * 1 + arc.hot × (exp(-distanceFromTip1/arc.tipWidth) + exp(-distanceFromTip2/arc.tipWidth)).
 * Emission is isotropic at each point. Optional arc.tube refracts through two concentric ellipsoids
 * (inner transverse radius tubeRadius, axial length tubeLength; wall added to both semi-axes, index).
 * Snell + TIR only, no Fresnel or electrode/holder shadows. arc.stripes masks two opposite angular
 * bands of stripeWidth at stripeAngle, on an outer cylinder of stripeRadius. Bulb effects are analytic,
 * not trace surfaces. Blocked/trapped draws are resampled: power is the rated flux outside the bulb.
 * Intrinsic extent helpers approximate the emitting cloud; bulb-on solvers must judge the real trace.
 *
 * Dome (planar sources): src.dome = { r: radius mm (0 = none), n: index (silicone ≈ 1.41), z: centre height above the die
 * plane (0 = a hemisphere centred on the die) }.  Each ray leaves the die into the silicone (same distribution), meets the
 * sphere and refracts out (Snell), or reflects back — by total internal reflection, or by the Fresnel share (unpolarised,
 * drawn per ray).  Light that comes back down to the base is re-emitted diffusely from where it lands (phosphor and white
 * package recycle it; no loss — `power` is the measured domed flux, so the recycling only moves light around).  The
 * dome is analytic (not a surface in the trace) and, like the die, not an occluder.  What the optics then see is the die
 * magnified: × n for a die at the centre (apparent(src) gives the flat equivalent the solvers plan with).
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

  // Arc parameters are optional only on the new kind; old sources never acquire defaults.
  const ARC_DEFAULTS = { bow: 0.5, fwhm: 1.1 * Math.sqrt(Math.log(2) / Math.log(5)), hot: 2, tipWidth: 0.25, up: [0, 0, 1], tube: false, tubeRadius: 2.5, wall: 0.5, tubeLength: 8, index: 1.46, stripes: false, stripeRadius: 4.5, stripeWidth: 20, stripeAngle: 50 };
  function arcParams(src) {
    const a = Object.assign({}, ARC_DEFAULTS, src.arc || {});
    a.tubeLength = Math.max(a.tubeLength, src.length * 1.1);
    a.tubeRadius = Math.max(a.tubeRadius, (a.bow + 3 * a.fwhm / 2.354820045) / Math.sqrt(1 - (src.length / a.tubeLength) ** 2) * 1.01);
    a.stripeRadius = Math.max(a.stripeRadius, a.tubeRadius + a.wall + 0.01); return a;
  }
  function arcFrame(src) {
    const fr = frame(src), up = arcParams(src).up, q = V.sub(up, V.mul(fr.a, V.dot(up, fr.a)));
    fr.v = V.len(q) > 1e-8 ? V.norm(q) : fr.v; fr.u = V.cross(fr.v, fr.a); return fr;
  }
  const opaque = (src) => src.kind === 'volume' && src.emission === 'surface';
  // surface area of an opaque volume source, and the share of it on a cylinder's side (vs its two end caps)
  function skinArea(src) { return src.shape === 'cylinder' ? 2 * Math.PI * src.radius * (src.length + src.radius) : 4 * Math.PI * src.radius * src.radius; }
  function thetaMax(src) {
    if (src.kind === 'arc' || opaque(src)) return Math.PI;
    const cap = src.kind === 'planar' ? 90 : 180;
    if (src.dist === 'lambertian') return 90 * D2R;
    if (src.dist === 'cone') return Math.min(cap, Math.max(0.01, src.halfAngle)) * D2R;
    return cap * D2R;
  }

  // Relative radiant intensity (per steradian) at polar angle theta from the emission axis.
  function intensity(src, theta) {
    const tm = thetaMax(src);
    if (src.kind === 'arc') return 1;
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
    if (src.kind === 'arc') return 4 * Math.PI;
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
    const fr = src.kind === 'arc' ? arcFrame(src) : frame(src), tm = thetaMax(src);
    const S = { src, fr, tm, kind: src.kind, shape: src.shape, dist: src.dist, cosMax: Math.cos(tm), table: null };
    if (src.kind !== 'arc' && src.dist === 'gaussian') {
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
    S.dome = hasDome(src) ? { r: src.dome.r, n: src.dome.n > 1 ? src.dome.n : 1.41, z: src.dome.z || 0 } : null;
    if (src.kind === 'arc') {
      S.arc = arcParams(src); S.dist = 'isotropic'; S.cosMax = -1;
      // Tabulate the inverse axial CDF once, shared as f32 with WebGPU. Density peaks at both tips.
      const N = 2048, cdf = new Float64Array(N + 1), inv = new Float32Array(N + 1), a = S.arc, L = src.length;
      const density = (z) => 1 + a.hot * (Math.exp(-z / a.tipWidth) + Math.exp(-(L - z) / a.tipWidth));
      for (let i = 1; i <= N; i++) cdf[i] = cdf[i - 1] + (density((i - 1) * L / N) + density(i * L / N)) / 2;
      for (let i = 0; i <= N; i++) cdf[i] /= cdf[N];
      let j = 0;
      for (let i = 0; i <= N; i++) { const x = i / N; while (j < N - 1 && cdf[j + 1] < x) j++; inv[i] = ((j + (x - cdf[j]) / (cdf[j + 1] - cdf[j])) / N - 0.5) * L; }
      S.arcTable = inv;
    }
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
    if (S.arc) { arcRay(S, x0, x1, x2, x3, x4, o, d); return; }
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
    if (S.dome) domeOut(S, o, d, x0, x3, x4);
  }

  // Hollow, concentric quartz ellipsoids. Geometric Snell refraction + TIR, no Fresnel loss:
  // source.power is the measured flux OUTSIDE the complete bulb (also after the R coating).
  function arcShell(q, d, a) {
    const ri = a.tubeRadius, hi = a.tubeLength / 2, ro = ri + a.wall, ho = hi + a.wall;
    let glass = false;
    for (let k = 0; k < 64; k++) {
      let t = Infinity, normal, outer = false;
      for (let j = 0; j < 2; j++) {
        const r = j ? ro : ri, h = j ? ho : hi, rr = r * r, hh = h * h;
        const A = (d[0] * d[0] + d[1] * d[1]) / rr + d[2] * d[2] / hh;
        const B = (q[0] * d[0] + q[1] * d[1]) / rr + q[2] * d[2] / hh;
        const C = (q[0] * q[0] + q[1] * q[1]) / rr + q[2] * q[2] / hh - 1, disc = B * B - A * C;
        if (disc < 0) continue;
        for (const hit of [(-B - Math.sqrt(disc)) / A, (-B + Math.sqrt(disc)) / A]) if (hit > 1e-5 && hit < t) {
          t = hit; normal = V.norm([(q[0] + t * d[0]) / rr, (q[1] + t * d[1]) / rr, (q[2] + t * d[2]) / hh]); outer = !!j;
        }
      }
      if (!normal) return false;
      for (let i = 0; i < 3; i++) q[i] += t * d[i];
      if (V.dot(d, normal) < 0) normal = V.neg(normal);
      const ci = V.dot(d, normal), eta = glass ? a.index : 1 / a.index, s2 = eta * eta * Math.max(0, 1 - ci * ci);
      if (s2 >= 1) { for (let i = 0; i < 3; i++) d[i] -= 2 * ci * normal[i]; }
      else {
        const f = Math.sqrt(1 - s2) - eta * ci;
        for (let i = 0; i < 3; i++) d[i] = eta * d[i] + f * normal[i];
        if (glass && outer) return true;
        glass = !glass;
      }
    }
    return false; // a trapped path is resampled; never manufacture an escape direction
  }
  function arcBlocked(q, d, a) {
    const A = d[0] * d[0] + d[1] * d[1]; if (A < 1e-12) return false;
    const B = q[0] * d[0] + q[1] * d[1], C = q[0] * q[0] + q[1] * q[1] - a.stripeRadius ** 2;
    const t = (-B + Math.sqrt(Math.max(0, B * B - A * C))) / A;
    const x = q[0] + t * d[0], y = q[1] + t * d[1], ph = a.stripeAngle * D2R;
    return Math.abs(x * Math.sin(ph) - y * Math.cos(ph)) < a.stripeRadius * Math.sin(a.stripeWidth * D2R / 2);
  }
  function arcRay(S, x0, x1, x2, x3, x4, o, d) {
    const a = S.arc, fr = S.fr, tab = S.arcTable, N = tab.length - 1;
    let st = (Math.floor(x0 * 4294967296) ^ Math.imul(Math.floor(x3 * 4294967296) | 0, 0x9E3779B1) ^ Math.floor(x4 * 2147483648)) | 0;
    const rnd = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (;;) {
      const f = Math.min(N - 1e-6, x2 * N), j = Math.floor(f), z = tab[j] + (tab[j + 1] - tab[j]) * (f - j);
      const r = a.fwhm / 2.354820045 * Math.sqrt(-2 * Math.log(1 - x0 * (1 - Math.exp(-4.5)))), ph = 2 * Math.PI * x1;
      const q = [r * Math.cos(ph), r * Math.sin(ph) + a.bow * (1 - (2 * z / S.L) ** 2), z];
      const ct = 1 - 2 * x3, sn = Math.sqrt(Math.max(0, 1 - ct * ct)), az = 2 * Math.PI * x4, D = [sn * Math.cos(az), sn * Math.sin(az), ct];
      if ((!a.tube || arcShell(q, D, a)) && (!a.stripes || !arcBlocked(q, D, a))) {
        for (let i = 0; i < 3; i++) { o[i] = S.pos[i] + q[0] * fr.u[i] + q[1] * fr.v[i] + q[2] * fr.a[i]; d[i] = D[0] * fr.u[i] + D[1] * fr.v[i] + D[2] * fr.a[i]; }
        return;
      }
      x0 = rnd(); x1 = rnd(); x2 = rnd(); x3 = rnd(); x4 = rnd();
    }
  }

  // ---- the dome: walk a ray from the die out through the sphere (in place on o, d)
  const hasDome = (src) => src.kind === 'planar' && !!src.dome && src.dome.r > 0;
  function domeOut(S, o, d, x0, x3, x4) {
    const a = S.fr.a, p = S.pos, R = S.dome.r, n = S.dome.n, cx = p[0] + S.dome.z * a[0], cy = p[1] + S.dome.z * a[1], cz = p[2] + S.dome.z * a[2];
    // the ray's own extra random numbers: a small generator seeded from its uniforms (deterministic per ray)
    let st = (Math.floor(x0 * 4294967296) ^ Math.imul(Math.floor(x3 * 4294967296) | 0, 0x9E3779B1) ^ Math.floor(x4 * 2147483648)) | 0;
    const rnd = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const R0 = ((n - 1) / (n + 1)) ** 2;
    let ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2];
    for (let k = 0; k < 64; k++) {
      const qx = ox - cx, qy = oy - cy, qz = oz - cz, b = qx * dx + qy * dy + qz * dz, cc = qx * qx + qy * qy + qz * qz - R * R;
      const ts = -b + Math.sqrt(Math.max(0, b * b - cc));                       // inside the sphere: the far root
      const da = dx * a[0] + dy * a[1] + dz * a[2], ha = (ox - p[0]) * a[0] + (oy - p[1]) * a[1] + (oz - p[2]) * a[2];
      const tp = da < -1e-12 ? -ha / da : Infinity;                             // the base plane, if heading down
      if (tp < ts) {                                                            // back on the base: re-emitted diffusely from there
        ox += tp * dx; oy += tp * dy; oz += tp * dz;
        const c = Math.sqrt(1 - rnd()), sn = Math.sqrt(Math.max(0, 1 - c * c)), ph = 2 * Math.PI * rnd(), u = S.fr.u, v = S.fr.v, cu = sn * Math.cos(ph), cv = sn * Math.sin(ph);
        dx = cu * u[0] + cv * v[0] + c * a[0]; dy = cu * u[1] + cv * v[1] + c * a[1]; dz = cu * u[2] + cv * v[2] + c * a[2];
        continue;
      }
      ox += ts * dx; oy += ts * dy; oz += ts * dz;
      const mx = (ox - cx) / R, my = (oy - cy) / R, mz = (oz - cz) / R, ci = Math.min(1, Math.max(0, dx * mx + dy * my + dz * mz));
      const s2 = n * n * (1 - ci * ci);
      let refl = s2 >= 1;
      if (!refl) {                                                              // Fresnel (unpolarised): reflect that share of the rays
        const ct = Math.sqrt(1 - s2), rs = (n * ci - ct) / (n * ci + ct), rp = (n * ct - ci) / (n * ct + ci);
        refl = rnd() < (R0 > 0 ? 0.5 * (rs * rs + rp * rp) : 0);
        if (!refl) {
          const f = ct - n * ci; dx = n * dx + f * mx; dy = n * dy + f * my; dz = n * dz + f * mz;
          const L = Math.hypot(dx, dy, dz); d[0] = dx / L; d[1] = dy / L; d[2] = dz / L; o[0] = ox; o[1] = oy; o[2] = oz;
          return;
        }
      }
      dx -= 2 * ci * mx; dy -= 2 * ci * my; dz -= 2 * ci * mz;                 // TIR or Fresnel reflection: back inside
    }
    const L = Math.hypot(ox - cx, oy - cy, oz - cz) || 1;                      // (never in practice) leave along the normal
    d[0] = (ox - cx) / L; d[1] = (oy - cy) / L; d[2] = (oz - cz) / L; o[0] = ox; o[1] = oy; o[2] = oz;
  }
  /* The flat emitter that looks like the domed one from outside (paraxial, single spherical surface): the image of the
   * die through the dome is magnified m and sits at height zi above the die plane.  For the die at the centre (z = 0),
   * m = n and zi = 0.  Solvers plan with this; the trace uses the real dome.  Non-domed sources come back unchanged.   */
  function apparent(src) {
    if (!hasDome(src)) return src;
    const n = src.dome.n > 1 ? src.dome.n : 1.41, R = src.dome.r, z = src.dome.z || 0, so = R + z;   // object distance from the dome top
    const inv = (n - 1) / R - n / so, si = Math.abs(inv) > 1e-12 ? 1 / inv : -1e12, m = Math.abs(-n * si / so);
    const out = Object.assign({}, src); delete out.dome;
    if (src.shape === 'disc') out.radius = src.radius * m; else { out.w = src.w * m; out.h = src.h * m; }
    const fr = frame(src), zi = R + z + si;
    out.pos = [src.pos[0] + zi * fr.a[0], src.pos[1] + zi * fr.a[1], src.pos[2] + zi * fr.a[2]];
    out.domeMag = m;
    return out;
  }

  // Covariance (world 3×3, row-major) of the emitting points — used by the first-order tile model.
  function extentCov(src) {
    src = apparent(src);
    const fr = src.kind === 'arc' ? arcFrame(src) : frame(src), C = new Array(9).fill(0);
    const addOuter = (e, s) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] += s * e[i] * e[j]; };
    if (src.kind === 'arc') {
      const S = makeSampler(src), a = S.arc, t = S.arcTable, n = t.length - 1; let z2 = 0, b = 0, b2 = 0;
      for (let i = 0; i < n; i++) { const z = (t[i] + t[i + 1]) / 2, h = a.bow * (1 - (2 * z / src.length) ** 2); z2 += z * z / n; b += h / n; b2 += h * h / n; }
      const v = (a.fwhm / 2.354820045) ** 2 * (1 - 4.5 / Math.expm1(4.5));
      addOuter(fr.a, z2); addOuter(fr.u, v); addOuter(fr.v, v + b2 - b * b);
    } else if (src.kind === 'planar') {
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
    if (src.kind === 'arc') { const a = arcParams(src); return Math.max(Math.hypot(src.length / 2, a.bow + 3 * a.fwhm / 2.354820045), a.tube ? a.tubeLength / 2 + a.wall : 0, a.stripes ? a.stripeRadius : 0); }
    if (src.kind === 'planar') return Math.max(src.shape === 'disc' ? src.radius : Math.hypot(src.w, src.h) / 2, hasDome(src) ? src.dome.r + Math.max(0, src.dome.z || 0) : 0);
    if (src.kind === 'volume') return src.shape === 'cylinder' ? Math.hypot(src.radius, src.length / 2) : src.radius;
    return 0;
  }
  // Characteristic linear size of the emitter (for reports): max projected width
  function extentSize(src) {
    if (src.kind === 'arc') { const a = arcParams(src); return Math.max(src.length, a.fwhm + a.bow); }
    src = apparent(src);
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.max(src.w, src.h);
    if (src.kind === 'volume') return src.shape === 'cylinder' ? Math.max(2 * src.radius, src.length) : 2 * src.radius;
    return 0;
  }
  // Emitting area (planar) or projected cross-section (volume) — for the étendue estimate
  function emittingArea(src) {
    if (src.kind === 'arc') return arcParams(src).fwhm * src.length;
    src = apparent(src);
    if (src.kind === 'planar') return src.shape === 'disc' ? Math.PI * src.radius * src.radius : src.w * src.h;
    if (src.kind === 'volume') return src.shape === 'cylinder' ? 2 * src.radius * src.length : Math.PI * src.radius * src.radius;
    return 0;
  }

  // Drawing primitives in world space
  function outline(src) {
    const fr = src.kind === 'arc' ? arcFrame(src) : frame(src), p = src.pos, out = { kind: src.kind, shape: src.shape, pos: p, axis: fr.a, polys: [], circles: [] };
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const ring = (r, ca) => { const q = []; for (let i = 0; i < 24; i++) { const t = i / 24 * 2 * Math.PI; q.push(at(r * Math.cos(t), r * Math.sin(t), ca)); } return q; };
    if (src.kind === 'arc') {
      const a = arcParams(src), q = [];
      for (let i = 0; i <= 32; i++) { const z = (i / 32 - 0.5) * src.length; q.push(at(0, a.bow * (1 - (2 * z / src.length) ** 2), z)); }
      out.polys.push(q.map((p) => V.add(p, V.mul(fr.v, a.fwhm / 2))).concat(q.slice().reverse().map((p) => V.add(p, V.mul(fr.v, -a.fwhm / 2)))));
      for (const z of [-src.length / 2, 0, src.length / 2]) out.polys.push(ring(a.fwhm / 2, z).map((p) => V.add(p, V.mul(fr.v, a.bow * (1 - (2 * z / src.length) ** 2)))));
      if (a.tube) for (const z of [-0.75, 0, 0.75]) out.polys.push(ring((a.tubeRadius + a.wall) * Math.sqrt(1 - z * z), z * (a.tubeLength / 2 + a.wall)));
    } else if (src.kind === 'planar') {
      if (src.shape === 'disc') out.polys.push(ring(src.radius, 0));
      else out.polys.push([at(-src.w / 2, -src.h / 2, 0), at(src.w / 2, -src.h / 2, 0), at(src.w / 2, src.h / 2, 0), at(-src.w / 2, src.h / 2, 0)]);
      if (hasDome(src)) {                                // the dome: its base circle and two latitude rings
        const R = src.dome.r, z = src.dome.z || 0;
        for (const f of [0, 0.5, 0.85]) { const h = f * (R + z), rr = Math.sqrt(Math.max(0, R * R - (h - z) ** 2)); if (rr > 1e-6) out.polys.push(ring(rr, h)); }
      }
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

  /* Multi-emitter scenes.  scene.source is the first emitter (every existing control edits it); scene.emitters lists
   * more, each a full source object (+ id, enabled).  The trace draws each ray's emitter by power (one extra uniform,
   * drawn only when there is more than one, so single-emitter runs are byte-identical to before), so every ray still
   * carries the same energy: total power ÷ rays.                                                                     */
  function all(scene) {
    const out = [scene.source];
    for (const e of scene.emitters || []) if (e && e.enabled !== false && e.power > 0) out.push(e);
    return out;
  }
  const totalPower = (scene) => all(scene).reduce((a, s) => a + (s.power || 0), 0);
  function makeMixture(list) {
    if (list.length === 1) return makeSampler(list[0]);
    const parts = list.map(makeSampler), cdf = new Float64Array(list.length + 1);
    for (let i = 0; i < list.length; i++) cdf[i + 1] = cdf[i] + Math.max(0, list[i].power || 0);
    for (let i = 0; i <= list.length; i++) cdf[i] /= cdf[list.length] || 1;
    return { mix: true, parts, cdf, src: list[0], pos: list[0].pos.slice(), fr: parts[0].fr };
  }
  function pickPart(M, x) { const c = M.cdf; let k = 0; while (k < M.parts.length - 1 && c[k + 1] <= x) k++; return M.parts[k]; }

  RF.Source = { ARC_DEFAULTS, arcParams, arcFrame, all, totalPower, makeMixture, pickPart, frame, thetaMax, intensity, totalIntegral, makeSampler, sampleRay, extentCov, boundingRadius, extentSize, emittingArea, outline, apparent, hasDome };
})(typeof globalThis !== 'undefined' ? globalThis : this);
