/* geometry.js — optical surface primitives, compilation to a flat typed array, exact
 * ray/surface intersection, BVH, and the constraint envelope.
 *
 * ONE primitive underlies every optical surface: a QUADRIC  X^T Q X + L.X + K = 0  expressed in
 * the surface's own local frame, clipped by an aperture.  Planes, spheres, cones, cylinders,
 * ellipsoids and paraboloids are all quadrics, so intersection is always an exact quadratic
 * root (no paraxial approximation, no tessellation of curved facets).
 *
 * Surface kinds in the (serialisable) scene state:
 *   facet — a reflector segment defined by design intent: centre P, design source point S0,
 *           aim point Z, and an image distance di.  flat → the plane through P whose normal is
 *           the bisector.  curved → the exact ellipsoid of revolution with foci S0 and the
 *           image point I = P + di·â (paraboloid when di = ∞).  Its normal at P is the same
 *           bisector, so the aim is identical and only the tile size changes.
 *   plane — flat patch with an explicit normal (extrusions, azimuthally faceted revolves).
 *   rev   — a segment of a surface of revolution about an axis: line segment in (r,z)
 *           → cone frustum / cylinder / annulus;  arc → spherical zone (lens caps).
 *
 * Faces: every surface has a FRONT side.  Convention (documented in README):
 *   reflect: front reflects; a ray hitting the BACK is absorbed unless twoSided is set.
 *   refract: front = the low-index (air) side, back = inside the glass.
 *   absorb : both faces absorb.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, M3 } = RF;

  const STRIDE = 40;
  const CLIP = { rect: 0, disc: 1, poly: 2, ring: 3 };
  const INTER = { reflect: 0, refract: 1, absorb: 2 };
  const INTER_NAMES = ['reflect', 'refract', 'absorb'];
  const DEFAULT_OPTICS = { interaction: 'reflect', reflectivity: 0.9, ior: 1.49, fresnelT: 0.96, twoSided: false };

  // ---------------------------------------------------------------- facet design → quadric
  /* Facet normal = bisector.  Law of reflection r = d − 2(d·n)n with d = −ŝ (the incoming ray
   * travels source→facet, ŝ = unit(S0−P)) and r = â (we want it to leave toward the aim,
   * â = unit(Z−P)).  Rearranged: d − r = 2(d·n)n, so n ∥ d − r = −(ŝ + â).  Hence the facet
   * normal is the bisector of the two unit vectors pointing from the facet to the source and
   * to the aim point; we orient it toward the source (the reflecting side).
   *
   * Curved facets: the ellipsoid with foci S0 and I passes through P and (reflective property
   * of the ellipse) sends every ray from S0 to I — exact stigmatic imaging of the design point.
   * Its normal at P bisects the directions to the two foci, i.e. the same bisector.
   * Written relative to P (so the numbers stay well conditioned) and divided by a² (a = semi-
   * major axis); the eccentricity term is computed without cancellation so di → ∞ goes smoothly
   * to the paraboloid (collimating facet).  Returns world-aligned {A (3×3), b} with K = 0,
   * normalised so |b| = 1 (the gradient at P).                                              */
  function facetQuadric(P, S0, Z, di) {
    const sv = V.sub(S0, P), r = V.len(sv), sh = V.mul(sv, 1 / r);
    const ah = V.norm(V.sub(Z, P));
    const n = V.norm(V.add(sh, ah));
    if (di === null || di === undefined || !(di > 0)) {
      return { n, A: [0, 0, 0, 0, 0, 0, 0, 0, 0], b: n.slice(), flat: true };
    }
    const as = V.dot(ah, sh);
    const F1 = sv;
    let A, b;
    if (!isFinite(di)) {
      const u = ah;
      const F1p = V.sub(F1, V.mul(u, V.dot(F1, u)));
      A = M3.addScaled(M3.identity(), M3.outer(u, u), -1);
      b = V.add(V.mul(F1p, -2), V.mul(u, -2 * r * (1 + as)));
    } else {
      const F2 = V.mul(ah, di);
      const d = V.sub(F2, F1), twoc = V.len(d), u = V.mul(d, 1 / twoc);
      const c = twoc / 2, a = (r + di) / 2;
      const amc = r * di * (1 + as) / (r + di + twoc);   // a − c without cancellation
      const ome = amc * (a + c) / (a * a);                // 1 − e²
      const Cu = (V.dot(F1, u) + V.dot(F2, u)) / 2;
      const F1p = V.sub(F1, V.mul(u, V.dot(F1, u)));
      A = M3.addScaled(M3.identity(), M3.outer(u, u), -(1 - ome));
      b = V.add(V.mul(F1p, -2), V.mul(u, -2 * ome * Cu));
    }
    const s = 1 / V.len(b);
    return { n, A: M3.scale(A, s), b: V.mul(b, s), flat: false };
  }

  // Roots of a world-aligned quadric (relative to origin P) along ray o + t d.
  function quadricRay(A, b, P, o, d) {
    const x = V.sub(o, P);
    const Ad = [A[0] * d[0] + A[1] * d[1] + A[2] * d[2], A[3] * d[0] + A[4] * d[1] + A[5] * d[2], A[6] * d[0] + A[7] * d[1] + A[8] * d[2]];
    const Ax = [A[0] * x[0] + A[1] * x[1] + A[2] * x[2], A[3] * x[0] + A[4] * x[1] + A[5] * x[2], A[6] * x[0] + A[7] * x[1] + A[8] * x[2]];
    return RF.U.quadRoots(V.dot(d, Ad), 2 * V.dot(x, Ad) + V.dot(b, d), V.dot(x, Ax) + V.dot(b, x));
  }

  // ---------------------------------------------------------------- compile one surface
  function writeFrame(D, o, P, ex, ey, ez) {
    D[o] = P[0]; D[o + 1] = P[1]; D[o + 2] = P[2];
    D[o + 3] = ex[0]; D[o + 4] = ex[1]; D[o + 5] = ex[2];
    D[o + 6] = ey[0]; D[o + 7] = ey[1]; D[o + 8] = ey[2];
    D[o + 9] = ez[0]; D[o + 10] = ez[1]; D[o + 11] = ez[2];
  }
  function writeQuadric(D, o, Q, L, K) {
    // Q row-major symmetric 3×3 → xx, yy, zz, xy, xz, yz
    D[o + 12] = Q[0]; D[o + 13] = Q[4]; D[o + 14] = Q[8];
    D[o + 15] = Q[1]; D[o + 16] = Q[2]; D[o + 17] = Q[5];
    D[o + 18] = L[0]; D[o + 19] = L[1]; D[o + 20] = L[2]; D[o + 21] = K;
    const flat = Q.every((q) => q === 0);
    D[o + 34] = flat ? 1 : 0;
  }
  function writeOptics(D, o, opt) {
    const op = Object.assign({}, DEFAULT_OPTICS, opt || {});
    D[o + 28] = INTER[op.interaction] !== undefined ? INTER[op.interaction] : 0;
    D[o + 29] = op.reflectivity; D[o + 30] = op.ior; D[o + 31] = op.fresnelT;
    D[o + 32] = op.twoSided ? 1 : 0;
  }
  function tieKey(id) {           // numeric key from the stable surface id, for exact-tie breaking
    let h = 0x9e3779b9 | 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = RF.rng.fmix32(h ^ s.charCodeAt(i));
    return (h >>> 0) / 4294967296;
  }

  // Local 2D polygon (CCW) from world corners projected on (ex, ey) about P; returns pts, zmax.
  function projectPoly(pts3, P, ex, ey, ez) {
    let pts = pts3.map((q) => { const d = V.sub(q, P); return [V.dot(d, ex), V.dot(d, ey), V.dot(d, ez)]; });
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; area += a[0] * c[1] - c[0] * a[1]; }
    if (area < 0) pts = pts.reverse();
    const zmax = Math.max(...pts.map((p) => Math.abs(p[2])));
    return { pts: pts.map((p) => [p[0], p[1]]), zmax };
  }

  // Sag of a local quadric at (x, y): the root z nearest 0.
  function localSag(D, o, x, y) {
    const qxx = D[o + 12], qyy = D[o + 13], qzz = D[o + 14], qxy = D[o + 15], qxz = D[o + 16], qyz = D[o + 17];
    const a = qzz, b = 2 * (qxz * x + qyz * y) + D[o + 20];
    const c = qxx * x * x + qyy * y * y + 2 * qxy * x * y + D[o + 18] * x + D[o + 19] * y + D[o + 21];
    const r = RF.U.quadRoots(a, b, c);
    if (!r.length) return NaN;
    return r.reduce((m, t) => (Math.abs(t) < Math.abs(m) ? t : m), Infinity);
  }

  /* compileSurface: writes surface s at slot k.  Returns meta (for rendering & diagnostics). */
  function compileSurface(s, D, k, polyOut) {
    const o = k * STRIDE;
    const meta = { id: s.id, group: s.group || '', kind: s.type };
    writeOptics(D, o, s.optics);
    D[o + 35] = tieKey(s.id);
    if (s.type === 'facet' || s.type === 'plane') {
      let P = s.P, n, A, b, flat;
      if (s.type === 'facet') {
        const fq = facetQuadric(s.P, s.S0, s.Z, s.flat ? null : s.di);
        n = fq.n; A = fq.A; b = fq.b; flat = fq.flat;
      } else {
        n = V.norm(s.n); A = [0, 0, 0, 0, 0, 0, 0, 0, 0]; b = n.slice(); flat = true;
      }
      const clip = s.clip || { kind: 'disc', r: 1 };
      const ex = V.inPlane(n, clip.ref), ey = V.cross(n, ex), ez = n;
      writeFrame(D, o, P, ex, ey, ez);
      const Q = M3.congruent(A, ex, ey, ez);
      const L = [V.dot(b, ex), V.dot(b, ey), V.dot(b, ez)];
      writeQuadric(D, o, Q, L, 0);
      D[o + 33] = L[2] >= 0 ? 1 : -1;          // front normal = +n (toward the source side)
      let rad, slab = 0;
      if (clip.kind === 'poly') {
        const pp = projectPoly(clip.pts3, P, ex, ey, ez);
        D[o + 22] = CLIP.poly; D[o + 23] = polyOut.length / 2; D[o + 24] = pp.pts.length;
        for (const q of pp.pts) polyOut.push(q[0], q[1]);
        rad = Math.max(...pp.pts.map((q) => Math.hypot(q[0], q[1])));
        slab = pp.zmax;
        if (!flat) for (const q of pp.pts) slab = Math.max(slab, Math.abs(localSag(D, o, q[0], q[1])) || 0);
        meta.poly2 = pp.pts;
      } else if (clip.kind === 'rect') {
        D[o + 22] = CLIP.rect; D[o + 23] = clip.hx; D[o + 24] = clip.hy;
        rad = Math.hypot(clip.hx, clip.hy);
        if (!flat) for (const sx of [-1, 1]) for (const sy of [-1, 1]) slab = Math.max(slab, Math.abs(localSag(D, o, sx * clip.hx, sy * clip.hy)) || 0);
      } else {
        D[o + 22] = CLIP.disc; D[o + 23] = clip.r;
        rad = clip.r;
        if (!flat) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; slab = Math.max(slab, Math.abs(localSag(D, o, clip.r * Math.cos(a), clip.r * Math.sin(a))) || 0); }
      }
      // Slab keeps hits on the sheet near P (a quadric may have a far sheet).  Generous but
      // far smaller than the distance to any other sheet for these facet proportions.
      D[o + 27] = slab * 2 + rad * 1e-6;
      meta.frame = { P, ex, ey, ez }; meta.radius = rad; meta.n = n; meta.flat = flat;
      return meta;
    }
    // Axis-symmetric paraboloid cap (the /astra/ build's facet): z = (x² + y²) / (4·focal) in the frame (ex, ey, n)
    // about P, clipped to a rectangle ±hx × ±hy (clip.ref orients ex); focal 0/absent = flat.  Front = +n.
    if (s.type === 'parab') {
      const n = V.norm(s.n), clip = s.clip || { kind: 'rect', hx: 1, hy: 1 };
      const ex = V.inPlane(n, clip.ref), ey = V.cross(n, ex), ez = n, P = s.P, f = s.focal;
      writeFrame(D, o, P, ex, ey, ez);
      const flat = !(f && isFinite(f));
      if (flat) writeQuadric(D, o, [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 1], 0);
      else writeQuadric(D, o, [1 / (4 * f), 0, 0, 0, 1 / (4 * f), 0, 0, 0, 0], [0, 0, -1], 0);
      D[o + 33] = flat ? 1 : -1;                  // front normal = +n (the -1 undoes the gradient's −z)
      D[o + 22] = CLIP.rect; D[o + 23] = clip.hx; D[o + 24] = clip.hy;
      const rad = Math.hypot(clip.hx, clip.hy); let slab = 0;
      if (!flat) for (const sx of [-1, 1]) for (const sy of [-1, 1]) slab = Math.max(slab, Math.abs(localSag(D, o, sx * clip.hx, sy * clip.hy)) || 0);
      D[o + 27] = slab * 2 + rad * 1e-6;
      meta.frame = { P, ex, ey, ez }; meta.radius = rad; meta.n = n; meta.flat = flat;
      return meta;
    }
    if (s.type === 'rev') {
      const W = V.norm(s.W), ex = V.inPlane(W, s.ref || null), ey = V.cross(W, ex);
      writeFrame(D, o, s.O, ex, ey, W);
      const g = s.seg, front = s.front === -1 ? -1 : 1;
      let Q, L, K, zlo = -Infinity, zhi = Infinity, rlo = 0, rhi = Infinity, fs;
      if (g.kind === 'arc') {
        Q = M3.identity(); L = [0, 0, -2 * g.zc]; K = g.zc * g.zc - g.R * g.R;
        zlo = Math.min(g.z0, g.z1); zhi = Math.max(g.z0, g.z1);
        rhi = g.rmax !== undefined ? g.rmax : Infinity;
        fs = front;                          // +1: front = outward from the sphere centre
        const rr = (z) => Math.sqrt(Math.max(0, g.R * g.R - (z - g.zc) * (z - g.zc)));
        meta.rmaxSeg = (g.zc >= zlo && g.zc <= zhi) ? g.R : Math.max(rr(zlo), rr(zhi));
      } else {
        const dz = g.z1 - g.z0, dr = g.r1 - g.r0, len = Math.hypot(dz, dr);
        // Left normal of the profile direction (dr, dz) is (−dz, dr) in (r, z).  front=+1 means
        // the left side is the front.  frontSign maps the quadric gradient onto that side.
        if (Math.abs(dz) <= 1e-12 * len) {             // annulus in plane z = z0
          Q = [0, 0, 0, 0, 0, 0, 0, 0, 0]; L = [0, 0, 1]; K = -g.z0;
          rlo = Math.min(g.r0, g.r1); rhi = Math.max(g.r0, g.r1);
          fs = front * (dr > 0 ? 1 : -1);
        } else if (Math.abs(dr) <= 1e-12 * len) {      // cylinder
          Q = [1, 0, 0, 0, 1, 0, 0, 0, 0]; L = [0, 0, 0]; K = -g.r0 * g.r0;
          zlo = Math.min(g.z0, g.z1); zhi = Math.max(g.z0, g.z1);
          fs = front * (dz > 0 ? -1 : 1);
        } else {                                       // cone frustum r = k z + c0
          const kk = dr / dz, c0 = g.r0 - kk * g.z0;
          Q = [1, 0, 0, 0, 1, 0, 0, 0, -kk * kk]; L = [0, 0, -2 * kk * c0]; K = -c0 * c0;
          zlo = Math.min(g.z0, g.z1); zhi = Math.max(g.z0, g.z1);
          fs = front * (dz > 0 ? -1 : 1);
        }
        meta.rmaxSeg = Math.max(g.r0, g.r1);
        meta.seg = g;
      }
      writeQuadric(D, o, Q, L, K);
      D[o + 33] = fs;
      const zt = isFinite(zhi) ? (zhi - zlo) * 1e-9 + 1e-300 : 0;
      D[o + 22] = CLIP.ring; D[o + 23] = zlo - zt; D[o + 24] = zhi + zt;
      D[o + 25] = rlo * rlo * (1 - 1e-12); D[o + 26] = isFinite(rhi) ? rhi * rhi * (1 + 1e-12) : Infinity;
      D[o + 27] = 0;
      meta.frame = { P: s.O, ex, ey, ez: W }; meta.W = W; meta.zlo = zlo; meta.zhi = zhi;
      if (g.kind !== 'arc' && Math.abs(g.z1 - g.z0) <= 1e-12 * Math.hypot(g.z1 - g.z0, g.r1 - g.r0)) { meta.zlo = meta.zhi = g.z0; }
      return meta;
    }
    throw new Error('unknown surface type ' + s.type);
  }

  // ---------------------------------------------------------------- AABB of a compiled surface
  function surfaceBox(D, k, meta, polyArr) {
    const o = k * STRIDE, out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const push = (p) => { for (let i = 0; i < 3; i++) { if (p[i] < out[i]) out[i] = p[i]; if (p[i] > out[i + 3]) out[i + 3] = p[i]; } };
    const P = [D[o], D[o + 1], D[o + 2]], ex = [D[o + 3], D[o + 4], D[o + 5]], ey = [D[o + 6], D[o + 7], D[o + 8]], ez = [D[o + 9], D[o + 10], D[o + 11]];
    const at = (x, y, z) => [P[0] + ex[0] * x + ey[0] * y + ez[0] * z, P[1] + ex[1] * x + ey[1] * y + ez[1] * z, P[2] + ex[2] * x + ey[2] * y + ez[2] * z];
    const ct = D[o + 22], slab = D[o + 27];
    if (ct === CLIP.ring) {
      const r = meta.rmaxSeg, zs = [meta.zlo, meta.zhi];
      for (const z of zs) {
        const c = at(0, 0, z);
        for (let i = 0; i < 3; i++) {
          const e = r * Math.sqrt(Math.max(0, 1 - ez[i] * ez[i]));
          if (c[i] - e < out[i]) out[i] = c[i] - e;
          if (c[i] + e > out[i + 3]) out[i + 3] = c[i] + e;
        }
      }
    } else {
      let pts;
      if (ct === CLIP.rect) { const hx = D[o + 23], hy = D[o + 24]; pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]; }
      else if (ct === CLIP.disc) { const r = D[o + 23]; pts = [[-r, -r], [r, -r], [r, r], [-r, r]]; }
      else { const off = D[o + 23], cnt = D[o + 24]; pts = []; for (let i = 0; i < cnt; i++) pts.push([polyArr[2 * (off + i)], polyArr[2 * (off + i) + 1]]); }
      for (const q of pts) { push(at(q[0], q[1], -slab)); push(at(q[0], q[1], slab)); }
    }
    // pad by a relative epsilon so zero-thickness boxes still register slab hits
    const pad = 1e-9 * Math.max(out[3] - out[0], out[4] - out[1], out[5] - out[2], 1e-300);
    for (let i = 0; i < 3; i++) { out[i] -= pad; out[i + 3] += pad; }
    return out;
  }

  // ---------------------------------------------------------------- BVH (median split)
  function buildBVH(boxes, n) {
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    const nodes = [];
    const cen = (i, a) => 0.5 * (boxes[6 * i + a] + boxes[6 * i + a + 3]);
    function rec(list) {
      const node = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], left: -1, right: -1, items: null };
      for (const i of list) for (let a = 0; a < 3; a++) {
        node.min[a] = Math.min(node.min[a], boxes[6 * i + a]); node.max[a] = Math.max(node.max[a], boxes[6 * i + a + 3]);
      }
      const id = nodes.length; nodes.push(node);
      if (list.length <= 4) { node.items = list; return id; }
      let ax = 0, best = -1;
      for (let a = 0; a < 3; a++) {
        let lo = Infinity, hi = -Infinity;
        for (const i of list) { const c = cen(i, a); if (c < lo) lo = c; if (c > hi) hi = c; }
        if (hi - lo > best) { best = hi - lo; ax = a; }
      }
      const sorted = list.slice().sort((p, q) => cen(p, ax) - cen(q, ax) || p - q);
      const mid = sorted.length >> 1;
      node.left = rec(sorted.slice(0, mid));
      node.right = rec(sorted.slice(mid));
      return id;
    }
    if (n > 0) rec(idx);
    const M = nodes.length;
    const bmin = new Float64Array(3 * M), bmax = new Float64Array(3 * M);
    const left = new Int32Array(M), right = new Int32Array(M), start = new Int32Array(M), count = new Int32Array(M);
    const items = [];
    nodes.forEach((nd, i) => {
      for (let a = 0; a < 3; a++) { bmin[3 * i + a] = nd.min[a]; bmax[3 * i + a] = nd.max[a]; }
      left[i] = nd.left; right[i] = nd.right;
      if (nd.items) { start[i] = items.length; count[i] = nd.items.length; items.push(...nd.items); } else { start[i] = 0; count[i] = 0; }
    });
    return { M, bmin, bmax, left, right, start, count, items: Int32Array.from(items) };
  }

  // ---------------------------------------------------------------- compile a surface list
  function compile(surfaces) {
    const n = surfaces.length;
    const D = new Float64Array(Math.max(1, n) * STRIDE);
    const polyList = [], metas = [];
    for (let k = 0; k < n; k++) metas.push(compileSurface(surfaces[k], D, k, polyList));
    const poly = Float64Array.from(polyList.length ? polyList : [0, 0]);
    const boxes = new Float64Array(Math.max(1, n) * 6);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < n; k++) {
      const b = surfaceBox(D, k, metas[k], poly);
      for (let i = 0; i < 6; i++) boxes[6 * k + i] = b[i];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b[i]); hi[i] = Math.max(hi[i], b[i + 3]); }
    }
    const bvh = buildBVH(boxes, n);
    return { D, poly, n, metas, boxes, bvh, lo, hi };
  }

  // ---------------------------------------------------------------- exact intersection
  // Returns t of the nearest valid hit on surface k within (tmin, tmax), else -1.  The local
  // hit point is left in HIT[0..2] for the caller (normal evaluation).
  const HIT = new Float64Array(3);
  function intersect(D, poly, k, ox, oy, oz, dx, dy, dz, tmin, tmax) {
    const o = k * STRIDE;
    const rx = ox - D[o], ry = oy - D[o + 1], rz = oz - D[o + 2];
    const Ox = rx * D[o + 3] + ry * D[o + 4] + rz * D[o + 5];
    const Oy = rx * D[o + 6] + ry * D[o + 7] + rz * D[o + 8];
    const Oz = rx * D[o + 9] + ry * D[o + 10] + rz * D[o + 11];
    const Dx = dx * D[o + 3] + dy * D[o + 4] + dz * D[o + 5];
    const Dy = dx * D[o + 6] + dy * D[o + 7] + dz * D[o + 8];
    const Dz = dx * D[o + 9] + dy * D[o + 10] + dz * D[o + 11];
    const lx = D[o + 18], ly = D[o + 19], lz = D[o + 20], K = D[o + 21];
    let t0, t1 = NaN;
    if (D[o + 34] === 1) {
      const den = lx * Dx + ly * Dy + lz * Dz;
      if (den === 0) return -1;
      t0 = -(lx * Ox + ly * Oy + lz * Oz + K) / den;
    } else {
      const qxx = D[o + 12], qyy = D[o + 13], qzz = D[o + 14], qxy = D[o + 15], qxz = D[o + 16], qyz = D[o + 17];
      const QDx = qxx * Dx + qxy * Dy + qxz * Dz, QDy = qxy * Dx + qyy * Dy + qyz * Dz, QDz = qxz * Dx + qyz * Dy + qzz * Dz;
      const QOx = qxx * Ox + qxy * Oy + qxz * Oz, QOy = qxy * Ox + qyy * Oy + qyz * Oz, QOz = qxz * Ox + qyz * Oy + qzz * Oz;
      const a = Dx * QDx + Dy * QDy + Dz * QDz;
      const b = 2 * (Ox * QDx + Oy * QDy + Oz * QDz) + lx * Dx + ly * Dy + lz * Dz;
      const c = Ox * QOx + Oy * QOy + Oz * QOz + lx * Ox + ly * Oy + lz * Oz + K;
      if (a === 0) {
        if (b === 0) return -1;
        t0 = -c / b;
      } else {
        const disc = b * b - 4 * a * c;
        if (disc < 0) return -1;
        const q = -0.5 * (b + (b >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc)));
        const r1 = q / a, r2 = q !== 0 ? c / q : r1;
        if (r1 < r2) { t0 = r1; t1 = r2; } else { t0 = r2; t1 = r1; }
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const t = pass === 0 ? t0 : t1;
      if (!(t > tmin && t < tmax)) continue;
      const X = Ox + t * Dx, Y = Oy + t * Dy, Z = Oz + t * Dz;
      const ct = D[o + 22];
      let ok;
      if (ct === 3) {
        const r2 = X * X + Y * Y;
        ok = Z >= D[o + 23] && Z <= D[o + 24] && r2 >= D[o + 25] && r2 <= D[o + 26];
      } else if (Math.abs(Z) > D[o + 27]) {
        ok = false;
      } else if (ct === 0) {
        ok = Math.abs(X) <= D[o + 23] && Math.abs(Y) <= D[o + 24];
      } else if (ct === 1) {
        ok = X * X + Y * Y <= D[o + 23] * D[o + 23];
      } else {
        const off = D[o + 23], cnt = D[o + 24];
        ok = true;
        for (let i = 0; i < cnt; i++) {
          const j = (i + 1) % cnt;
          const x0 = poly[2 * (off + i)], y0 = poly[2 * (off + i) + 1], x1 = poly[2 * (off + j)], y1 = poly[2 * (off + j) + 1];
          const ex = x1 - x0, ey = y1 - y0;
          // tolerance relative to the edge length so shared facet edges leave no crack
          if (ex * (Y - y0) - ey * (X - x0) < -1e-9 * (ex * ex + ey * ey)) { ok = false; break; }
        }
      }
      if (ok) { HIT[0] = X; HIT[1] = Y; HIT[2] = Z; return t; }
    }
    return -1;
  }

  // Front-facing unit normal (world) at local point HIT for surface k → out[0..2]
  function frontNormal(D, k, X, Y, Z, out) {
    const o = k * STRIDE;
    const gx = 2 * (D[o + 12] * X + D[o + 15] * Y + D[o + 16] * Z) + D[o + 18];
    const gy = 2 * (D[o + 15] * X + D[o + 13] * Y + D[o + 17] * Z) + D[o + 19];
    const gz = 2 * (D[o + 16] * X + D[o + 17] * Y + D[o + 14] * Z) + D[o + 20];
    const wx = gx * D[o + 3] + gy * D[o + 6] + gz * D[o + 9];
    const wy = gx * D[o + 4] + gy * D[o + 7] + gz * D[o + 10];
    const wz = gx * D[o + 5] + gy * D[o + 8] + gz * D[o + 11];
    const s = D[o + 33] / Math.hypot(wx, wy, wz);
    out[0] = wx * s; out[1] = wy * s; out[2] = wz * s;
  }

  // ---------------------------------------------------------------- envelope
  /* env = { shape: 'box'|'cylinder'|'ellipsoid', center:[3], half:[3], axis: 0|1|2 (cylinder) } */
  function envInside(env, p, tol) {
    const t = tol || 0, c = env.center, h = env.half;
    const d = [(p[0] - c[0]), (p[1] - c[1]), (p[2] - c[2])];
    if (env.shape === 'box') return Math.abs(d[0]) <= h[0] * (1 + t) && Math.abs(d[1]) <= h[1] * (1 + t) && Math.abs(d[2]) <= h[2] * (1 + t);
    if (env.shape === 'ellipsoid') return (d[0] / h[0]) ** 2 + (d[1] / h[1]) ** 2 + (d[2] / h[2]) ** 2 <= (1 + t) * (1 + t);
    const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
    return Math.abs(d[ax]) <= h[ax] * (1 + t) && (d[i] / h[i]) ** 2 + (d[j] / h[j]) ** 2 <= (1 + t) * (1 + t);
  }
  // Interval [tin, tout] of ray S + t dir inside the envelope (tout < tin ⇒ empty).
  function envInterval(env, S, dir) {
    const c = env.center, h = env.half;
    const o = [S[0] - c[0], S[1] - c[1], S[2] - c[2]];
    let tin = -Infinity, tout = Infinity;
    const slab = (a) => {
      if (dir[a] === 0) { if (Math.abs(o[a]) > h[a]) { tin = Infinity; tout = -Infinity; } return; }
      let t1 = (-h[a] - o[a]) / dir[a], t2 = (h[a] - o[a]) / dir[a];
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      tin = Math.max(tin, t1); tout = Math.min(tout, t2);
    };
    const quad = (axes) => {       // ellipse/ellipsoid over the given axes
      let A = 0, B = 0, C = -1;
      for (const a of axes) { A += (dir[a] / h[a]) ** 2; B += 2 * o[a] * dir[a] / (h[a] * h[a]); C += (o[a] / h[a]) ** 2; }
      const r = RF.U.quadRoots(A, B, C);
      if (r.length < 2) { if (C > 0 || r.length === 0) { tin = Infinity; tout = -Infinity; } return; }
      tin = Math.max(tin, r[0]); tout = Math.min(tout, r[1]);
    };
    if (env.shape === 'box') { slab(0); slab(1); slab(2); }
    else if (env.shape === 'ellipsoid') quad([0, 1, 2]);
    else { const ax = env.axis === undefined ? 2 : env.axis; slab(ax); quad([(ax + 1) % 3, (ax + 2) % 3]); }
    return [tin, tout];
  }
  function envVolume(env) {
    const h = env.half;
    if (env.shape === 'box') return 8 * h[0] * h[1] * h[2];
    if (env.shape === 'ellipsoid') return 4 / 3 * Math.PI * h[0] * h[1] * h[2];
    return Math.PI * h[0] * h[1] * h[2] * 2 / h[env.axis === undefined ? 2 : env.axis] * h[env.axis === undefined ? 2 : env.axis];
  }
  // Wireframe polylines for drawing
  function envWire(env) {
    const c = env.center, h = env.half, lines = [];
    const P = (x, y, z) => [c[0] + x, c[1] + y, c[2] + z];
    if (env.shape === 'box') {
      const s = [-1, 1];
      for (const a of s) for (const b of s) {
        lines.push([P(-h[0], a * h[1], b * h[2]), P(h[0], a * h[1], b * h[2])]);
        lines.push([P(a * h[0], -h[1], b * h[2]), P(a * h[0], h[1], b * h[2])]);
        lines.push([P(a * h[0], b * h[1], -h[2]), P(a * h[0], b * h[1], h[2])]);
      }
      return lines;
    }
    const N = 36;
    const ring = (ax, off, ri, rj) => {
      const i = (ax + 1) % 3, j = (ax + 2) % 3, pts = [];
      for (let k = 0; k <= N; k++) { const a = 2 * Math.PI * k / N, d = [0, 0, 0]; d[ax] = off; d[i] = ri * Math.cos(a); d[j] = rj * Math.sin(a); pts.push(P(d[0], d[1], d[2])); }
      return pts;
    };
    if (env.shape === 'ellipsoid') {
      for (let ax = 0; ax < 3; ax++) {
        for (const f of [-0.6, 0, 0.6]) {
          const i = (ax + 1) % 3, j = (ax + 2) % 3, s = Math.sqrt(1 - f * f);
          lines.push(ring(ax, f * h[ax], h[i] * s, h[j] * s));
        }
      }
      return lines;
    }
    const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
    for (const f of [-1, -0.33, 0.33, 1]) lines.push(ring(ax, f * h[ax], h[i], h[j]));
    for (let k = 0; k < 8; k++) {
      const a = 2 * Math.PI * k / 8, d0 = [0, 0, 0], d1 = [0, 0, 0];
      d0[ax] = -h[ax]; d1[ax] = h[ax]; d0[i] = d1[i] = h[i] * Math.cos(a); d0[j] = d1[j] = h[j] * Math.sin(a);
      lines.push([P(d0[0], d0[1], d0[2]), P(d1[0], d1[1], d1[2])]);
    }
    return lines;
  }

  // ---------------------------------------------------------------- outlines for drawing
  // Returns a list of 3D polygons approximating the surface patch (for rendering only).
  function outline(C, k) {
    const D = C.D, o = k * STRIDE, meta = C.metas[k];
    const P = [D[o], D[o + 1], D[o + 2]], ex = [D[o + 3], D[o + 4], D[o + 5]], ey = [D[o + 6], D[o + 7], D[o + 8]], ez = [D[o + 9], D[o + 10], D[o + 11]];
    const at = (x, y, z) => [P[0] + ex[0] * x + ey[0] * y + ez[0] * z, P[1] + ex[1] * x + ey[1] * y + ez[1] * z, P[2] + ex[2] * x + ey[2] * y + ez[2] * z];
    const ct = D[o + 22];
    const sag = (x, y) => (D[o + 34] === 1 ? 0 : (localSag(D, o, x, y) || 0));
    if (ct === CLIP.ring) {
      const polys = [], N = 32;
      let zs, rs;
      if (meta.seg) { zs = [meta.seg.z0, meta.seg.z1]; rs = [meta.seg.r0, meta.seg.r1]; }
      else {                                   // arc: sample 4 steps between zlo..zhi
        zs = []; rs = [];
        const R = Math.sqrt(Math.max(0, D[o + 21] * -1 + (D[o + 20] / 2) ** 2)), zc = -D[o + 20] / 2;
        for (let i = 0; i <= 4; i++) { const z = meta.zlo + (meta.zhi - meta.zlo) * i / 4; zs.push(z); rs.push(Math.sqrt(Math.max(0, R * R - (z - zc) ** 2))); }
        const rcap = Math.sqrt(D[o + 26]);
        for (let i = 0; i < rs.length; i++) rs[i] = Math.min(rs[i], rcap);
      }
      for (let s = 0; s + 1 < zs.length; s++) {
        for (let a = 0; a < N; a++) {
          const a0 = 2 * Math.PI * a / N, a1 = 2 * Math.PI * (a + 1) / N;
          polys.push([at(rs[s] * Math.cos(a0), rs[s] * Math.sin(a0), zs[s]), at(rs[s] * Math.cos(a1), rs[s] * Math.sin(a1), zs[s]),
                      at(rs[s + 1] * Math.cos(a1), rs[s + 1] * Math.sin(a1), zs[s + 1]), at(rs[s + 1] * Math.cos(a0), rs[s + 1] * Math.sin(a0), zs[s + 1])]);
        }
      }
      return polys;
    }
    let pts;
    if (ct === CLIP.rect) { const hx = D[o + 23], hy = D[o + 24]; pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]; }
    else if (ct === CLIP.disc) { const r = D[o + 23]; pts = []; for (let i = 0; i < 20; i++) pts.push([r * Math.cos(i * Math.PI / 10), r * Math.sin(i * Math.PI / 10)]); }
    else { const off = D[o + 23], cnt = D[o + 24]; pts = []; for (let i = 0; i < cnt; i++) pts.push([C.poly[2 * (off + i)], C.poly[2 * (off + i) + 1]]); }
    if (D[o + 34] !== 1 && ct !== CLIP.disc) {           // subdivide edges of curved facets
      const dense = [];
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; for (let s = 0; s < 4; s++) dense.push([p[0] + (q[0] - p[0]) * s / 4, p[1] + (q[1] - p[1]) * s / 4]); }
      pts = dense;
    }
    return [pts.map((q) => at(q[0], q[1], sag(q[0], q[1])))];
  }

  RF.Geo = {
    STRIDE, CLIP, INTER, INTER_NAMES, DEFAULT_OPTICS, HIT,
    facetQuadric, quadricRay, compile, compileSurface, intersect, frontNormal, localSag,
    envInside, envInterval, envVolume, envWire, outline, buildBVH,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
