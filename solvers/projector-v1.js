/* projector-v1.js — a projector headlamp module (experimental).
 *
 * Three parts:
 *   1. a reflector of ellipsoidal facets: every facet is an exact ellipsoid with foci S0 = LED and an image point in the
 *      focal plane of the lens (facet P, S0, Z = image point, di = |Z − P|).  The image points are spread across the focal
 *      plane by the target's flux (the lens maps focal-plane offset (dy, dz) to far-field H = atan(dy/f), V = −atan(dz/f):
 *      inverted), so horizontal spread = image points spread sideways, vertical spread = image points raised.
 *   2. an absorbing shield (a plane patch in the focal plane) whose upper edge is the cut-off line mapped through the
 *      inversion: flat on the oncoming side, the 15° rise (R112) or a step (FMVSS) on the own side, traffic side
 *      respected.  It removes the light that would land ABOVE the cut-off.
 *   3. an aspheric plano-convex condenser (hyperbolic face k = −n² toward the shield, R = (n−1)f, flat exit; the
 *      construction of js/lenses.js 'asphere', copied) with an absorbing ground edge.
 * Lens axis = +x (the throw) through the focal point F.  The layout (F, f, aperture, reflector size) is searched to fit
 * the envelope and the LED clearance, scoring the LED flux whose reflected ray reaches the lens aperture.
 * needs.bounces = 3 (reflector + 2 lens faces).  Deterministic (no randomness; tools.trace not used).            */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, D2R = Math.PI / 180;
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  function envBounds(env) {
    const c = env.center, h = env.half;
    if (env.shape === 'box') return { inside: (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && Math.abs(p[1] - c[1]) <= h[1] - m && Math.abs(p[2] - c[2]) <= h[2] - m,
      xmax: c[0] + h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2], box: true };
    if (env.shape === 'cylinder' && (env.axis | 0) === 0) return { inside: (p, m) => Math.abs(p[0] - c[0]) <= h[0] - m && ((p[1] - c[1]) / (h[1] - m)) ** 2 + ((p[2] - c[2]) / (h[2] - m)) ** 2 <= 1,
      xmax: c[0] + h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2], cyl: true, c, h };
    // anything else: fall back to the host's test with a relative shrink
    const hm = Math.max(...h);
    return { inside: (p, m) => RF.Geo.envInside(env, p, -m / hm), xmax: c[0] + h[0], ymin: c[1] - h[1], ymax: c[1] + h[1], zmin: c[2] - h[2], zmax: c[2] + h[2] };
  }
  // the cut-off V(H) in degrees (before the judge's re-aim); H > 0 = right
  function cutoffOf(input, s) {
    const sp = input.spec, off = s.shieldOffset || 0;
    if (!sp) return (H) => off;                                      // paint mode: flat shield on the axis (+ offset)
    const v0 = (sp.aim && isFinite(sp.aim.line) ? sp.aim.line : -0.57) + off;
    const own = sp.traffic === 'LHT' ? -1 : 1;                       // items are already resolved, H > 0 = right; own side = right for RHT
    const fm = /fmvss/i.test(sp.preset || '');
    return (H) => {
      const x = H * own;
      if (x <= 0) return v0;
      if (fm) return v0 + Math.min(1, x / 0.5) * (s.stepUp);          // FMVSS: a step up on the own side
      return v0 + Math.min(Math.tan(15 * D2R) * x, s.riseMax);        // R112: 15° rise, capped
    };
  }

  RF.Solvers.register({
    id: 'projector-v1', name: 'Projector module (experimental)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused (facets tile the reflector)' },
      { key: 'focal', label: 'Lens focal length (mm, 0 = auto)', type: 'number', min: 0, max: 120, step: 1, default: 0 },
      { key: 'aperture', label: 'Lens aperture radius (mm, 0 = auto)', type: 'number', min: 0, max: 60, step: 0.5, default: 0 },
      { key: 'ior', label: 'Lens index', type: 'number', min: 1.3, max: 2, step: 0.01, default: 1.49 },
      { key: 'shieldOffset', label: 'Shield edge offset (° in the far field, + = up)', type: 'number', min: -3, max: 3, step: 0.05, default: 0 },
      { key: 'spread', label: 'Max horizontal spread (± °)', type: 'number', min: 2, max: 40, step: 1, default: 25 },
      { key: 'riseMax', label: 'Own-side rise cap (°, R112)', type: 'number', min: 0, max: 4, step: 0.1, default: 1.0 },
      { key: 'stepUp', label: 'Own-side step (°, FMVSS)', type: 'number', min: 0, max: 4, step: 0.1, default: 1.6 },
      { key: 'edgeDrop', label: 'Image centres below the cut-off (°)', type: 'number', min: 0, max: 3, step: 0.05, default: 0.6 },
    ],
    solve(input, s) {
      const notes = [], src = input.source, S = src.pos, A = V.norm(src.axis), env = input.envelope, E = envBounds(env);
      const keep = env.keepOut || 0, n = s.ior, maxF = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
      const e1 = V.inPlane ? V.inPlane(A) : V.norm(V.cross(A, Math.abs(A[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = V.cross(A, e1);
      const ledW = Math.max(src.w || 2, src.h || 2, 2 * (src.radius || 1));
      // Lambertian flux is uniform over the projected unit disk (u, v): sample directions there
      const dirOf = (u, v) => { const r2 = u * u + v * v, w = Math.sqrt(Math.max(0, 1 - r2)); return V.norm(V.add(V.mul(A, w), V.add(V.mul(e1, u), V.mul(e2, v)))); };
      const samples = []; { const N = 24; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const u = -1 + (i + 0.5) * 2 / N, v = -1 + (j + 0.5) * 2 / N; if (u * u + v * v < 0.97) samples.push(dirOf(u, v)); } }
      const rhoEnv = (d) => { let lo = 0, hi = 400; if (!E.inside(V.add(S, V.mul(d, keep + 1)), 0.5)) return 0; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (E.inside(V.add(S, V.mul(d, m)), 0.5)) lo = m; else hi = m; } return lo; };
      const rhoE = samples.map(rhoEnv);
      const asphereSag = (R, k, r) => RF.Geo.conicSag(R, k, r);

      // one layout: lens (f, a), focal point F, reflector size L (ellipsoid foci S, F with |PS| + |PF| = L)
      function layout(f, a, zA) {
        const R = (n - 1) * f, k = -n * n, sag = asphereSag(R, k, a), t = sag + Math.max(1, 0.06 * a);
        if (!isFinite(sag)) return null;
        const xExit = E.xmax - 0.6, F = [xExit - t - f, S[1], zA];
        // the lens must fit: test its rim points at the front and back
        for (let i = 0; i < 12; i++) { const c = Math.cos(i * Math.PI / 6) * a, sn = Math.sin(i * Math.PI / 6) * a; for (const x of [F[0] + f, xExit]) if (!E.inside([x, F[1] + c, F[2] + sn], 0.2)) return null; }
        if (V.dist(S, [F[0] + f, F[1], F[2]]) < keep + a + 1 && Math.abs(S[2] - zA) < a + 1 && S[0] > F[0] + f - 1) return null;   // LED inside the lens
        return { f, a, R, k, sag, t, F, xExit };
      }
      function evalL(lay, L) {
        const { F, f, a } = lay, D = V.dist(S, F), u = V.sub(F, S), tanMax = 0.95 * a / f;
        if (L <= D + 1) return null;
        let score = 0; const cells = [];
        samples.forEach((d, i) => {
          const rho = (L * L - D * D) / (2 * (L - V.dot(d, u)));
          if (!(rho > keep + 0.8) || rho > rhoE[i]) return;
          const P = V.add(S, V.mul(d, rho)), w = V.sub(F, P);
          if (w[0] < 1) return;                                       // must travel forward through the focal plane
          const tan = Math.hypot(w[1], w[2]) / w[0];
          if (tan > tanMax) return;
          // LED → P must not cross the shield (focal plane, below the edge) or the lens slab
          const tx = (F[0] - S[0]) / (P[0] - S[0]);
          if (tx > 0 && tx < 1) { const z = S[2] + tx * (P[2] - S[2]); if (z < F[2] + 0.5) return; }
          if (P[0] > F[0] + f - 1) return;
          const m = V.len(w) / rho, q = f / (f + 0.5 * m * ledW * 57.3 / 3);   // concentration proxy (image ≲ 3° → 1)
          score += q; cells.push(i);
        });
        return { score, L };
      }
      // search
      const fList = s.focal > 0 ? [s.focal] : [10, 12, 14, 17, 20, 24, 28, 33, 40, 48, 56];
      let best = null;
      for (const f of fList) {
        const aCap = s.aperture > 0 ? s.aperture : Math.min(0.85 * f, (E.zmax - E.zmin) / 2 - 0.8);
        for (const af of [1, 0.8, 0.65]) {
          const a = aCap * af; if (a < 3) continue;
          for (let zi = 0; zi <= 8; zi++) {
            const zA = E.zmin + a + 0.8 + (E.zmax - E.zmin - 2 * a - 1.6) * zi / 8;
            const lay = layout(f, a, zA); if (!lay) continue;
            const D = V.dist(S, lay.F);
            for (const Lf of [1.15, 1.3, 1.5, 1.75, 2.1, 2.6, 3.3]) {
              const r = evalL(lay, D * Lf); if (!r) continue;
              if (!best || r.score > best.score) best = Object.assign({ lay }, r);
            }
          }
        }
      }
      if (!best || best.score <= 0) return { surfaces: [], notes: ['projector-v1: no layout fits this envelope / LED orientation'] };
      const { lay, L } = best, { F, f, a } = lay, D = V.dist(S, F), u = V.sub(F, S);
      notes.push(`lens f ${f.toFixed(1)} mm, aperture Ø${(2 * a).toFixed(1)} mm, centre thickness ${lay.t.toFixed(1)} mm, focal point ${F.map((x) => x.toFixed(1)).join(', ')}; reflector ellipsoid sum ${L.toFixed(1)} mm; captured-flux proxy ${(best.score / samples.length * 100).toFixed(0)}% of LED`);

      // ---- facets: a grid on the projected disk, kept where the ray reaches the lens
      const rhoAt = (d) => (L * L - D * D) / (2 * (L - V.dot(d, u)));
      const okDir = (d) => {
        const rho = rhoAt(d); if (!(rho > keep + 0.8)) return null;
        const P = V.add(S, V.mul(d, rho)); if (!E.inside(P, 0.3)) return null;
        const w = V.sub(F, P); if (w[0] < 1 || Math.hypot(w[1], w[2]) / w[0] > 0.95 * a / f) return null;
        const tx = (F[0] - S[0]) / (P[0] - S[0]); if (tx > 0 && tx < 1 && S[2] + tx * (P[2] - S[2]) < F[2] + 0.5) return null;
        if (P[0] > F[0] + f - 1) return null;
        return P;
      };
      let cells = [];
      for (let N = 6; N <= 80; N++) {
        const c = [];
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const u0 = -1 + i * 2 / N, v0 = -1 + j * 2 / N, h = 2 / N, uc = u0 + h / 2, vc = v0 + h / 2;
          if (uc * uc + vc * vc > 0.98) continue;
          const corners = [[u0, v0], [u0 + h, v0], [u0 + h, v0 + h], [u0, v0 + h]].map(([x, y]) => { const r = Math.hypot(x, y); return r > 0.995 ? [x * 0.995 / r, y * 0.995 / r] : [x, y]; });
          const P = okDir(dirOf(uc, vc)); if (!P) continue;
          if (corners.some((q) => !okDir(dirOf(q[0], q[1])))) continue;
          c.push({ uc, vc, corners, P, flux: h * h * (1 - 0) });
        }
        if (c.length > maxF) break;
        cells = c;
      }
      if (!cells.length) return { surfaces: [], notes: notes.concat(['projector-v1: no facet cell fits']) };

      // ---- far-field targets: flux-weighted directions from the paint, below the cut-off (in spec mode)
      const cut = cutoffOf(input, s), T = RF.Engine.targetFrame(input.target), res = input.paint.res, cellsP = input.paint.cells;
      const tg = [];
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const w = cellsP[j * res + i]; if (!(w > 0)) continue;
        const uv = RF.Engine.cellCenter(T, i, j), p = V.add(T.C, V.add(V.mul(T.tu, uv[0]), V.mul(T.tv, uv[1]))), d = V.sub(p, S);
        const H = Math.atan2(-d[1], d[0]) / D2R, Vd = Math.atan2(d[2], Math.hypot(d[0], d[1])) / D2R;
        if (Math.abs(H) > s.spread) continue;
        if (Vd > cut(H) - 0.1) continue;                               // the shield removes it anyway
        tg.push({ H, V: Math.min(Vd, cut(H) - s.edgeDrop), w });
      }
      if (!tg.length) tg.push({ H: 0, V: cut(0) - s.edgeDrop, w: 1 });
      // stratified quantile sampling: order by V (near the line first) then H, pick one target per facet
      tg.sort((p, q) => (q.V - p.V) || (p.H - q.H));
      const tot = tg.reduce((x, t) => x + t.w, 0), K = cells.length, aims = [];
      { let acc = 0, idx = 0; for (let k = 0; k < K; k++) { const want = (k + 0.5) / K * tot; while (idx < tg.length - 1 && acc + tg[idx].w < want) { acc += tg[idx].w; idx++; } aims.push(tg[idx]); } }
      // pair facets and aims: facets with the smallest images (sharpest) get the aims nearest the cut-off
      const mag = cells.map((c) => V.dist(c.P, F) / V.dist(c.P, S));
      const order = cells.map((_, i) => i).sort((i, j) => mag[i] - mag[j]);
      const surfaces = [], intent = [];
      order.forEach((ci, r) => {
        const c = cells[ci], t = aims[r];
        const I = [F[0], F[1] + f * Math.tan(t.H * D2R), F[2] - f * Math.tan(t.V * D2R)];
        const pts3 = []; for (const q of c.corners) pts3.push(V.add(S, V.mul(dirOf(q[0], q[1]), rhoAt(dirOf(q[0], q[1])))));
        const id = 'pj_f' + surfaces.length;
        surfaces.push({ type: 'facet', id, P: c.P, S0: S.slice(), Z: I, di: V.dist(I, c.P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl } });
      });
      // ---- shield: plane x = F.x, edge = cut-off mapped through the inversion (dz = −f tan V, dy = f tan H)
      {
        const W = Math.min(a * 1.2, f * Math.tan(s.spread * D2R) + 2), pts = [], NE = 24;
        for (let i = 0; i <= NE; i++) { const dy = -W + 2 * W * i / NE, H = Math.atan(dy / f) / D2R; pts.push([F[0], F[1] + dy, F[2] - f * Math.tan(cut(H) * D2R)]); }
        let zb = F[2] - a - 1; for (let it = 0; it < 40 && (!E.inside([F[0], F[1] + W, zb], 0.3) || !E.inside([F[0], F[1] - W, zb], 0.3)); it++) zb += 0.5;
        pts.push([F[0], F[1] + W, zb], [F[0], F[1] - W, zb]);
        // keep the edge points inside the envelope
        const ok = pts.every((p) => E.inside(p, 0.1));
        if (!ok) notes.push('shield: some edge points touch the envelope');
        surfaces.push({ type: 'plane', id: 'pj_shield', P: [F[0], F[1], (pts[NE >> 1][2] + zb) / 2], n: [-1, 0, 0], clip: { kind: 'poly', pts3: pts }, optics: ABSORB });
      }
      // ---- lens (js/lenses.js 'asphere', copied): conic face toward F, ground edge, flat exit
      {
        const glass = { interaction: 'refract', reflectivity: 0.9, ior: n, fresnelT: 0.96, twoSided: false };
        const O = F.slice(), Wx = [1, 0, 0], ref = [0, 0, 1], d = f;
        surfaces.push({ type: 'rev', id: 'pj_lens_face', O, W: Wx, ref, seg: { kind: 'conic', zv: d, R: lay.R, k: lay.k, r0: 0, r1: a }, front: 1, optics: glass });
        surfaces.push({ type: 'rev', id: 'pj_lens_edge', O, W: Wx, ref, seg: { kind: 'line', z0: d + lay.sag, r0: a, z1: d + lay.t, r1: a }, front: 1, optics: ABSORB });
        surfaces.push({ type: 'rev', id: 'pj_lens_exit', O, W: Wx, ref, seg: { kind: 'line', z0: d + lay.t, r0: 0, z1: d + lay.t, r1: a }, front: 1, optics: glass });
      }
      notes.push(`${cells.length} ellipsoid facets (of ${maxF}), shield + lens (3 parts); cut-off ${input.spec ? 'from ' + input.spec.preset + ', ' + input.spec.traffic : 'flat (paint mode)'}`);
      return { surfaces, notes, needs: { bounces: 3 } };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
