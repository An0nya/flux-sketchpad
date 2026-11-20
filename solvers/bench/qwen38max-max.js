/* Aperture Painter — a static paint solver for Flux.
 *
 * The physics this is built on (measured with this app's own tracer; numbers in solvers/NOTES.md):
 *
 *  1. A curved facet (`flat:false`, `di = |Z-P|`) is the ellipsoid with foci S0 and the aim point Z, so it
 *     images the LED onto the target *at* Z: a patch of width w = ledSize * di / r  [mm], r = LED->facet.
 *     A flat facet does not do this — its spot measured ~6x wider — so every facet here is curved+focused.
 *  2. Flux caught:  Phi = power * refl * cos(theta) * cos(psi) * A / (pi r^2), theta = the LED emission angle
 *     of the facet direction, psi = incidence (= half the bend source->facet->aim), A = aperture area.
 *     Predicted 3.23% vs 3.35% traced for a 20x20 mm facet at r=50; 12.9% vs 13.6% at 40x40 mm.
 *  3. Facets on a shell around the LED block each other: every beam runs toward the target, so a facet that
 *     is downstream of another in the same transverse column steals its light (measured 44% blocked).  Facets
 *     tiled in a plane *perpendicular to the beam* cannot block one another at all, and the flux they catch
 *     is  0.85 * refl * INT cos(theta) cos(psi) / (pi r^2) dA  over the region they tile — independent of how
 *     the region is divided.  So the facet budget buys *aims* (sharpness of the fit), not aperture.
 *  4. Sharpness wants r large, flux wants r small (Phi ~ 1/r^2, w ~ 1/r).  The solver therefore searches a
 *     family of planar layouts (plane depth, inner radius cut) and scores each one with the app's own
 *     fidelity metric applied to the *modelled* delivered grid — no rays, just arithmetic.
 *  5. Aims and weights come from matching pursuit with each facet's own box width, so the flat interior of
 *     the painting takes the near/wide facets and the fine detail takes the far/sharp ones.
 *
 * Nothing here traces: directions, solid angles, apertures, the paint fit and the predicted score are all
 * computed analytically, and the geometry is checked with the engine's own outline/envelope predicates.
 */
