/* Projector module v3 — a lens + shield + faceted-ellipsoid projector headlamp designed from a beam SPECIFICATION (Flux solver lab, 2026-10-07).
 * Generated from tools/projector-v3/dev/*.js (node tools/projector-v3/build.js); notes and benchmarks: tools/projector-v3/NOTES.md.
 * Reuses SQM's ideal-beam module (target.js, plan.js) and forward model (fwd.js, extended with a post-reflection optic: shield + lens).              */

(function (globalThis) {
// ============================================================ lens
/* lens.js — a rotationally symmetric two-surface lens (z along the optical axis, the glass between surface 0 and surface 1).
 *   kind 'curve-in' : conic entry (toward the source), flat exit      (projector-v1/v2: exact on axis, k = −n²)
 *   kind 'flat-in'  : flat entry (toward the source), convex conic exit (the production projector lens: flat side to the reflector)
 *   kind 'bi'       : two conic faces
 * A surface is { zv, R, k }: r² + (1+k)(z−zv)² − 2R(z−zv) = 0, R = Infinity is the plane z = zv.  R > 0 bows toward +z, R < 0 toward −z.
 *
 *   RF.P3.makeLens(n, f, a, kind, k, beta)  → lens with its paraxial EFL = f (bisection on the traced EFL), BFD, a meridional field map
 *   RF.P3.mapAt(L, th)                       → where the focus of a bundle from field angle th (deg) lies: { dz, rho }
 *   RF.P3.traceLens(L, p, d)                 → exit ray of a 3D ray in LENS coordinates (z axial) or null
 *   RF.P3.lensSurfaces(L, O, optics, id)     → the engine's `rev` surfaces for the lens at origin O (axis +x) */
(function () {
  'use strict';
  const RF = globalThis.RF, D2R = Math.PI / 180;
  const P3 = RF.P3 = RF.P3 || {};

  // ---------------------------------------------------------------- 2D (meridional) trace — used by the field map
  function hitConic(s, z0, r0, dz, dr) {
    if (!isFinite(s.R)) { if (Math.abs(dz) < 1e-12) return null; const t = (s.zv - z0) / dz; return t > 1e-9 ? { t, nz: 1, nr: 0 } : null; }
    const k1 = 1 + s.k, w0 = z0 - s.zv;
    const A = dr * dr + k1 * dz * dz, B = 2 * (r0 * dr + k1 * w0 * dz - s.R * dz), C = r0 * r0 + k1 * w0 * w0 - 2 * s.R * w0;
    let ts = [];
    if (Math.abs(A) < 1e-14) ts = [-C / B]; else { const D = B * B - 4 * A * C; if (D < 0) return null; const q = Math.sqrt(D); ts = [(-B - q) / (2 * A), (-B + q) / (2 * A)]; }
    ts = ts.filter((t) => t > 1e-9).sort((a, b) => a - b);
    for (const t of ts) {
      const w = w0 + t * dz, r = r0 + t * dr;
      if (k1 > 0 && Math.abs(w) > Math.abs(s.R) * 0.999 / Math.max(0.05, Math.abs(k1))) continue;
      if (k1 < 0 && w * Math.sign(s.R) < -1e-9) continue;                 // the other sheet of a hyperboloid
      const nz = 2 * k1 * w - 2 * s.R, nr = 2 * r, L = Math.hypot(nz, nr);
      return { t, nz: nz / L, nr: nr / L, r };
    }
    return null;
  }
  function refr(dz, dr, nz, nr, n1, n2) {
    let c = -(dz * nz + dr * nr); if (c < 0) { nz = -nz; nr = -nr; c = -c; }
    const eta = n1 / n2, k = 1 - eta * eta * (1 - c * c); if (k < 0) return null;
    const m = eta * c - Math.sqrt(k); return [eta * dz + m * nz, eta * dr + m * nr];
  }
  // a reversed fan leaves the lens toward +z at field angle th (rad); reversed, it travels −z through the exit, then the entry face
  function fanFocus(L, th, a, nRays) {
    const lines = [], dz0 = -Math.cos(th), dr0 = -Math.sin(th), zs = L.s[1].zv + 5;
    for (let i = 0; i < nRays; i++) {
      const h = (-0.9 + 1.8 * (i + 0.5) / nRays) * a;
      let z = zs, r = h, dz = dz0, dr = dr0;
      const h1 = hitConic(L.s[1], z, r, dz, dr); if (!h1) continue;
      z += h1.t * dz; r += h1.t * dr; if (Math.abs(r) > a) continue;
      let d = refr(dz, dr, h1.nz, h1.nr, 1, L.n); if (!d) continue; [dz, dr] = d;
      const h0 = hitConic(L.s[0], z, r, dz, dr); if (!h0) continue;
      z += h0.t * dz; r += h0.t * dr; if (Math.abs(r) > a) continue;
      d = refr(dz, dr, h0.nz, h0.nr, L.n, 1); if (!d) continue; [dz, dr] = d;
      lines.push([z, r, dz, dr]);
    }
    if (lines.length < 3) return null;
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const [z, r, dz, dr] of lines) { const nz = -dr, nr = dz, c = nz * z + nr * r; a11 += nz * nz; a12 += nz * nr; a22 += nr * nr; b1 += nz * c; b2 += nr * c; }
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-12) return null;
    const zf = (b1 * a22 - b2 * a12) / det, rf = (a11 * b2 - a12 * b1) / det;
    let e2 = 0; for (const [z, r, dz, dr] of lines) { const dd = -dr * (zf - z) + dz * (rf - r); e2 += dd * dd; }
    let tanAcc = 0; for (const [, , dz, dr] of lines) tanAcc = Math.max(tanAcc, Math.abs(dr / dz));
    return { z: zf, r: rf, rms: Math.sqrt(e2 / lines.length), n: lines.length, tanAcc };
  }

  // ---------------------------------------------------------------- the lens
  function makeLens(n, f, a, kind, k, beta, edge) {
    const eT = edge > 0 ? edge : Math.max(1, 0.06 * a);
    const build = (R1) => {
      let s0, s1, t;
      if (kind === 'flat-in') {                                           // flat entry, convex exit (R < 0: the face bows toward +z)
        const sag1 = RF.Geo.conicSag(-R1, k, a); if (!isFinite(sag1)) return null;
        t = Math.max(-sag1, 0) + eT; s0 = { zv: 0, R: Infinity, k: 0 }; s1 = { zv: t, R: -R1, k };
        return { n, kind, s: [s0, s1], t, sag0: 0, sag1, a, k, beta: 0 };
      }
      const sag0 = RF.Geo.conicSag(R1, k, a); if (!isFinite(sag0)) return null;
      s0 = { zv: 0, R: R1, k };
      if (kind === 'bi') {
        const R2 = -R1 / beta, k2 = k > -1 ? k : -1, sag1 = RF.Geo.conicSag(R2, k2, a); if (!isFinite(sag1)) return null;
        t = Math.max(sag0 - sag1, 0) + eT; s1 = { zv: t, R: R2, k: k2 };
        return { n, kind, s: [s0, s1], t, sag0, sag1, a, k, beta };
      }
      t = sag0 + eT; s1 = { zv: t, R: Infinity, k: 0 };
      return { n, kind: 'curve-in', s: [s0, s1], t, sag0, sag1: 0, a, k, beta: 0 };
    };
    const para = (L) => {                                                  // paraxial EFL and BFD (from the entry vertex) by a traced reversed ray
      const h = 0.05 * a; let z = L.s[1].zv + 5, r = h, dz = -1, dr = 0;
      const h1 = hitConic(L.s[1], z, r, dz, dr); if (!h1) return null; z += h1.t * dz; r += h1.t * dr;
      let d = refr(dz, dr, h1.nz, h1.nr, 1, n); if (!d) return null; [dz, dr] = d;
      const h0 = hitConic(L.s[0], z, r, dz, dr); if (!h0) return null; z += h0.t * dz; r += h0.t * dr;
      d = refr(dz, dr, h0.nz, h0.nr, n, 1); if (!d) return null; [dz, dr] = d;
      if (dr >= 0) return null;
      const tz = -r / dr; return { efl: h / (-dr / -dz), bfd: -(z + tz * dz) };
    };
    const bb = kind === 'bi' ? 1 + beta : 1;
    let lo = 0.2 * (n - 1) * f, hi = 3 * (n - 1) * f * bb, best = null;
    for (let it = 0; it < 40; it++) {
      const R1 = (lo + hi) / 2, L = build(R1); if (!L) { lo = R1; continue; }
      const p = para(L); if (!p) { lo = R1; continue; }
      best = Object.assign(L, p);
      if (p.efl > f) hi = R1; else lo = R1;
    }
    if (!best || !(best.bfd > 0.3 * f)) return null;
    const map = [];
    for (let i = 0; i <= 12; i++) {
      const th = i * 2.5 * D2R, ff = fanFocus(best, th, a, 15);
      if (!ff) { map.push(null); continue; }
      map.push({ th, dz: ff.z + best.bfd, rho: -ff.r, blur: ff.rms / f / D2R, pass: ff.n / 15 });
    }
    best.map = map; best.f = f; best.R1 = best.s[kind === 'flat-in' ? 1 : 0].R * (kind === 'flat-in' ? -1 : 1);
    best.tanAcc = map[0] ? fanFocus(best, 0, a, 41).tanAcc : a / f;
    return best;
  }
  // the focus of a bundle at field angle thDeg: axial offset dz from the paraxial focus, lateral rho (> 0 = image on the opposite side)
  function mapAt(L, thDeg) {
    const x = Math.min(29.99, Math.max(0, thDeg)) / 2.5, i = Math.floor(x), u = x - i;
    const A = L.map[i], B = L.map[Math.min(12, i + 1)];
    const fb = (m, t) => m || { dz: 0, rho: L.f * Math.tan(t * D2R), blur: 8, pass: 0 };
    const a = fb(A, i * 2.5), b = fb(B, (i + 1) * 2.5);
    return { dz: a.dz + (b.dz - a.dz) * u, rho: a.rho + (b.rho - a.rho) * u, blur: a.blur + (b.blur - a.blur) * u, pass: a.pass + (b.pass - a.pass) * u };
  }

  // ---------------------------------------------------------------- 3D trace (lens coordinates: z along the axis, (u, v) lateral)
  function hit3(s, pz, pu, pv, dz, du, dv) {
    if (!isFinite(s.R)) { if (Math.abs(dz) < 1e-12) return null; const t = (s.zv - pz) / dz; return t > 1e-9 ? { t, nz: 1, nu: 0, nv: 0, r: Math.hypot(pu + t * du, pv + t * dv) } : null; }
    const k1 = 1 + s.k, w0 = pz - s.zv;
    const A = du * du + dv * dv + k1 * dz * dz, B = 2 * (pu * du + pv * dv + k1 * w0 * dz - s.R * dz), C = pu * pu + pv * pv + k1 * w0 * w0 - 2 * s.R * w0;
    let ts;
    if (Math.abs(A) < 1e-14) ts = [-C / B]; else { const D = B * B - 4 * A * C; if (D < 0) return null; const q = Math.sqrt(D); ts = [(-B - q) / (2 * A), (-B + q) / (2 * A)]; }
    ts = ts.filter((t) => t > 1e-9).sort((x, y) => x - y);
    for (const t of ts) {
      const w = w0 + t * dz, u = pu + t * du, v = pv + t * dv;
      if (k1 > 0 && Math.abs(w) > Math.abs(s.R) * 0.999 / Math.max(0.05, Math.abs(k1))) continue;
      if (k1 < 0 && w * Math.sign(s.R) < -1e-9) continue;
      const nz = 2 * k1 * w - 2 * s.R, nu = 2 * u, nv = 2 * v, L = Math.hypot(nz, nu, nv);
      return { t, nz: nz / L, nu: nu / L, nv: nv / L, r: Math.hypot(u, v) };
    }
    return null;
  }
  function refr3(dz, du, dv, nz, nu, nv, n1, n2) {
    let c = -(dz * nz + du * nu + dv * nv); if (c < 0) { nz = -nz; nu = -nu; nv = -nv; c = -c; }
    const eta = n1 / n2, k = 1 - eta * eta * (1 - c * c); if (k < 0) return null;
    const m = eta * c - Math.sqrt(k); return [eta * dz + m * nz, eta * du + m * nu, eta * dv + m * nv];
  }
  // p = [z, u, v], d = [dz, du, dv] (unit).  Returns { p, d } at the exit face or null (miss, TIR, outside the aperture).
  function traceLens(L, p, d) {
    const a = L.a;
    let h = hit3(L.s[0], p[0], p[1], p[2], d[0], d[1], d[2]); if (!h || h.r > a) return null;
    let z = p[0] + h.t * d[0], u = p[1] + h.t * d[1], v = p[2] + h.t * d[2];
    let o = refr3(d[0], d[1], d[2], h.nz, h.nu, h.nv, 1, L.n); if (!o) return null;
    h = hit3(L.s[1], z, u, v, o[0], o[1], o[2]); if (!h || h.r > a) return null;
    z += h.t * o[0]; u += h.t * o[1]; v += h.t * o[2];
    const q = refr3(o[0], o[1], o[2], h.nz, h.nu, h.nv, L.n, 1); if (!q) return null;
    return { p: [z, u, v], d: q };
  }

  // ---------------------------------------------------------------- engine surfaces (axis +x through O = the entry vertex)
  function lensSurfaces(L, O, optics, id) {
    const W = [1, 0, 0], ref = [0, 0, 1], a = L.a, ABS = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true }, out = [];
    const rev = (name, seg, front, op) => out.push({ type: 'rev', id: id + name, O, W, ref, seg, front, optics: op });
    if (L.kind === 'flat-in') {
      rev('_in', { kind: 'line', z0: 0, r0: 0, z1: 0, r1: a }, -1, optics);                          // flat face toward the source
      rev('_edge', { kind: 'line', z0: 0, r0: a, z1: L.t + L.sag1, r1: a }, 1, ABS);
      rev('_out', { kind: 'conic', zv: L.s[1].zv, R: L.s[1].R, k: L.s[1].k, r0: 0, r1: a }, 1, optics);
    } else {
      rev('_in', { kind: 'conic', zv: 0, R: L.s[0].R, k: L.s[0].k, r0: 0, r1: a }, 1, optics);
      rev('_edge', { kind: 'line', z0: L.sag0, r0: a, z1: isFinite(L.s[1].R) ? L.t + L.sag1 : L.t, r1: a }, 1, ABS);
      if (isFinite(L.s[1].R)) rev('_out', { kind: 'conic', zv: L.s[1].zv, R: L.s[1].R, k: L.s[1].k, r0: 0, r1: a }, 1, optics);
      else rev('_out', { kind: 'line', z0: L.t, r0: 0, z1: L.t, r1: a }, 1, optics);
    }
    return out;
  }
  P3.makeLens = makeLens; P3.mapAt = mapAt; P3.traceLens = traceLens; P3.lensSurfaces = lensSurfaces; P3.hit3 = hit3; P3.refr3 = refr3;
})();

