/* SC: light culling for the oncoming in-scatter table (option scatterCull). Pure maths, no three.js, so a Node test can load it.
   Per lamp, litBound() bounds the air that can hold light from that lamp, as a convex polytope in the car frame, and returns
   the depth slices [k0, k1] and the table cell rectangle the table pass has to draw. Nothing outside it can add to the table, so skipping it is exact.
   The bound is a list of CLIPS, each a volume the lit air lies inside. Today: the lamp's forward half-space and the non-zero angular cone of its beam
   (coneClip), and for 'fast' a ball (ballClip). SM (shadow maps) adds one more entry (the distance at which the beam meets the ground) without touching the rest.
   A clip is { planes: [[nx, ny, nz, D], ...] } (inside = n.P + D >= 0, P in the car frame; n need not be unit) and/or { ball: { c: [x, y, z], r } }.
   Conservative on purpose: every approximation (the planar cone, the slack, the padding) only ever adds air. */
export const CULL_SLACK = 0.02, CULL_PAD = 1;   // m of slack on every cone plane (keeps a thin or touching cone from collapsing to nothing); cells of padding round the rectangle (the lookup reads neighbours)
const DEG = Math.PI / 180;

// The bounding box of the non-zero texels of one beam, as angles in degrees: the shader reads f = (deg - h0) * invStep - 0.5 and a sample is non-zero only when
// texel base or base + 1 is non-zero, so f runs over [i0 - 1, i1 + 1), and it must also keep base >= 0 and base + 1 < size (otherIntensity returns 0 outside).
// data/rowOff/stride: the texels, g = [h0, v0, 1/stepH, 1/stepV] (the shader's grid), size = [W, H] of this beam. Returns { h: [lo, hi], v: [lo, hi], max } or null (all zero).
export function beamExtent(data, rowOff, stride, g, size) {
  let i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1, max = 0;
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = data[(rowOff + y) * stride + x];
    if (v !== 0 && v === v) { if (x < i0) i0 = x; if (x > i1) i1 = x; if (y < j0) j0 = y; if (y > j1) j1 = y; if (v > max) max = v; }
  }
  if (i1 < 0) return null;
  const sH = 1 / g[2], sV = 1 / g[3], eH = 0.02 * sH + 1e-3, eV = 0.02 * sV + 1e-3;   // a hair for float32 and for the degrees conversion
  const span = (a0, s, i0_, i1_, n, e) => [a0 + (Math.max(i0_ - 1, 0) + 0.5) * s - e, a0 + (Math.min(i1_ + 1, n - 1) + 0.5) * s + e];   // f in [i0 - 1, i1 + 1], inside [0, size - 1]; degrees = a0 + (f + 0.5) * step
  return { h: span(g[0], sH, i0, i1, size[0], eH), v: span(g[1], sV, j0, j1, size[1], eV), max };
}