RF.Solvers.register({
  id: 'bench-qwen38max-max--aperture-painter',
  name: 'Aperture Painter',
  version: '0.6.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'apFill', label: 'Aperture fill (0..1 of pitch)', type: 'range', min: 0.3, max: 0.98, step: 0.01, default: 0.92 },
    { key: 'rlIters', label: 'Weight-fit iterations', type: 'range', min: 5, max: 200, step: 5, default: 60 },
    { key: 'edgeGap', label: 'Envelope edge gap (mm)', type: 'range', min: 0, max: 4, step: 0.1, default: 0.3 },
    { key: 'refOnPaint', label: 'Reference on-paint share (for the score model)', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.25 },
    { key: 'search', label: 'Layout search (0=off)', type: 'range', min: 0, max: 1, step: 1, default: 1 },
    { key: 'planeS', label: 'Plane depth (fraction of reach, search off)', type: 'range', min: 0, max: 1, step: 0.05, default: 0.1 },
    { key: 'rMinK', label: 'Inner radius cut (x envelope, search off)', type: 'range', min: 0, max: 1.4, step: 0.05, default: 0.5 },
    { key: 'ctMin', label: 'Min cos of LED emission angle (search off)', type: 'range', min: 0.05, max: 0.95, step: 0.05, default: 0.55 },
    { key: 'tau', label: 'Plane normal: 0 = LED axis, 1 = beam (search off)', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'refine', label: 'Layouts given the exact visibility pass', type: 'range', min: 1, max: 12, step: 1, default: 5 },
    { key: 'debug', label: 'Log the candidate layouts', type: 'range', min: 0, max: 1, step: 1, default: 0 },
    { key: 'capK', label: 'Flux cap slack (diagnostic)', type: 'range', min: 1, max: 20, step: 1, default: 1 },
    { key: 'realloc', label: 'Aperture reallocation slack (0 = off)', type: 'range', min: 0, max: 12, step: 1, default: 4 },
    { key: 'rqMin', label: 'Smallest aperture share kept after reallocation', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.45 },
    { key: 'wK', label: 'Modelled spot width multiplier', type: 'range', min: 0.5, max: 3, step: 0.05, default: 1 },
    { key: 'pitchK', label: 'Facet pitch multiplier (fewer, larger facets)', type: 'range', min: 0.6, max: 3, step: 0.05, default: 1 },
  ],

  solve(input, settings, tools) {
    const V = RF.V, Geo = RF.Geo, Eng = RF.Engine, Ph = RF.Photometry;
    const st = Object.assign({
      minDistance: 0, apFill: 0.92, rlIters: 60, edgeGap: 0.3, refOnPaint: 0.25, search: 1, planeS: 0.45, rMinK: 0.5, ctMin: 0.55, tau: 0.5, refine: 5, debug: 0, capK: 1, pitchK: 1, realloc: 4, rqMin: 0.45, wK: 1,
    }, settings || {});
    const notes = [];
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // ---------------------------------------------------------------- inputs
    const env = input.envelope;
    const srcs = (input.sources && input.sources.length ? input.sources : [input.source]);
    const src = srcs[0];
    const S = src.pos.slice();
    const fr = RF.Source.frame(src);
    const power = srcs.reduce((a, s) => a + (s.power || 0), 0) || 1;
    const keep = Math.max(env.keepOut || 0, st.minDistance || 0);
    const N = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity > 0 ? input.limits.reflectivity : 0.9;

    const T = Eng.targetFrame(input.target);
    const res = (input.paint && input.paint.res | 0) || input.target.res | 0;
    const paint = (input.paint && input.paint.cells) || new Float64Array(res * res);
    const cell = 2 * T.half / res;
    // Characteristic source size for the spot model.  A spot is the *image* of the emitter, so what
    // matters for coverage is its area, not its longest side: a 2x0.5 mm die makes a 4:1 elliptical
    // spot, and modelling it as a square of side 2 doubles the blur in the narrow axis.  sqrt(emitting
    // area) is the side of the equal-area square, and is identical to max(w,h) for a square die.
    const sArea = RF.Source.emittingArea ? RF.Source.emittingArea(src) : 0;
    const sSize = Math.max(sArea > 0 ? Math.sqrt(sArea) : (RF.Source.extentSize ? RF.Source.extentSize(src) : 1), 1e-3);

    // ---------------------------------------------------------------- paint window
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9, mass = 0, nPaint = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const v = paint[j * res + i] || 0;
      if (v > 0) { mass += v; nPaint++; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    }
    if (!nPaint) { i0 = j0 = 0; i1 = j1 = res - 1; mass = 1; }
    const pad = Math.max(2, Math.round(res * 0.05));
    i0 = Math.max(0, i0 - pad); j0 = Math.max(0, j0 - pad);
    i1 = Math.min(res - 1, i1 + pad); j1 = Math.min(res - 1, j1 + pad);

    // ---------------------------------------------------------------- the two directions that matter
    // Every facet must see the LED (its emission is cos-weighted about fr.a) and see the target (T.C).  The
    // layout plane's normal interpolates between those two: square to the LED it catches the most light but
    // the reflected beams run along the plane and eat each other; square to the beam nothing is blocked but
    // the plane is edge-on to the LED and the mirrors shade one another.  The search picks the compromise.
    const bhat = V.norm(V.sub(T.C, S));

    // largest half-aperture whose four corners stay inside the envelope (exact for a box, bisected otherwise)
    const eC = env.center, eH = env.half;
    const cornerIn = (P, ex, ey, h) => {
      for (let s = 0; s < 4; s++) {
        const sx = (s & 1) ? h : -h, sy = (s & 2) ? h : -h;
        if (!Geo.envInside(env, [P[0] + sx * ex[0] + sy * ey[0], P[1] + sx * ex[1] + sy * ey[1], P[2] + sx * ex[2] + sy * ey[2]], 0)) return false;
      }
      return true;
    };
    const hFit = (P, ex, ey) => {
      if (env.shape === 'box') {
        let h = Infinity;
        for (let k = 0; k < 3; k++) {
          const m = eH[k] - st.edgeGap - Math.abs(P[k] - eC[k]), sp = Math.abs(ex[k]) + Math.abs(ey[k]);
          if (m <= 0) return 0;
          const hh = sp > 1e-9 ? m / sp : 1e6;
          if (hh < h) h = hh;
        }
        return h;
      }
      let lo = 0, hi = 40;
      if (cornerIn(P, ex, ey, hi)) return hi;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (cornerIn(P, ex, ey, m)) lo = m; else hi = m; }
      return lo;
    };

    // ---------------------------------------------------------------- layout: a plane of facets, transverse to the beam
    const EXT = 1.7 * Math.max(env.half[0], env.half[1], env.half[2]);
    function layout(tau, sFrac, rMin, ctMin, pitchK) {
      const mh = tau <= 0.002 ? fr.a.slice() : (tau >= 0.998 ? bhat.slice() : V.norm(V.add(V.mul(fr.a, 1 - tau), V.mul(bhat, tau))));
      const rr = Geo.envInterval(env, S, mh);
      const lo = Math.max(rr[0] + 0.4, keep + 0.4), hi = rr[1] - 0.4;
      if (!(hi > lo + 0.5)) return null;
      const s = lo + (hi - lo) * sFrac;
      const e1 = V.norm(V.cross(mh, Math.abs(mh[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = V.cross(mh, e1);
      const at = (u, v) => [S[0] + s * mh[0] + u * e1[0] + v * e2[0], S[1] + s * mh[1] + u * e1[1] + v * e2[1], S[2] + s * mh[2] + u * e1[2] + v * e2[2]];
      // region extent in the plane
      let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity, area = 0;
      const SCAN = 72, du = 2 * EXT / SCAN;
      const inside = (u, v) => {
        const P = at(u, v), r = V.dist(P, S);
        if (r < rMin || r < 1e-6) return 0;
        const d = V.mul(V.sub(P, S), 1 / r);
        if (V.dot(d, fr.a) < ctMin) return 0;
        return r;
      };
      for (let a = 0; a <= SCAN; a++) for (let b = 0; b <= SCAN; b++) {
        const u = -EXT + 2 * EXT * a / SCAN, v = -EXT + 2 * EXT * b / SCAN;
        if (!inside(u, v)) continue;
        if (!Geo.envInside(env, at(u, v), 0)) continue;
        area += du * du;
        if (u < uLo) uLo = u; if (u > uHi) uHi = u; if (v < vLo) vLo = v; if (v > vHi) vHi = v;
      }
      if (!(area > 0)) return null;
      // pitch that spends the whole facet budget on this region
      let p = (pitchK > 0 ? pitchK : 1) * Math.sqrt(area / N);
      let pts = [];
      for (let pass = 0; pass < 8; pass++) {
        pts = [];
        const nu = Math.floor((uHi - uLo) / p) + 1, nv = Math.floor((vHi - vLo) / p) + 1;
        const ou = (uLo + uHi) / 2 - (nu - 1) * p / 2, ov = (vLo + vHi) / 2 - (nv - 1) * p / 2;
        for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
          const u = ou + a * p, v = ov + b * p;
          const r = inside(u, v);
          if (!r) continue;
          const P = at(u, v);
          const d = V.mul(V.sub(P, S), 1 / r), ct = V.dot(d, fr.a);
          const toT = V.sub(T.C, P), L = V.len(toT);
          if (!(L > 1)) continue;
          const ah = V.mul(toT, 1 / L);
          const sinPsi = Math.sqrt(Math.max(0.02, (1 - V.dot(d, ah)) / 2));   // |n.d|: the aperture as the LED and the target both see it
          const n = V.norm(V.add(V.mul(d, -1), ah));
          const ex = V.inPlane(n, T.tu), ey = V.cross(n, ex);
          const h = Math.min(0.5 * st.apFill * p, hFit(P, ex, ey));
          if (h < 0.35) continue;
          pts.push({ P, r, ct, sinPsi, L, h, n, ex, ey, s, u, v, ga: a, gb: b, phiMax: power * refl * ct * sinPsi * 4 * h * h / (Math.PI * r * r) });
        }
        if (pts.length <= N) break;
        p *= Math.sqrt(pts.length / N) * 1.01;
      }
      if (pts.length > N) pts.sort((a, b) => b.phiMax - a.phiMax).length = N;
      if (!pts.length) return null;
      return { s, tau, sFrac, rMin, ctMin, pitch: p, facets: pts, area };
    }

    // ---------------------------------------------------------------- paint fit: aim grid + Richardson-Lucy weights
    const erf0 = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
    const D = new Float64Array(res * res);
    const prof = (c, w) => {
      const h = w / 2, lo = Math.max(0, Math.floor(c - h)), hi = Math.min(res - 1, Math.ceil(c + h));
      const out = [];
      let s = 0;
      for (let q = lo; q <= hi; q++) { const v = Math.min(c + h, q + 1) - Math.max(c - h, q); if (v > 1e-9) { out.push(q, v); s += v; } }
      for (let q = 0; q < out.length; q += 2) out[q + 1] /= s;
      return out;
    };
    const kernelOf = (cx, cy, w) => {
      const px = prof(cx, w), py = prof(cy, w), idx = [], kv = [];
      for (let q = 0; q < py.length; q += 2) { const j = py[q], vy = py[q + 1]; for (let k = 0; k < px.length; k += 2) { idx.push(j * res + px[k]); kv.push(vy * px[k + 1]); } }
      return { idx: Int32Array.from(idx), kv: Float64Array.from(kv) };
    };
    // prefix sums of the painting and of its square (block mean / contrast, used to place the aims)
    const SW = res + 1, pS = new Float64Array(SW * SW), pS2 = new Float64Array(SW * SW);
    for (let j = 0; j < res; j++) {
      let a = 0, b = 0;
      for (let i = 0; i < res; i++) {
        const v = paint[j * res + i] || 0; a += v; b += v * v;
        pS[(j + 1) * SW + i + 1] = a + pS[j * SW + i + 1];
        pS2[(j + 1) * SW + i + 1] = b + pS2[j * SW + i + 1];
      }
    }
    const boxOf = (S, cx, cy, w) => {
      const h = w / 2;
      let a = Math.max(0, Math.round(cx - h)), b = Math.min(res, Math.round(cx + h)), c = Math.max(0, Math.round(cy - h)), d = Math.min(res, Math.round(cy + h));
      if (b <= a || d <= c) return { sum: 0, n: 0 };
      return { sum: S[d * SW + b] - S[c * SW + b] - S[d * SW + a] + S[c * SW + a], n: (b - a) * (d - c) };
    };
    const blockMean = (cx, cy, w) => { const b = boxOf(pS, cx, cy, w); return b.n ? b.sum / b.n : 0; };
    const blockVar = (cx, cy, w) => {
      const b1 = boxOf(pS, cx, cy, w), b2 = boxOf(pS2, cx, cy, w);
      if (!b1.n) return 0;
      const m = b1.sum / b1.n;
      return Math.max(0, b2.sum / b1.n - m * m);
    };

    const fakeScene = { source: src, target: input.target, envelope: env, modeA: { paint: paint } };
    const fakeP = { res: res, power: power };
    const fakeCtx = { gridD: D, gridR: new Float64Array(res * res), N: 1e6, next: 1e6, E: { emitted: power, direct: 0, reflected: power } };

    function fit(lay, capOverride) {
      const wK = st.wK > 0 ? st.wK : 1;
      const F = lay.facets;
      let fluxTot = 0;
      for (const f of F) { f.w = Math.max(0.4, wK * sSize * f.L / (f.r * cell)); fluxTot += f.phiMax; }
      if (!(fluxTot > 0) || !(mass > 0)) return null;

      // 1. aim grid: spacing chosen so the aims that carry paint number about the facets available
      let d = Math.sqrt(Math.max(1, nPaint) / F.length), aims = [];
      for (let pass = 0; pass < 12; pass++) {
        aims = [];
        d = Math.max(0.6, d);
        const nu = Math.floor((i1 - i0) / d) + 1, nv = Math.floor((j1 - j0) / d) + 1;
        const ou = (i0 + i1) / 2 - (nu - 1) * d / 2, ov = (j0 + j1) / 2 - (nv - 1) * d / 2;
        for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
          const cx = ou + a * d, cy = ov + b * d;
          const m = blockMean(cx, cy, Math.max(d, 1.2));
          if (m > 1e-6) aims.push({ cx, cy, m, detail: Math.sqrt(blockVar(cx, cy, 6)) + 0.15 * m });
        }
        if (aims.length <= F.length) break;
        d *= Math.sqrt(aims.length / F.length) * 1.03;
      }
      if (!aims.length) return null;

      // 2. pair the sharpest facets with the most detailed aims
      aims.sort((a, b) => b.detail - a.detail);
      const bySharp = F.slice().sort((a, b) => a.w - b.w);
      const M = Math.min(aims.length, bySharp.length), use = [];
      for (let i = 0; i < M; i++) {
        const f = bySharp[i], a = aims[i];
        f.aim = [a.cx, a.cy]; f.K = kernelOf(a.cx, a.cy, f.w); f.phi = 0.5 * f.phiMax;
        use.push(f);
      }
      for (let i = M; i < F.length; i++) { F[i].aim = null; F[i].phi = 0; }

      // 3. Richardson-Lucy: non-negative weights, capped at what each facet can catch
      const scale = fluxTot / mass, eps = 1e-6 * fluxTot / (res * res), capK = capOverride > 0 ? capOverride : (st.capK > 0 ? st.capK : 1);
      const iters = st.rlIters | 0;
      for (let it = 0; it < iters; it++) {
        D.fill(0);
        for (const f of use) { const I = f.K.idx, Kv = f.K.kv; for (let k = 0; k < I.length; k++) D[I[k]] += f.phi * Kv[k]; }
        for (const f of use) {
          const I = f.K.idx, Kv = f.K.kv;
          let num = 0, den = 0;
          for (let k = 0; k < I.length; k++) { const v = Kv[k]; num += v * (paint[I[k]] || 0) * scale / Math.max(D[I[k]], eps); den += v; }
          if (den > 0) f.phi = Math.max(0, Math.min(f.phiMax * capK, f.phi * num / den));
        }
      }
      D.fill(0);
      let phi = 0;
      for (const f of use) { phi += f.phi; const I = f.K.idx, Kv = f.K.kv; for (let k = 0; k < I.length; k++) D[I[k]] += f.phi * Kv[k]; }

      // 4. predicted score, with the app's own fidelity metric on the modelled grid
      let fd = null;
      try { fd = Ph.fidelity(fakeScene, fakeP, fakeCtx); } catch (e) { fd = null; }
      const onPaint = fd ? fd.onPaint : 0;
      // Delivery-error margin.  A facet's realised flux differs from its intent (measured p5/p95 of
      // delivered÷intended is ~0.3/1.9), and a painted cell is covered by ~(w/d)^2 facets, so those
      // errors partly average out.  Where the spots are no wider than the aim spacing there is nothing
      // to average and the modelled fit cannot be realised -- which is exactly how a coarse layout of
      // big facets fools a model that only ever sees perfect boxes.
      let wSum = 0;
      for (const f of use) wSum += f.w;
      const wMed = use.length ? wSum / use.length : 1, dd = Math.max(0.5, d);
      const cov = Math.max(0.05, (wMed / dd) * (wMed / dd));
      const rob = erf0(0.223 * Math.sqrt(cov) / (0.6 * Math.SQRT2));
      let fidR = fd ? fd.fidelity : 0;
      if (fd) { const W = fd.within * Math.min(1, rob), Gd = fd.gapsDark; fidR = W + Gd > 0 ? 2 * W * Gd / (W + Gd) : 0; }
      const light = Math.min(1, onPaint / (0.1 * st.refOnPaint));
      const Fsc = fidR * light;
      const g = Math.max(0, Math.min(1, (Fsc - 0.5) / 0.25));
      const X = 0.7 * Math.min(2, onPaint / st.refOnPaint) / 2 + 0.3 * 0.5;
      const used = use.filter((f) => f.phi > 1e-9).length;
      const score = Fsc + g * 0.5 * X + light * 0.02 * (1 - used / N);
      return { score, fid: fidR, fidRaw: fd ? fd.fidelity : 0, within: fd ? fd.within : 0, gaps: fd ? fd.gapsDark : 0, rob: Math.min(1, rob), onPaint, phi, used, aims: aims.length, d };
    }


    // ---------------------------------------------------------------- exact visibility, with the engine's own geometry
    // A facet that shades a neighbour from the LED, or sits in a neighbour's beam, delivers less than its cone
    // holds.  Both are pure geometry: compile the mirror set and intersect the two straight lines every facet
    // needs (LED -> aperture, aperture -> aim).  No photons are sampled, no tracing.
    function aimOf(f) {
      if (f.aim) {
        const uu = -T.half + (f.aim[0] + 0.5) * cell, vv = -T.half + (f.aim[1] + 0.5) * cell;
        return Eng.targetUVtoWorld(T, uu, vv);
      }
      return T.C.slice();
    }
    function surfOf(f, i) {
      const Z = aimOf(f);
      return {
        type: 'facet', id: 'V' + i, group: 'A', P: f.P.slice(), S0: S.slice(), Z, flat: false, di: V.dist(Z, f.P),
        clip: { kind: 'rect', hx: f.h, hy: f.h, ref: T.tu.slice() },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      };
    }
    function firstHit(G, ox, oy, oz, dx, dy, dz, tmax) {
      const bvh = G.bvh;
      if (!bvh) {
        let bk = -1, bt = tmax;
        for (let k = 0; k < G.n; k++) { const t = Geo.intersect(G.D, G.poly, k, ox, oy, oz, dx, dy, dz, 1e-4, bt); if (t >= 0 && t < bt) { bt = t; bk = k; } }
        return bk;
      }
      const { bmin, bmax, left, right, start, count, items } = bvh, stk = FH_STACK;
      const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
      let sp = 0, bk = -1, bt = tmax;
      stk[sp++] = 0;
      while (sp > 0) {
        const nd = stk[--sp], b3 = 3 * nd;
        let t1 = (bmin[b3] - ox) * ix, t2 = (bmax[b3] - ox) * ix, tn = t1 < t2 ? t1 : t2, tf = t1 > t2 ? t1 : t2;
        t1 = (bmin[b3 + 1] - oy) * iy; t2 = (bmax[b3 + 1] - oy) * iy;
        const a1 = t1 < t2 ? t1 : t2, a2 = t1 > t2 ? t1 : t2; if (a1 > tn) tn = a1; if (a2 < tf) tf = a2;
        t1 = (bmin[b3 + 2] - oz) * iz; t2 = (bmax[b3 + 2] - oz) * iz;
        const b1 = t1 < t2 ? t1 : t2, b2 = t1 > t2 ? t1 : t2; if (b1 > tn) tn = b1; if (b2 < tf) tf = b2;
        if (!(tf >= tn) || tf < 1e-4 || tn > bt) continue;
        if (left[nd] < 0) {
          for (let q = start[nd], q1 = q + count[nd]; q < q1; q++) {
            const k = items[q];
            const t = Geo.intersect(G.D, G.poly, k, ox, oy, oz, dx, dy, dz, 1e-4, bt);
            if (t >= 0 && t < bt) { bt = t; bk = k; }
          }
        } else { stk[sp++] = left[nd]; stk[sp++] = right[nd]; }
      }
      return bk;
    }
    const FH_STACK = new Int32Array(256);

    // Fraction of each aperture that both sees the LED and has a clear run to its aim, and the aperture scale
    // that maximises the usable flux.  h^2 grows with the aperture, visibility falls as neighbours get in the
    // way; the product is what the facet can actually deliver.
    // ---------------------------------------------------------------- aperture reallocation
    // What limits the fit is not the aim grid but how much light each facet can catch: with the caps
    // relaxed the same facets model ~10 points more fidelity.  Aperture area is a shared budget (the
    // facets tile the region), so move it from the slack facets to the pinned ones, keeping the grid
    // from overlapping itself.
    function reallocate(lay, slack, rqMin) {
      const F = lay.facets, p = lay.pitch;
      if (F.length < 4 || !(p > 0) || F[0].ga === undefined) return false;
      const ideal = fit(lay, slack);            // same total flux, per-facet caps relaxed
      if (!ideal) return false;
      let need = 0, have = 0;
      for (const f of F) {
        f.rq = Math.sqrt(Math.max(1e-9, f.phi) / Math.max(1e-12, f.phiMax));
        if (!(f.rq < 2.2)) f.rq = 2.2;
        if (f.rq < rqMin) f.rq = rqMin;
        need += f.rq * f.rq * f.h * f.h; have += f.h * f.h;
      }
      if (!(need > 0) || !(have > 0)) return false;
      const k = Math.sqrt(have / need), at = {}, hMax = 0.495 * p;
      for (const f of F) { f.h2 = Math.max(0.15, f.h * f.rq * k); at[f.ga * 8192 + f.gb] = f; }
      for (let pass = 0; pass < 8; pass++) {
        let moved = 0;
        for (const f of F) {
          if (f.h2 > hMax) { f.h2 = hMax; moved++; }
          for (let q = 0; q < 2; q++) {
            const g = at[(f.ga + (q ? 0 : 1)) * 8192 + f.gb + (q ? 1 : 0)];
            if (!g) continue;
            const sum = f.h2 + g.h2;
            if (sum > p * 0.99) { const sc2 = p * 0.99 / sum; f.h2 *= sc2; g.h2 *= sc2; moved++; }
          }
        }
        if (!moved) break;
      }
      let changed = 0;
      for (const f of F) {
        if (Math.abs(f.h2 - f.h) > 0.03) changed++;
        f.h = f.h2;
        f.phiMax = power * refl * f.ct * f.sinPsi * 4 * f.h * f.h * (f.vis === undefined ? 1 : f.vis) / (Math.PI * f.r * f.r);
      }
      return changed > 0;
    }

    function visScale(list, fine) {
      const hBase = list.map((f) => f.h);
      let bestK = 1, bestTot = -1, bestState = null;
      const SAMP = fine ? [-0.62, 0, 0.62] : [0];
      for (const k of (fine ? [1, 0.7, 0.45] : [1])) {
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          f.h = hBase[i] * k;
          f.phiMax = power * refl * f.ct * f.sinPsi * 4 * f.h * f.h / (Math.PI * f.r * f.r);
        }
        let G;
        try { G = Geo.compile(list.map(surfOf)); } catch (e) { break; }
        let tot = 0;
        const state = [];
        for (let i = 0; i < list.length; i++) {
          const f = list[i], Z = aimOf(f);
          let ok = 0, n = 0;
          for (let a = 0; a < SAMP.length; a++) for (let b = 0; b < SAMP.length; b++) {
            const sa = SAMP[a] * f.h, sb = SAMP[b] * f.h;
            const qx = f.P[0] + sa * f.ex[0] + sb * f.ey[0], qy = f.P[1] + sa * f.ex[1] + sb * f.ey[1], qz = f.P[2] + sa * f.ex[2] + sb * f.ey[2];
            n++;
            let dx = qx - S[0], dy = qy - S[1], dz = qz - S[2];
            let t = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!(t > 1e-3)) continue;
            if (firstHit(G, S[0], S[1], S[2], dx / t, dy / t, dz / t, t - 0.4) !== -1) continue;
            dx = Z[0] - qx; dy = Z[1] - qy; dz = Z[2] - qz;
            t = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!(t > 1)) continue;
            if (firstHit(G, qx + 0.05 * f.n[0], qy + 0.05 * f.n[1], qz + 0.05 * f.n[2], dx / t, dy / t, dz / t, t - 1) !== -1) continue;
            ok++;
          }
          f.vis = n ? ok / n : 0;
          f.phiMax *= f.vis;
          tot += f.phiMax;
          state.push([f.h, f.phiMax, f.vis]);
        }
        if (tot > bestTot) { bestTot = tot; bestK = k; bestState = state; }
      }
      for (let i = 0; i < list.length; i++) { list[i].h = bestState[i][0]; list[i].phiMax = bestState[i][1]; list[i].vis = bestState[i][2]; }
      const out = list.filter((f) => f.vis > 0.04 && f.h >= 0.3);
      for (const f of out) f.phiMax = power * refl * f.ct * f.sinPsi * 4 * f.h * f.h * f.vis / (Math.PI * f.r * f.r);
      out.hScale = bestK;
      return out;
    }

    // ---------------------------------------------------------------- search the layout family
    let best = null, bestFit = null, tried = 0;
    const rScale = Math.max(env.half[0], env.half[1], env.half[2]);
    const tList = st.search ? [0.2, 0.5, 0.8] : [st.tau];
    const sList = st.search ? [0.4, 0.75] : [st.planeS];
    const rList = st.search ? [0, 0.7, 1.3] : [st.rMinK];
    const cList = st.search ? [0.3, 0.55] : [st.ctMin];   // 0.78 was tried: it wins the model but traces worse on test (39.9 vs 42.7)
    const pList = st.search ? [1, 1.4, 1.85] : [st.pitchK];
    const combos = [];
    for (const tu of tList) for (const sf of sList) for (const rk of rList) for (const cm of cList) for (const pk of pList) combos.push([tu, sf, rk, cm, pk]);
    const scored = [];
    for (const [tu, sf, rk, cm, pk] of combos) {
      const lay = layout(tu, sf, Math.max(keep + 0.8, rk * rScale), cm, pk);
      tried++;
      if (tools && tools.progress) tools.progress(0.05 + 0.5 * tried / combos.length);
      if (!lay || lay.facets.length < 3) continue;
      const F1 = visScale(lay.facets, false);          // centre-point visibility: cheap, keeps stage 1 honest
      if (F1.length < 3) continue;
      const lay1 = Object.assign({}, lay, { facets: F1 });
      const f = fit(lay1);
      if (f) { f.row = 'tau ' + tu.toFixed(2) + ' s ' + lay1.s.toFixed(1) + ' rMin ' + Math.max(keep + 0.8, rk * rScale).toFixed(0) + ' ct ' + cm.toFixed(2) + ' pk ' + pk.toFixed(2) + ' n ' + F1.length + ' area ' + lay1.area.toFixed(0) + ' p ' + lay1.pitch.toFixed(2) + ' flux ' + (100 * f.phi / power).toFixed(1) + '%'; scored.push({ lay: lay1, f }); }
    }
    scored.sort((a, b) => b.f.score - a.f.score);
    // the best few get the exact visibility pass: apertures shrink until no facet shades or blocks another
    const top = scored.slice(0, Math.max(1, st.refine | 0));
    const refined = [];
    for (let ci = 0; ci < top.length; ci++) {
      const c = top[ci];
      let lay2 = c.lay, f2 = null;
      for (let pass = 0; pass < 2; pass++) {           // pass 2 sees the real aims, so beam blocking is exact
        const F2 = visScale(lay2.facets, true);
        if (F2.length < 3) { f2 = null; break; }
        lay2 = Object.assign({}, lay2, { facets: F2 });
        f2 = fit(lay2);
        if (!f2) break;
      }
      if (f2 && st.realloc) {
        const before = f2.fid, h0 = lay2.facets.map((f) => f.h);
        if (reallocate(lay2, st.realloc, st.rqMin)) {
          const f3 = fit(lay2);
          if (f3) {
            if (st.debug) {
              const hh = lay2.facets.map((f) => f.h).sort((a, b) => a - b);
              notes.push('  realloc: fid ' + (100 * before).toFixed(1) + ' -> ' + (100 * f3.fid).toFixed(1) + '% (within ' + (100 * f3.within).toFixed(1) + ' gaps ' + (100 * f3.gaps).toFixed(1) + ') h ' + hh[0].toFixed(2) + '-' + hh[hh.length - 1].toFixed(2) + ' was ' + Math.min.apply(null, h0).toFixed(2) + '-' + Math.max.apply(null, h0).toFixed(2));
            }
            f2 = f3;
          }
        }
      }
      if (f2) { f2.row = c.f.row + ' -> vis ' + (100 * (lay2.facets.reduce((a, f) => a + (f.vis || 0), 0) / lay2.facets.length)).toFixed(0) + '% n ' + lay2.facets.length; }
      if (f2 && (!bestFit || f2.score > bestFit.score)) { best = lay2; bestFit = f2; refined.push(f2); }
      if (tools && tools.progress) tools.progress(0.6 + 0.35 * (ci + 1) / top.length);
    }
    if (!best && scored.length) { best = scored[0].lay; bestFit = scored[0].f; }
    if (!best) return { surfaces: [], intent: [], notes: ['no layout fitted inside the envelope'] };

    // ---------------------------------------------------------------- build the surfaces
    const surfaces = [], intent = [];
    let placed = 0;
    for (const f of best.facets) {
      if (!f.aim || !(f.phi > 0)) continue;
      const uu = -T.half + (f.aim[0] + 0.5) * cell, vv = -T.half + (f.aim[1] + 0.5) * cell;
      const Z = Eng.targetUVtoWorld(T, uu, vv);
      const di = V.dist(Z, f.P);
      const h = Math.max(0.2, f.h * Math.sqrt(Math.min(1, f.phi / Math.max(1e-12, f.phiMax))));
      const id = 'F' + (placed++);
      surfaces.push({
        type: 'facet', id, group: 'A', P: f.P.slice(), S0: S.slice(), Z: Z.slice(),
        flat: false, di,
        clip: { kind: 'rect', hx: h, hy: h, ref: T.tu.slice() },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      const cells = [];
      const w = Math.max(0.4, sSize * di / (f.r * cell));
      const px = prof(f.aim[0], w), py = prof(f.aim[1], w);
      for (let q = 0; q < py.length; q += 2) { const j = py[q], vy = py[q + 1]; for (let k2 = 0; k2 < px.length; k2 += 2) { const wgt = f.phi * vy * px[k2 + 1]; if (wgt > 1e-12) cells.push([j * res + px[k2], wgt]); } }
      intent.push({ facet: id, cells });
    }
    if (!surfaces.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };

    // ---------------------------------------------------------------- exact fit check (the engine's own outline)
    const tol = 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
    const fitOK = (s) => {
      let G;
      try { G = Geo.compile([s]); } catch (e) { return false; }
      for (let k = 0; k < G.n; k++) for (const poly of Geo.outline(G, k)) for (const p of poly) {
        if (!Geo.envInside(env, p, tol)) return false;
        if (keep > 0 && V.dist(p, S) < keep) return false;
      }
      return true;
    };
    let trims = 0;
    for (let pass = 0; pass < 8; pass++) {
      let bad = 0;
      for (const s of surfaces) if (!fitOK(s)) { s.clip.hx *= 0.85; s.clip.hy *= 0.85; trims++; bad++; }
      if (!bad) break;
    }
    const finalList = [], finalIntent = [];
    for (let idx = 0; idx < surfaces.length; idx++) {
      if (fitOK(surfaces[idx])) { finalList.push(surfaces[idx]); finalIntent.push(intent[idx]); }
      else finalIntent.push({ facet: null, cells: [] });
    }

    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    let rMin = 1e9, rMax = 0, wMin = 1e9, wMax = 0, hMin = 1e9, hMax = 0, visAvg = 0, visN = 0;
    for (const f of best.facets) if (f.phi > 0) {
      visAvg += (f.vis === undefined ? 1 : f.vis); visN++;
      rMin = Math.min(rMin, f.r); rMax = Math.max(rMax, f.r);
      const w = sSize * f.L / (f.r * cell); wMin = Math.min(wMin, w); wMax = Math.max(wMax, w);
      hMin = Math.min(hMin, f.h); hMax = Math.max(hMax, f.h);
    }
    notes.push('plane ' + best.s.toFixed(1) + ' mm out, normal ' + best.tau.toFixed(2) + ' (0=LED axis, 1=beam), pitch ' + best.pitch.toFixed(2) + ' mm, ' + finalList.length + '/' + N + ' facets (' + tried + ' layouts searched)');
    notes.push('model: fidelity ' + (100 * bestFit.fid).toFixed(1) + '% (within ' + (100 * bestFit.within).toFixed(1) + '%, gaps ' + (100 * bestFit.gaps).toFixed(1) + '%), delivery margin ' + bestFit.rob.toFixed(2) + ', on paint ' + (100 * bestFit.onPaint).toFixed(1) + '%, predicted score ' + bestFit.score.toFixed(3));
    visAvg = visN ? visAvg / visN : 0;
    notes.push('mean aperture visibility ' + (100 * visAvg).toFixed(0) + '% (sees the LED and has a clear run to its aim)');
    notes.push('r ' + rMin.toFixed(0) + '-' + rMax.toFixed(0) + ' mm, aperture ' + (2 * hMin).toFixed(1) + '-' + (2 * hMax).toFixed(1) + ' mm, spot ' + wMin.toFixed(1) + '-' + wMax.toFixed(1) + ' cells');
    if (trims) notes.push(trims + ' aperture trims to stay inside the envelope');
    if (st.debug) {
      const rows = refined.concat(scored.map((c) => c.f)).slice(0, 60);
      rows.sort((a, b) => b.score - a.score);
      for (const r of rows.slice(0, 40)) notes.push('  cand ' + r.row + ' | fid ' + (100 * r.fid).toFixed(1) + '% (raw ' + (100 * r.fidRaw).toFixed(1) + ' rob ' + r.rob.toFixed(2) + ') onP ' + (100 * r.onPaint).toFixed(1) + '% score ' + r.score.toFixed(3));
    }
    notes.push('solve ' + ms.toFixed(0) + ' ms');
    if (tools && tools.progress) tools.progress(1);
    return { surfaces: finalList, intent: finalIntent, notes };
  },
});