// ============================================================ geom
/* geom.js — small geometry helpers: envelope bounds + inside test, 2D convex hull, Fibonacci sphere, gnomonic polygon clipping. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {};
  function envBounds(env) {
    const c = env.center, h = env.half, B = { xmax: c[0] + h[0], xmin: c[0] - h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2] };
    if (env.shape === 'box') B.inside = (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && Math.abs(p[1] - c[1]) <= h[1] - m && Math.abs(p[2] - c[2]) <= h[2] - m;
    else if (env.shape === 'cylinder' && (env.axis | 0) === 0) B.inside = (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && ((p[1] - c[1]) / (h[1] - m)) ** 2 + ((p[2] - c[2]) / (h[2] - m)) ** 2 <= 1;
    else { const hm = Math.max(...h); B.inside = (p, m) => RF.Geo.envInside(env, p, -m / hm); }
    return B;
  }
  // the points of a unit-sphere Fibonacci lattice, flat [x, y, z, …]
  function fibSphere(n) {
    const out = new Float64Array(3 * n), ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) { const z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * i; out[3 * i] = r * Math.cos(t); out[3 * i + 1] = r * Math.sin(t); out[3 * i + 2] = z; }
    return out;
  }
  // convex hull (Andrew) of 2D points → indices, counter-clockwise
  function hull2(p2) {
    const idx = p2.map((_, i) => i).sort((s, t) => p2[s][0] - p2[t][0] || p2[s][1] - p2[t][1]);
    const cr = (o, s, t) => (p2[s][0] - p2[o][0]) * (p2[t][1] - p2[o][1]) - (p2[s][1] - p2[o][1]) * (p2[t][0] - p2[o][0]), lo = [], hi = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  // clip a convex polygon (array of [x, y]) to the half-plane a·x + b·y + c ≥ 0
  function clipHalf(poly, a, b, c) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], sp = a * p[0] + b * p[1] + c, sq = a * q[0] + b * q[1] + c;
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out;
  }
  const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  P3.envBounds = envBounds; P3.fibSphere = fibSphere; P3.hull2 = hull2; P3.clipHalf = clipHalf; P3.area2 = area2;
})();

// ============================================================ fwd
/* fwd.js — (copied from tools/sqm-hl/dev/fwd.js, then extended) forward model: the far field a set of facets paints, from exact geometry (no ray tracer).
 * EXTENSION (projector-v3): opt.post(X, o) continues each reflected ray through the rest of the optic (shield, lens): it returns { p, d, T } or null (absorbed).
 * The original header follows.
 *
 * For one facet: sample points X on its aperture (the clip polygon, on the real quadric, with its real normal) and points s on the
 * emitter; each pair (s, X) carries the flux  q_s · E_s(d) · cosθ_X · dA_X / |X − s|²  (q_s = the sample's share of the emitter,
 * E_s(d) = its radiant intensity toward d, normalised so the whole emitter gives Φ) times the mirror's reflectivity, and leaves along
 * the exact reflection.  That is what the ray tracer samples, so flux AND pattern come out of one computation.
 *
 *   RF.SqmFwd.sourceSamples(src, n)            → { n, pos[3n], q[n], nrm[3n] | null, kind }
 *   RF.SqmFwd.footprint(facet, src, samples, opt) → { flux (lm), E: Map/sparse bins } and moments
 *   RF.SqmFwd.field(facets, src, grid, opt)    → Float64Array E (lm per bin) + per-facet columns
 * Grid: { h0, v0, step, nh, nv, conv, distance (mm, Infinity = far field), centre }.                                         */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, D2R = Math.PI / 180;
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

  // ------------------------------------------------------------------ emitter samples
  // q: share of the emitter's flux each sample represents (sums to 1).  nrm: outward skin normals for an opaque (surface-emitting) body.
  function sourceSamples(src, n) {
    n = Math.max(1, n | 0);
    const fr = RF.Source.frame(src), p = src.pos, pos = [], q = [], nrm = [];
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const push = (x, w, nn) => { pos.push(x[0], x[1], x[2]); q.push(w); if (nn) nrm.push(nn[0], nn[1], nn[2]); };
    let kind = 'dist';
    if (src.kind === 'point') push(p, 1);
    else if (src.kind === 'planar') {
      if (src.shape === 'disc') { for (let i = 1; i <= n; i++) { const r = src.radius * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3); push(at(r * Math.cos(t), r * Math.sin(t), 0), 1); } }
      else { const m = Math.max(1, Math.round(Math.sqrt(n * (src.w || 1) / (src.h || 1)))), k = Math.max(1, Math.round(n / m)); for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) push(at(((i + 0.5) / m - 0.5) * src.w, ((j + 0.5) / k - 0.5) * src.h, 0), 1); }
    } else if (RF.Source.frame && src.emission === 'surface') {           // an opaque Lambertian skin (a filament coil)
      kind = 'skin';
      if (src.shape === 'cylinder') {
        const R = src.radius, L = src.length, aSide = 2 * Math.PI * R * L, aCap = Math.PI * R * R, aTot = aSide + 2 * aCap, nSide = Math.max(1, Math.round(n * aSide / aTot));
        const nA = Math.max(1, Math.round(Math.sqrt(nSide * 2 * Math.PI * R / L))), nH = Math.max(1, Math.round(nSide / nA));
        for (let i = 0; i < nA; i++) for (let j = 0; j < nH; j++) { const a = (i + 0.5) / nA * 2 * Math.PI, h = ((j + 0.5) / nH - 0.5) * L, nr = V.add(V.mul(fr.u, Math.cos(a)), V.mul(fr.v, Math.sin(a))); push(V.add(at(0, 0, h), V.mul(nr, R)), aSide / aTot / (nA * nH), nr); }
        const nC = Math.max(1, Math.round(n * aCap / aTot / 4)) + 3;
        for (const sg of [1, -1]) for (let i = 1; i <= nC; i++) { const r = R * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3); push(at(r * Math.cos(t), r * Math.sin(t), sg * L / 2), aCap / aTot / nC, V.mul(fr.a, sg)); }
      } else {                                                           // sphere
        for (let i = 1; i <= n; i++) { const c = 1 - 2 * halton(i, 2), s = Math.sqrt(Math.max(0, 1 - c * c)), t = 2 * Math.PI * halton(i, 3), nr = V.add(V.mul(fr.a, c), V.add(V.mul(fr.u, s * Math.cos(t)), V.mul(fr.v, s * Math.sin(t)))); push(V.add(p, V.mul(nr, src.radius)), 1 / n, nr); }
      }
    } else if (src.shape === 'cylinder') { for (let i = 1; i <= n; i++) { const r = src.radius * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3), h = (halton(i, 5) - 0.5) * src.length; push(V.add(at(0, 0, h), V.add(V.mul(fr.u, r * Math.cos(t)), V.mul(fr.v, r * Math.sin(t)))), 1); } }
    else { for (let i = 1; i <= n; i++) { const c = 1 - 2 * halton(i, 2), s = Math.sqrt(Math.max(0, 1 - c * c)), t = 2 * Math.PI * halton(i, 3), r = src.radius * Math.cbrt(halton(i, 5)); push(V.add(p, V.add(V.mul(fr.a, r * c), V.add(V.mul(fr.u, r * s * Math.cos(t)), V.mul(fr.v, r * s * Math.sin(t))))), 1); } }
    const W = q.reduce((a, b) => a + b, 0), cnt = pos.length / 3;
    return { n: cnt, pos: Float64Array.from(pos), q: Float64Array.from(q.map((x) => x / W)), nrm: nrm.length ? Float64Array.from(nrm) : null, kind, src, itot: RF.Source.totalIntegral(src), fr };
  }
  // radiant intensity of sample b toward unit d, normalised so the whole emitter radiates src.power (lm per sr)
  function emitTo(S, b, dx, dy, dz) {
    const src = S.src;
    if (S.kind === 'skin') { const c = S.nrm[3 * b] * dx + S.nrm[3 * b + 1] * dy + S.nrm[3 * b + 2] * dz; return c > 0 ? src.power * c / Math.PI : 0; }
    const a = S.fr.a, ct = Math.max(-1, Math.min(1, a[0] * dx + a[1] * dy + a[2] * dz));
    return src.power * RF.Source.intensity(src, Math.acos(ct)) / S.itot;
  }

  // ------------------------------------------------------------------ one facet: aperture samples on the real quadric
  function quadricOf(f) { return !f.flat && Array.isArray(f.vg) ? RF.Geo.facetQuadric2(f.P, f.S0, f.Z, f.vg, f.ax) : RF.Geo.facetQuadric(f.P, f.S0, f.Z, f.flat ? null : f.di); }
  function apertureSamples(f, fq, na) {
    const clip = f.clip || { kind: 'disc', r: 1 }, { ex, ey } = RF.Solver.facetFrame(fq, clip.ref), P = f.P, pts = [];
    let poly = null;
    if (clip.kind === 'poly') poly = clip.pts3.map((q) => { const d = V.sub(q, P); return [V.dot(d, ex), V.dot(d, ey)]; });
    else if (clip.kind === 'rect') poly = [[-clip.hx, -clip.hy], [clip.hx, -clip.hy], [clip.hx, clip.hy], [-clip.hx, clip.hy]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    if (poly) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } else { x0 = -clip.r; x1 = clip.r; y0 = -clip.r; y1 = clip.r; }
    const inside = (x, y) => { if (!poly) return x * x + y * y <= clip.r * clip.r; let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c < 0) s |= 1; else if (c > 0) s |= 2; if (s === 3) return false; } return true; };
    let got = 0, i = 1, guard = 0; const out = [];
    while (got < na && guard++ < na * 40) { const x = x0 + (x1 - x0) * halton(i, 2), y = y0 + (y1 - y0) * halton(i, 3); i++; if (!inside(x, y)) continue; const sp = RF.Solver.surfPoint(fq, P, ex, ey, x, y); if (!sp) continue; out.push(sp.X[0], sp.X[1], sp.X[2], sp.n[0], sp.n[1], sp.n[2], (sp.n[0] * fq.n[0] + sp.n[1] * fq.n[1] + sp.n[2] * fq.n[2])); got++; }
    // area of the polygon in the tangent plane (mm²) for the flux weights
    let area = 0; if (poly) { for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2; } else area = Math.PI * clip.r * clip.r;
    return { pts: Float64Array.from(out), n: out.length / 7, area };
  }

  // ------------------------------------------------------------------ footprint of one facet on a far-field grid
  // returns { flux, idx: Int32Array, val: Float64Array (lm per bin, bilinear), hc, vc (flux centroid), cov [hh, hv, vv] in degrees² }
  function footprint(f, S, grid, opt) {
    opt = opt || {};
    const fq = quadricOf(f), refl = f.optics && f.optics.reflectivity !== undefined ? f.optics.reflectivity : 0.9;
    const A = apertureSamples(f, fq, opt.na || 48); if (opt.occ) opt.occ(f, A);
    const nh = grid.nh, nv = grid.nv, acc = new Map();
    const fin = isFinite(grid.distance), plane = fin ? grid.centre[0] + grid.distance : 0, c0 = grid.centre;
    let flux = 0, mh = 0, mv = 0, shh = 0, shv = 0, svv = 0;
    const wA = A.area / Math.max(1, A.n);
    for (let a = 0; a < A.n; a++) {
      const o = 7 * a, X0 = A.pts[o], X1 = A.pts[o + 1], X2 = A.pts[o + 2], n0 = A.pts[o + 3], n1 = A.pts[o + 4], n2 = A.pts[o + 5], tilt = A.pts[o + 6];
      if (tilt === 0) continue; const dA = wA / Math.max(0.2, tilt);
      for (let b = 0; b < S.n; b++) {
        const sx = S.pos[3 * b], sy = S.pos[3 * b + 1], sz = S.pos[3 * b + 2];
        let dx = X0 - sx, dy = X1 - sy, dz = X2 - sz; const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2); dx /= r; dy /= r; dz /= r;
        const cp = -(dx * n0 + dy * n1 + dz * n2); if (!(cp > 0)) continue;                    // must meet the reflecting face
        const E = emitTo(S, b, dx, dy, dz); if (!(E > 0)) continue;
        let w = S.q[b] * E * cp * dA / r2 * refl; if (!(w > 0)) continue;
        const k = 2 * (dx * n0 + dy * n1 + dz * n2); let ox = dx - k * n0, oy = dy - k * n1, oz = dz - k * n2, w1 = w, qx = X0, qy = X1, qz = X2;
        if (opt.post) { const q = opt.post(X0, X1, X2, ox, oy, oz, w); if (!q) continue; qx = q.p[0]; qy = q.p[1]; qz = q.p[2]; ox = q.d[0]; oy = q.d[1]; oz = q.d[2]; w1 = w * q.T; }
        let ux = ox, uy = oy, uz = oz;
        if (fin) { if (!(ox > 1e-9)) continue; const t = (plane - qx) / ox; ux = qx + t * ox - c0[0]; uy = qy + t * oy - c0[1]; uz = qz + t * oz - c0[2]; const L = Math.hypot(ux, uy, uz); ux /= L; uy /= L; uz /= L; }
        const hv = RF.FarField.hvOf([ux, uy, uz], grid.conv), gh = (hv[0] - grid.h0) / grid.step - 0.5, gv = (hv[1] - grid.v0) / grid.step - 0.5;
        const w0 = w; w = w1;
        flux += w; mh += w * hv[0]; mv += w * hv[1]; shh += w * hv[0] * hv[0]; shv += w * hv[0] * hv[1]; svv += w * hv[1] * hv[1];
        const i0 = Math.floor(gh), j0 = Math.floor(gv), fh = gh - i0, fv = gv - j0;
        for (let jj = 0; jj < 2; jj++) for (let ii = 0; ii < 2; ii++) { const i = i0 + ii, j = j0 + jj; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const key = j * nh + i, ww = w * (ii ? fh : 1 - fh) * (jj ? fv : 1 - fv); acc.set(key, (acc.get(key) || 0) + ww); }
      }
    }
    const idx = new Int32Array(acc.size), val = new Float64Array(acc.size); let q = 0; for (const [k, v] of acc) { idx[q] = k; val[q] = v; q++; }
    const hc = flux > 0 ? mh / flux : 0, vc = flux > 0 ? mv / flux : 0;
    return { flux, idx, val, hc, vc, cov: flux > 0 ? [shh / flux - hc * hc, shv / flux - hc * vc, svv / flux - vc * vc] : [0, 0, 0], samples: A.n * S.n };
  }

  // the field (lm per bin) of a list of facets, plus each facet's footprint
  // Occluder: which aperture samples of facet j has a NEARER facet in front of, along the ray from the source centre?  (sets the sample's tilt slot to 0 → no flux)
  function makeOccluder(facets, src) {
    const G = RF.Geo.compile(facets), Lp = src.pos, rad = facets.map((f) => { let r = 0; for (const q of f.clip.pts3) r = Math.max(r, V.dist(q, f.P)); return r + 0.6; });
    return (f, A) => {
      const j = facets.indexOf(f); if (j < 0) return; let blockedN = 0;
      for (let a = 0; a < A.n; a++) {
        const X = [A.pts[7 * a], A.pts[7 * a + 1], A.pts[7 * a + 2]], d = V.sub(X, Lp), L = V.len(d), u = [d[0] / L, d[1] / L, d[2] / L];
        for (let k = 0; k < facets.length; k++) {
          if (k === j) continue; const c = facets[k].P, w = V.sub(c, Lp), t0 = V.dot(w, u); if (t0 < 0 || t0 > L + rad[k]) continue;
          const dx = w[0] - t0 * u[0], dy = w[1] - t0 * u[1], dz = w[2] - t0 * u[2]; if (dx * dx + dy * dy + dz * dz > rad[k] * rad[k]) continue;
          const t = RF.Geo.intersect(G.D, G.poly, k, Lp[0], Lp[1], Lp[2], u[0], u[1], u[2], 1e-9, L - 1e-4); if (t >= 0 && t < L - 1e-4) { A.pts[7 * a + 6] = 0; blockedN++; break; }
        }
      }
      A.blocked = blockedN;
    };
  }
  function field(facets, S, grid, opt) {
    opt = Object.assign({}, opt); if (opt.occlude) opt.occ = makeOccluder(facets, S.src);
    const E = new Float64Array(grid.nh * grid.nv), fps = [];
    for (const f of facets) { const fp = footprint(f, S, grid, opt); fps.push(fp); for (let q = 0; q < fp.idx.length; q++) E[fp.idx[q]] += fp.val[q]; }
    return { E, fps };
  }
  // intensity (cd) at (h, v) from a field, box kernel k (degrees), like the judge's: E_sum / Ω_sum over the bins the box covers
  function gridOf(win, step, conv, distance, centre) {
    const nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step);
    const g = { h0: win[0], v0: win[2], step, nh, nv, conv: conv || 'A', distance: distance > 0 ? distance : Infinity, centre: centre.slice() };
    g.om = new Float64Array(nh * nv); for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) g.om[j * nh + i] = RF.FarField.binOmega(g.h0 + i * step, g.h0 + (i + 1) * step, g.v0 + j * step, g.v0 + (j + 1) * step, g.conv);
    return g;
  }
  RF.P3 = RF.P3 || {}; RF.P3.fwd = { makeOccluder, sourceSamples, emitTo, quadricOf, apertureSamples, footprint, field, gridOf, halton };
})();

// ============================================================ optic
/* optic.js — what a ray meets after its reflection: the shield (an absorbing sheet near the focus) and the lens, as ONE function for the forward model.
 *   RF.P3.makePost(D) → (x, y, z, dx, dy, dz) => { p: [x, y, z], d: [dx, dy, dz], T } | null (absorbed)
 * D = { lens: { L, O: [x, y, z] (entry vertex; axis +x), T (transmission of both faces) } | null,
 *       shield: { xc, cy, yF, edge: [[y, z], …] (ascending y; the sheet covers z ≤ edge), zb (bottom), W (half width) } | null }.
 * Shield sheet: x = xc + ½ cy (y − yF)².  A ray that crosses it inside the covered region is absorbed.
 * Lens: a ray whose path never comes within the aperture radius of the lens axis between its front vertex and its exit plane passes by (stray light, unchanged);
 *   one that does is traced through both faces exactly; a miss of the faces or a TIR there is absorbed (the engine's ground edge / lost ray). */
(function () {
  'use strict';
  const RF = globalThis.RF, P3 = RF.P3 = RF.P3 || {};
  function edgeZ(edge, y) {
    const n = edge.length; if (y <= edge[0][0]) return edge[0][1]; if (y >= edge[n - 1][0]) return edge[n - 1][1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (edge[m][0] <= y) lo = m; else hi = m; }
    const u = (y - edge[lo][0]) / Math.max(1e-12, edge[hi][0] - edge[lo][0]); return edge[lo][1] + u * (edge[hi][1] - edge[lo][1]);
  }
  function makePost(D) {
    const sh = D.shield, ln = D.lens;
    const shieldHit = (x, y, z, dx, dy, dz) => {
      // x + t dx = xc + ½ cy (y + t dy − yF)²
      const q = y - sh.yF; let ts;
      if (Math.abs(sh.cy) < 1e-9) { if (Math.abs(dx) < 1e-12) return false; ts = [(sh.xc - x) / dx]; }
      else { const A = 0.5 * sh.cy * dy * dy, B = sh.cy * q * dy - dx, C = 0.5 * sh.cy * q * q - (x - sh.xc);
        if (Math.abs(A) < 1e-14) ts = [-C / B]; else { const Dd = B * B - 4 * A * C; if (Dd < 0) return false; const s = Math.sqrt(Dd); ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)]; } }
      for (const t of ts) {
        if (!(t > 1e-9)) continue; const yy = y + t * dy, zz = z + t * dz; if (Math.abs(yy - sh.yF) > sh.W) continue;
        if (zz <= edgeZ(sh.edge, yy) && zz >= sh.zb) return true;
      }
      return false;
    };
    const st = D.stats || null, add = (k, w) => { if (st) st[k] = (st[k] || 0) + (w || 0); };
    return (x, y, z, dx, dy, dz, w) => {
      if (sh && shieldHit(x, y, z, dx, dy, dz)) { add('shield', w); return null; }
      if (!ln) return { p: [x, y, z], d: [dx, dy, dz], T: 1 };
      const L = ln.L, O = ln.O, pz = x - O[0], pu = y - O[1], pv = z - O[2], a = L.a, zin = Math.min(0, L.sag0), zout = L.t;
      // portion of the ray inside the lens slab z ∈ [zin, zout]; its closest approach to the axis there
      let t0 = 0, t1 = Infinity;
      if (Math.abs(dx) < 1e-12) { if (pz < zin || pz > zout) { add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; } }
      else { const ta = (zin - pz) / dx, tb = (zout - pz) / dx; t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.max(t0, Math.max(ta, tb)); if (t1 <= 0 || t0 > t1) { add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; } }
      // r² (t) = |(pu, pv) + t (dy, dz)|² on [t0, t1]
      const dd = dy * dy + dz * dz; let tm = dd > 1e-14 ? -(pu * dy + pv * dz) / dd : t0; tm = Math.max(t0, Math.min(t1, tm));
      const ru = pu + tm * dy, rv = pv + tm * dz; if (ru * ru + rv * rv >= a * a) { add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; }
      const r = P3.traceLens(L, [pz, pu, pv], [dx, dy, dz]); if (!r) { add('lensLost', w); return null; }
      add('through', w);
      return { p: [r.p[0] + O[0], r.p[1] + O[1], r.p[2] + O[2]], d: r.d, T: ln.T };
    };
  }
  P3.makePost = makePost; P3.edgeZ = edgeZ;
})();

