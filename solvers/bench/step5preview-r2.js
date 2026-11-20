/* solver.js — static faceted-reflector solver for the Flux paint mode, and a tuner that picks its settings.
 *
 * Two registrations, in this order:
 *   'facetfit'      the static algorithm (required, step 1-2).  solve() traces nothing.
 *   'facetfit-auto' the optional tuner (step 3): a `goal` select (faithful / throw / efficient), which
 *                   runs the static solver over a small candidate plan, traces each candidate with
 *                   tools.trace at the same seed, and returns the one that wins the goal.  A solver id
 *                   ending in -auto is exempt from the no-tracing rule; it is scored separately.
 *
 * Model (all static: tracing is refused inside solve()):
 *  target  the scorer wants each painted cell within ×/÷1.25 of max(paint, blur(paint, kernel)) and the
 *          gap cells within max(1.25·blur, 10% of a typical painted cell), with stray light beyond the
 *          gap band penalised.  Both halves are F1'd, so both are fitted.
 *  facet   one curved mirror (type 'facet', di = |P→Z|) placed on the "intended reflection" shell: its
 *          centre is the last point inside the envelope on an LED ray, its normal is the bisector of the ray
 *          and the aim, so P reflects the chief ray from S0 exactly at the aim Z, and with di = the distance
 *          to Z the emitter is imaged onto Z (a prolate ellipsoid with the LED at one focus, Z at the other).
 *  patch   the ellipse that the curved mirror images the LED into: the LED's apparent size × D/r, centred
 *          on Z (measured: a 2 mm LED at r≈48, D≈2000 images to ≈85 mm; flux ∝ clip area × radiance × Ω ×
 *          cos α, independent of the shape, is spread over that box), so a curved facet concentrates what a
 *          flat one fans out — that is the whole difference between the two in the score.
 *  fit     non-negative IRLS/Newton on the clip areas, with the aims re-solved greedily against the
 *          residual (integral-image pre-filter, exact scoring of the best few).
 *
 * The intended-reflection shell is a first-order picture of a taller reflector: it knows where a mirror
 * would have to be, not what a stacked field of mirrors shadows.  The reported blocked/shadowed shares
 * measure exactly what it did not model.
 */
