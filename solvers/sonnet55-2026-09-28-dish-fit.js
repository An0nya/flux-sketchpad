/* Bundled model solver: Sonnet 5.5, Flux solver benchmark run 2026-09-28 (workspace work-sonnet55-flux-solver-20260928-2145).
 * Copied verbatim from that run's solvers/solver.js (sha256 224bc87b4559…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* Flux solver — "dish + kernel fit".
 *
 * Static algorithm (no ray tracing anywhere in solve()):
 *  1. DISH.  The LED's emission hemisphere is cut into near-square direction cells; each cell becomes one facet, placed
 *     on a paraboloid-like shell r = 2f/(1 − d·T) about the LED (T = LED→target axis).  On that shell every facet's
 *     outgoing beam runs clear of every other facet (their footprints along T never overlap).  Cells that don't fit the
 *     envelope / clearance are dropped.  A cell's captured flux is a closed-form emission integral.
 *  2. KERNEL.  A curved facet focused on the target paints an image of the LED: uniform-brightness, its shape is the LED
 *     mapped through the mirror law (sample points on the LED, applied to the facet's own normal; no scene tracing).
 *  3. ALLOCATE.  Facets get aim points and a fill fraction (= flux) by weighted matching pursuit against a target that
 *     mirrors the scorer (paint blurred by the smallest LED image; dark cells near the paint weigh most), first on a
 *     coarse grid, then refined at half-cell resolution.
 *  4. CHOOSE f.  Several dish sizes are tried; each is scored with the app's own fidelity function applied to the
 *     *predicted* field (an analytic image sum, not a ray trace).
 *  5. EMIT.  Ellipsoid facets (foci: LED and aim point); outlines shrunk until they satisfy envelope and clearance.
 */