// ============================================================ target
/* target.js — the IDEAL BEAM: a far-field intensity map T*(h, v) in cd that satisfies the spec with margin, has a cut-off edge of a
 * chosen sharpness, and puts the remaining light where a driver wants it (the road).  No optics here: the real judge (RF.Spec.evaluate)
 * is run on T* itself, on a noise-free grid, so "does the ideal beam pass?" is answered before any mirror exists.
 *
 *   RF.SqmTarget.grid(spec, step)                         → pixel grid (centres, solid angles)
 *   RF.SqmTarget.bands(spec, grid, margins)                → { lo, hi } per pixel (cd), margins applied
 *   RF.SqmTarget.design(P, grid, bands, params)            → { T, flux, ... }
 *   RF.SqmTarget.judge(grid, cdMap, md)                    → RF.Spec.evaluate on a noise-free field                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function grid(win, step, conv) {
    const nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), n = nh * nv;
    const g = { win, step, conv: conv || 'A', nh, nv, n, h0: win[0], v0: win[2], om: new Float64Array(n) };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) g.om[j * nh + i] = RF.FarField.binOmega(g.h0 + i * step, g.h0 + (i + 1) * step, g.v0 + j * step, g.v0 + (j + 1) * step, g.conv);
    g.hOf = (i) => g.h0 + (i + 0.5) * step; g.vOf = (j) => g.v0 + (j + 0.5) * step;
    g.iOf = (h) => Math.floor((h - g.h0) / step); g.jOf = (v) => Math.floor((v - g.v0) / step);
    return g;
  }
  const satOf = (a, nh, nv) => { const W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; };
  // a noise-free judge grid from lm per bin (the object RF.Spec.evaluate reads)
  function judgeGrid(g, E, o) {
    o = o || {}; const nh = g.nh, nv = g.nv, E2 = new Float64Array(nh * nv); let lm = 0; for (let q = 0; q < E.length; q++) lm += E[q];
    return { E, E2, Om: g.om, nh, nv, h0: g.h0, v0: g.v0, step: g.step, h1: g.h0 + nh * g.step, v1: g.v0 + nv * g.step, conv: g.conv, distance: o.distance > 0 ? o.distance : Infinity, centre: (o.centre || [0, 0, 0]).slice(),
      lmWindow: lm, lmExit: lm, rays: 1e9, coverage: 1, N: 1e9, streamed: true, eRay: 0, sat: { E: satOf(E, nh, nv), E2: satOf(E2, nh, nv), Om: satOf(g.om, nh, nv) } };
  }
  function mdOf(spec) {
    const a = spec.aim || {}, box = a.box ? Object.assign({}, a.box) : null;
    return { items: spec.items, traffic: 'RHT', conv: spec.conv, kernel: spec.kernel, step: spec.step || 0.1, aimMode: a.mode || 'design', aimLine: a.line, aimScan: a.scan, aimBox: box && spec.traffic === 'LHT' ? { left: box.right, right: box.left, up: box.up, down: box.down } : box, itemReaim: a.itemReaim || 0, aimTol: 0 };
  }
  function judge(g, cd, spec, o) {
    const E = new Float64Array(g.n); for (let q = 0; q < g.n; q++) E[q] = cd[q] * g.om[q];
    return RF.Spec.evaluate(judgeGrid(g, E, o), mdOf(spec));
  }

  // ---- the spec as per-pixel floors and ceilings (cd), with a margin on each (factor ≥ 1: floor × m, ceiling ÷ m)
  function bands(spec, g, mg) {
    mg = Object.assign({ lo: 1.25, hi: 1.25 }, mg || {});
    const lo = new Float64Array(g.n), hi = new Float64Array(g.n).fill(Infinity), wc = new Float64Array(g.n), k = spec.kernel > 0 ? spec.kernel : 0.15, items = spec.items;
    const rad = Math.max(k, g.step / 2) + 1e-9;
    const pxAt = (h, v) => { const out = [], i0 = g.iOf(h - rad), i1 = g.iOf(h + rad), j0 = g.jOf(v - rad), j1 = g.jOf(v + rad); for (let j = Math.max(0, j0); j <= Math.min(g.nv - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(g.nh - 1, i1); i++) out.push(j * g.nh + i); if (!out.length) { const i = g.iOf(h), j = g.jOf(v); if (i >= 0 && j >= 0 && i < g.nh && j < g.nv) out.push(j * g.nh + i); } return out; };
    const pxIn = (poly) => { let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const [h, v] of poly) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const out = []; for (let j = Math.max(0, g.jOf(v0)); j <= Math.min(g.nv - 1, g.jOf(v1)); j++) for (let i = Math.max(0, g.iOf(h0)); i <= Math.min(g.nh - 1, g.iOf(h1)); i++) if (RF.Spec.inPoly(poly, g.hOf(i), g.vOf(j))) out.push(j * g.nh + i); return out; };
    const refMin = (name) => { const it = items.find((x) => x.name === name && x.kind === 'point'); return it && it.min > 0 ? it.min : 0; };
    const wOf = (px) => Math.pow(Math.max(9, px.length) / 9, -0.75);              // a spec point (9 pixels) weighs 1; a zone of 4000 pixels 0.01 each: rows count about alike, not by area
    const setLo = (px, v) => { const w = wOf(px); for (const p of px) { if (v * mg.lo > lo[p]) lo[p] = v * mg.lo; if (w > wc[p]) wc[p] = w; } };
    const setHi = (px, v) => { const w = wOf(px); for (const p of px) { if (v / mg.hi < hi[p]) hi[p] = v / mg.hi; if (w > wc[p]) wc[p] = w; } };
    const rows = [];
    for (const it of items) {
      let px = null, mn = it.min || 0, mx = it.max || 0, per = 1;
      if (it.kind === 'point') px = pxAt(it.h, it.v);
      else if (it.kind === 'zone') px = pxIn(it.poly);
      else if (it.kind === 'sum') { for (const [h, v] of it.pts) { const p = pxAt(h, v); if (it.min > 0) setLo(p, it.min / it.pts.length); rows.push({ name: it.name, kind: 'sum-pt', px: p }); } continue; }
      else continue;
      if (it.maxRel) { const r = refMin(it.maxRel.ref); if (r > 0) mx = mx > 0 ? Math.min(mx, it.maxRel.factor * r) : it.maxRel.factor * r; }
      if (mn > 0) setLo(px, mn); if (mx > 0) setHi(px, mx);
      rows.push({ name: it.name, kind: it.kind, px, min: mn, max: mx });
    }
    return { lo, hi, wc, rows };
  }

  // ---- log-domain blur along v (and a little along h): a step in intensity becomes a smooth edge with ONE steepest point
  function logBlur(g, T, sv, sh) {
    const lg = new Float64Array(g.n); for (let q = 0; q < g.n; q++) lg[q] = Math.log(Math.max(T[q], 1e-3));
    const pass = (src, sigma, vert) => {
      if (!(sigma > 0)) return src; const r = Math.ceil(3 * sigma / g.step), w = []; let ws = 0; for (let d = -r; d <= r; d++) { const x = Math.exp(-0.5 * (d * g.step / sigma) ** 2); w.push(x); ws += x; }
      const out = new Float64Array(g.n);
      for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { let s = 0, ww = 0; for (let d = -r; d <= r; d++) { const ii = vert ? i : i + d, jj = vert ? j + d : j; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; s += w[d + r] * src[jj * g.nh + ii]; ww += w[d + r]; } out[j * g.nh + i] = s / ww; }
      return out;
    };
    const o = pass(pass(lg, sv, true), sh, false); const T2 = new Float64Array(g.n); for (let q = 0; q < g.n; q++) T2[q] = Math.exp(o[q]); return T2;
  }

  RF.SqmTarget = { grid, judgeGrid, judge, mdOf, bands, logBlur, satOf };
})();

// ======================================================================= design of T*
(function () {
  'use strict';
  const RF = globalThis.RF, T = RF.SqmTarget, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // road-driven plateau: the intensity (cd) that gives E(x, y) = E100 · (100 / x)^gamma on the road where each pixel's ray lands
  // (a vertical sensor 25 cm up facing the car, IIHS), within the road + a verge, out to the IIHS distances (100 m right edge, 60 m left edge).
  function roadPlateau(g, spec, R) {
    R = Object.assign({ mountH: 0.65, lane: 3.3, sensorZ: 0.25, E100: 1, gamma: 0.8, verge: 1.5, lamps: 2, nearM: 4, farR: 100, farL: 60 }, R || {});
    const out = new Float64Array(g.n), drop = R.mountH - R.sensorZ, sg = spec.traffic === 'LHT' ? -1 : 1, yR = -R.lane / 2, yL = 1.5 * R.lane;
    if (!(drop > 0)) return out;
    for (let j = 0; j < g.nv; j++) {
      const v = g.vOf(j); if (!(v < -0.05)) continue;
      const dist = drop / Math.tan(-v * D2R);
      for (let i = 0; i < g.nh; i++) {
        const h = sg * g.hOf(i), x = dist * Math.cos(h * D2R), y = -dist * Math.sin(h * D2R);
        if (x < R.nearM) continue;
        const o = y < yR ? yR - y : y > yL ? y - yL : 0, wy = Math.exp(-((o / R.verge) ** 2));
        const goal = R.farR + (R.farL - R.farR) * clamp((y - yR) / (yL - yR), 0, 1), wx = 1 / (1 + Math.exp((x - goal) / 8));
        const E = R.E100 * Math.pow(100 / x, R.gamma) * wy * wx, r = Math.hypot(x, y, drop);
        out[j * g.nh + i] = E * r * r / (x / r) / R.lamps;
      }
    }
    return out;
  }
  // a soft dilation of the floors that sit above the cut-off (the sign points): a dim glow, not isolated pixels
  function glowField(g, lo, hi, radius) {
    const out = new Float64Array(g.n), r = Math.ceil(radius / g.step);
    for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; if (!(lo[q] > 0) || g.vOf(j) < 0.2) continue;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; const d = Math.hypot(di, dj) * g.step, w = d <= radius * 0.5 ? 1 : Math.max(0, 1 - (d - radius * 0.5) / (radius * 0.5)); const p = jj * g.nh + ii; if (lo[q] * w > out[p]) out[p] = lo[q] * w; } }
    return out;
  }
  // the cut-off line of the spec: where the beam's top edge sits at each H (needs a cut-off scan in the spec): the aim rule's line on the oncoming
  // side (R112 0.57° D, FMVSS VOL 0.4° D), rising on the own side (ECE 15° up to +1°, US ≈ 1.4°/° up to +1°).
  // The plateau on the road side may rise above the 15° / US line: the spec reads the cut-off only on the oncoming side, and Zone III (max 625 cd) starts on the 45° diagonal from the elbow,
  // so up to `lift` above the line (kept 0.6° under that diagonal) the right side is free to carry the road.  A hot spot inside the plateau, not on its edge, is also the one the die images can fill.
  function cutOf(spec, o) {
    if (!spec.items.some((x) => x.kind === 'gradient')) return null;
    o = Object.assign({ slope: 1.0, lift: 0.42, leftLift: 0, leftFrom: 3.9, leftSpan: 1.5 }, o || {}); const line = spec.aim && spec.aim.line < 0 ? spec.aim.line : -0.57, own = spec.traffic === 'LHT' ? -1 : 1, us = /^fmvss/.test(spec.preset || ''), t15 = Math.tan(15 * D2R);
    return { line, own, us, top: (h) => { const x = own * h; if (x <= 0) { if (!(o.leftLift > 0)) return line; const t = Math.max(0, Math.min(1, (-x - o.leftFrom) / o.leftSpan)); return line + o.leftLift * t * t * (3 - 2 * t); } const classic = us ? Math.min(line + 1.4 * x, 1.0) : Math.min(line + x * t15, 1.0); return o.lift > 0 ? Math.max(classic, Math.min(line + o.slope * x, line + o.lift)) : classic; } };
  }
  const fluxOf = (g, Tf) => { let s = 0; for (let q = 0; q < g.n; q++) s += Tf[q] * g.om[q]; return s; };

  // a wide foreground wash: the sink for light the road term cannot use (below the spec's own zones, wide, smooth)
  function washShape(g, spec, o) {
    o = Object.assign({ sigH: 18, top: -4.2, ramp: 1.6, bottom: -14 }, o || {}); const out = new Float64Array(g.n);
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); let t = clamp((o.top - v) / o.ramp, 0, 1); t = t * t * (3 - 2 * t); if (v < o.bottom) t *= Math.max(0, 1 - (o.bottom - v) / 6); if (!(t > 0)) continue; for (let i = 0; i < g.nh; i++) out[j * g.nh + i] = t * Math.exp(-((g.hOf(i) / o.sigH) ** 2)); }
    return out;
  }
  /* Aim guard.  The stock cut-off finder (Spec aimOf → scanCut) reads the steepest log-step of a vertical scan in one column (H = -2.5° on the oncoming side), counting only steps whose
   * bright side holds ≥ 2 % of the column's maximum.  Light above the cut-off at that level is, for a traced (shot-noisy) far field, a field of spurious steps steeper than the real edge:
   * the whole pattern then gets read up to a degree off.  Keep the glow in the scan columns at rho × the column maximum (a floor of the spec still wins over the cap).  */
  function guardCols(P, cut) {
    const spec = P.spec, a = spec.aim || {}, gi = spec.items.find((x) => x.kind === 'gradient'), rho = P.guard > 0 ? P.guard : 0, g = P.g;
    if (!(rho > 0) || !cut || !gi || a.mode !== 'cutoff' || !isFinite(gi.h)) return null;
    const kh = gi.kh || 0.25, li = spec.items.find((x) => x.kind === 'linearity'), hs = [gi.h].concat(li && li.hs ? li.hs.filter((h) => Math.abs(h - gi.h) > 0.3) : []);
    const S = a.scan > 0 ? a.scan : 3, line = isFinite(a.line) && a.line < 0 ? a.line : cut.line, vmax = g.v0 + g.nv * g.step;
    return { rho, gap: 0.2, lift: P.guardLift > 0 ? P.guardLift : 0, cols: hs.map((hc) => ({ hc, i0: Math.max(0, g.iOf(hc - kh - 0.15)), i1: Math.min(g.nh - 1, g.iOf(hc + kh + 0.15)), j0: Math.max(0, g.jOf(Math.max(g.v0 + 0.2, line - S))), j1: Math.min(g.nv - 1, g.jOf(Math.min(vmax - 0.2, line + S))) })) };
  }
  // cap the glow above the cut-off in the guarded columns (Tf in place); → the caps used, for the pipeline's band
  function guardApply(P, B, Tf, cut, dTop, G) {
    if (!G) return null; const g = P.g, out = [];
    for (const c of G.cols) {
      let M = 0; for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (Tf[j * g.nh + i] > M) M = Tf[j * g.nh + i];
      const cap = G.rho * M, px = []; if (!(M > 0)) continue;
      // the cap starts where the edge's own tail has come down to 1.3 × the cap (a cap that cut into the tail would be a second, steeper edge)
      let vStart = cut.top(c.hc) - dTop + G.gap; { const jc = g.jOf(cut.top(c.hc) - dTop - 0.6); let jm = jc; for (let j = Math.max(c.j0, jc); j <= c.j1; j++) { let s = 0; for (let i = c.i0; i <= c.i1; i++) s += Tf[j * g.nh + i]; if (s / (c.i1 - c.i0 + 1) <= 1.3 * cap) { jm = j; break; } jm = j; } vStart = Math.max(g.vOf(jm), cut.top(c.hc) - dTop) + (G.lift || 0); }
      for (let j = c.j0; j <= c.j1; j++) { if (g.vOf(j) < vStart) continue; for (let i = c.i0; i <= c.i1; i++) { const q = j * g.nh + i, c2 = Math.max(cap, B.lo[q]); if (Tf[q] > c2) Tf[q] = c2; px.push(q); } }
      out.push({ hc: c.hc, M, cap, vStart, px });
    }
    return out;
  }
  /* One T* for given parameters.  plateau = alpha · road (zero above the cut-off line shifted down by dTop), max'ed with the wash (level W0) and the glow, clamped by
   * the floors/ceilings, a log-domain blur of width sv makes the edges, a final clamp keeps every pixel inside its band.                                         */
  function build(P, S, alpha, W0, sv, dTop) {
    const { g, B } = P, n = g.n, Th = new Float64Array(n), cut = S.cut, cap = P.peakCap > 0 ? P.peakCap : Infinity;
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; let s = alpha * S.road[q]; if (cut && v > cut.top(g.hOf(i)) - dTop) s = 0; s = Math.max(Math.min(s, cap), W0 * S.wash[q], S.glow[q]); Th[q] = clamp(s, B.lo[q], B.hi[q]); } }
    const Tb = T.logBlur(g, Th, sv, P.sh >= 0 ? P.sh : 0.1), Tf = new Float64Array(n);
    for (let q = 0; q < n; q++) { let x = Tb[q]; if (x < 1e-2) x = 0; Tf[q] = clamp(x, B.lo[q], B.hi[q]); }
    if (S.guard) guardApply(P, B, Tf, cut, dTop, S.guard);
    return Tf;
  }
  const hardFails = (ev) => ev.rows.filter((r) => r.verdict === 'fail').length;
  // the wash level that makes the post-blur flux equal the target (the road term is fixed by the peak cap)
  function washFor(P, S, alpha, sv, dTop, fluxTarget) {
    let lo = 0, hi = P.washCap > 0 ? P.washCap : 1e5; if (fluxOf(P.g, build(P, S, alpha, hi, sv, dTop)) < fluxTarget) return hi;     // even the cap cannot absorb it
    if (fluxOf(P.g, build(P, S, alpha, 0, sv, dTop)) >= fluxTarget) return 0;
    for (let it = 0; it < 14; it++) { const m = 0.5 * (lo + hi); (fluxOf(P.g, build(P, S, alpha, m, sv, dTop)) < fluxTarget ? (lo = m) : (hi = m)); }
    return 0.5 * (lo + hi);
  }
  /* design(P): P = { spec, g, B, fluxTarget (lm in the window), peakCap (cd), washCap (cd), gd (design G per 0.1°; the realised edge is softer, so aim a bit sharp), road, glowR }.
   * Searches the edge: for each shift dTop of the plateau below the line, the blur that gives gd; keeps the first that passes the real judge. */
  function design(P) {
    const { g, spec } = P, gd = P.gd || 0.34, road = roadPlateau(g, spec, P.road); let rmax = 0; for (const x of road) if (x > rmax) rmax = x;
    const S = { road, wash: washShape(g, spec, P.wash), glow: glowField(g, P.B.lo, P.B.hi, P.glowR || 3.0), cut: P.cut === undefined ? cutOf(spec) : P.cut }; S.guard = guardCols(P, S.cut);
    const alpha = P.peakCap > 0 ? P.peakCap / Math.max(1e-9, rmax) : (P.alpha || 1);
    const hasGrad = spec.items.some((x) => x.kind === 'gradient');
    const run = () => {
      const tries = []; let best = null;
      for (const dTop of (hasGrad ? (P.dTops || [0, 0.1, 0.2, 0.3, 0.45, 0.6]) : [0])) {
        let sv = P.sv > 0 ? P.sv : 0.3, Tf = null, W0 = 0, G = NaN;
        for (let it = 0; it < 4; it++) {
          W0 = P.fluxTarget > 0 ? washFor(P, S, alpha, sv, dTop, P.fluxTarget) : 0; Tf = build(P, S, alpha, W0, sv, dTop);
          if (!hasGrad) break;
          const ev = T.judge(g, Tf, spec), gr = ev.rows.find((r) => r.unit === 'log'); if (!gr || !(gr.value > 0)) break;
          G = gr.value; if (Math.abs(G - gd) < 0.02) break; sv = Math.min(1.5, sv * clamp(G / gd, 0.5, 2));          // bounded: a blur of several degrees is no edge at all
        }
        const ev = T.judge(g, Tf, spec), res = { dTop, sv, W0, G, T: Tf, fails: hardFails(ev), worst: Math.min(...ev.rows.map((r) => r.margin)), ev };
        tries.push(res); if (!best || res.fails < best.fails || (res.fails === best.fails && res.worst > best.worst + 0.02)) best = res;
        if (res.fails === 0 && res.worst > 0.04) { best = res; break; }
      }
      return { best, tries };
    };
    let { best, tries } = run(), guardDropped = false;
    // the guard's cap makes a cliff of its own; if the edge cannot be brought to the design sharpness with it in place (a spec whose floors sit above the cut-off), build the beam without it
    if (S.guard && hasGrad && isFinite(best.G) && best.G > 1.5 * gd) { S.guard = null; guardDropped = true; if (P.B.hi0) { P.B.hi.set(P.B.hi0); P.B.wc.set(P.B.wc0); } ({ best, tries } = run()); }       // the carried caps go too
    const flux = fluxOf(g, best.T), guard = S.guard ? guardApply(P, P.B, Float64Array.from(best.T), S.cut, best.dTop, S.guard) : null;
    return { guard, guardDropped, T: best.T, alpha, W0: best.W0, flux, leftover: Math.max(0, (P.fluxTarget || 0) - flux), edge: { sv: best.sv, dTop: best.dTop, G: best.G }, ev: best.ev, tries: tries.map((t) => ({ dTop: t.dTop, sv: +t.sv.toFixed(3), G: +t.G.toFixed(3), fails: t.fails, worst: +t.worst.toFixed(2) })), road, glow: S.glow, wash: S.wash };
  }
  T.washShape = washShape; T.guardCols = guardCols;
  T.roadPlateau = roadPlateau; T.glowField = glowField; T.cutOf = cutOf; T.design = design; T.fluxOf = fluxOf;
})();

// ============================================================ plan
/* plan.js — the aim layout: N aims (far-field directions) with a flux each, from the ideal beam T*.
 * v0: flux-weighted k-means (Lloyd) over super-pixels of T*, so every aim carries about the same flux and the density of aims follows the light. */
