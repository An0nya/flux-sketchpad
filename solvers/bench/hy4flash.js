/* A static paint solver: partition the LED's emission into flux cells, partition the painting into
 * equal-weight patches, then aim one small reflector at each patch.  All geometry is computed from
 * the scene; no rays are traced in solve(). */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const GA = Math.PI * (3 - Math.sqrt(5));

  function siteDirections(n, S, axis, tAxis, env, keep, maxTheta) {
    const [u, v] = V.basis(axis), cs = Math.cos(maxTheta * Math.PI / 180), out = [];
    for (let i = 0; i < n; i++) {
      const q = (i + 0.5) / n, ct = Math.sqrt(Math.max(0, 1 - q * (1 - cs * cs))), st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = GA * i + 0.37;
      const d = V.add(V.mul(axis, ct), V.add(V.mul(u, st * Math.cos(ph)), V.mul(v, st * Math.sin(ph))));
      const iv = RF.Geo.envInterval(env, S, d), t = iv[1];
      if (!(t > keep + 2) || iv[0] > 0) continue;
      const dt = V.dot(d, tAxis);
      out.push({ d, t, ct, dt });
    }
    return out;
  }

  // weighted k-means on painted cells, in cell coordinates
  function clusters(paint, res, n) {
    const pts = [];
    for (let k = 0; k < paint.length; k++) if (paint[k] > 0) pts.push([k % res, (k / res) | 0, paint[k]]);
    if (!pts.length) return [];
    n = Math.min(n, pts.length);
    let sw = 0; for (const p of pts) sw += p[2];
    // deterministic seeds: equal paint-mass quantiles in a boustrophedon scan
    const order = pts.slice().sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    const cen = [];
    for (let j = 0; j < n; j++) { const q = (j + 0.5) / n * sw; let s = 0, k = 0; while (k + 1 < order.length && s + order[k][2] < q) { s += order[k][2]; k++; } cen.push([order[k][0], order[k][1]]); }
    for (let it = 0; it < 12; it++) {
      const sx = new Float64Array(n), sy = new Float64Array(n), swj = new Float64Array(n), asg = new Int32Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; let best = 0, bd = Infinity;
        for (let j = 0; j < n; j++) { const dx = p[0] - cen[j][0], dy = p[1] - cen[j][1], dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = j; } }
        asg[i] = best; sx[best] += p[2] * p[0]; sy[best] += p[2] * p[1]; swj[best] += p[2];
      }
      for (let j = 0; j < n; j++) if (swj[j] > 0) cen[j] = [sx[j] / swj[j], sy[j] / swj[j]];
      if (it === 11) {
        const out = [];
        for (let j = 0; j < n; j++) if (swj[j] > 0) {
          let vv = 0, cnt = 0;
          for (let i = 0; i < pts.length; i++) if (asg[i] === j) { const p = pts[i]; vv += p[2] * ((p[0] - cen[j][0]) ** 2 + (p[1] - cen[j][1]) ** 2); cnt++; }
          out.push({ u: cen[j][0], v: cen[j][1], w: swj[j] / sw, rms: Math.sqrt(vv / swj[j]), n: cnt });
        }
        return out;
      }
    }
    return [];
  }

  function surfacePoint(fq, P, ex, ey, x, y) {
    if (fq.flat) return [P[0] + ex[0] * x + ey[0] * y, P[1] + ex[1] * x + ey[1] * y, P[2] + ex[2] * x + ey[2] * y];
    // exact root of the facet quadric along its own normal
    const o = [ex[0] * x + ey[0] * y, ex[1] * x + ey[1] * y, ex[2] * x + ey[2] * y];
    const roots = RF.Geo.quadricRay(fq.A, fq.b, [0, 0, 0], o, fq.n);
    let sag = 0;
    for (const q of roots) if (Math.abs(q) < Math.abs(sag || 1e9)) sag = q;
    return [P[0] + o[0] + fq.n[0] * sag, P[1] + o[1] + fq.n[1] * sag, P[2] + o[2] + fq.n[2] * sag];
  }

  // tangent half-planes of the (convex) envelope, used to clip facet outlines in their own plane
  function envPlanes(env) {
    const c = env.center, h = env.half, out = [], add = (w, s) => { let b = s; for (let i = 0; i < 3; i++) b += w[i] * c[i]; out.push([w[0], w[1], w[2], b]); };
    if (env.shape === 'ellipsoid') {
      const N = 64, g = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < N; k++) {
        const z = 1 - 2 * (k + 0.5) / N, rr = Math.sqrt(Math.max(0, 1 - z * z)), t = g * k;
        const w = [rr * Math.cos(t), rr * Math.sin(t), z];
        add(w, Math.hypot(w[0] * h[0], w[1] * h[1], w[2] * h[2]));
      }
    } else {
      const ax = env.shape === 'cylinder' ? (env.axis === undefined ? 2 : env.axis) : -1;
      if (ax < 0) for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) { const w = [0, 0, 0]; w[i] = sd; add(w, h[i]); }
      else {
        const w = [0, 0, 0]; w[ax] = 1; add(w, h[ax]); w[ax] = -1; add(w, h[ax]);
        const i = (ax + 1) % 3, j = (ax + 2) % 3;
        for (let k = 0; k < 48; k++) { const t = 2 * Math.PI * k / 48, q = [0, 0, 0]; q[i] = Math.cos(t); q[j] = Math.sin(t); add(q, Math.hypot(q[i] * h[i], q[j] * h[j])); }
      }
    }
    return out;
  }
  function clipPoly(poly, P, ex, ey, planes, margin) {
    let out = poly;
    for (const w of planes) {
      if (!out.length) break;
      const f = (p) => w[0] * (P[0] + ex[0] * p[0] + ey[0] * p[1]) + w[1] * (P[1] + ex[1] * p[0] + ey[1] * p[1]) + w[2] * (P[2] + ex[2] * p[0] + ey[2] * p[1]) - w[3] + margin;
      const inp = out; out = [];
      for (let i = 0; i < inp.length; i++) {
        const a = inp[i], b = inp[(i + 1) % inp.length], fa = f(a), fb = f(b);
        if (fa <= 0) out.push(a);
        if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
      }
    }
    return out;
  }
  const polyArea2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(s) / 2; };

  const STATIC_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'capture', label: 'Flux to shape', type: 'range', min: 0.1, max: 0.95, step: 0.05, default: 0.5 },
    { key: 'edgeMargin', label: 'Envelope edge margin (mm)', type: 'range', min: 0.1, max: 5, step: 0.1, default: 0.4 },
    { key: 'imageScale', label: 'LED image size factor', type: 'range', min: 0.4, max: 3, step: 0.1, default: 1 },
    { key: 'clusterScale', label: 'Patch size factor', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.5 },
    { key: 'maxTheta', label: 'LED cone half angle (deg)', type: 'range', min: 30, max: 89, step: 1, default: 82 },
    { key: 'widen', label: 'Defocus wide patches', type: 'checkbox', default: true },
    { key: 'blend', label: 'Flux / image-size balancing', type: 'range', min: 0, max: 2, step: 0.1, default: 0 },
    { key: 'reach', label: 'Paraboloid reach (smaller = farther)', type: 'range', min: 2.5, max: 5, step: 0.25, default: 3 },
    { key: 'spacing', label: 'Site spacing', type: 'range', min: 0.15, max: 0.7, step: 0.05, default: 0.3 },
    { key: 'coneGuard', label: 'Angular cone guard', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1.2 },
  ];

  // The static algorithm.  No ray tracing, no clocks, no randomness.
  function staticSolve(input, settings) {
      const env = input.envelope, L = input.source.pos, N = input.limits.maxFacets, Rfl = input.limits.reflectivity;
      const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
      const T = RF.Engine.targetFrame(input.target), D = V.dist(T.C, L), cell = 2 * T.half / T.res;
      const src = input.source, ax = RF.Source.frame(src).a;
      const tAxis = V.norm(V.sub(T.C, L));
      const sMin = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h)) : (src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius);
      const paint = input.paint.cells, res = input.paint.res;
      const planes = envPlanes(env);
      let Q = 0; for (const s2 of (input.sources || [src])) Q += s2.power || 0;
      const Qsite = (+settings.capture) * Q / Math.max(1, N);
      let cls = clusters(paint, res, N);
      let cand = siteDirections(Math.max(4 * N, 200), L, ax, tAxis, env, keep, +settings.maxTheta);
      // a paraboloid of revolution about the throw axis has its focus at the LED: rays from the
      // focus leave parallel to the axis, so neighbours cannot intercept each other's light.
      const fs = cand.filter((c) => c.dt > -0.5 && c.dt < 0.7 && c.ct > 0.15).map((c) => c.t * (1 - c.dt) / (+settings.reach || 3)).sort((a, b) => a - b);
      if (fs.length) {
        const f = fs[Math.floor(0.85 * fs.length)];
        cand = cand.map((c) => Object.assign(c, { rp: 2 * f / Math.max(1e-3, 1 - c.dt) }))
          .filter((c) => c.rp < c.t - 1 && c.rp > keep + 3 && c.dt < 0.9 && c.dt > -0.95);
      } else cand = cand.map((c) => Object.assign(c, { rp: c.t * 0.8 }));
      const Iof = (ct) => Math.max(1e-3, src.power * RF.Source.intensity(src, Math.acos(clamp(ct, -1, 1))) / RF.Source.totalIntegral(src));
      const aimOf = (c) => { const uv = RF.Engine.cellCenter(T, clamp(Math.round(c.u), 0, T.res - 1), clamp(Math.round(c.v), 0, T.res - 1)); return RF.Engine.targetUVtoWorld(T, uv[0], uv[1]); };
      // flux a site can intercept with the aperture its patch needs, aimed at a given point
      const capOf = (d, r, Z, Icd, wantQ) => {
        const P = V.add(L, V.mul(d, r)), n = V.norm(V.add(V.mul(d, -1), V.norm(V.sub(Z, P))));
        if (!V.len(n)) return null;
        const proj = Math.max(0.15, Math.abs(V.dot(d, n)));
        const a = Math.min(0.55 * r, Math.sqrt(Math.max(0, wantQ) * r * r / (Math.PI * Icd * proj)));
        const ex = V.inPlane(n), ey = V.cross(n, ex), disc = [];
        for (let q = 0; q < 16; q++) { const t = q * Math.PI / 8; disc.push([a * Math.cos(t), a * Math.sin(t)]); }
        const area = polyArea2(clipPoly(disc, P, ex, ey, planes, +settings.edgeMargin));
        return { cap: Icd * proj * area / (r * r), a, n, ex, ey, P, proj };
      };
      for (const c of cand) {
        const q = capOf(c.d, c.rp, T.C, Iof(c.ct), Qsite);
        c.cap = q ? q.cap : 0; c.r = c.rp;
      }
      // keep well-separated sites that can carry a full flux share; prefer the farthest (sharpest images)
      const sep = 0.30 * Math.sqrt(4 * Math.PI / Math.max(8, cls.length));
      const sites = [];
      for (const thresh of [0.9, 0.7, 0.5, 0.3, 0.1, 0]) {
        const pool = cand.filter((c) => c.cap >= thresh * Qsite).sort((a, b) => b.r / Math.max(0.05, b.ct) - a.r / Math.max(0.05, a.ct) || b.cap - a.cap);
        for (const c of pool) {
          if (sites.length >= cls.length) break;
          let ok = true;
          for (const s of sites) if (V.dot(s.d, c.d) > Math.cos(sep)) { ok = false; break; }
          if (ok) sites.push(c);
        }
        if (sites.length >= cls.length) break;
      }
      cls = clusters(paint, res, sites.length);   // one patch per usable site
      const surfaces = [], intent = [], notes = [];
      if (!cls.length || !sites.length) return { surfaces, intent, notes: ['no placeable facets'] };
      // A facet paints a patch of radius rho with roughly uniform light, so its flux must scale as
      // paint × rho² (not just paint sum): a facet whose image is forced wide by the LED needs
      // correspondingly more flux to reach the painted level.
      const rref = sites.map((s) => s.rp).sort((a, b) => a - b)[Math.floor(sites.length / 2)];
      const rhoOf = (c) => Math.max(D * sMin / rref * (+settings.imageScale), c.rms * cell * 2 * (+settings.clusterScale));
      const weight = cls.map((c) => c.w * clamp(Math.pow(Math.max(1, rhoOf(c) / Math.max(1e-6, c.rms * cell * 2)), +settings.blend), 0.7, 1.6));
      const wsum = weight.reduce((a, b) => a + b, 0) || 1;
      const wantOf = (j) => (+settings.capture) * Q * weight[j] / wsum;

      // assign each patch to the site that can carry its flux most comfortably
      const pairs = [];
      for (let i = 0; i < sites.length; i++) for (let j = 0; j < cls.length; j++) {
        const wantQ = wantOf(j);
        const q = capOf(sites[i].d, sites[i].rp, aimOf(cls[j]), Iof(sites[i].ct), wantQ);
        if (q) pairs.push([q.cap / Math.max(1e-9, wantQ), i, j, q]);
      }
      pairs.sort((a, b) => b[0] - a[0]);
      const usedS = new Set(), usedC = new Set(), match = [];
      for (const p of pairs) if (!usedS.has(p[1]) && !usedC.has(p[2])) { usedS.add(p[1]); usedC.add(p[2]); match.push(p); }

      const raw = [];
      for (const [, si, ci, q] of match) {
        const s = sites[si], c = cls[ci], d = s.d, Z = aimOf(c);
        const Icd = Iof(s.ct), wantQ = wantOf(ci);
        const a = Math.min(q.a, 0.42 * s.rp);
        const minImg = D * sMin / Math.max(1, s.rp) * (+settings.imageScale);
        const spot = Math.max(minImg, c.rms * cell * 2 * (+settings.clusterScale));
        raw.push({ d, P: q.P, ex: q.ex, a, r: s.rp, Z, c, wantQ, Icd, minImg, spot });
      }

      // shrink conflicting apertures (both in solid angle seen from the LED and in physical space)
      for (let pass = 0; pass < 3; pass++) for (let i = 0; i < raw.length; i++) for (let j = i + 1; j < raw.length; j++) {
        const A = raw[i], B = raw[j], ang = Math.acos(clamp(V.dot(A.d, B.d), -1, 1));
        const lim = (+settings.coneGuard || 1.2) * ang * Math.min(A.r, B.r);
        const sum = A.a + B.a;
        if (sum > lim) { const f = lim / sum; A.a *= f; B.a *= f; }
      }

      for (const f of raw) {
        let P = f.P, a = f.a, r = f.r, poly = [], fq = null, ex = null, ey = null, di = null, n = null, area = 0;
        const Icd = f.Icd;
        for (let it = 0; it < 8; it++) {
          n = V.norm(V.add(V.mul(f.d, -1), V.norm(V.sub(f.Z, P))));
          ex = V.inPlane(n, f.ex); ey = V.cross(n, ex);
          const Lt = V.dist(P, f.Z), proj = Math.max(0.15, Math.abs(V.dot(f.d, n)));
          const extra = Math.sqrt(Math.max(0, f.spot * f.spot - f.minImg * f.minImg));
          di = Lt;
          if (+settings.widen && extra > 0.1 && a > 0.2)
            di = clamp(Lt / (1 + extra / a), Math.max(3, r * 0.6), Lt);
          fq = RF.Geo.facetQuadric(P, L, f.Z, di);
          const disc = [];
          for (let q = 0; q < 24; q++) { const t = q * Math.PI / 12; disc.push([a * Math.cos(t), a * Math.sin(t)]); }
          poly = clipPoly(disc, P, ex, ey, planes, +settings.edgeMargin);
          area = polyArea2(poly);
          const flux = Icd * proj * area / (r * r);
          if (flux < 0.8 * f.wantQ && a < 0.55 * r && it < 6) {
            a = Math.min(0.55 * r, a * clamp(Math.sqrt(f.wantQ / Math.max(1e-9, flux)), 1.05, 1.8));
            continue;
          }
          break;
        }
        // check the real (possibly curved) surface, including edge midpoints; trim as needed
        const valid = () => {
          for (let q = 0; q < poly.length; q++) for (const t of [0, 0.5]) {
            const a2 = poly[q], b2 = poly[(q + 1) % poly.length];
            const p = surfacePoint(fq, P, ex, ey, a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t);
            if (!RF.Geo.envInside(env, p, 1e-7)) return false;
            for (const S of input.sources || [L]) if (V.dist(p, S.pos) < keep * (1 + 1e-6) + 0.3) return false;
          }
          return true;
        };
        for (let k = 0; k < 12 && poly.length >= 3 && !valid(); k++) {
          for (let q = 0; q < poly.length; q++) { poly[q][0] *= 0.96; poly[q][1] *= 0.96; }
          area *= 0.96 * 0.96;
        }
        if (poly.length < 3 || area < 0.04 || !di || !valid()) continue;
        const pts3 = poly.map((q) => surfacePoint(fq, P, ex, ey, q[0], q[1]));
        const id = 'F' + surfaces.length;
        surfaces.push({ type: 'facet', id, group: 'A', P, S0: L.slice(), Z: f.Z, flat: false, di,
          clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: Rfl } });
        intent.push({ facet: id, cells: [[clamp(Math.round(f.c.u), 0, res - 1) + res * clamp(Math.round(f.c.v), 0, res - 1), f.c.w]] });
      }
      notes.push(cls.length + ' patches, ' + surfaces.length + ' facets; static geometric partition');
      return { surfaces, intent, notes };
  }

  RF.Solvers.register({ id: 'bench-hy4flash--static-paint', name: 'Static patch reflector', version: '1.0',
    modes: ['paint'], settings: STATIC_SETTINGS, solve: staticSolve });

  // -------------------------------------------------------------------------------------------
  // Optional tuner: same geometry algorithm, but a short deterministic trace sweep picks the
  // settings for the requested goal.  Every candidate is traced with the SAME seed and paint, so
  // the comparison is about geometry rather than dice.  Only the winning geometry is returned.
  const TUNER_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', default: 'faithful',
      options: [{ value: 'faithful', label: 'faithful' }, { value: 'throw', label: 'throw' }, { value: 'efficient', label: 'efficient' }] },
    { key: 'quality', label: 'Search effort', type: 'select', default: 'normal',
      options: [{ value: 'quick', label: 'quick' }, { value: 'normal', label: 'normal' }, { value: 'thorough', label: 'thorough' }] },
  ];
  const BASE = {}; for (const f of STATIC_SETTINGS) BASE[f.key] = f.default;

  function candidates(goal, quality) {
    const out = [{}];
    const add = (o) => out.push(o);
    if (goal === 'throw') {
      add({ capture: 0.7, clusterScale: 1.1 });
      add({ capture: 0.85, clusterScale: 1, reach: 2.75 });
      add({ capture: 0.7, clusterScale: 1.3, spacing: 0.4, widen: false });
      add({ capture: 0.85, clusterScale: 1.2, reach: 3.25 });
      if (quality === 'thorough') { add({ capture: 0.6, clusterScale: 1, spacing: 0.25 }); add({ capture: 0.8, clusterScale: 1.1, coneGuard: 1.8 }); }
    } else if (goal === 'efficient') {
      add({ capture: 0.6, clusterScale: 1.8 });
      add({ capture: 0.7, clusterScale: 1.5, spacing: 0.4 });
      add({ capture: 0.5, clusterScale: 2 });
      add({ capture: 0.8, clusterScale: 1.6, reach: 3.25 });
      if (quality === 'thorough') { add({ capture: 0.65, clusterScale: 1.7, spacing: 0.25 }); add({ capture: 0.75, clusterScale: 1.3, coneGuard: 1.8 }); }
    } else {
      add({ capture: 0.4, clusterScale: 1.5 });
      add({ capture: 0.6, clusterScale: 1.5 });
      add({ capture: 0.5, clusterScale: 1.2 });
      add({ capture: 0.5, clusterScale: 1.8 });
      add({ capture: 0.5, clusterScale: 1.5, reach: 2.75, spacing: 0.4 });
      add({ capture: 0.55, clusterScale: 1.6, spacing: 0.25 });
      if (quality === 'thorough') { add({ capture: 0.45, clusterScale: 1.6, reach: 3.25 }); add({ capture: 0.6, clusterScale: 1.3, coneGuard: 1.5 }); }
    }
    return quality === 'quick' ? out.slice(0, 4) : out;
  }

  function tunerSolve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const list = candidates(goal, settings.quality);
    const rays = settings.quality === 'quick' ? 60000 : settings.quality === 'thorough' ? 250000 : 200000;
    const seed = 20261117;                       // fixed: candidates differ by geometry, never by dice
    const base = Object.assign({}, BASE, { minDistance: settings.minDistance });
    const runs = [];
    for (let i = 0; i < list.length; i++) {
      const cfg = Object.assign({}, base, list[i]);
      let out;
      try { out = staticSolve(input, cfg); } catch (e) { continue; }
      let t = null;
      if (tools && typeof tools.trace === 'function' && out.surfaces.length) {
        try { t = tools.trace(out.surfaces, { rays, seed, paint: input.paint && input.paint.cells }); } catch (e) { t = null; }
      }
      runs.push({ cfg, out, t });
    }
    if (!runs.length) return { surfaces: [], intent: [], notes: ['tuner: no placeable geometry'] };
    const valid = (t) => t && t.fidelity && isFinite(t.fidelity.fidelity) && t.fidelity.onPaint > 0;
    const onP = runs.map((r) => valid(r.t) ? r.t.fidelity.onPaint : 0);
    const peaks = runs.map((r) => valid(r.t) ? Math.max(1, r.t.peakCd || 0) : 1);
    const maxOn = Math.max(1e-9, ...onP), maxPeak = Math.max(1, ...peaks);
    const qualityOf = (r, i) => {
      const t = r.t;
      if (!valid(t)) return -1;
      const f = t.fidelity.fidelity, light = Math.min(1, onP[i] / 0.05);
      const F = f * light;
      if (goal === 'throw') return Math.log(peaks[i] / maxPeak) * 2 + 0.35 * F + 0.1 * Math.log(onP[i] / maxOn);
      if (goal === 'efficient') return 0.5 * Math.log(onP[i] / maxOn) + 0.25 * Math.log(peaks[i] / maxPeak) + 0.4 * F;
      return F;   // fidelity-first: brightness terms only earn after the beam matches the paint
    };
    let best = runs[0], bs = -Infinity;
    for (let i = 0; i < runs.length; i++) { const q = qualityOf(runs[i], i); if (q > bs) { bs = q; best = runs[i]; } }
    const notes = best.out.notes ? best.out.notes.slice() : [];
    notes.unshift('tuner ' + goal + '/' + settings.quality + ': ' + runs.length + ' candidates, '
      + rays.toLocaleString() + ' rays each, seed ' + seed + '; chose capture ' + best.cfg.capture
      + ', clusterScale ' + best.cfg.clusterScale + ', reach ' + best.cfg.reach + ', spacing ' + best.cfg.spacing);
    return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
  }

  RF.Solvers.register({ id: 'bench-hy4flash--static-paint-auto', name: 'Static patch reflector (tuned)', version: '1.0',
    modes: ['paint'], settings: TUNER_SETTINGS, solve: tunerSolve });
})();
