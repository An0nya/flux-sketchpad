/* Paint reflector: weighted target clustering + a balanced supporting-ellipsoid surface.
 * Everything in solve() is deterministic geometry; no rays are traced. */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot;

  function hull3(points, P, ex, ey) {
    const p2 = points.map((p) => { const d = sub(p, P); return [dot(d, ex), dot(d, ey)]; });
    const idx = p2.map((_, i) => i).sort((a, b) => p2[a][0] - p2[b][0] || p2[a][1] - p2[b][1]);
    const cross = (o, a, b) => (p2[a][0] - p2[o][0]) * (p2[b][1] - p2[o][1]) - (p2[a][1] - p2[o][1]) * (p2[b][0] - p2[o][0]);
    const lo = [], hi = [];
    for (const i of idx) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    return lo.slice(0, -1).concat(hi.slice(0, -1)).map((i) => points[i]);
  }

  function hilbert(x, y, order) {
    let d = 0;
    for (let s = 1 << (order - 1); s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
    }
    return d;
  }

  // Equal-flux target cells.  The covariance is retained for controlled image widening.
  function targetClusters(input, N, levelPower) {
    const R = input.paint.res, p = input.paint.cells, T = RF.Engine.designFrame(input.target);
    const pix = []; let total = 0, order = 1; while ((1 << order) < R) order++;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = +p[j * R + i] || 0; if (!(w > 0)) continue;
      const uv = RF.Engine.cellCenter(T, i, j);
      pix.push({ u: uv[0], v: uv[1], w, h: hilbert(i, j, order), cell: j * R + i }); total += w;
    }
    N = Math.max(1, Math.min(N, pix.length));
    if (!pix.length) return [];
    const ord = pix.slice().sort((a, b) => a.h - b.h || a.cell - b.cell);
    const cs = []; let acc = 0, next = total / N * 0.5;
    for (const q of ord) { acc += q.w; if (acc >= next && cs.length < N) { cs.push({ u: q.u, v: q.v }); next += total / N; } }
    while (cs.length < N) cs.push({ u: ord[Math.floor(cs.length * ord.length / N)].u, v: ord[Math.floor(cs.length * ord.length / N)].v });
    const own = new Int32Array(pix.length);
    for (let it = 0; it < 16; it++) {
      const su = new Float64Array(cs.length), sv = new Float64Array(cs.length), sw = new Float64Array(cs.length);
      for (let i = 0; i < pix.length; i++) {
        const q = pix[i]; let bj = 0, bd = Infinity;
        for (let j = 0; j < cs.length; j++) { const d = (q.u - cs[j].u) ** 2 + (q.v - cs[j].v) ** 2; if (d < bd) { bd = d; bj = j; } }
        own[i] = bj; su[bj] += q.u * q.w; sv[bj] += q.v * q.w; sw[bj] += q.w;
      }
      for (let j = 0; j < cs.length; j++) if (sw[j] > 0) { cs[j].u = su[j] / sw[j]; cs[j].v = sv[j] / sw[j]; }
    }
    const A = cs.map((c) => ({ u: c.u, v: c.v, g: 0, cov: [0, 0, 0], cells: [] }));
    for (let i = 0; i < pix.length; i++) { const q = pix[i], a = A[own[i]]; a.g += q.w; a.cells.push([q.cell, q.w]); }
    for (let i = 0; i < pix.length; i++) {
      const q = pix[i], a = A[own[i]], du = q.u - a.u, dv = q.v - a.v;
      a.cov[0] += q.w * du * du; a.cov[1] += q.w * du * dv; a.cov[2] += q.w * dv * dv;
    }
    const out = [];
    for (const a of A) if (a.g > 0) {
      a.cov = a.cov.map((x) => x / a.g); a.level = a.g / a.cells.length; a.g /= total;
      a.Z = add(T.C, add(mul(T.tu, a.u), mul(T.tv, a.v)));
      const d = sub(a.Z, input.source.pos); a.c = V.len(d); a.a = mul(d, 1 / a.c);
      out.push(a);
    }
    if (levelPower) for (const a of out) a.g *= Math.pow(a.level, levelPower);
    return out;
  }

  // Equal-area spherical grid.  m is the luminous flux represented by each direction.
  function directions(input, NA, minDistance) {
    const src = input.source, env = input.envelope, L = src.pos, B = [1, 0, 0], basis = V.basis(B), e1 = basis[0], e2 = basis[1];
    const fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), NP = 2 * NA, dOm = 4 * Math.PI / (NA * NP);
    const margin = Math.max(0.08, 0.006 * Math.max(...env.half));
    const D = { n: 0, u: [], m: [], rEnv: [], rMin: [], q: [], a: [], NA, NP, B, e1, e2, cellOf: new Int32Array(NA * NP).fill(-1) };
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), ph = (q + 0.5) / NP * 2 * Math.PI;
      const u = add(mul(B, ca), mul(add(mul(e1, Math.cos(ph)), mul(e2, Math.sin(ph))), sa));
      const ct = clamp(dot(u, fr.a), -1, 1), I = RF.Source.intensity(src, Math.acos(ct)); if (!(I > 0)) continue;
      const iv = RF.Geo.envInterval(env, L, u); if (!iv || !(iv[1] > Math.max(0, iv[0]))) continue;
      const rE = iv[1] - margin, rM = Math.max(minDistance, iv[0] > 0 ? iv[0] + margin : 0); if (!(rE > rM + margin)) continue;
      D.cellOf[q * NA + a] = D.n++; D.u.push(u); D.m.push(src.power * I / Itot * dOm); D.rEnv.push(rE); D.rMin.push(rM); D.q.push(q); D.a.push(a);
    }
    return D;
  }
  function corner(D, q, a) {
    const ca = 1 - 2 * a / D.NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), ph = q / D.NP * 2 * Math.PI;
    return add(mul(D.B, ca), mul(add(mul(D.e1, Math.cos(ph)), mul(D.e2, Math.sin(ph))), sa));
  }
  function radius(A, x, u) {
    const b = Math.exp(x), c2 = 2 * A.c, den = 2 * b + c2 * (1 - dot(u, A.a));
    return den > 1e-12 ? b * (b + c2) / den : Infinity;
  }
  function assign(D, on, A, x) {
    const asg = new Int32Array(D.n).fill(-1), rr = new Float64Array(D.n), flux = new Float64Array(A.length);
    for (let i = 0; i < D.n; i++) {
      if (!on[i]) continue; let bj = -1, br = Infinity;
      for (let j = 0; j < A.length; j++) { const r = radius(A[j], x[j], D.u[i]); if (r < br) { br = r; bj = j; } }
      asg[i] = bj; rr[i] = br; if (bj >= 0) flux[bj] += D.m[i];
    }
    return { asg, rr, flux };
  }

  function chol(M, b, n) {
    for (let j = 0; j < n; j++) {
      let s = M[j * n + j]; for (let k = 0; k < j; k++) s -= M[j * n + k] ** 2; if (!(s > 1e-300)) return null;
      const dj = Math.sqrt(s); M[j * n + j] = dj;
      for (let i = j + 1; i < n; i++) { let t = M[i * n + j]; for (let k = 0; k < j; k++) t -= M[i * n + k] * M[j * n + k]; M[i * n + j] = t / dj; }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= M[i * n + k] * y[k]; y[i] = t / M[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= M[k * n + i] * y[k]; y[i] = t / M[i * n + i]; }
    return y;
  }

  // Entropic semi-discrete transport, finished at a very low temperature.  This balances flux
  // without independently moving tiles (which would make them shadow one another).
  function balance(D, on, A, x, schedule) {
    const J = A.length, want0 = A.reduce((s, a) => s + a.g, 0); let total = 0;
    for (let i = 0; i < D.n; i++) if (on[i]) total += D.m[i];
    const want = A.map((a) => a.g / want0 * total), F = new Float64Array(J), res = new Float64Array(J), res2 = new Float64Array(J);
    const M = new Float64Array(J * J), MM = new Float64Array(J * J), old = new Float64Array(J);
    const ux = new Float64Array(D.n), uy = new Float64Array(D.n), uz = new Float64Array(D.n);
    for (let i = 0; i < D.n; i++) { ux[i] = D.u[i][0]; uy[i] = D.u[i][1]; uz[i] = D.u[i][2]; }
    const ax = A.map((a) => a.a[0]), ay = A.map((a) => a.a[1]), az = A.map((a) => a.a[2]), c2 = A.map((a) => 2 * a.c);
    const b = new Float64Array(J), q2 = new Float64Array(J), e2 = new Float64Array(J), gb = new Float64Array(J), lr = new Float64Array(J), pp = new Float64Array(J), den = new Float64Array(J);
    function evalF(tau, matrix) {
      F.fill(0); if (matrix) M.fill(0);
      for (let j = 0; j < J; j++) { b[j] = Math.exp(x[j]); q2[j] = b[j] * (b[j] + c2[j]); e2[j] = 2 * b[j]; gb[j] = 1 + b[j] / (b[j] + c2[j]); }
      for (let i = 0; i < D.n; i++) {
        if (!on[i]) continue;
        const ux_i = ux[i], uy_i = uy[i], uz_i = uz[i], mass = D.m[i]; let lm = Infinity;
        for (let j = 0; j < J; j++) {
          const dn = e2[j] + c2[j] * (1 - ux_i * ax[j] - uy_i * ay[j] - uz_i * az[j]); den[j] = dn;
          lr[j] = dn > 1e-300 ? Math.log(q2[j] / dn) : 300; if (lr[j] < lm) lm = lr[j];
        }
        pp.fill(0); let z = 0;
        for (let j = 0; j < J; j++) if (lr[j] - lm < 18 * tau) { pp[j] = Math.exp(-(lr[j] - lm) / tau); z += pp[j]; }
        if (!(z > 0)) continue;
        for (let j = 0; j < J; j++) { pp[j] /= z; F[j] += mass * pp[j]; }
        if (matrix) for (let j = 0; j < J; j++) if (pp[j] > 1e-8) {
          const f = mass / tau * (gb[j] - 2 * b[j] / den[j]) * pp[j], row = j * J;
          M[row + j] += f * (1 - pp[j]);
          for (let k = 0; k < J; k++) if (k !== j && pp[k] > 1e-8) M[row + k] -= mass / tau * (gb[k] - 2 * b[k] / den[k]) * pp[j] * pp[k];
        }
      }
    }
    const norm = (r) => { let s = 0; for (let j = 0; j < J; j++) s += (r[j] / Math.max(want[j], 1e-20)) ** 2; return Math.sqrt(s / J); };
    for (const tau of schedule) {
      let mu = 1e-3;
      for (let it = 0; it < 22; it++) {
        evalF(tau, true); for (let j = 0; j < J; j++) res[j] = F[j] - want[j];
        let worst = 0; for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(res[j]) / Math.max(want[j], 1e-20)); if (worst < 0.035) break;
        // Revive an empty cell by pulling its ellipsoid in toward the LED.  If there
        // is none, the evaluation above is already current and need not be repeated.
        let revived = false;
        for (let j = 0; j < J; j++) if (F[j] < 1e-4 * want[j]) { x[j] -= 3 * tau + 0.03; revived = true; }
        if (revived) { evalF(tau, true); for (let j = 0; j < J; j++) res[j] = F[j] - want[j]; }
        const n0 = norm(res); let dm = 0; for (let j = 0; j < J; j++) dm += M[j * J + j]; dm = dm / J + 1e-300;
        let ok = false;
        for (let tr = 0; tr < 7 && !ok; tr++, mu *= 10) {
          for (let k = 0; k < J * J; k++) MM[k] = M[k];
          for (let j = 0; j < J; j++) {
            for (let k = 0; k < J; k++) MM[j * J + k] = 0.5 * (M[j * J + k] + M[k * J + j]);
            MM[j * J + j] += mu * (M[j * J + j] + 1e-3 * dm);
          }
          const dl = chol(MM, res, J); if (!dl) continue;
          let mean = 0; for (const d of dl) mean += d; mean /= J; for (let j = 0; j < J; j++) dl[j] = clamp(dl[j] - mean, -0.3, 0.3);
          for (let step = 1; step > 0.05 && !ok; step *= 0.5) {
            old.set(x); for (let j = 0; j < J; j++) x[j] += step * dl[j];
            evalF(tau, false); for (let j = 0; j < J; j++) res2[j] = F[j] - want[j];
            if (norm(res2) < n0) { ok = true; mu = Math.max(1e-7, mu * 0.005); } else x.set(old);
          }
        }
        if (!ok) break;
      }
    }
  }

  function fit(D, on, A, x, share) {
    let as = assign(D, on, A, x), ratios = [], total = 0;
    for (let i = 0; i < D.n; i++) if (on[i] && as.asg[i] >= 0) { ratios.push([as.rr[i] / D.rEnv[i], D.m[i]]); total += D.m[i]; }
    ratios.sort((a, b) => a[0] - b[0]); let acc = 0, q = ratios.length ? ratios[ratios.length - 1][0] : 1;
    for (const r of ratios) { acc += r[1]; if (acc >= share * total) { q = r[0]; break; } }
    if (q > 0.995 || q < 0.75) for (let j = 0; j < A.length; j++) x[j] -= Math.log(q * 1.003);
    as = assign(D, on, A, x);
    for (let i = 0; i < D.n; i++) if (on[i] && (as.asg[i] < 0 || as.rr[i] > D.rEnv[i] || as.rr[i] < D.rMin[i])) on[i] = 0;
    return assign(D, on, A, x);
  }

  // First-order extended-source image at the target.  For each emitter basis vector,
  // perturb the incident direction, reflect it at the facet centre, and intersect the
  // target plane.  This is a differential optical calculation, not a raytrace/sampled search.
  function imageCovariance(input, f) {
    const src = input.source, T = RF.Engine.designFrame(input.target), L = src.pos, P = f.P, Z = f.Z;
    const r = V.dist(P, L), di = V.dist(P, Z), d0 = V.norm(sub(P, L)), n = V.norm(add(V.norm(sub(L, P)), V.norm(sub(Z, P))));
    const fr = RF.Source.frame(src), axes = [fr.u, fr.v, fr.a], vars = [0, 0, 0];
    if (src.kind === 'point') return { cov: [0, 0, 0], extra: [0, 0, 0], di, map: null };
    if (src.kind === 'planar') {
      if (src.shape === 'disc') vars[0] = vars[1] = src.radius * src.radius / 4;
      else { vars[0] = src.w * src.w / 12; vars[1] = src.h * src.h / 12; }
    } else if (src.shape === 'cylinder') { vars[0] = vars[1] = src.radius * src.radius / 4; vars[2] = src.length * src.length / 12; }
    else vars[0] = vars[1] = vars[2] = src.radius * src.radius / 5;
    const C = [0, 0, 0], cols = [];
    for (let k = 0; k < 3; k++) {
      if (!(vars[k] > 0)) continue;
      const din = V.norm(add(d0, mul(axes[k], -1 / Math.max(r, 1e-9))));
      const out = add(din, mul(n, -2 * dot(din, n))), den = dot(out, T.n); if (Math.abs(den) < 1e-9) continue;
      const t = dot(sub(T.C, P), T.n) / den, X = add(P, mul(out, t)), d = sub(X, Z);
      const u = dot(d, T.tu), v = dot(d, T.tv); cols.push([u, v]); C[0] += vars[k] * u * u; C[1] += vars[k] * u * v; C[2] += vars[k] * v * v;
    }
    return { cov: C, di, map: src.kind === 'planar' && cols.length >= 2 ? [cols[0][0], cols[1][0], cols[0][1], cols[1][1]] : null };
  }
  function eig2(C) {
    const tr = (C[0] + C[2]) / 2, d = Math.sqrt(Math.max(0, ((C[0] - C[2]) / 2) ** 2 + C[1] * C[1]));
    return { l1: Math.max(0, tr + d), l2: Math.max(0, tr - d), th: 0.5 * Math.atan2(2 * C[1], C[0] - C[2]) };
  }
  function addDivergence(input, f, extra) {
    const e = eig2(extra); if (e.l1 < 1e-8) return f;
    const T = RF.Engine.designFrame(input.target), ah = V.norm(sub(f.Z, f.P)), di = V.dist(f.Z, f.P), axes = [];
    for (const th of [e.th, e.th + Math.PI / 2]) {
      const q = add(mul(T.tu, Math.cos(th)), mul(T.tv, Math.sin(th))), ax = sub(q, mul(ah, dot(q, ah)));
      axes.push(V.len(ax) > 1e-9 ? V.norm(ax) : V.basis(ah)[0]);
    }
    const vg = [e.l1, e.l2].map((l, k) => {
      if (!(l > 1e-8)) return 0;
      let m = 0, m2 = 0; for (const q of f.clip.pts3) { const y = dot(sub(q, f.P), axes[k]); m += y; m2 += y * y; }
      m /= f.clip.pts3.length; const ap = Math.sqrt(Math.max(1e-8, m2 / f.clip.pts3.length - m * m));
      return -(Math.sqrt(l) / Math.max(di, 1e-9)) / Math.max(ap, 0.05);
    });
    return Object.assign(f, { vg, ax: axes[0] });
  }

  function realize(input, D, on, A, x, as, fill, push) {
    const L = input.source.pos, by = A.map(() => []);
    for (let i = 0; i < D.n; i++) if (on[i] && as.asg[i] >= 0) by[as.asg[i]].push(i);
    const surfaces = [], intent = [], models = [];
    for (let j = 0; j < A.length; j++) {
      const cells = by[j]; if (!cells.length) continue;
      const a = A[j]; let u = [0, 0, 0], W = 0;
      for (const i of cells) { u = add(u, mul(D.u[i], D.m[i])); W += D.m[i]; } u = V.norm(u);
      let r = radius(a, x[j], u); if (!(r > 0) || !isFinite(r)) continue;
      let rho = 1;
      if (push > 0) {
        let rm = Infinity; for (const i of cells) rm = Math.min(rm, D.rEnv[i] / Math.max(as.rr[i], 1e-9));
        if (isFinite(rm)) rho = Math.max(1, 1 + push * (0.965 * rm - 1));
      }
      r *= rho;
      const P = add(L, mul(u, r)), Z = a.Z.slice(), sh = V.norm(sub(L, P)), ah = V.norm(sub(Z, P));
      if (V.len(add(sh, ah)) < 1e-7) continue;
      const n = V.norm(add(sh, ah)), basis = V.basis(n), ex = basis[0], ey = basis[1], pts = [];
      for (const i of cells) {
        const q = D.q[i], aa = D.a[i];
        for (const dq of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const w = corner(D, q + dq[0], aa + dq[1]), rr = radius(a, x[j], w);
          if (rr > 0 && isFinite(rr) && rr < 1e8) pts.push(add(L, mul(w, rr * rho)));
        }
      }
      const poly = hull3(pts, P, ex, ey); if (poly.length < 3) continue;
      const id = 'E' + j;
      let f = { type: 'facet', id, P, S0: L.slice(), Z, flat: false, di: V.dist(P, Z), clip: { kind: 'poly', pts3: poly }, optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } };
      const im = imageCovariance(input, f), desired = a.cov.map((x) => x * fill * fill), extra = [desired[0] - im.cov[0], desired[1] - im.cov[1], desired[2] - im.cov[2]];
      // Only positive eigenvalues of the extra covariance need added divergence.
      const ev = eig2(extra), co = Math.cos(ev.th), si = Math.sin(ev.th), positive = [Math.max(0, ev.l1), Math.max(0, ev.l2)];
      const extraClamped = [positive[0] * co * co + positive[1] * si * si, (positive[0] - positive[1]) * co * si, positive[0] * si * si + positive[1] * co * co];
      f = addDivergence(input, f, extraClamped);
      f.imageCov = [im.cov[0] + extraClamped[0], im.cov[1] + extraClamped[1], im.cov[2] + extraClamped[2]]; f.aimUV = [a.u, a.v];
      f.wantFlux = a.g; f.caughtFlux = as.flux[j];
      f.imageMap = im.map;
      surfaces.push(f); models.push({ id, cov: [im.cov[0] + extraClamped[0], im.cov[1] + extraClamped[1], im.cov[2] + extraClamped[2]], aim: a, map: im.map, shaped: ev.l1 > 1e-8, src: input.source });
      intent.push({ facet: id, cells: a.cells });
    }
    return { surfaces, intent, models };
  }

  // Rasterise the analytic images and make a fixed number of flux-correction rounds.
  // K[j][k] is the share of facet j's captured flux landing in paint cell k.
  function correctFlux(input, made, A, rounds, kernel) {
    const R = input.paint.res, T = RF.Engine.designFrame(input.target), paint = input.paint.cells;
    const cw = 2 * T.half / R, area = cw * cw, n = R * R, K = [];
    for (const m of made.models) {
      const C = m.cov.slice(), cellVar = cw * cw / 12;
      C[0] += cellVar; C[2] += cellVar;
      const det = Math.max(1e-12, C[0] * C[2] - C[1] * C[1]), i00 = C[2] / det, i01 = -C[1] / det, i11 = C[0] / det;
      const vals = new Float64Array(n), e = eig2(C), reach = Math.min(2 * T.half, (kernel === 'flat' ? 2.15 : 3.2) * Math.sqrt(e.l1));
      const md = m.map && !m.shaped && kernel === 'source' ? m.map[0] * m.map[3] - m.map[1] * m.map[2] : 0;
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
        const uv = RF.Engine.cellCenter(T, i, j), du = uv[0] - m.aim.u, dv = uv[1] - m.aim.v;
        if (Math.abs(du) > reach || Math.abs(dv) > reach) continue;
        if (md && Math.abs(md) > 1e-12) {
          const su = (du * m.map[3] - dv * m.map[1]) / md, sv = (dv * m.map[0] - du * m.map[2]) / md, src = m.src;
          const inside = src.shape === 'disc' ? su * su + sv * sv <= src.radius * src.radius : Math.abs(su) <= src.w / 2 && Math.abs(sv) <= src.h / 2;
          if (inside) vals[j * R + i] = area / Math.abs(md * (src.shape === 'disc' ? Math.PI * src.radius * src.radius : src.w * src.h));
          continue;
        }
        const q = du * du * i00 + 2 * du * dv * i01 + dv * dv * i11;
        if (kernel === 'flat') { if (q < 4) vals[j * R + i] = area / (4 * Math.PI * Math.sqrt(det)); }
        else if (q < 18) vals[j * R + i] = Math.exp(-q / 2) * area / (2 * Math.PI * Math.sqrt(det));
      }
      K.push({ a: m.aim, vals });
    }
    let total = 0; for (const k of K) total += k.a.g;
    let sp = 0, np = 0; for (const w of paint) if (w > 0) { sp += w; np++; }
    const desired = Float64Array.from(paint, (w) => w / Math.max(sp, 1e-30) * total), typ = sp / Math.max(1, np) / Math.max(sp, 1e-30) * total, floor = 0.035 * typ;
    const pred = new Float64Array(n), weight = new Float64Array(n);
    for (let k = 0; k < n; k++) weight[k] = desired[k] > 0 ? 1 / desired[k] ** 2 : 0;
    for (let it = 0; it < rounds; it++) {
      pred.fill(0); for (const q of K) for (let k = 0; k < n; k++) if (q.vals[k]) pred[k] += q.a.g * q.vals[k];
      for (const q of K) {
        let num = 0, den = 0;
        for (let k = 0; k < n; k++) if (q.vals[k]) { const w = weight[k] * q.vals[k]; num += w * desired[k]; den += w * pred[k]; }
        if (den > 1e-30) q.a.g *= clamp(Math.pow(Math.max(1e-8, num / den), 0.65), 0.55, 1.8);
      }
      let sum = 0; for (const q of K) sum += q.a.g; for (const q of K) q.a.g *= total / Math.max(sum, 1e-30);
    }
  }

  // A few fixed coordinate-descent sweeps on the analytic Gaussian image model.  Unlike
  // correctFlux this can move an image off a dark gap or fill a hole between neighbours.
  function polishAims(input, made, A, sweeps) {
    const R = input.paint.res, T = RF.Engine.designFrame(input.target), paint = input.paint.cells, n = R * R, cw = 2 * T.half / R, area = cw * cw;
    let total = 0, sp = 0, np = 0; for (const q of made.models) total += q.aim.g; for (const w of paint) if (w > 0) { sp += w; np++; }
    const desired = Float64Array.from(paint, (w) => w / Math.max(sp, 1e-30) * total), typ = total / Math.max(1, np), floor = 0.07 * typ;
    const weight = new Float64Array(n); for (let k = 0; k < n; k++) weight[k] = 1 / Math.max(desired[k], floor) ** 2;
    const items = made.models.map((m) => {
      const C = m.cov.slice(); C[0] += cw * cw / 12; C[2] += cw * cw / 12;
      const det = Math.max(1e-12, C[0] * C[2] - C[1] * C[1]);
      return { a: m.aim, C, det, i00: C[2] / det, i01: -C[1] / det, i11: C[0] / det, vals: null };
    });
    function raster(q, u, v) {
      const out = new Float64Array(n), e = eig2(q.C), reach = Math.min(2 * T.half, 3 * Math.sqrt(e.l1));
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
        const uv = RF.Engine.cellCenter(T, i, j), du = uv[0] - u, dv = uv[1] - v;
        if (Math.abs(du) > reach || Math.abs(dv) > reach) continue;
        const m = du * du * q.i00 + 2 * du * dv * q.i01 + dv * dv * q.i11;
        if (m < 16) out[j * R + i] = Math.exp(-m / 2) * area / (2 * Math.PI * Math.sqrt(q.det));
      }
      return out;
    }
    const pred = new Float64Array(n); for (const q of items) { q.vals = raster(q, q.a.u, q.a.v); for (let k = 0; k < n; k++) pred[k] += q.a.g * q.vals[k]; }
    const cost = (k, e) => weight[k] * (e - desired[k]) ** 2;
    for (let sw = 0; sw < sweeps; sw++) {
      const step = cw * (sw === 0 ? 0.8 : 0.4);
      for (const q of items) {
        const oldU = q.a.u, oldV = q.a.v, g = q.a.g; let best = null;
        for (const d of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const u = clamp(oldU + d[0] * step, -T.half + cw * 0.1, T.half - cw * 0.1), v = clamp(oldV + d[1] * step, -T.half + cw * 0.1, T.half - cw * 0.1);
          const vals = raster(q, u, v); let dc = 0;
          for (let k = 0; k < n; k++) { const e = pred[k] - g * q.vals[k] + g * vals[k]; dc += cost(k, e) - cost(k, pred[k]); }
          if (!best || dc < best.dc - 1e-20) best = { dc, u, v, vals };
        }
        if (best && best.dc < -1e-16) {
          for (let k = 0; k < n; k++) pred[k] = Math.max(0, pred[k] - g * q.vals[k] + g * best.vals[k]);
          q.a.u = best.u; q.a.v = best.v; q.vals = best.vals;
        }
      }
    }
    for (const a of A) {
      a.Z = add(T.C, add(mul(T.tu, a.u), mul(T.tv, a.v))); const d = sub(a.Z, input.source.pos); a.c = V.len(d); a.a = mul(d, 1 / Math.max(a.c, 1e-30));
    }
  }

  function applyAimTilts(input, draft, fill) {
    const byId = new Map(draft.surfaces.map((f) => [f.id, f]));
    for (const m of draft.models) {
      const f = byId.get(m.id), a = m.aim; if (!f) continue;
      f.Z = a.Z.slice(); f.di = V.dist(f.P, f.Z); delete f.vg; delete f.ax;
      const im = imageCovariance(input, f), desired = a.cov.map((x) => x * fill * fill), extra = [desired[0] - im.cov[0], desired[1] - im.cov[1], desired[2] - im.cov[2]];
      const ev = eig2(extra), co = Math.cos(ev.th), si = Math.sin(ev.th), p1 = Math.max(0, ev.l1), p2 = Math.max(0, ev.l2);
      const ec = [p1 * co * co + p2 * si * si, (p1 - p2) * co * si, p1 * si * si + p2 * co * co];
      addDivergence(input, f, ec); f.aimUV = [a.u, a.v]; f.imageCov = [im.cov[0] + ec[0], im.cov[1] + ec[1], im.cov[2] + ec[2]];
    }
  }

  // Verification is geometry only (it is also what the host applies afterwards).  Use it to make
  // curved-edge envelope and true-surface clearance failures impossible rather than hoping margins suffice.
  function enforce(input, made, minKeep) {
    let fs = made.surfaces, byId = new Map(made.intent.map((x) => [x.facet, x]));
    const envelope = Object.assign({}, input.envelope, { keepOut: Math.max(input.envelope.keepOut || 0, minKeep || 0) });
    const scene = { source: input.source, emitters: (input.sources || []).slice(1), envelope, target: input.target, modeA: { budget: input.limits.maxFacets } };
    for (let pass = 0; pass < 7; pass++) {
      const f = RF.Solvers.verify(scene, { surfaces: fs }); if (f.errors.length) break;
      const bad = new Set(f.violations.envelope.concat(f.violations.keepOut)); if (!bad.size) return { surfaces: fs, intent: fs.map((s) => byId.get(s.id)).filter(Boolean) };
      fs = fs.map((s) => bad.has(s.id) ? Object.assign({}, s, { clip: { kind: 'poly', pts3: s.clip.pts3.map((q) => add(s.P, mul(sub(q, s.P), 0.86))) } }) : s);
    }
    const f = RF.Solvers.verify(scene, { surfaces: fs }), bad = new Set(f.violations.envelope.concat(f.violations.keepOut));
    fs = fs.filter((s) => !bad.has(s.id));
    return { surfaces: fs, intent: fs.map((s) => byId.get(s.id)).filter(Boolean) };
  }

  function directShield(input, keep) {
    const src = input.source, L = src.pos, B = [1, 0, 0], T = RF.Engine.targetFrame(input.target), iv = RF.Geo.envInterval(input.envelope, L, B);
    if (!iv || !(iv[1] > keep + 0.5)) return null;
    let ct = 1;
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const X = add(T.C, add(mul(T.tu, u * T.half), mul(T.tv, v * T.half))), d = V.norm(sub(X, L)); ct = Math.min(ct, dot(d, B));
    }
    if (!(ct > 0.05 && ct < 0.9999)) return null;
    const r0 = Math.min(0.35 * iv[1], keep + 2), sr = RF.Source.boundingRadius(src);
    if (!(r0 > keep + 0.2)) return null;
    const rad = (r0 + sr) * Math.sqrt(Math.max(0, 1 - ct * ct)) / ct + sr;
    const P = add(L, mul(B, r0)), n = mul(B, -1), basis = V.basis(n), pts3 = [];
    for (let k = 0; k < 12; k++) { const a = 2 * Math.PI * k / 12; pts3.push(add(P, add(mul(basis[0], rad * Math.cos(a)), mul(basis[1], rad * Math.sin(a))))); }
    return { type: 'plane', id: 'DirectLightShield', P, n, clip: { kind: 'poly', pts3 }, optics: { interaction: 'absorb', twoSided: true } };
  }

  function solveOne(input, settings) {
    const keep = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0) + 0.05;
    const kernelCells = RF.Photometry.achievableKernel({ source: input.source, envelope: input.envelope, target: input.target }).cells;
    const classification = RF.Modes.classify(input.paint.cells, input.paint.res, Math.max(1, kernelCells)), kind = classification.kind;
    let autoCover = kernelCells > 3 ? clamp(1.14 - 0.06 * kernelCells, 0.55, 0.86) : 0.88;
    autoCover -= 0.32 * Math.max(0, kernelCells - 7.5);
    const tinySource = RF.Source.extentSize(input.source) < 0.75;
    if (tinySource && kind !== 'text') autoCover = 0.96;
    if (input.source.kind !== 'planar') autoCover = Math.min(autoCover, 0.72);
    if (kind === 'text') autoCover = clamp(0.90 - 0.065 * kernelCells, 0.50, 0.90);
    else if (kind === 'wash') autoCover = classification.features.coverage > 0.6 ? 0.90 : 0.55;
    else if (kind === 'cutoff') autoCover = 0.80;
    const cover = settings.cover > 0 ? settings.cover : autoCover;
    const fill = settings.fill > 0 ? settings.fill : (kind === 'text' ? 1.15 : tinySource ? 0.8 : 0.4);
    let levelPower = settings.levelPower;
    if (levelPower < 0) {
      const hotCells = Math.max(1, (classification.features.hotShare || 0) * (classification.features.painted || 0));
      const coreDiameter = 2 * Math.sqrt(hotCells / Math.PI), blurRatio = kernelCells / Math.max(coreDiameter, 1e-9);
      const coreScale = clamp((0.48 - blurRatio) / 0.12, 0, 1) * (input.source.kind === 'planar' ? 1 : 0.35);
      levelPower = clamp(0.48 * (kernelCells - 2), 0, 1.6) * coreScale;
    }
    const corrections = settings.corrections >= 0 ? settings.corrections : (input.source.kind === 'planar' ? 20 : 3);
    const aimSweeps = settings.aimSweeps >= 0 ? settings.aimSweeps : (kind !== 'text' && kernelCells >= 3 ? 1 : 0);
    const A = targetClusters(input, Math.min(input.limits.maxFacets, 120), levelPower), empty = { surfaces: [], intent: [], notes: ['nothing painted'] };
    if (!A.length) return empty;
    const NA = settings.grid || (input.source.kind === 'planar' ? (kernelCells < 2 ? 44 : 32) : 28), D = directions(input, NA, keep);
    if (!D.n) return { surfaces: [], intent: [{ facet: null, cells: A.flatMap((a) => a.cells) }], notes: ['no emitted direction has room inside the envelope'] };
    const on = new Uint8Array(D.n).fill(1), x = new Float64Array(A.length).fill(Math.log(settings.beta || 35));
    balance(D, on, A, x, [0.08, 0.025, 0.008, 0.0025]);
    let as;
    for (let k = 0; k < 2; k++) {
      as = fit(D, on, A, x, cover);
      balance(D, on, A, x, [0.003, 0.001]);
    }
    as = assign(D, on, A, x);
    let draft = realize(input, D, on, A, x, as, fill, settings.push);
    if (corrections > 0 && draft.surfaces.length) {
      correctFlux(input, draft, A, corrections, settings.kernel);
      balance(D, on, A, x, [0.004, 0.0012]);
      as = assign(D, on, A, x);
      draft = realize(input, D, on, A, x, as, fill, settings.push);
    }
    if (aimSweeps > 0 && draft.surfaces.length) { polishAims(input, draft, A, aimSweeps); applyAimTilts(input, draft, fill); }
    let blurDropped = 0;
    if (settings.blurDrop > 0 && classification.features.coverage <= 0.6 && draft.surfaces.length > 4) {
      const cw = input.target.size / input.paint.res, feature = Math.max(cw, (classification.features.strokeCells || Math.sqrt(classification.features.painted || 1)) * cw);
      const limit = Math.max(settings.blurDrop * feature, 0.75 * kernelCells * cw), ranked = draft.surfaces.map((f) => ({ f, sigma: Math.sqrt(eig2(f.imageCov || [0, 0, 0]).l1) }));
      const keepN = Math.max(4, Math.ceil(ranked.length * (kind === 'text' ? 0.5 : 0.25))), rejected = new Set(ranked.filter((q) => q.sigma > limit).sort((a, b) => b.sigma - a.sigma).slice(0, Math.max(0, ranked.length - keepN)).map((q) => q.f.id));
      if (rejected.size) { blurDropped = rejected.size; draft.surfaces = draft.surfaces.filter((f) => !rejected.has(f.id)); }
    }
    if (settings.directShield) { const shield = directShield(input, keep); if (shield) draft.surfaces.push(shield); }
    const made = enforce(input, draft, keep);
    let covered = 0, available = 0; for (let i = 0; i < D.n; i++) { available += D.m[i]; if (on[i]) covered += D.m[i]; }
    const notes = [made.surfaces.length + ' supporting-ellipsoid facets; geometric capture ' + (100 * covered / Math.max(available, 1e-30)).toFixed(1) + '% of emitted light' + (blurDropped ? '; omitted ' + blurDropped + ' over-large LED images' : '')];
    return { surfaces: made.surfaces, intent: made.intent, notes };
  }

  function solve(input, settings) {
    // A separate reflector per emitter was measured to be much worse: the surfaces shadow
    // and block one another.  Keep one continuous design for the primary emitter; clearance
    // around every additional emitter is still enforced on every realised surface.
    return solveOne(input, settings);
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro-max-target-r2--ellipsoid-paint', name: 'Balanced ellipsoid paint reflector', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'cover', label: 'Geometric flux coverage (0 = adaptive)', type: 'range', min: 0, max: 0.99, step: 0.01, default: 0 },
      { key: 'grid', label: 'Direction grid density (0 = adaptive)', type: 'number', min: 0, max: 90, step: 2, default: 0 },
      { key: 'beta', label: 'Initial ellipsoid scale (mm)', type: 'number', min: 1, step: 1, default: 35 },
      { key: 'fill', label: 'Cluster image fill factor (0 = adaptive)', type: 'number', min: 0, max: 2.5, step: 0.05, default: 0 },
      { key: 'corrections', label: 'Analytic flux correction rounds (-1 = adaptive)', type: 'range', min: -1, max: 24, step: 1, default: -1 },
      { key: 'kernel', label: 'Analytic LED image profile', type: 'select', default: 'source', options: [{ value: 'source', label: 'mapped emitter' }, { value: 'flat', label: 'flat ellipse' }, { value: 'gaussian', label: 'Gaussian' }] },
      { key: 'levelPower', label: 'Extra flux weighting by paint level (-1 = adaptive)', type: 'number', min: -1, max: 2, step: 0.1, default: -1 },
      { key: 'push', label: 'Radial push toward the envelope', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
      { key: 'aimSweeps', label: 'Analytic aim correction sweeps (-1 = adaptive)', type: 'range', min: -1, max: 4, step: 1, default: -1 },
      { key: 'directShield', label: 'Absorb unshaped direct light toward the target', type: 'checkbox', default: false },
      { key: 'blurDrop', label: 'Reject images larger than this × the painted feature scale (0 = keep all)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.45 },
    ],
    solve,
  });

  // Optional trace tuner.  This is a SEPARATE solver: the static solve above never
  // receives or calls a tracing tool.  A short greedy sweep changes one choice at a
  // time, always starting from the static defaults; every candidate uses the same seed.
  RF.Solvers.register({
    id: 'bench-kimik31pro-max-target-r2--ellipsoid-paint-auto', name: 'Balanced ellipsoid paint reflector (trace tuned)', version: '1.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [{ value: 'faithful', label: 'faithful' }, { value: 'throw', label: 'throw' }, { value: 'efficient', label: 'efficient' }] },
      { key: 'rays', label: 'Rays per candidate', type: 'number', min: 50000, max: 1000000, step: 50000, default: 250000 },
    ],
    solve(input, settings, tools) {
      const def = RF.Solvers.get('bench-kimik31pro-max-target-r2--ellipsoid-paint'), base = RF.Solvers.defaults(def);
      base.minDistance = settings.minDistance;
      const started = Date.now(), maxMs = tools.budget && isFinite(tools.budget.ms) ? Math.min(48000, tools.budget.ms * 0.8) : 48000;
      const rayCap = tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : 20000000;
      let usedRays = 0, best = null, evaluations = 0;
      const trials = [];
      const goal = settings.goal || 'faithful';
      function merit(tr) {
        const f = tr.fidelity; if (!f || !(f.fidelity > 0)) return -Infinity;
        if (goal === 'throw') return Math.log(Math.max(1e-30, tr.peakCd)) + 2.5 * Math.log(Math.max(0.03, f.fidelity));
        if (goal === 'efficient') return Math.log(Math.max(1e-30, f.onPaint)) + 2 * Math.log(Math.max(0.03, f.fidelity));
        return f.fidelity + 0.04 * f.onPaint;
      }
      if (!input.paint.cells.some((w) => w > 0)) return solve(input, base);
      function candidate(changes, label) {
        if (best && (Date.now() - started > maxMs || usedRays + settings.rays > rayCap)) return false;
        const set = Object.assign({}, best ? best.set : base, changes), out = solve(input, set);
        const rays = Math.max(50000, Math.min(1000000, settings.rays | 0));
        const tr = tools.trace(out.surfaces, { rays, seed: input.seed, paint: input.paint.cells }); usedRays += rays; evaluations++;
        const score = merit(tr), rec = { set, out, tr, score, label };
        trials.push(rec);
        if (!best || score > best.score + 1e-10) {
          best = rec;
          return true;
        }
        return false;
      }
      candidate({}, 'static defaults');
      for (const cover of [0.40, 0.55, 0.68, 0.78, 0.86, 0.94]) candidate({ cover }, 'coverage ' + cover);
      for (const aimSweeps of [0, 1]) candidate({ aimSweeps }, aimSweeps ? 'one aim sweep' : 'no aim sweep');
      candidate({ blurDrop: 0 }, 'keep all images');
      for (const levelPower of [0, 0.8, 1.6]) candidate({ levelPower }, 'paint-level exponent ' + levelPower);
      for (const fill of [0.8, 1.5]) candidate({ fill }, 'image fill ' + fill);
      for (const corrections of [3, 10]) candidate({ corrections }, corrections + ' correction rounds');
      // Candidate noise is common-random but not zero.  Re-read the baseline and the
      // three leaders with more rays; never let a lucky low-ray candidate win silently.
      const finalists = [trials[0]].concat(trials.slice().sort((a, b) => b.score - a.score).slice(0, 3)).filter((q, i, a) => q && a.indexOf(q) === i);
      const verifyRays = Math.max(250000, Math.min(1000000, (settings.rays | 0) * 2));
      for (const q of finalists) {
        if (Date.now() - started > maxMs || usedRays + verifyRays > rayCap) continue;
        q.tr = tools.trace(q.out.surfaces, { rays: verifyRays, seed: input.seed, paint: input.paint.cells }); usedRays += verifyRays; evaluations++;
        q.score = merit(q.tr);
      }
      best = finalists.slice().sort((a, b) => b.score - a.score)[0] || best;
      const out = best.out, f = best.tr.fidelity;
      out.notes = (out.notes || []).concat(['auto ' + goal + ': ' + evaluations + ' candidates, ' + best.label + '; traced fidelity ' + (100 * f.fidelity).toFixed(1) + '%, on-paint ' + (100 * f.onPaint).toFixed(1) + '%, peak ' + Math.round(best.tr.peakCd) + ' cd']);
      out.extras = Object.assign({}, out.extras, { tuned: { goal, settings: best.set, candidates: evaluations, rays: usedRays } });
      return out;
    },
  });
})();