(function () {
  'use strict';
  const V = RF.V, TAU = 2 * Math.PI, D2R = Math.PI / 180;
  const dot = V.dot, sub = V.sub, add = V.add, mul = V.mul, cross = V.cross, norm = V.norm, len = V.len;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const dirOf = (fr, th, ph) => { const s = Math.sin(th); return add(mul(fr.a, Math.cos(th)), add(mul(fr.u, s * Math.cos(ph)), mul(fr.v, s * Math.sin(ph)))); };
  function segDist(p, a, b) { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(1e-30, dot(ab, ab)), 0, 1); return len(sub(p, add(a, mul(ab, t)))); }
  // distance from a point to a convex planar polygon (world points, plane normal n)
  function polyDist(p, pts, n) {
    const h = dot(sub(p, pts[0]), n), foot = sub(p, mul(n, h));
    let pos = true, neg = true;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], c = dot(cross(sub(b, a), sub(foot, a)), n); if (c < 0) pos = false; if (c > 0) neg = false; }
    if (pos || neg) return Math.abs(h);
    let d = Infinity; for (let i = 0; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i], pts[(i + 1) % pts.length]));
    return d;
  }

  const STATIC = {
    id: 'dish-fit', name: 'Dish + kernel fit', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'focus', label: 'Dish focal length f (mm; 0 = pick automatically)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'maxAngle', label: 'Max angle from LED axis (deg)', type: 'number', min: 20, max: 89, step: 1, default: 80 },
      { key: 'margin', label: 'Wall / clearance margin (mm)', type: 'number', min: 0.05, step: 0.05, default: 0.4 },
      { key: 'passes', label: 'Coarse refinement passes', type: 'range', min: 0, max: 6, step: 1, default: 1 },
      { key: 'finePasses', label: 'Fine (half-cell) passes', type: 'range', min: 0, max: 8, step: 1, default: 3 },
      { key: 'quarter', label: 'Refine aim to a quarter cell', type: 'checkbox', default: false },
      { key: 'rounds', label: 'Boosting rounds (re-weight the cells the scorer would fail)', type: 'range', min: 0, max: 6, step: 1, default: 2 },
      { key: 'util', label: 'Flux the fit tries to place, × dish flux', type: 'number', min: 0.2, max: 1.5, step: 0.05, default: 1.0 },
      { key: 'gapW', label: 'Weight on dark cells near the paint (0 = pick automatically)', type: 'number', min: 0, step: 0.01, default: 0 },
      { key: 'farW', label: 'Weight on dark cells far from the paint', type: 'number', min: 0, step: 0.01, default: 0.05 },
      { key: 'kappa', label: 'Value of on-paint light vs fidelity when picking f', type: 'number', min: 0, step: 0.05, default: 0.5 },
      { key: 'debug', label: 'Return the predicted field in extras (diagnostics)', type: 'checkbox', default: false },
      { key: 'order', label: 'Placement order', type: 'select', options: ['blurry-first', 'sharp-first', 'flux-first'], default: 'blurry-first' },
    ],
    solve(input, st) {
      const src = input.source, L = src.pos.slice(), env = input.envelope, R = input.limits.reflectivity, N = input.limits.maxFacets;
      const fr = RF.Source.frame(src), T = RF.Engine.targetFrame(input.target), Ax = norm(sub(T.C, L));
      const keep = Math.max(env.keepOut || 0, st.minDistance || 0) + st.margin, notes = [];
      const paint = input.paint.cells, Rp = input.paint.res, cellMm = 2 * T.half / Rp;
      if (!paint.some((w) => w > 0) || N < 1) return { surfaces: [], intent: [], notes: ['empty paint'] };

      // ---------------------------------------------------------------- emission
      const thMaxSrc = RF.Source.thetaMax(src), thCut = Math.min(thMaxSrc, st.maxAngle * D2R), NT = 512, Fc = new Float64Array(NT + 1);
      for (let i = 1; i <= NT; i++) { const t = (i - 0.5) / NT * thMaxSrc; Fc[i] = Fc[i - 1] + RF.Source.intensity(src, t) * Math.sin(t) * thMaxSrc / NT; }
      const Ftot = Fc[NT], Fof = (th) => { const x = clamp(th / thMaxSrc, 0, 1) * NT, i = Math.min(NT - 1, Math.floor(x)); return Fc[i] + (Fc[i + 1] - Fc[i]) * (x - i); };
      const inEnv = (p, m) => RF.Geo.envInside({ shape: env.shape, center: env.center, half: env.half.map((h) => h - m), axis: env.axis }, p, 0);

      // ---------------------------------------------------------------- dish cells
      const dishR = (d, f) => { const c = dot(d, Ax); return c > 0.9995 ? Infinity : 2 * f / (1 - c); };   // r = 2f / (1 − cos α): a paraboloid, LED at the focus
      function cells(f, dth) {
        const out = [], J = Math.max(1, Math.floor((thCut - dth * 0.5) / dth));
        const mk = (th0, th1, ph0, ph1, pole) => {
          const dirs = [];
          if (pole) for (let k = 0; k < 8; k++) dirs.push(dirOf(fr, th1, TAU * k / 8));
          else dirs.push(dirOf(fr, th0, ph0), dirOf(fr, th1, ph0), dirOf(fr, th1, ph1), dirOf(fr, th0, ph1));
          const cd = dirOf(fr, pole ? 0 : (th0 + th1) / 2, pole ? 0 : (ph0 + ph1) / 2), pts = [];
          for (const d of dirs) { const r = dishR(d, f); if (!isFinite(r)) return; const p = add(L, mul(d, r)); if (r < keep || !inEnv(p, st.margin)) return; pts.push(p); }
          const rc = dishR(cd, f); if (!isFinite(rc)) return; const P = add(L, mul(cd, rc)); if (rc < keep || !inEnv(P, st.margin)) return;
          const flux = R * src.power * (pole ? Fof(th1) : (ph1 - ph0) / TAU * (Fof(th1) - Fof(th0))) / Ftot;
          out.push({ P, pts, dir: cd, r: rc, flux, th: (th0 + th1) / 2 });
        };
        mk(0, dth / 2, 0, TAU, true);
        for (let j = 1; j <= J; j++) {
          const th0 = (j - 0.5) * dth, th1 = Math.min((j + 0.5) * dth, thCut + 1e-9), n = Math.max(3, Math.round(TAU * Math.sin(j * dth) / dth)), off = (j % 2) * 0.5;
          if (th0 >= thCut) break;
          for (let k = 0; k < n; k++) mk(th0, th1, (k + off) * TAU / n, (k + 1 + off) * TAU / n, false);
        }
        return out;
      }
      function cellsFor(f) {                       // finest pitch that gives at most N cells, then the pitch nearby that gets closest to N
        let lo = 0.01, hi = 0.8, best = cells(f, hi), pitch = hi;
        for (let it = 0; it < 22; it++) { const mid = Math.sqrt(lo * hi), c = cells(f, mid); if (c.length > N) lo = mid; else { hi = mid; best = c; pitch = mid; } }
        for (let k = -12; k <= 12; k++) { const p = pitch * (1 + 0.012 * k), c = cells(f, p); if (c.length <= N && c.length > best.length) best = c; }
        return best;
      }

      // ---------------------------------------------------------------- LED image (kernel) model
      // dense sample of the emitting area (world offsets from the LED centre); the image of each point is J·q
      const ledPts = [];
      { const sz = RF.Source.extentCov(src);
        if (src.kind === 'planar' && src.shape === 'rect') { const m = 56; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) ledPts.push(add(mul(fr.u, ((i + .5) / m - .5) * src.w), mul(fr.v, ((j + .5) / m - .5) * src.h))); }
        else if (src.kind === 'planar') { const m = 64; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) { const a = ((i + .5) / m - .5) * 2 * src.radius, b = ((j + .5) / m - .5) * 2 * src.radius; if (a * a + b * b <= src.radius * src.radius) ledPts.push(add(mul(fr.u, a), mul(fr.v, b))); } }
        else { const m = 20, e = [Math.sqrt(sz[0] * 3), Math.sqrt(sz[4] * 3), Math.sqrt(sz[8] * 3)]; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) ledPts.push([((i + .5) / m - .5) * 2 * e[0], ((j + .5) / m - .5) * 2 * e[1], ((k + .5) / m - .5) * 2 * e[2]]); }
        if (!ledPts.length) ledPts.push([0, 0, 0]);
      }
      const hitUV = (P, n, q) => { const d = norm(sub(P, add(L, q))), r = V.reflect(d, n), t = dot(sub(T.C, P), T.n) / dot(r, T.n), h = sub(add(P, mul(r, t)), T.C); return [dot(h, T.tu), dot(h, T.tv)]; };
      // mirror-law Jacobian (target mm per LED mm), from central differences along three LED axes, for a facet at P aimed at Z
      const imgJac = (P, Z) => {
        const n = norm(add(norm(sub(L, P)), norm(sub(Z, P)))), eps = Math.max(1e-3, 0.25 * Math.max(RF.Source.boundingRadius(src), 0.2)), J = [[0, 0, 0], [0, 0, 0]];
        for (let a = 0; a < 3; a++) { const q = [0, 0, 0]; q[a] = eps; const p1 = hitUV(P, n, q); q[a] = -eps; const p0 = hitUV(P, n, q); J[0][a] = (p1[0] - p0[0]) / (2 * eps); J[1][a] = (p1[1] - p0[1]) / (2 * eps); }
        return J;
      };
      const imgOffsets = (P, Z) => { const J = imgJac(P, Z); return ledPts.map((q) => [J[0][0] * q[0] + J[0][1] * q[1] + J[0][2] * q[2], J[1][0] * q[0] + J[1][1] * q[1] + J[1][2] * q[2]]); };
      // kernel entries (cell offsets + flux fractions) of an image whose centre sits at (fx, fy) inside its cell: each
      // sample lands in the cell that contains it, so a cell's weight is its share of the image area
      function mkKernel(offs, cell, fx, fy) {
        const m = offs.length, xs = new Float64Array(m), ys = new Float64Array(m); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < m; i++) { const x = Math.floor(fx + offs[i][0] / cell), y = Math.floor(fy + offs[i][1] / cell); xs[i] = x; ys[i] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const W = x1 - x0 + 1, H = y1 - y0 + 1, acc = new Float64Array(W * H);
        for (let i = 0; i < m; i++) acc[(ys[i] - y0) * W + (xs[i] - x0)] += 1 / m;
        const di = [], dj = [], w = []; let ext = 0;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (acc[j * W + i] > 0) { di.push(i + x0); dj.push(j + y0); w.push(acc[j * W + i]); ext = Math.max(ext, Math.abs(i + x0), Math.abs(j + y0)); }
        return { di: Int32Array.from(di), dj: Int32Array.from(dj), w: Float64Array.from(w), ext };
      }

      // ---------------------------------------------------------------- target model (mirrors the scorer)
      const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
      const Bp = RF.Photometry.boxBlur(paint, Rp, ker.cells), rb = Math.ceil(ker.cells) + 2;
      const nearF = new Uint8Array(Rp * Rp);
      { const tmp = new Uint8Array(Rp * Rp);
        for (let j = 0; j < Rp; j++) for (let i = 0; i < Rp; i++) if (paint[j * Rp + i] > 0) for (let a = Math.max(0, i - rb); a <= Math.min(Rp - 1, i + rb); a++) tmp[j * Rp + a] = 1;
        for (let j = 0; j < Rp; j++) for (let i = 0; i < Rp; i++) if (tmp[j * Rp + i]) for (let b = Math.max(0, j - rb); b <= Math.min(Rp - 1, j + rb); b++) nearF[b * Rp + i] = 1; }
      let sumP = 0, nP = 0; for (let k = 0; k < paint.length; k++) if (paint[k] > 0) { sumP += paint[k]; nP++; }
      const typP = sumP / nP;                                                    // typical painted value (paint units)
      // fine targets in units of "a typical painted cell" (paint units / typP) — independent of the flux scale
      const tF = new Float64Array(Rp * Rp);
      for (let k = 0; k < Rp * Rp; k++) if (paint[k] > 0) tF[k] = Math.sqrt(paint[k] * Bp[k]) / typP;
      // coarse grid for the global search
      const g = Math.max(1, Math.ceil(Rp / 56)), Rw = Math.floor(Rp / g), cw = cellMm * g;
      const tC = new Float64Array(Rw * Rw);
      for (let j = 0; j < Rw; j++) for (let i = 0; i < Rw; i++) { let s = 0; for (let b = 0; b < g; b++) for (let a = 0; a < g; a++) s += tF[(j * g + b) * Rp + i * g + a]; tC[j * Rw + i] = s; }
      // error weights ~ 1/(tolerance)^2: painted cells ±25% of their level; dark cells near the paint ±half their allowance
      function weights(gw) {
        const wF = new Float64Array(Rp * Rp), wC = new Float64Array(Rw * Rw);
        for (let k = 0; k < Rp * Rp; k++) {
          if (paint[k] > 0) wF[k] = 1 / (0.25 * Math.max(tF[k], 0.3)) ** 2;
          else if (nearF[k]) { const allow = Math.max(1.25 * Bp[k] / typP, 0.1); wF[k] = gw / (0.5 * allow) ** 2; }
          else wF[k] = st.farW * 16;
        }
        for (let j = 0; j < Rw; j++) for (let i = 0; i < Rw; i++) { let w = 0; for (let b = 0; b < g; b++) for (let a = 0; a < g; a++) w += wF[(j * g + b) * Rp + i * g + a]; wC[j * Rw + i] = w / (g * g) / (g * g); }
        return { wF, wC };
      }
      const sumT = tF.reduce((a, b) => a + b, 0);                                // total target mass, in typical-cell units

      // ---------------------------------------------------------------- one full design for a dish size f
      function design(f, passes, finePasses, gw, rounds) {
        const { wF, wC } = weights(gw);
        let cs = cellsFor(f);
        if (cs.length > N) { cs.sort((a, b) => b.flux - a.flux); cs = cs.slice(0, N); }
        if (!cs.length) return null;
        const dishFlux = cs.reduce((s, c) => s + c.flux, 0), unit = dishFlux * st.util / sumT;    // lm per typical cell of target
        const fac = cs.map((c, idx) => {
          const offs = imgOffsets(c.P, T.C);
          return { c, idx, offs, phi: c.flux / unit, s: 0, ih: 0, jh: 0, kc: mkKernel(offs, cw, 0.5, 0.5), kf: new Array(16).fill(null) };
        });
        for (const F of fac) F.ext = F.kc.ext;
        const Rc = Float64Array.from(tC);
        const search = (F) => {
          let best = { gain: 0, s: 0, ci: -1, cj: -1 };
          const n = F.kc.di.length, di = F.kc.di, dj = F.kc.dj, w = F.kc.w, phi = F.phi, farQ = st.farW * 16 / (g * g) / (g * g);
          const at = (ci, cj) => {
            let d = 0, q = 0;
            for (let e = 0; e < n; e++) {
              const i = ci + di[e], j = cj + dj[e]; if (i < 0 || j < 0 || i >= Rw || j >= Rw) { q += w[e] * w[e] * farQ; continue; }
              const k = j * Rw + i, we = w[e] * wC[k]; d += we * Rc[k]; q += we * w[e];
            }
            if (d <= 0) return;
            const s = clamp(d / (phi * q), 0, 1), gain = 2 * s * phi * d - s * s * phi * phi * q;
            if (gain > best.gain) best = { gain, s, ci, cj };
          };
          for (let cj = 0; cj < Rw; cj += 2) for (let ci = 0; ci < Rw; ci += 2) at(ci, cj);      // coarse lattice, then its neighbours
          if (best.ci >= 0) { const c0 = best.ci, r0 = best.cj; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if ((a || b) && c0 + a >= 0 && r0 + b >= 0 && c0 + a < Rw && r0 + b < Rw) at(c0 + a, r0 + b); }
          return best;
        };
        const applyC = (F, sign) => {
          for (let e = 0; e < F.kc.di.length; e++) { const i = F.ci + F.kc.di[e], j = F.cj + F.kc.dj[e]; if (i < 0 || j < 0 || i >= Rw || j >= Rw) continue; Rc[j * Rw + i] -= sign * F.s * F.phi * F.kc.w[e]; }
        };
        const ord = fac.slice();
        if (st.order === 'blurry-first') ord.sort((a, b) => b.ext - a.ext || a.idx - b.idx);
        else if (st.order === 'sharp-first') ord.sort((a, b) => a.ext - b.ext || a.idx - b.idx);
        else ord.sort((a, b) => b.phi - a.phi || a.idx - b.idx);
        for (let pass = 0; pass <= passes; pass++) for (const F of ord) {
          if (pass > 0 && F.s > 0) applyC(F, -1);
          const b = search(F); F.s = b.s; F.ci = b.ci; F.cj = b.cj; if (F.s > 0) applyC(F, +1);
        }
        // hand over to the fine grid: positions in half cells of the paint grid
        for (const F of fac) if (F.s > 0) { F.ih = Math.round(4 * (F.ci + 0.5) * g); F.jh = Math.round(4 * (F.cj + 0.5) * g); }
        const kfine = (F, ih, jh) => {
          const ph = (ih & 3) + 4 * (jh & 3); if (!F.kf[ph]) F.kf[ph] = mkKernel(F.offs, cellMm, (ih & 3) / 4, (jh & 3) / 4); return F.kf[ph];
        };
        const Rf = Float64Array.from(tF);
        const applyF = (F, sign) => {
          const k = kfine(F, F.ih, F.jh), i0 = F.ih >> 2, j0 = F.jh >> 2;
          for (let e = 0; e < k.di.length; e++) { const i = i0 + k.di[e], j = j0 + k.dj[e]; if (i < 0 || j < 0 || i >= Rp || j >= Rp) continue; Rf[j * Rp + i] -= sign * F.s * F.phi * k.w[e]; }
        };
        for (const F of fac) if (F.s > 0) applyF(F, +1);
        const R2 = 5;                                                            // ± half cells (then ± a quarter cell) searched around the current position
        const wm = new Float64Array(Rp * Rp).fill(1), wE = new Float64Array(Rp * Rp);
        const finePass = (step) => {
          for (let k = 0; k < wE.length; k++) wE[k] = wF[k] * wm[k];
          for (const F of ord) {
            if (!(F.s > 0)) continue;
            applyF(F, -1);
            let best = { gain: -1, s: F.s, ih: F.ih, jh: F.jh };
            const RR = step === 2 ? R2 : 1;
            for (let dj = -RR; dj <= RR; dj++) for (let di = -RR; di <= RR; di++) {
              const ih = F.ih + di * step, jh = F.jh + dj * step; if (ih < 0 || jh < 0 || ih >= 4 * Rp || jh >= 4 * Rp) continue;
              const k = kfine(F, ih, jh), i0 = ih >> 2, j0 = jh >> 2; let d = 0, q = 0;
              for (let e = 0; e < k.di.length; e++) {
                const i = i0 + k.di[e], j = j0 + k.dj[e]; if (i < 0 || j < 0 || i >= Rp || j >= Rp) { q += k.w[e] * k.w[e] * st.farW * 16; continue; }
                const kk = j * Rp + i, we = k.w[e] * wE[kk]; d += we * Rf[kk]; q += we * k.w[e];
              }
              if (!(q > 0)) continue;
              const s = clamp(d / (F.phi * q), 0, 1), gain = 2 * s * F.phi * d - s * s * F.phi * F.phi * q;
              if (gain > best.gain) best = { gain, s, ih, jh };
            }
            F.s = best.s; F.ih = best.ih; F.jh = best.jh; applyF(F, +1);
          }
        };
        const field = () => { const G = new Float64Array(Rp * Rp); for (let k = 0; k < G.length; k++) G[k] = (tF[k] - Rf[k]) * unit; return G; };
        if (finePasses <= 0) return { f, fac, cs, G: field(), unit, dishFlux };
        // fine passes, then boosting rounds: cells the scorer would fail get more weight, cells it passes a little less
        let bestSnap = null, bestVal = -Infinity, bestSc = null;
        for (let round = 0; round <= rounds; round++) {
          for (let pass = 0; pass < (round ? 2 : finePasses); pass++) finePass(2);
          if (st.quarter) finePass(1);
          const G = field(), sc = score({ G }), v = sc.fid + st.kappa * sc.onPaint;
          if (v > bestVal) { bestVal = v; bestSc = sc; bestSnap = { pos: fac.map((F) => [F.ih, F.jh, F.s]), G }; }
          if (round < rounds && sc.fd) { const vd = sc.fd.verdict; for (let k = 0; k < wm.length; k++) { if (vd[k] > 0) wm[k] = Math.min(8, wm[k] * 1.6); else wm[k] = Math.max(0.35, wm[k] * 0.9); } }
        }
        fac.forEach((F, i) => { F.ih = bestSnap.pos[i][0]; F.jh = bestSnap.pos[i][1]; F.s = bestSnap.pos[i][2]; });
        return { f, fac, cs, G: bestSnap.G, unit, dishFlux, sc: bestSc };
      }
      function score(d) {
        const fake = { source: src, envelope: env, target: input.target, modeA: { paint } };
        const fd = RF.Photometry.fidelity(fake, { res: Rp, power: src.power }, { gridD: d.G, gridR: new Float64Array(d.G.length), E: { emitted: src.power }, N: 1e12, next: 1e12 });
        let onP = 0; for (let k = 0; k < paint.length; k++) if (paint[k] > 0) onP += d.G[k];
        return { fid: fd ? fd.fidelity : 0, onPaint: onP / src.power, fd };
      }

      // ---------------------------------------------------------------- choose f and the dark-cell weight
      const val = (d) => d.sc.fid + st.kappa * d.sc.onPaint, GW = st.gapW > 0 ? [st.gapW] : [0.03, 0.1, 0.3];
      let best = null; const table = [];
      const consider = (d) => { if (!d.sc) d.sc = score(d); d.val = val(d); if (!best || d.val > best.val) best = d; return d; };
      let fPick = st.focus;
      if (!(fPick > 0)) {
        // candidate dish sizes: spread over the range where the dish still has a useful share of the LED's flux
        const flux = (ff) => cells(ff, 0.12).reduce((s, c) => s + c.flux, 0);
        const fl = []; for (let k = 0; k < 28; k++) { const ff = keep * Math.pow(1.12, k); fl.push([ff, flux(ff)]); }
        const fmax = Math.max(...fl.map((x) => x[1])), cand = [];
        for (const frac of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) { let pick = null; for (const x of fl) if (x[1] >= frac * fmax) pick = x[0]; if (pick && !cand.some((c) => Math.abs(c - pick) < 0.01)) cand.push(pick); }
        for (const ff of cand) { const d = design(ff, 0, 0, GW[Math.floor(GW.length / 2)], 0); if (!d) continue; consider(d); table.push([ff, d.sc.fid, d.sc.onPaint]); }
        if (best) fPick = best.f;
        if (table.length) notes.push('f candidates (f: predicted fidelity / on paint): ' + table.map((t) => t[0].toFixed(1) + ': ' + t[1].toFixed(2) + '/' + t[2].toFixed(2)).join(' · '));
      }
      if (fPick > 0) { best = null; for (const gw of GW) { const d = design(fPick, st.passes, st.finePasses, gw, st.rounds); if (d) { d.gw = gw; consider(d); table.push(['gw', gw, d.sc.fid, d.sc.onPaint]); } } }
      if (!best) return { surfaces: [], intent: [], notes: ['no dish fits the envelope'] };
      const fac = best.fac;

      // ---------------------------------------------------------------- emit
      const surfaces = [], intent = [];
      let used = 0;
      for (const F of fac) {
        if (!(F.s > 0.02)) continue;
        const u = -T.half + (F.ih / 4) * cellMm, v = -T.half + (F.jh / 4) * cellMm;
        const Z = add(T.C, add(mul(T.tu, u), mul(T.tv, v))), P = F.c.P;
        const nrm = norm(add(norm(sub(L, P)), norm(sub(Z, P))));
        let scale = Math.sqrt(F.s), pts3 = null;
        for (let tries = 0; tries < 14; tries++) {                             // shrink the outline about the centre until it fits
          const q = F.c.pts.map((p) => { const d = sub(p, P); const dp = sub(d, mul(nrm, dot(d, nrm))); return add(P, mul(dp, scale)); });
          if (q.every((p) => inEnv(p, st.margin * 0.5)) && polyDist(L, q, nrm) >= keep - st.margin * 0.5) { pts3 = q; break; }
          scale *= 0.9;
        }
        if (!pts3) continue;
        const id = 'F' + surfaces.length;
        surfaces.push({ type: 'facet', id, group: 'A', P, S0: L, Z, flat: false, di: len(sub(Z, P)), clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: R, twoSided: false } });
        const k = F.kf[(F.ih & 3) + 4 * (F.jh & 3)] || mkKernel(F.offs, cellMm, (F.ih & 3) / 4, (F.jh & 3) / 4), i0 = F.ih >> 2, j0 = F.jh >> 2, ce = [];
        for (let e = 0; e < k.di.length; e++) { const i = i0 + k.di[e], j = j0 + k.dj[e]; if (i >= 0 && j >= 0 && i < Rp && j < Rp) ce.push([j * Rp + i, k.w[e]]); }
        intent.push({ facet: id, cells: ce }); used++;
      }
      notes.push('gapW ' + best.gw + ' · f=' + best.f.toFixed(1) + ' mm · ' + used + ' facets of ' + fac.length + ' dish cells · dish flux ' + (best.dishFlux / src.power * 100).toFixed(1) + '% of LED · predicted fidelity ' + best.sc.fid.toFixed(3) + ', on paint ' + (best.sc.onPaint * 100).toFixed(1) + '% · kernel floor ' + ker.cells.toFixed(1) + ' cells');
      return { surfaces, intent, notes, extras: st.debug ? { G: Array.from(best.G), gw: best.gw, f: best.f, predFid: best.sc.fid, predOnPaint: best.sc.onPaint, table, fd: best.sc.fd } : { f: best.f, gw: best.gw, predFid: best.sc.fid, predOnPaint: best.sc.onPaint } };
    },
  };
  RF.Solvers.register(STATIC);

  // ------------------------------------------------------------------ the tuner
  // Same algorithm; the free settings (dish size, dark-cell weight, flux target) are chosen with real traces (same seed for
  // every candidate, so differences are geometry, not dice).  Coordinate search around the static solver's own pick.
  RF.Solvers.register({
    id: 'dish-fit-auto', name: 'Dish + kernel fit, trace-tuned', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
      { key: 'rays', label: 'Rays per trial trace', type: 'number', min: 50000, max: 2000000, step: 50000, default: 400000 },
      { key: 'trials', label: 'Max trial designs (one trace each)', type: 'range', min: 1, max: 30, step: 1, default: 18 },
    ],
    async solve(input, st, tools) {
      const base = RF.Solvers.defaults(STATIC); base.minDistance = st.minDistance; base.debug = false;
      const cap = isFinite(tools.budget.rays) ? Math.floor(tools.budget.rays / st.rays) : Infinity, maxT = Math.max(1, Math.min(Math.max(3, Math.round(st.trials * 100 / Math.max(50, input.limits.maxFacets))), st.trials, cap));   // trial count scales down with the facet cap (run time)
      const trials = [], seen = new Set();
      let baseFid = 0;
      const objective = (r) => {
        if (st.goal === 'faithful') return r.fid + 0.5 * r.onPaint;
        const floor = (st.goal === 'efficient' ? 0.96 : 0.9) * baseFid, gate = Math.min(0, r.fid - Math.max(0.7, floor));
        return (st.goal === 'efficient' ? r.onPaint : r.peak / (trials[0] ? Math.max(1, trials[0].peak) : 1)) + 10 * gate;
      };
      const evaluate = (over) => {
        const key = JSON.stringify(over); if (seen.has(key) || trials.length >= maxT) return null; seen.add(key);
        const out = STATIC.solve(input, Object.assign({}, base, over)); if (!out.surfaces.length) return null;
        let tr; try { tr = tools.trace(out.surfaces, { rays: st.rays, seed: input.seed }); } catch (e) { return null; }
        const r = { out, over, fid: tr.fidelity ? tr.fidelity.fidelity : 0, onPaint: tr.fidelity ? tr.fidelity.onPaint : 0, peak: tr.peakCd || 0, f: out.extras.f, gw: out.extras.gw };
        if (!trials.length) baseFid = r.fid;
        trials.push(r); tools.progress(trials.length / maxT); return r;
      };
      const first = evaluate({}); if (!first) return STATIC.solve(input, Object.assign({}, base));
      let inc = first, incO = objective(first), cur = { focus: first.f, gapW: first.gw, util: 1, order: 'blurry-first', finePasses: 3 };
      const moves = st.goal === 'faithful'
        ? [['focus', (c) => [c.focus * 0.87, c.focus * 1.15]], ['gapW', (c) => [c.gapW * 0.4, c.gapW * 2.5]], ['util', () => [0.92, 1.1]], ['order', () => ['sharp-first', 'flux-first']], ['finePasses', () => [5]]]
        : [['util', () => [1.15, 1.3]], ['focus', (c) => [c.focus * 0.87, c.focus * 1.15]], ['gapW', (c) => [c.gapW * 0.4, c.gapW * 2.5]], ['util', () => [0.92, 1.5]]];
      for (let sweep = 0; sweep < 2 && trials.length < maxT; sweep++) for (const [key, vals] of moves) {
        let bestHere = null;
        for (const v of vals(cur)) { const over = Object.assign({}, cur, { [key]: v }), r = evaluate(over); if (r) { const o = objective(r); if (o > incO + 0.002 && (!bestHere || o > bestHere.o)) bestHere = { r, o, over }; } }
        if (bestHere) { inc = bestHere.r; incO = bestHere.o; cur = bestHere.over; }
      }
      const out = inc.out; out.notes = (out.notes || []).concat(['tuner (' + st.goal + '): ' + trials.length + ' traces of ' + st.rays + ' rays; first ' + (100 * first.fid).toFixed(1) + '% → chosen ' + (100 * inc.fid).toFixed(1) + '% fidelity, on paint ' + (100 * inc.onPaint).toFixed(1) + '%; settings ' + JSON.stringify(cur)]);
      return out;
    },
  });
})();
})();