(function () {
  'use strict';
  const RF = globalThis.RF;
  function hil(x, y, order) { let d = 0; for (let s = 1 << (order - 1); s > 0; s >>= 1) { const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; } } return d; }
  // aggregate T* (cd per pixel on grid g) into super-pixels of `sp` degrees: each = { h, v (flux centroid), f (lm), om, area }
  function superpixels(g, T, sp) {
    const k = Math.max(1, Math.round(sp / g.step)), nx = Math.ceil(g.nh / k), ny = Math.ceil(g.nv / k), out = [];
    for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
      let f = 0, h = 0, v = 0, om = 0;
      for (let j = J * k; j < Math.min(g.nv, (J + 1) * k); j++) for (let i = I * k; i < Math.min(g.nh, (I + 1) * k); i++) { const q = j * g.nh + i, w = T[q] * g.om[q]; om += g.om[q]; if (w > 0) { f += w; h += w * g.hOf(i); v += w * g.vOf(j); } }
      if (f > 1e-9) out.push({ h: h / f, v: v / f, f, om, I, J });
    }
    return out;
  }
  function kmeans(sp, N, iters, bias) {
    bias = bias === undefined ? 1 : bias;                              // 1 = by flux (equal-flux cells); 0 = by area
    const n = sp.length; N = Math.min(N, n);
    const w = sp.map((s) => Math.pow(s.f, bias) * Math.pow(s.om, 1 - bias) * (s.b > 0 ? s.b : 1)), W = w.reduce((a, b) => a + b, 0);       // s.b: resolution boost (more cells where the beam has structure)
    const ord = sp.map((s, i) => i).sort((a, b) => hil(sp[a].I, sp[a].J, 10) - hil(sp[b].I, sp[b].J, 10) || a - b);
    let cs = [], acc = 0, nxt = W / N / 2; for (const i of ord) { acc += w[i]; if (acc >= nxt && cs.length < N) { cs.push({ h: sp[i].h, v: sp[i].v }); nxt += W / N; } }
    const own = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      const sh = new Float64Array(cs.length), sv = new Float64Array(cs.length), sw = new Float64Array(cs.length);
      for (let i = 0; i < n; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const d = (sp[i].h - cs[j].h) ** 2 + (sp[i].v - cs[j].v) ** 2; if (d < bd) { bd = d; bj = j; } } own[i] = bj; sh[bj] += sp[i].h * w[i]; sv[bj] += sp[i].v * w[i]; sw[bj] += w[i]; }
      cs = cs.map((c, j) => sw[j] > 0 ? { h: sh[j] / sw[j], v: sv[j] / sw[j] } : c);
    }
    const aims = cs.map((c) => ({ h: c.h, v: c.v, F: 0, area: 0, mh: 0, mv: 0, shh: 0, shv: 0, svv: 0 }));
    for (let i = 0; i < n; i++) { const a = aims[own[i]], f = sp[i].f; a.F += f; a.area += sp[i].om; a.mh += f * sp[i].h; a.mv += f * sp[i].v; a.shh += f * sp[i].h * sp[i].h; a.shv += f * sp[i].h * sp[i].v; a.svv += f * sp[i].v * sp[i].v; }
    for (const a of aims) { if (a.F > 0) { const mh = a.mh / a.F, mv = a.mv / a.F; a.cov = [a.shh / a.F - mh * mh, a.shv / a.F - mh * mv, a.svv / a.F - mv * mv]; } else a.cov = [0, 0, 0]; }
    return aims.filter((a) => a.F > 0);
  }
  // two tiers: the main beam (flux-weighted cells) and the dim regions (area-weighted cells: a few big, wide tiles for the glow)
  function twoTier(sp, N, o) {
    o = Object.assign({ dimCut: 0.04, dimTile: 10, dimFrac: 0.2, iters: 20, reserve: 0 }, o || {});
    let pk = 0; for (const s of sp) { const cd = s.f / s.om; if (cd > pk) pk = cd; }
    const dim = [], main = []; for (const s of sp) (s.f / s.om < Math.max(o.dimAbs || 0, o.dimCut * pk) ? dim : main).push(s);
    if (o.boost && o.boost.gain > 1) for (const s of main) s.b = s.v >= o.boost.vAbove ? o.boost.gain : 1;                // the foreground wash is smooth: few big cells there, the freed facets go to the road, the hot zone and the edge
    let dimArea = 0; for (const s of dim) dimArea += s.om / (Math.PI / 180) ** 2;
    const nDim = dim.length ? Math.max(1, Math.min(Math.round(N * o.dimFrac) - o.reserve, Math.round(dimArea / o.dimTile))) : 0;
    const aD = nDim > 0 ? kmeans(dim, nDim, o.iters, 0) : [], aM = kmeans(main, Math.max(1, N - aD.length - o.reserve), o.iters, 1);
    return { main: aM, dim: aD, peak: pk };
  }
  RF.SqmPlan = { superpixels, kmeans, twoTier };
})();

// ============================================================ problem
/* problem.js — the solve's world: the spec as pixel bands, the ideal-beam grid, the source's samples and intensity, the model's grid.  Spec mode only so far. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, F = P3.fwd;
  const DEFAULTS = { step: 0.05, margin: 1.2, floorMargin: 1.2, gd: 0.34, peakCap: 300000, washCap: 12000, fluxFrac: 0.85, nSrc: 128, nDirs: 4000 };
  function problem(input, S, tools) {
    const src = input.source, env = input.envelope, spec = input.spec;
    if (!spec) throw new Error('projector-v3 needs Spec mode (paint mode is not built yet)');
    const conv = spec.conv || 'A', dd = spec.measure && +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;    // the host's JSON copy turns the far field (Infinity) into null
    const P = { S, input, src, env, E: P3.envBounds(env), keep: env.keepOut || 0, refl: input.limits.reflectivity, spec, conv, dist, win: spec.window.slice(), maxF: Math.max(1, input.limits.maxFacets | 0), Lp: src.pos.slice(), t0: Date.now(), notes: [], tools };
    P.g = T.grid(P.win, S.step, conv); P.B = T.bands(spec, P.g, { lo: S.floorMargin, hi: S.margin });
    P.grid = F.gridOf(P.win, S.step, conv, dist, P.Lp); P.S_ = F.sourceSamples(src, S.nSrc); P.gridA = F.gridOf(P.win, 0.1, conv, dist, P.Lp); P.gridB = F.gridOf(P.win, 0.5, conv, dist, P.Lp);
    P.cut = T.cutOf(spec, { slope: 1.0, lift: 0 });                          // null when the spec has no cut-off row
    P.I = (d) => { let s = 0; for (let b = 0; b < P.S_.n; b++) s += P.S_.q[b] * F.emitTo(P.S_, b, d[0], d[1], d[2]); return s; };      // lm per sr toward the unit vector d
    P.ledW = Math.max(src.w || 2, src.h || 2, 2 * (src.radius || 1), src.length || 0);
    P.lap = (s) => { if (S.verbose) console.log(`[${((Date.now() - P.t0) / 1000).toFixed(1)}s] ${s}`); };
    return P;
  }
  P3.problem = problem; P3.DEFAULTS = DEFAULTS;
})();

// ============================================================ layout
/* layout.js — where the lens, the focus and the shield go, and how deep each reflector cell can sit.
 *   lens candidate c = { n, f, a, kind, k, beta, back, yA, zA }   (back = how far the lens exit sits behind the envelope front)
 *   lay = { L, c, F (paraxial focus), O (entry vertex), xL, f, a, tanMax, D (focus distance from the LED), shield }                           */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, D2R = Math.PI / 180;

  function lensFor(P, c) {
    const key = [c.n, c.f, c.a, c.kind, c.k, c.beta].join('|'); P.lensCache = P.lensCache || new Map();
    if (!P.lensCache.has(key)) P.lensCache.set(key, P3.makeLens(c.n, c.f, c.a, c.kind, c.k, c.beta));
    return P.lensCache.get(key);
  }
  function placeLens(P, c) {
    const why = (r) => { P.why = P.why || {}; P.why[r] = (P.why[r] || 0) + 1; return null; };
    const L = lensFor(P, c); if (!L) return why('no lens design'); if (L.tanAcc < 0.3) return why('lens accepts too narrow a cone');
    const E = P.E, S0 = P.Lp, keep = P.keep, xExit = E.xmax - 0.6 - c.back, xL = xExit - L.t, F = [xL - L.bfd, c.yA, c.zA];
    for (let i = 0; i < 12; i++) { const cs = Math.cos(i * Math.PI / 6) * c.a, sn = Math.sin(i * Math.PI / 6) * c.a; for (const x of [xL + L.sag0, xL + L.t + L.sag1, xL + L.t]) if (!E.inside([x, c.yA + cs, c.zA + sn], 0.2)) return why('lens does not fit the envelope'); }
    if (S0[0] > xL - keep - 1 && Math.hypot(S0[1] - c.yA, S0[2] - c.zA) < c.a + keep + 1) return why('LED inside the lens');
    if (F[0] < E.xmin + 3) return why('focus behind the envelope'); if (F[0] - S0[0] < 8) return why('focus less than 8 mm ahead of the LED');
    return { L, c, F, O: [xL, c.yA, c.zA], xL, xExit, f: c.f, a: c.a, tanMax: 0.85 * L.tanAcc, D: V.dist(S0, F), u: V.sub(F, S0) };
  }
  // the focal-surface point whose bundle leaves the lens toward the far-field direction (h, v) degrees (the lens inverts)
  function imgPointDir(lay, d, dzExtra) {
    const L = lay.L, F = lay.F, ty = -d[1] / d[0], tz = -d[2] / d[0], tt = Math.hypot(ty, tz), th = Math.atan(tt) / D2R, m = P3.mapAt(L, th), sc = tt > 1e-9 ? m.rho / tt : lay.f;
    return [F[0] + m.dz + (dzExtra || 0), F[1] + ty * sc, F[2] + tz * sc];
  }
  const imgPoint = (P, lay, h, v, dzExtra) => imgPointDir(lay, RF.FarField.dirOf(h, v, P.conv), dzExtra);

  // the shield: a sheet near the focal surface whose edge is the cut-off line mapped through the lens (its field curvature fitted)
  function shieldFor(P, lay, s, dTop) {      // dTop: a number (the whole edge) or { L, R } (the left / right of the beam, own side R)
    if (!P.cut || s.shield === 'off') return null;
    const { F, f, a, L } = lay, E = P.E, fm = /fmvss/i.test(P.spec.preset || '');
    const defocus = s.shieldDefocus >= 0 ? s.shieldDefocus : (fm ? 0 : 0.12 * f / 12), W = Math.min(a * 1.15, f * Math.tan(s.spread * D2R) + 2), NE = 28, edge = [], top0 = P.cut.top, dL = typeof dTop === 'object' && dTop ? dTop.L : (dTop || 0), dR = typeof dTop === 'object' && dTop ? dTop.R : (dTop || 0), top = (h) => top0(h) - (h * P.cut.own > 0 ? dR : dL);
    for (let i = 0; i <= NE; i++) {
      const dy = -W + 2 * W * i / NE; let lo = -60, hi = 60;
      for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (imgPoint(P, lay, m, top(m))[1] - F[1] < dy) lo = m; else hi = m; }
      const H = (lo + hi) / 2; edge.push(imgPoint(P, lay, H, top(H), defocus));
    }
    let zb = F[2] - a - 1; for (let it = 0; it < 60 && (!E.inside([F[0], F[1] + W, zb], 0.3) || !E.inside([F[0], F[1] - W, zb], 0.3)); it++) zb += 0.5;
    const xc = F[0] + defocus; let num = 0, den = 0; for (const p of edge) { const dy = p[1] - F[1]; num += (p[0] - xc) * dy * dy; den += 0.5 * dy ** 4; }
    const cy = s.shieldCurved && den > 0 ? num / den : 0, xOn = (y) => xc + 0.5 * cy * (y - F[1]) ** 2;
    const pts = edge.map((p) => [xOn(p[1]), p[1], p[2]]).concat([[xOn(F[1] + W), F[1] + W, zb], [xOn(F[1] - W), F[1] - W, zb]]), ctr = [xc, F[1], (F[2] + zb) / 2];
    for (const p of pts) for (let it = 0; it < 30 && !E.inside(p, 0.2); it++) { p[1] = ctr[1] + (p[1] - ctr[1]) * 0.93; p[2] = ctr[2] + (p[2] - ctr[2]) * 0.93; p[0] = xOn(p[1]); }      // hard envelope clip
    const ne = edge.length, ed = pts.slice(0, ne).map((p) => [p[1], p[2]]).sort((p, q) => p[0] - q[0]);
    return { xc, cy, yF: F[1], edge: ed, zb: Math.max(zb, pts[ne][2], pts[ne + 1][2]), W, defocus, pts, ne, zbRaw: zb };
  }

  // ---------------------------------------------------------------- reflector depth along a direction d (unit, from the LED)
  // Candidates: the confocal ellipsoids (foci LED, F) of path length Lb·mul, plus the envelope-hugging depth.  Each must: sit inside the envelope, stay behind the focal
  // surface, send its chief ray into the lens aperture (tan ≤ tanMax), not graze (< 72° incidence), and not hide behind another facet (shell test).
  // Score = image sharpness − a penalty for leaving the base path length (keeps the depth map near-consistent).
  const LMUL = [1, 0.92, 1.08, 0.85, 1.17, 0.78, 1.28, 1.42];
  function depthChoice(P, lay, d, rmax, shell, Lb, cheap, s) {
    const { F, a } = lay, S = P.Lp, u = lay.u, D = lay.D, keep = P.keep, tanMax = lay.tanMax; let best = null;
    const rhos = [];
    for (const mul of cheap ? [1] : LMUL) { const Lc = Lb * mul; if (Lc > D + 0.5) rhos.push((Lc * Lc - D * D) / (2 * (Lc - V.dot(d, u)))); }
    rhos.push(rmax - 0.5);
    for (const rho of rhos) {
      if (!(rho > keep + 1) || rho > rmax - 0.3) continue;
      const Pp = V.add(S, V.mul(d, rho)), w = V.sub(F, Pp), lw = V.len(w);
      if (w[0] < 1) continue;
      if (Math.hypot(w[1], w[2]) / w[0] > tanMax) continue;
      if (V.dot(d, w) / lw > 0.81) continue;
      if (shell && shell(Pp, F)) continue;
      const m = lw / rho, img = m * P.ledW / lay.f / D2R, q = 1 / (1 + img / 4), Lc = rho + lw, sc = q - s.depthPenalty * Math.abs(Math.log(Lc / Lb));
      if (!best || sc > best.sc) best = { rho, P: Pp, q, m, sc, Lc };
    }
    return best;
  }
  P3.placeLens = placeLens; P3.imgPoint = imgPoint; P3.imgPointDir = imgPointDir; P3.shieldFor = shieldFor; P3.depthChoice = depthChoice; P3.lensFor = lensFor;
})();

// ============================================================ cells
/* cells.js — the reflector's cells over the LED's whole emission sphere: directions with their lumens, which of them a lens-path facet can serve,
 * flux-equalised k-means cells (spherical Voronoi), and the depth map (each cell picks its own distance along its ray).
 *   dirs(P, N)            → { n, u (xyz), w (lm), rEnv }
 *   pickLb(P, lay, D, s)  → base path length Lb (mm) and the proxy score of the layout (flux-weighted image sharpness over the directions a facet can use)
 *   makeCells(P, lay, D, ok, K, s) → cells [{ j, c (unit centre), poly (gnomonic vertices), P (depth point), rho, Lc, m, q, flux, members }] */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, D2R = Math.PI / 180;

  function rhoEnv(P, d) {
    const S = P.Lp, E = P.E, keep = P.keep; if (!E.inside(V.add(S, V.mul(d, keep + 1)), 0.5)) return 0;
    let lo = keep + 1, hi = 600; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (E.inside(V.add(S, V.mul(d, m)), 0.5)) lo = m; else hi = m; } return lo;
  }
  function dirs(P, N) {
    const u = P3.fibSphere(N), w = new Float64Array(N), rEnv = new Float64Array(N); let tot = 0;
    for (let i = 0; i < N; i++) { const d = [u[3 * i], u[3 * i + 1], u[3 * i + 2]]; w[i] = P.I(d) * 4 * Math.PI / N; tot += w[i]; rEnv[i] = rhoEnv(P, d); }
    return { n: N, u, w, rEnv, tot };
  }
  const dirAt = (D, i) => [D.u[3 * i], D.u[3 * i + 1], D.u[3 * i + 2]];
  const LF = [1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2.0, 2.3, 2.7, 3.2, 4.0];
  function pickLb(P, lay, D, s) {
    let best = { Lb: lay.D * 1.5, sc: -1 };
    for (const lf of LF) {
      let sc = 0; for (let i = 0; i < D.n; i += 2) { if (!(D.w[i] > 0) || D.rEnv[i] <= P.keep + 1.5) continue; const c = P3.depthChoice(P, lay, dirAt(D, i), D.rEnv[i], null, lay.D * lf, true, s); if (c) sc += D.w[i] * c.q; }
      if (sc > best.sc) best = { Lb: lay.D * lf, sc };
    }
    best.proxy = 2 * best.sc / Math.max(1e-9, D.tot); return best;
  }
  // flux-equalised k-means on the sphere: weights w² make the centre density follow w (2-D k-means density ∝ weight^½), so every cell holds about the same lumens
  function kmeansSphere(D, ok, K, iters, wexp) {
    const idx = []; for (let i = 0; i < D.n; i++) if (ok[i] && D.w[i] > 0) idx.push(i);
    K = Math.min(K, idx.length); if (K < 1) return [];
    const wt = (i) => Math.pow(D.w[i], wexp || 2), cs = [], dmin = new Float64Array(D.n).fill(Infinity);
    let first = idx[0]; for (const i of idx) if (D.w[i] > D.w[first]) first = i;
    cs.push(dirAt(D, first));
    while (cs.length < K) {
      const c = cs[cs.length - 1]; let bi = -1, bv = -1;
      for (const i of idx) { const dx = D.u[3 * i] - c[0], dy = D.u[3 * i + 1] - c[1], dz = D.u[3 * i + 2] - c[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < dmin[i]) dmin[i] = d2; const v = dmin[i] * wt(i); if (v > bv) { bv = v; bi = i; } }
      cs.push(dirAt(D, bi));
    }
    const own = new Int32Array(D.n).fill(-1);
    for (let it = 0; it < iters; it++) {
      const sx = new Float64Array(K), sy = new Float64Array(K), sz = new Float64Array(K);
      for (const i of idx) { let bj = 0, bd = -2; const x = D.u[3 * i], y = D.u[3 * i + 1], z = D.u[3 * i + 2]; for (let j = 0; j < K; j++) { const d = x * cs[j][0] + y * cs[j][1] + z * cs[j][2]; if (d > bd) { bd = d; bj = j; } } own[i] = bj; const w = wt(i); sx[bj] += w * x; sy[bj] += w * y; sz[bj] += w * z; }
      for (let j = 0; j < K; j++) { const l = Math.hypot(sx[j], sy[j], sz[j]); if (l > 0) cs[j] = [sx[j] / l, sy[j] / l, sz[j] / l]; }
    }
    return cs.map((c, j) => ({ j, c, members: idx.filter((i) => own[i] === j) })).filter((x) => x.members.length > 0);
  }
  // the spherical Voronoi cell of centre j as a convex polygon in gnomonic coordinates about it (great circles are straight lines there)
  function voronoi(cells, j, B) {                // cells = every centre of both classes ({ c }), so the polygons partition the whole sphere
    const c = cells[j].c, [e1, e2] = V.basis(c); let poly = [[-B, -B], [B, -B], [B, B], [-B, B]];
    for (let m = 0; m < cells.length && poly.length >= 3; m++) {
      if (m === j) continue; const q = cells[m].c, g = [c[0] - q[0], c[1] - q[1], c[2] - q[2]];
      poly = P3.clipHalf(poly, V.dot(g, e1), V.dot(g, e2), 1 - V.dot(c, q));
    }
    return { poly, e1, e2 };
  }
  const gnomonic = (c, e1, e2, x, y) => V.norm([c[0] + x * e1[0] + y * e2[0], c[1] + x * e1[1] + y * e2[1], c[2] + x * e1[2] + y * e2[2]]);

  function makeCells(P, lay, D, ok, K, s, centresL, centresD) {
    const cs = centresL || kmeansSphere(D, ok, K, 14, 2); if (!cs.length) return [];
    const all = cs.concat(centresD || []);
    const S = P.Lp, E = P.E, keep = P.keep, F = lay.F, u = lay.u, DF = lay.D;
    for (const c of cs) { c.flux = 0; for (const i of c.members) c.flux += D.w[i]; const vv = voronoi(all, all.indexOf(c), 1.2); c.poly = vv.poly; c.e1 = vv.e1; c.e2 = vv.e2; c.vdirs = vv.poly.map((p) => gnomonic(c.c, vv.e1, vv.e2, p[0], p[1])); c.rmax = rhoEnv(P, c.c); }
    // ONE base ellipsoid (path length Lb) for every cell: a continuous cup, so a reflected ray never runs into a neighbouring facet (letting every cell pick its own depth made
    // 40 % of the light hit other facets).  A cell whose base depth does not fit (envelope, lens cone, grazing) is dropped, not moved.
    for (const c of cs) { c.ch = P3.depthChoice(P, lay, c.c, Math.max(0, c.rmax), null, lay.Lb, true, s); }
    return cs.filter((c) => c.ch).map((c, k) => Object.assign(c, { k, P: c.ch.P, rho: c.ch.rho, Lc: c.ch.Lc, m: c.ch.m, q: c.ch.q }));
  }

  // ---- lens-bypass cells: directions the lens path cannot use.  A facet there sits as far out as the envelope allows (a big, flat-ish mirror = a sharp image), beside the lens
  // (its outgoing ray must clear the lens barrel: lateral distance from the lens axis ≥ a + 4), and bends the light by a real angle (d·x̂ < 0.85, no grazing).
  function directOk(P, lay, D, s, excl) {
    const ok = new Uint8Array(D.n), S = P.Lp; let flux = 0, rho = new Float64Array(D.n);
    for (let i = 0; i < D.n; i++) {
      if (!(D.w[i] > 0) || (excl && excl[i])) continue; const d = dirAt(D, i); if (d[0] > 0.85) continue; let r = D.rEnv[i] - 0.5; if (r <= P.keep + 2) continue;
      // push out until the lateral distance from the lens axis clears the barrel (the farther the better, so take the envelope-limited depth and check it)
      const Pp = V.add(S, V.mul(d, r)); if (Math.hypot(Pp[1] - lay.c.yA, Pp[2] - lay.c.zA) < lay.a + 4) continue;
      ok[i] = 1; rho[i] = r; flux += D.w[i];
    }
    return { ok, flux, rho };
  }
  function makeCellsDirect(P, lay, D, dk, K, s, centresD, centresL) {
    const cs = centresD; if (!cs.length) return [];
    const all = (centresL || []).concat(cs);
    for (const c of cs) { c.flux = 0; for (const i of c.members) c.flux += D.w[i]; const vv = voronoi(all, all.indexOf(c), 1.2); c.poly = vv.poly; c.e1 = vv.e1; c.e2 = vv.e2; }
    const S = P.Lp, out = [], an = RF.FarField.dirOf(0, -3, P.conv), E = P.E, keep = P.keep;
    for (const c of cs) {
      // the depth that lets the most of the cell's light find a mirror: a paraboloid (focus = LED, axis = the nominal aim) through the centre point, vertices/members that map outside
      // the envelope, inside the LED clearance or into the lens barrel are lost, so try a few depths between the wall and a third of it
      const rw = rhoEnv(P, c.c) - 0.5; let best = null;
      for (const f of [0.97, 0.85, 0.72, 0.6, 0.48, 0.38]) {
        const r = rw * f; if (r <= keep + 2) continue; const Pp = V.add(S, V.mul(c.c, r)), c0 = r * (1 - V.dot(c.c, an)); if (!(c0 > 1e-6)) continue;
        let fit = 0; for (const i of c.members) { const d = dirAt(D, i), den = 1 - V.dot(d, an); if (!(den > 1e-6)) continue; const p = V.add(S, V.mul(d, c0 / den)); if (E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && Math.hypot(p[1] - lay.c.yA, p[2] - lay.c.zA) >= lay.a + 2) fit += D.w[i]; }
        if (!best || fit > best.fit * 1.02) best = { r, Pp, fit };
      }
      if (!best || best.fit < 0.4 * c.flux) continue;
      out.push(Object.assign(c, { k: out.length, P: best.Pp, rho: best.r, direct: true, fit: best.fit }));
    }
    return out;
  }
  P3.directOk = directOk; P3.makeCellsDirect = makeCellsDirect; P3.kmeansSphere = kmeansSphere;
  P3.dirs = dirs; P3.dirAt = dirAt; P3.pickLb = pickLb; P3.makeCells = makeCells; P3.gnomonic = gnomonic; P3.rhoEnv = rhoEnv;
})();