/* ================================================================================================
 * aperture-painter-auto — the optional tuner (TASK.md step 3).
 *
 * The static solver above picks a layout from a *model* of the optics (box kernels, an estimated
 * visibility, an estimated flux cap).  Three of its choices are genuinely ambiguous on the model and
 * only a trace can settle them:
 *   · aperture reallocation trades delivered flux for fidelity (measured: 9.9% → 5.3% delivered for
 *     +3.3 points of fidelity on the default scene) — which way to go depends on the goal;
 *   · the modelled spot width is 1.2–1.6× narrower than the real one, and widening it changes both
 *     the fit and the layout the search picks;
 *   · the facet pitch (fewer, larger facets) trades aim resolution against flux.
 * So this solver runs the static one over a small fixed list of settings, traces each with the SAME
 * seed (common random numbers: the differences are geometry, not dice) and keeps the best for the
 * goal.  It never invents geometry of its own, so every hard constraint the static solver respects
 * (envelope, LED clearance, maxFacets, well-formed intent) is respected here too.
 * ================================================================================================= */
RF.Solvers.register({
  id: 'bench-qwen38max-max--aperture-painter-auto',
  name: 'Aperture Painter (tuner)',
  version: '0.6.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful', help: 'faithful = the painting (the scored formula); throw = peak intensity / distance; efficient = light on the painting' },
    { key: 'trials', label: 'Designs traced per solve', type: 'range', min: 1, max: 12, step: 1, default: 9 },
    { key: 'raysPerTrial', label: 'Rays per trial (0 = share the budget)', type: 'range', min: 0, max: 2000000, step: 10000, default: 0 },
    { key: 'refOnPaint', label: 'Reference on-paint share (score model)', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.25 },
  ],

  solve(input, settings, tools) {
    const st = Object.assign({ minDistance: 0, goal: 'faithful', trials: 9, raysPerTrial: 0, refOnPaint: 0.25 }, settings || {});
    const notes = [];
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const base = RF.Solvers.get('bench-qwen38max-max--aperture-painter');
    const budget = (tools && tools.budget) || { ms: 60000, rays: 2e7 };

    // Fixed candidate lists: settings patches on top of the static solver's own defaults.  Order is
    // the tie-break, so the first entry is the static default and a tie never changes the answer.
    const PLANS = {
      faithful: [{}, { realloc: 0 }, { realloc: 8, rqMin: 0.6 }, { realloc: 4, rqMin: 0.3 }, { wK: 1.3 },
        { wK: 1.3, realloc: 0 }, { apFill: 0.8 }, { pitchK: 1.4 }, { refOnPaint: 0.12 }, { realloc: 2, apFill: 0.98 },
        { wK: 0.85, realloc: 6 }, { pitchK: 0.8 }],
      throw: [{ pitchK: 1.85, realloc: 0 }, { pitchK: 1.4, realloc: 0 }, { realloc: 0, apFill: 0.98 },
        { pitchK: 1.85, realloc: 0, apFill: 0.98 }, {}, { pitchK: 2.4, realloc: 0 }, { realloc: 8, rqMin: 0.6 },
        { pitchK: 1.4 }, { apFill: 0.8 }, { wK: 1.3, realloc: 0 }, { pitchK: 3, realloc: 0 }, { ctMin: 0.8, search: 0, tau: 0.5, planeS: 0.6 }],
      efficient: [{ realloc: 0, apFill: 0.98 }, { realloc: 0 }, { realloc: 2, rqMin: 0.7 }, { apFill: 0.98 },
        {}, { pitchK: 1.4, realloc: 0 }, { rMinK: 1.0 }, { realloc: 4, rqMin: 0.45 }, { pitchK: 0.8, realloc: 0 },
        { wK: 1.3, realloc: 0 }, { ctMin: 0.3, realloc: 0 }, { refOnPaint: 0.12 }],
    };
    const plan = (PLANS[st.goal] || PLANS.faithful).slice(0, Math.max(1, st.trials | 0));
    const perRays = st.raysPerTrial > 0 ? st.raysPerTrial
      : Math.max(40000, Math.min(1000000, Math.floor((budget.rays || 2e7) / (plan.length * 1.5))));
    // Trace each trial at the scored ray count if the budget allows: at 400k the fidelity metric is
    // noise-biased (the exposure fit amplifies relative noise in the gap cells) and the tuner then
    // ranks designs differently than the scorer does -- measured on led-back, where a 400k pick cost
    // 4 points of fidelity at 1M.

    const canTrace = !!(tools && typeof tools.trace === 'function');
    if (!canTrace || !base) {                       // no tracer (or no static solver): behave like the static one
      const out = base ? base.solve(input, Object.assign({}, settings, { minDistance: st.minDistance }), tools) : { surfaces: [], intent: [], notes: [] };
      out.notes = (out.notes || []).concat('auto: no tools.trace available — returned the static design untuned');
      return out;
    }

    const trials = [];
    let raysUsed = 0;
    for (let i = 0; i < plan.length; i++) {
      const el = now() - t0;
      if (budget.ms && el > 0.75 * budget.ms) { notes.push('auto: stopped after ' + i + '/' + plan.length + ' trials (time)'); break; }
      if (raysUsed + perRays > (budget.rays || 2e7)) { notes.push('auto: stopped after ' + i + '/' + plan.length + ' trials (ray budget)'); break; }
      const cs = Object.assign({}, settings, plan[i], { minDistance: st.minDistance, refOnPaint: plan[i].refOnPaint !== undefined ? plan[i].refOnPaint : st.refOnPaint });
      let out, tr;
      try {
        out = base.solve(input, cs, { progress: (p) => { if (tools.progress) tools.progress(0.9 * (i + p) / plan.length); }, preview() {}, budget, scene: tools.scene });
        tr = tools.trace(out.surfaces, { rays: perRays, seed: input.seed | 0 });
      } catch (e) { notes.push('auto: trial ' + i + ' (' + JSON.stringify(plan[i]) + ') failed: ' + (e && e.message)); continue; }
      raysUsed += perRays;
      if (!tr || !tr.fidelity) continue;
      trials.push({ i, plan: plan[i], out, tr, placed: (out.surfaces || []).length });
    }
    if (!trials.length) {
      const out = base.solve(input, Object.assign({}, settings, { minDistance: st.minDistance }), tools);
      out.notes = (out.notes || []).concat('auto: every trial failed — returned the static design untuned');
      return out;
    }
    return __apAutoPick(trials, st, input, notes, perRays, raysUsed, now() - t0, tools);
  },
});