const nrm = (n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
// Planes (car frame, absolute, unit normals) of the convex superset of the beam's non-zero directions. basis = { f, l, u } are the shader's local axes
// (local.x = d.f, local.y = d.l, local.z = d.u; d = P - lamp); conv 0 = A, 1 = B, 2 = S as in otherIntensity. Returns null when no direction can be lit.
// The shader reads b = -local.y. Exact planar wedges where the beam's angle is a plain azimuth (A: H, B: V, S: both); the other angle is an elevation about
// that wedge, tan(a) * r_perp, and r_perp lies in [x, x * m] over the wedge, which gives a planar superset.
export function coneClip(lampPos, basis, ext, conv, slack = CULL_SLACK) {
  if (!ext) return null;
  const T = (deg) => Math.tan(Math.min(89.9, Math.max(-89.9, deg)) * DEG), clampA = (a) => [Math.max(a[0], -90), Math.min(a[1], 90)];
  const lp = [];   // local planes [px, py, pz] . (x, y, z) >= 0
  const wedge = (axis, sign, a, drop) => {   // a[0] <= atan2(sign * local[axis], x) <= a[1], x > 0: s >= x tan a0, s <= x tan a1
    if (a[0] >= 90 || a[1] <= -90) return false;
    const n0 = [0, 0, 0], n1 = [0, 0, 0];
    if (a[0] > -90) { n0[axis] = sign; n0[0] = -T(a[0]); lp.push(n0); }
    if (a[1] < 90) { n1[axis] = -sign; n1[0] = T(a[1]); lp.push(n1); }
    return true;
  };
  const relax = (axis, sign, a, wa) => {   // a[0] <= elevation <= a[1] of s = sign * local[axis] about the plane of the wedge angle wa
    const cmin = Math.min(Math.cos(wa[0] * DEG), Math.cos(wa[1] * DEG)), m = wa[0] <= -89.5 || wa[1] >= 89.5 ? Infinity : 1 / cmin;   // r_perp <= x * m
    const tl = a[0] <= -89.5 ? null : Math.tan(a[0] * DEG), tu = a[1] >= 89.5 ? null : Math.tan(a[1] * DEG);
    const lowK = tl === null ? null : tl >= 0 ? tl : tl * m, upK = tu === null ? null : tu >= 0 ? tu * m : tu;   // s >= lowK * x ; s <= upK * x
    if (lowK !== null && isFinite(lowK)) { const n = [0, 0, 0]; n[axis] = sign; n[0] = -lowK; lp.push(n); }
    if (upK !== null && isFinite(upK)) { const n = [0, 0, 0]; n[axis] = -sign; n[0] = upK; lp.push(n); }
  };
  const H = clampA(ext.h), V = clampA(ext.v);
  lp.push([1, 0, 0]);   // the forward plane (the shader's local.x <= 0 test)
  if (H[0] >= H[1] || V[0] >= V[1]) return null;
  if (conv === 2) { if (!wedge(1, -1, H) || !wedge(2, 1, V)) return null; }
  else if (conv === 1) { if (!wedge(2, 1, V)) return null; relax(1, -1, H, V); }
  else { if (!wedge(1, -1, H)) return null; relax(2, 1, V, H); }
  const planes = lp.map((q) => {
    const n = nrm([q[0] * basis.f[0] + q[1] * basis.l[0] + q[2] * basis.u[0], q[0] * basis.f[1] + q[1] * basis.l[1] + q[2] * basis.u[1], q[0] * basis.f[2] + q[1] * basis.l[2] + q[2] * basis.u[2]]);
    return [n[0], n[1], n[2], -(n[0] * lampPos[0] + n[1] * lampPos[1] + n[2] * lampPos[2]) + slack];
  });
  return { planes };
}
export const ballClip = (c, r) => ({ ball: { c, r } });
// 'fast': the radius beyond which the best case the integrand can reach, sigma * maxPhase * Imax / max(r^2, rMin^2) * exp(-sigma r) per metre of ray, is under eps. Decreasing in r, so a bisection.
export function fastRadius(sigma, maxPhase, imax, rMin, eps) {
  const f = (r) => sigma * maxPhase * imax / Math.max(r * r, rMin * rMin) * Math.exp(-sigma * r);
  if (!(eps > 0)) return Infinity;
  if (f(rMin) < eps) return rMin;
  let a = rMin, b = 1e5; if (f(b) >= eps) return b;
  for (let i = 0; i < 60; i++) { const m = 0.5 * (a + b); if (f(m) >= eps) a = m; else b = m; }
  return b;
}

// Sutherland-Hodgman on the faces of a convex polytope given as polygons. The cap a cut creates is kept (its points sorted round their centroid): a vertex where
// three cuts meet, such as a cone's apex, lies on no face of the starting cube, so without the caps it would be lost.
function clipFaces(faces, pl) {
  const out = [], cut = [], tol = 1e-9 * (1 + Math.abs(pl[3]));
  const val = (p) => pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] + pl[3];
  for (const face of faces) {
    const poly = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length], va = val(a), vb = val(b);
      if (va >= -tol) poly.push(a);
      if ((va >= -tol) !== (vb >= -tol)) { const t = va / (va - vb), c = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; poly.push(c); cut.push(c); }
    }
    if (poly.length >= 3) out.push(poly);
  }
  const pts = []; for (const c of cut) if (!pts.some((q) => Math.abs(q[0] - c[0]) + Math.abs(q[1] - c[1]) + Math.abs(q[2] - c[2]) < 1e-7)) pts.push(c);
  if (pts.length >= 3) {
    const m = [0, 1, 2].map((i) => pts.reduce((a, q) => a + q[i], 0) / pts.length), n = nrm(pl), t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = nrm([n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]), e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    const ang = (q) => Math.atan2((q[0] - m[0]) * e2[0] + (q[1] - m[1]) * e2[1] + (q[2] - m[2]) * e2[2], (q[0] - m[0]) * e1[0] + (q[1] - m[1]) * e1[1] + (q[2] - m[2]) * e1[2]);
    out.push(pts.map((q) => [q, ang(q)]).sort((x, y) => x[1] - y[1]).map((x) => x[0]));
  }
  return out;
}
const cubeFaces = (c, h) => {
  const v = (i) => [c[0] + (i & 1 ? h : -h), c[1] + (i & 2 ? h : -h), c[2] + (i & 4 ? h : -h)];
  return [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].map((f) => f.map(v));
};