// ============================================================ greedy
/* greedy.js — aims by matching pursuit on the ideal beam ("fill then fix"): every facet has a FOOTPRINT (the far-field blob its image makes, from the forward model at a nominal
 * aim; translation-invariant), and facets are placed one by one, biggest image first, where they fit the not-yet-served part of the beam best.  Lens-path facets only deliver
 * below the shield edge (the footprint is cut by the cut-off line: light above it is lost), so a facet whose image is taller than the room under the edge goes elsewhere and the
 * ones with small / flat images take the edge — the placement itself prefers a sharp edge made by the shield cutting the image.
 *   RF.P3.coarse(P, TStar, step)             → lm per coarse bin of the ideal beam (the residual to fill)
 *   RF.P3.placeLens(...)  (see main.js)      */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, F = P3.fwd, D2R = Math.PI / 180;

  // ideal beam (cd on the fine grid g) → lumens per bin of a coarser grid G (same origin, step a multiple of the fine step)
  function coarse(P, Tstar, G) {
    const g = P.g, k = Math.round(G.step / g.step), out = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < g.nv; j++) { const J = Math.min(G.nv - 1, (j / k) | 0); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; out[J * G.nh + Math.min(G.nh - 1, (i / k) | 0)] += Tstar[q] * g.om[q]; } }
    return out;
  }
  // a facet's footprint as pixel offsets from its flux centroid on grid G: { flux, di, dj, val, sh, sv (rms size, deg), hc, vc }
  function footOf(P, facet, post, G, na) {
    const fp = F.footprint(facet, P.S_, G, { na: na || 16, post }); if (!(fp.flux > 0)) return null;
    const n = fp.idx.length, di = new Int16Array(n), dj = new Int16Array(n), ci = (fp.hc - G.h0) / G.step - 0.5, cj = (fp.vc - G.v0) / G.step - 0.5, ri = Math.round(ci), rj = Math.round(cj);
    for (let q = 0; q < n; q++) { const i = fp.idx[q] % G.nh, j = (fp.idx[q] / G.nh) | 0; di[q] = i - ri; dj[q] = j - rj; }
    return { flux: fp.flux, di, dj, val: fp.val, n, hc: fp.hc, vc: fp.vc, ri, rj, sh: Math.sqrt(Math.max(1e-6, fp.cov[0])), sv: Math.sqrt(Math.max(1e-6, fp.cov[2])), cov: fp.cov };
  }
  // pixel (i, j) of grid G where the footprint's centroid goes for an aim (h, v)
  const pixOf = (G, h, v) => [Math.round((h - G.h0) / G.step - 0.5), Math.round((v - G.v0) / G.step - 0.5)];

  // gain of putting footprint fp with its centroid at pixel (ci, cj): lumens that land where the beam still wants light, minus lam × the rest
  function gain(fp, G, ci, cj, resid, mask, lam) {
    let fit = 0, waste = 0; const nh = G.nh, nv = G.nv;
    for (let q = 0; q < fp.n; q++) {
      const i = ci + fp.di[q], j = cj + fp.dj[q], v = fp.val[q];
      if (i < 0 || j < 0 || i >= nh || j >= nv) { waste += v; continue; }
      const p = j * nh + i, d = v * (mask ? mask[p] : 1), r = resid[p]; const f = d < r ? d : (r > 0 ? r : 0); fit += f; waste += v - f;
    }
    return fit - lam * waste;
  }
  function subtract(fp, G, ci, cj, resid, mask) {
    let del = 0; for (let q = 0; q < fp.n; q++) { const i = ci + fp.di[q], j = cj + fp.dj[q]; if (i < 0 || j < 0 || i >= G.nh || j >= G.nv) continue; const p = j * G.nh + i, d = fp.val[q] * (mask ? mask[p] : 1); resid[p] -= d; del += d; }
    return del;
  }
  // summed-area table of max(resid, 0) × mask for the candidate search
  function sat(G, resid, mask) {
    const W = G.nh + 1, S = new Float64Array(W * (G.nv + 1));
    for (let j = 0; j < G.nv; j++) { let row = 0; for (let i = 0; i < G.nh; i++) { const p = j * G.nh + i, r = resid[p] > 0 ? resid[p] * (mask ? Math.max(mask[p], 0.05) : 1) : 0; row += r; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } }
    return S;
  }
  const boxSum = (S, G, i0, j0, i1, j1) => { i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(G.nh, i1); j1 = Math.min(G.nv, j1); if (i1 <= i0 || j1 <= j0) return 0; const W = G.nh + 1; return S[j1 * W + i1] - S[j0 * W + i1] - S[j1 * W + i0] + S[j0 * W + i0]; };

  // place the footprints in the order o.order; fps[k] may be an array of ALTERNATIVES (e.g. several widths): the best (position, alternative) wins.
  // returns [{ k, h, v (the placed centroid, deg), alt, delivered }] and leaves the unserved light in resid
  function greedy(G, fps, resid, mask, o) {
    o = Object.assign({ lam: 0.5, top: 40 }, o || {});
    const out = [];
    for (const k of o.order) {
      const alts = Array.isArray(fps[k]) ? fps[k] : [fps[k]]; if (!alts.length || !alts[0]) continue;
      const S = sat(G, resid, mask); let best = null;
      alts.forEach((fp, a) => {
        const wi = Math.max(1, Math.round(1.5 * fp.sh / G.step)), wj = Math.max(1, Math.round(1.5 * fp.sv / G.step)), cand = [], stride = Math.max(1, Math.round(Math.min(wi, wj) / 2));
        for (let j = 0; j < G.nv; j += stride) for (let i = 0; i < G.nh; i += stride) { const s = boxSum(S, G, i - wi, j - wj, i + wi + 1, j + wj + 1); if (s > 0) cand.push([s, i, j]); }
        cand.sort((x, y) => y[0] - x[0]);
        const ok = (ci, cj) => !o.allowed || o.allowed(G.h0 + (ci + 0.5) * G.step, G.v0 + (cj + 0.5) * G.step, fp, k);
        let b = null;
        for (const [, ci, cj] of cand.slice(0, o.top)) { if (!ok(ci, cj)) continue; const gn = gain(fp, G, ci, cj, resid, mask, o.lam); if (!b || gn > b.gn) b = { gn, ci, cj }; }
        if (!b) return;
        for (let it = 0; it < 6; it++) { let moved = false; for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ci = b.ci + x, cj = b.cj + y; if (!ok(ci, cj)) continue; const gn = gain(fp, G, ci, cj, resid, mask, o.lam); if (gn > b.gn + 1e-12) { b = { gn, ci, cj }; moved = true; } } if (!moved) break; }
        if (!best || b.gn > best.gn) best = Object.assign(b, { a, fp });
      });
      if (!best) { out.push({ k, h: null, v: null, delivered: 0, alt: -1 }); continue; }
      const del = subtract(best.fp, G, best.ci, best.cj, resid, mask);
      out.push({ k, h: G.h0 + (best.ci + 0.5) * G.step, v: G.v0 + (best.cj + 0.5) * G.step, alt: best.a, delivered: del, gn: best.gn });
    }
    return out;
  }
  // a Gaussian footprint (flux lm, rms sizes sh, sv deg) on grid G, centred on pixel (0, 0)
  function gaussFoot(G, flux, sh, sv) {
    const ni = Math.ceil(3 * sh / G.step), nj = Math.ceil(3 * sv / G.step), di = [], dj = [], val = []; let tot = 0;
    for (let j = -nj; j <= nj; j++) for (let i = -ni; i <= ni; i++) { const w = Math.exp(-0.5 * ((i * G.step / sh) ** 2 + (j * G.step / sv) ** 2)); di.push(i); dj.push(j); val.push(w); tot += w; }
    return { flux, di: Int16Array.from(di), dj: Int16Array.from(dj), val: Float64Array.from(val, (w) => w / tot * flux), n: val.length, sh, sv, ri: 0, rj: 0, hc: 0, vc: 0 };
  }
  P3.coarse = coarse; P3.footOf = footOf; P3.pixOf = pixOf; P3.greedy = greedy; P3.gainAt = gain; P3.gaussFoot = gaussFoot;
})();

// ============================================================ polish
/* polish.js — coordinate descent on the aims: every facet's footprint (translation-invariant, shield-masked for the lens path) slides in small steps and the move is kept when the
 * cost of the whole far field falls.  Cost per pixel = wBand · weight · (relative floor shortfall² + relative ceiling excess²) + wTrack · (relative miss of the ideal beam)².
 *   RF.P3.aggBands(P, G)                 → { lo, hi, wc, T (cd), n }  the spec's pixel bands and the ideal beam on grid G
 *   RF.P3.polish(G, fps, pos, mask, band, Efix, o) → moves pos in place; returns { before, after, moves }                                                   */
(function () {
  'use strict';
  const RF = globalThis.RF, P3 = RF.P3 = RF.P3 || {};

  function aggBands(P, G, Tstar, wmul) {
    const g = P.g, k = Math.round(G.step / g.step), n = G.nh * G.nv, lo = new Float64Array(n), hi = new Float64Array(n).fill(Infinity), wc = new Float64Array(n), Ts = new Float64Array(n), om = new Float64Array(n);
    for (let j = 0; j < g.nv; j++) { const J = Math.min(G.nv - 1, (j / k) | 0); for (let i = 0; i < g.nh; i++) {
      const q = j * g.nh + i, p = J * G.nh + Math.min(G.nh - 1, (i / k) | 0);
      if (P.B.lo[q] > lo[p]) lo[p] = P.B.lo[q]; if (P.B.hi[q] < hi[p]) hi[p] = P.B.hi[q]; { const w = P.B.wc[q] * (wmul ? wmul[q] : 1); if (w > wc[p]) wc[p] = w; } Ts[p] += Tstar[q] * g.om[q]; om[p] += g.om[q]; } }
    for (let p = 0; p < n; p++) Ts[p] = om[p] > 0 ? Ts[p] / om[p] : 0;
    return { lo, hi, wc, T: Ts, om };
  }
  function pixelCost(band, G, p, E, o) {
    const om = G.om[p], cd = E / om, lo = band.lo[p], hi = band.hi[p], T = band.T[p]; let v = 0;
    if (lo > 0 && cd < lo) { const r = (lo - cd) / lo; v += r * r; }
    if (cd > hi) { const r = (cd - hi) / hi; v += r * r; }
    const t = Math.max(T, o.tref), d = (cd - T) / t;
    return o.wBand * band.wc[p] * v + o.wTrack * d * d;
  }
  // pos[k] = [ci, cj] pixel of footprint k's centroid (null = unplaced); fps[k] = footprint (alternatives: fps[k] array with pos[k][2] = chosen alternative)
  function polish(G, fps, pos, mask, band, Efix, o) {
    o = Object.assign({ wBand: 150, wTrack: 0.03, steps: [8, 4, 2, 1], sweeps: 2, trust: 30, tref: 200, allowed: null, seed: 1 }, o || {});
    const n = G.nh * G.nv, E = Float64Array.from(Efix || new Float64Array(n)), C = new Float64Array(n), nh = G.nh, nv = G.nv;
    const fpOf = (k) => (Array.isArray(fps[k]) ? fps[k][pos[k][2] | 0] : fps[k]);
    const add = (fp, ci, cj, sgn) => { for (let q = 0; q < fp.n; q++) { const i = ci + fp.di[q], j = cj + fp.dj[q]; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const p = j * nh + i; E[p] += sgn * fp.val[q] * (mask ? mask[p] : 1); } };
    for (let k = 0; k < fps.length; k++) if (pos[k]) add(fpOf(k), pos[k][0], pos[k][1], 1);
    let total = 0; for (let p = 0; p < n; p++) { C[p] = pixelCost(band, G, p, E[p], o); total += C[p]; }
    const before = total, stamp = new Int32Array(n); let st = 0, moves = 0;
    const touched = [];
    const trial = (k, fo, co, fn, cn) => {                          // move footprint k from (fo @ co) to (fn @ cn); returns the cost change, leaves E changed (caller keeps or reverts)
      st++; touched.length = 0;
      const mark = (fp, c) => { for (let q = 0; q < fp.n; q++) { const i = c[0] + fp.di[q], j = c[1] + fp.dj[q]; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const p = j * nh + i; if (stamp[p] !== st) { stamp[p] = st; touched.push(p); } } };
      mark(fo, co); mark(fn, cn); add(fo, co[0], co[1], -1); add(fn, cn[0], cn[1], 1);
      let d = 0; for (const p of touched) d += pixelCost(band, G, p, E[p], o) - C[p];
      return d;
    };
    const rng = (() => { let s = o.seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const order = []; for (let k = 0; k < fps.length; k++) if (pos[k]) order.push(k);
    const home = new Map(order.map((k) => [k, [pos[k][0], pos[k][1]]]));
    for (let sw = 0; sw < o.sweeps; sw++) for (const step of o.steps) {
      for (let r = order.length - 1; r > 0; r--) { const t = (rng() * (r + 1)) | 0; [order[r], order[t]] = [order[t], order[r]]; }
      for (const k of order) {
        const hk = home.get(k);
        const cands = [[step, 0], [-step, 0], [0, step], [0, -step]];
        // alternatives (widths): ±1
        const alt = Array.isArray(fps[k]) ? [-1, 1] : [];
        let best = null;
        for (const [a, b] of cands) {
          const c1 = [pos[k][0] + a, pos[k][1] + b, pos[k][2]]; const tr = o.trustOf ? o.trustOf(k) : o.trust; if (Math.abs(c1[0] - hk[0]) > tr || Math.abs(c1[1] - hk[1]) > tr) continue; if (o.allowed && !o.allowed(c1[0], c1[1], k)) continue;
          const fo = fpOf(k), d = trial(k, fo, pos[k], fo, c1);
          if (d < -1e-9 && (!best || d < best.d)) best = { d, c: c1 };
          add(fo, c1[0], c1[1], -1); add(fo, pos[k][0], pos[k][1], 1);               // revert
        }
        for (const da of alt) {
          const ai = (pos[k][2] | 0) + da; if (ai < 0 || ai >= fps[k].length) continue; const c1 = [pos[k][0], pos[k][1], ai], fo = fpOf(k), fn = fps[k][ai], d = trial(k, fo, pos[k], fn, c1);
          if (d < -1e-9 && (!best || d < best.d)) best = { d, c: c1 };
          add(fn, c1[0], c1[1], -1); add(fo, pos[k][0], pos[k][1], 1);
        }
        if (best) {                                                      // apply the best move and refresh the cost cache over the touched pixels
          const fo = fpOf(k), fn = Array.isArray(fps[k]) ? fps[k][best.c[2] | 0] : fps[k];
          trial(k, fo, pos[k], fn, best.c); for (const p of touched) { total += pixelCost(band, G, p, E[p], o) - C[p]; C[p] = pixelCost(band, G, p, E[p], o); }
          pos[k] = best.c; moves++;
        }
      }
    }
    return { before, after: total, moves, E };
  }
  P3.aggBands = aggBands; P3.polish = polish; P3.pixelCost = pixelCost;
})();

// ============================================================ ellipsoid
/* ellipsoid.js — the reference rung: ONE ellipsoid of revolution (foci: the LED and the lens focus) as the whole reflector, the classic projector cup.
 *   RF.P3.ellipsoidCap(P, lay) → { surface (one engine `rev` conic, counted as one facet), r1, Lc } or null
 * The path length Lc is the layout's base length (lay.Lb); the cup runs from the vertex behind the LED out to the largest radius whose every point is allowed
 * (inside the envelope, behind the focus, within the lens cone, not grazing, outside the LED clearance).                                                  */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {};
  function ellipsoidCap(P, lay, o) {
    o = o || {}; const S = P.Lp, F = lay.F, u = V.sub(F, S), Dd = V.len(u), W = V.mul(u, 1 / Dd), Lc = o.Lc || lay.Lb, ae = Lc / 2, c = Dd / 2, e = Dd / Lc, k = -e * e;
    if (!(Lc > Dd + 0.5)) return null;
    const R = (Lc * Lc - Dd * Dd) / (2 * Lc), O = V.sub(S, V.mul(W, ae - c)), [e1, e2] = V.basis(W), E = P.E, keep = P.keep, k1 = 1 + k;
    const zOf = (r) => (R - Math.sqrt(Math.max(0, R * R - k1 * r * r))) / k1, ok = (r) => {
      for (let a = 0; a < 16; a++) {
        const t = a * Math.PI / 8, z = zOf(r), X = V.add(O, V.add(V.mul(W, z), V.add(V.mul(e1, r * Math.cos(t)), V.mul(e2, r * Math.sin(t))))), w = V.sub(F, X), lw = V.len(w), d = V.norm(V.sub(X, S));
        if (!E.inside(X, 0.3) || V.dist(X, S) <= keep + 1 || w[0] < 1 || Math.hypot(w[1], w[2]) / w[0] > lay.tanMax || V.dot(d, w) / lw > 0.81) return false;
      }
      return true;
    };
    let r1 = 0; const rmax = Math.sqrt(R * R / k1) * 0.999 * (k1 > 0 ? 1 : 1e9); for (let r = 1; r < Math.min(rmax, 400); r += 0.5) { if (!ok(r)) break; r1 = r; }
    if (r1 < 3) return null;
    return { r1, Lc, R, k, O, W, surface: (P.S.gH > 0 && Math.abs(P.S.gH - 1) > 1e-6) ? (function () { const wy = V.sub([0, 1, 0], V.mul(W, W[1])), hy = V.mul(wy, 1 / V.len(wy)); const g = P.S.gH, cx = 1 / (R * g), cz = 1 / ae, ev = V.mul(V.cross(W, hy), 1 / V.len(V.cross(W, hy))), zq = (r) => (1 - Math.sqrt(Math.max(0, 1 - cz * cx * r * r))) / cz; let rx = Math.min(0.985 * Math.sqrt(ae * R * g), 400); while (rx > 3 && !(E.inside(V.add(O, V.add(V.mul(W, zq(rx)), V.mul(hy, rx))), 0.3) && E.inside(V.add(O, V.add(V.mul(W, zq(rx)), V.mul(hy, -rx))), 0.3))) rx -= 0.5; const pts3 = []; for (let i = 0; i < 48; i++) { const th = 2 * Math.PI * i / 48; pts3.push(V.add(O, V.add(V.mul(hy, rx * Math.cos(th)), V.mul(ev, r1 * Math.sin(th))))); } return { type: 'quad', id: 'p3_ellipsoid', P: O, n: W, ref: hy, curv: [cx, 1 / R, 0, cz], clip: { kind: 'poly', pts3 }, front: 1, optics: { interaction: 'reflect', reflectivity: P.refl } }; })() : { type: 'rev', id: 'p3_ellipsoid', O, W, ref: e1, seg: { kind: 'conic', zv: 0, R, k, r0: 0, r1 }, front: -1, optics: { interaction: 'reflect', reflectivity: P.refl } } };
  }
  P3.ellipsoidCap = ellipsoidCap;
})();