(function (root) {
'use strict';
const RF = root.RF;
const V = RF.V, Geo = RF.Geo, Eng = RF.Engine, Src = RF.Source, Photo = RF.Photometry;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const nrm = (a) => V.norm(a);
const dot = (a, b) => V.dot(a, b);
const sub = (a, b) => V.sub(a, b);
const add = (a, b) => V.add(a, b);
const mul = (a, s) => V.mul(a, s);
const crs = (a, b) => V.cross(a, b);
const vlen = (a) => V.len(a);

// fraction of the reference interval [a,b] covered by [A,B]
function ovl(a, b, A, B) { const d = Math.min(b, B) - Math.max(a, A); return d > 0 ? d / (b - a) : 0; }
// square (Chebyshev) dilation of a boolean mask by rb cells — the scorer's gap band
function dilate(mask, R, rb) {
  const t = new Uint8Array(R * R), out = new Uint8Array(R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (mask[j * R + i])
    for (let q = Math.max(0, i - rb); q <= Math.min(R - 1, i + rb); q++) t[j * R + q] = 1;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (t[j * R + i])
    for (let q = Math.max(0, j - rb); q <= Math.min(R - 1, j + rb); q++) out[q * R + i] = 1;
  return out;
}
const inPlaneN = (a, n) => nrm(sub(a, mul(n, dot(a, n))));   // component of a ⊥ unit n, normalised

// the static solver: the whole algorithm, no tracing, milliseconds per 100 facets
const STATIC_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'rounds', label: 'Aim refinement rounds', type: 'range', min: 0, max: 12, step: 1, default: 5 },
    { key: 'dens', label: 'Facet density (linear × the angular cell)', type: 'range', min: 0.15, max: 3, step: 0.05, default: 0.6 },
    { key: 'gapWeight', label: 'Gap penalty', type: 'range', min: 0, max: 12, step: 0.25, default: 2 },
    { key: 'farWeight', label: 'Far-spill penalty', type: 'range', min: 0, max: 4, step: 0.05, default: 0.4 },
    { key: 'patch', label: 'LED image (× sw·D/r)', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
    { key: 'gapRamp', label: 'Gap-band stiffness', type: 'range', min: 0.02, max: 0.3, step: 0.01, default: 0.1 },
    { key: 'share', label: 'Max flux share per facet', type: 'range', min: 0.05, max: 1, step: 0.05, default: 1 },
    { key: 'useFrac', label: 'Share of the shell used', type: 'range', min: 0.05, max: 1, step: 0.05, default: 1 },
    { key: 'focus', label: 'Focus beyond the target (×)', type: 'range', min: 0.8, max: 2, step: 0.05, default: 1 },
    { key: 'excl', label: 'Patch overlap limit', type: 'range', min: 0, max: 1, step: 0.05, default: 0.35 },
  ];

function solveStatic(input, raw) {
  // the shipped defaults, overlaid with whatever the caller passed: my own tuner calls this with a partial
  // object, and the app/host hands over a sanitised one — either way every knob must have a value
  const settings = STATIC_SETTINGS.reduce((o, f) => Object.assign(o, { [f.key]: f.default }), {});
  for (const k of Object.keys(raw || {})) if (settings[k] !== undefined) settings[k] = raw[k];
  const notes = [];
    const lim = input.limits || {};
    const NMAX = clamp((lim.maxFacets | 0) || 100, 1, 4000);
    const RFL = (lim.reflectivity > 0 && lim.reflectivity <= 1) ? lim.reflectivity : 0.9;
    const src = input.source, L = src.pos, env = input.envelope;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const T = Eng.targetFrame(input.target);
    const Rp = input.paint.res | 0, paint = input.paint.cells, nc = Rp * Rp, cw = 2 * T.half / Rp;
    const fr = Src.frame(src);

    // ---------------------------------------------------------------- demand: the paint, blurred the way the scorer blurs it
    const ker = Photo.achievableKernel({ source: src, envelope: env, target: input.target });
    const B = Photo.boxBlur(paint, Rp, ker.cells);
    const D = new Float64Array(nc), cls = new Int8Array(nc), allow = new Float64Array(nc);
    let sp = 0, np = 0;
    for (let k = 0; k < nc; k++) if (paint[k] > 0) { D[k] = Math.max(paint[k], B[k]); sp += paint[k]; np++; }
    const typ = np ? sp / np : 0;
    const gapMask = dilate(Uint8Array.from(paint, (w) => (w > 0 ? 1 : 0)), Rp, Math.max(2, Math.ceil(ker.cells) + 2));
    for (let k = 0; k < nc; k++) {
      if (paint[k] > 0) { cls[k] = 1; allow[k] = D[k]; }
      else if (gapMask[k]) { cls[k] = 2; allow[k] = 0.9 * Math.max(1.25 * B[k], 0.1 * typ); }   // 0.9: a safety margin, the box is not the blotch
      else { cls[k] = 3; allow[k] = 0.1 * typ; }
    }

    // ---------------------------------------------------------------- the emitter: what a mirror in each direction sees
    function projAngle(u) {
      const ad = Math.abs(dot(fr.a, u));
      if (src.kind === 'planar') {
        const A = src.shape === 'disc' ? Math.PI * (src.radius || 0) * (src.radius || 0) : (src.w || 0) * (src.h || 0);
        return A * ad;
      }
      const R = src.radius || 0;
      if (src.shape === 'sphere') return Math.PI * R * R;
      if (src.shape === 'cylinder') { const Ll = src.length || 0; return 2 * R * Ll * ad + 2 * Math.PI * R * R; }
      return 0;
    }

    // ray from o along unit d against the target plane: the distance, or null (parallel / behind)
    function planeHit(o, d) {
      const dn = d[0] * T.n[0] + d[1] * T.n[1] + d[2] * T.n[2];
      if (dn > -1e-9) return null;
      const w = sub(T.C, o);
      const t = dot(w, T.n) / dn;
      return t > 0 ? t : null;
    }
    const cel = (x) => (x + T.half) / cw - 0.5;          // (u,v) → continuous cell coordinate
    const aimAt = (u, v) => Eng.targetUVtoWorld(T, u, v);

    // ---------------------------------------------------------------- the direction grid: where the mirrors go
    const tm = Src.thetaMax(src);
    const NT = 192, thTab = new Float64Array(NT + 1), cum = new Float64Array(NT + 1);
    for (let i = 0; i <= NT; i++) {
      const th = tm * i / NT;
      thTab[i] = th;
      if (i) cum[i] = cum[i - 1] + 0.5 * (Src.intensity(src, thTab[i - 1]) * Math.max(1e-9, Math.sin(thTab[i - 1])) +
        Src.intensity(src, th) * Math.max(1e-9, Math.sin(th))) * (tm / NT);
    }
    const cumTot = cum[NT];
    const thetaAt = (f) => {
      let lo = 0, hi = NT;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= f * cumTot) lo = m; else hi = m; }
      return thTab[lo] + (thTab[hi] - thTab[lo]) * ((f * cumTot - cum[lo]) / Math.max(1e-300, cum[hi] - cum[lo]));
    };
    const K = clamp(Math.round(Math.sqrt(Math.max(1, NMAX - 1) / 2)), 2, 16);
    const M0 = Math.max(2, Math.floor((NMAX - 1) / K)), rem = (NMAX - 1) - K * M0;
    const dirs = [];
    for (let k = 0; k < K; k++) {
      const th = thetaAt((k + 0.5) / K);
      const cols = M0 + (k < rem ? 1 : 0), dph = 2 * Math.PI / cols;
      const dth = Math.max(thetaAt(Math.min(1, (k + 1.5) / K)) - th, th - thetaAt(Math.max(0, (k - 0.5) / K)));
      for (let c = 0; c < cols; c++) {
        const ph = 2 * Math.PI * (c + (k & 1) * 0.5) / cols, st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
        dirs.push({
          d0: nrm(add(add(mul(fr.a, st), mul(fr.u, st * cp)), mul(fr.v, st * sp))),
          dth, dph, ref: nrm(add(mul(fr.u, sp), mul(fr.v, -cp))),
        });
      }
      if (k === 0) dirs.push({ d0: fr.a, dth: th, dph, ref: fr.u });     // straight up the LED's axis
    }
    dirs.length = Math.min(dirs.length, NMAX);

    // ---------------------------------------------------------------- the facets
    // the emitter's apparent size: a curved mirror images it to sw×D/r by sh×D/r
    const asz = (() => {
      const R = src.radius || 0;
      return [src.shape === 'sphere' ? 2 * R : (src.shape === 'cylinder' ? 2 * R : (src.w || 2 * R || 1)),
        src.shape === 'sphere' ? 2 * R : (src.shape === 'cylinder' ? 2 * R : (src.h || 2 * R || 1))];
    })();
    const sw = asz[0], sh = asz[1], PF = clamp(+settings.patch || 1, 0.4, 3), hs = 2 * T.half, FOC = clamp(+settings.focus || 1, 0.5, 4);
    const facets = [];
    for (const d of dirs) {
      const iv = Geo.envInterval(env, L, d.d0);
      if (!iv) continue;
      const st = Math.sqrt(Math.max(0, 1 - dot(fr.a, d.d0) * dot(fr.a, d.d0)));   // sin(angle to the LED axis)
      const dens = +settings.dens;
      facets.push({
        d0: d.d0, ref: d.ref, iv, aim: [0, 0], dead: false, fill: 0,
        hx0: Math.max(0.5, dens * iv[1] * st * d.dph / 2.2), hy0: Math.max(0.5, dens * iv[1] * d.dth / 2.2),
        lam: Photo.luminance(src, d.d0), om0: projAngle(d.d0) / (iv[1] * iv[1]),
      });
    }
    // a curved facet's surface sits sag below its clip plane (and bulges out of a tilted clip), so test the
    // corner ON the surface: ρ = 2rD/(r+D) is the vertex radius of curvature of the imaging ellipsoid
    const okAt = (t, hx, hy, d0, aim, ref) => {
      const P = add(L, mul(d0, t));
      const Ah = nrm(sub(aimAt(aim[0], aim[1]), P));
      const Nn = nrm(sub(d0, Ah));
      const ex = inPlaneN(ref, Nn), ey = crs(Nn, ex);
      const D = vlen(sub(aimAt(aim[0], aim[1]), P));
      const rho = 2 * t * D / Math.max(1e-6, t + D);
      const sag = 1.4 * (hx * hx + hy * hy) / (2 * Math.max(1, rho));
      // the surface is sag away from the clip plane (and the keep-out sphere is not convex from outside), so
      // test the corners AND the edge midpoints (the dip between corners), on both sides of the plane
      const pts = [[hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy], [hx, 0], [0, hy], [-hx, 0], [0, -hy], [0, 0]];
      for (const [px, py] of pts) {
        const q = add(P, add(mul(ex, px), mul(ey, py)));
        for (const zm of [0, 1, -1]) {
          const q2 = add(q, mul(Nn, zm * sag));
          if (!Geo.envInside(env, q2) || vlen(sub(q2, L)) < keep + Math.max(0.35, sag)) return false;
        }
      }
      return true;
    };
    // the placement, the normal, the clip, the patch and the flux level of f at its aim
    function setSize(f) { f.lvl = f.lam * f.om * f.cosa * (4 * f.hx * f.hy); }
    function geom(f) {
      const d0 = f.d0, tMax = f.iv[1], iv0 = f.iv[0];
      let hx = f.hx0, hy = f.hy0, t = tMax;
      for (let att = 0; att < 4; att++) {
        const lo0 = Math.max(iv0 + 1e-3, keep + 0.5);
        let lo = lo0, hi = tMax;
        if (hi > lo0 + 1e-3) for (let it = 0; it < 22; it++) {
          const m = 0.5 * (lo + hi);
          if (okAt(m, hx, hy, d0, f.aim, f.ref)) lo = m; else hi = m;
        }
        t = Math.max(lo0, lo - 0.2);
        if (okAt(t, hx, hy, d0, f.aim, f.ref)) break;
        hx *= 0.55; hy *= 0.55;
      }
      if (!okAt(t, hx, hy, d0, f.aim, f.ref)) { f.dead = true; return; }
      const P = add(L, mul(d0, t));
      const Ah = nrm(sub(aimAt(f.aim[0], f.aim[1]), P));
      const Nn = nrm(sub(d0, Ah));
      const ex = inPlaneN(f.ref, Nn), ey = crs(Nn, ex);
      const cosa = Math.abs(dot(d0, Nn));                       // = sin(bend/2): how head-on the mirror is
      const om = projAngle(d0) / (t * t);                       // the LED's solid angle at P
      f.P = P; f.r = t; f.hx = hx; f.hy = hy; f.dead = false; f.ex = ex; f.ey = ey; f.om = om; f.cosa = cosa;
      setSize(f);
      // the patch: the emitter's image, integrated over the LED × the aperture (scalar math: this runs
      // thousands of times).  A finite aperture images an extended emitter into a blotch that is NOT the
      // paraxial ellipse — its centroid drifts off the aim and it stretches along the plane of incidence,
      // and that drift is what leaves half the paint dim.  The ellipsoid's normal at a clip point is the
      // reflection property itself: n ∝ unit(P−c) + unit(F2−c), so no tracer is needed.
      // the second focus: FOC × the aim distance puts the image beyond the target plane, where the beam is still
      // converging, so the blotch on the target is (FOC−1)/FOC × the focused size — the knob that fits the image to
      // the grid: a coarse paint needs a tight spot, a fine one a wide wash
      const Th = planeHit(P, Ah);
      if (Th === null) { f.dead = true; return; }
      const Z2 = add(P, mul(Ah, Th * FOC));
      const nx = Nn[0], ny = Nn[1], nz = Nn[2];
      const ax = Ah[0], ay = Ah[1], az = Ah[2];
      const u1 = ex[0], u2 = ex[1], u3 = ex[2], v1 = ey[0], v2 = ey[1], v3 = ey[2];
      const Lx = L[0], Ly = L[1], Lz = L[2], Px = P[0], Py = P[1], Pz = P[2];
      const gx = T.C[0], gy = T.C[1], gz = T.C[2];
      const q1 = T.tu[0], q2 = T.tu[1], q3 = T.tu[2], w1 = T.tv[0], w2 = T.tv[1], w3 = T.tv[2];
      const m1 = T.n[0], m2 = T.n[1], m3 = T.n[2];
      const f1 = fr.u[0], f2 = fr.u[1], f3 = fr.u[2], e1 = fr.v[0], e2 = fr.v[1], e3 = fr.v[2];
      let su = 0, sv = 0, n = 0, ulo = 1e9, uhi = -1e9, vlo = 1e9, vhi = -1e9;
      const NA = 5, NB = 5, NC = 4, ND = 4;
      for (let ia = 0; ia < NA; ia++) { const fa = sw * (2 * (ia + 0.5) / NA - 1);
        for (let ib = 0; ib < NB; ib++) { const fb = sh * (2 * (ib + 0.5) / NB - 1);
          const rx = Lx + 0.5 * (f1 * fa + e1 * fb), ry = Ly + 0.5 * (f2 * fa + e2 * fb), rz = Lz + 0.5 * (f3 * fa + e3 * fb);
          for (let ic = 0; ic < NC; ic++) { const fc = 2 * (ic + 0.5) / NC - 1;
            for (let id = 0; id < ND; id++) { const fd = 2 * (id + 0.5) / ND - 1;
              const cx = Px + fc * hx * u1 + fd * hy * v1, cy = Py + fc * hx * u2 + fd * hy * v2, cz = Pz + fc * hx * u3 + fd * hy * v3;
              // n = unit(unit(L−c) + unit(Z−c))
              let a = Lx - cx, b = Ly - cy, c = Lz - cz, l = 1 / Math.sqrt(a * a + b * b + c * c);
              let d = Z2[0] - cx, e = Z2[1] - cy, g = Z2[2] - cz, l2 = 1 / Math.sqrt(d * d + e * e + g * g);
              const n1 = a * l + d * l2, n2 = b * l + e * l2, n3 = c * l + g * l2, ln = 1 / Math.sqrt(n1 * n1 + n2 * n2 + n3 * n3);
              const nn1 = n1 * ln, nn2 = n2 * ln, nn3 = n3 * ln;
              // r = c − q (the incident direction, from the emitter to the mirror), reflect about n
              const r1 = cx - rx, r2 = cy - ry, r3 = cz - rz, rn = r1 * nn1 + r2 * nn2 + r3 * nn3;
              const d1 = r1 - 2 * rn * nn1, d2 = r2 - 2 * rn * nn2, d3 = r3 - 2 * rn * nn3;
              const dn = d1 * m1 + d2 * m2 + d3 * m3;
              if (dn > -1e-9) continue;
              const tx = ((gx - cx) * m1 + (gy - cy) * m2 + (gz - cz) * m3) / dn;
              if (!(tx > 0)) continue;
              const uu = (cx + d1 * tx - gx), vv = (cy + d2 * tx - gy), zz = (cz + d3 * tx - gz);
              const u = uu * q1 + vv * q2 + zz * q3, v = uu * w1 + vv * w2 + zz * w3;
              su += u; sv += v; n++;
              if (u < ulo) ulo = u; if (u > uhi) uhi = u; if (v < vlo) vlo = v; if (v > vhi) vhi = v;
            } } } }
      f.di = Th * FOC;
      if (!n) { f.dead = true; return; }
      const cu = su / n, cv = sv / n;
      f.u0 = cu; f.v0 = cv;
      f.hu = clamp(Math.max(uhi - cu, cu - ulo) * PF, cw * 0.4, 0.45 * hs);
      f.hv = clamp(Math.max(vhi - cv, cv - vlo) * PF, cw * 0.4, 0.45 * hs);
    }
    function setKernel(f) {
      const a = cel(f.u0) - f.hu / cw, b = cel(f.u0) + f.hu / cw, c = cel(f.v0) - f.hv / cw, d = cel(f.v0) + f.hv / cw;
      const i1 = Math.max(0, Math.floor(a)), i2 = Math.min(Rp - 1, Math.ceil(b)), j1 = Math.max(0, Math.floor(c)), j2 = Math.min(Rp - 1, Math.ceil(d));
      const cs = [], ks = [];
      for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
        const w = ovl(a, b, i - 0.5, i + 0.5) * ovl(c, d, j - 0.5, j + 0.5);
        if (w > 1e-4) { cs.push(j * Rp + i); ks.push(w); }
      }
      f.cells = new Int32Array(cs); f.K = new Float32Array(ks);
    }

    // ---------------------------------------------------------------- the light state and the fit
    const G = new Float64Array(nc);
    const W = new Float64Array(nc), R = new Float64Array(nc);
    const RELAX = 0.6, SHARE = clamp(+settings.share || 1, 0.01, 1), EXCL = clamp(+settings.excl || 0.35, 0, 1);
    const GW = +settings.gapWeight || 2, FW = +settings.farWeight || 0.4, GRAMP = clamp(+settings.gapRamp || 0.1, 0.01, 0.5), PRAMP = 0.25;
    // per cell: is the light short/late of its target, and how stiff is that (IRLS weights)
    function state() {
      let obj = 0;
      for (let k = 0; k < nc; k++) {
        const g = G[k], c = cls[k];
        if (c === 1) {
          const d = D[k], lo = (1 - PRAMP) * d, hi = (1 + PRAMP) * d, rp = PRAMP * d, wr = 1 / (rp * rp);
          if (g < lo) { R[k] = lo - g; W[k] = wr; obj += (R[k] / rp) ** 2; }
          else if (g > hi) { R[k] = hi - g; W[k] = wr; obj += (R[k] / rp) ** 2; }
          else { R[k] = 0; W[k] = 0; }
        } else {
          const rp = (c === 2 ? GRAMP : 0.3) * typ, wq = (c === 2 ? GW : FW) / (rp * rp);
          if (g > allow[k]) { R[k] = allow[k] - g; W[k] = wq; obj += (R[k] / rp) ** 2 * (c === 2 ? GW : FW); }
          else { R[k] = 0; W[k] = 0; }
        }
      }
      return obj;
    }
    function contrib(f, s) { const q = s * f.lvl * f.fill; for (let z = 0; z < f.cells.length; z++) G[f.cells[z]] += q * f.K[z]; }
    // least-squares clip area for the current residual: u* = Σ w v R / Σ w v² (R = target − light so far)
    function fitFill(f) {
      let num = 0, den = 0;
      const q = f.lvl;
      for (let z = 0; z < f.cells.length; z++) { const k = f.cells[z], w = W[k]; if (!w) continue; const v = q * f.K[z]; num += w * R[k] * v; den += w * v * v; }
      return den > 0 ? clamp(num / den, 0, SHARE) : f.fill;
    }
    function fitAll() {
      for (let it = 0; it < 40; it++) {
        let moved = 0;
        state();
        for (const f of facets) {
          if (f.dead || !f.cells) continue;
          const nf = f.fill + RELAX * (fitFill(f) - f.fill);      // damped: the raw Gauss-Seidel step
          if (Math.abs(nf - f.fill) > 1e-7) { const d = (nf - f.fill) * f.lvl; for (let z = 0; z < f.cells.length; z++) G[f.cells[z]] += d * f.K[z]; f.fill = nf; moved++; }
        }
        state();
        if (moved < 3) break;
      }
    }
    // snapshot / restore the whole design, rebuilding G from scratch so no drift accumulates
    function snap() { return facets.map((f) => ({ aim: f.aim.slice(), fill: f.fill, dead: f.dead })); }
    function rebuildG() {
      G.fill(0);
      for (const f of facets) if (!f.dead && f.cells && f.fill > 0) contrib(f, 1);
    }
    function restore(q) {
      for (let i = 0; i < facets.length; i++) {
        const f = facets[i], s0 = q[i];
        f.aim = s0.aim.slice(); f.fill = s0.fill; f.dead = s0.dead;
        geom(f); setKernel(f);
      }
      rebuildG(); state();
    }

    // ---------------------------------------------------------------- the aims
    const aimCand = [], cosB = [];
    let centroidAim = [0, 0];
    (function () {
      let su = 0, sv = 0, n = 0;
      for (let k = 0; k < nc; k++) if (paint[k] > 0) { const j = (k / Rp) | 0; su += -T.half + ((k % Rp) + 0.5) * cw; sv += -T.half + (j + 0.5) * cw; n++; }
      if (n) centroidAim = [su / n, sv / n];
      // hu/hv only exist after a facet has been placed once — hx0/hy0 are its design size and always exist
      const live = facets.filter((f) => !f.dead);
      const med = live.length ? 0.5 * live.map((f) => f.hx0 + f.hy0).sort((a, b) => a - b)[live.length >> 1] : 2 * cw;
      const step = clamp(Math.round(med / (1.5 * cw)), 1, 6);
      const seen = new Set(), idx = [];
      for (let k = 0; k < nc; k++) if (paint[k] > 0) idx.push(k);
      idx.sort((a, b) => D[b] - D[a]);
      for (const k of idx) {
        const j = (k / Rp) | 0, i = k % Rp;
        const cu = -T.half + (i + 0.5) * cw, cv = -T.half + (j + 0.5) * cw;
        const key = Math.round(cu / (cw * step)) * 8192 + Math.round(cv / (cw * step));
        if (seen.has(key)) continue;
        seen.add(key);
        aimCand.push([cu, cv]);
      }
      for (const a of aimCand) cosB.push(Math.max(0.05, Math.abs(dot(T.n, nrm(sub(aimAt(a[0], a[1]), L))))));
    })();
    // the greedy improvement of aiming f at the aim, as the correlation of its patch with the residual
    function aimScore(f) {
      const a = cel(f.u0) - f.hu / cw, b = cel(f.u0) + f.hu / cw, c = cel(f.v0) - f.hv / cw, d = cel(f.v0) + f.hv / cw;
      const i1 = Math.max(0, Math.floor(a)), i2 = Math.min(Rp - 1, Math.ceil(b)), j1 = Math.max(0, Math.floor(c)), j2 = Math.min(Rp - 1, Math.ceil(d));
      let s = 0;
      for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
        const w = W[j * Rp + i];
        if (!w) continue;
        s += w * R[j * Rp + i] * ovl(a, b, i - 0.5, i + 0.5) * ovl(c, d, j - 0.5, j + 0.5);
      }
      return s;
    }
    // the best aim for f whose patch nothing else has claimed: the residual correlation, pre-filtered with
    // an integral image, with the exact overlap test on the best few (the assignment that keeps the light even)
    function pickAim(f, occ) {
      const II = new Float64Array((Rp + 1) * (Rp + 1));
      for (let j = 0; j < Rp; j++) {
        let row = 0;
        for (let i = 0; i < Rp; i++) { row += W[j * Rp + i] * R[j * Rp + i]; II[(j + 1) * (Rp + 1) + i + 1] = II[j * (Rp + 1) + i + 1] + row; }
      }
      const sc = [];
      for (let ci = 0; ci < aimCand.length; ci++) {
        const i0 = cel(aimCand[ci][0]), j0 = cel(aimCand[ci][1]);
        const hu2 = f.hu / cosB[ci], hv2 = f.hv / cosB[ci];
        const i1 = Math.max(0, Math.floor(i0 - hu2 / cw)), i2 = Math.min(Rp - 1, Math.ceil(i0 + hu2 / cw));
        const j1 = Math.max(0, Math.floor(j0 - hv2 / cw)), j2 = Math.min(Rp - 1, Math.ceil(j0 + hv2 / cw));
        if (i2 < i1 || j2 < j1) continue;
        const s = II[(j2 + 1) * (Rp + 1) + i2 + 1] - II[j1 * (Rp + 1) + i2 + 1] - II[(j2 + 1) * (Rp + 1) + i1] + II[j1 * (Rp + 1) + i1];
        sc.push([s, ci]);
      }
      sc.sort((p, q) => q[0] - p[0]);
      let bestA = null, bestS = -Infinity;
      for (let n = 0; n < Math.min(10, sc.length); n++) {
        const a = aimCand[sc[n][1]];
        const save = { P: f.P, hx: f.hx, hy: f.hy, r: f.r, ex: f.ex, ey: f.ey, hu: f.hu, hv: f.hv, u0: f.u0, v0: f.v0, lvl: f.lvl, di: f.di, cells: f.cells, K: f.K, fill: f.fill, aim: f.aim.slice() };
        f.aim = a; geom(f);
        let over = 0, tot = 0;
        if (!f.dead) for (let z = 0; z < f.cells.length; z++) { over += occ[f.cells[z]] * f.K[z]; tot += f.K[z]; }
        const avail = !f.dead && !(tot > 0 && over / tot > EXCL);
        if (avail && sc[n][0] > bestS) { bestS = sc[n][0]; bestA = a; }
        Object.assign(f, save); f.dead = false; setKernel(f);
      }
      return bestA;
    }
    // re-solve the aims greedily, but only keep a move if the *real* objective (state(), not the
    // linear correlation that picked it) improves — the correlation ignores the quadratic term, so an
    // unguarded hill-climb on it can leave the design worse than it found it
    function reAimRound() {
      let obj = state();
      const II = new Float64Array((Rp + 1) * (Rp + 1));    // integral image of W·R for the pre-filter — one build per
      const buildII = () => {                              // round, it does not depend on which facet is being aimed
        for (let j = 0; j < Rp; j++) {
          let row = 0;
          for (let i = 0; i < Rp; i++) { row += W[j * Rp + i] * R[j * Rp + i]; II[(j + 1) * (Rp + 1) + i + 1] = II[j * (Rp + 1) + i + 1] + row; }
        }
      };
      buildII();
      for (const f of facets) {
        if (f.dead || !f.cells) continue;
        const qc = f.lvl * f.fill;                      // take this facet's light out of the design
        for (let z = 0; z < f.cells.length; z++) { const k = f.cells[z]; G[k] -= qc * f.K[z]; }
        const save = { aim: f.aim.slice(), P: f.P, hx: f.hx, hy: f.hy, r: f.r, ex: f.ex, ey: f.ey, hu: f.hu, hv: f.hv, u0: f.u0, v0: f.v0, lvl: f.lvl, di: f.di, cells: f.cells, K: f.K, fill: f.fill };
        state();
        const sc = [];
        for (let ci = 0; ci < aimCand.length; ci++) {
          const i0 = cel(aimCand[ci][0]), j0 = cel(aimCand[ci][1]);
          const hu2 = f.hu / cosB[ci], hv2 = f.hv / cosB[ci];
          const i1 = Math.max(0, Math.floor(i0 - hu2 / cw)), i2 = Math.min(Rp - 1, Math.ceil(i0 + hu2 / cw));
          const j1 = Math.max(0, Math.floor(j0 - hv2 / cw)), j2 = Math.min(Rp - 1, Math.ceil(j0 + hv2 / cw));
          if (i2 < i1 || j2 < j1) continue;
          const s = II[(j2 + 1) * (Rp + 1) + i2 + 1] - II[j1 * (Rp + 1) + i2 + 1] - II[(j2 + 1) * (Rp + 1) + i1] + II[j1 * (Rp + 1) + i1];
          sc.push([s, ci]);
        }
        sc.sort((p, q) => q[0] - p[0]);
        // exclusion: a patch that lands on a patch another facet already owns is not a home — without it every
        // re-aim runs to the same brightest residual cell and the light piles up in one spot
        const occ = new Float32Array(nc);
        for (const g of facets) {
          if (g === f || g.dead || !g.cells) continue;
          for (let z = 0; z < g.cells.length; z++) occ[g.cells[z]] += 1;
        }
        const tryList = [f.aim.slice()];
        for (let n = 0; n < Math.min(10, sc.length) && tryList.length < 5; n++) {
          const a = aimCand[sc[n][1]];
          f.aim = a; geom(f);
          let over = 0, tot = 0;
          if (!f.dead) for (let z = 0; z < f.cells.length; z++) { over += occ[f.cells[z]] * f.K[z]; tot += f.K[z]; }
          Object.assign(f, save); f.dead = false; setKernel(f);      // restore: the trial is not committed yet
          if (f.dead) continue;
          if (tot > 0 && over / tot > EXCL) continue;
          tryList.push(a);
        }
        f.aim = tryList[0].slice();
        let bestObj = Infinity, best = null, bestA = null;
        for (const a of tryList) {
          f.aim = a; geom(f);
          if (f.dead) continue;
          setKernel(f); f.fill = fitFill(f); contrib(f, 1);
          const o = state();
          if (o < bestObj) { bestObj = o; bestA = a.slice(); best = { P: f.P, hx: f.hx, hy: f.hy, r: f.r, ex: f.ex, ey: f.ey, hu: f.hu, hv: f.hv, u0: f.u0, v0: f.v0, lvl: f.lvl, di: f.di }; }
          for (let z = 0; z < f.cells.length; z++) { const k = f.cells[z]; G[k] -= f.lvl * f.fill * f.K[z]; }
        }
        if (best && bestObj < obj - 1e-9) {
          Object.assign(f, best); f.aim = bestA; f.dead = false; setKernel(f);
          f.fill = fitFill(f); contrib(f, 1); obj = state();
        } else {
          Object.assign(f, save); setKernel(f); f.fill = fitFill(f); contrib(f, 1); obj = state();
        }
      }
      return obj;
    }

    // ---------------------------------------------------------------- run
    // 1) a first placement on the shell
    for (const f of facets) { geom(f); setKernel(f); }
    // 2) assign the aims and fill them, the tightest beams first (a small clip is the most head-on mirror and
    //    the brightest per mm²): each claims the patch nobody else has claimed, where the residual is highest
    state();
    const order = facets.slice().filter((f) => !f.dead).sort((a, b) => (a.hx0 * a.hy0) - (b.hx0 * b.hy0));
    const use = order.slice(0, Math.max(1, Math.round(clamp(+settings.useFrac || 1, 0.02, 1) * order.length)));
    const occ = new Float32Array(nc);
    for (const f of use) {
      const a = pickAim(f, occ);
      if (a) { f.aim = a; geom(f); if (!f.dead) setKernel(f); }
      f.fill = fitFill(f); contrib(f, 1); state();
      for (let z = 0; z < f.cells.length; z++) occ[f.cells[z]] += f.K[z];
    }
    const obj0 = state();
    let bestObj = obj0, best = snap();
    let o = state(); fitAll(); o = state();
    if (o < bestObj) { bestObj = o; best = snap(); }
    const rounds = clamp(+settings.rounds | 0, 0, 12);
    for (let r = 0; r < rounds; r++) {
      reAimRound(); fitAll(); o = state();
      if (o < bestObj) { bestObj = o; best = snap(); }
    }
    restore(best);
    const obj = state();

    // ---------------------------------------------------------------- the safety pass
    // The imaging ellipsoid is NOT parallel to the clip plane: it crosses it, so a clip whose corners sit
    // inside the envelope can still put its curved surface outside it (or dip into the LED clearance).
    // The plane-corner test above is only a first filter — here the real outline is compiled and measured,
    // and anything that pokes out is shrunk and re-fitted until the whole design is legal.
    for (let pass = 0; pass < 10; pass++) {
      const live = facets.filter((f) => !f.dead && f.hx > 0.05 && f.hy > 0.05);
      if (!live.length) break;
      const ss = live.map((f, i) => ({ type: 'facet', id: 'q' + i, P: f.P, S0: L, Z: aimAt(f.aim[0], f.aim[1]), di: f.di, clip: { kind: 'rect', hx: f.hx, hy: f.hy, ref: f.ref }, optics: { interaction: 'reflect', reflectivity: RFL, twoSided: false } }));
      let C = null;
      try { C = Geo.compile(ss); } catch (e) { C = null; }
      if (!C) { for (const f of live) { f.hx *= 0.6; f.hy *= 0.6; setSize(f); } fitAll(); continue; }
      let bad = 0;
      for (let k = 0; k < C.n; k++) {
        const f = live[k];
        let outE = false, outK = false;
        for (const poly of Geo.outline(C, k)) for (const p of poly) {
          if (!Geo.envInside(env, p)) outE = true;
          else if (vlen(sub(p, L)) < keep + 0.35) outK = true;
        }
        if (outE || outK) { bad++; f.hx *= 0.6; f.hy *= 0.6; setSize(f); }
      }
      if (!bad) break;
      fitAll();
    }
    state();

    // ---------------------------------------------------------------- the output
    const surfaces = [], intent = [];
    let n = 0;
    for (const f of facets) {
      f.id = 'f' + (n++);
      if (f.dead || !f.cells || f.fill < 1e-3 || f.hx < 1e-3) continue;
      surfaces.push({
        type: 'facet', id: f.id, group: 'A', P: f.P, S0: L, Z: aimAt(f.aim[0], f.aim[1]),
        clip: { kind: 'rect', hx: f.hx, hy: f.hy, ref: f.ref },
        di: f.di,
        optics: { interaction: 'reflect', reflectivity: RFL, twoSided: false },
      });
      const list = [];
      for (let z = 0; z < f.cells.length; z++) list.push([f.cells[z], f.lvl * f.fill * f.K[z]]);
      list.sort((a, b) => b[1] - a[1]);
      intent.push({ facet: f.id, cells: list.slice(0, 600) });
    }
    const lit = facets.filter((f) => !f.dead && f.fill > 1e-3);
    notes.push(surfaces.length + ' facets of ' + NMAX + ' · kernel ' + ker.cells.toFixed(2) + ' cells (' + ker.mm.toFixed(1) + ' mm) · paint ' + np + ' cells, gap band ' + Math.max(2, Math.ceil(ker.cells) + 2) + ' cells');
    notes.push('model objective ' + obj.toExponential(3) + ' (greedy start ' + obj0.toExponential(3) + ') · mean fill ' + (lit.length ? lit.reduce((s, f) => s + f.fill, 0) / lit.length : 0).toFixed(2) + ' · patches ' + (lit.length ? lit.reduce((s, f) => s + 2 * f.hu, 0) / lit.length : 0).toFixed(0) + '×' + (lit.length ? lit.reduce((s, f) => s + 2 * f.hv, 0) / lit.length : 0).toFixed(0) + ' mm');
    notes.push('first-order shell: modelled catch ' + (100 * lit.reduce((s, f) => s + f.lvl * f.fill, 0) / Math.max(1e-9, src.power * RFL)).toFixed(1) + '% of the LED flux; self-shadowing of a stacked field is not modelled');
  return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-step5preview-r2--facetfit', name: 'Facet fit', version: '2.0', modes: ['paint'],
  settings: STATIC_SETTINGS, solve: solveStatic,
});
// ------------------------------------------------------------------ the tuner
// The appraisal the runner reports, as one number, for each goal.  Every candidate is traced with the same
// seed, so a difference between two of them is geometry, not dice.
function goalScore(goal, tr, P0) {
  if (!tr) return -1;
  if (goal === 'throw') return tr.throwM || 0;
  const e = tr.energy || {};
  if (goal === 'efficient') return ((e.direct || 0) + (e.reflected || 0)) / Math.max(1e-9, P0);
  const f = tr.fidelity || {};
  return (f.fidelity || 0) + 1e-9 * (tr.lmOnTarget || 0);          // tie-break on delivered light, never over fidelity
}

