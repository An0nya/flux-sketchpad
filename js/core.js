/* core.js — vector math, seeded PRNG, hashing, small numeric helpers.
 *
 * Every file in this project is a *classic* script (no ES modules) so the app opens straight
 * from file:// with no server.  Everything hangs off one global namespace, RF.  The same files
 * load in Node (tests/headless.js) through vm, so nothing here may touch the DOM.
 */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // ---------------------------------------------------------------- 3-vectors (setup code)
  // Plain [x,y,z] arrays.  The tracer's hot loop does not use these; it works on scalars.
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    madd: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    neg: (a) => [-a[0], -a[1], -a[2]],
    copy: (a) => [a[0], a[1], a[2]],
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    norm(a) {
      const l = Math.hypot(a[0], a[1], a[2]);
      return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
    },
    // Law of reflection in vector form: r = d - 2 (d.n) n   (n unit, either orientation)
    reflect(d, n) {
      const k = 2 * (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]);
      return [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]];
    },
    // Rodrigues rotation of v about unit axis k by angle a (radians)
    rotate(v, k, a) {
      const c = Math.cos(a), s = Math.sin(a), d = V.dot(k, v), x = V.cross(k, v);
      return [v[0] * c + x[0] * s + k[0] * d * (1 - c),
              v[1] * c + x[1] * s + k[1] * d * (1 - c),
              v[2] * c + x[2] * s + k[2] * d * (1 - c)];
    },
    // Orthonormal (u, v) perpendicular to unit n.  Deterministic; prefers world z as "up"
    // reference so a source's rectangle keeps a predictable orientation.
    basis(n, ref) {
      let r = ref || [0, 0, 1];
      if (Math.abs(V.dot(r, n)) > 0.999) r = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = V.norm(V.cross(r, n));
      const v = V.cross(n, u);
      return [u, v];
    },
    // Project ref onto the plane perpendicular to n; fall back to basis() if degenerate.
    inPlane(n, ref) {
      if (ref) {
        const p = V.sub(ref, V.mul(n, V.dot(ref, n)));
        const l = V.len(p);
        if (l > 1e-9) return V.mul(p, 1 / l);
      }
      return V.basis(n)[0];
    },
    fromAzEl(azDeg, elDeg) {
      const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
      return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
    },
    toAzEl(v) {
      const n = V.norm(v);
      return [Math.atan2(n[1], n[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, n[2]))) * 180 / Math.PI];
    },
    angle(a, b) { return Math.atan2(V.len(V.cross(a, b)), V.dot(a, b)); },
  };

  // ---------------------------------------------------------------- 3x3 helpers (row-major arrays of 9)
  const M3 = {
    // Columns ex, ey, ez -> R.  R^T maps world->local.
    fromCols(ex, ey, ez) { return [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]]; },
    // Symmetric quadric A (row-major 9) expressed in a local frame: Q_ij = e_i^T A e_j
    congruent(A, ex, ey, ez) {
      const E = [ex, ey, ez], Q = new Array(9);
      for (let i = 0; i < 3; i++) {
        const Ai = [A[0] * E[i][0] + A[1] * E[i][1] + A[2] * E[i][2],
                    A[3] * E[i][0] + A[4] * E[i][1] + A[5] * E[i][2],
                    A[6] * E[i][0] + A[7] * E[i][1] + A[8] * E[i][2]];
        for (let j = 0; j < 3; j++) Q[i * 3 + j] = Ai[0] * E[j][0] + Ai[1] * E[j][1] + Ai[2] * E[j][2];
      }
      return Q;
    },
    outer: (u, v) => [u[0] * v[0], u[0] * v[1], u[0] * v[2], u[1] * v[0], u[1] * v[1], u[1] * v[2], u[2] * v[0], u[2] * v[1], u[2] * v[2]],
    identity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
    addScaled(A, B, s) { const C = A.slice(); for (let i = 0; i < 9; i++) C[i] += B[i] * s; return C; },
    scale(A, s) { return A.map((x) => x * s); },
  };

  // ---------------------------------------------------------------- PRNG
  // murmur3 finaliser: a good 32-bit mixer.
  function fmix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h | 0;
  }
  // Counter-based seeding: ray i's random stream depends only on (seed, i).  That is what makes a
  // progressive, time-sliced run bit-identical to a one-shot run of the same length.
  function streamSeed(seed, i) {
    return fmix32((seed | 0) ^ fmix32(Math.imul((i | 0) + 1, 0x9E3779B1) ^ 0x5bd1e995));
  }
  // mulberry32 stepping, as an object for non-hot code (solver, tests).
  function Rng(seed) { this.s = seed | 0; }
  Rng.prototype.next = function () {
    const a = (this.s = (this.s + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---------------------------------------------------------------- hashing
  // Two independent 32-bit lanes over raw bytes -> 16 hex chars.  Used for determinism checks:
  // grids are compared by the hash of their Float64 bytes, i.e. byte-identical or not.
  function hashBytes(u8) {
    let h1 = 0x811c9dc5 | 0, h2 = 0x6a09e667 | 0;
    for (let i = 0; i < u8.length; i++) {
      const b = u8[i];
      h1 = Math.imul(h1 ^ b, 0x01000193);
      h2 = Math.imul(h2 ^ b, 0x5bd1e995); h2 ^= h2 >>> 13;
    }
    const a = (fmix32(h1 ^ u8.length) >>> 0).toString(16).padStart(8, '0');
    const c = (fmix32(h2 + 0x27d4eb2f) >>> 0).toString(16).padStart(8, '0');
    return a + c;
  }
  function hashFloat64(arrs) {
    const list = Array.isArray(arrs) ? arrs : [arrs];
    let total = 0;
    for (const a of list) total += a.byteLength;
    const u8 = new Uint8Array(total);
    let off = 0;
    for (const a of list) { u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off); off += a.byteLength; }
    return hashBytes(u8);
  }

  // ---------------------------------------------------------------- misc
  const U = {
    clamp: (x, a, b) => (x < a ? a : x > b ? b : x),
    deg: (r) => r * 180 / Math.PI,
    rad: (d) => d * Math.PI / 180,
    // Numerically stable real roots of a t^2 + b t + c = 0, ascending; handles a -> 0.
    quadRoots(a, b, c) {
      if (a === 0) return b !== 0 ? [-c / b] : [];
      const disc = b * b - 4 * a * c;
      if (disc < 0) return [];
      const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
      const r1 = q / a, r2 = q !== 0 ? c / q : r1;
      return r1 < r2 ? [r1, r2] : [r2, r1];
    },
    // Area moments of a simple polygon (2D pts): {area, cx, cy, cxx, cyy, cxy} central 2nd moments / area
    polyMoments(pts) {
      let A = 0, Cx = 0, Cy = 0, Ixx = 0, Iyy = 0, Ixy = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        const cr = x0 * y1 - x1 * y0;
        A += cr; Cx += (x0 + x1) * cr; Cy += (y0 + y1) * cr;
        Ixx += (x0 * x0 + x0 * x1 + x1 * x1) * cr;          // integral of x^2
        Iyy += (y0 * y0 + y0 * y1 + y1 * y1) * cr;          // integral of y^2
        Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cr;
      }
      A /= 2;
      if (Math.abs(A) < 1e-300) return { area: 0, cx: 0, cy: 0, cxx: 0, cyy: 0, cxy: 0 };
      const cx = Cx / (6 * A), cy = Cy / (6 * A);
      return {
        area: Math.abs(A), cx, cy,
        cxx: Ixx / (12 * A) - cx * cx,
        cyy: Iyy / (12 * A) - cy * cy,
        cxy: Ixy / (24 * A) - cx * cy,
      };
    },
    fmt(x, d = 3) {
      if (!isFinite(x)) return String(x);
      const ax = Math.abs(x);
      if (ax !== 0 && (ax < 1e-3 || ax >= 1e6)) return x.toExponential(2);
      return x.toFixed(d);
    },
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    uid: (() => { let n = 1; return (p) => (p || 's') + (n++).toString(36) + '_' + ((fmix32(n * 7919) >>> 0) % 46656).toString(36); })(),
    deepCopy: (o) => JSON.parse(JSON.stringify(o)),
  };

  RF.V = V; RF.M3 = M3; RF.U = U;
  RF.rng = { fmix32, streamSeed, Rng };
  RF.hash = { bytes: hashBytes, f64: hashFloat64 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