// ============================================================ assemble
/* assemble.js — aims for the lens-path cells, facets (exact ellipsoids with foci LED and the cell's image point), engine surfaces, and the model's verdict. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, Pl = RF.SqmPlan, F = P3.fwd, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  // the facet polygon: the cell's Voronoi polygon (gnomonic coordinates about its centre) mapped onto the facet's quadric.  Every vertex that lands somewhere not allowed
  // (outside the envelope, inside the LED clearance, past the focus, …) is pulled toward the centre until it is; the convex hull of what is left is the clip.
  function cellPoly(P, cell, mapFn, validFn, scale) {
    const pts2 = [], sc = scale > 0 && scale < 1 ? Math.sqrt(scale) : 1;
    for (const [x0, y0] of cell.poly) {
      const x = x0 * sc, y = y0 * sc;
      let t = 1, ok = false;
      for (let it = 0; it < 14; it++) { const p = mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x * t, y * t)); if (p && validFn(p)) { ok = true; break; } t *= 0.8; }
      if (ok) pts2.push([x * t, y * t]);
    }
    pts2.push([0, 0]);
    const h = P3.hull2(pts2); if (h.length < 3) return null;
    const hv = h.map((i) => pts2[i]);
    if (P3.area2(hv) < 0.05 * sc * sc * P3.area2(cell.poly)) return null;
    return hv.map(([x, y]) => mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x, y)));
  }
  function polyFor(P, lay, cell, I, S0) {
    const S = P.Lp, Pp = cell.P, E = P.E, keep = P.keep, Fx = lay.F[0], s0 = S0 || S, Ls = V.dist(Pp, s0) + V.dist(Pp, I);
    if (!(Ls > V.dist(s0, I))) return null;
    let rhoAt;
    if (!S0) { const uI = V.sub(I, S), DI = V.len(uI); rhoAt = (d) => (Ls * Ls - DI * DI) / (2 * (Ls - V.dot(d, uI))); }
    else rhoAt = (d) => { let lo = 0, hi = 800; for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2, X = V.add(S, V.mul(d, m)); if (V.dist(X, s0) + V.dist(X, I) < Ls) lo = m; else hi = m; } return (lo + hi) / 2; };      // the ray from the LED centre meets the ellipsoid (foci: the chosen emitter point and I)
    return cellPoly(P, cell, (d) => { const r = rhoAt(d); return r > 0 && r < 799 ? V.add(S, V.mul(d, r)) : null; }, (p) => E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && p[0] < Fx - 0.2);
  }
  function facetOf(P, lay, cell, I, id, S0) {
    const pts3 = polyFor(P, lay, cell, I, S0); if (!pts3 || pts3.length < 3) return null;
    return { type: 'facet', id, P: cell.P, S0: (S0 || P.Lp).slice(), Z: I, di: V.dist(I, cell.P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: P.refl } };
  }
  // the emitter's extreme points along its own axes (a filament's two ends, a chip's edges): a facet whose first focus is such a point hangs the emitter's image on ONE side of its aim
  // (Liou 2009, "projector headlamp without a screen"): put the aim on the cut-off line and the image lies below it, no screen needed to stop the half above
  function sourceEnds(P) {
    const src = P.src, fr = RF.Source.frame(src), c = src.pos, out = [], add = (v, h) => { if (h > 0.05) { out.push(V.add(c, V.mul(v, h))); out.push(V.add(c, V.mul(v, -h))); } };
    if (src.length > 0) add(fr.a, src.length / 2 - 0.1); else { add(fr.u, (src.w || 0) / 2 - 0.05); add(fr.v, (src.h || 0) / 2 - 0.05); if (!(src.w > 0) && src.radius > 0) { add(fr.u, src.radius); add(fr.v, src.radius); } }
    return out.slice(0, 6);
  }
  // does the chief ray P → I enter the lens aperture?
  function entersLens(lay, Pp, I) {
    const w = V.sub(I, Pp); if (!(w[0] > 0)) return false; const t = (lay.xL - Pp[0]) / w[0], X = V.add(Pp, V.mul(w, t));
    return Math.hypot(X[1] - lay.F[1], X[2] - lay.F[2]) <= 0.92 * lay.a;
  }

  // aims: the ideal beam's lens-reachable part, cut into equal-flux cells, paired with the facets by image size (sharp facets ↔ small, bright cells)
  function lensAims(P, lay, cells, des, s) {
    const g = P.g, top = P.cut ? P.cut.top : () => 5, TL = new Float64Array(g.n), vmin = -20;
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); if (v < vmin) continue; for (let i = 0; i < g.nh; i++) { const h = g.hOf(i); if (Math.abs(h) > s.spread || v > top(h)) continue; TL[j * g.nh + i] = des.T[j * g.nh + i]; } }
    const sp = Pl.superpixels(g, TL, 0.4), aims = Pl.kmeans(sp, cells.length, 20, 1);
    const size = (a) => Math.sqrt(a.area) / D2R;                              // the cell's width (deg)
    const byA = aims.map((a, i) => i).sort((x, y) => size(aims[x]) - size(aims[y])), byC = cells.map((c, i) => i).sort((x, y) => cells[y].q - cells[x].q);
    const out = new Array(cells.length).fill(null);
    for (let r = 0; r < Math.min(byA.length, byC.length); r++) out[byC[r]] = aims[byA[r]];
    return { out, aims, flux: sp.reduce((x, q) => x + q.f, 0) };
  }


  // ---- lens-bypass facets: a paraboloid (focus = LED) aimed at a far-field direction, widened by two-curvature shaping (copied from SQM's emit.js)
  function eig2(c) { const tr = (c[0] + c[2]) / 2, d = Math.sqrt(Math.max(0, ((c[0] - c[2]) / 2) ** 2 + c[1] * c[1])); const l1 = tr + d, l2 = tr - d, th = 0.5 * Math.atan2(2 * c[1], c[0] - c[2]); return { l1, l2, e1: [Math.cos(th), Math.sin(th)], e2: [-Math.sin(th), Math.cos(th)] }; }
  function apertureStd(f, b) {
    const fq = F.quadricOf(f), A = F.apertureSamples(f, fq, 24); let m = 0, m2 = 0;
    for (let a = 0; a < A.n; a++) { const y = (A.pts[7 * a] - f.P[0]) * b[0] + (A.pts[7 * a + 1] - f.P[1]) * b[1] + (A.pts[7 * a + 2] - f.P[2]) * b[2]; m += y; m2 += y * y; }
    m /= Math.max(1, A.n); return Math.sqrt(Math.max(1e-12, m2 / Math.max(1, A.n) - m * m));
  }
  function shape(P, f, aim, extraCov) {
    const ev = eig2(extraCov), l1 = Math.max(0, ev.l1), l2 = Math.max(0, ev.l2); if (l1 < 1e-4 && l2 < 1e-4) return f;
    const d0 = RF.FarField.dirOf(aim.h, aim.v, P.conv), eps = 0.5, axes = [ev.e1, ev.e2].map((e) => V.norm(V.sub(RF.FarField.dirOf(aim.h + eps * e[0], aim.v + eps * e[1], P.conv), d0)));
    const vg = [l1, l2].map((l, k) => { const sg = Math.sqrt(l) * D2R, sap = apertureStd(f, axes[k]); return -(sg / Math.max(sap, 1e-3)); });
    return Object.assign({}, f, { vg, ax: axes[0] });
  }
  function polyForPar(P, lay, cell, a, scale) {
    const S = P.Lp, Pp = cell.P, d0 = V.norm(V.sub(Pp, S)), r0 = V.dist(Pp, S), c0 = r0 * (1 - V.dot(d0, a)), E = P.E, keep = P.keep; if (!(c0 > 1e-6)) return null;
    return cellPoly(P, cell, (d) => { const den = 1 - V.dot(d, a); return den > 1e-6 ? V.add(S, V.mul(d, c0 / den)) : null; },
      (p) => E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && Math.hypot(p[1] - lay.c.yA, p[2] - lay.c.zA) >= lay.a + 2, scale);
  }
  function facetDirect(P, lay, cell, h, v, id, extraCov, scale) {
    const a = RF.FarField.dirOf(h, v, P.conv), pts3 = polyForPar(P, lay, cell, a, scale); if (!pts3 || pts3.length < 3) return null;
    const Z = V.add(cell.P, V.mul(a, 1e6));
    let f = { type: 'facet', id, P: cell.P, S0: P.Lp.slice(), Z, di: V.dist(Z, cell.P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: P.refl } };
    if (extraCov) f = shape(P, f, { h, v }, extraCov);
    return f;
  }

  function surfacesOf(P, lay, shield, facets, s) {
    const out = facets.slice(), L = lay.L, glass = s.fresnel ? { interaction: 'refract', reflectivity: 0, ior: s.ior, fresnel: 'exact', twoSided: false } : { interaction: 'refract', reflectivity: 0.9, ior: s.ior, fresnelT: 0.96, twoSided: false };
    if (shield) {
      const { xc, cy, yF, pts, ne, zb } = shield, xOn = (y) => xc + 0.5 * cy * (y - yF) ** 2, ctr = [xc, yF, (lay.F[2] + shield.zbRaw) / 2], bot = (y) => [xOn(y), y, zb];
      for (let i = 0; i + 1 < ne; i++) {
        const pa = pts[i], pb = pts[i + 1], q = [pa, pb, bot(pb[1]), bot(pa[1])];
        if (Math.abs(pb[1] - pa[1]) < 1e-3 || q.some((x) => !P.E.inside(x, 0.1))) continue;
        out.push(Math.abs(cy) > 1e-5 ? { type: 'quad', id: 'p3_shield' + i, P: [xc, yF, ctr[2]], n: [-1, 0, 0], ref: [0, 1, 0], curv: [-cy, 0, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB }
          : { type: 'plane', id: 'p3_shield' + i, P: ctr, n: [-1, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB });
      }
    }
    for (const sf of P3.lensSurfaces(L, lay.O, glass, 'p3_lens')) out.push(sf);
    return out;
  }

  // the model's verdict on a facet list (reflections through shield + lens; direct light is not in it)
  function evaluate(P, lay, shield, facets, na, stats) {
    const post = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield, stats });
    const fld = F.field(facets, P.S_, P.grid, { na: na || 24, post }), gj = T.judgeGrid(P.g, fld.E, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, T.mdOf(P.spec));
    const hard = ev.rows.filter((r) => r.verdict === 'fail').length, worst = ev.rows.length ? Math.min(...ev.rows.map((r) => r.margin)) : 1;
    let deficit = 0; for (const r of ev.rows) if (r.margin < 0) deficit += Math.min(3, -r.margin);
    return { fld, gj, ev, hard, worst, deficit, score: -3 * hard - 1 * ev.n.unsure - 6 * deficit + 0.5 * clamp(worst, -1, 0.2) + 0.003 * gj.lmWindow, lm: gj.lmWindow };
  }
  P3.polyFor = polyFor; P3.facetOf = facetOf; P3.sourceEnds = sourceEnds; P3.entersLens = entersLens; P3.lensAims = lensAims; P3.surfacesOf = surfacesOf; P3.evaluate = evaluate; P3.facetDirect = facetDirect; P3.shape = shape;
})();

// ============================================================ main
/* main.js — the solver: spec → ideal beam → candidate lens/focus layouts → cells over the whole emission sphere → aims → facets + shield + lens → model verdict → best layout. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, D2R = Math.PI / 180;
  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused (the depth map picks distances)' },
    { key: 'lensShape', label: 'Lens: auto (the best traced design wins) · flat-in (flat face toward the reflector, convex conic out: the production projector lens) · curve-in (conic toward the reflector, exact on axis) · biconvex', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'flat-in', label: 'flat side to the reflector' }, { value: 'curve-in', label: 'curved side to the reflector (stigmatic)' }, { value: 'biconvex', label: 'biconvex' }], default: 'auto' },
    { key: 'ior', label: 'Lens index (1.49 acrylic, 1.59 polycarbonate)', type: 'number', min: 1.3, max: 2, step: 0.01, default: 1.59 },
    { key: 'facets', label: 'Facets to use (0 = the whole budget, at most 300)', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'shield', label: 'Shield (auto: on when the spec has a cut-off)', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'off', label: 'off' }], default: 'auto', adv: true },
    { key: 'shieldCurved', label: 'Curved shield (follows the field curvature)', type: 'checkbox', default: true, adv: true },
    { key: 'shieldDefocus', label: 'Shield axial offset (mm, + = toward the lens, −1 = auto)', type: 'number', min: -1, max: 4, step: 0.05, default: -1, adv: true },
    { key: 'spread', label: 'Widest lens-path aim, ± degrees', type: 'number', min: 2, max: 40, step: 1, default: 25, adv: true },
    { key: 'edgeDrop', label: 'Image centres below the cut-off (°)', type: 'number', min: 0, max: 3, step: 0.05, default: 0.4, adv: true },
    { key: 'depthPenalty', label: 'Depth-map stiffness (penalty for leaving the base path length)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.35, adv: true },
    { key: 'fluxFrac', label: 'Share of the lens-path flux the ideal beam may ask for', type: 'number', min: 0.2, max: 1.2, step: 0.01, default: 0.85, adv: true },
    { key: 'focal', label: 'Lens focal length (mm, 0 = search)', type: 'number', min: 0, max: 150, step: 1, default: 0, adv: true },
    { key: 'aperture', label: 'Lens aperture radius (mm, 0 = search)', type: 'number', min: 0, max: 100, step: 0.5, default: 0, adv: true },
    { key: 'bypass', label: 'Lens-bypass facets (auto: facets beside the lens use the light the lens path cannot; off: a sealed projector, all light leaves through the lens)', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'off', label: 'off (sealed)' }], default: 'auto' },
    { key: 'gH', label: 'EXPERIMENT: horizontal vertex-curvature radius ratio of the single reflector (1 = ellipsoid of revolution)', type: 'number', min: 0, max: 8, step: 0.05, default: 1, adv: true },
    { key: 'half', label: 'EXPERIMENT: split reflector (whole, top, bottom, both: two half-bowls split by the horizontal plane through the axis)', type: 'select', options: [{ value: 'whole', label: 'whole' }, { value: 'top', label: 'top only' }, { value: 'bottom', label: 'bottom only' }, { value: 'both', label: 'both halves' }, { value: 'quad', label: 'four quadrants, each aimed' }], default: 'whole' },
    { key: 'dT', label: 'EXPERIMENT: top half focus shifted along the axis (mm, + = toward the lens)', type: 'number', min: -30, max: 30, step: 0.5, default: 0, adv: true },
    { key: 'dB', label: 'EXPERIMENT: bottom half focus shifted along the axis (mm, + = toward the lens)', type: 'number', min: -30, max: 30, step: 0.5, default: 0, adv: true },
    { key: 'hUL', label: 'EXPERIMENT: quadrant UL aim, degrees (h; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: -3, adv: true },
    { key: 'vUL', label: 'EXPERIMENT: quadrant UL aim, degrees (v; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: -0.5, adv: true },
    { key: 'hUR', label: 'EXPERIMENT: quadrant UR aim, degrees (h; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: 3, adv: true },
    { key: 'vUR', label: 'EXPERIMENT: quadrant UR aim, degrees (v; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: 0, adv: true },
    { key: 'hLR', label: 'EXPERIMENT: quadrant LR aim, degrees (h; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: 1, adv: true },
    { key: 'vLR', label: 'EXPERIMENT: quadrant LR aim, degrees (v; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: 0, adv: true },
    { key: 'hLL', label: 'EXPERIMENT: quadrant LL aim, degrees (h; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: -1, adv: true },
    { key: 'vLL', label: 'EXPERIMENT: quadrant LL aim, degrees (v; right and up positive)', type: 'number', min: -30, max: 30, step: 0.1, default: -0.5, adv: true },
    { key: 'xLow', label: 'EXPERIMENT: path length minus focus distance for the two LOWER quadrants (mm, 0 = xQ)', type: 'number', min: 0, max: 80, step: 1, default: 0, adv: true },
    { key: 'band', label: 'EXPERIMENT: height of the horizontal strip through the LED cut out of the quadrants and rebuilt as a paraboloid strip (mm, 0 = none)', type: 'number', min: 0, max: 40, step: 0.1, default: 0, adv: true },
    { key: 'bandP', label: 'EXPERIMENT: strip paraboloid focal length (mm, 0 = half the quadrant path offset)', type: 'number', min: 0, max: 40, step: 0.5, default: 0, adv: true },
    { key: 'bandTilt', label: 'EXPERIMENT: strip axis tilt, degrees down', type: 'number', min: -10, max: 10, step: 0.1, default: 0.5, adv: true },
    { key: 'xQ', label: 'EXPERIMENT: quadrant path length minus focus distance (mm, 0 = lcExtra)', type: 'number', min: 0, max: 80, step: 1, default: 0, adv: true },
    { key: 'xT', label: 'EXPERIMENT: top half path length minus focus distance (mm, 0 = lcExtra)', type: 'number', min: 0, max: 80, step: 1, default: 0, adv: true },
    { key: 'xB', label: 'EXPERIMENT: bottom half path length minus focus distance (mm, 0 = lcExtra)', type: 'number', min: 0, max: 80, step: 1, default: 0, adv: true },
    { key: 'gT', label: 'EXPERIMENT: top half horizontal/vertical vertex radius ratio', type: 'number', min: 0.5, max: 4, step: 0.01, default: 1, adv: true },
    { key: 'gB', label: 'EXPERIMENT: bottom half horizontal/vertical vertex radius ratio', type: 'number', min: 0.5, max: 4, step: 0.01, default: 1, adv: true },
    { key: 'lcExtra', label: 'EXPERIMENT: ellipsoid path length minus focus distance (mm, 0 = auto)', type: 'number', min: 0, max: 80, step: 1, default: 0, adv: true },
    { key: 'endFocus', label: 'Emitter-end focus (Liou 2009): a lens-path facet may take an emitter END as its first focus, so its image hangs on one side of the aim — images can sit on the cut-off line and the shield throws less light away (finalists only)', type: 'checkbox', default: true },
    { key: 'bypassReach', label: 'Largest angle from the LED axis (°) at which lens-feasible light may be given to bypass facets instead (60 = only what the lens path cannot use; ~100 = the whole equator band goes to big far mirrors: sharper images, more lumens and peak, less of a projector)', type: 'number', min: 0, max: 180, step: 5, default: 60, adv: true },
    { key: 'reflector', label: 'Reflector: facets (aimed ellipsoid patches) or one continuous ellipsoid (the classic projector cup; a single facet of the budget)', type: 'select', options: [{ value: 'facets', label: 'facets' }, { value: 'ellipsoid', label: 'one continuous ellipsoid' }], default: 'facets' },
    { key: 'shieldEff', label: 'Share of the lens-path flux that survives the shield (sizes the ideal beam)', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.8, adv: true },
    { key: 'lam', label: 'Placement waste penalty (0 = fill anywhere, 1 = never overshoot)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5, adv: true },
    { key: 'bypassMinEff', label: 'A bypass cell is dropped when less than this share of its light survives the lens/shield on a nominal aim', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4, adv: true },
    { key: 'polishRounds', label: 'Aim polish rounds (refresh footprints, slide the facets against the spec; 0 = off)', type: 'number', min: 0, max: 10, step: 1, default: 1 },
    { key: 'polishSweeps', label: 'Sweeps per polish round (each sweep tries four step sizes)', type: 'number', min: 1, max: 6, step: 1, default: 3, adv: true },
    { key: 'wBand', label: 'Polish weight of floor / ceiling violations', type: 'number', min: 0, step: 10, default: 150, adv: true },
    { key: 'wTrack', label: 'Polish weight of following the ideal beam', type: 'number', min: 0, step: 0.01, default: 0.03, adv: true },
    { key: 'decalGain', label: 'Decal flux margin over a sign-point floor', type: 'number', min: 0.5, max: 6, step: 0.1, default: 1.5, adv: true },
    { key: 'edgeTrust', label: 'How far (pixels of 0.1°) a facet that forms the cut-off edge may move in the polish', type: 'number', min: 0, max: 40, step: 1, default: 3, adv: true },
    { key: 'edgeSearch', label: 'Search the shield edge height (left / right) against the model', type: 'checkbox', default: true, adv: true },
    { key: 'finalists', label: 'Layouts that get the full treatment (edge search, polish)', type: 'number', min: 1, max: 6, step: 1, default: 3, adv: true },
    { key: 'verify', label: 'Let the engine (one 1 M-ray spec trace each) pick between the two best layouts', type: 'checkbox', default: true, adv: true },
    { key: 'keepTop', label: 'Layouts evaluated in full (the best by the cheap proxy)', type: 'number', min: 1, max: 40, step: 1, default: 6, adv: true },
    { key: 'verbose', label: 'Log progress to the console', type: 'checkbox', default: false, adv: true },
  ];

  function candidates(P, s) {
    const out = [], E = P.E, S0 = P.Lp, n = s.ior, shapes = s.lensShape === 'auto' ? ['flat-in', 'curve-in', 'biconvex'] : [s.lensShape === 'biconvex' ? 'biconvex' : s.lensShape];
    const fList = s.focal > 0 ? [s.focal] : [10, 13, 17, 21, 26, 33, 42, 54], hEnv = Math.min((E.ymax - E.ymin) / 2, (E.zmax - E.zmin) / 2) - 0.8;
    const variants = [];
    for (const sh of shapes) {
      if (sh === 'flat-in') for (const k of [-0.5, -0.8, -1.2]) variants.push({ kind: 'flat-in', k, beta: 0 });
      else if (sh === 'curve-in') variants.push({ kind: 'curve-in', k: -n * n, beta: 0 });
      else for (const k of [-1.6, -1]) variants.push({ kind: 'bi', k, beta: 0.7 });
    }
    const clampTo = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    for (const f of fList) for (const af of s.aperture > 0 ? [0] : [1, 0.75, 0.55]) {
      const a = s.aperture > 0 ? s.aperture : Math.min(0.9 * f, hEnv) * af; if (a < 3) continue;
      // the lens axis: through the LED's height where the lens fits there, else as close as it fits; also the middle and both ends of the envelope's height (a box with the LED on the floor)
      const yA = clampTo(S0[1], E.ymin + a + 0.8, E.ymax - a - 0.8), zs = [clampTo(S0[2], E.zmin + a + 0.8, E.zmax - a - 0.8), E.zmin + a + 0.8, (E.zmin + E.zmax) / 2, E.zmax - a - 0.8].filter((z, k, arr) => arr.findIndex((q) => Math.abs(q - z) < 0.5) === k);
      for (const v of variants) for (const back of [0, 6]) for (const zA of zs) out.push(Object.assign({ n, f, a, back, yA, zA }, v));
    }
    return out;
  }
  const lensMerit = (L) => { let sum = 0, w = 0; for (let i = 0; i <= 8; i++) { const m = L.map[i]; sum += m ? Math.min(m.blur, 8) + 8 * (1 - m.pass) : 8; w++; } return sum / w; };

  async function solve(input, s0, tools) {
    if (!input.spec) return { surfaces: [], notes: ['projector-v3 designs from a beam specification: switch to Spec mode (paint mode is not built yet; Fill & fix, SQM or Auto handle paint).'] };
    const S = Object.assign({}, P3.DEFAULTS, s0), notes = [], P = P3.problem(input, S, tools); const s = Object.assign({ depthPenalty: 0.35 }, s0);
    const budgetMs = tools && tools.budget && isFinite(tools.budget.ms) && tools.budget.ms > 0 ? tools.budget.ms : 120000, el = () => Date.now() - P.t0;      // the host's solve time limit; what is not finished by then is lost
    const Kmax = Math.min(P.maxF, s.facets > 0 ? s.facets : 300);
    const D = P3.dirs(P, S.nDirs); P.lap(`directions: ${D.n}, ${D.tot.toFixed(0)} lm`);
    // 1. layouts by the cheap proxy
    const cands = candidates(P, s), lays = [];
    for (const c of cands) { const lay = P3.placeLens(P, c); if (!lay) continue; const pk = P3.pickLb(P, lay, D, s); lay.Lb = (s.lcExtra > 0 ? lay.D + s.lcExtra : pk.Lb); lay.proxy = pk.proxy / (1 + lensMerit(lay.L) / 3); lays.push(lay); }
    lays.sort((a, b) => b.proxy - a.proxy); P.lap(`layouts: ${lays.length} of ${cands.length}` + (S.verbose ? '; rejected: ' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') : ''));
    if (S.verbose) for (const l of lays.slice(0, 40)) P.lap(`  proxy ${l.proxy.toFixed(3)} ${l.c.kind} k ${l.c.k.toFixed(2)} f ${l.f} a ${l.a.toFixed(1)} back ${l.c.back} D ${l.D.toFixed(0)} tanMax ${l.tanMax.toFixed(2)} merit ${lensMerit(l.L).toFixed(2)}`);
    // diversify: the best layout of each focal length first (the proxy likes long focal lengths; the model decides), then the rest by proxy
    const seen = new Set(), pick = []; for (const l of lays) { if (!seen.has(l.f)) { seen.add(l.f); pick.push(l); } } for (const l of lays) if (!pick.includes(l)) pick.push(l);
    if (!lays.length) return { surfaces: [], notes: ['projector-v3: no lens layout fits this envelope / LED position (' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') + ')'] };
    // 2. full designs for the best few
    const results = [];
    let slowest = 0;
    for (const lay of pick.slice(0, s.keepTop)) {
      if (results.length && el() + 1.3 * slowest > 0.4 * budgetMs) { notes.push(`time governor: ${results.length} of ${Math.min(pick.length, s.keepTop)} layouts evaluated`); break; }
      const t1 = el(), r = design(P, lay, D, s, Kmax); slowest = Math.max(slowest, el() - t1); if (!r) continue; results.push(r);
      if (results.length === 1 && tools && tools.preview) tools.preview(r.surfaces, { label: 'first draft', needs: { bounces: 3 } });      // display only
      P.lap(`  ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} a ${lay.a.toFixed(1)} back ${lay.c.back}: proxy ${lay.proxy.toFixed(3)} → model ${r.m.hard} fails, ${r.m.lm.toFixed(0)} lm, score ${r.m.score.toFixed(1)}, ${r.nL}+${r.nD} facets`);
    }
    if (!results.length) return { surfaces: [], notes: ['projector-v3: no layout produced a design'] };
    results.sort((a, b) => b.m.score - a.m.score);
    const fin = []; let slowF = 0; for (const r of results.slice(0, s.finalists)) { if (fin.length && el() + 1.3 * slowF > 0.8 * budgetMs) { notes.push(`time governor: ${fin.length} finalist(s)`); break; } const tF = el(), rf = design(P, r.lay, D, s, Kmax, true); slowF = Math.max(slowF, el() - tF); if (rf) { fin.push(rf); P.lap(`  FINAL ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} a ${r.lay.a.toFixed(1)}: model ${rf.m.hard} fails, ${rf.m.lm.toFixed(0)} lm, score ${rf.m.score.toFixed(1)}`); } }
    for (const r of fin) results.unshift(r); results.sort((a, b) => b.m.score - a.m.score);
    // the model does not see direct / stray light: the engine breaks ties between the best finalists (one guided 1 M-ray spec trace each, ~3 s)
    if (s.verify && tools && typeof tools.trace === 'function' && fin.length > 1 && el() < 0.8 * budgetMs) {
      const top = results.slice(0, 2);
      for (const r of top) { try { const t = await tools.trace(r.surfaces, { rays: 1e6, spec: true, bounces: 3, seed: 11 }); r.tr = t && t.spec ? t.spec : null; } catch (e) { r.tr = null; } }
      if (top.every((r) => r.tr)) { top.sort((a, b) => (a.tr.n.fail - b.tr.n.fail) || (b.tr.score - a.tr.score)); results.splice(results.indexOf(top[0]), 1); results.unshift(top[0]); notes.push('engine check of the two best (1 M rays): ' + top.map((r) => `f ${r.lay.f} → ${r.tr.n.fail} fail / ${r.tr.n.unsure} unsure, score ${r.tr.score.toFixed(3)}`).join('; ')); }
    }
    const best = results[0], lay = best.lay;
    for (const r of results.slice(0, 5)) notes.push(`candidate ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} Ø${(2 * r.lay.a).toFixed(0)}: model ${r.m.hard} fail / ${r.m.ev.n.unsure} unsure, ${r.m.lm.toFixed(0)} lm, ${r.facets.length} facets`);
    notes.push(`chosen: lens ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} mm Ø${(2 * lay.a).toFixed(1)} t ${lay.L.t.toFixed(1)}, focus ${lay.D.toFixed(0)} mm ahead of the LED; ${best.nL} lens-path (${best.nEnd || 0} on an emitter end) + ${best.nD} bypass facets (${best.nDecal} decals) at ${best.depthRange}; ideal beam asks ${best.des.flux.toFixed(0)} lm (lens path can give ${best.availL.toFixed(0)}, bypass ${best.availD.toFixed(0)})`);
    notes.push('model loss ledger (lm leaving the facets): ' + Object.entries(best.stats).map(([k, v]) => k + ' ' + v.toFixed(0)).join(', '));
    notes.push(`model verdict: ${best.m.ev.verdict} ${JSON.stringify(best.m.ev.n)}, ${best.m.lm.toFixed(0)} lm in window (reflections only; direct and stray light are not in the model)`);
    return { surfaces: best.surfaces, notes, needs: { bounces: 3 + (s.fresnel ? 2 : 0) } };
  }

  // the reference rung: ONE ellipsoid of revolution as the whole reflector (patches on the same ellipsoid, aimed at the focus, stand in for it in the model)
  function designEllipsoid(P, lay, s, cells, full) {
    const cap = P3.ellipsoidCap(P, lay); if (!cap) return null;
    let capSurf = [cap.surface]; const halfMode = s.half && s.half !== 'whole' ? s.half : null;
    if (halfMode === 'quad') {
      capSurf = []; const xq = s.xQ > 0 ? s.xQ : lay.Lb - lay.D;
      let rminQ = 1e9, depthQ = 1e9;
      for (const [nm, qi, ah, av] of [['UL', 0, s.hUL, s.vUL], ['UR', 1, s.hUR, s.vUR], ['LR', 2, s.hLR, s.vLR], ['LL', 3, s.hLL, s.vLL]]) {
        const F2 = P3.imgPoint(P, lay, ah, av, 0), layH = Object.assign({}, lay, { F: F2, D: V.dist(P.Lp, F2) }), c2 = P3.ellipsoidCap(P, layH, { Lc: layH.D + ((nm === 'LL' || nm === 'LR') && s.xLow > 0 ? s.xLow : xq) }); if (!c2) continue;
        const ae = c2.Lc / 2, up = V.sub([0, 0, 1], V.mul(c2.W, c2.W[2])), eV = V.mul(up, 1 / V.len(up)), eH = V.cross(eV, c2.W); rminQ = Math.min(rminQ, c2.r1); depthQ = Math.min(depthQ, ae * (1 - Math.sqrt(Math.max(0, 1 - c2.r1 * c2.r1 / (c2.R * ae)))));
        let poly = [[0, 0]]; for (let i = 0; i <= 12; i++) { const th = Math.PI / 2 * (qi + i / 12); poly.push([c2.r1 * Math.cos(th), c2.r1 * Math.sin(th)]); }
        if (s.band > 0) {                                  // the horizontal band through the filament plane belongs to the strip: keep v >= hb (upper quadrants) or v <= -hb (lower)
          const hb = s.band / 2, sg = qi < 2 ? 1 : -1, out = []; for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length], fa = sg * a[1] - hb, fb = sg * b[1] - hb; if (fa >= 0) out.push(a); if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } } poly = out;
        }
        if (poly.length < 3) continue; const pts3 = poly.map((q) => V.add(c2.O, V.add(V.mul(eH, q[0]), V.mul(eV, q[1]))));
        capSurf.push({ type: 'quad', id: 'p3_ellipsoid_' + nm, P: c2.O, n: c2.W, ref: eH, curv: [1 / c2.R, 1 / c2.R, 0, 1 / ae], clip: { kind: 'poly', pts3 }, front: 1, optics: { interaction: 'reflect', reflectivity: P.refl } });
      }
      if (s.band > 0 && rminQ < 1e8) {                   // the strip: a paraboloid with the LED at its focus (collimates), axis tilted bandTilt degrees down; the lens turns lateral position into horizontal angle
        const p = s.bandP > 0 ? s.bandP : xq / 2, al = (s.bandTilt || 0) * Math.PI / 180, W = [Math.cos(al), 0, -Math.sin(al)], O = V.sub(P.Lp, V.mul(W, p)), up = V.sub([0, 0, 1], V.mul(W, W[2])), eV = V.mul(up, 1 / V.len(up)), eH = V.cross(eV, W), hb = s.band / 2, rr = Math.min(Math.sqrt(4 * p * depthQ), 44), fa = Math.asin(Math.min(1, hb / rr)), poly = [];
        for (let i = 0; i <= 12; i++) { const th = -fa + 2 * fa * i / 12; poly.push([rr * Math.cos(th), rr * Math.sin(th)]); } for (let i = 0; i <= 12; i++) { const th = Math.PI - fa + 2 * fa * i / 12; poly.push([rr * Math.cos(th), rr * Math.sin(th)]); }
        capSurf.push({ type: 'quad', id: 'p3_strip', P: O, n: W, ref: eH, curv: [1 / (2 * p), 1 / (2 * p), 0, 0], clip: { kind: 'poly', pts3: poly.map((q) => V.add(O, V.add(V.mul(eH, q[0]), V.mul(eV, q[1])))) }, front: 1, optics: { interaction: 'reflect', reflectivity: P.refl } });
      }
      if (!capSurf.length) return null;
    } else if (halfMode) {
      capSurf = []; const baseX = lay.Lb - lay.D;
      for (const sd of (halfMode === 'both' ? ['top', 'bottom'] : [halfMode])) {
        const x = (sd === 'top' ? s.xT : s.xB) > 0 ? (sd === 'top' ? s.xT : s.xB) : baseX, g = sd === 'top' ? s.gT : s.gB, dz = sd === 'top' ? s.dT : s.dB, W0 = V.norm(V.sub(lay.F, P.Lp)), F2 = V.add(lay.F, V.mul(W0, dz)), layH = Object.assign({}, lay, { F: F2, D: V.dist(P.Lp, F2) }), c2 = P3.ellipsoidCap(P, layH, { Lc: layH.D + x }); if (!c2) continue;
        const ae = c2.Lc / 2, up = V.sub([0, 0, 1], V.mul(c2.W, c2.W[2])), eV = V.mul(up, 1 / V.len(up)), eH = V.cross(eV, c2.W), r = c2.r1, rxh = Math.min(0.985 * Math.sqrt(ae * c2.R * g), 44), pts3 = [];
        for (let i = 0; i <= 24; i++) { const th = Math.PI * i / 24 * (sd === 'top' ? 1 : -1); pts3.push(V.add(c2.O, V.add(V.mul(eH, rxh * Math.cos(th)), V.mul(eV, r * Math.sin(th))))); }
        capSurf.push({ type: 'quad', id: 'p3_ellipsoid_' + sd, P: c2.O, n: c2.W, ref: eH, curv: [1 / (c2.R * g), 1 / c2.R, 0, 1 / ae], clip: { kind: 'poly', pts3 }, front: 1, optics: { interaction: 'reflect', reflectivity: P.refl } });
      }
      if (!capSurf.length) return null;
    }
    const rad = (X) => { const w = V.sub(X, cap.O), z = V.dot(w, cap.W); return Math.hypot(w[0] - z * cap.W[0], w[1] - z * cap.W[1], w[2] - z * cap.W[2]); };
    const facets = []; cells.forEach((c, k) => { if (rad(c.P) > cap.r1 * 0.995) return; if (halfMode === 'top' && c.P[2] <= P.Lp[2]) return; if (halfMode === 'bottom' && c.P[2] > P.Lp[2]) return; const f = P3.facetOf(P, lay, c, lay.F, 'p3_f' + k); if (f) { f.cls = 'L'; facets.push(f); } });
    if (!facets.length) return null;
    let shield = P3.shieldFor(P, lay, s, 0), edge = { L: 0, R: 0 };
    const score = (sh) => { const m = P3.evaluate(P, lay, sh, facets, 16); return { m, sc: m.score }; };
    if (full && P.cut && s.shield !== 'off' && s.edgeSearch) {
      let bR = { v: 0, sc: score(shield).sc }; for (const dR of [0.15, 0.3, 0.5, 0.75, 1.0, -0.15]) { const r = score(P3.shieldFor(P, lay, s, { L: 0, R: dR })); if (r.sc > bR.sc) bR = { v: dR, sc: r.sc }; }
      let bL = { v: 0, sc: bR.sc }; for (const dL of [0.1, 0.2, 0.35, -0.1]) { const r = score(P3.shieldFor(P, lay, s, { L: dL, R: bR.v })); if (r.sc > bL.sc) bL = { v: dL, sc: r.sc }; }
      edge = { L: bL.v, R: bR.v }; shield = P3.shieldFor(P, lay, s, edge);
    }
    const stats = {}, m = P3.evaluate(P, lay, shield, facets, 24, stats);
    return { lay, facets, nL: 1, nD: 0, nDecal: 0, shield, des: { flux: 0 }, m, stats, availL: 0, availD: 0, surfaces: P3.surfacesOf(P, lay, shield, capSurf, s), depthRange: `one ellipsoid, path length ${cap.Lc.toFixed(0)} mm, rim radius ${cap.r1.toFixed(0)} mm (${facets.length} model patches)` };
  }

  // one full design for one layout
  function design(P, lay, D, s, Kmax, full) {
    const G = P.gridA, GB = P.gridB, top = P.cut ? P.cut.top : () => 5, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const okL = new Uint8Array(D.n); let fluxL = 0;
    const dkAll = s.bypass === 'off' || s.reflector === 'ellipsoid' || !(s.bypassReach > 60) ? null : P3.directOk(P, lay, D, s, null);      // directions that COULD go to a bypass facet
    for (let i = 0; i < D.n; i++) if (D.w[i] > 0 && D.rEnv[i] > P.keep + 1.5 && P3.depthChoice(P, lay, P3.dirAt(D, i), D.rEnv[i], null, lay.Lb, true, s)) {
      if (dkAll && dkAll.ok[i] && Math.acos(Math.max(-1, Math.min(1, D.u[3 * i]))) / D2R <= s.bypassReach) continue;      // reassigned to the bypass class
      okL[i] = 1; fluxL += D.w[i];
    }
    const dk = s.bypass === 'off' || s.reflector === 'ellipsoid' ? null : P3.directOk(P, lay, D, s, okL); let KD = 0, Kdec = 0;
    const seeds0 = []; if (dk && P.cut) for (const it of P.spec.items) { const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : null; if (!pts || !(it.min > 0)) continue; for (const [h, v] of pts) if (v > top(h) + 0.3) seeds0.push(1); }
    if (dk && dk.flux > 0.03 * D.tot) { Kdec = Math.min(seeds0.length, Math.floor(Kmax * 0.15)); KD = clamp(Math.round((Kmax - Kdec) * dk.flux / (dk.flux + fluxL) * 0.5), 3, Math.floor(Kmax * 0.4)) + Kdec; }
    const cenL = P3.kmeansSphere(D, okL, Kmax - KD, 14, 2), cenD = KD ? P3.kmeansSphere(D, dk.ok, KD, 14, 2) : [];
    const cellsL = P3.makeCells(P, lay, D, okL, Kmax - KD, s, cenL, cenD), cellsD = KD ? P3.makeCellsDirect(P, lay, D, dk, KD, s, cenD, cenL) : [];
    if (P.S.verbose) { const bins = new Array(12).fill(0).map(() => [0, 0, 0]); for (let i = 0; i < D.n; i++) { const th = Math.acos(Math.max(-1, Math.min(1, D.u[3 * i]))) / D2R, b = Math.min(11, Math.floor(th / 15)); bins[b][okL[i] ? 0 : dk && dk.ok[i] ? 1 : 2] += D.w[i]; } P.lap('    flux by angle from the axis (15° bins), lens-path / bypass-eligible / unused lm: ' + bins.map((b, k) => `${k * 15}°:${b.map((x) => x.toFixed(0)).join('/')}`).join('  ')); }
    P.lap(`    lens-feasible ${fluxL.toFixed(0)} lm, bypass-eligible ${dk ? dk.flux.toFixed(0) : 0} lm → KD ${KD}; cells L ${cellsL.length} D ${cellsD.length}`);
    if (!cellsL.length) return null;
    // footprints at a nominal aim (translation-invariant shapes); lens-path ones unshielded (the shield is applied as a mask in the placement)
    const h0 = 0, v0 = top(0) - 3, I0 = P3.imgPoint(P, lay, h0, v0, 0), postL = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: null });
    const shield0 = P3.shieldFor(P, lay, s), postFull0 = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield0 });
    const cL = [], fpL = [], ends = full && s.endFocus ? P3.sourceEnds(P) : [], S0s = [null].concat(ends);       // alternatives per cell: the LED centre, then each emitter end
    for (const c of cellsL) {
      const alts = []; for (const S0 of S0s) { const f = P3.facetOf(P, lay, c, I0, 'tmp', S0); const fp = f ? P3.footOf(P, f, postL, G, 16) : null; alts.push(fp); }
      if (!alts[0]) continue; cL.push(c); fpL.push(alts.map((x, a) => (x ? Object.assign(x, { s0: S0s[a], alt: a }) : null)).filter(Boolean));
    }
    const cD = [], fpD = [];
    for (const c of cellsD) { const f = P3.facetDirect(P, lay, c, 0, -3, 'tmp'); if (!f) { P.lap('      bypass cell dropped: no polygon'); continue; } const fp = P3.footOf(P, f, postFull0, G, 16); if (!fp || fp.flux < s.bypassMinEff * P.refl * c.fit) { P.lap(`      bypass cell dropped: ${fp ? 'efficiency ' + (fp.flux / (P.refl * c.fit)).toFixed(2) : 'no footprint'}`); continue; } cD.push(c); fpD.push(fp); }
    if (!cL.length) return null;
    if (s.reflector === 'ellipsoid') return designEllipsoid(P, lay, s, cL, full);
    const availL = fpL.reduce((x, f) => x + f[0].flux, 0), availD = fpD.reduce((x, f) => x + f.flux, 0);
    const des = T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: s.fluxFrac * (s.shieldEff * availL + availD), peakCap: P.S.peakCap, washCap: P.S.washCap, gd: P.S.gd, guard: 0, guardLift: 0, cut: P.cut || null, road: { gamma: 0.8 } });
    // the shield edge follows the ideal beam's plateau edge (its cut-off line shifted down by the edge search's dTop), not the bare line
    const dTop = (des.edge && des.edge.dTop) || 0, shield1 = P3.shieldFor(P, lay, s, dTop), postFull = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield1 });
    // lens-path placement: the shield mask, the lens field, the aperture
    const resid = P3.coarse(P, des.T, G), mask = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < G.nv; j++) { const v = G.v0 + (j + 0.5) * G.step; for (let i = 0; i < G.nh; i++) { const h = G.h0 + (i + 0.5) * G.step; mask[j * G.nh + i] = (P.cut && s.shield !== 'off' ? clamp((top(h) - dTop - v) / G.step + 0.5, 0, 1) : 1) * (Math.abs(h) <= s.spread && v >= -20 ? 1 : 0); } }
    const aimOf = (fp, h, v) => [h - (fp.hc - h0), v - (fp.vc - v0)];
    const lensI = (aim) => P3.imgPoint(P, lay, aim[0], Math.min(aim[1], top(aim[0]) - 0.05), 0);
    const orderL = cL.map((_, k) => k).sort((a, b) => fpL[b][0].sh * fpL[b][0].sv - fpL[a][0].sh * fpL[a][0].sv);
    const plL = P3.greedy(G, fpL, resid, mask, { order: orderL, lam: s.lam, top: 40, allowed: (h, v, fp, k) => { const a = aimOf(fp, h, v); return Math.abs(a[0]) <= s.spread && P3.entersLens(lay, cL[k].P, lensI(a)); } });
    const recL = plL.filter((r) => r.h !== null).map((r) => ({ k: r.k, alt: r.alt, aim: aimOf(fpL[r.k][r.alt], r.h, r.v) }));
    const lensFacet = (rec, id) => P3.facetOf(P, lay, cL[rec.k], lensI(rec.aim), id, fpL[rec.k][rec.alt].s0);
    // bypass: decals for the floors above the cut-off (small facets: flux ∝ area), then the rest of the cells by greedy placement of Gaussian footprints of several widths
    const widths = [0, 1.5, 3, 5], recD = [], recDec = [], D2 = D2R * D2R;
    if (cD.length) {
      const seeds = []; if (P.cut) for (const it of P.spec.items) { const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : null; if (!pts || !(it.min > 0)) continue; for (const [h, v] of pts) if (v > top(h) + 0.3) seeds.push({ h, v, lo: it.kind === 'sum' ? it.min / it.pts.length : it.min }); }
      const byFlux = cD.map((_, k) => k).sort((a, b) => fpD[a].flux - fpD[b].flux), used = new Set();
      for (const sd of seeds) { if (used.size >= cD.length - 1) break; const k = byFlux.find((x) => !used.has(x)); used.add(k); const fp = fpD[k], need = s.decalGain * sd.lo * 2 * Math.PI * fp.sh * fp.sv * D2; recDec.push({ k, aim: [sd.h, sd.v], w: 0, scale: Math.min(1, need / fp.flux) }); }
      const resB = new Float64Array(GB.nh * GB.nv), defB = new Float64Array(GB.nh * GB.nv), kk = Math.round(GB.step / G.step), bA0 = P3.aggBands(P, G, des.T);
      // the lens path's delivered field so far = ideal beam − residual; the floors it leaves unmet (per 0.5° bin) are the bypass facets' FIRST job
      for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) { const p = j * G.nh + i, q = Math.min(GB.nv - 1, (j / kk) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kk) | 0); resB[q] += resid[p]; const T = bA0.T[p] * G.om[p], got = T - resid[p], need = bA0.lo[p] * G.om[p]; if (need > got) defB[q] += need - got; }
      const rest = cD.map((_, k) => k).filter((k) => !used.has(k)), altsD = fpD.map((fp) => widths.map((w) => P3.gaussFoot(GB, fp.flux, Math.sqrt(fp.sh * fp.sh + w * w), Math.sqrt(fp.sv * fp.sv + w * w))));
      const nFirst = Math.min(rest.length, Math.max(2, Math.round(rest.length * 0.5))), first = rest.slice().sort((a, b) => fpD[a].flux - fpD[b].flux).slice(0, nFirst), later = rest.filter((k) => !first.includes(k));
      const plD1 = P3.greedy(GB, altsD, defB, null, { order: first, lam: 0.2, top: 40 });          // small facets first: dim floors need modest flux
      for (const r of plD1) if (r.h !== null && r.delivered > 0) { recD.push({ k: r.k, aim: [r.h, r.v], w: r.alt, scale: 1 }); for (let q = 0; q < resB.length; q++) { } }
      const placed = new Set(recD.map((r) => r.k)); for (const k of first) if (!placed.has(k)) later.push(k);
      const plD = P3.greedy(GB, altsD, resB, null, { order: later.sort((a, b) => fpD[b].flux - fpD[a].flux), lam: s.lam, top: 40 });
      for (const r of plD) if (r.h !== null) recD.push({ k: r.k, aim: [r.h, r.v], w: r.alt, scale: 1 });
    }
    const dFacet = (rec, id) => P3.facetDirect(P, lay, cD[rec.k], rec.aim[0], rec.aim[1], id, widths[rec.w] > 0 ? [widths[rec.w] ** 2, 0, widths[rec.w] ** 2] : null, rec.scale);
    const buildAll = () => { const out = []; let n = 0; for (const rec of recL) { const f = lensFacet(rec, 'p3_f' + n++); if (f) { f.cls = 'L'; out.push(f); } } n = 0; for (const rec of recD.concat(recDec)) { const f = dFacet(rec, 'p3_d' + n++); if (f) { f.cls = 'D'; out.push(f); } } return out; };

    // the shield edge's height is tuned against the model: images are far wider than the ideal beam's edge blur, so the realised edge sits where the shield cuts them
    let shield = shield1, edgeNote = '';
    if (full && P.cut && s.shield !== 'off' && s.edgeSearch) {
      const score = (sh) => { const fs = buildAll(), m = P3.evaluate(P, lay, sh, fs, 16); return { m, sc: m.score + 0.0005 * m.lm }; };
      let bestR = { v: dTop, ...score(shield1) }; for (const dR of [dTop + 0.15, dTop + 0.3, dTop + 0.5, dTop + 0.75, dTop + 1.0, dTop - 0.15]) { const r = score(P3.shieldFor(P, lay, s, { L: dTop, R: dR })); if (r.sc > bestR.sc) bestR = { v: dR, ...r }; }
      let bestL = { v: dTop, sc: bestR.sc }; for (const dL of [dTop + 0.1, dTop + 0.2, dTop + 0.35, dTop - 0.1]) { const r = score(P3.shieldFor(P, lay, s, { L: dL, R: bestR.v })); if (r.sc > bestL.sc) bestL = { v: dL, sc: r.sc }; }
      shield = P3.shieldFor(P, lay, s, { L: bestL.v, R: bestR.v }); edgeNote = `edge shift L ${bestL.v.toFixed(2)}° R ${bestR.v.toFixed(2)}°`; P.lap('    ' + edgeNote);
    }
    // polish rounds: refresh every footprint at its current aim, slide the L facets (shield mask) and the bypass facets against the spec's floors and ceilings, rebuild; keep the best by the model
    const wmul = new Float64Array(P.g.n).fill(1); let bandA = P3.aggBands(P, G, des.T, wmul), bandB = P3.aggBands(P, GB, des.T, wmul); let pk = 0; for (const x of des.T) if (x > pk) pk = x;
    const popt = { wBand: s.wBand, wTrack: s.wTrack, tref: Math.max(200, 0.03 * pk), sweeps: s.polishSweeps };
    let best = null; const log = [];
    const rounds = full ? s.polishRounds : 0;
    for (let round = 0; round <= rounds; round++) {
      const facets = buildAll(), stats = {}, m = P3.evaluate(P, lay, shield, facets, 24, stats); log.push(`${m.hard}f/${m.ev.n.unsure}u ${m.lm.toFixed(0)}lm`); if (P.S.verbose) P.lap(`      round ${round} fails: ` + m.ev.rows.filter((r) => r.verdict === 'fail').map((r) => `${r.name} ${(+r.value).toPrecision(3)}${r.isMin ? '<' : '>'}${(+r.bound).toPrecision(3)}`).join(' | '));
      if (!best || m.score > best.m.score) best = { facets, m, stats };
      if (round === rounds) break;
      // the judge's verdict feeds back: every failing / unsure row weighs more in the next round (rows with a pixel set; the cut-off rows are protected by holding edge facets near their place)
      for (const r of m.ev.rows) if (r.verdict !== 'pass') { const br = P.B.rows.find((x) => x.name === r.name && x.px); if (br) for (const q of br.px) wmul[q] = Math.min(64, wmul[q] * 4); }
      bandA = P3.aggBands(P, G, des.T, wmul); bandB = P3.aggBands(P, GB, des.T, wmul);
      // ---- L polish
      const fps = recL.map((rec) => { const f = lensFacet(rec, 'tmp'); const fp = f ? P3.footOf(P, f, postL, G, 16) : null; if (fp) rec.dl = [fp.hc - rec.aim[0], fp.vc - rec.aim[1]]; return fp; });
      const posL = fps.map((fp) => (fp ? [fp.ri, fp.rj] : null)), kb = Math.round(GB.step / G.step);
      const EDB = new Float64Array(GB.nh * GB.nv); for (const rec of recD) { const fp = P3.gaussFoot(GB, fpD[rec.k].flux, Math.sqrt(fpD[rec.k].sh ** 2 + widths[rec.w] ** 2), Math.sqrt(fpD[rec.k].sv ** 2 + widths[rec.w] ** 2)), c = P3.pixOf(GB, rec.aim[0], rec.aim[1]); for (let q = 0; q < fp.n; q++) { const i = c[0] + fp.di[q], j = c[1] + fp.dj[q]; if (i >= 0 && j >= 0 && i < GB.nh && j < GB.nv) EDB[j * GB.nh + i] += fp.val[q]; } }
      const EDA = new Float64Array(G.nh * G.nv); for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) EDA[j * G.nh + i] = EDB[Math.min(GB.nv - 1, (j / kb) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kb) | 0)] / (kb * kb);
      const r1 = P3.polish(G, fps, posL, mask, bandA, EDA, Object.assign({ steps: [8, 4, 2, 1], trust: 40, trustOf: (k) => { const rec = recL[k], fp = fps[k], h = fp.hc, v = fp.vc, e = top(h) - dTop; return Math.abs(v - e) < 2 * fp.sv + 0.5 ? s.edgeTrust : 40; }, allowed: (ci, cj, k) => { const rec = recL[k], h = G.h0 + (ci + 0.5) * G.step - rec.dl[0], v = G.v0 + (cj + 0.5) * G.step - rec.dl[1]; return Math.abs(h) <= s.spread && P3.entersLens(lay, cL[rec.k].P, lensI([h, v])); } }, popt));
      if (P.S.verbose) P.lap(`      L polish: cost ${r1.before.toFixed(0)} → ${r1.after.toFixed(0)}, ${r1.moves} moves of ${recL.length}`);
      recL.forEach((rec, i) => { if (posL[i]) rec.aim = [G.h0 + (posL[i][0] + 0.5) * G.step - rec.dl[0], G.v0 + (posL[i][1] + 0.5) * G.step - rec.dl[1]]; });
      // ---- bypass polish (the lens path's field, aggregated, is fixed)
      if (recD.length) {
        const EL = new Float64Array(GB.nh * GB.nv), fl = (() => { const E = new Float64Array(G.nh * G.nv); recL.forEach((rec, i) => { const fp = fps[i]; if (!fp || !posL[i]) return; for (let q = 0; q < fp.n; q++) { const ii = posL[i][0] + fp.di[q], jj = posL[i][1] + fp.dj[q]; if (ii >= 0 && jj >= 0 && ii < G.nh && jj < G.nv) E[jj * G.nh + ii] += fp.val[q] * mask[jj * G.nh + ii]; } }); return E; })();
        for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) EL[Math.min(GB.nv - 1, (j / kb) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kb) | 0)] += fl[j * G.nh + i];
        const altsD = recD.map((rec) => widths.map((w) => P3.gaussFoot(GB, fpD[rec.k].flux, Math.sqrt(fpD[rec.k].sh ** 2 + w * w), Math.sqrt(fpD[rec.k].sv ** 2 + w * w)))), posD = recD.map((rec) => { const c = P3.pixOf(GB, rec.aim[0], rec.aim[1]); return [c[0], c[1], rec.w]; });
        const r2 = P3.polish(GB, altsD, posD, null, bandB, EL, Object.assign({ steps: [4, 2, 1], trust: 30 }, popt, { wTrack: s.wTrack }));
        if (P.S.verbose) P.lap(`      D polish: cost ${r2.before.toFixed(0)} → ${r2.after.toFixed(0)}, ${r2.moves} moves of ${recD.length}`);
        recD.forEach((rec, i) => { rec.aim = [GB.h0 + (posD[i][0] + 0.5) * GB.step, GB.v0 + (posD[i][1] + 0.5) * GB.step]; rec.w = posD[i][2]; });
      }
    }
    P.lap(`    polish rounds (model fails/unsure, lm): ${log.join(' → ')}`);
    const facets = best.facets, nL = facets.filter((f) => f.cls === 'L').length, nD = facets.length - nL;
    if (!facets.length) return null;
    const rr = facets.map((f) => V.dist(f.P, P.Lp));
    return { lay, cellsL: cL, cellsD: cD, facets, nL, nD, nDecal: recDec.length, nEnd: facets.filter((f) => f.cls === 'L' && V.dist(f.S0, P.Lp) > 0.01).length, shield, des, m: best.m, stats: best.stats, availL, availD, surfaces: P3.surfacesOf(P, lay, shield, facets, s), depthRange: `${Math.min(...rr).toFixed(0)}–${Math.max(...rr).toFixed(0)} mm (median ${rr.slice().sort((x, y) => x - y)[rr.length >> 1].toFixed(0)}) from the LED` };
  }

  RF.Solvers.register({ id: 'projector-v3', name: 'Projector module v3 (experimental)', version: '0.1', modes: ['paint'], settings: SETTINGS, solve });
})();

})(Object.assign(Object.create(globalThis), { RF: Object.create(globalThis.RF) }));
