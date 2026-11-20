/* Flux mosaic: a deterministic, static reflector designer.
 * Source-space Voronoi cells catch disjoint cones; paint-space cells supply aims and flux.
 * Focused ellipsoids do the imaging, with two-vergence defocus only when a target cell needs it.
 * There is deliberately no ray tracing in solve(). */
(function () {
  'use strict';
  const V = RF.V;
  const dot = V.dot, add = V.add, sub = V.sub, mul = V.mul, norm = V.norm;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  function fibonacci(n) {
    const out = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * i;
      out.push([r * Math.cos(t), r * Math.sin(t), z]);
    }
    return out;
  }

  // Weighted Lloyd cells. The source uses intensity squared as its Lloyd weight: in two
  // dimensions that makes cell solid angle vary as 1/intensity, hence equalises lumens.
  function sphericalCells(src, B, dirs, weights, K) {
    K = Math.min(K, dirs.length);
    if (!K) return [];
    const cs = [dirs[weights.indexOf(Math.max(...weights))].slice()];
    const md = new Float64Array(dirs.length).fill(Infinity);
    while (cs.length < K) {
      const c = cs[cs.length - 1]; let bi = 0, bv = -1;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i], q = dist2(d, c); if (q < md[i]) md[i] = q;
        const v = md[i] * weights[i] * weights[i]; if (v > bv) { bv = v; bi = i; }
      }
      cs.push(dirs[bi].slice());
    }
    let own = new Int32Array(dirs.length).fill(-1);
    const iters = K > 180 ? 5 : 9;
    for (let it = 0; it < iters; it++) {
      const sums = cs.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < dirs.length; i++) {
        let bj = 0, bd = -Infinity;
        for (let j = 0; j < cs.length; j++) { const q = dot(dirs[i], cs[j]); if (q > bd) { bd = q; bj = j; } }
        own[i] = bj; const w = weights[i] * weights[i], s = sums[bj], d = dirs[i];
        s[0] += w * d[0]; s[1] += w * d[1]; s[2] += w * d[2]; s[3] += w;
      }
      for (let j = 0; j < cs.length; j++) {
        const s = sums[j]; if (s[3] > 0) cs[j] = norm([s[0], s[1], s[2]]);
        else { // deterministic revival of an empty cell at the worst-served direction
          let bi = 0, bv = -1; for (let i = 0; i < dirs.length; i++) { const q = md[i] * weights[i] * weights[i]; if (q > bv) { bv = q; bi = i; } }
          cs[j] = dirs[bi].slice();
        }
      }
    }
    const cells = cs.map((c) => ({ c, members: [], flux: 0 }));
    for (let i = 0; i < dirs.length; i++) {
      let bj = 0, bd = -Infinity;
      for (let j = 0; j < cs.length; j++) { const q = dot(dirs[i], cs[j]); if (q > bd) { bd = q; bj = j; } }
      cells[bj].members.push(i); cells[bj].flux += weights[i];
    }
    return cells.filter((c) => c.members.length);
  }

  function targetCells(input, T, K) {
    const R = input.paint.res, p = input.paint.cells, pts = [], wt = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i; if (!(p[k] > 0)) continue;
      const uv = RF.Engine.cellCenter(T, i, j); pts.push([uv[0], uv[1], k]); wt.push(p[k]);
    }
    K = Math.min(K, pts.length); if (!K) return [];
    const cs = [pts[wt.indexOf(Math.max(...wt))].slice(0, 2)], md = new Float64Array(pts.length).fill(Infinity);
    while (cs.length < K) {
      const c = cs[cs.length - 1]; let bi = 0, bv = -1;
      for (let i = 0; i < pts.length; i++) {
        const q = dist2([pts[i][0], pts[i][1], 0], [c[0], c[1], 0]); if (q < md[i]) md[i] = q;
        const v = md[i] * wt[i]; if (v > bv) { bv = v; bi = i; }
      }
      cs.push(pts[bi].slice(0, 2));
    }
    for (let it = 0; it < 12; it++) {
      const sums = cs.map(() => [0, 0, 0]);
      for (let i = 0; i < pts.length; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < cs.length; j++) { const q = (pts[i][0] - cs[j][0]) ** 2 + (pts[i][1] - cs[j][1]) ** 2; if (q < bd) { bd = q; bj = j; } }
        const s = sums[bj]; s[0] += wt[i] * pts[i][0]; s[1] += wt[i] * pts[i][1]; s[2] += wt[i];
      }
      for (let j = 0; j < cs.length; j++) if (sums[j][2] > 0) cs[j] = [sums[j][0] / sums[j][2], sums[j][1] / sums[j][2]];
    }
    const cells = cs.map((c) => ({ c, mass: 0, xx: 0, yy: 0, members: [] }));
    for (let i = 0; i < pts.length; i++) {
      let bj = 0, bd = Infinity;
      for (let j = 0; j < cs.length; j++) { const q = (pts[i][0] - cs[j][0]) ** 2 + (pts[i][1] - cs[j][1]) ** 2; if (q < bd) { bd = q; bj = j; } }
      const a = cells[bj], w = wt[i]; a.mass += w; a.members.push(pts[i][2]);
    }
    for (const a of cells) {
      for (const k of a.members) { const i = k % R, j = (k / R) | 0, uv = RF.Engine.cellCenter(T, i, j), w = p[k]; a.xx += w * (uv[0] - a.c[0]) ** 2; a.yy += w * (uv[1] - a.c[1]) ** 2; }
      if (a.mass > 0) { a.xx /= a.mass; a.yy /= a.mass; }
    }
    return cells.filter((a) => a.mass > 0);
  }

  function boostWashEdges(input, T, wanted, amount) {
    const R = input.paint.res, p = input.paint.cells, scale = 0.5 * (2 * T.half / Math.sqrt(Math.max(1, wanted))), out = new Array(p.length);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const k = j * R + i, uv = RF.Engine.cellCenter(T, i, j), d = Math.max(0, Math.min(T.half - Math.abs(uv[0]), T.half - Math.abs(uv[1]))); out[k] = p[k] * (1 + amount * Math.exp(-d / scale)); }
    return Object.assign({}, input, { paint: { res: R, cells: out } });
  }

  function sharpenTone(input, ker, amount) {
    if (!(amount > 0)) return input;
    const R = input.paint.res, src = input.paint.cells, out = src.slice(), rad = Math.max(1, Math.round(ker.cells / 2));
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i; if (!(src[k] > 0)) continue; let sum = 0, n = 0, edge = false;
      for (let b = -rad; b <= rad; b++) for (let a = -rad; a <= rad; a++) { const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= R || jj >= R || src[jj * R + ii] <= 0) { edge = true; continue; }
        sum += src[jj * R + ii]; n++;
      }
      if (!edge && n) out[k] = clamp(src[k] + amount * (src[k] - sum / n), 0.12 * src[k], 1.8 * src[k]);
    }
    return Object.assign({}, input, { paint: { res: R, cells: out } });
  }

  function insetTargets(cells, input, T, amount) {
    if (!(amount > 0)) return;
    const R = input.paint.res, p = input.paint.cells, cw = 2 * T.half / R, band = amount / cw + 1.5, search = Math.ceil(band + 2);
    for (const a of cells) {
      let vx = 0, vy = 0, sw = 0;
      for (const k of a.members) {
        const i = k % R, j = (k / R) | 0; let bd = Infinity, bx = 0, by = 0;
        for (let b = -search; b <= search; b++) for (let x = -search; x <= search; x++) {
          const ii = i + x, jj = j + b, d = Math.hypot(x, b); if (d >= bd || d > search) continue;
          if (ii < 0 || jj < 0 || ii >= R || jj >= R || p[jj * R + ii] <= 0) { bd = d; bx = x; by = b; }
        }
        if (bd <= band && bd > 0) { const w = p[k] * (band + 1 - bd) / bd; vx -= bx * w; vy -= by * w; sw += w; }
      }
      const l = Math.hypot(vx, vy); if (l > 1e-9) { a.c[0] += amount * vx / l; a.c[1] += amount * vy / l; }
    }
  }

  function balanceFootprints(models, input, T, passes) {
    const R = input.paint.res, paint = input.paint.cells, n = R * R, cw = 2 * T.half / R, pmax = Math.max(...paint), typ = paint.reduce((s, x) => s + x, 0) / Math.max(1, paint.filter((x) => x > 0).length);
    const M = [];
    for (const m of models) {
      const cv = m.cov, sx = Math.sqrt(Math.max(cw * cw / 12, cv[0])), sy = Math.sqrt(Math.max(cw * cw / 12, cv[1])), idx = [], val = [];
      const cx = m.center[0], cy = m.center[1], rx = Math.min(R, Math.ceil(3 * sx / cw)), ry = Math.min(R, Math.ceil(3 * sy / cw));
      const ci = Math.floor((cx + T.half) / cw), cj = Math.floor((cy + T.half) / cw); let sum = 0;
      for (let j = Math.max(0, cj - ry); j <= Math.min(R - 1, cj + ry); j++) for (let i = Math.max(0, ci - rx); i <= Math.min(R - 1, ci + rx); i++) {
        const uv = RF.Engine.cellCenter(T, i, j), z = ((uv[0] - cx) / sx) ** 2 + ((uv[1] - cy) / sy) ** 2, w = Math.exp(-0.5 * z);
        idx.push(j * R + i); val.push(w); sum += w;
      }
      if (sum > 0) { for (let k = 0; k < val.length; k++) val[k] /= sum; M.push(Object.assign({}, m, { idx, val })); }
    }
    if (!M.length) return 1;
    const E = new Float64Array(n), W = new Float64Array(n);
    for (let k = 0; k < n; k++) W[k] = paint[k] > 0 ? 1 / Math.max(0.12 * pmax, paint[k]) : 0.06 / Math.max(1e-9, typ);
    let maxChange = 1;
    for (let it = 0; it < passes; it++) {
      E.fill(0); for (const m of M) for (let q = 0; q < m.idx.length; q++) E[m.idx[q]] += m.flux * m.val[q];
      let sp = 0, se = 0; for (let k = 0; k < n; k++) if (paint[k] > 0) { sp += paint[k]; se += E[k]; }
      const alpha = sp / Math.max(1e-300, se); maxChange = 1;
      for (const m of M) {
        let num = 0, den = 0;
        for (let q = 0; q < m.idx.length; q++) { const k = m.idx[q], b = m.val[q]; num += W[k] * b * paint[k]; den += W[k] * b * alpha * E[k]; }
        const gain = clamp(Math.pow(num / Math.max(1e-300, den), 0.45), 0.72, 1.38);
        m.flux *= gain; m.gain = (m.gain || 1) * gain; maxChange = Math.max(maxChange, gain, 1 / gain);
      }
    }
    for (const m of M) {
      const gain = clamp(m.gain || 1, 0.55, 2.2), s = Math.sqrt(gain); m.f.clip.pts3 = m.f.clip.pts3.map((p) => add(m.f.P, mul(sub(p, m.f.P), s)));
    }
    return maxChange;
  }

  function clipHalf(poly, a, b, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], sp = a * p[0] + b * p[1] + c, sq = a * q[0] + b * q[1] + c;
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out;
  }
  function memberPoly(cells, dirs, j, src) {
    // A Voronoi cell on the rim of an emitting hemisphere is unbounded. Hull the
    // directions that actually occur instead, then open the sampling cracks a little.
    const cell = cells[j], c = cell.c, basis = V.basis(c), e1 = basis[0], e2 = basis[1], pp = [];
    for (const i of cell.members) {
      const d = dirs[i], z = dot(d, c); if (!(z > 0.05)) continue;
      pp.push([dot(d, e1) / z, dot(d, e2) / z]);
    }
    if (pp.length < 3) return [];
    const idx = pp.map((_, i) => i).sort((a, b) => pp[a][0] - pp[b][0] || pp[a][1] - pp[b][1]);
    const cross = (o, a, b) => (pp[a][0] - pp[o][0]) * (pp[b][1] - pp[o][1]) - (pp[a][1] - pp[o][1]) * (pp[b][0] - pp[o][0]);
    const lo = [], hi = [];
    for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1)), mx = hull.reduce((s, i) => s + pp[i][0], 0) / hull.length, my = hull.reduce((s, i) => s + pp[i][1], 0) / hull.length;
    let poly = hull.map((i) => [mx + (pp[i][0] - mx) * 1.09, my + (pp[i][1] - my) * 1.09]);
    if (RF.Source.thetaMax(src) <= Math.PI / 2 + 1e-8) {
      const a = src ? RF.Source.frame(src).a : [0, 0, 1];
      poly = clipHalf(poly, dot(e1, a), dot(e2, a), dot(c, a)); // the exact emitting hemisphere
    }
    return poly.map((p) => norm([c[0] + p[0] * e1[0] + p[1] * e2[0], c[1] + p[0] * e1[1] + p[1] * e2[1], c[2] + p[0] * e1[2] + p[1] * e2[2]]));
  }

  function sourceImage(src, P, Z, T) {
    const fr = RF.Source.frame(src), n = norm(add(norm(sub(src.pos, P)), norm(sub(Z, P)))), q = [];
    const at = (u, v, a) => add(src.pos, add(mul(fr.u, u), add(mul(fr.v, v), mul(fr.a, a))));
    if (src.kind === 'planar') {
      if (src.shape === 'disc') {
        q.push(src.pos.slice());
        for (let ring = 1; ring <= 2; ring++) for (let i = 0; i < 12; i++) { const t = i * Math.PI / 6, r = src.radius * Math.sqrt(ring / 2); q.push(at(r * Math.cos(t), r * Math.sin(t), 0)); }
      } else for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) q.push(at((i / 4 - 0.5) * (src.w || 0), (j / 4 - 0.5) * (src.h || 0), 0));
    } else {
      const r = src.radius || 0, l = src.shape === 'cylinder' ? (src.length || 0) / 2 : 0;
      q.push(src.pos.slice()); for (let i = 0; i < 12; i++) { const t = i * Math.PI / 6; q.push(at(0.8 * r * Math.cos(t), 0.8 * r * Math.sin(t), (i % 3 - 1) * 0.7 * l)); }
    }
    const uv = [];
    for (const s of q) {
      const d = norm(sub(P, s)), k = 2 * dot(d, n), r = [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]], den = dot(r, T.n);
      if (Math.abs(den) < 1e-10) continue; const t = dot(sub(T.C, P), T.n) / den; if (!(t > 0)) continue;
      const X = add(P, mul(r, t)), dx = sub(X, T.C); uv.push([dot(dx, T.tu), dot(dx, T.tv)]);
    }
    if (uv.length < 2) return [0, 0];
    const mx = uv.reduce((s, p) => s + p[0], 0) / uv.length, my = uv.reduce((s, p) => s + p[1], 0) / uv.length;
    return [uv.reduce((s, p) => s + (p[0] - mx) ** 2, 0) / uv.length, uv.reduce((s, p) => s + (p[1] - my) ** 2, 0) / uv.length];
  }

  function apertureStd(f, ah, tv) {
    let ax = sub(tv, mul(ah, dot(tv, ah))); if (V.len(ax) < 1e-8) ax = V.basis(ah)[0]; ax = norm(ax);
    const ay = norm(V.cross(ah, ax)), vals = [[], []];
    for (const p of f.clip.pts3) { const d = sub(p, f.P); vals[0].push(dot(d, ax)); vals[1].push(dot(d, ay)); }
    const sd = vals.map((a) => { const m = a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); return 0.75 * Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length)); });
    return { ax, sd };
  }

  function directShield(input, T, B, keep) {
    const src = input.source, env = input.envelope, S = src.pos, d0 = keep + Math.max(0.6, 0.04 * Math.min(...env.half));
    const P = add(S, mul(B, d0)); if (!RF.Geo.envInside(env, P, -0.002)) return null;
    const basis = V.basis(B), e1 = basis[0], e2 = basis[1], pp = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const X = add(T.C, add(mul(T.tu, a * T.half), mul(T.tv, b * T.half))), d = norm(sub(X, S)), den = dot(d, B); if (!(den > 1e-6)) continue;
      const Q = add(S, mul(d, d0 / den)), q = sub(Q, P); pp.push([dot(q, e1), dot(q, e2)]);
    }
    if (pp.length < 4) return null;
    const pad = 0.6 + 1.4 * RF.Source.boundingRadius(src);
    const x0 = Math.min(...pp.map((q) => q[0])) - pad, x1 = Math.max(...pp.map((q) => q[0])) + pad;
    const y0 = Math.min(...pp.map((q) => q[1])) - pad, y1 = Math.max(...pp.map((q) => q[1])) + pad;
    let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (env.shape === 'box') {
      // Clip the mask to the box in its own (affine) plane coordinates. A partial
      // mask is useful; a rectangle sticking through a nearby wall is not legal.
      for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
        const a = -sg * e1[ax], b = -sg * e2[ax], c = env.half[ax] * 0.998 - sg * (P[ax] - env.center[ax]);
        poly = clipHalf(poly, a, b, c);
      }
    }
    if (poly.length < 3) return null;
    const at = (x, y) => add(P, add(mul(e1, x), mul(e2, y))), pts3 = poly.map((q) => at(q[0], q[1]));
    if (pts3.some((q) => !RF.Geo.envInside(env, q, -0.0002) || V.dist(q, S) < keep + 0.005)) return null;
    return { type: 'plane', id: 'direct-mask', P, n: B, clip: { kind: 'poly', pts3 }, optics: { interaction: 'absorb', reflectivity: input.limits.reflectivity, twoSided: true } };
  }

  function aimRadius(a, x, u) {
    const b = Math.exp(x), c2 = 2 * a.c;
    return b * (b + c2) / (2 * b + c2 * (1 - (u[0] * a.d[0] + u[1] * a.d[1] + u[2] * a.d[2])));
  }

  function chol(a, b, n) {
    for (let j = 0; j < n; j++) {
      let s = a[j * n + j]; for (let k = 0; k < j; k++) s -= a[j * n + k] ** 2; if (!(s > 1e-300)) return null;
      const dj = Math.sqrt(s); a[j * n + j] = dj;
      for (let i = j + 1; i < n; i++) { let t = a[i * n + j]; for (let k = 0; k < j; k++) t -= a[i * n + k] * a[j * n + k]; a[i * n + j] = t / dj; }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= a[i * n + k] * y[k]; y[i] = t / a[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= a[k * n + i] * y[k]; y[i] = t / a[i * n + i]; }
    return y;
  }

  // Damped Newton on the entropic optimal-transport dual. Increasing log-beta
  // enlarges that ellipsoid and shrinks its cell in the lower envelope.
  function transport(dirs, flux, aims, rEnv, keep, x0) {
    const J = aims.length, nd = dirs.length, x = x0 ? new Float64Array(x0) : new Float64Array(J).fill(Math.log(40)), want = aims.map((a) => a.g);
    const gs = want.reduce((s, x) => s + x, 0), tot = flux.reduce((s, x) => s + x, 0);
    for (let j = 0; j < J; j++) want[j] = want[j] / gs * tot;
    const b = new Float64Array(J), q = new Float64Array(J), gb = new Float64Array(J), F = new Float64Array(J), M = new Float64Array(J * J);
    const lr = new Float64Array(J), pp = new Float64Array(J), gg = new Float64Array(J), res = new Float64Array(J), res2 = new Float64Array(J), xo = new Float64Array(J), Asym = new Float64Array(J * J), R = new Float64Array(J);
    const setB = () => { for (let j = 0; j < J; j++) { const z = Math.exp(x[j]), c2 = 2 * aims[j].c; b[j] = z; q[j] = z * (z + c2); gb[j] = 1 + z / (z + c2); } };
    const rOf = (i, j) => { const a = aims[j], c2 = 2 * a.c, u = dirs[i]; return q[j] / (2 * b[j] + c2 * (1 - (u[0] * a.d[0] + u[1] * a.d[1] + u[2] * a.d[2]))); };
    function evalF(tau, withM) {
      setB(); F.fill(0); if (withM) M.fill(0); const cut = 18 * tau;
      for (let i = 0; i < nd; i++) {
        let lm = Infinity; for (let j = 0; j < J; j++) { const l = Math.log(Math.max(1e-300, rOf(i, j))); lr[j] = l; if (l < lm) lm = l; }
        let zs = 0; for (let j = 0; j < J; j++) { const p = lr[j] - lm <= cut ? Math.exp(-(lr[j] - lm) / tau) : 0; pp[j] = p; zs += p; }
        for (let j = 0; j < J; j++) { pp[j] /= zs; F[j] += flux[i] * pp[j]; }
        if (withM) {
          for (let j = 0; j < J; j++) { const a = aims[j], c2 = 2 * a.c, u = dirs[i]; gg[j] = gb[j] - 2 * b[j] / (2 * b[j] + c2 * (1 - (u[0] * a.d[0] + u[1] * a.d[1] + u[2] * a.d[2]))); }
          const f = flux[i] / tau;
          for (let j = 0; j < J; j++) {
            const pj = pp[j]; if (pj < 1e-7) continue; M[j * J + j] += f * gg[j] * pj * (1 - pj);
            for (let k = 0; k < J; k++) if (k !== j && pp[k] >= 1e-7) M[j * J + k] -= f * gg[k] * pj * pp[k];
          }
        }
      }
    }
    const normErr = (r) => { let s = 0; for (let j = 0; j < J; j++) s += r[j] * r[j] / (want[j] * want[j]); return Math.sqrt(s / J); };
    for (const tau of [0.1, 0.03, 0.01, 0.003]) {
      let mu = 1e-3, revived = 0;
      for (let it = 0; it < 12; it++) {
        evalF(tau, true); for (let j = 0; j < J; j++) res[j] = F[j] - want[j];
        let worst = 0; for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(res[j]) / want[j]); if (worst < (tau === 0.003 ? 0.04 : 0.07)) break;
        let dead = 0; for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) dead++;
        if (dead && revived < 5) {
          revived++; const mr = new Float64Array(J).fill(Infinity), isDead = new Uint8Array(J);
          for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) isDead[j] = 1;
          for (let i = 0; i < nd; i++) {
            let rm = Infinity; for (let j = 0; j < J; j++) { const r = rOf(i, j); R[j] = r; if (r < rm) rm = r; }
            for (let j = 0; j < J; j++) if (isDead[j]) mr[j] = Math.min(mr[j], R[j] / rm);
          }
          for (let j = 0; j < J; j++) if (isDead[j] && mr[j] < Infinity) x[j] -= Math.max(0, Math.log(mr[j]) / gb[j]) + 3 * tau;
          it--; continue;
        }
        const n0 = normErr(res); let dm = 0; for (let j = 0; j < J; j++) dm += M[j * J + j]; dm = dm / J + 1e-300;
        let ok = false;
        for (let tries = 0; tries < 7 && !ok; tries++, mu *= 10) {
          for (let i = 0; i < J; i++) { for (let j = 0; j < J; j++) Asym[i * J + j] = 0.5 * (M[i * J + j] + M[j * J + i]); Asym[i * J + i] += mu * (M[i * J + i] + 1e-3 * dm); }
          const dl = chol(Asym, res, J); if (!dl) continue; let mean = 0; for (let j = 0; j < J; j++) mean += dl[j]; mean /= J;
          for (let j = 0; j < J; j++) dl[j] = clamp(dl[j] - mean, -0.3, 0.3);
          for (let step = 1; step > 0.05 && !ok; step *= 0.5) {
            xo.set(x); for (let j = 0; j < J; j++) x[j] += step * dl[j]; evalF(tau, false); for (let j = 0; j < J; j++) res2[j] = F[j] - want[j];
            if (normErr(res2) < n0 * (1 - 1e-3 * step)) { ok = true; mu = Math.max(1e-6, mu * 0.005); } else x.set(xo);
          }
        }
        if (!ok) break;
      }
    }
    return x;
  }
  function assignAims(dirs, flux, aims, x) {
    const own = new Int32Array(dirs.length).fill(-1), rr = new Float64Array(dirs.length), got = new Float64Array(aims.length);
    for (let i = 0; i < dirs.length; i++) {
      let bj = -1, br = Infinity;
      for (let j = 0; j < aims.length; j++) { const r = aimRadius(aims[j], x[j], dirs[i]); if (r > 0 && r < br) { br = r; bj = j; } }
      own[i] = bj; rr[i] = br; if (bj >= 0) got[bj] += flux[i];
    }
    return { own, rr, got };
  }

  function solveNatural(input, settings) {
    const src = input.source, S = src.pos, env = input.envelope, refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), T = RF.Engine.designFrame(input.target);
    const B = norm(sub(T.C, S)), notes = [], surfaces = [], intent = [];
    const shield = settings.directMask ? directShield(input, T, B, keep) : null; if (shield) surfaces.push(shield);
    if (!input.paint.cells.some((x) => x > 0)) return { surfaces, intent, notes: ['nothing is painted'] };
    const cap = input.limits.maxFacets, wanted = cap <= 24 ? cap : Math.round(cap * settings.aimFraction);
    const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const kind = RF.Modes.classify(input.paint.cells, input.paint.res, ker.cells).kind;
    const coverage = input.paint.cells.filter((x) => x > 0).length / input.paint.cells.length, fullWash = kind === 'wash' && coverage > 0.90;
    const planning = kind === 'hotspot' ? sharpenTone(input, ker, settings.toneSharp) : fullWash ? boostWashEdges(input, T, wanted, settings.washEdgeBoost) : input;
    const tc = targetCells(planning, T, Math.min(120, wanted)); if (!tc.length) return { surfaces, intent, notes: ['no painted cells'] };
    const fitShare = kind === 'text' ? settings.textFit : settings.fitShare, growShell = kind === 'text' ? settings.textGrow : settings.growShell;
    const imageFill = kind === 'wash' ? settings.washFill : settings.imageFill;
    insetTargets(tc, input, T, settings.edgeInset * ker.mm * clamp(ker.cells / 5, 0, 1));
    const aims = tc.map((t) => { const Z = add(T.C, add(mul(T.tu, t.c[0]), mul(T.tv, t.c[1]))); return { t, Z, d: norm(sub(Z, S)), c: V.dist(Z, S), g: t.mass }; });
    const M = Math.max(3200, Math.min(7000, 40 * aims.length)), dirs = [], weights = [], rEnvs = [];
    const fr = RF.Source.frame(src), itot = RF.Source.totalIntegral(src);
    for (const d of fibonacci(M)) {
      const I = RF.Source.intensity(src, Math.acos(clamp(dot(d, fr.a), -1, 1))); if (!(I > 0) || dot(d, B) > settings.bendCos) continue;
      const iv = RF.Geo.envInterval(env, S, d), rE = iv && iv[1] - settings.wallMargin; if (!(rE > keep + 0.5)) continue;
      dirs.push(d); weights.push(src.power * I / itot); rEnvs.push(rE);
    }
    if (!dirs.length) return { surfaces, intent, notes: ['no usable emission directions'] };
    const x = transport(dirs, weights, aims, rEnvs, keep);
    let as = assignAims(dirs, weights, aims, x);
    // One homothetic fit keeps the supporting surface continuous. A small
    // fraction of outlying directions may be left uncovered, never moved onto
    // a different (and therefore wrong-aimed) facet.
    const ratios = []; for (let i = 0; i < dirs.length; i++) if (as.own[i] >= 0) ratios.push([as.rr[i] / rEnvs[i], weights[i]]);
    ratios.sort((a, b) => a[0] - b[0]); let acc = 0, q = ratios.length ? ratios[ratios.length - 1][0] : 1, total = weights.reduce((s, x) => s + x, 0);
    for (const r of ratios) { acc += r[1]; if (acc >= fitShare * total) { q = r[0]; break; } }
    if (q > 1) for (let j = 0; j < aims.length; j++) x[j] -= Math.log(Math.max(0.05, q * 1.003));
    as = assignAims(dirs, weights, aims, x);
    for (let round = 0; round < 3; round++) {
      const valid = []; for (let i = 0; i < dirs.length; i++) if (as.own[i] >= 0 && as.rr[i] <= rEnvs[i] && as.rr[i] >= keep + 0.08) valid.push(i);
      if (valid.length <= aims.length * 3) break;
      const vd = valid.map((i) => dirs[i]), vw = valid.map((i) => weights[i]), vr = valid.map((i) => rEnvs[i]);
      x.set(transport(vd, vw, aims, vr, keep, x)); as = assignAims(dirs, weights, aims, x);
    }
    if (q < 1 && growShell) { for (let j = 0; j < aims.length; j++) x[j] -= Math.log(Math.max(0.05, q * 1.003)); as = assignAims(dirs, weights, aims, x); }
    const cells = aims.map((a, j) => ({ c: [0, 0, 0], members: [], flux: 0 }));
    for (let i = 0; i < dirs.length; i++) {
      const j = as.own[i]; if (j < 0 || as.rr[i] > rEnvs[i] || as.rr[i] < keep + 0.08) continue;
      const c = cells[j]; c.members.push(i); c.flux += weights[i]; c.c = add(c.c, mul(dirs[i], weights[i]));
    }
    for (const c of cells) if (c.members.length) c.c = norm(c.c);
    let made = 0; const models = [];
    for (let j = 0; j < aims.length; j++) {
      const cell = cells[j], a = aims[j]; if (cell.members.length < 3) continue;
      const poly = memberPoly([cell], dirs, 0, src); if (poly.length < 3) continue;
      const r = aimRadius(a, x[j], cell.c); if (!(r > keep && r < 1e7)) continue;
      const P = add(S, mul(cell.c, r)), Z = a.Z, di = V.dist(P, Z), pts3 = [];
      for (const w of poly) { const rw = aimRadius(a, x[j], w); if (!(rw > 0 && rw < 1e7)) continue; pts3.push(add(S, mul(w, rw))); }
      if (pts3.length < 3) continue;
      const f = { type: 'facet', id: 'F' + made, group: 'A', P, S0: S.slice(), Z, flat: false, di, aimIndex: j,
        clip: { kind: 'poly', pts3: pts3.map((q) => add(P, mul(sub(q, P), settings.cellFill))) }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      const t = a.t, nat = sourceImage(src, P, Z, T), desired = [imageFill ** 2 * (t.xx + (2 * T.half / input.paint.res) ** 2 / 12), imageFill ** 2 * (t.yy + (2 * T.half / input.paint.res) ** 2 / 12)];
      if (desired[0] > nat[0] * 1.04 || desired[1] > nat[1] * 1.04) {
        const ap = apertureStd(f, norm(sub(Z, P)), T.tu), vg = [0, 1].map((k) => {
          const extra = Math.max(0, desired[k] - nat[k]); if (!(extra > 0) || !(ap.sd[k] > 1e-5)) return 1 / di;
          return -Math.sqrt(extra) / (ap.sd[k] * di) * settings.defocusGain;
        }); f.vg = vg; f.ax = ap.ax;
      }
      surfaces.push(f); intent.push({ facet: f.id, cells: t.members.map((k) => [k, input.paint.cells[k]]) });
      models.push({ f, flux: cell.flux, cov: f.vg ? desired : nat, center: [dot(sub(Z, T.C), T.tu), dot(sub(Z, T.C), T.tv)] }); made++;
    }
    if (settings.modelPasses > 0 && kind !== 'wash') balanceFootprints(models, input, T, settings.modelPasses);
    // Trim only genuine edge/sag violations; do not change the supporting radii.
    const reflectors = () => surfaces.filter((s) => s.type === 'facet');
    for (let pass = 0; pass < 10; pass++) {
      const fs = reflectors(); if (!fs.length) break; const G = RF.Geo.compile(fs), bad = new Set();
      for (let k = 0; k < G.n; k++) for (const poly of RF.Geo.outline(G, k)) for (const p of poly) if (!RF.Geo.envInside(env, p, -0.0002) || V.dist(p, S) < keep + 0.015) bad.add(G.metas[k].id);
      if (!bad.size) break;
      for (const f of fs) if (bad.has(f.id)) f.clip.pts3 = f.clip.pts3.map((p) => add(f.P, mul(sub(p, f.P), 0.84)));
      if (pass === 9) for (let i = surfaces.length - 1; i >= 0; i--) if (bad.has(surfaces[i].id)) surfaces.splice(i, 1);
    }
    const live = new Set(surfaces.map((s) => s.id)); for (let i = intent.length - 1; i >= 0; i--) if (!live.has(intent[i].facet)) intent.splice(i, 1);
    let placed = reflectors().length, decals = 0;
    if (settings.decals) {
      const covered = new Set(reflectors().map((f) => f.aimIndex)), missing = aims.map((a, j) => covered.has(j) ? -1 : j).filter((j) => j >= 0);
      if (missing.length) {
        const paint = new Array(input.paint.cells.length).fill(0); for (const j of missing) for (const k of aims[j].t.members) paint[k] = input.paint.cells[k];
        const subInput = Object.assign({}, input, { paint: { res: input.paint.res, cells: paint }, limits: Object.assign({}, input.limits, { maxFacets: missing.length }) });
        const extra = solveWall(subInput, Object.assign({}, settings, { directMask: false }));
        for (const f of extra.surfaces) if (f.type === 'facet' && placed + decals < input.limits.maxFacets) { f.id = 'D' + decals++; f.aimIndex = -1; surfaces.push(f); }
        for (const it of extra.intent) if (it.facet !== null && surfaces.some((f) => f.id === 'D' + it.facet.slice(1))) intent.push(Object.assign({}, it, { facet: 'D' + it.facet.slice(1) }));
      }
    }
    placed = reflectors().length;
    notes.push(placed + ' ellipsoid cells (' + decals + ' independent gap-fill facets); global shell scale ' + q.toFixed(3) + '; direct target cone ' + (shield ? 'masked' : 'unmasked'));
    return { surfaces, intent, notes };
  }

  function solveWall(input, settings) {
    const src = input.source, S = src.pos, env = input.envelope, refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), T = RF.Engine.designFrame(input.target);
    const B = norm(sub(T.C, S)), notes = [], surfaces = [], intent = [];
    const shield = settings.directMask ? directShield(input, T, B, Math.max(env.keepOut || 0, settings.minDistance || 0)) : null;
    if (shield) surfaces.push(shield);
    if (!input.paint.cells.some((x) => x > 0)) return { surfaces, intent, notes: ['nothing is painted'] };

    const M = Math.max(3500, Math.min(10000, 45 * input.limits.maxFacets)), dirs = [], weights = [], rEnvs = [];
    const fr = RF.Source.frame(src), itot = RF.Source.totalIntegral(src), bend = settings.bendCos;
    for (const d of fibonacci(M)) {
      const ct = clamp(dot(d, fr.a), -1, 1), I = RF.Source.intensity(src, Math.acos(ct)); if (!(I > 0) || dot(d, B) > bend) continue;
      const iv = RF.Geo.envInterval(env, S, d), rE = iv && iv[1] - settings.wallMargin; if (!(rE > keep + 0.8)) continue;
      dirs.push(d); weights.push(src.power * I / itot); rEnvs.push(rE); // common factor 4π/M is immaterial
    }
    if (!dirs.length) { notes.push('no non-grazing emitting directions have room for a facet'); return { surfaces, intent, notes }; }
    const K = Math.min(input.limits.maxFacets, dirs.length), sc = sphericalCells(src, B, dirs, weights, K);
    const tc = targetCells(input, T, sc.length);
    if (!tc.length) return { surfaces, intent, notes: ['no target clusters'] };
    const ss = sc.slice().sort((a, b) => b.flux - a.flux), tt = tc.slice().sort((a, b) => b.mass - a.mass);
    const pairs = ss.map((s, i) => ({ s, t: tt[Math.min(i, tt.length - 1)], j: sc.indexOf(s) }));
    const cellPolys = sc.map((_, j) => memberPoly(sc, dirs, j, src));
    let made = 0, failed = 0;
    for (const pair of pairs) {
      const cell = pair.s, target = pair.t, d = cell.c;
      const iv = RF.Geo.envInterval(env, S, d), rEnv = iv[1] - settings.wallMargin;
      if (!(rEnv > keep + 0.5)) continue;
      const Z = add(T.C, add(mul(T.tu, target.c[0]), mul(T.tv, target.c[1])));
      let r = rEnv, P, di, f = null;
      // Move the whole angular cell inwards, rather than cutting its aperture away
      // at the wall. Its caught flux is unchanged; only its LED image gets larger.
      for (let attempt = 0; attempt < 13; attempt++) {
        P = add(S, mul(d, r)); di = V.dist(P, Z); if (!(di > 0)) break;
        const fq = RF.Geo.facetQuadric(P, S, Z, di), pts3 = [];
        for (const w of cellPolys[pair.j]) {
          const roots = RF.Geo.quadricRay(fq.A, fq.b, P, S, w).filter((x) => x > 1e-7 && isFinite(x)); if (!roots.length) continue;
          roots.sort((a, b) => Math.abs(a - r) - Math.abs(b - r)); pts3.push(add(S, mul(w, roots[0])));
        }
        if (pts3.length < 3) break;
        f = { type: 'facet', id: 'F' + made, group: 'A', P, S0: S.slice(), Z, flat: false, di,
          clip: { kind: 'poly', pts3: pts3.map((q) => add(P, mul(sub(q, P), settings.cellFill))) }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
        let legal = true, badE = 0, badK = 0;
        try {
          const G = RF.Geo.compile([f]);
          for (const poly of RF.Geo.outline(G, 0)) for (const q of poly) { if (!RF.Geo.envInside(env, q, -0.0002)) { legal = false; badE++; } if (V.dist(q, S) < keep + 0.03) { legal = false; badK++; } }
        } catch (e) { legal = false; }
        if (legal) break;
        const next = keep + (r - keep) * 0.80;
        if (next <= keep + 0.25 || r - next < 0.08) { f = null; break; }
        r = next; f = null;
      }
      if (!f) { failed++; continue; }
      const nat = sourceImage(src, P, Z, T), desired = [settings.imageFill ** 2 * (target.xx + (2 * T.half / input.paint.res) ** 2 / 12), settings.imageFill ** 2 * (target.yy + (2 * T.half / input.paint.res) ** 2 / 12)];
      if (desired[0] > nat[0] * 1.04 || desired[1] > nat[1] * 1.04) {
        const ap = apertureStd(f, norm(sub(Z, P)), T.tu), vg = [0, 1].map((a) => {
          const extra = Math.max(0, desired[a] - nat[a]); if (!(extra > 0) || !(ap.sd[a] > 1e-5)) return 1 / di;
          return -Math.sqrt(extra) / (ap.sd[a] * di) * settings.defocusGain;
        });
        f.vg = vg; f.ax = ap.ax;
      }
      surfaces.push(f); intent.push({ facet: f.id, cells: target.members.map((k) => [k, input.paint.cells[k]]) }); made++;
    }

    // The wall estimate is only a starting point: an oblique ellipsoid can sag past it.
    // Shrink just the offending tangent polygons, then drop anything still unsafe.
    const reflectors = () => surfaces.filter((s) => s.type === 'facet');
    for (let pass = 0; pass < 7; pass++) {
      let bad = false, badN = 0, G;
      try { G = RF.Geo.compile(reflectors()); } catch (e) { break; }
      for (let k = 0; k < G.n; k++) {
        const f = G.metas[k], surf = reflectors().find((s) => s.id === f.id); let fail = false, failE = false, failK = false, qrMin = Infinity, qrMax = 0;
        for (const poly of RF.Geo.outline(G, k)) for (const q of poly) { const qr = V.dist(q, S); qrMin = Math.min(qrMin, qr); qrMax = Math.max(qrMax, qr); if (!RF.Geo.envInside(env, q, -0.0002)) { fail = true; failE = true; } if (qr < keep + 0.02) { fail = true; failK = true; } }
        if (fail) { bad = true; badN++; surf.clip.pts3 = surf.clip.pts3.map((q) => add(surf.P, mul(sub(q, surf.P), 0.86))); }
      }
      if (!bad) break;
    }
    const safe = new Set(); {
      const fs = reflectors(); if (fs.length) {
        const G = RF.Geo.compile(fs);
        for (let k = 0; k < G.n; k++) { let ok = true; for (const poly of RF.Geo.outline(G, k)) for (const q of poly) if (!RF.Geo.envInside(env, q, -0.0002) || V.dist(q, S) < keep + 0.01) ok = false; if (ok) safe.add(G.metas[k].id); }
      }
    }
    const dropped = reflectors().filter((f) => !safe.has(f.id)).length;
    for (let i = surfaces.length - 1; i >= 0; i--) if (surfaces[i].type === 'facet' && !safe.has(surfaces[i].id)) surfaces.splice(i, 1);
    const live = new Set(surfaces.map((s) => s.id)); for (let i = intent.length - 1; i >= 0; i--) if (!live.has(intent[i].facet)) intent.splice(i, 1);
    notes.push((made - dropped) + ' focused source cells / ' + tc.length + ' paint clusters; direct target cone ' + (shield ? 'masked' : 'unmasked'));
    return { surfaces, intent, notes };
  }

  function solve(input, settings) {
    const sources = (input.sources && input.sources.length ? input.sources : [input.source]).filter((s) => s && (s.power || 0) > 0);
    if (sources.length > 1 && input.limits.maxFacets >= sources.length) {
      const surfaces = [], intent = [], notes = [], totalPower = sources.reduce((s, x) => s + x.power, 0);
      let left = input.limits.maxFacets;
      for (let k = 0; k < sources.length; k++) {
        const count = sources.length - k, cap = k === sources.length - 1 ? left : Math.max(1, Math.min(left - count + 1, Math.round(input.limits.maxFacets * sources[k].power / totalPower)));
        if (cap < 1) continue; left -= cap;
        const subInput = Object.assign({}, input, { source: sources[k], sources: [sources[k]], limits: Object.assign({}, input.limits, { maxFacets: cap }) });
        const out = solveNatural(subInput, settings), ids = new Map();
        for (const f of out.surfaces) { const old = f.id; f.id = 'E' + k + ':' + old; ids.set(old, f.id); surfaces.push(f); }
        for (const it of out.intent || []) intent.push(Object.assign({}, it, { facet: it.facet === null ? null : ids.get(it.facet) }));
      }
      if (surfaces.length) {
        const G = RF.Geo.compile(surfaces), bad = new Set();
        for (let k = 0; k < G.n; k++) for (const poly of RF.Geo.outline(G, k)) for (const p of poly) for (const src of sources) if (V.dist(p, src.pos) < (input.envelope.keepOut || 0) + 0.005) bad.add(G.metas[k].id);
        for (let i = surfaces.length - 1; i >= 0; i--) if (bad.has(surfaces[i].id)) surfaces.splice(i, 1);
        const live = new Set(surfaces.map((s) => s.id)); for (let i = intent.length - 1; i >= 0; i--) if (intent[i].facet !== null && !live.has(intent[i].facet)) intent.splice(i, 1);
      }
      notes.push(sources.length + ' emitters solved independently; ' + surfaces.filter((s) => (s.optics || {}).interaction !== 'absorb').length + ' reflector facets');
      return { surfaces, intent, notes };
    }
    return settings.method === 'wall' ? solveWall(input, settings) : solveNatural(input, settings);
  }

  function autoOverrides(input, goal) {
    const ker = RF.Photometry.achievableKernel(input), kind = RF.Modes.classify(input.paint.cells, input.paint.res, ker.cells).kind;
    let list;
    if (kind === 'text') list = [
      {}, { textFit: 0.40 }, { textFit: 0.60 }, { textGrow: false },
      { edgeInset: 0.20 }, { edgeInset: 0.80 }, { aimFraction: 0.40 }, { aimFraction: 0.65 },
      { modelPasses: 0 }, { modelPasses: 6 },
    ];
    else if (kind === 'wash') list = [
      {}, { washFill: 1.6 }, { washFill: 2.6 }, { washEdgeBoost: 0.5 }, { washEdgeBoost: 1.5 },
      { fitShare: 0.50, growShell: true }, { fitShare: 0.85 }, { aimFraction: 0.40 }, { aimFraction: 0.65 },
    ];
    else list = [
      {}, { fitShare: 0.50, growShell: true }, { fitShare: 0.85 }, { fitShare: 0.50 },
      { growShell: true }, { edgeInset: 0.25 }, { edgeInset: 0.75 },
      { aimFraction: 0.40 }, { aimFraction: 0.65 }, { imageFill: 1.70 },
      { modelPasses: 0 }, { toneSharp: 0.90 },
    ];
    if (goal === 'throw') list.push(kind === 'text' ? { textFit: 0.35, textGrow: true } : { fitShare: 0.35, growShell: true }, { cellFill: 1.0 }, { aimFraction: 0.35 });
    if (goal === 'efficient') list.push(kind === 'text' ? { textFit: 0.85, textGrow: false } : { fitShare: 0.90, growShell: false }, { bendCos: 0.94 }, { aimFraction: 0.65, cellFill: 1.0 });
    const seen = new Set(); return list.filter((o) => { const k = JSON.stringify(o); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function autoMerit(tr, goal) {
    const f = tr && tr.fidelity; if (!f || !isFinite(f.fidelity)) return -Infinity;
    const fid = clamp(f.fidelity, 0, 1), on = Math.max(0, f.onPaint || 0);
    if (goal === 'throw') return (tr.peakCd || 0) * Math.pow(Math.max(0.05, fid), 1.25) * (on > 0.005 ? 1 : 0.05);
    if (goal === 'efficient') return on * Math.pow(clamp((fid - 0.15) / 0.75, 0, 1), 2);
    return fid + 0.01 * Math.min(0.5, on) - (on < 0.001 ? 0.25 : 0); // faithful, with only a tie-scale light preference
  }

  function solveAuto(input, settings, tools) {
    const def = RF.Solvers.get('bench-kimik31pro-max-target--flux-mosaic'), base = RF.Solvers.defaults(def); base.minDistance = settings.minDistance;
    const goal = settings.goal, started = Date.now(), msBudget = tools && tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 60000;
    const deadline = started + Math.max(1000, Math.min(45000, msBudget * 0.75));
    const overrides = autoOverrides(input, goal), candidates = [];
    let usedRays = 0, best = null, note = 'no candidate traced';
    const rayBudget = tools && tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : 2000000;
    const coarseRays = rayBudget >= 2000000 ? 80000 : 40000, refineRays = rayBudget >= 2000000 ? 300000 : 100000;
    const traceOne = (c, rays) => {
      if (usedRays + rays > rayBudget) return null;
      const tr = tools.trace(c.out.surfaces, { rays, seed: input.seed }); usedRays += rays; c.tr = tr; c.merit = autoMerit(tr, goal); c.rays = rays; return tr;
    };
    for (let k = 0; k < overrides.length; k++) {
      if (Date.now() > deadline && best) break;
      const over = overrides[k], set = Object.assign({}, base, over), out = def.solve(input, set, tools), c = { out, over, merit: -Infinity, rays: 0 };
      if (!best) best = c; candidates.push(c);
      if (tools && tools.trace && Date.now() <= deadline) {
        try { const tr = traceOne(c, coarseRays); if (tr && tools.preview) tools.preview(out.surfaces, { label: goal + ' candidate ' + (k + 1), trace: tr }); }
        catch (e) { note = String(e && e.message || e); break; }
      }
      if (tools && tools.progress) tools.progress((k + 1) / (overrides.length + 3));
    }
    const ranked = candidates.filter((c) => isFinite(c.merit)).sort((a, b) => b.merit - a.merit);
    if (ranked.length) best = ranked[0];
    for (const c of ranked.slice(0, 3)) {
      if (Date.now() > deadline || usedRays + refineRays > rayBudget) break;
      try { traceOne(c, refineRays); if (tools.preview) tools.preview(c.out.surfaces, { label: goal + ' refined', trace: c.tr }); }
      catch (e) { note = String(e && e.message || e); break; }
    }
    const refined = candidates.filter((c) => c.rays === refineRays && isFinite(c.merit)).sort((a, b) => b.merit - a.merit);
    if (refined.length) best = refined[0];
    const out = best.out, tr = best.tr;
    const summary = tr && tr.fidelity ? 'fidelity ' + (100 * tr.fidelity.fidelity).toFixed(1) + '%, on-paint ' + (100 * tr.fidelity.onPaint).toFixed(1) + '%, peak ' + Math.round(tr.peakCd || 0) + ' cd' : note;
    out.notes = (out.notes || []).concat(['auto ' + goal + ': ' + JSON.stringify(best.over) + '; ' + summary + '; tuner used ' + usedRays + ' rays']);
    if (tools && tools.progress) tools.progress(1);
    return out;
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro-max-target--flux-mosaic', name: 'Flux mosaic (static supporting ellipsoids)', version: '0.30', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'method', label: 'Reflector layout', type: 'select', default: 'natural', options: [{ value: 'natural', label: 'continuous supporting ellipsoids' }, { value: 'wall', label: 'independent wall-fitted cells' }] },
      { key: 'wallMargin', label: 'Envelope-wall safety margin (mm)', type: 'number', min: 0.1, max: 5, step: 0.1, default: 0.7 },
      { key: 'cellFill', label: 'Source-cell aperture fill', type: 'number', min: 0.7, max: 1, step: 0.01, default: 0.96 },
      { key: 'bendCos', label: 'Largest source/target direction cosine', type: 'number', min: 0, max: 0.98, step: 0.01, default: 0.88 },
      { key: 'imageFill', label: 'Target-cluster image fill', type: 'number', min: 0.6, max: 3, step: 0.05, default: 1.35 },
      { key: 'edgeInset', label: 'Edge aim inset × achievable LED image', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5 },
      { key: 'defocusGain', label: 'Analytic defocus gain', type: 'number', min: 0, max: 2, step: 0.05, default: 1 },
      { key: 'modelPasses', label: 'Static footprint-balance passes', type: 'range', min: 0, max: 8, step: 1, default: 4 },
      { key: 'toneSharp', label: 'Internal paint-tone unsharp weight', type: 'number', min: 0, max: 1.5, step: 0.05, default: 0.5 },
      { key: 'directMask', label: 'Absorb direct light toward target', type: 'checkbox', default: true },
      { key: 'fitShare', label: 'Emission fraction fitted inside envelope', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.70 },
      { key: 'growShell', label: 'Grow shell when it already fits', type: 'checkbox', default: false },
      { key: 'decals', label: 'Fill unplaced paint clusters with independent facets', type: 'checkbox', default: false },
      { key: 'aimFraction', label: 'Target clusters per available facet', type: 'number', min: 0.25, max: 0.75, step: 0.05, default: 0.50 },
      { key: 'textFit', label: 'Text shell fit share', type: 'number', min: 0.3, max: 0.85, step: 0.05, default: 0.50 },
      { key: 'textGrow', label: 'Expand text shell after fitting', type: 'checkbox', default: true },
      { key: 'washFill', label: 'Wash image fill', type: 'number', min: 0.6, max: 3, step: 0.1, default: 2.1 },
      { key: 'washEdgeBoost', label: 'Wash edge aim weight', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0 },
    ], solve,
  });

  RF.Solvers.register({
    id: 'bench-kimik31pro-max-target--flux-mosaic-auto', name: 'Flux mosaic tuner (traced candidate selection)', version: '0.30', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting first' },
        { value: 'throw', label: 'Peak / throw with fidelity weight' },
        { value: 'efficient', label: 'Light on paint with fidelity weight' },
      ] },
    ], solve: solveAuto,
  });
})();