// Scoring for the tuner.  `faithful` uses the task's own formula (with the same guessed reference
// on-paint share the static solver's model uses); the trace result carries no uniformity U₀, so that
// 0.03-weighted term is dropped and the reference peak is the best peak among the trials.
function __apAutoPick(trials, st, input, notes, perRays, raysUsed, ms, tools) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const maxF = Math.max(1, (input.limits && input.limits.maxFacets) | 0 || 100);
  let peakRef = 0;
  for (const t of trials) peakRef = Math.max(peakRef, t.tr.peakCd || 0);
  const rows = trials.map((t) => {
    const fd = t.tr.fidelity || {};
    const onP = fd.onPaint || 0, fid = fd.fidelity || 0;
    const light = Math.min(1, onP / (0.1 * st.refOnPaint));
    const F = fid * light;
    const g = clamp((F - 0.5) / 0.25, 0, 1);
    const X = 0.7 * Math.min(2, onP / st.refOnPaint) / 2 + 0.3 * (peakRef > 0 ? Math.min(2, (t.tr.peakCd || 0) / peakRef) / 2 : 0);
    const score = F + g * 0.5 * X + light * 0.02 * (1 - t.placed / maxF);
    const v = st.goal === 'throw' ? (t.tr.throwM || 0) + 1e-3 * (t.tr.peakCd || 0) / (peakRef || 1)
      : st.goal === 'efficient' ? 1e4 * onP + fid
      : score;
    return { t, fd, onP, fid, light, score, v };
  });
  rows.sort((a, b) => (b.v - a.v) || (a.t.i - b.t.i));
  const best = rows[0];
  const notes2 = notes.slice();
  notes2.push('auto tuner: goal ' + st.goal + ', ' + trials.length + ' designs traced at ' + perRays + ' rays each (' + raysUsed + ' rays, ' + ms.toFixed(0) + ' ms), same seed ' + (input.seed | 0));
  for (const r of rows) {
    const lbl = Object.keys(r.t.plan).length ? Object.keys(r.t.plan).map((k) => k + ' ' + r.t.plan[k]).join(', ') : 'static default';
    notes2.push((r === best ? '  ★ ' : '    ') + lbl + ' | fid ' + (100 * r.fid).toFixed(1) + '% onP ' + (100 * r.onP).toFixed(1) + '% peak ' + (r.t.tr.peakCd || 0).toFixed(0) + ' cd throw ' + (r.t.tr.throwM || 0).toFixed(0) + ' m → ' + r.v.toFixed(3) + (r === best ? '  (score ' + r.score.toFixed(3) + ')' : ''));
  }
  const out = best.t.out;
  out.notes = (out.notes || []).concat(notes2);
  if (tools && tools.progress) tools.progress(1);
  return out;
}
