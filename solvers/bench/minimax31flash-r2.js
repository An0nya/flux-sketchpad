/* Static painted-target reflector solver.
 *
 * The design is a direct (non-ray-tracing) optical construction:
 *   1. Sample the painting with a density proportional to its brightness.  Density is important:
 *      every facet makes an image of the finite LED, so the local light is approximately the number
 *      of facet images over the cell.  Bright paint therefore gets proportionally more images.
 *   2. Put each facet on a sparse, mostly distant shell in the LED's forward hemisphere.  A distant
 *      shell gives a smaller LED image and a layout that does not crowd one envelope corner.
 *   3. Aim every facet at a sampled painted cell.  Curved facets are exact ellipsoids with the LED
 *      and the aim point as foci, so the centre of the LED is imaged at the requested target point.
 *
 * No ray tracing is used here: all choices are functions of the scene geometry and painting.
 */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;

  // Systematic sampling of the painting.  The quantiles are taken in raster order, so a horizontal
  // stroke is sampled at regular intervals while a weighted region receives exactly the share of
  // images proportional to its painted area and brightness.  This is more stable than random
  // dart throwing, especially for the small paint grids used by the tests.
  function samplePaint(paint, res, count, seed, gamma) {
    const cells = [], cum = [];
    let total = 0;
    for (let k = 0; k < paint.length; k++) if (paint[k] > 0) {
      total += Math.pow(paint[k], gamma);
      cells.push(k); cum.push(total);
    }
    if (!cells.length || count <= 0) return [];
    const out = [];
    for (let q = 0; q < count; q++) {
      const t = (q + 0.5) / count * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < t) lo = mid + 1; else hi = mid; }
      out.push(cells[lo]);
    }
    return out;
  }

  function sourceMinSize(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h);
    if (src.kind === 'volume') return src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
    return 0.5;
  }


  // The furthest useful point of a ray from S in the envelope.  RF.Geo.envInterval gives the full
  // line interval, so choose its positive end (S is normally inside the envelope).
  function shellRadius(env, S, dir, wanted) {
    const it = RF.Geo.envInterval(env, S, dir);
    let end = isFinite(it[1]) && it[1] > 0 ? it[1] : 0;
    // A negative interval means the line misses this non-convex description.
    if (!isFinite(end) || end <= 0) return 0;
    return Math.max(0, Math.min(wanted, end));
  }

  function makeLayout(input, settings, wantedCount) {
    const Vv = RF.V, src = input.source, env = input.envelope, S = src.pos;
    const fr = RF.Source.frame(src), a = fr.a, u = fr.u, v = fr.v;
    const emitters = (input.sources && input.sources.length ? input.sources : [src]).map((x) => x.pos);
    const cosCone = Math.cos(Math.min(88 * Math.PI / 180, RF.Source.thetaMax(src) * 0.96));
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const led = Math.max(0.05, sourceMinSize(src));

    // Auto radius: as far as the forward part of the envelope permits.  The LED image then has the
    // smallest size physics permits, while the facets can be made large enough to collect useful flux.
    const dirGrid = [];
    const NA = 28;
    for (let ai = 0; ai < NA; ai++) {
      const az = 2 * Math.PI * (ai + 0.37) / NA;
      for (let ti = 0; ti < 9; ti++) {
        const th = (7 + ti * 6.2) * Math.PI / 180; // 7..56.6 degrees from the LED axis
        const d = Vv.add(Vv.mul(a, Math.cos(th)), Vv.add(Vv.mul(u, Math.sin(th) * Math.cos(az)), Vv.mul(v, Math.sin(th) * Math.sin(az))));
        if (Vv.dot(d, a) < cosCone) continue;
        const raw = shellRadius(env, S, d, 1e6);
        const margin = Math.max(12, 2 * raw * (+settings.facetScale || 0.04) + 4);
        const r = raw - margin;
        if (r > keep + 2) dirGrid.push({ d, r });
      }
    }
    dirGrid.sort((x, y) => y.r - x.r || Vv.dot(x.d, a) - Vv.dot(y.d, a));
    if (!dirGrid.length) return { points: [], R: 0, led };
    const maxR = dirGrid[0].r;
    // Setting facetDistance > 0 asks for a nearer shell; zero chooses the farthest shell that can
    // still hold the requested number of non-overlapping patches.
    const requested = Math.max(1, wantedCount | 0);
    let R = Math.max(keep + 2, Math.min(maxR, +settings.facetDistance || maxR));
    if (!settings.facetDistance) {
      const fits = dirGrid.filter((q) => q.r >= R).length;
      if (fits < requested) {
        const rr = dirGrid.slice().sort((x, y) => x.r - y.r);
        R = Math.max(keep + 2, rr[Math.max(0, rr.length - requested)].r);
      }
    }
    const points = [];
    for (const q of dirGrid) {
      const r = Math.min(R, q.r);
      if (r <= keep + 0.8) continue;
      const P = Vv.madd(S, q.d, r);
      // Keep the real patch comfortably inside the envelope and away from the clearance.
      if (!RF.Geo.envInside(env, P, -0.02)) continue;
      let clear = true;
      const reserve = 3 * r * (+settings.facetScale || 0.04) + 0.5;
      for (const E of emitters) if (Vv.dist(P, E) < keep + reserve) { clear = false; break; }
      if (!clear) continue;
      points.push(P);
    }
    points.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]));
    return { points, R, led };
  }

  RF.Solvers.register({
    id: 'bench-minimax31flash-r2--paint-static', name: 'Paint Static (direct image tiling)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'facetDistance', label: 'Facet shell distance (0 = auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'facetScale', label: 'Facet radius / shell distance', type: 'range', min: 0.005, max: 0.12, step: 0.005, default: 0.06 },
      { key: 'tiles', label: 'Number of facet images (0 = whole budget)', type: 'number', min: 0, max: 400, step: 1, default: 0 },
      { key: 'contrastGamma', label: 'Image-density contrast exponent', type: 'range', min: 0.25, max: 1.5, step: 0.05, default: 1 },
      { key: 'curved', label: 'Curve facets to focus the LED', type: 'checkbox', default: true },
      { key: 'collimate', label: 'Use collimating (parabolic) facets', type: 'checkbox', default: false },
      { key: 'coddington', label: 'Use Coddington (astigmatic) focus', type: 'checkbox', default: false },
    ],
    solve(input, settings) {
      const Vv = RF.V, T = RF.Engine.targetFrame(input.target), paint = input.paint.cells, res = input.paint.res;
      const budget = Math.max(1, input.limits.maxFacets | 0);
      const count = Math.max(1, Math.min(budget, +settings.tiles > 0 ? (+settings.tiles | 0) : budget));
      const picked = samplePaint(paint, res, count, input.seed | 0, +settings.contrastGamma || 1);
      const layout = makeLayout(input, settings, count);
      const surfaces = [], intent = [];
      const radiusScale = +settings.facetScale || 0.04;
      const cell = input.target.size / res;
      const targetQ = picked.slice(0, layout.points.length).map((k) => {
        const i = k % res, j = (k / res) | 0, uv = RF.Engine.cellCenter(T, i, j);
        return RF.Engine.targetUVtoWorld(T, uv[0], uv[1]);
      });
      const assignedP = new Int32Array(targetQ.length);
      for (let q = 0; q < targetQ.length; q++) assignedP[q] = q;

      for (let n = 0; n < targetQ.length; n++) {
        const k = picked[n], Q = targetQ[n], P = layout.points[assignedP[n]];
        const radius = Math.max(0.06, Vv.dist(P, input.source.pos) * radiusScale);
        const id = 'F' + String(n).padStart(3, '0');
        const di = Vv.dist(P, Q);
        const s = {
          type: 'facet', id, P, S0: input.source.pos.slice(), Z: Q,
          flat: !settings.curved, di: settings.curved ? (settings.collimate ? 1e308 : di) : null,
          clip: { kind: 'disc', r: radius },
          optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false },
        };
        if (settings.curved && settings.coddington && !settings.collimate) {
          s.vg = [1 / di, 1 / di];
          s.ax = Vv.norm(Vv.sub(Q, P));
        }
        surfaces.push(s);
        intent.push({ facet: id, cells: [[k, paint[k]]] });
      }
      return { surfaces, intent, notes: [
        'Direct static image tiling: ' + surfaces.length + ' facets, shell ' + layout.R.toFixed(1) + ' mm, facet radius ' + (layout.R * radiusScale).toFixed(2) + ' mm, paint cell ' + cell.toFixed(2) + ' mm.',
        'Facet images are distributed with density proportional to paint brightness; the static geometry itself uses no traced rays.'
      ] };
    },
  });

  /* Optional trace-driven tuner.  It does not alter the static solver: it asks the static solver for
   * a handful of deterministic geometries, scores those geometries with the real engine, and returns
   * the winner.  A solver id ending in -auto is permitted to trace inside solve().
   */
  RF.Solvers.register({
    id: 'bench-minimax31flash-r2--paint-static-auto', name: 'Paint Static Auto (tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' },
        { value: 'throw', label: 'Maximum throw' },
        { value: 'efficient', label: 'Efficient light' },
      ] },
    ],
    solve(input, settings, tools) {
      const base = RF.Solvers.get('bench-minimax31flash-r2--paint-static');
      const defaults = RF.Solvers.defaults(base);
      const minDistance = +settings.minDistance || 0;
      const candidates = [
        { label: 'small apertures', facetScale: 0.035 },
        { label: 'balanced', facetScale: 0.045 },
        { label: 'default', facetScale: 0.060 },
        { label: 'large apertures', facetScale: 0.080 },
        { label: '75 images', facetScale: 0.060, tiles: 75 },
        { label: '50 images', facetScale: 0.060, tiles: 50 },
        { label: 'softer contrast', facetScale: 0.060, contrastGamma: 0.75 },
      ];
      const goal = settings.goal || 'faithful';
      const budget = Math.max(1, input.limits.maxFacets | 0);
      let best = null, bestValue = -Infinity;
      for (let ci = 0; ci < candidates.length; ci++) {
        const c = candidates[ci];
        const candidateSettings = Object.assign({}, defaults, c, { minDistance });
        let out;
        try { out = base.solve(input, candidateSettings, { progress() {} }); }
        catch (e) { continue; }
        if (!out || !Array.isArray(out.surfaces) || !out.surfaces.length) continue;
        let tr = null;
        try { tr = tools.trace(out.surfaces, { rays: 120000, seed: input.seed | 0 }); }
        catch (e) { tr = null; }
        if (!tr || !tr.fidelity) continue;
        const f = tr.fidelity, e = tr.energy || {};
        const delivered = e.emitted > 0 ? (e.direct + e.reflected) / e.emitted : 0;
        const onPaint = +f.onPaint || 0;
        const placed = out.surfaces.length;
        let value;
        if (goal === 'throw') {
          // Throw rewards useful delivered flux, but a beam that does not resemble the painting is
          // not a useful throw, so fidelity remains a substantial term.
          value = 0.52 * delivered + 0.28 * onPaint + 0.20 * f.fidelity;
        } else if (goal === 'efficient') {
          // Efficiency rewards a useful, concentrated result without wasting the facet allowance.
          const spare = 1 - placed / budget;
          value = 0.40 * f.fidelity + 0.30 * delivered + 0.20 * Math.min(1, +tr.ofCeiling || 0) + 0.10 * spare;
        } else {
          // Faithful: the F1 is the headline; the two components only break near ties.
          value = f.fidelity + 0.025 * f.within + 0.015 * f.gapsDark;
        }
        if (value > bestValue) {
          bestValue = value;
          best = { out, label: c.label, value, fidelity: f.fidelity, delivered, onPaint, peak: tr.peakCd || 0, placed };
        }
        if (tools.progress) tools.progress((ci + 1) / candidates.length);
      }
      if (!best) {
        const out = base.solve(input, Object.assign({}, defaults, { minDistance }), { progress() {} });
        out.notes = (out.notes || []).concat('Auto tuning could not trace a candidate; returned the static default.');
        return out;
      }
      const out = best.out;
      out.notes = (out.notes || []).concat(
        'Auto goal ' + goal + ': selected “' + best.label + '” from ' + candidates.length + ' static candidates; ' +
        'traced fidelity ' + (100 * best.fidelity).toFixed(1) + '%, delivered ' + (100 * best.delivered).toFixed(1) +
        '%, on paint ' + (100 * best.onPaint).toFixed(1) + '%, ' + best.placed + ' facets.'
      );
      return out;
    },
  });
})();
