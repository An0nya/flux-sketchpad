/* solvers/solver.js — "facet-painter": a static paint solver for Flux.
 *
 * How it works (no ray tracing anywhere; every step is closed-form geometry):
 *
 *  1. Aims.  The painting is decomposed into blocks (a uniform grid refined as a quadtree until there is
 *     one block per facet).  Each block gives one aim point (the paint-weighted centroid, on the target
 *     plane) and one weight (Σ paint in the block).
 *  2. Places.  The envelope's inner surface is sampled by casting a deterministic Fibonacci fan of rays
 *     from the LED and taking the exit distance (RF.Geo.envInterval), so it works for box / ellipsoid /
 *     cylinder alike.  Each sample is a candidate facet centre: it knows its distance r, the LED's
 *     intensity in that direction, the aim-dependent facet normal (the bisector), the solid angle it can
 *     catch, and — from the reflected LED outline — the exact size of the spot it would paint.
 *     Candidates are ranked by sharpness^a · fluxDensity^b and thinned with a Poisson-disk separation
 *     (bisected so that exactly the budget survives), which both spreads the facets and sets their size.
 *  3. Pairing.  Aims (heaviest first) take the best free place: sharp where the painting has detail,
 *     with enough flux capacity for the block's weight.
 *  4. Flux.  A facet images the LED, so its spot is fixed by geometry and its *area* is a pure flux knob.
 *     The spots are rasterised once onto the paint grid (a sparse kernel per facet) and a damped
 *     Richardson–Lucy iteration turns the painting into per-facet flux, clamped by each facet's maximum
 *     (its place's area × the LED's radiance × cosines / r²).  Area = flux / (that capacity per mm²).
 *  5. Repair.  Facets are checked against each other for beam blocking, and the whole set is checked with
 *     the app's own RF.Solvers.verify (envelope + LED clearance, on the real curved surface); offenders
 *     are shrunk or dropped and the flux is re-solved.
 *
 * Measured facts behind the choices are in solvers/NOTES.md.
 */
