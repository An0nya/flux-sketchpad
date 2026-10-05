/* projector-v2.js — a projector headlamp module, second draft (experimental).  Supersedes projector-v1 (kept).
 *
 * Parts (all exact quadrics):
 *   1. Reflector: a DEPTH MAP over the LED's emission directions.  The projected unit disk (Lambertian = uniform there)
 *      is cut into cells; every cell chooses its own facet distance along the ray (no common base surface), subject to
 *      the envelope, the LED clearance, staying behind the focal surface, its chief ray reaching the lens aperture,
 *      LED → facet not crossing the shield, and facet → image not passing behind another facet (a shell test on the
 *      depth map itself).  Among the valid depths it keeps the smallest magnification |P − I| / |P − S| (the sharpest
 *      image), so awkward envelopes are filled cell by cell.  Each facet is an exact ellipsoid imaging the LED onto
 *      its image point on the lens's REAL focal surface (field curvature + distortion from a meridional trace).
 *   2. Shield (auto / on / off): the cut-off line mapped through the traced lens mapping, an axial defocus (softens the
 *      gradient: R112 wants G ≤ 0.40), optionally curved (a `quad` following the field curvature); clipped to the
 *      envelope (hard).  Paint mode: off by default.
 *   3. Lens: free conic constant (searched against the traced field blur over 0–20°), plano-convex or biconvex (two
 *      conic zones, focal length held by bisection on the traced EFL); aperture, focal length, axis height / lateral
 *      offset and setback from the envelope front searched.
 *   4. Light above the cut-off: a few small FLAT facets on directions the lens can't use, outside the lens / shield path,
 *      aimed straight at the R112 sign-point region / the FMVSS upper band.  A flat facet's blob is the LED as seen from
 *      it (several degrees: deliberately blurred) and its intensity is refl × luminance × patch area, so the patch area
 *      budgets the intensity (bounded both ways).
 *   5. Traced calibration (Spec mode, when tools.trace is available): a few rounds of tools.trace({ spec: true }):
 *      upper facets rescaled by their rows (mins up, maxes down), imaging-facet aims re-weighted toward failing minimum
 *      rows and away from exceeded maximum rows.  Time-governed (setting calSeconds).
 * needs.bounces = 1 + lens faces (+2 with exact Fresnel).  Deterministic (calibration traces use fixed seeds).
 * Engine note: a polygon clip is CONVEX (geometry.js intersect tests every edge's side), so the shield is built as one
 * convex strip per edge segment of the same surface; a single non-convex shield polygon silently passes light.
 * Known limit: on the bench boxes the lens acceptance cone (tan ≈ 0.4–0.5 at the focus) — not the envelope — bounds the
 * reflector depth (facets end 6–13 mm from the LED), so images stay large (≈ 9°) and the hot spot is flux-starved.  */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, D2R = Math.PI / 180;
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  function envBounds(env) {
    const c = env.center, h = env.half;
    if (env.shape === 'box') return { inside: (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && Math.abs(p[1] - c[1]) <= h[1] - m && Math.abs(p[2] - c[2]) <= h[2] - m,
      xmax: c[0] + h[0], xmin: c[0] - h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2] };
    if (env.shape === 'cylinder' && (env.axis | 0) === 0) return { inside: (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && ((p[1] - c[1]) / (h[1] - m)) ** 2 + ((p[2] - c[2]) / (h[2] - m)) ** 2 <= 1,
      xmax: c[0] + h[0], xmin: c[0] - h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2] };
    const hm = Math.max(...h);
    return { inside: (p, m) => RF.Geo.envInside(env, p, -m / hm), xmax: c[0] + h[0], xmin: c[0] - h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2] };
  }

  // ---------------------------------------------------------------- meridional lens trace (z along the axis, r up)
  // surfaces: { zv, R, k } (R = Infinity: plane z = zv); glass between surface 0 and 1
  function hitConic(s, z0, r0, dz, dr) {
    if (!isFinite(s.R)) { if (Math.abs(dz) < 1e-12) return null; const t = (s.zv - z0) / dz; return t > 1e-9 ? { t, nz: 1, nr: 0 } : null; }
    const k1 = 1 + s.k, w0 = z0 - s.zv;
    // r² + k1 w² − 2 R w = 0, w = w0 + t dz, r = r0 + t dr
    const A = dr * dr + k1 * dz * dz, B = 2 * (r0 * dr + k1 * w0 * dz - s.R * dz), C = r0 * r0 + k1 * w0 * w0 - 2 * s.R * w0;
    let ts = [];
    if (Math.abs(A) < 1e-14) ts = [-C / B]; else { const D = B * B - 4 * A * C; if (D < 0) return null; const q = Math.sqrt(D); ts = [(-B - q) / (2 * A), (-B + q) / (2 * A)]; }
    ts = ts.filter((t) => t > 1e-9).sort((a, b) => a - b);
    for (const t of ts) {
      const w = w0 + t * dz, r = r0 + t * dr;
      // the branch through the vertex: |w| small relative to R
      if (Math.abs(w) > Math.abs(s.R) * 0.999 / Math.max(0.05, Math.abs(k1) || 0.05) && k1 > 0) continue;
      const nz = 2 * k1 * w - 2 * s.R, nr = 2 * r, L = Math.hypot(nz, nr);
      return { t, nz: nz / L, nr: nr / L, r };
    }
    return null;
  }
  function refr(dz, dr, nz, nr, n1, n2) {
    let c = -(dz * nz + dr * nr); if (c < 0) { nz = -nz; nr = -nr; c = -c; }
    const eta = n1 / n2, k = 1 - eta * eta * (1 - c * c); if (k < 0) return null;
    const m = eta * c - Math.sqrt(k); return [eta * dz + m * nz, eta * dr + m * nr];
  }
  // trace a reversed fan at field angle th (rad): rays leave the lens toward +z at angle th; reversed they travel −z
  function fanFocus(L, th, a, nRays) {
    const lines = [], dz0 = -Math.cos(th), dr0 = -Math.sin(th), zs = L.s[1].zv + 5;
    for (let i = 0; i < nRays; i++) {
      const h = (-0.9 + 1.8 * (i + 0.5) / nRays) * a;
      let z = zs, r = h + (zs - L.s[1].zv) * 0 /* start on the aperture */, dz = dz0, dr = dr0;
      const h1 = hitConic(L.s[1], z, r, dz, dr); if (!h1) continue;
      z += h1.t * dz; r += h1.t * dr; if (Math.abs(r) > a) continue;
      let d = refr(dz, dr, h1.nz, h1.nr, 1, L.n); if (!d) continue; [dz, dr] = d;
      const h0 = hitConic(L.s[0], z, r, dz, dr); if (!h0) continue;
      z += h0.t * dz; r += h0.t * dr; if (Math.abs(r) > a) continue;
      d = refr(dz, dr, h0.nz, h0.nr, L.n, 1); if (!d) continue; [dz, dr] = d;
      lines.push([z, r, dz, dr]);
    }
    if (lines.length < 3) return null;
    // least-squares point closest to all lines (2D)
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const [z, r, dz, dr] of lines) { const nz = -dr, nr = dz, c = nz * z + nr * r; a11 += nz * nz; a12 += nz * nr; a22 += nr * nr; b1 += nz * c; b2 += nr * c; }
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-12) return null;
    const zf = (b1 * a22 - b2 * a12) / det, rf = (a11 * b2 - a12 * b1) / det;
    let e2 = 0; for (const [z, r, dz, dr] of lines) { const dd = -dr * (zf - z) + dz * (rf - r); e2 += dd * dd; }
    let tanAcc = 0; for (const [, , dz, dr] of lines) tanAcc = Math.max(tanAcc, Math.abs(dr / dz));
    return { z: zf, r: rf, rms: Math.sqrt(e2 / lines.length), n: lines.length, tanAcc };
  }
  // build a lens of effective focal length f: front conic (R1, k1) at z = 0, exit at z = t (flat or conic −R1·beta, k2)
  function makeLens(n, f, a, k1, beta) {
    const build = (R1) => {
      const s0 = { zv: 0, R: R1, k: k1 };
      const sag0 = RF.Geo.conicSag(R1, k1, a); if (!isFinite(sag0)) return null;
      let s1, sag1 = 0;
      if (beta > 0) { const R2 = -R1 / beta; sag1 = RF.Geo.conicSag(R2, k1 > -1 ? k1 : -1, a); if (!isFinite(sag1)) return null; }
      const t = Math.max(sag0 - sag1, 0) + Math.max(1, 0.06 * a);
      s1 = beta > 0 ? { zv: t, R: -R1 / beta, k: k1 > -1 ? k1 : -1 } : { zv: t, R: Infinity, k: 0 };
      return { n, s: [s0, s1], t, sag0, sag1, a };
    };
    // paraxial EFL by tracing: reversed parallel ray at height h, EFL = h / tan(out angle); BFD = distance from vertex 0 to focus
    const para = (L) => {
      const h = 0.05 * a; let z = L.s[1].zv + 5, r = h, dz = -1, dr = 0;
      const h1 = hitConic(L.s[1], z, r, dz, dr); if (!h1) return null; z += h1.t * dz; r += h1.t * dr;
      let d = refr(dz, dr, h1.nz, h1.nr, 1, n); if (!d) return null; [dz, dr] = d;
      const h0 = hitConic(L.s[0], z, r, dz, dr); if (!h0) return null; z += h0.t * dz; r += h0.t * dr;
      d = refr(dz, dr, h0.nz, h0.nr, n, 1); if (!d) return null; [dz, dr] = d;
      if (dr >= 0) return null;
      const tz = -r / dr; return { efl: h / (-dr / -dz), bfd: -(z + tz * dz) };
    };
    let lo = 0.2 * (n - 1) * f, hi = 3 * (n - 1) * f * (1 + beta), best = null;
    for (let it = 0; it < 40; it++) {
      const R1 = (lo + hi) / 2, L = build(R1); if (!L) { lo = R1; continue; }
      const p = para(L); if (!p) { lo = R1; continue; }
      best = Object.assign(L, p);
      if (p.efl > f) hi = R1; else lo = R1;
    }
    if (!best || !(best.bfd > 0.3 * f)) return null;
    // field map: focus position (relative to the paraxial focus, which sits at z = −bfd) at field angles
    const map = [];
    for (let i = 0; i <= 12; i++) {
      const th = i * 2.5 * D2R, ff = fanFocus(best, th, a, 15);
      if (!ff) { map.push(null); continue; }
      map.push({ th, dz: ff.z + best.bfd, rho: -ff.r, blur: ff.rms / f / D2R, pass: ff.n / 15 });
    }
    best.map = map; best.f = f; best.tanAcc = map[0] ? fanFocus(best, 0, a, 41).tanAcc : a / f;
    return best;
  }
  // interpolate the field map at angle th (deg): { dz, rho } (rho > 0 = image on the opposite side)
  function mapAt(L, thDeg) {
    const x = Math.min(29.99, Math.max(0, thDeg)) / 2.5, i = Math.floor(x), u = x - i;
    const A = L.map[i], B = L.map[Math.min(12, i + 1)];
    const fb = (m, t) => m || { dz: 0, rho: L.f * Math.tan(t * D2R) };
    const a = fb(A, i * 2.5), b = fb(B, (i + 1) * 2.5);
    return { dz: a.dz + (b.dz - a.dz) * u, rho: a.rho + (b.rho - a.rho) * u };
  }
  function lensMerit(L, wide) {
    let s = 0, w = 0;
    // on-axis heavy (the cut-off lives within ±5°), lost rays (TIR, misses) count as blur
    const ws = wide ? [4, 3, 2, 1.5, 1.2, 1, 0.8, 0.6, 0.4] : [6, 4, 2.5, 1.5, 1, 0.7, 0.5, 0.3, 0.2];
    for (let i = 0; i < ws.length; i++) { const m = L.map[i]; s += ws[i] * (m ? Math.min(m.blur, 8) + 8 * (1 - m.pass) : 8); w += ws[i]; }
    if (!L.map[0] || L.map[0].pass < 0.8) return 99;
    return s / w;
  }

  // the cut-off V(H) in degrees; H > 0 = right
  function cutoffOf(input, s) {
    const sp = input.spec, off = s.shieldOffset || 0;
    if (!sp) return () => off;
    const v0 = (sp.aim && isFinite(sp.aim.line) ? sp.aim.line : -0.57) + off;
    const own = sp.traffic === 'LHT' ? -1 : 1, fm = /fmvss/i.test(sp.preset || '');
    return (H) => { const x = H * own; if (x <= 0) return v0; if (fm) return v0 + Math.min(1, x / 0.5) * s.stepUp; return v0 + Math.min(Math.tan(15 * D2R) * x, s.riseMax); };
  }
  // dedicated upper-band aims { h, v, cd } (h > 0 = right, RHT; mirrored for LHT)
  function upperAims(input) {
    const sp = input.spec; if (!sp) return [];
    const own = sp.traffic === 'LHT' ? -1 : 1, fm = /fmvss/i.test(sp.preset || ''), hasGrad = sp.items.some((it) => it.kind === 'gradient');
    if (!hasGrad) return [];
    const list = fm
      ? [[2, 0.9, 1100], [-5, 1.2, 300], [-10, 0.8, 200], [8, 3.5, 160], [-8, 3.5, 160], [6, 1.2, 600]]
      : [[-7, 1.6, 160], [-3, 2.2, 150], [1.5, 2.6, 150], [5.5, 2.6, 150], [-4.5, 4.4, 90], [4.5, 4.4, 90]];
    return list.map(([h, v, cd]) => ({ h: h * own, v, cd }));
  }

  RF.Solvers.register({
    id: 'projector-v2', name: 'Projector module v2 (experimental)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused (facets tile the depth map)' },
      { key: 'depthPenalty', label: 'Depth-map stiffness (0 = every facet picks its own depth)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.35, help: 'penalty for leaving the base confocal ellipsoid' },
      { key: 'focal', label: 'Lens focal length (mm, 0 = auto)', type: 'number', min: 0, max: 120, step: 1, default: 0 },
      { key: 'aperture', label: 'Lens aperture radius (mm, 0 = auto)', type: 'number', min: 0, max: 60, step: 0.5, default: 0 },
      { key: 'ior', label: 'Lens index', type: 'number', min: 1.3, max: 2, step: 0.01, default: 1.49 },
      { key: 'lensShape', label: 'Lens shape', type: 'select', options: [{ value: 'auto', label: 'auto (least traced blur)' }, { value: 'stigmatic', label: 'stigmatic plano-convex (k = −n², v1)' }, { value: 'conic', label: 'plano-convex, free conic k' }, { value: 'biconvex', label: 'biconvex (two conic faces)' }], default: 'auto', help: 'auto = the least on-axis-weighted traced field blur (meridional), lost rays counted' },
      { key: 'fresnel', label: 'Exact Fresnel on the lens', type: 'checkbox', default: false },
      { key: 'shield', label: 'Shield', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'on', label: 'on' }, { value: 'off', label: 'off' }], default: 'auto', help: 'auto = on when the spec has a cut-off, off in paint mode' },
      { key: 'shieldCurved', label: 'Curved shield (follows the field curvature)', type: 'checkbox', default: true },
      { key: 'shieldDefocus', label: 'Shield axial offset (mm, + = toward the lens, −1 = auto)', type: 'number', min: -1, max: 2, step: 0.05, default: -1 },
      { key: 'shieldOffset', label: 'Shield edge offset (° in the far field, + = up)', type: 'number', min: -3, max: 3, step: 0.05, default: 0 },
      { key: 'upper', label: 'Facets above the cut-off (−1 = auto)', type: 'number', min: -1, max: 12, step: 1, default: -1 },
      { key: 'spread', label: 'Max horizontal spread (± °)', type: 'number', min: 2, max: 40, step: 1, default: 25 },
      { key: 'riseMax', label: 'Own-side rise cap (°, R112)', type: 'number', min: 0, max: 4, step: 0.1, default: 1.0 },
      { key: 'stepUp', label: 'Own-side step (°, FMVSS)', type: 'number', min: 0, max: 4, step: 0.1, default: 1.6 },
      { key: 'edgeDrop', label: 'Image centres below the cut-off (°)', type: 'number', min: 0, max: 3, step: 0.05, default: 0.6 },
      { key: 'calRounds', label: 'Traced calibration rounds (Spec mode)', type: 'number', min: 0, max: 8, step: 1, default: 4 },
      { key: 'calSeconds', label: 'Calibration time limit (s)', type: 'number', min: 0, max: 100, step: 5, default: 45 },
    ],
    async solve(input, s, tools) {
      const T0 = Date.now(), notes = [], src = input.source, S = src.pos, A = V.norm(src.axis), env = input.envelope, E = envBounds(env);
      const keep = env.keepOut || 0, n = s.ior, maxF = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
      const e1 = V.inPlane ? V.inPlane(A) : V.norm(V.cross(A, Math.abs(A[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = V.cross(A, e1);
      const ledW = Math.max(src.w || 2, src.h || 2, 2 * (src.radius || 1)), ledArea = (src.w || 2) * (src.h || 2);
      const lum = (src.power || 1000) / (Math.PI * ledArea);                    // cd/mm² (Lambertian)
      const spec = input.spec, hasCut = !!(spec && spec.items.some((it) => it.kind === 'gradient'));
      const shieldOn = s.shield === 'on' || (s.shield === 'auto' && hasCut);
      const dirOf = (u, v) => { const r2 = u * u + v * v, w = Math.sqrt(Math.max(0, 1 - r2)); return V.norm(V.add(V.mul(A, w), V.add(V.mul(e1, u), V.mul(e2, v)))); };
      const uvOf = (d) => (V.dot(d, A) > 0 ? [V.dot(d, e1), V.dot(d, e2)] : null);
      const rhoEnvD = (d) => { let lo = 0, hi = 400; if (!E.inside(V.add(S, V.mul(d, keep + 1)), 0.5)) return 0; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (E.inside(V.add(S, V.mul(d, m)), 0.5)) lo = m; else hi = m; } return lo; };
      const timeLeft = () => 100 - (Date.now() - T0) / 1000;

      // ---------------- lens candidates (traced meridional field map)
      const lensCache = new Map();
      const shapes = s.lensShape === 'auto' ? ['stigmatic', 'conic', 'biconvex'] : [s.lensShape];
      const wide = !spec;
      function bestLens(f, a) {
        const key = f.toFixed(2) + ':' + a.toFixed(2); if (lensCache.has(key)) return lensCache.get(key);
        let best = null;
        for (const sh of shapes) {
          const ks = sh === 'stigmatic' ? [-n * n] : sh === 'conic' ? [-0.9 * n * n, -0.8 * n * n, -0.65 * n * n, -1.15 * n * n] : [-1.6, -1, -0.5];
          const betas = sh === 'biconvex' ? [0.35, 0.7] : [0];
          for (const k of ks) for (const b of betas) {
            const L = makeLens(n, f, a, k, b); if (!L) continue;
            if (L.t > 0.75 * a || L.bfd < 0.6 * f) continue;          // ball-like lenses: the meridional model is not trusted there
            L.merit = lensMerit(L, wide); L.shape = sh; L.k = k; L.beta = b;
            if (!best || L.merit < best.merit) best = L;
          }
        }
        lensCache.set(key, best); return best;
      }

      // Lambertian samples for the layout search
      const samples = []; { const N = 20; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const u = -1 + (i + 0.5) * 2 / N, v = -1 + (j + 0.5) * 2 / N; if (u * u + v * v < 0.97) samples.push(dirOf(u, v)); } }
      const rhoE = samples.map(rhoEnvD);

      function layout(f, a, yA, zA, back) {
        const L = bestLens(f, a); if (!L) return null;
        const xExit = E.xmax - 0.6 - back, xFront = xExit - L.t, F = [xFront - L.bfd, yA, zA];
        for (let i = 0; i < 12; i++) { const c = Math.cos(i * Math.PI / 6) * a, sn = Math.sin(i * Math.PI / 6) * a; for (const x of [xFront + L.sag0, xExit]) if (!E.inside([x, yA + c, zA + sn], 0.2)) return null; }
        // LED clearance vs the lens body
        if (S[0] > xFront - keep - 1 && Math.hypot(S[1] - yA, S[2] - zA) < a + keep + 1) return null;
        if (F[0] < E.xmin + 3) return null;
        return { L, f, a, F, xExit, xFront, yA, zA, back };
      }
      // depth candidates along d: confocal ellipsoids (foci S, F) around the base sum Lb, plus the envelope-hugging depth.
      // Score = image sharpness − a penalty for leaving the base sum (keeps the depth map near-consistent: paths to F stay
      // inside the shell), so cells leave the base only where the envelope or a much sharper image pays for it.
      const LMUL = [1, 0.92, 1.08, 0.85, 1.17, 0.78, 1.28, 1.42];
      function depthChoice(lay, d, rmax, shell, Lb, cheap) {
        const { F, a, xFront } = lay, tanMax = 0.85 * lay.L.tanAcc, u = V.sub(F, S), D = V.len(u);
        let best = null;
        const rhos = [];
        for (const mul of cheap ? [1] : LMUL) { const Lc = Lb * mul; if (Lc > D + 0.5) rhos.push((Lc * Lc - D * D) / (2 * (Lc - V.dot(d, u)))); }
        rhos.push(rmax - 0.5);
        for (const rho of rhos) {
          if (!(rho > keep + 1) || rho > rmax - 0.3) continue;
          const P = V.add(S, V.mul(d, rho)), w = V.sub(F, P), lw = V.len(w);
          if (w[0] < 1) continue;
          if (Math.hypot(w[1], w[2]) / w[0] > tanMax) continue;
          if (V.dot(d, w) / lw > 0.81) continue;                          // grazing incidence (> 72°)
          if (shieldOn) { const tx = (F[0] - S[0]) / (P[0] - S[0]); if (tx > 0 && tx < 1) { const z = S[2] + tx * (P[2] - S[2]); if (z < F[2] + 0.5 && Math.abs(S[1] + tx * (P[1] - S[1]) - F[1]) < a * 1.3) continue; } }
          if (shell && shell(P, F)) continue;
          const m = lw / rho, img = m * ledW / lay.f / D2R;            // LED image size in the far field (°)
          const qv = 1 / (1 + img / 4), Lc = rho + lw, sc = qv - s.depthPenalty * Math.abs(Math.log(Lc / Lb));
          if (!best || sc > best.sc) best = { rho, P, q: qv, m, sc, Lc };
        }
        return best;
      }
      const LF = [1.15, 1.3, 1.5, 1.75, 2.1, 2.6, 3.3];
      function evalLayout(lay) {
        const D = V.dist(S, lay.F); let bestSc = 0, bestL = 0;
        for (const lf of LF) {
          let sc = 0; for (let i = 0; i < samples.length; i++) { if (rhoE[i] <= keep + 1.5) continue; const c = depthChoice(lay, samples[i], rhoE[i], null, D * lf, true); if (c) sc += c.q; }
          if (sc > bestSc) { bestSc = sc; bestL = D * lf; }
        }
        lay.Lb = bestL;
        return bestSc * (1 / (1 + lay.L.merit / 3));
      }
      // ---------------- search
      const fList = s.focal > 0 ? [s.focal] : [10, 12, 14, 17, 20, 24, 28, 34, 42, 52];
      const backs = [0, 4, 9], yOffs = [0, -6, 6];
      let best = null;
      for (const f of fList) {
        const aCap = s.aperture > 0 ? s.aperture : Math.min(0.85 * f, (E.zmax - E.zmin) / 2 - 0.8, (E.ymax - E.ymin) / 2 - 0.8);
        for (const af of [1, 0.8, 0.65]) {
          const a = aCap * af; if (a < 3) continue;
          for (const back of backs) for (const dy of yOffs) for (let zi = 0; zi <= 6; zi++) {
            const zA = E.zmin + a + 0.8 + (E.zmax - E.zmin - 2 * a - 1.6) * zi / 6, yA = Math.max(E.ymin + a + 0.8, Math.min(E.ymax - a - 0.8, S[1] + dy));
            const lay = layout(f, a, yA, zA, back); if (!lay) continue;
            const sc = evalLayout(lay);
            if (!best || sc > best.sc) best = { lay, sc };
          }
        }
      }
      if (!best || best.sc <= 0) return { surfaces: [], notes: ['projector-v2: no layout fits this envelope / LED orientation'] };
      const lay = best.lay, { F, f, a, L } = lay;
      notes.push(`lens ${L.shape} k ${L.k.toFixed(2)}${L.beta ? ', exit R ' + (-L.s[1].R).toFixed(1) : ''}, f ${f.toFixed(1)} mm, Ø${(2 * a).toFixed(1)}, R1 ${L.s[0].R.toFixed(1)}, t ${L.t.toFixed(1)}, bfd ${L.bfd.toFixed(1)}, setback ${lay.back} mm, axis y ${lay.yA.toFixed(1)} z ${lay.zA.toFixed(1)}; traced field blur 0/10/20° = ${[0, 4, 8].map((i) => (L.map[i] ? L.map[i].blur.toFixed(2) : '–')).join(' / ')}°`);

      // focal-surface point for far-field direction (H, V) degrees
      const imgPoint = (H, Vd, dzExtra) => {
        const tx = Math.tan(H * D2R), tz = Math.tan(Vd * D2R), tt = Math.hypot(tx, tz), th = Math.atan(tt) / D2R, m = mapAt(L, th);
        const sc = tt > 1e-9 ? m.rho / tt : f;
        return [F[0] + m.dz + (dzExtra || 0), F[1] + tx * sc, F[2] - tz * sc];
      };

      // ---------------- the depth map: cells on the projected disk
      const nUpWant = s.upper >= 0 ? s.upper | 0 : upperAims(input).length;
      const fBudget = Math.max(1, maxF - Math.min(nUpWant, Math.floor(maxF / 4)));
      let grid = null;
      for (let N = 6; N <= 90; N++) {
        const cells = [];
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const h = 2 / N, u0 = -1 + i * h, v0 = -1 + j * h, uc = u0 + h / 2, vc = v0 + h / 2;
          if (uc * uc + vc * vc > 0.98) continue;
          const corners = [[u0, v0], [u0 + h, v0], [u0 + h, v0 + h], [u0, v0 + h]].map(([x, y]) => { const r = Math.hypot(x, y); return r > 0.995 ? [x * 0.995 / r, y * 0.995 / r] : [x, y]; });
          const d = dirOf(uc, vc), rmax = Math.min(rhoEnvD(d), ...corners.map((q) => rhoEnvD(dirOf(q[0], q[1]))));
          if (rmax <= keep + 1.5) continue;
          const c = depthChoice(lay, d, rmax, null, lay.Lb); if (!c) { cells.push({ i, j, uc, vc, corners, d, rmax, free: true }); continue; }
          cells.push({ i, j, uc, vc, corners, d, rmax, c });
        }
        const used = cells.filter((c) => !c.free).length;
        if (used > fBudget) break;
        grid = { N, cells };
      }
      if (!grid) return { surfaces: [], notes: notes.concat(['projector-v2: no facet cell fits']) };
      const N = grid.N, cellAt = new Map(); for (const c of grid.cells) cellAt.set(c.i * 1000 + c.j, c);
      const cellOfDir = (d) => { const uv = uvOf(d); if (!uv) return null; const i = Math.floor((uv[0] + 1) * N / 2), j = Math.floor((uv[1] + 1) * N / 2); return cellAt.get(i * 1000 + j) || null; };
      // shell test: does a path P → Q pass behind a placed facet (|X − S| beyond that cell's depth)?
      const uF = V.sub(F, S), DF = V.len(uF);
      const blocked = (P, Q, self) => {
        for (let k = 1; k < 16; k++) {
          const X = V.add(P, V.mul(V.sub(Q, P), k / 16)), w = V.sub(X, S), r = V.len(w); if (r < 1e-6) continue;
          const c = cellOfDir(V.mul(w, 1 / r)); if (!c || c === self) continue;
          // exact depth of that cell's facet along this direction (its ellipsoid with foci S, F; the flat upper facets: plane)
          let rho = Infinity;
          if (c.c) { const d = V.mul(w, 1 / r), Lc = c.c.Lc; rho = (Lc * Lc - DF * DF) / (2 * (Lc - V.dot(d, uF))); if (!(rho > 0)) rho = Infinity; }
          else if (c.up) rho = c.up.rho;
          if (r > rho + 0.2) return true;
        }
        return false;
      };
      // two passes: re-choose each cell's depth with the shell test against the others
      for (let pass = 0; pass < 2; pass++) for (const c of grid.cells) {
        if (c.free && pass === 0) continue;
        const ch = depthChoice(lay, c.d, c.rmax, (P, Fp) => blocked(P, Fp, c), lay.Lb);
        if (ch) { c.c = ch; c.free = false; } else { c.c = null; c.free = true; }
      }
      let imgCells = grid.cells.filter((c) => c.c);
      if (imgCells.length > fBudget) { imgCells.sort((p, q) => q.c.q - p.c.q); for (const c of imgCells.slice(fBudget)) { c.c = null; c.free = true; } imgCells = imgCells.slice(0, fBudget); }
      const depths = imgCells.map((c) => c.c.rho);
      notes.push(`depth map: ${N}×${N} grid, base sum ${lay.Lb.toFixed(1)} mm, ${imgCells.length} imaging facets, depth ${Math.min(...depths).toFixed(1)}–${Math.max(...depths).toFixed(1)} mm from the LED`);

      // ---------------- upper facets on free cells, flat, aimed straight out (not through the lens / shield)
      const ups = [];
      {
        const aims = upperAims(input).slice(0, s.upper >= 0 ? s.upper | 0 : 99).slice(0, maxF - imgCells.length);
        const free = grid.cells.filter((c) => c.free), why = [0, 0, 0, 0, 0];
        const blocked0 = new Set(imgCells.filter((ic) => blocked(ic.c.P, F, ic)));
        const inLens = (X) => X[0] > F[0] - 1.5 && X[0] < lay.xExit + 1.5 && Math.hypot(X[1] - F[1], X[2] - F[2]) < a + 1.5;
        for (const aim of aims) {
          const dOut = RF.FarField && spec ? V.norm(RF.FarField.dirOf(aim.h, aim.v, spec.conv)) : V.norm([1, -Math.tan(aim.h * D2R), Math.tan(aim.v * D2R)]);
          let pick = null;
          for (const c of free) {
            if (c.up) continue;
            for (const fr of [0.95, 0.8, 0.65, 0.5]) {
              const rho = Math.max(keep + 1.5, c.rmax * fr), P = V.add(S, V.mul(c.d, rho));
              if (V.dot(V.sub(P, S), dOut) > -0.2 * rho && false) continue;
              // incoming: LED → P must not cross the lens / shield;  outgoing: P → envelope exit clear
              let ok = true;
              for (let k = 1; k <= 8 && ok; k++) { const X = V.add(S, V.mul(c.d, rho * k / 8)); if (inLens(X)) ok = false; if (shieldOn && Math.abs(X[0] - F[0]) < 1.5 && X[2] < F[2] + 1 && Math.abs(X[1] - F[1]) < a * 1.3) ok = false; }
              if (!ok) { why[0]++; continue; }
              const Q = V.add(P, V.mul(dOut, 400));
              for (let k = 1; k <= 60 && ok; k++) {
                const X = V.add(P, V.mul(dOut, 3 * k)); if (!E.inside(X, -2)) break;
                if (inLens(X)) ok = false; else if (shieldOn && Math.abs(X[0] - F[0]) < 1.5 && Math.abs(X[1] - F[1]) < a * 1.4 && X[2] < F[2] + 1) ok = false;
                else if (V.dist(X, S) < keep + 0.5) ok = false;
              }
              if (!ok) { why[1]++; continue; } if (blocked(P, V.add(P, V.mul(dOut, 60)), c)) { why[2]++; continue; }
              // normal must face the LED and the outgoing direction (reflection, not grazing)
              const nrm = V.norm(V.add(V.mul(c.d, -1), dOut)); if (V.dot(nrm, V.mul(c.d, -1)) < 0.15) { why[3]++; continue; }
              c.up = { rho }; const hurts = imgCells.some((ic) => !blocked0.has(ic) && blocked(ic.c.P, F, ic)); c.up = null;
              if (hurts) { why[4]++; continue; }
              const scr = rho - 0.5 * Math.hypot(c.uc, c.vc);
              if (!pick || scr > pick.scr) pick = { c, rho, P, nrm, scr };
              break;
            }
          }
          if (!pick) continue;
          pick.c.up = { rho: pick.rho }; pick.c.free = false;
          ups.push({ aim, dOut, P: pick.P, nrm: pick.nrm, cell: pick.c, scale: 1 });
        }
        if (aims.length) notes.push(`${ups.length} of ${aims.length} upper-band facets placed (flat, intensity budgeted by patch area; ${free.length} free cells, rejects in/out/shell/grazing/hurts ${why.join('/')})`);
      }

      // ---------------- far-field targets for the imaging facets
      const cut = cutoffOf(input, s), Tf = RF.Engine.targetFrame(input.target), res = input.paint.res, cellsP = input.paint.cells;
      const tg0 = [];
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const w = cellsP[j * res + i]; if (!(w > 0)) continue;
        const uv = RF.Engine.cellCenter(Tf, i, j), p = V.add(Tf.C, V.add(V.mul(Tf.tu, uv[0]), V.mul(Tf.tv, uv[1]))), d = V.sub(p, S);
        const H = Math.atan2(-d[1], d[0]) / D2R, Vd = Math.atan2(d[2], Math.hypot(d[0], d[1])) / D2R;
        if (Math.abs(H) > s.spread) continue;
        if (shieldOn && Vd > cut(H) - 0.1) continue;
        tg0.push({ H, V: shieldOn ? Math.min(Vd, cut(H) - s.edgeDrop) : Vd, w });
      }
      if (!tg0.length) tg0.push({ H: 0, V: cut(0) - s.edgeDrop, w: 1 });
      const bumps = [];                                                 // calibration: [{ h, v, r, g }]
      const defocus = !shieldOn ? 0 : s.shieldDefocus >= 0 ? s.shieldDefocus : (spec && /fmvss/i.test(spec.preset || '') ? 0 : 0.12 * f / 12);

      function build() {
        const tg = tg0.map((t) => { let g = 1; for (const b of bumps) { const r2 = ((t.H - b.h) ** 2 + (t.V - b.v) ** 2) / (b.r * b.r); g *= Math.pow(b.g, Math.exp(-r2)); } return { H: t.H, V: t.V, w: t.w * g }; });
        tg.sort((p, q) => (q.V - p.V) || (p.H - q.H));
        const tot = tg.reduce((x, t) => x + t.w, 0), K = imgCells.length, aims = [];
        { let acc = 0, idx = 0; for (let k = 0; k < K; k++) { const want = (k + 0.5) / K * tot; while (idx < tg.length - 1 && acc + tg[idx].w < want) { acc += tg[idx].w; idx++; } aims.push(tg[idx]); } }
        const order = imgCells.map((_, i) => i).sort((i, j) => imgCells[i].c.m - imgCells[j].c.m);
        const surfaces = []; let dropped = 0;
        order.forEach((ci, r) => {
          const c = imgCells[ci], t = aims[r], I = imgPoint(t.H, t.V), P = c.c.P;
          { const w = V.sub(I, P), tt = (lay.xFront - P[0]) / w[0], X = V.add(P, V.mul(w, tt)); if (!(w[0] > 0) || Math.hypot(X[1] - F[1], X[2] - F[2]) > 0.92 * a) { dropped++; return; } }
          // the facet's own ellipsoid (foci S, I through P): corners on it
          const u = V.sub(I, S), D = V.len(u), Ls = V.dist(P, S) + V.dist(P, I);
          const rhoAt = (d) => (Ls * Ls - D * D) / (2 * (Ls - V.dot(d, u)));
          let shrink = 1, pts3 = null;
          for (let it = 0; it < 6; it++) {
            const pts = c.corners.map((q) => { const d = dirOf(c.uc + (q[0] - c.uc) * shrink, c.vc + (q[1] - c.vc) * shrink); return V.add(S, V.mul(d, rhoAt(d))); });
            if (pts.every((p) => E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && p[0] < F[0] - 0.2)) { pts3 = pts; break; }
            shrink *= 0.85;
          }
          if (!pts3) return;
          surfaces.push({ type: 'facet', id: 'p2_f' + surfaces.length, P, S0: S.slice(), Z: I, di: V.dist(I, P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl } });
        });
        // upper facets: flat squares in the facet plane, area = cd / (refl · luminance · cos)
        ups.forEach((u, k) => {
          const cosO = Math.max(0.2, V.dot(u.nrm, u.dOut)), area = Math.min(u.aim.cd * u.scale / (refl * lum * cosO), 60), side = Math.sqrt(area);
          const ex = V.norm(V.cross(u.nrm, Math.abs(u.nrm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), ey = V.cross(u.nrm, ex), h = side / 2;
          const pts3 = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => V.add(u.P, V.add(V.mul(ex, x), V.mul(ey, y))));
          if (!pts3.every((p) => E.inside(p, 0.1) && V.dist(p, S) > keep + 0.2)) return;
          surfaces.push({ type: 'facet', id: 'p2_u' + k, P: u.P, S0: S.slice(), Z: V.add(u.P, V.mul(u.dOut, 25000)), di: 0, flat: true, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl } });
        });
        // shield
        if (shieldOn) {
          const W = Math.min(a * 1.15, f * Math.tan(s.spread * D2R) + 2), NE = 28, edge = [];
          for (let i = 0; i <= NE; i++) {
            const dy = -W + 2 * W * i / NE;
            // far-field H whose image lands at lateral offset dy (invert the map along the cut-off)
            let lo = -60, hi = 60; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (imgPoint(m, cut(m))[1] - F[1] < dy) lo = m; else hi = m; }
            const H = (lo + hi) / 2, p = imgPoint(H, cut(H), defocus); edge.push(p);
          }
          let zb = F[2] - a - 1; for (let it = 0; it < 60 && (!E.inside([F[0], F[1] + W, zb], 0.3) || !E.inside([F[0], F[1] - W, zb], 0.3)); it++) zb += 0.5;
          const xc = F[0] + defocus;
          // field curvature: fit dz = ½ c dy² on the edge
          let num = 0, den = 0; for (const p of edge) { const dy = p[1] - F[1]; num += (p[0] - xc) * dy * dy; den += 0.5 * dy ** 4; }
          const cy = s.shieldCurved && den > 0 ? num / den : 0;
          const xOn = (y) => xc + 0.5 * cy * (y - F[1]) ** 2;
          const pts = edge.map((p) => [xOn(p[1]), p[1], p[2]]).concat([[xOn(F[1] + W), F[1] + W, zb], [xOn(F[1] - W), F[1] - W, zb]]);
          // hard envelope clip: pull every point toward the shield centre until inside
          const ctr = [xc, F[1], (F[2] + zb) / 2];
          for (const p of pts) for (let it = 0; it < 30 && !E.inside(p, 0.2); it++) { p[1] = ctr[1] + (p[1] - ctr[1]) * 0.93; p[2] = ctr[2] + (p[2] - ctr[2]) * 0.93; p[0] = xOn(p[1]); }
          // the engine's polygon clip is convex, and a traced edge isn't: one convex strip per edge segment (same surface)
          const ne = edge.length, bot = (y) => [xOn(y), y, Math.max(zb, pts[ne][2], pts[ne + 1][2])];
          for (let i = 0; i + 1 < ne; i++) {
            const pa = pts[i], pb = pts[i + 1], q = [pa, pb, bot(pb[1]), bot(pa[1])];
            if (Math.abs(pb[1] - pa[1]) < 1e-3 || q.some((x) => !E.inside(x, 0.1))) continue;
            surfaces.push(Math.abs(cy) > 1e-5
              ? { type: 'quad', id: 'p2_shield' + i, P: [xc, F[1], ctr[2]], n: [-1, 0, 0], ref: [0, 1, 0], curv: [-cy, 0, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB }
              : { type: 'plane', id: 'p2_shield' + i, P: ctr, n: [-1, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB });
          }
        }
        // lens
        {
          const glass = s.fresnel ? { interaction: 'refract', reflectivity: 0, ior: n, fresnel: 'exact', twoSided: false } : { interaction: 'refract', reflectivity: 0.9, ior: n, fresnelT: 0.96, twoSided: false };
          const O = [lay.xFront, F[1], F[2]], Wx = [1, 0, 0], ref = [0, 0, 1];
          surfaces.push({ type: 'rev', id: 'p2_lens_face', O, W: Wx, ref, seg: { kind: 'conic', zv: 0, R: L.s[0].R, k: L.s[0].k, r0: 0, r1: a }, front: 1, optics: glass });
          const z1 = isFinite(L.s[1].R) ? L.s[1].zv + L.sag1 : L.t;
          surfaces.push({ type: 'rev', id: 'p2_lens_edge', O, W: Wx, ref, seg: { kind: 'line', z0: L.sag0, r0: a, z1, r1: a }, front: 1, optics: ABSORB });
          if (isFinite(L.s[1].R)) surfaces.push({ type: 'rev', id: 'p2_lens_exit', O, W: Wx, ref, seg: { kind: 'conic', zv: L.s[1].zv, R: L.s[1].R, k: L.s[1].k, r0: 0, r1: a }, front: 1, optics: glass });
          else surfaces.push({ type: 'rev', id: 'p2_lens_exit', O, W: Wx, ref, seg: { kind: 'line', z0: L.t, r0: 0, z1: L.t, r1: a }, front: 1, optics: glass });
        }
        return surfaces;
      }
      const bounces = 3 + (s.fresnel ? 2 : 0);
      let surfaces = build();

      // ---------------- traced calibration (Spec mode)
      const canTrace = spec && tools && typeof tools.trace === 'function' && s.calRounds > 0;
      if (canTrace) {
        const lowRegion = (h, v) => v < cut(h) - 0.15;
        let bestSurf = surfaces, bestKey = null, log = [];
        for (let round = 0; round <= s.calRounds; round++) {
          if ((Date.now() - T0) / 1000 > s.calSeconds) { log.push('time'); break; }
          let res;
          try { res = await tools.trace(surfaces, { rays: 1e6, spec: true, bounces, seed: 7 + round }); } catch (e) { notes.push('calibration: trace unavailable (' + String(e.message || e).slice(0, 60) + ')'); break; }
          const sp = res && res.spec; if (!sp) break;
          if (tools.preview) tools.preview(surfaces, { label: 'calibration ' + round + '/' + s.calRounds, trace: res, needs: { bounces } });   // display only
          const key = [sp.n.fail, -sp.score];
          log.push(`${sp.n.fail}/${sp.n.unsure}`);
          if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { bestKey = key; bestSurf = surfaces; }
          if (round === s.calRounds) break;
          const item = (name) => spec.items.find((it) => it.name === name);
          // per-upper-facet scale from its nearest rows
          const need = ups.map(() => ({ lo: 0, hi: Infinity }));
          for (const row of sp.rows) {
            const it = item(row.name); if (!it || !(row.bound > 0) || !isFinite(row.value)) continue;
            const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : it.kind === 'zone' ? it.poly : null; if (!pts) continue;
            const ch = pts.reduce((x, p) => x + p[0], 0) / pts.length, cv = pts.reduce((x, p) => x + p[1], 0) / pts.length;
            const upperRow = !lowRegion(ch, cv) && cv < 6;
            const val = Math.max(row.value, 1e-3);
            if (upperRow && ups.length) {
              // nearest upper facet(s) by aim
              let bi = -1, bd = Infinity; ups.forEach((u, k) => { const dd = Math.hypot(u.aim.h - ch, u.aim.v - cv); if (dd < bd) { bd = dd; bi = k; } });
              if (bi >= 0 && bd < 7) {
                if (row.isMin) need[bi].lo = Math.max(need[bi].lo, row.bound * 1.5 / val);
                else need[bi].hi = Math.min(need[bi].hi, row.bound * 0.7 / val);
              }
            } else if (lowRegion(ch, cv) && it.kind !== 'gradient' && it.kind !== 'linearity') {
              const ratio = row.isMin ? row.bound * 1.3 / val : row.bound * 0.8 / val;
              if ((row.isMin && ratio > 1) || (!row.isMin && ratio < 1)) {
                const span = it.kind === 'zone' ? Math.max(1.5, Math.hypot(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), 0) / 3) : 1.2;
                bumps.push({ h: ch, v: Math.min(cv, cut(ch) - s.edgeDrop), r: span, g: Math.min(3, Math.max(0.33, Math.pow(ratio, 0.6))) });
              }
            }
            // light above the cut-off from the imaging facets (B50L, zone III over): drop the image centres a little
          }
          ups.forEach((u, k) => { const nd = need[k]; let g = nd.lo > 0 ? nd.lo : 1; if (g > nd.hi) g = Math.sqrt(Math.max(nd.lo, 1e-3) * nd.hi); g = Math.min(g, nd.hi < Infinity ? Math.max(nd.hi, 0.2) : 4); u.scale = Math.max(0.05, Math.min(30, u.scale * Math.min(4, Math.max(0.25, g)))); });
          surfaces = build();
        }
        surfaces = bestSurf;
        notes.push(`traced calibration (1 M rays per round, fails/unsure): ${log.join(' → ')}; kept ${bestKey ? bestKey[0] + ' fails' : '—'}; ${((Date.now() - T0) / 1000).toFixed(1)} s`);
      }
      const nFac = surfaces.filter((x) => x.type === 'facet').length;
      notes.push(`${nFac} facets (of ${maxF}), ${shieldOn ? 'shield (defocus ' + defocus.toFixed(2) + ' mm' + (surfaces.some((x) => /^p2_shield/.test(x.id) && x.type === 'quad') ? ', curved' : '') + ')' : 'no shield'} + lens; cut-off ${spec ? 'from ' + spec.preset + ', ' + spec.traffic : 'none (paint mode)'}`);
      return { surfaces, notes, needs: { bounces } };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
