/* tir-array-v2.js — TIR collimator array v2 (matrix / ADB-style), experimental.  v1 (tir-array-v1.js) stays as is.
 *
 * Changes vs v1:
 *  1. Exact central collimation: the cavity dome is ONE exact hyperbolic conic zone (rev seg.kind 'conic', k = −n²,
 *     R = (n−1)·hc), not a 20-ring polyline.
 *  2. Curved exit lenslets: every exit cell is a `quad` (toric: separate curvature along the target's u and v) whose
 *     normal aims it (vector Snell) and whose curvatures set its fan = (its paint region's extent − the predicted LED
 *     image there).  Predicted image (kernel) per cell = LED size / distance LED → collimating point (dome or TIR
 *     wall), flux-weighted.  Blur-aware aims: each aim is pulled inside the paint by half its kernel (painted column /
 *     row range), so the image edge, not its centre, sits on the paint edge.
 *  3. Structure (setting): 'single' = one body per emitter; 'partitioned' = an air-gapped collimating core lens (own
 *     material coreIor, own exit lenslets, thin: exit just above its dome) inside a TIR ring (bore carried up to the
 *     exit, polar exit lenslets); 'auto' traces both and keeps the better (reported in the notes).
 *  4. Traced calibration: rounds of tools.trace (with needs.bounces) that reweight the paint by (paint / got)^0.3, steer
 *     the blur awareness (lit gaps → ×1.2, else ×0.88) and
 *     re-cut the per-unit slices and per-cell regions, keeping the best round (paint fidelity, or spec fails, then
 *     unsure, in Spec mode).  Time governor: no new round after 50 s.
 * Kept from v1: one unit per emitter, tilt ≤ maxTilt toward its slice, aperture fit to pitch / envelope / each other,
 * parts only (0 reflecting facets), deterministic (traces use input.seed), unique ids.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const D2R = Math.PI / 180;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => mul(a, 1 / (len(a) || 1));
  const perp = (w) => norm(cross(w, Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
  const nowMs = () => Date.now();

  // ---- the TIR collimator profile in (r, z), LED at the origin, axis +z (port of lenses.js 'tir')
  function profile(n, rc, hc, A, thMaxDeg) {
    const K = hc * (1 - n);
    const dome = (r) => (-n * K + Math.sqrt(K * K + (n * n - 1) * r * r)) / (n * n - 1);
    const zTopCav = dome(rc), th1 = Math.atan2(rc, zTopCav), thMax = Math.min(89, thMaxDeg) * D2R;
    const Wp = (th) => [rc, rc / Math.tan(th)];
    const dg = (th) => { const cz = Math.cos(th) / n; return [Math.sqrt(1 - cz * cz), cz]; };
    const Nout = (th) => { const g = dg(th); const v = [g[0], g[1] - 1]; const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
    const steps = 400;
    function integrate(L0) {
      const pts = []; let L = L0;
      const f = (th, Lv) => {
        const e = 1e-6, W1 = Wp(th + e), W0 = Wp(th - e), g1 = dg(th + e), g0 = dg(th - e), N = Nout(th), g = dg(th);
        const Wd = [(W1[0] - W0[0]) / (2 * e), (W1[1] - W0[1]) / (2 * e)], gd = [(g1[0] - g0[0]) / (2 * e), (g1[1] - g0[1]) / (2 * e)];
        return -((Wd[0] + Lv * gd[0]) * N[0] + (Wd[1] + Lv * gd[1]) * N[1]) / (g[0] * N[0] + g[1] * N[1]);
      };
      const h = (th1 - thMax) / steps; let th = thMax;
      for (let i = 0; i <= steps; i++) {
        const W = Wp(th), g = dg(th);
        pts.push([W[0] + L * g[0], W[1] + L * g[1], th]);
        if (i === steps) break;
        const k1 = f(th, L), k2 = f(th + h / 2, L + h * k1 / 2), k3 = f(th + h / 2, L + h * k2 / 2), k4 = f(th + h, L + h * k3);
        L += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; th += h;
      }
      return pts;
    }
    const rA = integrate(0.5 * rc), rB = integrate(1.5 * rc);
    const ra = rA[rA.length - 1][0], rb = rB[rB.length - 1][0];
    const L0 = 0.5 * rc + (A - ra) * (rc / Math.max(1e-12, rb - ra));
    const outer = integrate(Math.max(0.05 * rc, L0));
    const zLast = outer[outer.length - 1][1];
    const zTop = Math.max(zLast, ...outer.map((q) => q[1]), zTopCav + 0.5) + 0.5;   // +0.5: room for the prism cells
    const rTop = outer[outer.length - 1][0];
    return { dome, zTopCav, th1, thMax, outer, zTop, rTop, zb: Wp(thMax)[1], zLast };
  }

  // exit-face flux map: Lambertian point source, θ → exit radius (dome: where the ray meets the dome; TIR: the profile)
  function exitSamples(pf, n) {
    const out = [], NT = 600, NP = 48;
    const domeR = (th) => { let lo = 0, hi = pf.outer.length ? 1e3 : 1; hi = 50; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Math.atan2(m, pf.dome(m)) < th) lo = m; else hi = m; } return lo; };
    const outerR = (th) => { const o = pf.outer; for (let i = 0; i + 1 < o.length; i++) { const a = o[i], b = o[i + 1]; if ((th - a[2]) * (th - b[2]) <= 0) { const t = (th - a[2]) / ((b[2] - a[2]) || 1); return a[0] + t * (b[0] - a[0]); } } return o[o.length - 1][0]; };
    const outerL = (th) => { const o = pf.outer; for (let i = 0; i + 1 < o.length; i++) { const a = o[i], b = o[i + 1]; if ((th - a[2]) * (th - b[2]) <= 0) return Math.hypot(a[0], a[1]); } return Math.hypot(o[0][0], o[0][1]); };
    for (let i = 0; i < NT; i++) {
      const th = (i + 0.5) / NT * pf.thMax, w = Math.sin(th) * Math.cos(th);
      const r = th < pf.th1 ? domeR(th) : outerR(th);
      const L = th < pf.th1 ? Math.hypot(r, pf.dome(r)) : outerL(th);
      for (let j = 0; j < NP; j++) { const ph = (j + 0.5) / NP * 2 * Math.PI; out.push([r * Math.cos(ph), r * Math.sin(ph), w, L]); }
    }
    return out;
  }

  function clipPoly(poly, clipper) {                 // Sutherland–Hodgman, convex clipper (CCW)
    let out = poly;
    for (let i = 0; i < clipper.length && out.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length], inp = out; out = [];
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
    }
    return out;
  }
  const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

  // recursive bisection: assign each exit cell (flux f) the weighted centre of an equal-flux region of paint points
  function bisect(cells, pts, outAim) {
    if (!cells.length) return;
    const W = pts.reduce((s, p) => s + p.w, 0);
    if (cells.length === 1 || pts.length <= 1) {
      let u = 0, v = 0; for (const p of pts) { u += p.u * p.w; v += p.v * p.w; }
      const c = W > 0 ? [u / W, v / W] : (pts[0] ? [pts[0].u, pts[0].v] : [0, 0]);
      for (const cl of cells) outAim.set(cl, { uv: c, pts });
      return;
    }
    // split cells spatially (along their longer extent) so neighbouring cells take neighbouring regions
    const ex = (k) => Math.max(...cells.map((c) => c.xy[k])) - Math.min(...cells.map((c) => c.xy[k]));
    const ck = ex(0) >= ex(1) ? 0 : 1;
    const cs = cells.slice().sort((a, b) => a.xy[ck] - b.xy[ck] || a.idx - b.idx);
    const half = cs.length >> 1, c1 = cs.slice(0, half), c2 = cs.slice(half);
    const F1 = c1.reduce((s, c) => s + c.f, 0), F2 = c2.reduce((s, c) => s + c.f, 0), frac = F1 / Math.max(1e-30, F1 + F2);
    const pu = Math.max(...pts.map((p) => p.u)) - Math.min(...pts.map((p) => p.u)), pv = Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v));
    const pk = pu >= pv ? 'u' : 'v';
    const ps = pts.slice().sort((a, b) => a[pk] - b[pk] || a.i - b.i);
    let acc = 0, cut = 0; const target = frac * W;
    for (; cut < ps.length; cut++) { if (acc + ps[cut].w / 2 > target) break; acc += ps[cut].w; }
    cut = Math.max(1, Math.min(ps.length - 1, cut));
    // cells sorted along x pair with paint sorted along u (or v): keep orientation consistent (exit-face x ↔ target u)
    bisect(c1, ps.slice(0, cut), outAim); bisect(c2, ps.slice(cut), outAim);
  }

  // dome of a collimating hyperbolic conic (point at the origin, vertex at z = hc, glass n above): conic zone parameters
  const domeConic = (n, hc) => ({ zv: hc, R: (n - 1) * hc, k: -n * n });
  const domeZ = (n, hc, r) => hc + RF.Geo.conicSag((n - 1) * hc, -n * n, r);

  // square cells over a disc of radius R (clip to the circle)
  function squareCells(R, cs, keepInside) {
    const circ = []; for (let m = 0; m < 48; m++) circ.push([R * Math.cos(m * Math.PI / 24), R * Math.sin(m * Math.PI / 24)]);
    const N = Math.ceil(R / cs), out = [];
    for (let a = -N; a < N; a++) for (let b = -N; b < N; b++) {
      const sq = [[a * cs, b * cs], [(a + 1) * cs, b * cs], [(a + 1) * cs, (b + 1) * cs], [a * cs, (b + 1) * cs]];
      const pg = clipPoly(sq, circ), ar = pg.length >= 3 ? polyArea(pg) : 0;
      if (ar < 0.02 * cs * cs) continue;
      out.push({ poly: pg, key: 's' + a + ',' + b, find: null, a, b });
    }
    const lookup = new Map(out.map((c) => [c.a + ',' + c.b, c]));
    return { cells: out, at: (x, y) => (Math.hypot(x, y) <= R && (!keepInside || keepInside(x, y)) ? lookup.get(Math.floor(x / cs) + ',' + Math.floor(y / cs)) : null) };
  }
  // polar cells over the annulus r0..r1 (inner chord kept outside r0)
  function polarCells(r0, r1, cs) {
    const out = [], bands = Math.max(1, Math.round((r1 - r0) / cs)), dr = (r1 - r0) / bands, idx = [];
    for (let k = 0; k < bands; k++) {
      const ra = r0 + k * dr, rb = ra + dr, ns = Math.max(6, Math.round(2 * Math.PI * (ra + rb) / 2 / cs)), dp = 2 * Math.PI / ns, row = [];
      for (let s = 0; s < ns; s++) {
        const p0 = s * dp, p1 = p0 + dp, pg = [], M = 3;
        pg.push([ra * Math.cos(p0), ra * Math.sin(p0)]);
        for (let m = 0; m <= M; m++) { const p = p0 + dp * m / M; pg.push([rb * Math.cos(p), rb * Math.sin(p)]); }
        pg.push([ra * Math.cos(p1), ra * Math.sin(p1)]);
        const c = { poly: pg, a: k, b: s }; out.push(c); row.push(c);
      }
      idx.push({ ns, row });
    }
    return { cells: out, at: (x, y) => { const r = Math.hypot(x, y); if (r < r0 || r > r1) return null; const k = Math.min(bands - 1, Math.floor((r - r0) / dr)); let p = Math.atan2(y, x); if (p < 0) p += 2 * Math.PI; const B = idx[k]; return B.row[Math.min(B.ns - 1, Math.floor(p / (2 * Math.PI / B.ns)))]; } };
  }

  RF.Solvers.register({
    id: 'tir-array-v2', name: 'TIR collimator array v2 (experimental)', version: '0.2',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused: no reflecting facets' },
      { key: 'structure', label: 'Body structure', type: 'select', options: [{ value: 'auto', label: 'auto (trace both, keep the better)' }, { value: 'single', label: 'single body per emitter' }, { value: 'partitioned', label: 'partitioned: core lens + TIR ring (air gap)' }], default: 'auto' },
      { key: 'aperture', label: 'Max collimator radius A (mm)', type: 'number', min: 6, max: 60, step: 1, default: 18 },
      { key: 'ior', label: 'Glass index (TIR body / ring)', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.49 },
      { key: 'coreIor', label: 'Core lens index (partitioned)', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.59 },
      { key: 'cell', label: 'Exit lenslet size (mm)', type: 'number', min: 0.8, max: 10, step: 0.1, default: 2.2 },
      { key: 'coreCell', label: 'Core lenslet size (mm, partitioned)', type: 'number', min: 0.8, max: 10, step: 0.1, default: 1.6 },
      { key: 'maxTilt', label: 'Max body tilt (°)', type: 'number', min: 0, max: 30, step: 1, default: 12 },
      { key: 'blur', label: 'Blur awareness (× predicted LED image)', type: 'number', min: 0, max: 2, step: 0.05, default: 1 },
      { key: 'split', label: 'Flux share', type: 'select', options: [{ value: 'slices', label: 'slices (one region per unit)' }, { value: 'shared', label: 'shared (every unit: whole paint)' }], default: 'slices' },
      { key: 'calib', label: 'Traced calibration rounds', type: 'range', min: 0, max: 6, step: 1, default: 3 },
      { key: 'calibRays', label: 'Rays per calibration trace', type: 'number', min: 50000, max: 2000000, step: 50000, default: 300000 },
    ],
    solve(input, settings, tools) {
      const t0 = nowMs(), n = settings.ior, nC = settings.coreIor, env = input.envelope, keep = env.keepOut || 0;
      const srcs = (input.sources && input.sources.length ? input.sources : [input.source]);
      const notes = [], spec = !!input.spec, canTrace = tools && typeof tools.trace === 'function';
      // display only (SOLVER_API.md § "Watching a solve"): what was just built and traced; never changes the result
      const show = (b, structure, label, tr) => { if (tools && tools.preview) tools.preview(b.surfaces, { label, trace: tr || undefined, needs: { bounces: bounces(structure) } }); };
      // ---- paint → target points (u = right, v = up)
      const T = RF.Engine.targetFrame(Object.assign({}, input.target, { res: input.paint.res }));
      const res = input.paint.res, paint = input.paint.cells, cellMm = input.target.size / res, pts0 = [];
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const w = paint[j * res + i]; if (!(w > 0)) continue;
        const uv = RF.Engine.cellCenter(T, i, j); pts0.push({ i: j * res + i, ci: i, cj: j, u: uv[0], v: uv[1], w });
      }
      if (!pts0.length) return { surfaces: [], intent: [], notes: ['empty paint: nothing to aim at'] };
      const world = (u, v) => add(T.C, add(mul(T.tu, u), mul(T.tv, v)));
      // painted range per row / column (blur-aware clamps)
      const rowR = new Map(), colR = new Map();
      for (const p of pts0) {
        const r = rowR.get(p.cj) || [Infinity, -Infinity]; r[0] = Math.min(r[0], p.u); r[1] = Math.max(r[1], p.u); rowR.set(p.cj, r);
        const c = colR.get(p.ci) || [Infinity, -Infinity]; c[0] = Math.min(c[0], p.v); c[1] = Math.max(c[1], p.v); colR.set(p.ci, c);
      }
      const cellOf = (u, v) => { let best = null, bd = Infinity; for (const p of pts0) { const d = (p.u - u) ** 2 + (p.v - v) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
      // ---- units (left → right along u)
      const units = srcs.map((s, k) => ({ k, src: s, pos: s.pos.slice(), u0: dot(s.pos, T.tu), P: s.power || 1, s0: s.kind === 'planar' ? (s.shape === 'disc' ? 2 * s.radius : Math.min(s.w, s.h)) : 2 * (s.radius || 1) }))
        .sort((a, b) => a.u0 - b.u0 || a.k - b.k);
      const Ptot = units.reduce((s, x) => s + x.P, 0);
      function slice(pts) {
        if (settings.split === 'shared' || units.length === 1) { for (const un of units) un.pts = pts; return; }
        const ps = pts.slice().sort((a, b) => a.u - b.u || a.v - b.v), W = ps.reduce((s, p) => s + p.w, 0);
        let c = 0, acc = 0;
        for (let q = 0; q < units.length; q++) {
          const goal = W * units.slice(0, q + 1).reduce((s, x) => s + x.P, 0) / Ptot, part = [];
          while (c < ps.length && (q === units.length - 1 || acc + ps[c].w / 2 <= goal)) { acc += ps[c].w; part.push(ps[c++]); }
          units[q].pts = part.length ? part : [ps[Math.min(c, ps.length - 1)]];
        }
      }
      // ---- aim (fixed from the uncalibrated paint so the geometry fit is stable across rounds)
      slice(pts0);
      for (const un of units) {
        let u = 0, v = 0, w = 0; for (const p of un.pts) { u += p.u * p.w; v += p.v * p.w; w += p.w; }
        const want = norm(sub(world(u / w, v / w), un.pos)), ax = norm(un.src.axis || [1, 0, 0]);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(want, ax)))), lim = settings.maxTilt * D2R;
        un.W = ang <= lim ? want : norm(add(mul(ax, Math.cos(lim)), mul(norm(sub(want, mul(ax, dot(want, ax)))), Math.sin(lim))));
        un.tilt = Math.min(ang, lim) / D2R;
      }
      // ---- fit (as v1): aperture per unit vs pitch, envelope, each other
      const rc = Math.max(4, keep + 0.6), hc = Math.max(5, keep + 0.8), gap = 0.15, rcore = rc - gap;
      let pitch = Infinity;
      for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) pitch = Math.min(pitch, len(sub(units[a].pos, units[b].pos)));
      for (const un of units) un.A = Math.max(rc + 1.5, Math.min(settings.aperture, isFinite(pitch) ? pitch / 2 - 0.6 : Infinity));
      const frame = (un) => { const ex = perp(un.W), ey = cross(un.W, ex); return { ex, ey }; };
      const toW = (un, r, z, ph) => { const f = frame(un); return add(un.pos, add(add(mul(f.ex, r * Math.cos(ph)), mul(f.ey, r * Math.sin(ph))), mul(un.W, z))); };
      const prof = (A) => { const pf = profile(n, rc, hc, A, 88); pf.zTop += 0.6; return pf; };       // +0.6: room for tilted / curved lenslets
      // the host checks every surface's real outline, so test what it tests: the rim AND the cavity base / dome rings
      // (a tilted body dips its base through a floor the LED sits just above), 64 azimuths (16 left the circle bulging
      // ~0.35 mm out between samples at an 18 mm rim), against the envelope shrunk by a 0.05 mm margin
      const envIn = Object.assign({}, env, { half: env.half.map((h) => Math.max(0, h - 0.05)) });
      const fits = (un) => {
        const pf = un.pf, pr = [[pf.rTop, pf.zTop + 0.6], [pf.outer[0][0], pf.outer[0][1]], [pf.rTop, pf.zLast], [rc, 0], [rc, hc], [rc * 0.5, hc]];
        for (let q = 0; q < pf.outer.length; q += 8) pr.push([pf.outer[q][0], pf.outer[q][1]]);
        for (const [r, z] of pr) for (let m = 0; m < 64; m++) if (!RF.Geo.envInside(envIn, toW(un, r, z, m * Math.PI / 32), 0)) return false;
        return true;
      };
      for (const un of units) {
        const A0 = un.A, ax = norm(un.src.axis || [1, 0, 0]), W0 = un.W;
        for (let t = 0; t <= 6; t++) {                     // shrink first; if even the smallest body pokes out, tilt less and retry
          if (t) { const f = 1 - t / 6; un.W = norm(add(mul(ax, 1 - f), mul(W0, f))); un.tilt = Math.acos(Math.max(-1, Math.min(1, dot(un.W, ax)))) / D2R; un.A = A0; }
          let ok = false;
          for (let it = 0; it < 40; it++) { un.pf = prof(un.A); if ((ok = fits(un)) || un.A <= rc + 1.5) break; un.A *= 0.93; }
          if (ok) break;
        }
      }
      const segDist = (a, b) => { let m = Infinity; for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) m = Math.min(m, len(sub(add(a.pos, mul(a.W, (a.pf.zTop + 0.6) * i / 12)), add(b.pos, mul(b.W, (b.pf.zTop + 0.6) * j / 12))))); return m; };
      for (let it = 0; it < 40; it++) {
        let bad = false;
        for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
          const A = units[a], B = units[b];
          if (segDist(A, B) < A.pf.rTop + B.pf.rTop + 0.4) { bad = true; for (const U of [A, B]) if (U.A > rc + 1.5) { U.A *= 0.95; U.pf = prof(U.A); } }
        }
        if (!bad) break;
      }
      // ---- per-unit exit cells (geometry + predicted flux + predicted LED-image kernel) for a structure
      function cellsFor(un, structure) {
        const pf = un.pf, R = pf.rTop * 0.9995, list = [];
        const samples = exitSamples(pf, n);
        if (structure === 'partitioned') {
          const zCore = domeZ(nC, hc, rcore) + 1.2;
          const core = squareCells(rcore * 0.999, Math.min(settings.coreCell, rcore / 1.2)), ring = polarCells(rc, R, Math.min(settings.cell, (R - rc) / 1.5));
          for (const c of core.cells) { c.z = zCore; c.part = 'c'; c.nG = nC; list.push(c); }
          for (const c of ring.cells) { c.z = pf.zTop; c.part = 'r'; c.nG = n; list.push(c); }
          for (const c of list) { c.f = 0; c.kw = 0; }
          for (const s of samples) { const r = Math.hypot(s[0], s[1]); const c = r < rcore ? core.at(s[0], s[1]) : (r >= rc ? ring.at(s[0], s[1]) : null); if (c) { c.f += s[2]; c.kw += s[2] * un.s0 / s[3]; } }
          un.zCore = zCore;
        } else {
          const sq = squareCells(R, Math.min(settings.cell, pf.rTop / 1.5));
          for (const c of sq.cells) { c.z = pf.zTop; c.part = 's'; c.nG = n; c.f = 0; c.kw = 0; list.push(c); }
          for (const s of samples) { const c = sq.at(s[0], s[1]); if (c) { c.f += s[2]; c.kw += s[2] * un.s0 / s[3]; } }
        }
        list.forEach((c, i) => {
          c.idx = i; c.kern = c.f > 0 ? c.kw / c.f : 0;
          let cx = 0, cy = 0; for (const p of c.poly) { cx += p[0]; cy += p[1]; } c.lc = [cx / c.poly.length, cy / c.poly.length];
        });
        const Fs = list.reduce((s, c) => s + c.f, 0); for (const c of list) c.f /= Fs || 1;
        return list;
      }
      // ---- build every unit for a paint weighting and a structure
      const glass = (ior) => ({ interaction: 'refract', reflectivity: 0.9, ior, fresnelT: 0.96, twoSided: false });
      const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };
      const cellCache = new Map();
      function build(weights, structure, blur) {
        const pts = pts0.map((p) => Object.assign({}, p, { w: p.w * weights[p.i] }));
        slice(pts);
        const surfaces = [], intent = [], stat = { cells: 0, fanMax: 0, kernMean: 0, kn: 0 };
        units.forEach((un, ui) => {
          const pf = un.pf, gid = 'T' + ui, f = frame(un); let kk = 0;
          const rev = (seg, front, optics) => surfaces.push({ type: 'rev', id: gid + '_' + (kk++), group: 'L' + ui, O: un.pos.slice(), W: un.W.slice(), ref: f.ex, seg, front, optics });
          const line = (r0, z0, r1, z1, front, optics) => rev({ kind: 'line', r0: Math.max(0, r0), z0, r1: Math.max(0, r1), z1 }, front, optics);
          const G = glass(n), part = structure === 'partitioned';
          const key = ui + structure; if (!cellCache.has(key)) cellCache.set(key, cellsFor(un, structure));
          // 1. exact conic dome
          const dc = domeConic(part ? nC : n, hc);
          rev({ kind: 'conic', zv: dc.zv, R: dc.R, k: dc.k, r0: 0, r1: part ? rcore : rc }, 1, glass(part ? nC : n));
          if (part) {
            line(rcore, domeZ(nC, hc, rcore), rcore, un.zCore, -1, glass(nC));            // core lens side wall (air gap outside)
            line(rc, pf.zb, rc, pf.zTop, 1, G);                                             // ring bore: cavity wall carried up to the exit
          } else line(rc, pf.zb, rc, pf.zTopCav, 1, G);
          const o = pf.outer, M = 48;
          for (let i = 0; i < M; i++) { const a = o[Math.round(i * (o.length - 1) / M)], b = o[Math.round((i + 1) * (o.length - 1) / M)]; line(a[0], a[1], b[0], b[1], -1, G); }
          if (pf.zTop > pf.zLast + 1e-9) line(pf.rTop, pf.zLast, pf.rTop, pf.zTop, -1, G);
          line(rc, pf.zb, o[0][0], o[0][1], -1, ABSORB);
          // 2. exit lenslets
          const cells = cellCache.get(key).map((c) => Object.assign({}, c));
          const ux = dot(f.ex, T.tu), uy = dot(f.ey, T.tu);
          for (const c of cells) { const x = c.lc[0], y = c.lc[1]; c.xy = [x * ux + y * uy, -x * uy + y * ux]; }
          const lit = cells.filter((c) => c.f > 0), aims = new Map(); bisect(lit, un.pts, aims);
          for (const c of cells) {
            const A = aims.get(c), local = c.poly, lc = c.lc;
            const P0 = add(un.pos, add(add(mul(f.ex, lc[0]), mul(f.ey, lc[1])), mul(un.W, c.z)));
            let dOut = un.W, cu = 0, cv = 0;
            const D = len(sub(T.C, P0));
            if (A) {
              const k = D * c.kern * blur;                                         // predicted LED image on the target (mm, full width)
              let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
              for (const p of A.pts) { u0 = Math.min(u0, p.u); u1 = Math.max(u1, p.u); v0 = Math.min(v0, p.v); v1 = Math.max(v1, p.v); }
              let au = A.uv[0], av = A.uv[1];
              // blur-aware: keep half the image inside the painted column / row range
              const q = cellOf(au, av), col = colR.get(q.ci), lo = col[0] - cellMm / 2 + k / 2, hi = col[1] + cellMm / 2 - k / 2;
              av = lo <= hi ? Math.min(hi, Math.max(lo, av)) : (col[0] + col[1]) / 2;
              const q2 = cellOf(au, av), row = rowR.get(q2.cj), lo2 = row[0] - cellMm / 2 + k / 2, hi2 = row[1] + cellMm / 2 - k / 2;
              au = lo2 <= hi2 ? Math.min(hi2, Math.max(lo2, au)) : (row[0] + row[1]) / 2;
              dOut = norm(sub(world(au, av), P0));
              cu = Math.max(0, (u1 - u0 + cellMm) - k) / D; cv = Math.max(0, (v1 - v0 + cellMm) - k) / D;   // wanted fan (rad) beyond the image
              stat.kernMean += k / cellMm; stat.kn++;
            }
            const ng = c.nG;
            let N = norm(sub(mul(un.W, ng), dOut));                 // outward (air-side) normal: n·d_in − d_out
            let Nz = dot(N, un.W);
            if (Nz < 0.2) { N = un.W; Nz = 1; }
            const Nx = dot(N, f.ex), Ny = dot(N, f.ey);
            const pts3 = local.map((p) => { const z = c.z - ((p[0] - lc[0]) * Nx + (p[1] - lc[1]) * Ny) / Nz; return add(un.pos, add(add(mul(f.ex, p[0]), mul(f.ey, p[1])), mul(un.W, z))); });
            // toric curvature: fan = κ · width · g,  g = n cosθi / cosθt − 1  (thin-prism derivative of the exit angle)
            const ci = Math.max(0.05, dot(un.W, N)), ct = Math.max(0.05, dot(dOut, N)), g = Math.max(0.1, ng * ci / ct - 1);
            const ref = T.tu, ex = norm(sub(ref, mul(N, dot(ref, N)))), ey = cross(N, ex);
            let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
            for (const p of pts3) { const d = sub(p, P0); wx0 = Math.min(wx0, dot(d, ex)); wx1 = Math.max(wx1, dot(d, ex)); wy0 = Math.min(wy0, dot(d, ey)); wy1 = Math.max(wy1, dot(d, ey)); }
            const kx = Math.min(1.5, cu / (Math.max(0.2, wx1 - wx0) * g)), ky = Math.min(1.5, cv / (Math.max(0.2, wy1 - wy0) * g));
            stat.fanMax = Math.max(stat.fanMax, cu / D2R, cv / D2R);
            const id = gid + '_x' + c.part + c.idx;
            surfaces.push({ type: 'quad', id, group: 'L' + ui, P: P0, n: N, ref, curv: [kx, ky, 0, 0], clip: { kind: 'poly', pts3 }, front: 1, optics: glass(ng) });
            if (A) intent.push({ facet: id, cells: A.pts.map((p) => [p.i, p.w]) });
            stat.cells++;
          }
          un.cells = cells.length;
        });
        return { surfaces, intent, stat };
      }
      const bounces = (structure) => (structure === 'partitioned' ? 5 : 4);
      const score = (tr) => {
        if (spec && tr.spec) return -(tr.spec.n.fail * 1e4 + tr.spec.n.unsure * 1e2) + (tr.fidelity ? tr.fidelity.fidelity : 0);
        return tr.fidelity ? tr.fidelity.fidelity : 0;
      };
      const traceOf = (b, structure) => tools.trace(b.surfaces, { rays: Math.min(2e6, settings.calibRays), seed: input.seed, bounces: bounces(structure), spec });
      const w1 = new Float64Array(res * res).fill(1);
      // ---- 3. structure choice
      let structure = settings.structure, best = null;
      if (structure === 'auto') {
        if (!canTrace) { structure = 'single'; notes.push('structure auto: no tracer available, single body'); }
        else {
          const cand = ['single', 'partitioned'].map((s) => { const b = build(w1, s, settings.blur), tr = traceOf(b, s); show(b, s, 'structure: ' + s, tr); return { s, b, tr, sc: score(tr), w: w1, blur: settings.blur }; });
          cand.sort((a, b) => b.sc - a.sc || (a.s < b.s ? -1 : 1));
          structure = cand[0].s; best = cand[0];
          notes.push('structure auto: traced single (' + cand.find((c) => c.s === 'single').sc.toFixed(3) + ') vs partitioned (' + cand.find((c) => c.s === 'partitioned').sc.toFixed(3) + ') → ' + structure);
        }
      }
      if (!best) { const b = build(w1, structure, settings.blur); best = { s: structure, b, tr: null, sc: -Infinity, w: w1, blur: settings.blur }; if (canTrace && settings.calib > 0) { best.tr = traceOf(b, structure); best.sc = score(best.tr); } }
      // ---- 4. traced calibration: reweight the paint by (paint / got)^γ, re-cut slices and regions, keep the best round
      const log = [best.sc];
      let cur = best;
      for (let r = 0; r < settings.calib && canTrace && cur.tr; r++) {
        if (nowMs() - t0 > 50000) { notes.push('calibration stopped at round ' + r + ' (time governor, 50 s)'); break; }
        const got = RF.Engine.toPaintGrid(cur.tr.grid, cur.tr.res, res);
        let sp = 0, sg = 0; for (const p of pts0) { sp += p.w; sg += got[p.i]; }
        if (!(sg > 0)) break;
        const w = new Float64Array(cur.w), kS = sp / sg;
        for (const p of pts0) { const ratio = p.w / Math.max(1e-9, got[p.i] * kS); w[p.i] = cur.w[p.i] * Math.pow(Math.min(2, Math.max(0.5, ratio)), 0.3); }
        // blur awareness follows the traced balance: lit gaps → shrink the regions more; too dim inside → less
        const fd = cur.tr.fidelity, blur = Math.min(2, Math.max(0.3, cur.blur * (fd && fd.gapsDark < fd.within ? 1.2 : 0.88)));
        const b = build(w, structure, blur), tr = traceOf(b, structure), cand = { s: structure, b, tr, sc: score(tr), w, blur };
        show(b, structure, 'calibration ' + (r + 1) + '/' + settings.calib, tr);
        log.push(cand.sc);
        if (cand.sc > best.sc) best = cand;
        cur = cand;
      }
      if (log.length > 1) notes.push('calibration (' + (spec ? 'spec: −fails·1e4 − unsure·1e2 + fidelity' : 'paint fidelity') + ' per round): ' + log.map((x) => (spec ? x.toFixed(2) : (100 * x).toFixed(1) + '%')).join(' → ') + '; kept the best (blur awareness ' + best.blur.toFixed(2) + '×)');
      const out = best.b, st = out.stat;
      notes.push(units.length + ' TIR unit' + (units.length > 1 ? 's' : '') + ', structure ' + structure + ', ' + settings.split + ' flux share; rc ' + rc.toFixed(1) + ' mm, hc ' + hc.toFixed(1) + ' mm (LED clearance ' + keep + ' mm); exact conic dome; ' + st.cells + ' toric exit lenslets, predicted LED image ≈ ' + (st.kernMean / Math.max(1, st.kn)).toFixed(1) + ' paint cells (mean), max lenslet fan ' + st.fanMax.toFixed(1) + '°');
      for (const un of units) notes.push('unit ' + (un.src.id || 'e' + un.k) + ': A ' + un.A.toFixed(1) + ' mm (rim ' + un.pf.rTop.toFixed(1) + '), height ' + un.pf.zTop.toFixed(1) + ' mm' + (structure === 'partitioned' ? ' (core lens n ' + nC + ', exit at ' + un.zCore.toFixed(1) + ' mm)' : '') + ', tilt ' + un.tilt.toFixed(1) + '°, ' + un.cells + ' lenslets, ' + un.pts.length + ' paint cells');
      notes.push('solve ' + ((nowMs() - t0) / 1000).toFixed(1) + ' s');
      return { surfaces: out.surfaces, intent: out.intent, notes, needs: { bounces: bounces(structure) } };
    },
  });
})();
