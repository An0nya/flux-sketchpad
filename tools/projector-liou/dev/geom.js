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
