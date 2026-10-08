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
