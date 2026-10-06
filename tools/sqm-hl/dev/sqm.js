/* sqm.js — the supporting-quadric core: one continuous reflector as the lower envelope of confocal ellipsoids (paraboloids for a far-field aim).
 *
 * Aim j (a far-field direction, or a point Z_j at distance c_j) owns the ellipsoid with foci LED and Z_j and one size number β_j (its extra path
 * length): r_j(u) = β(β + 2c) / (2β + 2c(1 − u·â_j)) along direction u from the LED.  In every direction the NEAREST ellipsoid is the mirror, so the
 * surface is continuous.  Growing β_j shrinks cell j.  The sizes are found so that each cell catches its share of the light: semi-discrete optimal
 * transport, solved by damped Newton on an entropic dual (Kitagawa–Mérigot–Thibert) at falling temperature τ.
 *
 *   RF.SqmCore.directions(src, env, opt)  → D { n, ux,uy,uz, m (lm), rEnv, rMin, ang, q, a, NA, NP, B, e1, e2, dOm }
 *   RF.SqmCore.balance(D, A, opt)         → { x (ln β), assign (Int32Array), flux[], err, ... }  A[j] = { c, ax, ay, az, g (target lm) }
 *   RF.SqmCore.radius(A[j], x, u)         → r
 */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- directions: an equal-area grid about the beam axis B
  function directions(src, env, o) {
    o = Object.assign({ NA: 120, margin: 0.3, rmin: 0, B: [1, 0, 0] }, o || {});
    const NA = o.NA, NP = 2 * NA, B = V.norm(o.B), [e1, e2] = V.basis(B), fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), dOm = 4 * Math.PI / (NA * NP), Lp = src.pos;
    const ux = [], uy = [], uz = [], m = [], rEnv = [], rMin = [], ang = [], qq = [], aa = [];
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = (q + 0.5) / NP * 2 * Math.PI;
      const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
      const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
      const iv = RF.Geo.envInterval(env, Lp, u); if (!iv || !(iv[1] > Math.max(0, iv[0]))) continue;
      const rE = iv[1] - o.margin, rM = Math.max(o.rmin, iv[0] > 0 ? iv[0] + o.margin : 0); if (!(rE > rM)) continue;
      ux.push(u[0]); uy.push(u[1]); uz.push(u[2]); m.push(src.power * I / Itot * dOm); rEnv.push(rE); rMin.push(rM); ang.push(Math.acos(ca) * 180 / Math.PI); qq.push(q); aa.push(a);
    }
    const cellOf = new Int32Array(NA * NP).fill(-1); for (let i = 0; i < qq.length; i++) cellOf[qq[i] * NA + aa[i]] = i;
    return { cellOf, n: ux.length, ux: Float64Array.from(ux), uy: Float64Array.from(uy), uz: Float64Array.from(uz), m: Float64Array.from(m), rEnv: Float64Array.from(rEnv), rMin: Float64Array.from(rMin), ang: Float64Array.from(ang), q: Int32Array.from(qq), a: Int32Array.from(aa), NA, NP, B, e1, e2, dOm, Lp: Lp.slice(), fr };
  }
  // corner direction of cell (q, a): the grid line crossing (q·dφ, a·dα)
  function corner(D, q, a) { const ca = 1 - 2 * a / D.NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = q / D.NP * 2 * Math.PI; return V.add(V.mul(D.B, ca), V.mul(V.add(V.mul(D.e1, Math.cos(phi)), V.mul(D.e2, Math.sin(phi))), sa)); }

  const radius = (A, x, u) => { const b = Math.exp(x), c2 = 2 * A.c; return b * (b + c2) / (2 * b + c2 * (1 - (u[0] * A.ax + u[1] * A.ay + u[2] * A.az))); };

  // ---------------------------------------------------------------- dense Cholesky solve (A symmetric positive definite, destroyed)
  function chol(A, b, n) {
    for (let j = 0; j < n; j++) {
      let s = A[j * n + j]; for (let k = 0; k < j; k++) s -= A[j * n + k] * A[j * n + k];
      if (!(s > 1e-300)) return null; const dj = Math.sqrt(s); A[j * n + j] = dj;
      for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / dj; }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= A[i * n + k] * y[k]; y[i] = t / A[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= A[k * n + i] * y[k]; y[i] = t / A[i * n + i]; }
    return y;
  }

  /* ---------------------------------------------------------------- the balance
   * D: directions (those with D.on[i] = 1 are in play), A: aims, x: Float64Array(J) ln β (in/out), taus: temperature schedule.
   * Soft cell mass F_j = Σ_i m_i p_ij, p_ij ∝ exp(−ln r_ij / τ).  Newton on F(x) = g with M = −∂F/∂x (a weighted graph Laplacian over neighbouring
   * cells), Levenberg damping, a step is kept only if the relative flux error falls.  Candidate lists per direction (every aim whose radius is within a
   * window of the smallest) keep a step O(directions × few).                                                                                            */
  function newton(D, on, A, x, taus, tolLast, maxIt, o) {
    o = o || {}; const J = A.length, nd = D.n, WIN = o.window || 0.08;
    let tot = 0; for (let i = 0; i < nd; i++) if (on[i]) tot += D.m[i];
    let gsum = 0; for (const a of A) gsum += a.g; const want = A.map((a) => a.g / gsum * tot);
    const cc = new Float64Array(J), ax = new Float64Array(J), ay = new Float64Array(J), az = new Float64Array(J);
    for (let j = 0; j < J; j++) { cc[j] = 2 * A[j].c; ax[j] = A[j].ax; ay[j] = A[j].ay; az[j] = A[j].az; }
    const b = new Float64Array(J), q = new Float64Array(J), e2 = new Float64Array(J), gb = new Float64Array(J);
    const setB = () => { for (let j = 0; j < J; j++) { const bj = Math.exp(x[j]); b[j] = bj; q[j] = bj * (bj + cc[j]); e2[j] = 2 * bj; gb[j] = 1 + bj / (bj + cc[j]); } };
    const xr = new Float64Array(J).fill(NaN); let coff = new Int32Array(nd + 1), cidx = new Int32Array(nd * 6 + 64), tauBuilt = 0;
    const rOf = (i, j) => q[j] / (e2[j] + cc[j] * (1 - (D.ux[i] * ax[j] + D.uy[i] * ay[j] + D.uz[i] * az[j])));
    const drift = () => { let mx = 0; for (let j = 0; j < J; j++) { const d = Math.abs(x[j] - xr[j]); if (!(d <= mx)) mx = d; } return mx; };
    const R = new Float64Array(J);
    const rebuild = (tau) => {
      xr.set(x); tauBuilt = tau; const w = Math.exp(2 * 1.3 * WIN + 18 * tau); let n = 0;
      for (let i = 0; i < nd; i++) {
        coff[i] = n; if (!on[i]) continue;
        let rmin = Infinity; for (let j = 0; j < J; j++) { const r = rOf(i, j); R[j] = r; if (r < rmin) rmin = r; }
        const thr = rmin * w; if (n + J > cidx.length) { const g2 = new Int32Array(Math.max(cidx.length * 2, n + J)); g2.set(cidx.subarray(0, n)); cidx = g2; }
        for (let j = 0; j < J; j++) if (R[j] <= thr) cidx[n++] = j;
      }
      coff[nd] = n;
    };
    const F = new Float64Array(J), M = new Float64Array(J * J), pp = new Float64Array(J), cj = new Int32Array(J), gg = new Float64Array(J), lr = new Float64Array(J);
    const evalF = (tau, wantM) => {
      setB(); if (drift() > WIN || tau > tauBuilt) rebuild(tau);
      F.fill(0); if (wantM) M.fill(0); const cut = 18 * tau;
      for (let i = 0; i < nd; i++) {
        if (!on[i]) continue; const o0 = coff[i], o1 = coff[i + 1]; let lmin = Infinity;
        for (let t = o0; t < o1; t++) { const j = cidx[t], l = Math.log(rOf(i, j)); lr[t - o0] = l; if (l < lmin) lmin = l; }
        let nc = 0, zs = 0;
        for (let t = 0; t < o1 - o0; t++) if (lr[t] - lmin <= cut) { cj[nc] = cidx[o0 + t]; const p = Math.exp(-(lr[t] - lmin) / tau); pp[nc] = p; zs += p; nc++; }
        const fl = D.m[i];
        for (let t = 0; t < nc; t++) { pp[t] /= zs; F[cj[t]] += fl * pp[t]; }
        if (wantM) {
          const f = fl / tau;
          for (let t = 0; t < nc; t++) { const j = cj[t]; gg[t] = gb[j] - 2 * b[j] / (e2[j] + cc[j] * (1 - (D.ux[i] * ax[j] + D.uy[i] * ay[j] + D.uz[i] * az[j]))); }
          for (let t = 0; t < nc; t++) { const pt = pp[t]; if (pt < 1e-7) continue; const it = cj[t] * J; M[it + cj[t]] += f * gg[t] * pt * (1 - pt); for (let u = 0; u < nc; u++) if (u !== t && pp[u] >= 1e-7) M[it + cj[u]] -= f * gg[u] * pt * pp[u]; }
        }
      }
    };
    const norm = (res) => { let s = 0; for (let j = 0; j < J; j++) s += res[j] * res[j] / (want[j] * want[j]); return Math.sqrt(s / J); };
    const res = new Float64Array(J), res2 = new Float64Array(J), Asym = new Float64Array(J * J), xo = new Float64Array(J);
    let soft = 0, iters = 0;
    for (let si = 0; si < taus.length; si++) {
      const tau = taus[si], last = si === taus.length - 1; let mu = 1e-3, revived = 0;
      for (let it = 0; it < maxIt; it++) {
        iters++; evalF(tau, true); for (let j = 0; j < J; j++) res[j] = F[j] - want[j];
        let worst = 0; for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(res[j]) / want[j]); soft = worst;
        if (worst < (last ? tolLast : Math.max(0.05, tolLast))) break;
        // a cell with (almost) no flux has no gradient: shrink it until it is within ~3τ of winning its best direction
        let dead = 0; for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) dead++;
        if (dead && revived < 6) {
          revived++; const mr = new Float64Array(J).fill(Infinity), isd = new Uint8Array(J); for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) isd[j] = 1;
          for (let i = 0; i < nd; i++) { if (!on[i]) continue; let rmin = Infinity; for (let j = 0; j < J; j++) { const r = rOf(i, j); R[j] = r; if (r < rmin) rmin = r; } for (let j = 0; j < J; j++) if (isd[j]) { const t = R[j] / rmin; if (t < mr[j]) mr[j] = t; } }
          for (let j = 0; j < J; j++) if (isd[j] && mr[j] < Infinity) x[j] -= Math.max(0, Math.log(mr[j]) / gb[j]) + 3 * tau;
          it--; continue;
        }
        const n0 = norm(res); let dm = 0; for (let j = 0; j < J; j++) dm += M[j * J + j]; dm = dm / J + 1e-300;
        let ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++, mu *= 10) {
          for (let i = 0; i < J; i++) { for (let j = 0; j < J; j++) Asym[i * J + j] = 0.5 * (M[i * J + j] + M[j * J + i]); Asym[i * J + i] += mu * (M[i * J + i] + 1e-3 * dm); }
          const dl = chol(Asym, res, J); if (!dl) continue;
          let mean = 0; for (let j = 0; j < J; j++) mean += dl[j]; mean /= J; for (let j = 0; j < J; j++) dl[j] = clamp(dl[j] - mean, -0.3, 0.3);
          for (let s = 1; s > 0.05 && !ok; s *= 0.5) {
            xo.set(x); for (let j = 0; j < J; j++) x[j] += s * dl[j];
            evalF(tau, false); for (let j = 0; j < J; j++) res2[j] = F[j] - want[j];
            if (norm(res2) < n0 * (1 - 1e-3 * s)) { ok = true; mu = Math.max(1e-6, mu * 0.05 / 10); } else x.set(xo);
          }
        }
        if (!ok) break;
      }
    }
    return { soft, iters };
  }

  // hard partition at x: each direction in play goes to the aim with the smallest radius
  function assign(D, on, A, x) {
    const J = A.length, nd = D.n, asg = new Int32Array(nd).fill(-1), rr = new Float64Array(nd), flux = new Float64Array(J);
    const b = A.map((a, j) => Math.exp(x[j])), cc = A.map((a) => 2 * a.c);
    for (let i = 0; i < nd; i++) {
      if (!on[i]) continue; let bj = -1, br = Infinity;
      for (let j = 0; j < J; j++) { const A_ = A[j], r = b[j] * (b[j] + cc[j]) / (2 * b[j] + cc[j] * (1 - (D.ux[i] * A_.ax + D.uy[i] * A_.ay + D.uz[i] * A_.az))); if (r > 0 && r < br) { br = r; bj = j; } }
      asg[i] = bj; rr[i] = br; if (bj >= 0) flux[bj] += D.m[i];
    }
    return { asg, rr, flux };
  }

  RF.SqmCore = { directions, corner, radius, newton, assign, chol };
})();