// the settings worth trying for a goal.  dens first: it sets the blotch size against the paint's grid and
// its measured optimum moves with the scene — the default scene peaks near 0.6, the coarser test scene near
// 1.6, delivered flux near 1.2–1.9 — so a tuner has to look rather than assume.
function plans(goal, NMAX) {
  const wide = NMAX <= 150, few = NMAX > 400;
  if (goal === 'throw') return wide ? [{ dens: 0.15 }, { dens: 0.3 }, { dens: 0.6 }, { dens: 1.2 }, { dens: 2 }] : [{ dens: 0.3 }, { dens: 0.6 }, { dens: 1.2 }];
  if (goal === 'efficient') return wide ? (few ? [{ dens: 1.2 }, { dens: 2 }, { dens: 2.8 }] : [{ dens: 0.8 }, { dens: 1.2 }, { dens: 1.6 }, { dens: 2.2 }, { dens: 3 }]) : [{ dens: 1 }, { dens: 1.6 }, { dens: 2.4 }];
  return wide ? (few ? [{ dens: 0.45 }, { dens: 0.8 }, { dens: 1.4 }] : [{ dens: 0.3 }, { dens: 0.45 }, { dens: 0.6 }, { dens: 0.8 }, { dens: 1.2 }, { dens: 1.6 }, { dens: 2.2 }]) : [{ dens: 0.45 }, { dens: 0.7 }, { dens: 1.1 }, { dens: 1.7 }];
}