(function () {
  'use strict';

  const V = RF.V;
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot, cross = V.cross, norm = V.norm, len = V.len;
  const GA = Math.PI * (3 - Math.sqrt(5));          // golden angle for the Fibonacci fan

  /* ------------------------------------------------------------------ small helpers */

  // Sample points on the emitter's outline, as world offsets from src.pos (used to predict the spot).
  function ledSamples(src, fr) {
    const at = (a, b, c) => [a * fr.u[0] + b * fr.v[0] + c * fr.a[0],
                             a * fr.u[1] + b * fr.v[1] + c * fr.a[1],
                             a * fr.u[2] + b * fr.v[2] + c * fr.a[2]];
    const pts = [];
    if (src.kind === 'planar' && src.shape !== 'disc') {
      const a = (src.w || 1) / 2, b = (src.h || 1) / 2;
      pts.push(at(-a, -b, 0), at(a, -b, 0), at(a, b, 0), at(-a, b, 0));
    } else if (src.kind === 'planar') {
      const r = src.radius || 0.5;
      for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; pts.push(at(r * Math.cos(t), r * Math.sin(t), 0)); }
    } else {
      const r = src.radius || 0.5, hl = (src.length || 0) / 2;
      for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; pts.push(at(r * Math.cos(t), r * Math.sin(t), hl)); }
      for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; pts.push(at(r * Math.cos(t), r * Math.sin(t), -hl)); }
    }
    pts.push([0, 0, 0]);
    return pts;
  }

  // A convex polygon's signed area and whether q is inside (both in the same 2-D space).
  function polyArea(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return a / 2;
  }
  function polyInside(p, x, y, sgn) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * sgn < 0) return false;
    }
    return true;
  }

  // Uniform spatial hash (used for Poisson-disk thinning, nearest-neighbour sizes and blocking checks).
  function Grid(cs) { return { cs, m: new Map() }; }
  function gkey(g, x, y, z) {
    const ix = Math.floor(x / g.cs), iy = Math.floor(y / g.cs), iz = Math.floor(z / g.cs);
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }
  function gput(g, p, item) {
    const k = gkey(g, p[0], p[1], p[2]); let a = g.m.get(k);
    if (!a) g.m.set(k, a = []);
    a.push(item);
  }
  // every item within `rad` of p (candidate filter: the 27 neighbouring cells, exact distance test by caller)
  function gnear(g, p, rad, out) {
    out.length = 0;
    const n = Math.max(1, Math.ceil(rad / g.cs));
    const ix = Math.floor(p[0] / g.cs), iy = Math.floor(p[1] / g.cs), iz = Math.floor(p[2] / g.cs);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let c = -n; c <= n; c++) {
      const arr = g.m.get((((ix + a) * 73856093) ^ ((iy + b) * 19349663) ^ ((iz + c) * 83492791)) | 0);
      if (arr) for (const it of arr) out.push(it);
    }
    return out;
  }

  // Ray / convex-polygon intersection (world).  Returns the distance or -1.
  function rayPoly(O, D, C, e1, e2, h1, h2, nrm) {
    const den = dot(D, nrm);
    if (Math.abs(den) < 1e-12) return -1;
    const t = dot(sub(C, O), nrm) / den;
    if (!(t > 1e-6)) return -1;
    const d = sub(add(O, mul(D, t)), C);
    const x = dot(d, e1), y = dot(d, e2);
    return (Math.abs(x) <= h1 && Math.abs(y) <= h2) ? t : -1;
  }

  /* ------------------------------------------------------------------ 1. aims from the painting
   * Blocks of the paint grid: a uniform b×b tiling of the painted bbox, then the heaviest blocks are
   * split (quadtree) until there is one aim per facet.  Aim = paint-weighted centroid of the block in
   * target-plane (u,v) mm; weight = Σ paint.  Deterministic: fixed order, index tie-breaks.        */
  function aimsFromPaint(paint, PR, T, want) {
    let i0 = PR, i1 = -1, j0 = PR, j1 = -1, tot = 0;
    for (let j = 0; j < PR; j++) for (let i = 0; i < PR; i++) {
      const w = paint[j * PR + i] || 0;
      if (w > 0) { tot += w; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    }
    if (!(tot > 0)) return { aims: [], total: 0 };
    const pcell = 2 * T.half / PR;
    const uv = (i, j) => [-T.half + (i + 0.5) * pcell, -T.half + (j + 0.5) * pcell];
    // accumulate one block [i,i+w)×[j,j+h)
    const block = (bi, bj, bw, bh) => {
      let s = 0, cu = 0, cv = 0;
      for (let j = bj; j < bj + bh; j++) for (let i = bi; i < bi + bw; i++) {
        const w = paint[j * PR + i] || 0; if (!(w > 0)) continue;
        const p = uv(i, j); s += w; cu += w * p[0]; cv += w * p[1];
      }
      return s > 0 ? { bi, bj, bw, bh, w: s, u: cu / s, v: cv / s } : null;
    };
    // coarsest uniform tiling that fits in `want` blocks
    let b = 1, list = [];
    for (b = 1; b <= Math.max(i1 - i0 + 1, j1 - j0 + 1); b++) {
      list = [];
      for (let bj = j0; bj <= j1; bj += b) for (let bi = i0; bi <= i1; bi += b) {
        const B = block(bi, bj, Math.min(b, i1 + 1 - bi), Math.min(b, j1 + 1 - bj));
        if (B) list.push(B);
      }
      if (list.length <= want) break;
    }
    // refine the heaviest blocks until there is one aim per facet
    let guard = 0;
    while (list.length < want && guard++ < 4000) {
      let best = -1, bestW = 0;
      for (let k = 0; k < list.length; k++) {
        const B = list[k];
        if (B.bw < 2 && B.bh < 2) continue;
        const sc = B.w * Math.max(B.bw, B.bh);
        if (sc > bestW) { bestW = sc; best = k; }
      }
      if (best < 0) break;
      const B = list[best];
      const hw = Math.max(1, B.bw >> 1), hh = Math.max(1, B.bh >> 1), kids = [];
      for (let dj = 0; dj < B.bh; dj += hh) for (let di = 0; di < B.bw; di += hw) {
        const K = block(B.bi + di, B.bj + dj, Math.min(hw, B.bw - di), Math.min(hh, B.bh - dj));
        if (K) kids.push(K);
      }
      if (kids.length < 2) break;
      list.splice(best, 1, ...kids);
    }
    if (list.length > want) {                                   // trim the lightest (only if b=1 overflowed)
      list.sort((p, q) => q.w - p.w || (p.bi - q.bi) || (p.bj - q.bj));
      list = list.slice(0, want);
    }
    const aims = list.map((B, k) => {
      const w = uv(B.bi, B.bj), e = uv(B.bi + B.bw - 1, B.bj + B.bh - 1);
      return { k, u: B.u, v: B.v, w: B.w, Z: add(T.C, add(mul(T.tu, B.u), mul(T.tv, B.v))),
               box: [w[0], w[1], e[0], e[1]] };
    });
    return { aims, total: tot };
  }

  /* ------------------------------------------------------------------ 2. places on the envelope
   * Cast a Fibonacci fan from the LED; each ray's envelope exit gives a candidate facet centre.
   * The facet plane is perpendicular to the bisector normal, so the centre is pulled in along the ray
   * until the whole tile fits inside the envelope (binary search; the envelope is convex).          */

  // The image of the LED outline on the target plane, as a convex (u,v) polygon + its area (mm²).
  function spotPoly(P, n, Z, S0, samples, T) {
    const ah = norm(sub(Z, P)), pts = [];
    const tn = dot(sub(T.C, P), T.n);
    for (let k = 0; k < samples.length; k++) {
      const Sp = add(S0, samples[k]);
      const d = norm(sub(P, Sp));
      const r = sub(d, mul(n, 2 * dot(d, n)));
      const den = dot(r, T.n);
      if (Math.abs(den) < 1e-9) return null;
      const t = tn / den;
      if (!(t > 0)) return null;
      const X = add(P, mul(r, t)), q = sub(X, T.C);
      pts.push([dot(q, T.tu), dot(q, T.tv)]);
    }
    // convex hull (Andrew) — the outline samples are already convex, but the projection can reorder them
    const hull = convexHull(pts);
    if (hull.length < 3) return null;
    return { poly: hull, area: Math.abs(polyArea(hull)) };
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  // facet frame: e1 along the LED's u axis projected into the facet plane
  function facetFrame(n, fr) {
    let e1 = sub(fr.u, mul(n, dot(fr.u, n)));
    if (len(e1) < 1e-6) e1 = sub(fr.v, mul(n, dot(fr.v, n)));
    if (len(e1) < 1e-6) e1 = sub(fr.a, mul(n, dot(fr.a, n)));
    e1 = norm(e1);
    return [e1, norm(cross(n, e1))];
  }

  // smallest inset t along -d so that the tile (centre P - t·d, half extents h1,h2 in e1,e2) fits the envelope
  // `pad` (optional) is tested both ways from every corner: a curved facet's real surface is lifted off
  // the chord by up to its sag, and the lift can go either way, so the chord must clear the wall by that much.
  function fitInset(env, P, d, e1, e2, h1, h2, tol, pad) {
    const corners = (t) => {
      const C = sub(P, mul(d, t)), out = [];
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const q = add(C, add(mul(e1, sa * h1), mul(e2, sb * h2)));
        out.push(q);
        if (pad) { out.push(add(q, pad)); out.push(sub(q, pad)); }
      }
      return out;
    };
    const fits = (t) => { for (const q of corners(t)) if (!RF.Geo.envInside(env, q, tol)) return false; return true; };
    if (fits(0)) return 0;
    let lo = 0, hi = Math.max(4 * Math.max(h1, h2), 4);
    if (!fits(hi)) return -1;
    for (let it = 0; it < 14; it++) { const m = 0.5 * (lo + hi); if (fits(m)) hi = m; else lo = m; }
    return hi;
  }

  /* ------------------------------------------------------------------ the solver */
  const STATIC_DEF = {
    id: 'bench-qwen38max--facet-painter', name: 'Facet painter (static)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'sharp', label: 'Sharpness vs flux', type: 'range', min: 0, max: 1, step: 0.05, default: 0.6},
      { key: 'fill', label: 'Tile fill factor', type: 'range', min: 0.3, max: 1, step: 0.02, default: 0.86},
      { key: 'passes', label: 'Flux passes (Richardson–Lucy)', type: 'range', min: 0, max: 80, step: 1, default: 30 },
      { key: 'blur', label: 'Model penumbra (cells)', type: 'range', min: 0, max: 4, step: 0.25, default: 0.75},
      { key: 'cosMin', label: 'Min mirror cosine', type: 'range', min: 0.05, max: 0.8, step: 0.05, default: 0.25 },
      { key: 'fan', label: 'Candidate rays', type: 'number', min: 800, max: 20000, step: 100, default: 5000 },
      { key: 'shapeFit', label: 'Shape-first flux fit', type: 'checkbox', default: true },
      { key: 'sat', label: 'Facets allowed to saturate', type: 'range', min: 0, max: 0.45, step: 0.05, default: 0.05 },
      { key: 'capRounds', label: 'Capacity refit rounds', type: 'range', min: 1, max: 6, step: 1, default: 1 },
      { key: 'floor', label: 'Minimum facet flux (× mean)', type: 'range', min: 0, max: 2, step: 0.05, default: 1.1 },
      { key: 'beamEff', label: 'Weight flux by beam transmission', type: 'checkbox', default: false },
      { key: 'overlap', label: 'Facets per painted cell', type: 'range', min: 0.5, max: 60, step: 0.5, default: 40 },
      { key: 'edge', label: 'Edge sharpness (0 = uniform spot)', type: 'range', min: 0, max: 12, step: 0.1, default: 1.8 },
      { key: 'pen', label: 'Kernel size factor (pre-sharpen < 1)', type: 'range', min: 0.15, max: 1.6, step: 0.05, default: 0.78 },
    ],

    solve(input, settings, tools) {
      const Geo = RF.Geo, Eng = RF.Engine, Src = RF.Source;
      const env = input.envelope, src = input.source, tgt = input.target;
      const T = Eng.targetFrame(tgt);
      const PR = Math.max(1, (input.paint && input.paint.res) | 0), paint = (input.paint && input.paint.cells) || [];
      const N = Math.max(1, input.limits.maxFacets | 0);
      const rho = input.limits.reflectivity > 0 ? input.limits.reflectivity : 0.9;
      const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
      const S0 = src.pos.slice(), fr = Src.frame(src);
      const notes = [];
      const SHARP = Math.max(0, Math.min(1, +settings.sharp));
      const OVERLAP = Math.max(0.5, Math.min(60, +settings.overlap || 40));
      const EDGE = +settings.edge >= 0 ? Math.min(12, +settings.edge) : 0;
      const PEN = Math.max(0.15, Math.min(2, +settings.pen || 0.8));   // modelled penumbra: real spots are a little wider
      const FILL = Math.max(0.2, Math.min(1, +settings.fill));
      const PASSES = Math.max(0, Math.round(+settings.passes));
      const BLUR = Math.max(0, +settings.blur);
      const COSMIN = Math.max(0.02, +settings.cosMin);
      const NDIR = Math.max(600, Math.min(20000, Math.round(+settings.fan)));
      const samples = ledSamples(src, fr);

      // LED radiometry: intensity (cd) = power / ∫I dΩ × relative I(θ)
      const power = src.power || 0, itot = Src.totalIntegral(src) || Math.PI;
      const I0 = power / itot;                                       // cd at the peak of the distribution
      const ledR = Math.max(0.2, Src.boundingRadius(src));

      /* ---- 1. aims ------------------------------------------------------------- */
      const A = aimsFromPaint(paint, PR, T, N);
      if (!A.aims.length) return { surfaces: [], intent: [], notes: ['the painting is empty: nothing to do'] };
      const aims = A.aims;
      let cu = 0, cv = 0, cw = 0;
      for (const a of aims) { cu += a.w * a.u; cv += a.w * a.v; cw += a.w; }
      const Zc = add(T.C, add(mul(T.tu, cu / cw), mul(T.tv, cv / cw)));   // nominal aim: the paint's centroid

      /* ---- 2. candidate places ------------------------------------------------- */
      const rMin = keep + 0.35 * ledR + 0.5;
      const tol = -1e-4;                                            // stay strictly inside the envelope
      const cands = [];
      const hNom = 3.0;                                             // nominal tile half-size for the first fit test
      for (let k = 0; k < NDIR; k++) {
        const cz = 1 - (k + 0.5) / NDIR, rr = Math.sqrt(Math.max(0, 1 - cz * cz)), th = GA * k;
        const dl = [rr * Math.cos(th), rr * Math.sin(th), cz];       // in the LED frame (cz = cosθ ≥ 0)
        const d = [dl[0] * fr.u[0] + dl[1] * fr.v[0] + dl[2] * fr.a[0],
                   dl[0] * fr.u[1] + dl[1] * fr.v[1] + dl[2] * fr.a[1],
                   dl[0] * fr.u[2] + dl[1] * fr.v[2] + dl[2] * fr.a[2]];
        const rel = Src.intensity(src, Math.acos(Math.min(1, cz)));
        if (!(rel > 1e-4)) continue;
        const iv = Geo.envInterval(env, S0, d);
        if (!(iv[1] > rMin) || !isFinite(iv[1])) continue;
        const Ps = add(S0, mul(d, iv[1]));
        const sh = mul(d, -1);                                      // facet → LED
        const ah = norm(sub(Zc, Ps));
        const nb = add(sh, ah), ln = len(nb);
        if (ln < 1e-6) continue;
        const n = mul(nb, 1 / ln), cosa = Math.abs(dot(n, sh));
        if (cosa < COSMIN) continue;
        const ef = facetFrame(n, fr);
        const ins = fitInset(env, Ps, d, ef[0], ef[1], hNom, hNom, tol);
        if (ins < 0) continue;
        const P = sub(Ps, mul(d, ins)), r = len(sub(P, S0));
        if (r < rMin) continue;
        const sp = spotPoly(P, n, Zc, S0, samples, T);
        if (!sp || !(sp.area > 1e-6)) continue;
        // flux this place can catch per mm² of tile, and how sharp its spot is
        const dens = rho * I0 * rel * cosa / (r * r);
        cands.push({ d, P, r, rS: iv[1], n, e1: ef[0], e2: ef[1], rel, cosa, dens, spot: Math.sqrt(sp.area), ins });
      }
      if (!cands.length) return { surfaces: [], intent: [], notes: ['no place on the envelope can both see the LED and aim at the target'] };
      notes.push(aims.length + ' aims, ' + cands.length + ' candidate places');

      /* ---- 2b. rank and thin to one place per aim ------------------------------ */
      const nWant = Math.min(N, aims.length);
      for (const c of cands) c.q = -SHARP * Math.log(c.spot) + (1 - SHARP) * Math.log(c.dens);
      cands.sort((a, b) => b.q - a.q || a.r - b.r);
      const pick = (sep) => {
        const g = Grid(Math.max(0.5, sep)), out = [], nb = [];
        for (const c of cands) {
          if (out.length >= nWant) break;
          gnear(g, c.P, sep, nb);
          let ok = true;
          for (const o of nb) { const dx = o.P[0] - c.P[0], dy = o.P[1] - c.P[1], dz = o.P[2] - c.P[2];
            if (dx * dx + dy * dy + dz * dz < sep * sep) { ok = false; break; } }
          if (ok) { out.push(c); gput(g, c.P, c); }
        }
        return out;
      };
      let lo = 0.2, hi = 4 * (env.half[0] + env.half[1] + env.half[2]);
      let sel = pick(lo);
      if (sel.length < nWant) { notes.push('only ' + sel.length + ' places fit (wanted ' + nWant + ')'); }
      else {
        while (hi / lo > 1.02) {
          const m = Math.sqrt(lo * hi), s = pick(m);
          if (s.length >= nWant) { lo = m; sel = s; } else hi = m;
        }
        sel = pick(lo);
      }
      const M = sel.length;
      if (!M) return { surfaces: [], intent: [], notes: ['no place survived thinning'] };

      /* ---- 2c. tile size: half the distance to the nearest neighbour ----------- */
      {
        const g = Grid(Math.max(1, lo * 2)), nb = [];
        for (const c of sel) gput(g, c.P, c);
        for (const c of sel) {
          gnear(g, c.P, lo * 2.5, nb);
          let best = Infinity;
          for (const o of nb) { if (o === c) continue; const dd = len(sub(o.P, c.P)); if (dd < best) best = dd; }
          c.nn = isFinite(best) ? best : lo * 2;
        }
      }
      for (const c of sel) c.h = Math.max(0.35, 0.5 * FILL * Math.min(c.nn, 2.2 * lo));

      /* ---- 3. pair aims with places -------------------------------------------- */
      // per-place tile area; flux capacity is filled in once the aim (hence the normal) is known
      for (const c of sel) c.area = 4 * c.h * c.h;
      const bySpot = sel.slice().sort((a, b) => a.spot - b.spot || b.q - a.q);
      const order = aims.slice().sort((a, b) => b.w - a.w || a.k - b.k);
      let capTot = 0;
      for (const c of sel) capTot += c.dens * c.area;
      const wTot = aims.reduce((s, a) => s + a.w, 0);
      const KSCAN = 64;
      const F = [];                                                  // facets: {place, aim, ...}
      for (const a of order) {
        const need = capTot * a.w / wTot;
        let best = null, bestS = -Infinity, seen = 0;
        for (let i = 0; i < bySpot.length && seen < KSCAN; i++) {
          const c = bySpot[i];
          if (c.taken) continue;
          seen++;
          const ah = norm(sub(a.Z, c.P)), sh = mul(c.d, -1), nb = add(sh, ah), ln = len(nb);
          if (ln < 1e-6) continue;
          const n = mul(nb, 1 / ln), cosa = Math.abs(dot(n, sh));
          if (cosa < COSMIN) continue;
          const cap = rho * I0 * c.rel * cosa / (c.r * c.r) * c.area;
          const s = -SHARP * Math.log(c.spot) + (1 - SHARP) * Math.log(Math.min(cap, 2.5 * need) / (capTot / M));
          if (s > bestS) { bestS = s; best = { c, n, cosa, ah, cap }; }
        }
        if (!best) { for (let i = 0; i < bySpot.length; i++) { const c = bySpot[i]; if (!c.taken) { c.taken = true;
            const ah = norm(sub(a.Z, c.P)), sh = mul(c.d, -1), nb = add(sh, ah), n = mul(nb, 1 / len(nb));
            best = { c, n, cosa: Math.abs(dot(n, sh)), ah, cap: rho * I0 * c.rel * Math.abs(dot(n, sh)) / (c.r * c.r) * c.area }; break; } } }
        if (!best) break;
        best.c.taken = true;
        F.push({ c: best.c, aim: a, n: best.n, cosa: best.cosa, ah: best.ah, cap: best.cap, flux: 0, h: best.c.h });
      }
      if (!F.length) return { surfaces: [], intent: [], notes: ['no facet could be aimed at the painting'] };
      // final geometry with the chosen aim: frame, envelope fit, image distance, spot polygon
      const fit = [];
      for (const f of F) {
        const Z = f.aim.Z, c = f.c;
        const ef = facetFrame(f.n, fr);
        f.e1 = ef[0]; f.e2 = ef[1];
        // the tile must fit inside the envelope with its FINAL frame; shrink it until it does
        let hh = c.h, ins = -1, pad = null;
        for (let t = 0; t < 10 && ins < 0; t++) {
          // sag of the focusing ellipsoid at the tile corner: ½h²(1/r + 1/di), along the normal
          const di0 = len(sub(Z, add(S0, mul(c.d, c.rS)))), rr0 = c.rS;
          pad = mul(f.n, 0.6 * hh * hh * (1 / Math.max(1, rr0) + 1 / Math.max(1, di0)) + 0.02);
          ins = fitInset(env, add(S0, mul(c.d, c.rS)), c.d, f.e1, f.e2, hh, hh, tol, pad);
          if (ins < 0) hh *= 0.7;
        }
        if (ins < 0 || hh < 0.3) continue;                          // no room here at all
        c.h = hh; c.area = 4 * hh * hh;
        c.P = sub(add(S0, mul(c.d, c.rS)), mul(c.d, ins)); c.r = len(sub(c.P, S0));
        f.P = c.P; f.Z = Z;
        f.di = len(sub(Z, c.P));
        f.sh = norm(sub(S0, c.P));
        f.cosa = Math.abs(dot(f.n, f.sh));
        f.sp = spotPoly(c.P, f.n, Z, S0, samples, T);
        f.dens = rho * I0 * c.rel * f.cosa / (c.r * c.r);            // lm per mm² of tile
        f.cap = f.dens * c.area;
        if (f.sp) fit.push(f);
      }
      F.length = 0; for (const f of fit) F.push(f);
      notes.push(F.length + ' facets placed, max flux ' + F.reduce((s, f) => s + f.cap, 0).toFixed(0) + ' lm of ' + power.toFixed(0) + ' lm');

      /* ---- 4. spot kernels on the paint grid, then Richardson–Lucy on the flux -- */
      const pcell = 2 * T.half / PR;
      const nPR = PR * PR;
      function kernelOf(f) {
        if (!f.sp) return null;
        const poly = f.sp.poly.map((p) => [(p[0] + T.half) / pcell - 0.5, (p[1] + T.half) / pcell - 0.5]);
        const sgn = polyArea(poly) >= 0 ? 1 : -1;
        let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
        for (const p of poly) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; if (p[1] < c) c = p[1]; if (p[1] > d) d = p[1]; }
        const rb = Math.max(0, Math.round(BLUR));
        const i0 = Math.max(0, Math.floor(a) - rb - 1), i1 = Math.min(PR - 1, Math.ceil(b) + rb + 1);
        const j0 = Math.max(0, Math.floor(c) - rb - 1), j1 = Math.min(PR - 1, Math.ceil(d) + rb + 1);
        if (i1 < i0 || j1 < j0) return null;
        const w = i1 - i0 + 1, h = j1 - j0 + 1, buf = new Float64Array(w * h);
        let s = 0;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          if (polyInside(poly, i, j, sgn)) { buf[(j - j0) * w + (i - i0)] = 1; s++; }
        }
        if (!s) {                                                  // spot smaller than a cell: nearest cell
          const cx = Math.round((a + b) / 2), cy = Math.round((c + d) / 2);
          if (cx < 0 || cy < 0 || cx >= PR || cy >= PR) return null;
          return { idx: Int32Array.from([cy * PR + cx]), w: Float32Array.from([1]) };
        }
        let out = buf;
        for (let p = 0; p < rb; p++) {                              // rb box blurs of radius 1
          const t = new Float64Array(w * h);
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            let a1 = 0, n1 = 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
              a1 += out[jj * w + ii]; n1++;
            }
            t[j * w + i] = a1 / n1;
          }
          out = t;
        }
        const idx = [], ww = [];
        let sum = 0;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = out[j * w + i]; if (v > 1e-4) { idx.push((j + j0) * PR + (i + i0)); ww.push(v); sum += v; } }
        if (!idx.length || !(sum > 0)) return null;
        const wf = new Float32Array(ww.length);
        for (let k = 0; k < ww.length; k++) wf[k] = ww[k] / sum;
        return { idx: Int32Array.from(idx), w: wf };
      }
      /* ---- 4b. focus: choose each facet's image distance di so the spot is the size we want.
       * di = D (image exactly on the target) is the sharpest the geometry allows, but sharp is not
       * always best: with few facets per painted cell the pattern is grainy and the scorer's ±25 %
       * band punishes it.  Defocusing (di < D) widens the spot to  W = s·D/(2r) + h·|D-di|/di
       * without moving its centre (the aim ray is unchanged, so the ellipsoid normal is too).
       * Target: OVERLAP facets covering each painted cell.                                      */
      let paintedN = 0; for (let q = 0; q < nPR; q++) if (paint[q] > 0) paintedN++;
      const wantW = 0.5 * Math.sqrt(Math.max(1, OVERLAP * paintedN / Math.max(1, F.length))) * pcell;
      // chamfer distance transform of the paint mask: how far each painted cell is from the edge.
      // Facets aiming near the edge get a proportionally smaller spot so they do not spill over it.
      const dt = new Float64Array(nPR);
      for (let q = 0; q < nPR; q++) dt[q] = paint[q] > 0 ? 1e6 : 0;
      for (let j = 0; j < PR; j++) for (let i = 0; i < PR; i++) {
        const q = j * PR + i; let d = dt[q];
        if (i > 0) d = Math.min(d, dt[q - 1] + 1);
        if (j > 0) d = Math.min(d, dt[q - PR] + 1);
        if (i > 0 && j > 0) d = Math.min(d, dt[q - PR - 1] + 1.414);
        if (i < PR - 1 && j > 0) d = Math.min(d, dt[q - PR + 1] + 1.414);
        dt[q] = d;
      }
      for (let j = PR - 1; j >= 0; j--) for (let i = PR - 1; i >= 0; i--) {
        const q = j * PR + i; let d = dt[q];
        if (i < PR - 1) d = Math.min(d, dt[q + 1] + 1);
        if (j < PR - 1) d = Math.min(d, dt[q + PR] + 1);
        if (i < PR - 1 && j < PR - 1) d = Math.min(d, dt[q + PR + 1] + 1.414);
        if (i > 0 && j < PR - 1) d = Math.min(d, dt[q + PR - 1] + 1.414);
        dt[q] = d;
      }
      let sd = 0; for (const q of samples) sd = Math.max(sd, len(q)); sd *= 2;      // LED full size
      // hOf: the tile half-width to assume (the layout maximum first, the built size on the 2nd pass)
      const setFocus = (list, hOf) => {
        let nDefoc = 0;
        for (const f of list) {
          const r = f.c.r, h = Math.max(0.05, hOf(f)), D = f.c.D;
          // edge-aware target width: never wider than EDGE × (distance from the aim to the paint edge)
          let wF = wantW;
          if (EDGE > 0 && f.aim) {
            const ai = Math.round((f.aim.u + T.half) / pcell - 0.5), aj = Math.round((f.aim.v + T.half) / pcell - 0.5);
            if (ai >= 0 && ai < PR && aj >= 0 && aj < PR) wF = Math.min(wantW, EDGE * dt[aj * PR + ai] * pcell);
          }
          // The LED's image at the target is s·D/(2r) half-width whatever di is (magnification D/r),
          // so that is the sharpest any facet can be; defocusing only ADDS the aperture divergence
          // h·|D-di|/di.  W(di) = wF has no solution when wF < WD: then stay focused (di = D).
          const WD = sd * D / (2 * r);
          let di = D;
          if (wF > WD) {
            const d2 = h * D / (wF - WD + h);
            if (d2 > Math.max(6, 0.15 * r)) di = d2;
          }
          if (!(di > 1)) di = D;
          if (Math.abs(di - D) > 0.02 * D) nDefoc++;
          f.di = di;
          f.Z = add(f.P, mul(f.ah, di));                        // image point; the aim ray (f.ah) is fixed
          if (f.sp0) {                                          // rescale the modelled spot to the real width
            // Pre-sharpening: the Richardson-Lucy fit is biased towards smooth flux distributions when
            // the kernels overlap heavily, so the modelled kernel is deliberately narrower than the real
            // spot (PEN < 1).  Floor it at ~1 cell so the rasteriser never degenerates.
            const Wa = Math.max(PEN * (WD + h * Math.abs(D - di) / di), 0.55 * pcell);
            const k = Wa / Math.max(1e-6, WD);
            let cx = 0, cy = 0; for (const q of f.sp0.poly) { cx += q[0]; cy += q[1]; }
            cx /= f.sp0.poly.length; cy /= f.sp0.poly.length;
            const poly = f.sp0.poly.map((q) => [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k]);
            f.sp = { poly, area: Math.abs(polyArea(poly)) };
          }
          f.c.spot = f.sp ? Math.sqrt(f.sp.area) : 0;
        }
        return nDefoc;
      };
      for (const f of F) { f.c.D = f.di; f.A = f.Z; f.ah = norm(sub(f.Z, f.P)); f.sp0 = f.sp; }
      const nDefoc = setFocus(F, (f) => f.c.h);
      if (nDefoc) notes.push(nDefoc + '/' + F.length + ' facets defocused to a ' +
                             (2 * wantW / pcell).toFixed(1) + '-cell spot');

      const live = [];
      for (const f of F) { f.K = kernelOf(f); if (f.K) live.push(f); }
      if (!live.length) return { surfaces: [], intent: [], notes: ['no facet spot lands on the target'] };

      /* ---- 3b. static beam blocking: how much of each facet's beam is intercepted by the others.
       * A focused facet sends every tile point toward its aim, so the beam is the cone tile→aim; sample it
       * 3×3 and test the segments against every other tile (pure geometry, no rays traced).          */
      const USE_EFF = +settings.beamEff !== 0;
      for (const f of live) {
        let hit = 0, ns = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const X = add(f.P, add(mul(f.e1, a * f.c.h * 0.7), mul(f.e2, b * f.c.h * 0.7)));
          const D = sub(f.Z, X), L = len(D);
          if (!(L > 1)) continue;
          const d = mul(D, 1 / L);
          ns++;
          for (const g of live) {
            if (g === f) continue;
            const t = rayPoly(X, d, g.P, g.e1, g.e2, g.c.h, g.c.h, g.n);
            if (t > 0 && t < L - 1) { hit++; break; }
          }
        }
        f.block = ns ? hit / ns : 0;
        f.eff = USE_EFF ? Math.max(0.05, 1 - f.block) : 1;   // measured: weighting the RL by this crude
                                                              // 3×3 estimate made things WORSE, so it is off by
                                                              // default and only reported as a diagnostic.
      }
      const effMean = live.reduce((s, f) => s + f.eff, 0) / live.length;
      notes.push('beam transmission ' + (100 * effMean).toFixed(0) + '%');

      const tvec = new Float64Array(nPR);
      let wSum = 0;
      for (let k = 0; k < nPR; k++) { const w = paint[k] || 0; if (w > 0) { tvec[k] = w; wSum += w; } }
      const capAll = live.reduce((s, f) => s + f.cap, 0);
      const SHAPE = +settings.shapeFit !== 0;
      for (let k = 0; k < nPR; k++) tvec[k] = tvec[k] / wSum * (SHAPE ? 1 : capAll);
      const D = new Float64Array(nPR), Rr = new Float64Array(nPR);
      for (const f of live) { f.flux = SHAPE ? 1 / live.length : f.cap * 0.5; f.fixed = false; }
      const eps = 1e-9 / Math.max(1, nPR);
      /* Richardson-Lucy on the facet fluxes.  In shape-first mode it always runs in *shape space*
       * (the fluxes sum to the target's total, 1): the absolute scale is applied once at the end by
       * capFit.  Running it on absolute fluxes against a normalised target would drive every ratio to
       * the clamp and collapse the solution uniformly — which is what an earlier version did. */
      const rl = (passes) => {
        if (SHAPE) {
          let free = 0, pin = 0;
          for (const f of live) { if (f.fixed) pin += f.flux; else free += f.flux; }
          if (free > 1e-15 && pin < 1) { const k = (1 - pin) / free; for (const f of live) if (!f.fixed) f.flux *= k; }
        }
        for (let p = 0; p < Math.max(1, passes); p++) {
          D.fill(0);
          for (const f of live) { const K = f.K, fe = f.flux * f.eff; for (let q = 0; q < K.idx.length; q++) D[K.idx[q]] += fe * K.w[q]; }
          for (let i = 0; i < nPR; i++) Rr[i] = tvec[i] / (D[i] + eps);
          for (const f of live) {
            if (f.fixed) continue;                     // at its capacity: held, the others compensate
            const K = f.K; let num = 0;
            for (let q = 0; q < K.idx.length; q++) num += K.w[q] * Rr[K.idx[q]];
            const ratio = Math.max(0.05, Math.min(20, num));
            f.flux = SHAPE ? Math.max(0, f.flux * Math.pow(ratio, 0.75))
                           : Math.max(0, Math.min(f.cap, f.flux * Math.pow(ratio, 0.75)));
          }
        }
      };
      /* Scale the shape up until a fraction SAT of the facets meet their capacity, pin those, and let
       * the RL re-converge around them.  Clipping alone distorts the shape; re-fitting recovers most of
       * it.  The flux is worth chasing twice over: it raises the trace's photon count (the fidelity
       * noise ceiling climbs from ~92% at 5% delivered to ~100% at 20%) and it is what `onPaint`,
       * `light` and the peak-intensity term of the score are made of. */
      const SAT = Math.max(0, Math.min(0.45, +settings.sat));
      const CAPROUNDS = Math.max(1, Math.min(6, Math.round(+settings.capRounds || 1)));
      const FLOOR = Math.max(0, Math.min(2, +settings.floor || 0));
      let SCALE = 1;
      const capFit = (rounds) => {
        if (!SHAPE) { for (const f of live) f.flux = Math.min(f.cap, f.flux); return; }
        for (let rd = 0; rd < rounds; rd++) {
          const rr = [];
          for (const f of live) if (!f.fixed && f.flux > 1e-12) rr.push(f.cap / f.flux);
          if (!rr.length) break;
          rr.sort((a, b) => a - b);
          SCALE = rr[Math.min(rr.length - 1, Math.floor(SAT * rr.length))];
          let nFix = 0;
          for (const f of live) {
            if (f.fixed) { f.flux = f.cap / SCALE; continue; }
            if (f.flux * SCALE >= f.cap * (1 - 1e-9)) { f.fixed = true; f.flux = f.cap / SCALE; nFix++; }
          }
          if (!nFix || rd === rounds - 1) break;
          rl(8);
        }
        for (const f of live) f.flux = Math.min(f.cap, f.flux * SCALE);
      };
      rl(PASSES);
      /* The RL leaves a handful of facets at ~0 (with 40× overlap the dictionary is hugely redundant),
       * and build() then drops them for want of area — 15/100 on the default scene.  A small floor
       * keeps every facet in the design for ~1 % of the total flux. */
      if (FLOOR > 0) {
        let sum = 0; for (const f of live) sum += f.flux;
        const mean = sum / Math.max(1, live.length), fl = FLOOR * mean;
        for (const f of live) if (f.flux < fl) f.flux = fl;
        sum = 0; for (const f of live) sum += f.flux;
        if (sum > 0) for (const f of live) f.flux /= sum;
      }
      capFit(CAPROUNDS);
      const nFixed1 = live.filter((f) => f.fixed).length;
      // 2nd pass: the built tile is usually smaller than the layout maximum, and the focus (hence the
      // spot, hence the kernel) depends on it.  Re-focus with the real half-width and refit.
      setFocus(live, (f) => 0.5 * Math.sqrt(Math.max(0, f.flux) / Math.max(1e-9, f.dens)));
      for (const f of live) { const K = kernelOf(f); if (K) f.K = K; }
      for (const f of live) if (SHAPE) f.flux = Math.min(1, f.flux / Math.max(1e-12, SCALE));  // back to shape space
      rl(Math.min(PASSES, 12));
      capFit(CAPROUNDS);
      notes.push('capacity: ' + live.filter((f) => f.fixed).length + '/' + live.length + ' facets at their limit');

      /* ---- 5. geometry out, self-check with the app's own verifier, repair ----- */
      function build(list) {
        const out = [];
        for (let k = 0; k < list.length; k++) {
          const f = list[k], A = Math.max(0, f.flux) / Math.max(1e-9, f.dens);
          if (!(A > 0.02)) continue;
          const h = Math.max(0.1, 0.5 * Math.sqrt(A));
          f.h = h; f.area = A;                        // the capacity stays the layout maximum (c.area)
          const id = 'facet' + (k + 1);
          f.id = id;
          const pts = [];                                  // ordered around the tile (a bowtie would clip to nothing)
          for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(add(f.P, add(mul(f.e1, q[0] * h), mul(f.e2, q[1] * h))));
          // a curved (ellipsoidal) facet: foci at the LED and at the aim, so the spot is the LED's image
          // (s·di/r) instead of the mirror's own projection (2h·D/r, ~20× bigger).  Flat facets score ~0.
          out.push({ type: 'facet', id, group: 'A', P: f.P.slice(), S0: S0.slice(), Z: f.Z.slice(), di: f.di,
                     clip: { kind: 'poly', pts3: pts },
                     optics: { interaction: 'reflect', reflectivity: rho, twoSided: false } });
        }
        return out;
      }
      const stub = { name: 'solver-verify', mode: 'A', source: src, envelope: env, target: tgt,
                     modeA: { budget: N, minDistance: keep, reflectivity: rho } };
      const lim = { budget: N, minDistance: keep, reflectivity: rho };
      let live2 = live.slice(), surfaces = build(live2), rep = null, guard = 0, bad = 0;
      while (guard++ < 8) {
        rep = RF.Solvers.verify(stub, { surfaces: surfaces, intent: [], notes: [] });   // verify takes an output object
        bad = rep.violations.envelope.length + rep.violations.keepOut.length + rep.errors.length;
        if (!bad) break;
        const byId = {}; for (const f of live2) byId[f.id] = f;
        const shrink = [];
        for (const id of rep.violations.envelope) if (byId[id]) shrink.push(byId[id]);
        for (const id of rep.violations.keepOut) if (byId[id]) shrink.push(byId[id]);
        if (!shrink.length) break;
        for (const f of shrink) { f.c.h *= 0.8; f.c.area = 4 * f.c.h * f.c.h; f.cap = f.dens * f.c.area; }
        for (const f of live2) if (SHAPE) f.flux = Math.min(1, f.flux / Math.max(1e-12, SCALE));
        rl(10); capFit(1);
        surfaces = build(live2);
      }
      notes.push(bad ? 'verify: ' + bad + ' unresolved issue(s)' : 'verify: clean (' + surfaces.length + ' facets)');

      /* ---- 6. intent + notes --------------------------------------------------- */
      const intent = [];
      for (const f of live2) {
        if (!f.id) continue;
        const cells = [];
        if (f.K) for (let q = 0; q < f.K.idx.length; q++) {
          const i = f.K.idx[q] % PR, j = (f.K.idx[q] / PR) | 0;
          if (paint[j * PR + i] > 0) cells.push([f.K.idx[q], Math.round(1e4 * f.K.w[q]) / 1e4]);
        }
        intent.push({ facet: f.id, cells });
      }
      let rs = 0, ss = 0, fl = 0;
      for (const f of live2) { rs += f.c.r; ss += f.sp ? Math.sqrt(f.sp.area) : 0; fl += f.flux; }
      const nn = live2.length || 1;
      if (typeof globalThis !== 'undefined') globalThis.__lastSolve = { D: D.slice(), t: tvec.slice(), PR: PR,
        live: live2.map((f) => ({ flux: f.flux, cap: f.cap, h: f.c.h, r: f.c.r, spot: f.c.spot, aim: f.c.aim,
          K: f.K ? { idx: Array.from(f.K.idx), w: Array.from(f.K.w) } : null,
          A: f.A ? RF.Engine.worldToTargetUV(T, f.A) : null, Z: f.Z ? RF.Engine.worldToTargetUV(T, f.Z) : null, di: f.di, D: f.c.D })), issues: bad };
      notes.push('mean r ' + (rs / nn).toFixed(1) + ' mm, mean spot ' + (ss / nn).toFixed(0) + ' mm (' +
                 (ss / nn / pcell).toFixed(1) + ' cells), flux ' + fl.toFixed(0) + ' lm, tile fill ' + FILL);
      return { surfaces, intent, notes };
    },
  };
  RF.Solvers.register(STATIC_DEF);

  /* ------------------------------------------------------------------ the tuner (-auto)
   * The static algorithm has eight knobs whose optima move with the scene (paint size and
   * contrast, LED size, envelope, facet budget) — see NOTES.md for the sweeps.  This solver
   * spends a ray budget choosing them *per scene and per goal*.  It never changes the
   * algorithm, only its settings, so every output it returns is one the static solver could
   * have produced and obeys the same hard constraints (envelope, clearance, budget,
   * determinism).
   *
   * Three rounds, cheapest first, and every trace on the *same seed* so common random numbers
   * make the ranking about geometry rather than dice:
   *   1. explore — 8 fixed points spanning the space, at `rays` each;
   *   2. refine  — ±1 step on the four knobs that matter most, from the round-1 winner, at 3×;
   *   3. confirm — the two best settings re-traced at 5×, to decide on the least noisy reading.
   * A hard guard on the ray and time budgets stops the search early and returns the best
   * candidate found so far, so a slow or large scene degrades gracefully instead of failing.
   */
  const GOALS = ['faithful', 'throw', 'efficient'];

  const clampS = (v, a, b) => (v < a ? a : v > b ? b : v);

  // round 1: span the space around the static defaults ({} = the defaults themselves).
  const EXPLORE = [
    {},
    { overlap: 20, pen: 0.90 },                       // sharper spots, less pre-sharpening
    { overlap: 60, pen: 0.70 },                       // wider spots
    { sat: 0.15, floor: 0.70 },                       // more flux, sparser
    { sat: 0.02, floor: 1.40 },                       // less flux, flatter
    { edge: 0 },                                      // no edge-aware spot shrink
    { sharp: 0.85, overlap: 25 },                     // prefer far, sharp places
    { sharp: 0.35, overlap: 55, sat: 0.10 },          // prefer near, bright places
  ];
  // round 2: one step each way on the four knobs the sweeps showed to matter.
  const REFINE = [
    (s) => { s.overlap = clampS(+(s.overlap - 12).toFixed(1), 4, 60); },
    (s) => { s.overlap = clampS(+(s.overlap + 12).toFixed(1), 4, 60); },
    (s) => { s.pen = clampS(+(s.pen - 0.08).toFixed(2), 0.30, 1.30); },
    (s) => { s.pen = clampS(+(s.pen + 0.08).toFixed(2), 0.30, 1.30); },
    (s) => { s.sat = clampS(+(s.sat * 0.5).toFixed(3), 0, 0.40); },
    (s) => { s.sat = clampS(+(s.sat * 1.8 + 0.01).toFixed(3), 0, 0.40); },
    (s) => { s.sharp = clampS(+(s.sharp - 0.20).toFixed(2), 0, 1); },
    (s) => { s.sharp = clampS(+(s.sharp + 0.20).toFixed(2), 0, 1); },
  ];

  /* The goal's objective.  `faithful` is pure fidelity.  `throw` and `efficient` optimise
   * throw distance / light-on-paint, but only among candidates that keep the painting: this is
   * paint mode, and a beam that no longer looks like the painting is not a better answer to any
   * goal.  The gate is relative (85 % of the best fidelity seen in this search) so it adapts to
   * scenes where the optics allow less.  Gated-out candidates rank below every gated-in one. */
  function objective(rec, bestFid, goal) {
    const f = rec.res && rec.res.fidelity;
    if (!f || !(f.fidelity > 0)) return -1e6;
    if (goal === 'faithful') return f.fidelity;
    if (bestFid > 0 && f.fidelity < 0.85 * bestFid) return f.fidelity - 1000;
    if (goal === 'throw') return (rec.res.throwM || 0) / 1000;
    return f.onPaint || 0;                                     // efficient
  }

  RF.Solvers.register({
    id: 'bench-qwen38max--facet-painter-auto', name: 'Facet painter (auto-tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: GOALS, default: 'faithful',
        help: 'faithful = reproduce the painting; throw = longest-throw beam that still looks like it; efficient = most light on the paint that still looks like it.' },
      { key: 'rays', label: 'Trace rays per candidate (round 1)', type: 'number', min: 50000, max: 1000000, step: 50000, default: 250000 },
      { key: 'rounds', label: 'Search rounds (1 = explore only)', type: 'range', min: 1, max: 3, step: 1, default: 3 },
    ],

    solve(input, settings, tools) {
      const t0 = Date.now();
      const GOAL = GOALS.indexOf(settings.goal) >= 0 ? settings.goal : 'faithful';
      const ROUNDS = Math.max(1, Math.min(3, Math.round(+settings.rounds || 3)));
      const BUD = (tools && tools.budget) || {};
      const MS = +BUD.ms > 0 ? +BUD.ms : 60000;
      const RAYBUD = +BUD.rays > 0 ? +BUD.rays : 2e7;
      const R1 = Math.max(20000, Math.min(1e6, +settings.rays || 250000));
      const seed = (input.seed | 0) || 20250917;

      const base = {};
      for (const f of STATIC_DEF.settings) base[f.key] = f.default;
      base.minDistance = +settings.minDistance || 0;

      // the static solver must not trace: hand it a tools object whose trace throws.
      const NO_TRACE = { progress() {}, preview() {}, budget: { rays: 0, ms: MS }, scene: tools && tools.scene,
        trace() { throw new Error('the static solver may not trace rays'); } };

      let used = 0, stopped = '';
      const tried = [];
      const fmt = (s) => 'ov ' + s.overlap + ' pen ' + s.pen + ' sat ' + s.sat + ' edge ' + s.edge +
                        ' floor ' + s.floor + ' sharp ' + s.sharp;

      function attempt(delta, rays, round, from) {
        if (stopped) return null;
        if (used + rays > RAYBUD) { stopped = 'ray budget'; return null; }
        if (Date.now() - t0 > 0.72 * MS) { stopped = 'time budget'; return null; }
        const s = Object.assign({}, from || base);
        if (typeof delta === 'function') delta(s); else Object.assign(s, delta);
        let out = null;
        try { out = STATIC_DEF.solve(input, s, NO_TRACE); } catch (e) { return null; }
        if (!out || !out.surfaces || !out.surfaces.length) return null;
        let res = null;
        try { res = tools.trace(out.surfaces, { rays: rays, seed: seed }); } catch (e) { stopped = 'trace failed'; return null; }
        used += rays;
        const rec = { s: s, out: out, res: res, rays: rays, round: round };
        tried.push(rec);
        if (tools.progress) { try { tools.progress(Math.min(0.99, used / RAYBUD)); } catch (e) {} }
        return rec;
      }

      const fidOf = (r) => (r && r.res && r.res.fidelity ? r.res.fidelity.fidelity : 0);
      // rank everything traced so far under the goal, on a common fidelity reference
      function rank() {
        let bf = 0; for (const r of tried) bf = Math.max(bf, fidOf(r));
        for (const r of tried) r.obj = objective(r, bf, GOAL);
        return tried.slice().sort((a, b) => b.obj - a.obj || fidOf(b) - fidOf(a));
      }

      /* ---- round 1: explore ---- */
      for (const d of EXPLORE) attempt(d, R1, 1);
      let order = rank(), best = order[0] || null;

      /* ---- round 2: refine around the winner ---- */
      if (ROUNDS >= 2 && best && !stopped) {
        const from = best.s;
        for (const d of REFINE) attempt(d, R1 * 3, 2, from);
        order = rank(); best = order[0] || best;
      }

      /* ---- round 3: confirm the two best settings on more rays ---- */
      if (ROUNDS >= 3 && !stopped && order.length > 1) {
        const pick = [];
        for (const r of order) { if (pick.length >= 2) break; if (pick.some((q) => fmt(q.s) === fmt(r.s))) continue; pick.push(r); }
        for (const r of pick) attempt({}, R1 * 5, 3, r.s);
        order = rank(); best = order[0] || best;
      }

      if (!best) {                                        // nothing traced: fall back to the defaults
        const out = STATIC_DEF.solve(input, base, NO_TRACE);
        return { surfaces: out.surfaces, intent: out.intent,
          notes: (out.notes || []).concat(['auto: the search produced nothing (' + (stopped || 'no candidate') + '); static defaults used']) };
      }

      const notes = (best.out.notes || []).slice();
      notes.push('auto(' + GOAL + '): ' + tried.length + ' candidates, ' + (used / 1e6).toFixed(1) + 'M rays traced in ' +
                 ((Date.now() - t0) / 1000).toFixed(1) + ' s' + (stopped ? ', stopped on the ' + stopped : '') +
                 '; chose ' + fmt(best.s));
      for (const r of order.slice(0, 4)) notes.push('  · ' + (r === best ? '→ ' : '  ') + fmt(r.s) + '  fidelity ' +
        (100 * fidOf(r)).toFixed(1) + '%, onPaint ' + (100 * (r.res.fidelity.onPaint || 0)).toFixed(1) + '%, throw ' +
        (r.res.throwM || 0).toFixed(0) + ' m, peak ' + Math.round(r.res.peakCd || 0).toLocaleString('en-US') + ' cd  [' +
        (r.rays / 1000).toFixed(0) + 'k rays, round ' + r.round + ']');
      if (tools.preview) { try { tools.preview(best.out.surfaces, { trace: best.res }); } catch (e) {} }
      return { surfaces: best.out.surfaces, intent: best.out.intent, notes: notes };
    },
  });
})();
