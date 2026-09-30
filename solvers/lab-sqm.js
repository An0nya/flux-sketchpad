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

  function ledSamples(src, P, n) {                       // points on / in the source that shine toward P, weighted
    const fr = RF.Source.frame(src), out = [], p = src.pos;
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const g = (i) => (i + 0.5) / n - 0.5;
    if (src.kind === 'point') return [{ x: p.slice(), w: 1 }];
    if (src.kind === 'planar') {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (src.shape === 'disc') { const x = g(i) * 2, y = g(j) * 2; if (x * x + y * y > 1) continue; out.push({ x: at(x * src.radius, y * src.radius, 0), w: 1 }); }
        else out.push({ x: at(g(i) * src.w, g(j) * src.h, 0), w: 1 });
      }
    } else if (src.shape === 'cylinder') {
      const d = V.norm(V.sub(P, p)), surf = src.emission === 'surface';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a = (i + 0.5) / n * 2 * Math.PI, h = g(j) * src.length, nr = V.add(V.mul(fr.u, Math.cos(a)), V.mul(fr.v, Math.sin(a)));
        if (surf) { const c = V.dot(nr, d); if (c <= 0) continue; out.push({ x: V.add(at(0, 0, h), V.mul(nr, src.radius)), w: c }); }
        else { const rr = src.radius * Math.sqrt((j * 7 % n + 0.5) / n); out.push({ x: V.add(at(0, 0, h), V.mul(nr, rr)), w: 1 }); }
      }
    } else {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = g(i) * 2, y = g(j) * 2; if (x * x + y * y > 1) continue; out.push({ x: V.add(p, V.add(V.mul(fr.u, x * src.radius), V.mul(fr.v, y * src.radius))), w: 1 }); }
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
    const dirs = [];
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = (q + 0.5) / NP * 2 * Math.PI;
      if (Math.acos(ca) * 180 / Math.PI < S.open) continue;                       // the front opening (toward the target) stays open
      const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
      const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
      const iv = RF.Geo.envInterval(env, Lp, u), rEnv = iv && iv[1] > Math.max(0, iv[0]) ? iv[1] - S.margin : -1;
      if (rEnv < rmin) continue;
      dirs.push({ u, q, a, flux: src.power * I / Itot * dOm, rEnv, on: true });
    }
    if (!dirs.length) return { surfaces: [], intent: [], notes: ['no direction from the LED can hold a mirror inside the envelope'], pred: { fid: 0, onPaint: 0 } };

    // ---- aims: weighted k-means of the paint into N regions (deterministic seeding: spread along a space-filling order)
    prog(0.05, 'aims');
    const ord = pcells.slice().sort((x, y) => { const hx = hil(x), hy = hil(y); return hx - hy || x - y; });
    function hil(k) { let x = k % R, y = (k / R) | 0, d = 0; for (let s = 1 << 10; s > 0; s >>= 1) { const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; } } return d; }
    let aims = []; { let acc = 0, next = psum / N / 2; for (const k of ord) { acc += paint[k]; if (acc >= next && aims.length < N) { const [u, v] = uvOf(k); aims.push({ u, v, w: 0 }); next += psum / N; } } }
    const owner = new Int32Array(R * R).fill(-1);
    for (let it = 0; it < S.lloyd; it++) {
      const su = new Float64Array(aims.length), sv = new Float64Array(aims.length), sw = new Float64Array(aims.length);
      for (const k of pcells) { const [u, v] = uvOf(k); let bj = 0, bd = Infinity; for (let j = 0; j < aims.length; j++) { const d = (u - aims[j].u) ** 2 + (v - aims[j].v) ** 2; if (d < bd) { bd = d; bj = j; } } owner[k] = bj; su[bj] += u * paint[k]; sv[bj] += v * paint[k]; sw[bj] += paint[k]; }
      for (let j = 0; j < aims.length; j++) if (sw[j] > 0) { aims[j].u = su[j] / sw[j]; aims[j].v = sv[j] / sw[j]; aims[j].w = sw[j] / psum; }
    }
    aims = aims.filter((z) => z.w > 0);
    // each ellipsoid's second focus: the aim itself (sharp), or past it along the same line (defocus m: a patch then
    // spreads its light over ~m × its own outline around the aim, so neighbouring images blend; the surface stays one
    // continuous envelope of ellipsoids either way)
    const setFocus = (z) => { z.Z = world(z.u, z.v); z.F = V.add(Lp, V.mul(V.sub(z.Z, Lp), 1 / (1 - (z.m || 0)))); z.d = V.sub(z.F, Lp); z.c = V.len(z.d); z.ah = V.mul(z.d, 1 / z.c); };
    for (const z of aims) { setFocus(z); z.target = z.w; }

    // ---- supporting ellipsoids: r_j(u) = β(β+2c) / (2β + 2c(1 − u·â_j)); nearest wins
    const rOf = (z, u) => { const b = z.beta; return b * (b + 2 * z.c) / (2 * b + 2 * z.c * (1 - V.dot(u, z.ah))); };
    let totalFlux = 0; for (const d of dirs) totalFlux += d.flux;
    for (const z of aims) z.beta = 2 * S.startR;                                   // ≈ a paraboloid with f = startR
    // Who wins a direction: the smallest r_j = β_j(β_j+2c_j)/(2β_j+2c_j(1−u·â_j)).  β differences of a few percent
    // decide it, so each direction keeps a SHORTLIST of the aims nearest to it in angle (refreshed as β spreads) and
    // the balance takes small multiplicative steps that shrink when the error starts oscillating.
    const K = Math.min(aims.length, Math.max(1, S.shortlist)), ALL = Int32Array.from(aims.map((_, j) => j));
    function shortlist() {
      let lo = Infinity, hi = -Infinity; for (const z of aims) { lo = Math.min(lo, z.beta); hi = Math.max(hi, z.beta); }
      for (const d of dirs) {
        if (!d.on) continue;
        const sc = aims.map((z, j) => [rOf(z, d.u), j]); sc.sort((a, b) => a[0] - b[0]);
        d.cand = Int32Array.from(sc.slice(0, K).map((x) => x[1]));
      }
    }
    function assign() {
      for (const z of aims) { z.flux = 0; z.n = 0; }
      for (const d of dirs) {
        if (!d.on) { d.j = -1; continue; }
        let bj = -1, br = Infinity; const cl = ALL;
        for (let t = 0; t < cl.length; t++) { const j = cl[t], r = rOf(aims[j], d.u); if (r > 0 && r < br) { br = r; bj = j; } }
        d.j = bj; d.r = br; if (bj >= 0) { aims[bj].flux += d.flux; aims[bj].n++; }
      }
    }
    // Balancing = semi-discrete optimal transport.  Winner-take-all makes each patch's flux a step function of the
    // sizes, and simple multiplicative updates thrash (measured: 86 of 100 patches empty after 250 steps).  Entropic
    // regularisation fixes it: each direction is shared softly among patches, p_j ∝ exp(−log r_j / τ), so fluxes are
    // smooth in log β, and the Sinkhorn update log β_j += τ·log(got_j / want_j) converges.  τ is lowered in stages
    // until the soft partition is as sharp as the hard one (the surface itself always uses the hard minimum).
    function balance(iters, warm) {
      let tot = 0; for (const d of dirs) if (d.on) tot += d.flux;
      const J = aims.length, on = dirs.filter((d) => d.on), KK = Math.min(J, S.shortlist > 0 ? S.shortlist : J), lr = new Float64Array(KK), Fs = new Float64Array(J);
      const taus = warm ? [0.001, 0.0004, 0.00015, 0.00006] : [0.03, 0.01, 0.003, 0.001, 0.0004, 0.00015, 0.00006], per = Math.max(5, Math.floor(iters / taus.length));
      const all = new Float64Array(J), idx = new Int32Array(J);
      let gm = 0; for (const z of aims) gm += Math.log(z.beta); gm /= J;       // the overall size is the envelope fit's: keep it
      const bv = new Float64Array(KK), bi = new Int32Array(KK);
      const refresh = () => { for (const d of on) {                          // shortlist: the KK smallest radii now (insertion, no sort)
        let n = 0;
        for (let j = 0; j < J; j++) {
          const r = rOf(aims[j], d.u); if (n === KK && r >= bv[KK - 1]) continue;
          let p = n < KK ? n++ : KK - 1; while (p > 0 && bv[p - 1] > r) { bv[p] = bv[p - 1]; bi[p] = bi[p - 1]; p--; } bv[p] = r; bi[p] = j;
        }
        d.cand = (d.cand && d.cand.length === n) ? d.cand : new Int32Array(n); d.cand.set(bi.subarray(0, n));
      } };
      for (const tau of taus) {
        for (let it = 0; it < per; it++) {
          if (it % 10 === 0) refresh();
          Fs.fill(0);
          for (const d of on) {
            const c = d.cand; let m = Infinity;
            for (let t = 0; t < KK; t++) { lr[t] = Math.log(rOf(aims[c[t]], d.u)); if (lr[t] < m) m = lr[t]; }
            let z = 0; for (let t = 0; t < KK; t++) { lr[t] = Math.exp(-(lr[t] - m) / tau); z += lr[t]; }
            for (let t = 0; t < KK; t++) Fs[c[t]] += d.flux * lr[t] / z;
          }
          let worst = 0;
          for (let j = 0; j < J; j++) { const want = aims[j].target * tot, r = Fs[j] / want; worst = Math.max(worst, Math.abs(r - 1)); aims[j].beta *= Math.exp(clamp(tau * Math.log(Math.max(1e-9, r)), -0.5, 0.5)); }
          let g2 = 0; for (const z of aims) g2 += Math.log(z.beta); g2 /= J; const k = Math.exp(gm - g2); for (const z of aims) z.beta *= k;
          if (worst < S.tol * 0.5) break;
        }
      }
      // keep the overall size where the envelope fit put it (only ratios matter for the partition)
      assign(); let err = 0; for (const z of aims) { const want = z.target * tot; err = Math.max(err, Math.abs(z.flux - want) / Math.max(1e-12, want)); }
      if (globalThis.SQMDBG) { const bs = aims.map((z) => z.beta).sort((a, b) => a - b); console.log('  β min/med/max', bs[0].toFixed(3), bs[bs.length >> 1].toFixed(3), bs[bs.length - 1].toFixed(3), 'targets min/max', Math.min(...aims.map((z) => z.target)).toFixed(4), Math.max(...aims.map((z) => z.target)).toFixed(4)); }
      if (globalThis.SQMDBG) console.log('  balance: hard-partition max rel error', err.toFixed(3), 'empty', aims.filter((z) => z.flux === 0).length);
      return err;
    }
    // Scaling to fit the WORST direction squashes everything (forward directions want huge radii), so scale until
    // `fitShare` of the light fits, and let the directions that still stick out (or fall inside the clearance) go
    // uncovered; rebalance and repeat.
    let err = 0;
    function fit() {
      const rat = []; for (const d of dirs) if (d.on && d.j >= 0) rat.push([d.r / d.rEnv, d.flux]);
      rat.sort((a, b) => a[0] - b[0]); let tot = 0; for (const x of rat) tot += x[1];
      let acc = 0, q = rat.length ? rat[rat.length - 1][0] : 1; for (const x of rat) { acc += x[1]; if (acc >= S.fitShare * tot) { q = x[0]; break; } }
      if (q > 1) for (const z of aims) z.beta /= q * 1.002;
      assign(); let dropped = 0; for (const d of dirs) if (d.on && (d.j < 0 || d.r > d.rEnv || d.r < rmin)) { d.on = false; dropped++; }
      return { q, dropped };
    }
    if (globalThis.SQMDBG) console.log('dirs', dirs.length, 'aims', aims.length, 'rmin', rmin.toFixed(2));
    // per-patch defocus: each patch should cover its own region of the paint, not dot its centre.  Needed spread
    // s_j = region radius − LED image radius; a patch of aperture half-width a_j spreads by a_j·|m| at the target, and
    // m < 0 (focus in front of the target, then fanning out) reaches any size.  m_j = −defocus × s_j / a_j.
    const ledSz = src.kind === 'point' ? 0 : src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.sqrt(src.w * src.h)) : 2 * src.radius;
    function setDefocus() {
      if (!(S.defocus > 0)) { for (const z of aims) { z.m = 0; setFocus(z); } return; }
      const area = new Float64Array(aims.length); for (const k of pcells) if (owner[k] >= 0 && owner[k] < aims.length) area[owner[k]] += cell * cell;
      const rs = new Float64Array(aims.length), om = new Float64Array(aims.length); for (const d of dirs) if (d.on && d.j >= 0) { rs[d.j] += d.r; om[d.j] += 1; }
      aims.forEach((z, j) => {
        if (!om[j]) { z.m = 0; setFocus(z); return; }
        const r = rs[j] / om[j], a = r * Math.sqrt(om[j] * dOm) / 2, img = ledSz * z.c / r / 2, rho = Math.sqrt(area[j] / Math.PI);
        z.m = -clamp(S.defocus * Math.max(0, rho - img) / Math.max(1e-6, a), 0, 60); setFocus(z);
      });
    }
    for (let round = 0; round < 8; round++) {
      err = balance(S.iters, round > 0);
      if (round === 0 && S.defocus > 0) { setDefocus(); err = balance(S.iters, true); }
      if (globalThis.SQMDBG) { let on = 0, rr = []; for (const d of dirs) if (d.on) { on++; rr.push(d.r / d.rEnv); } rr.sort((a, b) => a - b); console.log('round', round, 'on', on, 'err', err.toFixed(3), 'ratio p10/50/90', [0.1, 0.5, 0.9].map((q) => rr[Math.floor(q * rr.length)]).map((x) => x && x.toFixed(2)).join('/'), 'beta0', aims[0].beta.toFixed(2)); }
      const f = fit(); if (f.q <= 1.0001 && !f.dropped) break;
      prog(0.1 + 0.1 * round / 8, 'fit envelope');
    }
    err = balance(S.iters, true); for (let k = 0; k < 4; k++) { const f = fit(); if (!f.dropped) break; err = balance(S.iters, true); }

    // ---- prediction (exact geometry) + Fournier compensation of the virtual target
    const NS = S.ledSamples | 0, fake = { source: src, envelope: env, target: input.target, modeA: { paint } };
    const Fg = new Float64Array(R * R), ledCache = new Map();
    function predict() {
      Fg.fill(0);
      const byJ = aims.map(() => []); for (const d of dirs) if (d.on && d.j >= 0) byJ[d.j].push(d);
      aims.forEach((z, j) => {
        const cellsJ = byJ[j]; if (!cellsJ.length) return;
        const st = Math.max(1, Math.floor(cellsJ.length / S.apCells));
        let Pc = [0, 0, 0], W = 0; for (const d of cellsJ) { Pc = V.add(Pc, V.mul(V.add(Lp, V.mul(d.u, d.r)), d.flux)); W += d.flux; } Pc = V.mul(Pc, 1 / W);
        const key = j + ':' + Pc.map((x) => x.toFixed(1)).join(','); let leds = ledCache.get(key); if (!leds) { leds = ledSamples(src, Pc, NS); ledCache.set(key, leds); }
        for (let i = 0; i < cellsJ.length; i += st) {
          let fl = 0; for (let k = i; k < Math.min(cellsJ.length, i + st); k++) fl += cellsJ[k].flux;
          const d = cellsJ[i], p = V.add(Lp, V.mul(d.u, d.r)), n = V.norm(V.add(V.norm(V.sub(Lp, p)), V.norm(V.sub(z.F, p))));   // ellipsoid normal = bisector of its foci
          for (const s of leds) {
            const din = V.norm(V.sub(p, s.x)), dr = V.sub(din, V.mul(n, 2 * V.dot(din, n))), den = V.dot(dr, T.n); if (Math.abs(den) < 1e-12) continue;
            const t = V.dot(V.sub(T.C, p), T.n) / den; if (!(t > 0)) continue;
            const X = V.sub(V.add(p, V.mul(dr, t)), T.C), gx = V.dot(X, T.tu) / cell + R / 2 - 0.5, gy = V.dot(X, T.tv) / cell + R / 2 - 0.5;
            const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, w = fl * s.w * refl;
            if (ix >= 0 && iy >= 0 && ix < R && iy < R) Fg[iy * R + ix] += w * (1 - fx) * (1 - fy);
            if (ix + 1 < R && iy >= 0 && ix + 1 >= 0 && iy < R) Fg[iy * R + ix + 1] += w * fx * (1 - fy);
            if (ix >= 0 && iy + 1 < R && ix < R && iy + 1 >= 0) Fg[(iy + 1) * R + ix] += w * (1 - fx) * fy;
            if (ix + 1 < R && iy + 1 < R && ix + 1 >= 0 && iy + 1 >= 0) Fg[(iy + 1) * R + ix + 1] += w * fx * fy;
          }
        }
      });
      // the samples are discrete; smooth at their spacing (LED image ÷ samples per side) so the fit doesn't chase
      // sampling speckle (unsmoothed, a wash predicted 18% while the trace measured 41%, same design)
      let rbar = 0, fw = 0; for (const d of dirs) if (d.on) { rbar += d.r * d.flux; fw += d.flux; } rbar /= Math.max(1e-12, fw);
      const ledSize = src.kind === 'point' ? 0 : src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.max(src.w, src.h)) : Math.max(2 * src.radius, src.length || 0);
      const w = Math.max(1, ledSize * V.dist(T.C, Lp) / Math.max(1e-6, rbar) / cell / Math.max(1, NS));
      if (w > 1.05) boxBlur(Fg, R, w);
      return RF.Photometry.fidelity(fake, { res: R, power: 1 }, { gridD: Fg, gridR: new Float64Array(R * R), E: { emitted: 1 }, N: 1e12, next: 1e12 });
    }
    function boxBlur(g, R, w) {                           // in place, separable, energy-conserving inside the grid
      const h = w / 2, tmp = new Float64Array(R * R);
      for (const along of [0, 1]) {
        const src2 = along ? tmp : Float64Array.from(g), dst = along ? g : tmp;
        for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
          const c = along ? j : i, a0 = c + 0.5 - h, b0 = c + 0.5 + h; let sum = 0;
          for (let q = Math.floor(a0); q < Math.ceil(b0); q++) { if (q < 0 || q >= R) continue; sum += (Math.min(b0, q + 1) - Math.max(a0, q)) * (along ? src2[q * R + i] : src2[j * R + q]); }
          dst[j * R + i] = sum / w;
        }
      }
    }
    let fd = predict(), best = { fd, state: aims.map((z) => ({ u: z.u, v: z.v, beta: z.beta, target: z.target, m: z.m })) };
    for (let pass = 0; pass < S.compensate; pass++) {
      prog(0.25 + 0.65 * pass / Math.max(1, S.compensate), 'compensate ' + (pass + 1) + '/' + S.compensate + (best.fd ? ' · predicted ' + Math.round(100 * best.fd.fidelity) + '%' : ''));
      // each aim's region on the target: paint wanted vs light predicted there (at the fitted overall scale)
      let a = 0, b = 0; for (const k of pcells) { a += Fg[k] * paint[k]; b += paint[k] * paint[k]; } const sc = a / Math.max(1e-30, b);
      const want = new Float64Array(aims.length), got = new Float64Array(aims.length), mu = new Float64Array(aims.length), mv = new Float64Array(aims.length), mw = new Float64Array(aims.length);
      for (const k of pcells) { const j = owner[k]; if (j < 0 || j >= aims.length) continue; want[j] += paint[k] * sc; got[j] += Fg[k]; const [u, v] = uvOf(k), def = Math.max(0, paint[k] * sc - Fg[k]); mu[j] += u * def; mv[j] += v * def; mw[j] += def; }
      aims.forEach((z, j) => {
        if (got[j] > 0 && want[j] > 0) z.target *= Math.pow(want[j] / got[j], S.gain);
        if (mw[j] > 0) { z.u += S.nudge * (mu[j] / mw[j] - z.u); z.v += S.nudge * (mv[j] / mw[j] - z.v); setFocus(z); }
      });
      const tt = aims.reduce((s, z) => s + z.target, 0); for (const z of aims) z.target /= tt;
      setDefocus();
      err = balance(S.iters, true); for (let k = 0; k < 3; k++) { const f = fit(); if (!f.dropped) break; err = balance(S.iters, true); }
      fd = predict();
      if (fd && (!best.fd || fd.fidelity > best.fd.fidelity)) best = { fd, state: aims.map((z) => ({ u: z.u, v: z.v, beta: z.beta, target: z.target, m: z.m })) };
    }
    best.state.forEach((s, j) => { const z = aims[j]; Object.assign(z, s); setFocus(z); });
    assign(); fd = predict();

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
    for (let pass = 0; pass < 4 && bad.size; pass++) {            // a hull corner can poke out: shrink that patch a little
      for (const s of surfaces) if (bad.has(s.id)) s.clip.pts3 = s.clip.pts3.map((p) => V.add(s.P, V.mul(V.sub(p, s.P), 0.9)));
      v = RF.Solvers.verify(sceneV, { surfaces }); bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
    }
    const out = surfaces.filter((s) => !bad.has(s.id)); if (bad.size) notes.push('dropped ' + bad.size + ' patch(es) that would not fit');
    const ids = new Set(out.map((s) => s.id));
    let covered = 0; for (const d of dirs) if (d.on) covered += d.flux;
    let onP = 0; for (const k of pcells) onP += Fg[k];
    notes.push(out.length + ' patches of one continuous surface; they catch ' + Math.round(100 * covered / src.power) + '% of the LED\'s light (front opening ' + S.open + '°); flux balance within ' + Math.round(100 * err) + '%');
    if (fd) notes.push('predicted fidelity ' + (100 * fd.fidelity).toFixed(1) + '% (the model\'s own field, scored by the app)');
    prog(1, 'done');
    return { surfaces: out, intent: intent.filter((it) => ids.has(it.facet)), notes, pred: { fid: fd ? fd.fidelity : 0, onPaint: onP / src.power }, debug: S.debug ? { F: Array.from(Fg), R } : undefined };
  }

  const QUALITY = { fast: { compensate: 3, iters: 150, apCells: 24, ledSamples: 5, cellsPerFacet: 40 }, normal: { compensate: 6, iters: 250, apCells: 40, ledSamples: 6, cellsPerFacet: 60 }, best: { compensate: 10, iters: 400, apCells: 64, ledSamples: 7, cellsPerFacet: 100 } };
  function solve(input, S0, tools) {
    const Q = QUALITY[S0.quality] || QUALITY.normal, S = Object.assign({}, S0);
    for (const k of Object.keys(Q)) if (S[k] === -1 || S[k] === undefined) S[k] = Q[k];
    if (S.open >= 0 && S.defocus >= 0) return solveOnce(input, S, tools);
    // front opening: pick by predicted fidelity (+ a little credit for light), like the dish size in dish-fit
    // front opening × defocus: picked by predicted fidelity (+ a little credit for light), quick solves first
    const opts = [];
    for (const o of S.open >= 0 ? [S.open] : [45, 70, 95]) for (const m of S.defocus >= 0 ? [S.defocus] : [0, 0.5, 1]) opts.push({ o, m });
    const res = [], prog = (f, st) => { if (tools && tools.progress) tools.progress(f, st); };
    opts.forEach((c, i) => { const out = solveOnce(input, Object.assign({}, S, { open: c.o, defocus: c.m, compensate: Math.min(2, S.compensate) }), { progress: (f, st) => prog(0.5 * (i + f) / opts.length, 'try ' + (i + 1) + '/' + opts.length + ' · ' + (st || '')) }); res.push(Object.assign({ v: out.pred.fid + S.lightWeight * out.pred.onPaint, pred: out.pred }, c)); });
    res.sort((a, b) => b.v - a.v || a.o - b.o || a.m - b.m);
    const out = solveOnce(input, Object.assign({}, S, { open: res[0].o, defocus: res[0].m }), { progress: (f, st) => prog(0.5 + 0.5 * f, 'final · ' + (st || '')) });
    out.notes.unshift('opening / defocus search (predicted fidelity / light on paint): ' + res.slice(0, 5).map((r) => r.o + '° m' + r.m + ': ' + (100 * r.pred.fid).toFixed(1) + '% / ' + (100 * r.pred.onPaint).toFixed(0) + '%').join(' · ') + ' → ' + res[0].o + '°, m ' + res[0].m);
    return out;
  }

  RF.Solvers.register({
    id: 'sqm', name: 'Supporting quadrics (continuous)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'quality', label: 'Quality', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best' }] },
      { key: 'open', adv: true, label: 'Front opening, degrees from the beam (−1 auto)', type: 'number', min: -1, max: 150, step: 5, default: -1 },
      { key: 'defocus', adv: true, label: 'Spread each patch over its region (0 sharp … 1 full; −1 auto)', type: 'number', min: -1, max: 2, step: 0.05, default: -1 },
      { key: 'lightWeight', adv: true, label: 'Light on paint worth, vs fidelity', type: 'number', min: 0, max: 3, step: 0.05, default: 0.25 },
      { key: 'compensate', adv: true, label: 'Blur-compensation passes (−1 auto)', type: 'number', min: -1, max: 30, step: 1, default: -1 },
      { key: 'gain', adv: true, label: 'Compensation gain (shares)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.7 },
      { key: 'nudge', adv: true, label: 'Compensation gain (aim positions)', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3 },
      { key: 'lloyd', adv: true, label: 'Aim clustering iterations', type: 'number', min: 0, max: 50, step: 1, default: 12 },
      { key: 'iters', adv: true, label: 'Flux-balance iterations (−1 auto)', type: 'number', min: -1, max: 1000, step: 10, default: -1 },
      { key: 'step', adv: true, label: 'Flux-balance step', type: 'number', min: 0.01, max: 2, step: 0.01, default: 0.3 },
      { key: 'shortlist', adv: true, label: 'Candidate patches per direction (0 = all)', type: 'number', min: 0, max: 64, step: 1, default: 16 },
      { key: 'tol', adv: true, label: 'Flux-balance tolerance', type: 'number', min: 0.001, max: 0.5, step: 0.005, default: 0.03 },
      { key: 'fitShare', adv: true, label: 'Share of the light the envelope fit keeps', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.9 },
      { key: 'startR', adv: true, label: 'Starting focal length (mm)', type: 'number', min: 1, max: 500, step: 1, default: 20 },
      { key: 'margin', adv: true, label: 'Wall margin (mm)', type: 'number', min: 0, max: 5, step: 0.05, default: 0.3 },
      { key: 'cellsPerFacet', adv: true, label: 'Direction samples per patch (−1 auto)', type: 'number', min: -1, max: 400, step: 10, default: -1 },
      { key: 'apCells', adv: true, label: 'Aperture samples per patch (−1 auto)', type: 'number', min: -1, max: 400, step: 4, default: -1 },
      { key: 'ledSamples', adv: true, label: 'LED samples per side (−1 auto)', type: 'number', min: -1, max: 16, step: 1, default: -1 },
    ],
    solve,
  });
})();