function solveAuto(input, settings, tools) {
  const t0 = Date.now();
  const goals = ['faithful', 'throw', 'efficient'];
  const goal = goals.indexOf(settings.goal) >= 0 ? settings.goal : 'faithful';
  const lim = input.limits || {}, NMAX = clamp((lim.maxFacets | 0) || 100, 1, 4000);
  const P0 = ((input.sources && input.sources.length ? input.sources : [input.source])
    .reduce((a, s) => a + ((s && s.power) || 0), 0)) || (input.source && input.source.power) || 1;
  const seed = input.seed | 0;
  const rays = clamp(NMAX * 1200, 20000, 200000);
  const trace = tools && typeof tools.trace === 'function' ? tools.trace : null;
  const list = plans(goal, NMAX);
  const notes = ['tuner: goal ' + goal + ' · ' + list.length + ' candidates at ' + (rays / 1e3).toFixed(0) + 'k rays, seed ' + seed + ', ' + NMAX + ' facets allowed'];
  if (trace) {
    let best = null;
    for (let ci = 0; ci < list.length; ci++) {
      const st = Object.assign({}, settings, list[ci]);
      const out = solveStatic(input, st);
      let tr = null, sc = -1;
      try { tr = trace(out.surfaces, { rays, seed }); sc = goalScore(goal, tr, P0); } catch (e) { tr = null; sc = -1; }
      const fid = tr && tr.fidelity ? (100 * tr.fidelity.fidelity).toFixed(1) + '% fidelity' : 'no fidelity';
      const head = !tr ? 'trace failed' : goal === 'throw' ? Math.round(sc) + ' m' : goal === 'efficient' ? (100 * sc).toFixed(1) + '% delivered' : fid;
      notes.push('  dens ' + st.dens + ': ' + head + (tr && goal !== 'faithful' ? ' (' + fid + ')' : ''));
      if (best === null || sc > best.sc) best = { sc, out, tr };
      if (tools && tools.progress) tools.progress((ci + 1) / list.length);
      if (Date.now() - t0 > 40000) { notes.push('tuner stopped after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s'); break; }
    }
    if (best && best.sc >= 0) return { surfaces: best.out.surfaces, intent: best.out.intent, notes: best.out.notes.concat(notes) };
    notes.push('no candidate traced: the static design from the shipped defaults, dens ignored');
  } else notes.push('no tools.trace here: the static design from the shipped defaults, dens ignored');
  const out = solveStatic(input, settings);
  return { surfaces: out.surfaces, intent: out.intent, notes: out.notes.concat(notes) };
}

RF.Solvers.register({
  id: 'bench-step5preview-r2--facetfit-auto', name: 'Facet fit (tuner)', version: '2.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve: solveAuto,
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