// view = { eye: [x, y, z], tanH, aspect (h / w), edges: HALO_EDGES (edges[0] = 0, edges[n] = the range), tab: [tw, th] | null (null: no screen rectangle, polar tables),
//          frustum: clip to the screen (screen table only) }. clips as described at the top. Returns { empty, k0, k1, rect: [cx0, cx1, cy0, cy1] | null, dmin, dmax }.
export function litBound(view, clips) {
  const E = view.eye, n = view.edges.length - 1, R = view.edges[n] * (1 + 1e-6) + 1e-3, none = { empty: true, k0: 0, k1: -1, rect: null, dmin: Infinity, dmax: 0 };
  const planes = [];   // in eye-relative coordinates Q = P - E: n.Q + (n.E + D) >= 0
  let dmin = 0, dmax = R * Math.sqrt(3);
  const addAbs = (p, forDist) => {
    const d = p[3] + p[0] * E[0] + p[1] * E[1] + p[2] * E[2], l = Math.hypot(p[0], p[1], p[2]) || 1;
    planes.push([p[0], p[1], p[2], d]);
    if (forDist && d / l < 0) dmin = Math.max(dmin, -d / l);   // the eye is outside this half-space by -d / l: every lit point is at least that far
  };
  for (const c of clips) {
    if (!c) return none;
    if (c.planes) for (const p of c.planes) addAbs(p, true);
    if (c.ball) {
      const [x, y, z] = c.ball.c, r = c.ball.r, de = Math.hypot(x - E[0], y - E[1], z - E[2]);
      dmin = Math.max(dmin, de - r); dmax = Math.min(dmax, de + r);
      if (isFinite(r)) for (const [a, b, cc] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) addAbs([a, b, cc, r - (a * x + b * y + cc * z)], false);   // the ball's bounding cube: |P - c|_inf <= r
    }
  }
  const xmin = view.xmin == null ? 0 : view.xmin;
  planes.push([1, 0, 0, -xmin]);   // every sample is in front of the eye (the shader's ray has x > 0)
  if (view.frustum) {   // the table's cells are rays inside the view: |Qy| <= tanH Qx, |Qz| <= tanH aspect Qx (1% wider)
    const t = view.tanH * 1.01, ta = t * view.aspect;
    planes.push([t, -1, 0, 0], [t, 1, 0, 0], [ta, 0, -1, 0], [ta, 0, 1, 0]);
  }
  let faces = cubeFaces([0, 0, 0], R);
  for (const p of planes) { faces = clipFaces(faces, p); if (!faces.length) return none; }
  let verts = 0, mx = 0; const sx = [1e9, -1e9], sy = [1e9, -1e9];
  for (const f of faces) for (const v of f) {
    verts++; mx = Math.max(mx, Math.hypot(v[0], v[1], v[2]));
    if (view.tab) { const q = Math.max(v[0], 1e-6), ux = (-v[1] / (q * view.tanH) + 1) / 2, uy = (v[2] / (q * view.tanH * view.aspect) + 1) / 2; if (ux < sx[0]) sx[0] = ux; if (ux > sx[1]) sx[1] = ux; if (uy < sy[0]) sy[0] = uy; if (uy > sy[1]) sy[1] = uy; }
  }
  if (verts < 3) return none;
  dmax = Math.min(dmax, mx);
  if (dmin > dmax) return none;
  let k0 = -1, k1 = -2;
  for (let k = 0; k < n; k++) {
    const lo = k === 0 ? 0.5 : view.edges[k], hi = view.edges[k + 1];
    if (hi >= dmin - 1e-3 && lo <= dmax + 1e-3) { if (k0 < 0) k0 = k; k1 = k; }
  }
  if (k0 < 0) return none;
  let rect = null;
  if (view.tab) {
    const [tw, th] = view.tab, cell = (u, sz, up) => up ? Math.min(sz - 1, Math.ceil(u * sz - 0.5) + CULL_PAD) : Math.max(0, Math.floor(u * sz - 0.5) - CULL_PAD);
    rect = [cell(sx[0], tw, false), cell(sx[1], tw, true), cell(sy[0], th, false), cell(sy[1], th, true)];
    if (rect[0] > rect[1] || rect[2] > rect[3]) return none;
  }
  return { empty: false, k0, k1, rect, dmin, dmax };
}
