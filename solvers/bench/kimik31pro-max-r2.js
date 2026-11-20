/* Flux paint solver — deterministic equal-flux angular facets and analytic image allocation.
 * No ray tracing is used: source flux, envelope room and box image footprints are computed directly.
 */
(function () {
  'use strict';
  const V = RF.V;

  function solve(input, settings) {
    const src = input.source, S = src.pos, env = input.envelope;
    const allSources = input.sources && input.sources.length ? input.sources : [src];
    const R = input.paint.res | 0, paint = input.paint.cells;
    const T = RF.Engine.designFrame(input.target);
    const cap = Math.max(0, input.limits.maxFacets | 0);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const margin = Math.max(1e-5, Math.max(...env.half) * 2e-4);
    const surfaces = [], intent = [], notes = [];
    if (!cap || !R || !paint.some((w) => w > 0)) return { surfaces, intent, notes: ['nothing to place'] };

    // Paint centroid is used only to reject geometrically impossible chief reflections.  Actual
    // aim points are allocated below, after the angular facets have been laid out.
    let sp = 0, cu = 0, cv = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = Math.max(0, paint[j * R + i] || 0); if (!w) continue;
      const uv = RF.Engine.cellCenter(T, i, j); sp += w; cu += uv[0] * w; cv += uv[1] * w;
    }
    cu /= sp; cv /= sp;
    const Zc = RF.Engine.targetUVtoWorld(T, cu, cv), fr = RF.Source.frame(src);

    // A planar LED can shine directly onto the dark part of a target (notably above a painted
    // cutoff).  A small absorber just outside clearance stops exactly that angular rectangle.
    // It is a non-reflecting part, so it does not consume the user's facet budget.
    let shield = null;
    if (settings.shield) {
      const TT = RF.Engine.targetFrame(input.target), dc = V.norm(V.sub(TT.C, S));
      const room = RF.Geo.envInterval(env, S, dc), hi = room[1] - 2 * margin;
      const want = Math.max(keep + 5 * margin, 1.5 * RF.Source.boundingRadius(src) + 2 * margin, 0.5);
      const sd = Math.min(want, hi);
      if (sd > keep + 2 * margin) {
        const C = V.madd(S, dc, sd), ex = V.inPlane(dc, TT.tu), ey = V.cross(dc, ex);
        let hx = 0, hy = 0;
        for (const su of [-1, 1]) for (const sv of [-1, 1]) {
          const Q = V.add(TT.C, V.add(V.mul(TT.tu, su * TT.half), V.mul(TT.tv, sv * TT.half)));
          const d = V.sub(Q, S), den = V.dot(d, dc); if (!(den > 1e-9)) continue;
          const q = V.sub(V.mul(d, sd / den), V.mul(dc, sd));
          hx = Math.max(hx, Math.abs(V.dot(q, ex))); hy = Math.max(hy, Math.abs(V.dot(q, ey)));
        }
        const pad = 1.15 * RF.Source.boundingRadius(src) + 3 * margin;
        hx += pad; hy += pad;
        const surface = { type: 'plane', id: 'DIRECT', group: 'A', P: C, n: dc,
          clip: { kind: 'rect', hx, hy, ref: ex }, optics: { interaction: 'absorb', reflectivity: input.limits.reflectivity, twoSided: true } };
        shield = { d: dc, dist: sd, ex, ey, hx, hy, surface };
        // If an unusually tight envelope clips the shield, retain the largest valid central part.
        for (let k = 0; k < 16 && !fits(surface); k++) {
          hx *= 0.9; hy *= 0.9; shield.hx = hx; shield.hy = hy; surface.clip.hx = hx; surface.clip.hy = hy;
        }
        if (!fits(surface) || hx <= 0 || hy <= 0) shield = null;
      }
    }
    function sourceBlocked(d, r) {
      if (!shield) return false;
      const den = V.dot(d, shield.d); if (den <= 1e-9) return false;
      const t = shield.dist / den; if (!(t > 0 && t < r)) return false;
      const q = V.sub(V.mul(d, t), V.mul(shield.d, shield.dist));
      return Math.abs(V.dot(q, shield.ex)) <= shield.hx && Math.abs(V.dot(q, shield.ey)) <= shield.hy;
    }
    function outgoingBlocked(P, a, len) {
      if (!shield) return false;
      const den = V.dot(a, shield.d); if (Math.abs(den) < 1e-9) return false;
      const C = V.madd(S, shield.d, shield.dist), t = V.dot(V.sub(C, P), shield.d) / den;
      if (!(t > 0 && t < len)) return false;
      const q = V.sub(V.madd(P, a, t), C);
      return Math.abs(V.dot(q, shield.ex)) <= shield.hx && Math.abs(V.dot(q, shield.ey)) <= shield.hy;
    }

    // Equal-probability inverse CDF for the source's polar emission distribution.  Sampling in
    // this coordinate (rather than uniformly in theta) gives every angular band the same flux.
    const tm = RF.Source.thetaMax(src), NT = 2048, cdf = new Float64Array(NT + 1);
    for (let k = 0; k < NT; k++) {
      const t = (k + 0.5) / NT * tm;
      cdf[k + 1] = cdf[k] + Math.max(0, RF.Source.intensity(src, t)) * Math.sin(t);
    }
    for (let k = 0; k <= NT; k++) cdf[k] /= cdf[NT] || 1;
    function thetaAt(q) {
      let lo = 0, hi = NT;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= q) lo = m; else hi = m; }
      const den = cdf[lo + 1] - cdf[lo];
      return (lo + (den > 0 ? (q - cdf[lo]) / den : 0.5)) / NT * tm;
    }
    function direction(theta, phi) {
      const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(phi), sphi = Math.sin(phi);
      return [ct * fr.a[0] + st * (cp * fr.u[0] + sphi * fr.v[0]),
              ct * fr.a[1] + st * (cp * fr.u[1] + sphi * fr.v[1]),
              ct * fr.a[2] + st * (cp * fr.u[2] + sphi * fr.v[2])];
    }

    // Low-discrepancy candidates in equal-flux polar bands.  Retaining equal numbers of valid
    // candidates per band covers the reachable emission instead of spending the cap on one wall.
    const M = Math.max(1200, cap * 16), candidates = [];
    for (let k = 0; k < M; k++) {
      const q = (k + 0.5) / M, th = thetaAt(q), ph = 2 * Math.PI * ((k * 0.6180339887498949 + 0.173) % 1);
      const d = direction(th, ph), room = RF.Geo.envInterval(env, S, d);
      const lo = Math.max(0, room[0], keep + margin), hi = room[1] - margin;
      if (!(hi > lo + 4 * margin)) continue;
      const r = lo + settings.distanceOut * (hi - lo), P = V.madd(S, d, r);
      if (allSources.some((s) => V.dist(P, s.pos) < keep + 2 * margin)) continue;
      if (sourceBlocked(d, r)) continue;
      const a = V.norm(V.sub(Zc, P));
      if (V.dot(a, T.n) >= -1e-5) continue;                 // chief ray must meet the lit face
      if (outgoingBlocked(P, a, V.dist(P, Zc))) continue;   // do not design light into the absorber
      const sh = V.neg(d), n = V.norm(V.add(sh, a)), ci = V.dot(n, sh);
      if (ci < 0.22 || !isFinite(ci)) continue;              // beyond ~77 degrees is useless area
      const inten = RF.Source.intensity(src, th);
      if (!(inten > 0)) continue;
      candidates.push({ d, th, r, P, a, n, ci, inten, out: V.dot(a, d), q });
    }
    if (!candidates.length) return { surfaces, intent, notes: ['no emitting direction has room for a facet'] };

    const facets = [], used = new Set();
    for (let i = 0; i < cap; i++) {
      let k = Math.min(candidates.length - 1, Math.floor((i + 0.5) * candidates.length / cap));
      while (used.has(k) && k + 1 < candidates.length) k++;
      if (!used.has(k)) { used.add(k); facets.push(Object.assign({}, candidates[k])); }
    }

    // Angular discs are limited by their nearest neighbour, so one facet cannot sit in another's
    // source cone.  A global cap avoids large, aberrated images near the edge of the envelope.
    for (let i = 0; i < facets.length; i++) {
      let nearest = Math.PI;
      for (let j = 0; j < facets.length; j++) if (i !== j) {
        const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(facets[i].d, facets[j].d))));
        if (ang < nearest) nearest = ang;
      }
      const ar = Math.max(0.006, Math.min(settings.aperture, 0.44 * nearest));
      const f = facets[i]; f.arMax = ar; f.ar = ar; f.h = f.r * ar;
      // Solid angle times source intensity; common constants cancel in the allocation.
      f.flux = f.inten * Math.PI * ar * ar * f.ci;
    }

    // Cap the brightest indivisible units of light.  Facets already limited by angular spacing
    // stay at that cap; brighter, isolated facets give up area for a less quantised target.
    if (settings.equalFlux) {
      const total = facets.reduce((s, f) => s + f.flux, 0);
      const sorted = facets.map((f) => f.flux).sort((a, b) => a - b);
      const Q = sorted[Math.min(sorted.length - 1, Math.floor(settings.fluxLevel * (sorted.length - 1)))];
      for (const f of facets) {
        f.flux = Math.min(f.inten * Math.PI * f.ci * f.arMax * f.arMax, Q);
        f.ar = Math.sqrt(f.flux / Math.max(1e-30, f.inten * Math.PI * f.ci));
        f.h = f.r * f.ar;
      }
      notes.push('modeled flux cap p' + Math.round(settings.fluxLevel * 100) + ': retained ' + Math.round(100 * facets.reduce((s, f) => s + f.flux, 0) / Math.max(1e-30, total)) + '% of the maximum-aperture layout');
    }

    const N = facets.length, cellU = 2 * T.half / R, cellV = cellU;
    const srcW = src.kind === 'point' ? 0 : src.shape === 'rect' ? (src.w || 0) : 2 * (src.radius || 0);
    const srcH = src.kind === 'point' ? 0 : src.shape === 'rect' ? (src.h || 0) : 2 * (src.radius || 0);
    const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const focusFactor = settings.adaptive && ker.cells < settings.flatBelow ? 0 : settings.focus;
    // First-order source-image widths.  This deliberately simple footprint was more effective
    // than a conservative aperture-enlarged flat model (see NOTES.md); the trace remains the
    // authority and the allocation passes compensate for the finite facet set.
    for (const f of facets) {
      const mag = V.dist(f.P, Zc) / f.r;
      f.kw = Math.max(1, Math.min(R, Math.round(settings.imageScale * srcW * mag / cellU)));
      f.kh = Math.max(1, Math.min(R, Math.round(settings.imageScale * srcH * mag / cellV)));
      f.aim = 0;
    }

    // The reference is the scorer's physically admissible blurred painting.  Matching it avoids
    // asking positive images for an impossible sharp cutoff, while retaining dark gaps.
    const modelPaint = paint.map((w) => w > 0 ? Math.pow(w, settings.tone) : 0);
    const target = RF.Photometry.boxBlur(modelPaint, R, Math.max(0, ker.cells * settings.targetBlur));
    let ts = 0; for (let k = 0; k < target.length; k++) ts += target[k];
    let qs = 0; for (const f of facets) qs += f.flux;
    if (!(ts > 0) || !(qs > 0)) return { surfaces, intent, notes: ['paint or reachable source flux is zero'] };
    const scale = qs / ts; for (let k = 0; k < target.length; k++) target[k] *= scale;

    // Initial weighted stratification gives every painted level its share of captured flux.
    const pcdf = new Float64Array(paint.length + 1);
    let spm = 0; for (let k = 0; k < paint.length; k++) { pcdf[k + 1] = pcdf[k] + modelPaint[k]; spm += modelPaint[k]; }
    const order = facets.map((_, i) => i).sort((a, b) => {
      const ha = ((a + 1) * 2654435761) >>> 0, hb = ((b + 1) * 2654435761) >>> 0;
      return ha - hb || a - b;
    });
    let accum = 0;
    for (const fi of order) {
      const f = facets[fi], wanted = (accum + 0.5 * f.flux) / qs * spm; accum += f.flux;
      let lo = 0, hi = paint.length;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pcdf[m] <= wanted) lo = m; else hi = m; }
      f.aim = Math.min(paint.length - 1, lo);
    }

    function bounds(f, aim) {
      const ai = aim % R, aj = (aim / R) | 0;
      const l = Math.round(ai - (f.kw - 1) / 2), b = Math.round(aj - (f.kh - 1) / 2);
      return [Math.max(0, l), Math.max(0, b), Math.min(R - 1, l + f.kw - 1), Math.min(R - 1, b + f.kh - 1), l, b];
    }
    const grid = new Float64Array(R * R);
    function add(f, sign) {
      const bd = bounds(f, f.aim), den = f.kw * f.kh, v = sign * f.flux / den;
      for (let j = bd[1]; j <= bd[3]; j++) for (let i = bd[0]; i <= bd[2]; i++) grid[j * R + i] += v;
    }
    for (const f of facets) add(f, 1);

    // Aim only at actual paint.  In particular, do not let a zero-residual corner become a dumping
    // ground for an awkwardly bright facet: real far-field haze is penalised even when the model's
    // residual there is zero.
    const aimCells = []; for (let k = 0; k < paint.length; k++) if (paint[k] > 0) aimCells.push(k);

    // Coordinate descent with an analytic box model, not a ray trace.  For one removed facet the
    // best rectangle is obtained from a summed-area table of the residual, in O(R^2).
    for (let pass = 0; pass < settings.passes; pass++) {
      for (const fi of order) {
        const f = facets[fi]; add(f, -1);
        const ii = new Float64Array((R + 1) * (R + 1));
        for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
          const k = j * R + i;
          ii[(j + 1) * (R + 1) + i + 1] = target[k] - grid[k] + ii[j * (R + 1) + i + 1] + ii[(j + 1) * (R + 1) + i] - ii[j * (R + 1) + i];
        }
        let best = -Infinity, bestAim = f.aim;
        const area = f.kw * f.kh;
        for (const aim of aimCells) {
          const bd = bounds(f, aim), nx = bd[2] - bd[0] + 1, ny = bd[3] - bd[1] + 1;
          if (nx <= 0 || ny <= 0) continue;
          const x0 = bd[0], y0 = bd[1], x1 = bd[2] + 1, y1 = bd[3] + 1;
          const sum = ii[y1 * (R + 1) + x1] - ii[y0 * (R + 1) + x1] - ii[y1 * (R + 1) + x0] + ii[y0 * (R + 1) + x0];
          const merit = 2 * f.flux * sum / area - f.flux * f.flux * nx * ny / (area * area);
          if (merit > best + 1e-14) { best = merit; bestAim = aim; }
        }
        f.aim = bestAim; add(f, 1);
      }
    }

    function makeSurface(f, h) {
      const i = (f.aim / R) | 0, j = f.aim % R;
      const uv = RF.Engine.cellCenter(T, j, i), Z = RF.Engine.targetUVtoWorld(T, uv[0], uv[1]);
      return { type: 'facet', id: 'F' + surfaces.length, group: 'A', P: f.P.slice(), S0: S.slice(), Z,
        flat: focusFactor <= 0, di: focusFactor > 0 ? V.dist(f.P, Z) * focusFactor : null,
        clip: { kind: 'disc', r: h }, optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } };
    }
    function fits(s) {
      if (s.P && (!RF.Geo.envInside(env, s.P, -1e-4) || allSources.some((src0) => V.dist(s.P, src0.pos) < keep + margin))) return false;
      let G;
      try { G = RF.Geo.compile([s]); } catch (_) { return false; }
      for (const poly of RF.Geo.outline(G, 0)) {
        for (const p of poly) {
          if (!RF.Geo.envInside(env, p, -1e-4)) return false;
          if (allSources.some((src0) => V.dist(p, src0.pos) < keep + margin)) return false;
        }
        const c = V.mul(poly.reduce((a, p) => V.add(a, p), [0, 0, 0]), 1 / poly.length);
        if (!RF.Geo.envInside(env, c, -1e-4) || allSources.some((src0) => V.dist(c, src0.pos) < keep + margin)) return false;
      }
      return true;
    }

    for (const f of facets) {
      let h = f.h * 0.985, s = makeSurface(f, h), tries = 0;
      while (!fits(s) && tries++ < 24) { h *= 0.86; s = makeSurface(f, h); }
      if (!fits(s) || h < Math.max(0.03, f.r * 0.002)) continue;
      s.id = 'F' + surfaces.length; surfaces.push(s); intent.push({ facet: s.id, cells: [[f.aim, 1]] });
    }
    if (shield) surfaces.push(shield.surface);
    notes.push(surfaces.length - (shield ? 1 : 0) + (focusFactor > 0 ? ' focused' : ' flat') + ' facets' + (shield ? ' plus a direct-light shield' : '') + '; analytic equal-flux layout, ' + settings.passes + ' box-image allocation passes; LED-image allowance ' + ker.cells.toFixed(2) + ' cells');
    return { surfaces, intent, notes };
  }

  const staticDefinition = {
    id: 'bench-kimik31pro-max-r2--static-images', name: 'Static focused image allocator', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'shield', label: 'Block direct LED light to the target', type: 'checkbox', default: true },
      { key: 'equalFlux', label: 'Cap bright facets to equalise flux', type: 'checkbox', default: true },
      { key: 'fluxLevel', label: 'Flux-cap percentile', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.6 },
      { key: 'aperture', label: 'Maximum facet angular radius', type: 'range', min: 0.025, max: 0.16, step: 0.005, default: 0.085 },
      { key: 'distanceOut', label: 'Facet position along available room', type: 'range', min: 0.35, max: 0.98, step: 0.01, default: 0.9 },
      { key: 'focus', label: 'Image distance factor (0 = flat)', type: 'range', min: 0, max: 1.5, step: 0.05, default: 1 },
      { key: 'adaptive', label: 'Use flat facets below the small-kernel threshold', type: 'checkbox', default: true },
      { key: 'flatBelow', label: 'Adaptive flat-facet kernel threshold (cells)', type: 'range', min: 0, max: 4, step: 0.1, default: 1.5 },
      { key: 'imageScale', label: 'Analytic image width factor', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
      { key: 'targetBlur', label: 'Physically blurred target factor', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
      { key: 'tone', label: 'Allocation paint-weight exponent', type: 'range', min: 0.25, max: 1.5, step: 0.05, default: 1 },
      { key: 'passes', label: 'Analytic allocation passes', type: 'range', min: 0, max: 5, step: 1, default: 2 },
    ],
    solve,
  };
  RF.Solvers.register(staticDefinition);

  /* Optional traced tuner.  Every candidate is still made by the static algorithm above; the
   * trace only chooses among those deterministic geometries.  Common seed and ray count make
   * candidates comparable, and the returned object is an ordinary static-solver result. */
  RF.Solvers.register({
    id: 'bench-kimik31pro-max-r2--static-images-auto', name: 'Static image allocator (traced parameter tuner)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' }, { value: 'throw', label: 'Throw / peak intensity' }, { value: 'efficient', label: 'Light on paint' },
      ] },
      { key: 'rays', label: 'Rays per candidate', type: 'number', min: 20000, max: 500000, step: 10000, default: 250000 },
    ],
    solve(input, settings, tools) {
      const base = RF.Solvers.defaults(staticDefinition);
      base.minDistance = settings.minDistance;
      const fallback = () => solve(input, base, tools);
      if (!tools || typeof tools.trace !== 'function' || !input.paint.cells.some((w) => w > 0)) return fallback();

      let variants;
      if (settings.goal === 'throw') variants = [
        {},
        { adaptive: false, focus: 1, aperture: 0.06, fluxLevel: 0.8 },
        { adaptive: false, focus: 1, aperture: 0.115, fluxLevel: 1 },
        { adaptive: false, focus: 1, shield: false, aperture: 0.085, fluxLevel: 1 },
        { aperture: 0.06, fluxLevel: 0.8, passes: 5 },
        { distanceOut: 0.98, aperture: 0.06, fluxLevel: 0.8 },
        { distanceOut: 0.7, aperture: 0.13, fluxLevel: 1 },
        { adaptive: false, focus: 0, aperture: 0.06, fluxLevel: 0.8 },
      ];
      else if (settings.goal === 'efficient') variants = [
        {},
        { aperture: 0.13, fluxLevel: 1 },
        { shield: false },
        { shield: false, aperture: 0.13, fluxLevel: 1 },
        { distanceOut: 0.7, aperture: 0.13, fluxLevel: 1 },
        { distanceOut: 0.98, aperture: 0.13, fluxLevel: 1 },
        { adaptive: false, focus: 0, aperture: 0.13, fluxLevel: 1 },
        { adaptive: false, focus: 1, aperture: 0.13, fluxLevel: 1 },
      ];
      else variants = [
        {},
        { passes: 5 },
        { fluxLevel: 0.4 },
        { fluxLevel: 0.8 },
        { aperture: 0.06 },
        { aperture: 0.115 },
        { distanceOut: 0.98 },
        { targetBlur: 0.75 },
      ];

      const results = [];
      for (let i = 0; i < variants.length; i++) {
        const cfg = Object.assign({}, base, variants[i]);
        let out = null, tr = null;
        try {
          out = solve(input, cfg, tools);
          if (!out.surfaces.length) continue;
          tr = tools.trace(out.surfaces, { rays: settings.rays, seed: input.seed });
        } catch (_) { continue; }
        const f = tr.fidelity;
        results.push({ out, tr, cfg, index: i, fidelity: f ? f.fidelity : 0, onPaint: f ? f.onPaint : 0,
          peak: tr.peakCd || 0, throwM: tr.throwM || 0, lm: tr.lmOnTarget || 0 });
        if (tools.progress) tools.progress((i + 1) / variants.length);
      }
      if (!results.length) return fallback();
      const bestF = Math.max(1e-12, ...results.map((r) => r.fidelity));
      const maxP = Math.max(1e-12, ...results.map((r) => r.onPaint));
      for (const r of results) {
        r.light = Math.min(1, r.onPaint / (0.1 * maxP));
        if (settings.goal === 'faithful') r.rank = r.fidelity * r.light;
        else if (settings.goal === 'throw') {
          const guard = r.fidelity >= 0.55 * bestF ? 1 : 0.05;
          r.rank = guard * r.peak * (0.5 + 0.5 * r.fidelity / bestF) * r.light;
        } else {
          const guard = r.fidelity >= 0.6 * bestF ? 1 : 0.05;
          r.rank = guard * r.onPaint * (0.65 + 0.35 * r.fidelity / bestF) * r.light;
        }
      }
      results.sort((a, b) => b.rank - a.rank || b.fidelity - a.fidelity || a.index - b.index);
      const win = results[0], out = Object.assign({}, win.out);
      out.notes = (out.notes || []).concat(settings.goal + ' tuner: candidate ' + (win.index + 1) + '/' + variants.length + ' won at ' + settings.rays + ' common-seed rays; fidelity ' + (100 * win.fidelity).toFixed(1) + '%, on paint ' + (100 * win.onPaint).toFixed(1) + '%, peak ' + Math.round(win.peak) + ' cd');
      out.extras = Object.assign({}, out.extras, { tuner: { goal: settings.goal, rays: settings.rays,
        candidates: results.map((r) => ({ index: r.index + 1, settings: variants[r.index], fidelity: r.fidelity, onPaint: r.onPaint, peakCd: r.peak, throwM: r.throwM, lmOnTarget: r.lm, rank: r.rank })) } });
      return out;
    },
  });
})();
