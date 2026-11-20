/* Deterministic paint solver: partition the painting into equal-mass spatial tiles, then
 * image the LED onto the tile centroids with ellipsoidal reflector facets.
 * The static solve() does no ray tracing or sampling.  The separately registered -auto
 * tuner may evaluate static candidates through tools.trace(), as permitted by the API.
 */
(function () {
  'use strict';
  const V = RF.V;

  function solve(input, settings) {
    const src = input.source, S = src.pos, env = input.envelope;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.designFrame(input.target), R = input.paint.res | 0;
    const paint = input.paint.cells || [], surfaces = [], intent = [], notes = [];
    const cells = [];
    let sumPaint = 0, cu = 0, cv = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = +paint[j * R + i] || 0;
      if (!(w > 0)) continue;
      const uv = RF.Engine.cellCenter(T, i, j);
      cells.push({ u: uv[0], v: uv[1], w, k: j * R + i });
      sumPaint += w; cu += uv[0] * w; cv += uv[1] * w;
    }
    if (!cells.length || !(input.limits.maxFacets > 0)) return { surfaces, intent, notes: ['nothing painted'] };
    cu /= sumPaint; cv /= sumPaint;
    const centreAim = RF.Engine.targetUVtoWorld(T, cu, cv);
    const kernel = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const sceneFocus = settings.autoFocus ? Math.max(0.1, Math.min(1, kernel.cells / 5)) : settings.focus;

    // Directions are stratified equally in emitted flux, not equally in angle.  This is
    // analytic quadrature of the source's angular distribution, not optical ray tracing.
    const fr = RF.Source.frame(src), tm = RF.Source.thetaMax(src);
    const NQ = 2048, cdf = new Float64Array(NQ + 1);
    let acc = 0, prev = RF.Source.intensity(src, 0) * Math.sin(0);
    for (let q = 1; q <= NQ; q++) {
      const th = tm * q / NQ, y = RF.Source.intensity(src, th) * Math.sin(th);
      acc += 0.5 * (prev + y) * tm / NQ; cdf[q] = acc; prev = y;
    }
    if (!(acc > 0)) return { surfaces, intent, notes: ['source has no forward emission'] };
    for (let q = 0; q <= NQ; q++) cdf[q] /= acc;
    function thetaAt(x) {
      let lo = 0, hi = NQ;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] < x) lo = m; else hi = m; }
      const den = cdf[hi] - cdf[lo], f = den > 0 ? (x - cdf[lo]) / den : 0;
      return tm * (lo + f) / NQ;
    }
    const cap = Math.min(input.limits.maxFacets | 0, cells.length), directionCount = cap * (settings.uniform ? 2 : 1);
    const exitDir = V.norm(V.sub(T.C, S)), exitCos = Math.cos(settings.aperture * Math.PI / 180);
    const dirs = [];
    for (let k = 0; k < directionCount; k++) {
      const th = thetaAt((k + 0.5) / directionCount), ph = k * Math.PI * (3 - Math.sqrt(5));
      const st = Math.sin(th), ct = Math.cos(th);
      const d = V.norm([
        ct * fr.a[0] + st * (Math.cos(ph) * fr.u[0] + Math.sin(ph) * fr.v[0]),
        ct * fr.a[1] + st * (Math.cos(ph) * fr.u[1] + Math.sin(ph) * fr.v[1]),
        ct * fr.a[2] + st * (Math.cos(ph) * fr.u[2] + Math.sin(ph) * fr.v[2])]);
      // Leave the target-facing cap open: mirrors in this cap intercept the beams
      // from the useful rear and side reflectors on their way out of the enclosure.
      if (V.dot(d, exitDir) > exitCos) continue;
      const iv = RF.Geo.envInterval(env, S, d);
      const lo = Math.max(0, iv[0], keep + Math.max(0.02, keep * 0.002)), hi = iv[1];
      if (!(hi > lo + 1e-5)) continue;
      const r = lo + settings.distance * (hi - lo), P = V.madd(S, d, r);
      const ah = V.norm(V.sub(centreAim, P)), sh = V.neg(d), n = V.norm(V.add(sh, ah));
      const ci = V.dot(n, sh);
      if (ci < 0.12) continue;                    // unusably grazing reflection
      dirs.push({ d, r, P, ci, th, lo, hi, score: RF.Source.intensity(src, th) * ci });
    }
    if (!dirs.length) return { surfaces, intent, notes: ['no envelope room outside the LED clearance'] };
    // A common source distance gives every tile the same LED magnification.  Keep the
    // 40th-percentile radius so a short side of a box does not force all facets close.
    if (settings.uniform && dirs.length > 4) {
      const rs = dirs.map((q) => q.r).sort((a, b) => a - b), r0 = rs[Math.floor(0.4 * (rs.length - 1))];
      const uniform = [];
      for (const q of dirs) {
        if (r0 < q.lo || r0 > q.hi * 0.985) continue;
        q.r = r0; q.P = V.madd(S, q.d, r0);
        const ah = V.norm(V.sub(centreAim, q.P)), sh = V.neg(q.d), n = V.norm(V.add(sh, ah));
        q.ci = V.dot(n, sh); q.score = RF.Source.intensity(src, q.th) * q.ci;
        if (q.ci >= 0.12) uniform.push(q);
      }
      if (uniform.length >= 4) {
        dirs.length = 0;
        if (uniform.length <= cap) dirs.push(...uniform);
        else for (let k = 0; k < cap; k++) dirs.push(uniform[Math.min(uniform.length - 1, Math.floor((k + 0.5) * uniform.length / cap))]);
      }
    }

    // Local angular pitch: a disc of this radius stays in its own direction cell.
    for (let i = 0; i < dirs.length; i++) {
      const near = [];
      for (let j = 0; j < dirs.length; j++) if (i !== j) near.push(Math.acos(Math.max(-1, Math.min(1, V.dot(dirs[i].d, dirs[j].d)))));
      near.sort((a, b) => a - b);
      const nn = Math.min(3, near.length);
      const pitch = nn ? near.slice(0, nn).reduce((a, x) => a + x, 0) / nn : Math.min(0.5, tm || 0.5);
      dirs[i].radius = dirs[i].r * Math.tan(0.5 * pitch) * settings.packing;
    }

    // A Hilbert ordering makes compact, deterministic tiles with EXACTLY equal paint
    // mass (a bright cell may be split between neighbours).  Equal-energy facets then
    // have a well-defined target without the cluster-size bias of ordinary k-means.
    const K = dirs.length, centres = [], groups = Array.from({ length: K }, () => []);
    const orderN = 1 << Math.ceil(Math.log2(Math.max(2, R)));
    function hilbert(x, y) {
      let d = 0;
      for (let s = orderN >> 1; s; s >>= 1) {
        const rx = (x & s) ? 1 : 0, ry = (y & s) ? 1 : 0;
        d += s * s * ((3 * rx) ^ ry);
        if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
      }
      return d;
    }
    const ordered = cells.map((p) => ({ p, h: hilbert(p.k % R, (p.k / R) | 0) })).sort((a, b) => a.h - b.h);
    let at = 0, left = ordered[0].p.w;
    for (let k = 0; k < K; k++) {
      let need = sumPaint / K, su = 0, sv = 0, sw = 0;
      while (need > 1e-10 && at < ordered.length) {
        const p = ordered[at].p, take = Math.min(need, left);
        groups[k].push({ u: p.u, v: p.v, w: take, k: p.k });
        su += p.u * take; sv += p.v * take; sw += take; need -= take; left -= take;
        if (left <= 1e-10) { at++; if (at < ordered.length) left = ordered[at].p.w; }
      }
      centres.push({ u: su / sw, v: sv / sw, weight: sw });
    }

    function facetAt(dir, Z, rad) {
      const D = V.dist(dir.P, Z);
      let di = D * sceneFocus;
      if (settings.tileBlur > 0 && dir.tileWidth > 0) {
        const focused = D / dir.r * RF.Source.extentSize(src);
        const extra = 0.5 * Math.max(0, dir.tileWidth * settings.tileBlur - focused);
        const adaptive = D / (1 + extra / Math.max(1e-6, 0.8 * rad));
        di = Math.min(di, Math.max(0.02 * D, adaptive));
      }
      return { type: 'facet', id: 'F', group: 'A', P: dir.P, S0: S.slice(), Z,
        flat: false, di,
        clip: { kind: 'disc', r: rad },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } };
    }
    function fits(s) {
      try {
        const G = RF.Geo.compile([s]);
        for (const poly of RF.Geo.outline(G, 0)) for (const p of poly) {
          if (!RF.Geo.envInside(env, p, -1e-7)) return false;
          for (const em of input.sources || [src]) if (V.dist(p, em.pos) < (env.keepOut || 0) + 1e-4) return false;
        }
        // Conservative real-surface clearance, including the interior of a curved disc.
        if (V.dist(s.P, S) - 2 * s.clip.r < keep) return false;
        for (const em of input.sources || [src]) if (V.dist(s.P, em.pos) - 2 * s.clip.r < (env.keepOut || 0)) return false;
        return true;
      } catch (e) { return false; }
    }

    // A plane/disc approximation is enough for static chief-path clearance.  Unlike an
    // optical trace this only rejects intersecting mechanical envelopes; no light rays
    // are sampled or followed through the scene.
    function normalOf(s) { return V.norm(V.add(V.norm(V.sub(s.S0, s.P)), V.norm(V.sub(s.Z, s.P)))); }
    function crossesDisc(a, b, bn, margin) {
      const dz = V.sub(a.Z, a.P), len = V.len(dz), d = V.mul(dz, 1 / len), den = V.dot(d, bn);
      if (Math.abs(den) < 1e-10) return false;
      const t = V.dot(V.sub(b.P, a.P), bn) / den;
      if (t <= 1e-5 || t >= len - 1e-5) return false;
      const q = V.sub(V.madd(a.P, d, t), b.P);
      return V.dot(q, q) < (b.clip.r * margin) ** 2;
    }

    // Match high-flux directions to high-paint tiles.  This also compensates the cosine
    // loss of oblique facets without changing the user's facet or reflectivity limits.
    const orderD = dirs.map((d, i) => i);
    const orderC = centres.map((c, i) => i).sort((a, b) => (centres[b].weight || 0) - (centres[a].weight || 0));
    const accepted = [];
    let pathDropped = 0;
    for (let n = 0; n < K; n++) {
      const di = orderD[n], ci = orderC[n], dir = dirs[di], c = centres[ci];
      if (!groups[ci].length) continue;
      let var2 = 0;
      for (const p of groups[ci]) var2 += p.w * ((p.u - c.u) ** 2 + (p.v - c.v) ** 2);
      dir.tileWidth = Math.sqrt(6 * var2 / Math.max(1e-9, c.weight));   // side of an equal-variance square
      const Z = RF.Engine.targetUVtoWorld(T, c.u, c.v);
      let rad = dir.radius, probe = facetAt(dir, Z, rad);
      if (!fits(probe)) {
        let lo = 0, hi = rad;
        for (let q = 0; q < 14; q++) { const m = 0.5 * (lo + hi); probe = facetAt(dir, Z, m); if (fits(probe)) lo = m; else hi = m; }
        rad = lo * 0.995;
      }
      if (!(rad > dir.r * 1e-4)) continue;
      const id = 'F' + surfaces.length;
      const surf = facetAt(dir, Z, rad); surf.id = id;
      const sn = normalOf(surf);
      if (settings.pathClear > 0) {
        let blocked = false;
        for (const q of accepted) {
          if (crossesDisc(surf, q.surf, q.n, settings.pathClear) || crossesDisc(q.surf, surf, sn, settings.pathClear)) { blocked = true; break; }
        }
        if (blocked) { pathDropped++; intent.push({ facet: null, cells: groups[ci].map((p) => [p.k, p.w]) }); continue; }
      }
      accepted.push({ surf, n: sn, dir, weight: c.weight || groups[ci].reduce((a, p) => a + p.w, 0) });
      surfaces.push(surf);
      intent.push({ facet: id, cells: groups[ci].map((p) => [p.k, p.w]) });
    }

    // The disc's projected area times the source's angular intensity is a static
    // flux estimate.  Reduce only the over-supplied tiles: shrinking cannot create
    // a new envelope or visibility conflict, and preserves the accepted light paths.
    if (settings.balance > 0 && accepted.length > 1) {
      const ratios = accepted.map((q) => {
        const s = q.surf, ci = Math.max(0, V.dot(q.n, V.norm(V.sub(s.S0, s.P))));
        q.flux = q.dir.score / Math.max(1e-9, q.dir.ci) * ci * Math.PI * (s.clip.r / q.dir.r) ** 2;
        return q.flux / Math.max(1e-9, q.weight);
      }).sort((a, b) => a - b);
      const ref = ratios[ratios.length >> 1];
      for (const q of accepted) {
        const ratio = q.flux / Math.max(1e-9, q.weight);
        if (ratio > ref) q.surf.clip.r *= Math.pow(ref / ratio, settings.balance / 2);
      }
    }
    notes.push(surfaces.length + ' ellipsoidal facets; equal-mass paint tiles; focus ×' + sceneFocus.toFixed(2) + '; ' + pathDropped + ' path conflicts left unplaced');
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro--static-tiles', name: 'Static equal-mass tiles', version: '0.3', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'distance', label: 'Radial position in available room', type: 'range', min: 0.05, max: 0.98, step: 0.01, default: 0.82 },
      { key: 'packing', label: 'Angular packing', type: 'range', min: 0.2, max: 0.95, step: 0.01, default: 0.75 },
      { key: 'focus', label: 'Image distance multiplier', type: 'range', min: 0.03, max: 1.6, step: 0.01, default: 1 },
      { key: 'aperture', label: 'Target-facing exit cap (deg)', type: 'range', min: 0, max: 90, step: 1, default: 0 },
      { key: 'pathClear', label: 'Chief-path clearance (× radius)', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6 },
      { key: 'balance', label: 'Paint-weight aperture balancing', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
      { key: 'uniform', label: 'Use a common-radius reflector shell', type: 'checkbox', default: false },
      { key: 'tileBlur', label: 'Tile-width adaptive defocus', type: 'range', min: 0, max: 3, step: 0.1, default: 0 },
      { key: 'autoFocus', label: 'Adapt defocus to the achievable LED image', type: 'checkbox', default: true },
    ],
    solve,
  });

  /* Optional bounded tuner.  The static registration above stays first so hosts which
   * simply choose the first paint solver retain exactly the same static behaviour. */
  RF.Solvers.register({
    id: 'bench-kimik31pro--static-tiles-auto', name: 'Static tiles — traced parameter tuner', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' },
        { value: 'throw', label: 'Throw / peak with fidelity floor' },
        { value: 'efficient', label: 'Light on paint with fidelity floor' },
      ] },
      { key: 'rays', label: 'Rays per candidate', type: 'range', min: 60000, max: 400000, step: 20000, default: 120000 },
    ],
    solve(input, settings, tools) {
      const staticDef = RF.Solvers.get('bench-kimik31pro--static-tiles');
      const base = RF.Solvers.defaults(staticDef);
      base.minDistance = settings.minDistance;
      const started = Date.now(), ray0 = settings.rays | 0;
      const results = [], seen = new Set();
      let usedRays = 0, bestFaithful = null;
      const maxMs = Math.min(48000, Math.max(1000, (tools.budget && tools.budget.ms || 60000) - 4000));
      const maxRays = Math.max(ray0, (tools.budget && tools.budget.rays || 20000000) - ray0);
      const hasPaint = input.paint && input.paint.cells && input.paint.cells.some((w) => w > 0);
      if (!hasPaint) return solve(input, base);

      function run(cfg, label, rays) {
        const key = JSON.stringify(cfg);
        if (seen.has(key + ':' + rays)) return null;
        seen.add(key + ':' + rays);
        if (Date.now() - started > maxMs || usedRays + rays > maxRays) return null;
        let out, tr;
        try {
          out = solve(input, cfg);
          tr = tools.trace(out.surfaces, { rays, seed: input.seed });
          usedRays += rays;
        } catch (e) { return null; }
        const f = tr.fidelity || {}, c = { cfg, out, tr, label,
          F: f.fidelity || 0, on: f.onPaint || 0, spill: f.spill || 1,
          peak: tr.peakCd || 0, blocked: tr.blocked || 0 };
        results.push(c);
        if (!bestFaithful || c.F > bestFaithful.F) bestFaithful = c;
        if (tools.preview) tools.preview(out.surfaces, { label, trace: tr, note: 'F ' + (100 * c.F).toFixed(1) + '% · on paint ' + (100 * c.on).toFixed(1) + '%' });
        return c;
      }
      const variant = (parent, changes) => Object.assign({}, parent, changes);

      // Exposure / spot size is the strongest scene-dependent choice.
      run(base, 'baseline', ray0);
      for (const focus of [0.06, 0.1, 0.18, 0.3, 0.5, 0.75, 1.25])
        run(variant(base, { autoFocus: false, focus }), 'focus ×' + focus, ray0);

      // Refine around the most faithful focus, not around a peak-driven outlier.
      let parent = bestFaithful || results[0];
      if (parent) {
        for (const pathClear of [0, 0.3, 1, 1.25])
          run(variant(parent.cfg, { pathClear }), 'path ' + pathClear, ray0);
        parent = bestFaithful || parent;
        for (const changes of [{ packing: 0.55 }, { packing: 0.9 }, { distance: 0.65 }, { distance: 0.94 }])
          run(variant(parent.cfg, changes), Object.keys(changes)[0] + ' ' + Object.values(changes)[0], ray0);
        parent = bestFaithful || parent;
        run(variant(parent.cfg, { packing: 0.9, distance: 0.65 }), 'dense close', ray0);
        parent = bestFaithful || parent;
        run(variant(parent.cfg, { packing: 0.9, distance: 0.94 }), 'dense far', ray0);
      }
      if (!results.length) {
        const out = solve(input, base);
        out.notes = (out.notes || []).concat('auto: no trace budget available; returned static defaults');
        return out;
      }

      const bestF = Math.max(...results.map((c) => c.F));
      function rank(c) {
        if (settings.goal === 'throw') {
          if (c.F < Math.max(0.45, bestF - 0.08)) return -Infinity;
          return Math.log1p(c.peak) + 0.2 * c.F;
        }
        if (settings.goal === 'efficient') {
          if (c.F < Math.max(0.5, bestF - 0.08)) return -Infinity;
          return c.on * (0.75 + 0.25 * c.F / Math.max(1e-9, bestF)) / (1 + 0.1 * c.blocked);
        }
        return c.F + 0.02 * c.on - 0.005 * c.spill;
      }
      const ranked = results.slice().sort((a, b) => rank(b) - rank(a) || b.F - a.F || b.on - a.on);

      // Confirm the leaders with more rays; candidates share the same seed at each
      // ray count, so their comparison uses common random numbers.
      const finalists = [];
      for (const c of ranked.slice(0, 3)) {
        const confirmed = run(c.cfg, c.label + ' confirm', Math.min(3 * ray0, 600000));
        finalists.push(confirmed || c);
      }
      finalists.sort((a, b) => rank(b) - rank(a) || b.F - a.F || b.on - a.on);
      const chosen = finalists[0] || ranked[0];
      const out = chosen.out;
      out.notes = (out.notes || []).concat(
        'auto ' + settings.goal + ': ' + chosen.label + '; ' + results.length + ' traces, ' + usedRays.toLocaleString() + ' rays, ' + (Date.now() - started) + ' ms',
        'auto settings ' + JSON.stringify(chosen.cfg),
        'tuner estimate: fidelity ' + (100 * chosen.F).toFixed(1) + '%, on paint ' + (100 * chosen.on).toFixed(1) + '%, peak ' + Math.round(chosen.peak).toLocaleString() + ' cd');
      return out;
    },
  });
})();
