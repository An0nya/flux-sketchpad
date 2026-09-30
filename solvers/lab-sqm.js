/* Supporting quadrics — a continuous-reflector paint solver (Flux solver lab, 2026-09-29).
 *
 * The method of supporting ellipsoids (Oliker; Kochengin–Oliker): pick N aim points z_j on the target, each with a
 * share w_j of the light.  Aim j gets an ellipsoid E_j with one focus at the LED and the other at z_j, sized by one
 * number β_j (its extra path length: |LED→P| + |P→z_j| = |LED→z_j| + β_j).  Seen from the LED, in every direction
 * the NEAREST ellipsoid is the mirror — so the reflector is one continuous surface (the boundary of the ellipsoids'
 * intersection), made of patches that meet where neighbouring ellipsoids cross.  Every ray a patch catches goes to its
 * aim point (exactly, for a point source).  Growing β_j shrinks patch j (others win more directions), so the sizes are
 * iterated until each patch catches its share (a semi-discrete optimal transport problem).
 *
 * The LED is not a point: each patch paints an image of the LED around its aim point.  Fournier's compensation
 * (dissertation, UCF): predict the blurred result, compare it with the paint, and adjust the VIRTUAL target (the
 * shares, and nudge the aims) until the blurred prediction matches.  Predictions use exact geometry (the real
 * ellipsoid, real normals, LED samples reflected), no ray tracing.
 *
 * Buildability is the point: neighbouring facets share their edges (up to the direction-grid resolution), unlike the
 * stepped facet solvers.  Fidelity at low facet counts is the price: N aims = N LED images.                       */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function ledSamples(src, P, n, nv) {                   // points on / in the source that shine toward P, weighted (rect: n × nv lattice)
    const fr = RF.Source.frame(src), out = [], p = src.pos;
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const g = (i, m) => (i + 0.5) / m - 0.5;
    if (src.kind === 'point') return [{ x: p.slice(), w: 1 }];
    if (src.kind === 'planar') {
      if (src.shape === 'disc') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = g(i, n) * 2, y = g(j, n) * 2; if (x * x + y * y > 1) continue; out.push({ x: at(x * src.radius, y * src.radius, 0), w: 1 }); } }
      else { const m = nv || n; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out.push({ x: at(g(i, n) * src.w, g(j, m) * src.h, 0), w: 1 }); }
    } else if (src.shape === 'cylinder') {
      const d = V.norm(V.sub(P, p)), surf = src.emission === 'surface';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a = (i + 0.5) / n * 2 * Math.PI, h = g(j, n) * src.length, nr = V.add(V.mul(fr.u, Math.cos(a)), V.mul(fr.v, Math.sin(a)));
        if (surf) { const c = V.dot(nr, d); if (c <= 0) continue; out.push({ x: V.add(at(0, 0, h), V.mul(nr, src.radius)), w: c }); }
        else { const rr = src.radius * Math.sqrt((j * 7 % n + 0.5) / n); out.push({ x: V.add(at(0, 0, h), V.mul(nr, rr)), w: 1 }); }
      }
    } else {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = g(i, n) * 2, y = g(j, n) * 2; if (x * x + y * y > 1) continue; out.push({ x: V.add(p, V.add(V.mul(fr.u, x * src.radius), V.mul(fr.v, y * src.radius))), w: 1 }); }
    }
    const W = out.reduce((s, q) => s + q.w, 0); for (const q of out) q.w /= W;
    return out;
  }

  function solveOnce(input, S, tools) {
    const prog = (f, st) => { if (tools && tools.progress) tools.progress(f, st); };
    const src = input.source, env = input.envelope, Lp = src.pos, R = input.paint.res, paint = input.paint.cells;
    const T = RF.Engine.designFrame(input.target), cell = 2 * T.half / R, N0 = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
    const world = (u, v) => V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));
    const notes = [];
    const pcells = []; let psum = 0;
    for (let k = 0; k < R * R; k++) if (paint[k] > 0) { pcells.push(k); psum += paint[k]; }
    if (!pcells.length) return { surfaces: [], intent: [], notes: ['nothing painted'], pred: { fid: 0, onPaint: 0 } };
    const uvOf = (k) => RF.Engine.cellCenter(T, k % R, (k / R) | 0);
    let cu0 = 0, cv0 = 0; for (const k of pcells) { const [u, v] = uvOf(k); cu0 += u * paint[k]; cv0 += v * paint[k]; } cu0 /= psum; cv0 /= psum;
    const B = V.norm(V.sub(world(cu0, cv0), Lp)), [e1, e2] = V.basis(B);

    // ---- directions: equal-area grid (cosα uniform) about the beam axis; flux and room per direction
    prog(0.02, 'directions');
    const N = Math.min(N0, pcells.length), NA = Math.max(60, Math.round(Math.sqrt(S.cellsPerFacet * N * 2))), NP = 2 * NA;
    const fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), dOm = 4 * Math.PI / (NA * NP);
    const rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5 + S.margin;
    const openList = S.open >= 0 ? [S.open] : S.opens, minOpen = Math.min(...openList); let openNow = openList[0];
    const dirs = [];
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = (q + 0.5) / NP * 2 * Math.PI;
      const ang = Math.acos(ca) * 180 / Math.PI; if (ang < minOpen) continue;    // the front opening (toward the target) stays open
      const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
      const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
      const iv = RF.Geo.envInterval(env, Lp, u), rEnv = iv && iv[1] > Math.max(0, iv[0]) ? iv[1] - S.margin : -1;
      if (rEnv < rmin) continue;
      dirs.push({ u, q, a, ang, flux: src.power * I / Itot * dOm, rEnv, on: ang >= openNow });
    }
    if (!dirs.length) return { surfaces: [], intent: [], notes: ['no direction from the LED can hold a mirror inside the envelope'], pred: { fid: 0, onPaint: 0 } };

    // ---- aims: weighted k-means of the paint into N regions (deterministic seeding: spread along a space-filling order)
    prog(0.05, 'aims');
    const ord = pcells.slice().sort((x, y) => { const hx = hil(x), hy = hil(y); return hx - hy || x - y; });
    function hil(k) { let x = k % R, y = (k / R) | 0, d = 0; for (let s = 1 << 10; s > 0; s >>= 1) { const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; } } return d; }
    const cw = new Float64Array(R * R); let csum = 0; for (const k of pcells) { cw[k] = Math.pow(paint[k], S.aimBias); csum += cw[k]; }     // clustering weight: paint^bias (1 = by light, 0 = by painted area)
    let aims = []; { let acc = 0, next = csum / N / 2; for (const k of ord) { acc += cw[k]; if (acc >= next && aims.length < N) { const [u, v] = uvOf(k); aims.push({ u, v, w: 0 }); next += csum / N; } } }
    const owner = new Int32Array(R * R).fill(-1);      // which aim's region each painted cell belongs to (intent output)
    for (let it = 0; it < S.lloyd; it++) {
      const su = new Float64Array(aims.length), sv = new Float64Array(aims.length), sw = new Float64Array(aims.length), sp = new Float64Array(aims.length);
      for (const k of pcells) { const [u, v] = uvOf(k); let bj = 0, bd = Infinity; for (let j = 0; j < aims.length; j++) { const d = (u - aims[j].u) ** 2 + (v - aims[j].v) ** 2; if (d < bd) { bd = d; bj = j; } } owner[k] = bj; su[bj] += u * cw[k]; sv[bj] += v * cw[k]; sw[bj] += cw[k]; sp[bj] += paint[k]; }
      for (let j = 0; j < aims.length; j++) if (sw[j] > 0) { aims[j].u = su[j] / sw[j]; aims[j].v = sv[j] / sw[j]; aims[j].w = sp[j] / psum; }
    }
    aims = aims.filter((z) => z.w > 0);
    // each ellipsoid's second focus is its aim point z_j
    const setFocus = (z) => { z.Z = world(z.u, z.v); z.F = z.Z; z.d = V.sub(z.F, Lp); z.c = V.len(z.d); z.ah = V.mul(z.d, 1 / z.c); };
    for (const z of aims) { setFocus(z); z.target = z.w; }

    // ---- supporting ellipsoids: r_j(u) = β(β+2c) / (2β + 2c(1 − u·â_j)); nearest wins
    const rOf = (z, u) => { const b = z.beta; return b * (b + 2 * z.c) / (2 * b + 2 * z.c * (1 - V.dot(u, z.ah))); };
    for (const z of aims) z.beta = 2 * S.startR;                                   // ≈ a paraboloid with f = startR
    function assign() {
      for (const z of aims) { z.flux = 0; z.n = 0; }
      for (const d of dirs) {
        if (!d.on) { d.j = -1; continue; }
        let bj = -1, br = Infinity;
        for (let j = 0; j < aims.length; j++) { const r = rOf(aims[j], d.u); if (r > 0 && r < br) { br = r; bj = j; } }
        d.j = bj; d.r = br; if (bj >= 0) { aims[bj].flux += d.flux; aims[bj].n++; }
      }
    }
    // Balancing = semi-discrete optimal transport: choose the sizes β so that every patch catches its share of the light.
    // Winner-take-all makes a patch's flux a step function of the sizes, so plain multiplicative updates thrash (measured:
    // 86 of 100 patches empty after 250 steps) and annealed Sinkhorn updates diverge on photo-like paints (fluxes 2000× off).
    // Instead: share each direction softly among the patches, p_j ∝ exp(−log r_j / τ), which makes the fluxes smooth in
    // log β, and take damped Newton steps on that (Kitagawa–Mérigot–Thibert): the Jacobian is a graph Laplacian over
    // neighbouring patches, solved densely (Cholesky) with Levenberg damping; a step is accepted only if the flux error falls.
    // τ is lowered in stages until the soft partition is as sharp as the hard one (the surface itself is the hard minimum).
    function dSolve(A, b, n) {                                   // A (n×n, row-major, destroyed) SPD → x, or null
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
    // A[j] = { c, ah, target } (target shares sum to 1); ds = the directions in play; x = log β (in/out); returns soft max relative error.
    // Exact over ALL patches (no shortlist: in the fine problem the 32nd-nearest patch is only 0.1–0.3% farther than the
    // nearest, so a shortlist silently truncates the soft partition).  A table of direction·aim dot products makes a
    // radius one multiply-add and one division; only near-ties (within ~18τ of the smallest radius) get an exponential.
    function newtonCore(A, ds, x, taus, tolLast, maxIt) {
      const J = A.length, nd = ds.length; let tot = 0; for (const d of ds) tot += d.flux;
      const want = A.map((z) => z.target * tot), dots = new Float64Array(nd * J), cc = new Float64Array(J);
      for (let j = 0; j < J; j++) { cc[j] = 2 * A[j].c; const a = A[j].ah; for (let di = 0; di < nd; di++) { const u = ds[di].u; dots[di * J + j] = u[0] * a[0] + u[1] * a[1] + u[2] * a[2]; } }
      const b = new Float64Array(J), q = new Float64Array(J), e2 = new Float64Array(J), gb = new Float64Array(J), R = new Float64Array(J);
      const cj = new Int32Array(J), pp = new Float64Array(J), gg = new Float64Array(J);
      const Fs = new Float64Array(J), M = new Float64Array(J * J);
      const setB = () => { for (let j = 0; j < J; j++) { const bj = Math.exp(x[j]); b[j] = bj; q[j] = bj * (bj + cc[j]); e2[j] = 2 * bj; gb[j] = 1 + bj / (bj + cc[j]); } };
      const evalF = (tau, wantM) => {                            // soft fluxes at x; if wantM also M = −∂F/∂x
        setB(); Fs.fill(0); if (wantM) M.fill(0); const cut = Math.exp(18 * tau);
        for (let di = 0, o = 0; di < nd; di++, o += J) {
          let rmin = Infinity; for (let j = 0; j < J; j++) { const r = q[j] / (e2[j] + cc[j] * (1 - dots[o + j])); R[j] = r; if (r < rmin) rmin = r; }
          const thr = rmin * cut; let nc = 0, zs = 0;
          for (let j = 0; j < J; j++) if (R[j] <= thr) { cj[nc] = j; const p = Math.exp(-Math.log(R[j] / rmin) / tau); pp[nc] = p; zs += p; nc++; }
          const fl = ds[di].flux;
          for (let t = 0; t < nc; t++) { pp[t] /= zs; Fs[cj[t]] += fl * pp[t]; }
          if (wantM) { const f = fl / tau;
            for (let t = 0; t < nc; t++) { const j = cj[t]; gg[t] = gb[j] - 2 * b[j] / (e2[j] + cc[j] * (1 - dots[o + j])); }
            for (let t = 0; t < nc; t++) { const pt = pp[t]; if (pt < 1e-7) continue; const it = cj[t] * J;
              M[it + cj[t]] += f * gg[t] * pt * (1 - pt);
              for (let u = 0; u < nc; u++) if (u !== t && pp[u] >= 1e-7) M[it + cj[u]] -= f * gg[u] * pt * pp[u]; } }
        }
      };
      const norm = (res) => { let s = 0; for (let j = 0; j < J; j++) s += res[j] * res[j] / (want[j] * want[j]); return Math.sqrt(s / J); };
      const res = new Float64Array(J), res2 = new Float64Array(J), Asym = new Float64Array(J * J), xo = new Float64Array(J);
      let soft = 0;
      for (let si = 0; si < taus.length; si++) {
        const tau = taus[si], last = si === taus.length - 1; let mu = 1e-3, revived = 0;
        for (let it = 0; it < maxIt; it++) {
          evalF(tau, true); for (let j = 0; j < J; j++) res[j] = Fs[j] - want[j];
          let worst = 0; for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(res[j]) / want[j]);
          soft = worst; if (worst < (last ? tolLast : Math.max(0.05, tolLast))) break;
          // a patch with (almost) no flux has no gradient either (its weight underflows at small τ): bring it back to the edge of
          // the partition, i.e. shrink it until it is within ~3τ of winning its best direction
          let dead = 0; for (let j = 0; j < J; j++) if (Fs[j] < 1e-3 * want[j]) dead++;
          if (dead && revived < 6) {
            revived++; const mr = new Float64Array(J).fill(Infinity), isd = new Uint8Array(J); for (let j = 0; j < J; j++) if (Fs[j] < 1e-3 * want[j]) isd[j] = 1;
            for (let di = 0, o = 0; di < nd; di++, o += J) {
              let rmin = Infinity; for (let j = 0; j < J; j++) { const r = q[j] / (e2[j] + cc[j] * (1 - dots[o + j])); R[j] = r; if (r < rmin) rmin = r; }
              for (let j = 0; j < J; j++) if (isd[j]) { const t = R[j] / rmin; if (t < mr[j]) mr[j] = t; }
            }
            for (let j = 0; j < J; j++) if (isd[j] && mr[j] < Infinity) x[j] -= Math.max(0, Math.log(mr[j]) / gb[j]) + 3 * tau;
            it--; continue;
          }
          const n0 = norm(res); let dm = 0; for (let j = 0; j < J; j++) dm += M[j * J + j]; dm = dm / J + 1e-300;
          if (globalThis.SQMDBG > 1) console.log('     J', J, 'it', it, 'tau', tau, 'norm', n0.toFixed(4), 'worst', worst.toFixed(3), 'mu', mu.toExponential(1), 'x range', Math.min(...x).toFixed(4), Math.max(...x).toFixed(4));
          let ok = false;
          for (let tries = 0; tries < 8 && !ok; tries++, mu *= 10) {
            for (let i = 0; i < J; i++) { for (let j = 0; j < J; j++) Asym[i * J + j] = 0.5 * (M[i * J + j] + M[j * J + i]); Asym[i * J + i] += mu * (M[i * J + i] + 1e-3 * dm); }
            const dl = dSolve(Asym, res, J); if (!dl) continue;
            let mean = 0; for (let j = 0; j < J; j++) mean += dl[j]; mean /= J; for (let j = 0; j < J; j++) dl[j] = clamp(dl[j] - mean, -0.3, 0.3);
            for (let s = 1; s > 0.05 && !ok; s *= 0.5) {
              xo.set(x); for (let j = 0; j < J; j++) x[j] += s * dl[j];
              evalF(tau, false); for (let j = 0; j < J; j++) res2[j] = Fs[j] - want[j];
              if (norm(res2) < n0 * (1 - 1e-3 * s)) { ok = true; mu = Math.max(1e-6, mu * 0.05 / 10); } else x.set(xo);
            }
          }
          if (!ok) break;
        }
        if (globalThis.SQMDBG) console.log('   newton J', J, 'τ', tau, 'soft max rel err', soft.toFixed(4));
      }
      return soft;
    }
    // super-aims: merge nearby aims 4:1 (weighted k-means on the target positions) until few remain
    function levelsOf() {
      const lv = [{ A: aims, par: null }]; let cur = aims.map((z) => ({ u: z.u, v: z.v, w: z.target, ah: z.ah, c: z.c }));
      while (cur.length > 24) {
        const K = Math.ceil(cur.length / 4), ordr = cur.map((_, i) => i).sort((a, b) => hil(cellOf(cur[a])) - hil(cellOf(cur[b])) || a - b);
        let tw = 0; for (const c of cur) tw += c.w; let cs = [], acc = 0, nxt = tw / K / 2;
        for (const i of ordr) { acc += cur[i].w; if (acc >= nxt && cs.length < K) { cs.push({ u: cur[i].u, v: cur[i].v }); nxt += tw / K; } }
        let par = new Int32Array(cur.length);
        for (let it = 0; it < 6; it++) {
          const su = new Float64Array(cs.length), sv = new Float64Array(cs.length), sw = new Float64Array(cs.length);
          cur.forEach((c, i) => { let bj = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const d = (c.u - cs[j].u) ** 2 + (c.v - cs[j].v) ** 2; if (d < bd) { bd = d; bj = j; } } par[i] = bj; su[bj] += c.u * c.w; sv[bj] += c.v * c.w; sw[bj] += c.w; });
          cs = cs.map((c, j) => sw[j] > 0 ? { u: su[j] / sw[j], v: sv[j] / sw[j] } : c);
        }
        const used = new Map(); let nn = 0; for (let i = 0; i < cur.length; i++) if (!used.has(par[i])) used.set(par[i], nn++);
        const next = []; for (let i = 0; i < nn; i++) next.push({ u: 0, v: 0, w: 0, ah: [0, 0, 0], c: 0 });
        cur.forEach((c, i) => { const q = next[used.get(par[i])]; q.u += c.u * c.w; q.v += c.v * c.w; q.w += c.w; q.c += c.c * c.w; q.ah = V.add(q.ah, V.mul(c.ah, c.w)); });
        for (const q of next) { q.u /= q.w; q.v /= q.w; q.c /= q.w; q.ah = V.norm(q.ah); }         // a super-aim looks where its members look (they may be defocused: their foci are not on the LED→aim line)
        const pidx = Int32Array.from(cur.map((_, i) => used.get(par[i])));
        lv[lv.length - 1].par = pidx;
        const A = next.map((q) => ({ c: q.c, ah: q.ah, target: q.w }));
        lv.push({ A, par: null }); cur = next;
      }
      return lv.reverse();                                       // coarsest first; each level's `par` maps its members to the next-coarser one
    }
    function cellOf(q) { const half = T.half; return clamp(Math.floor((q.v / (2 * half) + 0.5) * R), 0, R - 1) * R + clamp(Math.floor((q.u / (2 * half) + 0.5) * R), 0, R - 1); }
    // Cold start (coarse to fine, see levelsOf) or warm start from the current sizes; a warm solve that fails falls back to cold.
    function balance(warm) {
      const on = dirs.filter((d) => d.on), J = aims.length, x = new Float64Array(J);
      const beta0 = aims.map((z) => z.beta); let gm = 0; for (const z of aims) gm += Math.log(z.beta); gm /= J;
      const tolL = S.tol * 0.3, mi = 10;
      const coldSolve = () => {
        const lv = levelsOf(); let xp = null;
        lv.forEach((L, li) => {
          const last = li === lv.length - 1, xl = new Float64Array(L.A.length), nJ = L.A.length;
          if (!xp) { xl.fill(gm); newtonCore(L.A, on, xl, [0.03, 0.01, 0.003, 0.001, 0.0004], 0.1, mi); }
          else {
            // split each parent's region among its children (small local problems), centred on the parent's size
            const PA = lv[li - 1].A, win = new Int32Array(on.length), kids = PA.map(() => []), dg = PA.map(() => []);
            on.forEach((d, di) => { let bj = -1, br = Infinity; for (let j = 0; j < PA.length; j++) { const b = Math.exp(xp[j]), z = PA[j], r = b * (b + 2 * z.c) / (2 * b + 2 * z.c * (1 - V.dot(d.u, z.ah))); if (r < br) { br = r; bj = j; } } dg[bj].push(d); });
            for (let j = 0; j < nJ; j++) kids[L.par[j]].push(j);
            for (let g = 0; g < PA.length; g++) {
              const C = kids[g]; let tw = 0; for (const j of C) tw += L.A[j].target;
              if (C.length === 1 || dg[g].length < 2 || !(tw > 0)) { for (const j of C) xl[j] = xp[g]; continue; }
              const sub = C.map((j) => ({ c: L.A[j].c, ah: L.A[j].ah, target: L.A[j].target / tw })), xg = new Float64Array(C.length).fill(xp[g]);
              newtonCore(sub, dg[g], xg, [0.02, 0.006, 0.002, 0.0006, 0.0002], 0.03, mi);
              let mean = 0; C.forEach((j, q) => { mean += sub[q].target * xg[q]; });
              C.forEach((j, q) => { xl[j] = xp[g] + xg[q] - mean; });
              // the children's lower envelope sits below their parent's own size; lift them so, on average over the region, they cost what the parent did
              const lc = (z, b, u) => Math.log(b * (b + 2 * z.c) / (2 * b + 2 * z.c * (1 - V.dot(u, z.ah)))); let sh = 0, sf = 0;
              for (const d of dg[g]) { let env = Infinity; C.forEach((j) => { env = Math.min(env, lc(L.A[j], Math.exp(xl[j]), d.u)); }); sh += d.flux * (lc(PA[g], Math.exp(xp[g]), d.u) - env); sf += d.flux; }
              sh /= sf; for (const j of C) xl[j] += sh;
            }
            newtonCore(L.A, on, xl, last ? [0.0006, 0.00015, 0.00006].concat(S.finalTau < 0.00006 ? [S.finalTau] : []) : [0.002, 0.0006, 0.0002], last ? tolL : 0.1, mi);
          }
          xp = xl;
        });
        x.set(xp);
      };
      let ok = false;
      if (warm) { aims.forEach((z, j) => { x[j] = Math.log(z.beta); }); const soft = newtonCore(aims, on, x, [S.finalTau], tolL, mi); ok = soft < 0.25; if (!ok) aims.forEach((z, j) => { z.beta = beta0[j]; }); if (globalThis.SQMDBG && !ok) console.log('  warm balance failed (soft error ' + soft.toFixed(2) + '): cold restart'); }
      if (!ok) coldSolve();
      aims.forEach((z, j) => { z.beta = Math.exp(x[j]); });
      assign(); let err = 0, tot = 0; for (const d of on) tot += d.flux; for (const z of aims) { const w = z.target * tot; err = Math.max(err, Math.abs(z.flux - w) / Math.max(1e-12, w)); }
      if (globalThis.SQMDBG) { const es = aims.map((z) => Math.abs(z.flux - z.target * tot) / (z.target * tot)).sort((a, b) => a - b); console.log('  balance(newton): hard-partition rel error max', err.toFixed(3), 'p50', es[es.length >> 1].toFixed(3), 'p90', es[Math.floor(es.length * 0.9)].toFixed(3), 'rms', Math.sqrt(es.reduce((a, e) => a + e * e, 0) / es.length).toFixed(3), 'empty', aims.filter((z) => z.flux === 0).length); }
      return err;
    }
    // Scaling or re-aiming patches: β and the radius are not proportional (r = β(β+2c)/(2β+2c(1−cosθ))), so to move a patch's
    // size by a factor, re-solve its β so its mean log-radius over its own directions moves by exactly that (shift, in log units).
    function keepSizes(mutate, shift) {
      const byJ = aims.map(() => []); for (const d of dirs) if (d.on && d.j >= 0) byJ[d.j].push(d);
      const tgt = aims.map((z, j) => { let s = 0, w = 0; for (const d of byJ[j]) { s += Math.log(d.r) * d.flux; w += d.flux; } return w > 0 ? s / w + (shift || 0) : NaN; });
      mutate();
      aims.forEach((z, j) => {
        if (!(tgt[j] === tgt[j])) return; const w = byJ[j].reduce((a, d) => a + d.flux, 0);
        for (let it = 0; it < 6; it++) { let s = 0; for (const d of byJ[j]) s += Math.log(rOf(z, d.u)) * d.flux; z.beta *= Math.exp(clamp(tgt[j] - s / w, -1, 1)); }
      });
    }
    // Scaling to fit the WORST direction squashes everything (forward directions want huge radii), so scale until
    // `fitShare` of the light fits, and let the directions that still stick out (or fall inside the clearance) go
    // uncovered; rebalance and repeat.
    let err = 0;
    const sizeList = S.size > 0 ? [S.size] : S.sizes; let sizeNow = sizeList[0];
    function fit() {
      const rat = []; for (const d of dirs) if (d.on && d.j >= 0) rat.push([d.r / d.rEnv, d.flux]);
      rat.sort((a, b) => a[0] - b[0]); let tot = 0; for (const x of rat) tot += x[1];
      let acc = 0, q = rat.length ? rat[rat.length - 1][0] : 1; for (const x of rat) { acc += x[1]; if (acc >= S.fitShare * tot) { q = x[0]; break; } }
      q /= sizeNow;                                            // size < 1: keep the reflector that much smaller than the envelope allows (bigger LED images: image size ∝ 1 / distance)
      if (q > 1) keepSizes(() => {}, -Math.log(q * 1.002));   // scale every patch's radius, not β (β + 2c is not homogeneous)
      assign(); let dropped = 0; for (const d of dirs) if (d.on && (d.j < 0 || d.r > d.rEnv || d.r < rmin)) { d.on = false; dropped++; }
      return { q, dropped };
    }
    if (globalThis.SQMDBG) console.log('dirs', dirs.length, 'aims', aims.length, 'rmin', rmin.toFixed(2));
    const ledSz = src.kind === 'point' ? 0 : src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.sqrt(src.w * src.h)) : 2 * src.radius;
    for (let round = 0; round < 8; round++) {
      err = balance(round > 0);
      if (globalThis.SQMDBG) { let on = 0, rr = []; for (const d of dirs) if (d.on) { on++; rr.push(d.r / d.rEnv); } rr.sort((a, b) => a - b); console.log('round', round, 'on', on, 'err', err.toFixed(3), 'ratio p10/50/90', [0.1, 0.5, 0.9].map((q) => rr[Math.floor(q * rr.length)]).map((x) => x && x.toFixed(2)).join('/'), 'beta0', aims[0].beta.toFixed(2)); }
      const f = fit(); if (f.q <= 1.0001 && !f.dropped) break;
      prog(0.1 + 0.1 * round / 8, 'fit envelope');
    }
    err = balance(true); for (let k = 0; k < 4; k++) { const f = fit(); if (!f.dropped) break; err = balance(true); }

    // ---- prediction (exact geometry) + Fournier compensation of the virtual target
    const fake = { source: src, envelope: env, target: input.target, modeA: { paint } };
    const Fg = new Float64Array(R * R), ledCache = new Map();
    let blobs = null, cols = [];
    const acc = new Float64Array(R * R), seen = new Uint8Array(R * R), touched = [];
    const put = (k, w) => { if (!seen[k]) { seen[k] = 1; touched.push(k); } acc[k] += w; };
    function predict() {
      Fg.fill(0); cols = aims.map(() => null); if (S.debug) blobs = aims.map(() => new Float64Array(6));
      const byJ = aims.map(() => []); for (const d of dirs) if (d.on && d.j >= 0) byJ[d.j].push(d);
      aims.forEach((z, j) => {
        const cellsJ = byJ[j]; if (!cellsJ.length) return;
        const st = Math.max(1, Math.floor(cellsJ.length / S.apCells));
        let Pc = [0, 0, 0], W = 0; for (const d of cellsJ) { Pc = V.add(Pc, V.mul(V.add(Lp, V.mul(d.u, d.r)), d.flux)); W += d.flux; } Pc = V.mul(Pc, 1 / W); z.W = W;
        // the LED lattice is chosen so that neighbouring samples land at most `imgSpacing` cells apart on the target (per axis)
        const mag = V.dist(Pc, z.Z) / Math.max(1e-6, V.dist(Pc, Lp)) / cell, cap = S.maxLedSide, sp = S.imgSpacing;
        const nU = src.kind === 'planar' && src.shape !== 'disc' ? clamp(Math.ceil(src.w * mag / sp), 1, cap) : clamp(Math.ceil(ledSz * mag / sp), 1, cap), nV = src.kind === 'planar' && src.shape !== 'disc' ? clamp(Math.ceil(src.h * mag / sp), 1, cap) : nU;
        const key = j + ':' + nU + 'x' + nV + ':' + Pc.map((x) => x.toFixed(1)).join(','); let leds = ledCache.get(key); if (!leds) { leds = ledSamples(src, Pc, nU, nV); ledCache.set(key, leds); }
        for (let i = 0; i < cellsJ.length; i += st) {
          let fl = 0; for (let k = i; k < Math.min(cellsJ.length, i + st); k++) fl += cellsJ[k].flux;
          const d = cellsJ[i], p = V.add(Lp, V.mul(d.u, d.r)), n = V.norm(V.add(V.norm(V.sub(Lp, p)), V.norm(V.sub(z.F, p))));   // ellipsoid normal = bisector of its foci
          for (const s of leds) {
            const din = V.norm(V.sub(p, s.x)), dr = V.sub(din, V.mul(n, 2 * V.dot(din, n))), den = V.dot(dr, T.n); if (Math.abs(den) < 1e-12) continue;
            const t = V.dot(V.sub(T.C, p), T.n) / den; if (!(t > 0)) continue;
            const X = V.sub(V.add(p, V.mul(dr, t)), T.C), gx = V.dot(X, T.tu) / cell + R / 2 - 0.5, gy = V.dot(X, T.tv) / cell + R / 2 - 0.5;
            const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, w = fl * s.w * refl;
            if (blobs) { const B = blobs[j]; B[0] += w; B[1] += w * gx; B[2] += w * gy; B[3] += w * gx * gx; B[4] += w * gy * gy; B[5] += w * gx * gy; }
            if (ix >= 0 && iy >= 0 && ix < R && iy < R) put(iy * R + ix, w * (1 - fx) * (1 - fy));
            if (ix + 1 < R && iy >= 0 && ix + 1 >= 0 && iy < R) put(iy * R + ix + 1, w * fx * (1 - fy));
            if (ix >= 0 && iy + 1 < R && ix < R && iy + 1 >= 0) put((iy + 1) * R + ix, w * (1 - fx) * fy);
            if (ix + 1 < R && iy + 1 < R && ix + 1 >= 0 && iy + 1 >= 0) put((iy + 1) * R + ix + 1, w * fx * fy);
          }
        }
        // this patch's light per cell, per unit of its own flux (columns of the blur matrix the compensation solves against)
        const nt = touched.length, ci = new Int32Array(nt), cv = new Float64Array(nt);
        for (let q = 0; q < nt; q++) { const k = touched[q]; ci[q] = k; cv[q] = acc[k] / W; Fg[k] += acc[k]; acc[k] = 0; seen[k] = 0; }
        touched.length = 0; cols[j] = { idx: ci, val: cv };
      });
      return RF.Photometry.fidelity(fake, { res: R, power: 1 }, { gridD: Fg, gridR: new Float64Array(R * R), E: { emitted: 1 }, N: 1e12, next: 1e12 });
    }
    // ---- compensation by non-negative least squares: the predicted field is a sum of per-patch blobs, F = Σ_j g_j B_j
    // (B_j = patch j's light per cell per unit flux, from predict).  Choose the patch fluxes g ≥ 0 that make F match the paint
    // in RELATIVE terms (a dim cell counts as much as a bright one, as in the score) while keeping the gaps near the paint dark;
    // multiplicative updates (Lee–Seung) converge monotonically.  Returns the new shares.
    let gwNow = S.gapWeight;
    const isGap = new Uint8Array(R * R); { const rg = 3; for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { const k = y * R + x; if (paint[k] > 0) continue; let near = false; for (let dy = -rg; dy <= rg && !near; dy++) for (let dx = -rg; dx <= rg; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < R && yy < R && paint[yy * R + xx] > 0) { near = true; break; } } if (near) isGap[k] = 1; } }
    const gapCells = []; for (let k = 0; k < R * R; k++) if (isGap[k]) gapCells.push(k);
    function nnlsShares(iters) {
      const J = aims.length; let num = 0, den = 0;
      for (const k of pcells) { num += Fg[k] / paint[k]; den += 1; } const sc = num / den;         // relative-error least-squares scale of paint to field
      let typ = 0; for (const k of pcells) typ += sc * paint[k]; typ /= pcells.length;
      const a = new Float64Array(R * R), t = new Float64Array(R * R);
      for (const k of pcells) { t[k] = sc * paint[k]; a[k] = 1 / (0.25 * t[k]) ** 2; }
      for (const k of gapCells) a[k] = gwNow * (pcells.length / Math.max(1, gapCells.length)) / (0.15 * typ) ** 2;   // the score averages painted cells and gap cells separately: give each group the same total say
      const g = aims.map((z) => (cols[aims.indexOf(z)] ? z.W : 0)), F = new Float64Array(R * R), nu = new Float64Array(J), de = new Float64Array(J);
      for (let it = 0; it < iters; it++) {
        F.fill(0); for (let j = 0; j < J; j++) { const c = cols[j]; if (!c || !(g[j] > 0)) continue; for (let q = 0; q < c.idx.length; q++) F[c.idx[q]] += c.val[q] * g[j]; }
        for (let j = 0; j < J; j++) { const c = cols[j]; if (!c) continue; let n2 = 0, d2 = 0; for (let q = 0; q < c.idx.length; q++) { const k = c.idx[q], w = a[k] * c.val[q]; if (w === 0) continue; n2 += w * t[k]; d2 += w * F[k]; } nu[j] = n2; de[j] = d2; }
        for (let j = 0; j < J; j++) if (cols[j] && de[j] > 0) g[j] *= nu[j] / de[j];
      }
      let gt = 0; for (let j = 0; j < J; j++) gt += g[j];
      return g.map((v) => v / gt);
    }
    // ---- reflector size: the LED's image on the target is (LED size) × (patch→target ÷ patch→LED), so a SMALLER reflector paints
    // bigger images.  Sharp edges want small images, a wash wants big ones, and the fit that fills the envelope is
    // not the best choice for either.  Try a few sizes (warm re-balance + a couple of compensation passes each, since
    // compensation moves the optimum) and keep the best predicted score.
    const snap = () => ({ st: aims.map((z) => ({ u: z.u, v: z.v, beta: z.beta, target: z.target })), on: dirs.map((d) => d.on), size: sizeNow, open: openNow });
    const load = (o) => { aims.forEach((z, j) => { Object.assign(z, o.st[j]); setFocus(z); }); dirs.forEach((d, i) => { d.on = o.on[i]; }); sizeNow = o.size; openNow = o.open; assign(); };
    const onPaintOf = () => { let t = 0; for (const k of pcells) t += Fg[k]; return t / src.power; };
    let fd = predict();
    function compPass() {                                       // one compensation pass: new shares from the predicted field, re-balance, predict
      const nn = nnlsShares(S.nnlsIters);
      keepSizes(() => {
        aims.forEach((z, j) => { if (cols[j]) z.target = Math.pow(z.target, 1 - S.gain) * Math.pow(clamp(nn[j], 0.2 * z.target, 5 * z.target), S.gain); });
        const tt = aims.reduce((s, z) => s + z.target, 0); for (const z of aims) z.target /= tt;
      });
      err = balance(true); for (let k = 0; k < 3; k++) { const f = fit(); if (!f.dropped) break; err = balance(true); }
      fd = predict();
    }
    function compensate(passes, label) {                        // from the current state; ends in the best state seen
      let bestC = { fd, o: snap() };
      for (let pass = 0; pass < passes; pass++) {
        prog(0.25 + 0.65 * pass / Math.max(1, passes), label + ' ' + (pass + 1) + '/' + passes + ' · predicted ' + Math.round(100 * bestC.fd.fidelity) + '%');
        compPass(); if (fd && fd.fidelity > bestC.fd.fidelity) bestC = { fd, o: snap() };
      }
      load(bestC.o); fd = predict(); return bestC;
    }
    let passesLeft = S.compensate;
    const settleAt = (open, size, base) => {                     // move the current design to another opening / size: re-scale, re-balance, re-fit
      openNow = open; sizeNow = size; for (const d of dirs) d.on = d.ang >= openNow;
      keepSizes(() => {}, Math.log(size / base.size));
      err = balance(true); for (let k = 0; k < 4; k++) { const f = fit(); if (f.q <= 1.0001 && !f.dropped) break; err = balance(true); }
      fd = predict();
    };
    const score = (c) => c.fd.fidelity + S.lightWeight * onPaintOf();
    if (openList.length > 1 || sizeList.length > 1) {
      // Two design choices the paint decides.  (1) The reflector size: the LED's image on the target is (LED size) × (patch→target ÷
      // patch→LED), so a SMALLER reflector paints bigger images; sharp edges want small images, a wash wants big ones.  (2) The front
      // opening: directions within this angle of the beam get no mirror (their light is given up), which keeps the reflector's far
      // rim, and its small images, out of the design.  Each candidate: re-balance and a compensation pass or two (compensation moves
      // the optimum), keep the best predicted score (fidelity + lightWeight × light on paint).  Sizes first, then openings (at the chosen size).
      const sp = Math.min(S.searchPasses, S.compensate), report = [];
      const pick = (cands, label, mk) => {
        const base = snap(); let best = null;
        for (const c of cands) {
          prog(0.2 + 0.05 * report.length / 8, label + ' ' + c);
          load(base); if (mk(c) !== false) settleAt.apply(null, mk(c).concat([base]));
          const r = compensate(sp, label + ' ' + c + ' · compensate'), v = score(r); report.push(label + ' ' + c + ': ' + (100 * r.fd.fidelity).toFixed(0) + '% / ' + (100 * onPaintOf()).toFixed(0) + '%');
          if (!best || v > best.v) best = { v, o: snap(), c };
        }
        load(best.o); fd = predict(); return best.c;
      };
      const o0 = openNow, z0 = sizeNow;
      const sizePick = sizeList.length > 1 ? pick(sizeList, 'size', (z) => z === sizeNow ? false : [openNow, z]) : z0;
      const openPick = openList.length > 1 ? pick(openList, 'opening', (o) => o === openNow ? false : [o, sizeNow]) : o0;
      passesLeft = Math.max(0, S.compensate - sp);
      notes.push('design search (score = predicted fidelity / light on paint): ' + report.join(' · ') + ' → opening ' + openPick + '°, size ' + sizePick);
    }
    if (S.gapWeight > 0 && passesLeft > 0) {
      // how much to care about the gaps while fitting the paint depends on the paint: thin strokes cannot be lit without lighting
      // their surroundings, a wash or a blob can.  Run the remaining passes both ways from the same state; keep the better predicted.
      const base0 = snap(); let bestG = null; const res = [];
      for (const gw of [S.gapWeight, 0]) {
        load(base0); gwNow = gw; const c = compensate(passesLeft, 'compensate (gaps ' + gw + ')'), v = c.fd.fidelity + S.lightWeight * onPaintOf(); res.push(gw + ': ' + (100 * c.fd.fidelity).toFixed(0) + '%');
        if (!bestG || v > bestG.v) bestG = { v, gw, o: snap() };
      }
      gwNow = bestG.gw; load(bestG.o); fd = predict(); notes.push('gap weight in the compensation (' + res.join(' · ') + ') → ' + gwNow);
    } else compensate(passesLeft, 'compensate');

    // ---- emit: one facet per patch = the exact ellipsoid (foci LED and z_j), clipped to the hull of its directions
    prog(0.92, 'emit + verify');
    const surfaces = [], intent = [], sceneV = { source: src, envelope: env, target: input.target, modeA: { budget: N0 } };
    const byJ = aims.map(() => []); for (const d of dirs) if (d.on && d.j >= 0) byJ[d.j].push(d);
    const cornerDir = (q, a) => { const ca = 1 - 2 * a / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = q / NP * 2 * Math.PI; return V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa)); };
    aims.forEach((z, j) => {
      const cs = byJ[j]; if (cs.length < 2) return;
      let u = [0, 0, 0], W = 0; for (const d of cs) { u = V.add(u, V.mul(d.u, d.flux)); W += d.flux; } u = V.norm(u);
      const P = V.add(Lp, V.mul(u, rOf(z, u))), di = V.dist(P, z.F), n = V.norm(V.add(V.norm(V.sub(Lp, P)), V.norm(V.sub(z.F, P))));
      // hull of the patch's direction corners, intersected with ITS ellipsoid (same surface, so neighbours meet)
      const pts = [], [x, y] = V.basis(n);
      for (const d of cs) for (const [dq, da] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const w = cornerDir(d.q + dq, d.a + da); pts.push(V.add(Lp, V.mul(w, rOf(z, w)))); }
      const p2 = pts.map((p) => [V.dot(V.sub(p, P), x), V.dot(V.sub(p, P), y)]), idx = p2.map((_, i) => i).sort((a, b) => p2[a][0] - p2[b][0] || p2[a][1] - p2[b][1]);
      const cr = (o, a, b) => (p2[a][0] - p2[o][0]) * (p2[b][1] - p2[o][1]) - (p2[a][1] - p2[o][1]) * (p2[b][0] - p2[o][0]), lo = [], hi = [];
      for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
      for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
      const hull = lo.slice(0, -1).concat(hi.slice(0, -1)).map((i) => pts[i]); if (hull.length < 3) return;
      const id = 'Q' + j;
      surfaces.push({ type: 'facet', id, P, S0: Lp.slice(), Z: z.F, flat: false, di, clip: { kind: 'poly', pts3: hull }, optics: { interaction: 'reflect', reflectivity: refl } });
      const cells = []; for (let k = 0; k < R * R; k++) if (owner[k] === j) cells.push([k, 1]);
      intent.push({ facet: id, cells });
    });
    let v = RF.Solvers.verify(sceneV, { surfaces }), bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
    if (globalThis.SQMDBG) console.log('verify: patches poking out of the envelope/keep-out', bad.size, 'of', surfaces.length);
    for (let pass = 0; pass < 4 && bad.size; pass++) {            // a hull corner can poke out: shrink that patch a little
      for (const s of surfaces) if (bad.has(s.id)) s.clip.pts3 = s.clip.pts3.map((p) => V.add(s.P, V.mul(V.sub(p, s.P), 0.9)));
      v = RF.Solvers.verify(sceneV, { surfaces }); bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
      if (globalThis.SQMDBG) console.log('  after shrink pass', pass, ':', bad.size);
    }
    const out = surfaces.filter((s) => !bad.has(s.id)); if (bad.size) notes.push('dropped ' + bad.size + ' patch(es) that would not fit');
    const ids = new Set(out.map((s) => s.id));
    let covered = 0; for (const d of dirs) if (d.on) covered += d.flux;
    let onP = 0; for (const k of pcells) onP += Fg[k];
    notes.push(out.length + ' patches of one continuous surface; they catch ' + Math.round(100 * covered / src.power) + '% of the LED\'s light (front opening ' + openNow + '°); flux balance within ' + Math.round(100 * err) + '%');
    if (fd) notes.push('predicted fidelity ' + (100 * fd.fidelity).toFixed(1) + '% (the model\'s own field, scored by the app)');
    let truth;
    if (S.debug) {                                                  // dev: per-patch flux on a lattice 4× finer each way, hard partition, vs the targets
      const f = 4, NA2 = NA * f, NP2 = NP * f, dOm2 = 4 * Math.PI / (NA2 * NP2), fl = new Float64Array(aims.length); let tt = 0;
      for (let q = 0; q < NP2; q++) for (let a = 0; a < NA2; a++) {
        const ca = 1 - 2 * (a + 0.5) / NA2, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = (q + 0.5) / NP2 * 2 * Math.PI;
        if (Math.acos(ca) * 180 / Math.PI < openNow) continue;
        const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
        const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
        let bj = -1, br = Infinity; for (let j = 0; j < aims.length; j++) { const r = rOf(aims[j], u); if (r > 0 && r < br) { br = r; bj = j; } }
        const iv = RF.Geo.envInterval(env, Lp, u), rEnv = iv && iv[1] > Math.max(0, iv[0]) ? iv[1] - S.margin : -1;
        if (bj < 0 || br > rEnv || br < rmin) continue;
        const w = src.power * I / Itot * dOm2; fl[bj] += w; tt += w;
      }
      const es = aims.map((z, j) => Math.abs(fl[j] - z.target * tt) / (z.target * tt)).sort((x, y) => x - y);
      truth = { max: es[es.length - 1], p50: es[es.length >> 1], p90: es[Math.floor(es.length * 0.9)], rms: Math.sqrt(es.reduce((x, y) => x + y * y, 0) / es.length) };
    }
    prog(1, 'done');
    return { surfaces: out, intent: intent.filter((it) => ids.has(it.facet)), notes, pred: { fid: fd ? fd.fidelity : 0, onPaint: onP / src.power }, debug: S.debug ? { F: Array.from(Fg), R, truth, blobEnergy: blobs.map((B) => B[0]), blobs: blobs.map((B, j) => { const w = B[0] || 1, mx = B[1] / w, my = B[2] / w, sxx = B[3] / w - mx * mx, syy = B[4] / w - my * my, sxy = B[5] / w - mx * my; return { j, u: aims[j].u, v: aims[j].v, share: aims[j].target, cx: mx, cy: my, sx: Math.sqrt(Math.max(0, sxx)), sy: Math.sqrt(Math.max(0, syy)), rho: sxy / Math.sqrt(Math.max(1e-12, sxx * syy)) }; }) } : undefined };
  }

  // Quality tiers: which openings and reflector sizes the design search tries, and how hard the compensation works.
  const QUALITY = {
    fast: { opens: [60, 75], sizes: [1, 0.6, 0.36], compensate: 4, apCells: 24, imgSpacing: 1, cellsPerFacet: 40 },
    normal: { opens: [55, 65, 75, 90], sizes: [1, 0.8, 0.6, 0.45, 0.33], compensate: 6, apCells: 40, imgSpacing: 0.8, cellsPerFacet: 60 },
    best: { opens: [50, 60, 70, 80, 90], sizes: [1, 0.85, 0.7, 0.55, 0.45, 0.36, 0.28], compensate: 8, apCells: 64, imgSpacing: 0.6, cellsPerFacet: 80 },
  };
  function solve(input, S0, tools) {
    const Q = QUALITY[S0.quality] || QUALITY.fast, S = Object.assign({}, S0);
    for (const k of Object.keys(Q)) if (S[k] === -1 || S[k] === undefined) S[k] = Q[k];
    return solveOnce(input, S, tools);
  }

  RF.Solvers.register({
    id: 'sqm', name: 'Supporting quadrics (continuous)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'quality', label: 'Quality', type: 'select', default: 'fast', options: [{ value: 'fast', label: 'fast (a few seconds)' }, { value: 'normal', label: 'normal (tries more shapes)' }, { value: 'best', label: 'best (slow)' }] },
      { key: 'lightWeight', label: 'Light on paint, vs fidelity', type: 'number', min: 0, max: 3, step: 0.05, default: 0.25 },
      { key: 'open', adv: true, label: 'Front opening, degrees from the beam (−1 = try several)', type: 'number', min: -1, max: 150, step: 5, default: -1 },
      { key: 'size', adv: true, label: 'Reflector size, fraction of the envelope (−1 = try several)', type: 'number', min: -1, max: 1, step: 0.05, default: -1 },
      { key: 'compensate', adv: true, label: 'Blur-compensation passes (−1 = by quality)', type: 'number', min: -1, max: 30, step: 1, default: -1 },
      { key: 'searchPasses', adv: true, label: 'Compensation passes spent on each shape tried', type: 'number', min: 0, max: 10, step: 1, default: 2 },
      { key: 'gain', adv: true, label: 'Compensation step (0 none … 1 full)', type: 'number', min: 0, max: 1, step: 0.05, default: 0.7 },
      { key: 'gapWeight', adv: true, label: 'How much the compensation cares about lit gaps', type: 'number', min: 0, max: 10, step: 0.05, default: 0.5 },
      { key: 'aimBias', adv: true, label: 'Aims follow the light (1) or the painted area (0)', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3 },
      { key: 'fitShare', adv: true, label: 'Share of the light the reflector must fit the envelope for', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.9 },
      { key: 'tol', adv: true, label: 'Flux-balance tolerance', type: 'number', min: 0.001, max: 0.5, step: 0.005, default: 0.03 },
      { key: 'finalTau', adv: true, label: 'Flux-balance sharpness (smaller = sharper, slower)', type: 'number', min: 0.000005, max: 0.01, step: 0.000005, default: 0.00003 },
      { key: 'nnlsIters', adv: true, label: 'Least-squares iterations per compensation pass', type: 'number', min: 1, max: 1000, step: 1, default: 80 },
      { key: 'lloyd', adv: true, label: 'Aim clustering iterations', type: 'number', min: 0, max: 50, step: 1, default: 12 },
      { key: 'startR', adv: true, label: 'Starting focal length (mm)', type: 'number', min: 1, max: 500, step: 1, default: 20 },
      { key: 'margin', adv: true, label: 'Wall margin (mm)', type: 'number', min: 0, max: 5, step: 0.05, default: 0.3 },
      { key: 'cellsPerFacet', adv: true, label: 'Direction samples per patch (−1 = by quality)', type: 'number', min: -1, max: 400, step: 10, default: -1 },
      { key: 'apCells', adv: true, label: 'Prediction: aperture samples per patch (−1 = by quality)', type: 'number', min: -1, max: 400, step: 4, default: -1 },
      { key: 'imgSpacing', adv: true, label: 'Prediction: LED-image sample spacing, target cells (−1 = by quality)', type: 'number', min: -1, max: 4, step: 0.05, default: -1 },
      { key: 'maxLedSide', adv: true, label: 'Prediction: most LED samples per side', type: 'number', min: 1, max: 40, step: 1, default: 16 },
    ],
    solve,
  });
})();
