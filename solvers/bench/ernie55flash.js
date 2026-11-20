/* Faceted reflector solver: a static "mosaic of LED images".
 *
 * A facet (type 'facet') is an exact ellipsoid with one focus at the LED and the other at
 * its aim point, so it images the LED onto that point.  The image is the LED's shape scaled
 * by (distance to target / distance from LED) - a sharp-edged patch whose size is set by how
 * far the facet is from the LED, while how much light it catches is set by its area.
 *
 * So the design problem is: put N patches (LED images) on the target with the right sizes and
 * weights.  This solver puts the facets on a paraboloid of revolution whose focus is the LED
 * and whose axis points at the target.  A paraboloid is the natural dish for this: a ray from
 * the focus leaves parallel to the axis, so a facet's beam goes to the target without being
 * turned back into the dish.  The usable part of the dish is what is inside the envelope and
 * inside the LED's emission hemisphere.  Each facet is tilted from the local dish normal so
 * its image lands on an aim point sampled from the painting.
 *
 * Facets are sized to roughly tile the usable dish (equal share of its area), so together
 * they catch a fixed share of the LED's flux.  The painting is reproduced by the DENSITY of
 * aim points: more aims where the paint is brighter.  This is a mosaic: the resolution is the
 * LED image size (~ LED size x target distance / facet distance), which is the physical limit.
 * The focal length is chosen from the paint area and facet budget so the images cover the
 * painting with a little overlap; the whole solve is deterministic and uses no ray tracing.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const V = RF.V;

  // deterministic PRNG (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));   // golden angle

  const mosaicDef = {
    id: 'bench-ernie55flash--mosaic', name: 'LED-image mosaic (static)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'focal', label: 'Dish focal length (mm, 0 = auto)', type: 'number', min: 0, step: 1, default: 0 },
      { key: 'facetScale', label: 'Facet size (× the area share)', type: 'range', min: 0.4, max: 1.6, step: 0.05, default: 1.0 },
      { key: 'minCos', label: 'Ignore facets dimmer than this share of the LED axis', type: 'range', min: 0, max: 1, step: 0.02, default: 0.15 },
      { key: 'equalise', label: 'Equalise facet brightness (0 = equal area)', type: 'checkbox', default: false },
      { key: 'padAim', label: 'Aim padding beyond the target (−1 = off, 0 = auto)', type: 'number', min: -1, max: 30, step: 1, default: -1 },
      { key: 'fill', label: 'Aim jitter (paint cells)', type: 'range', min: 0, max: 1, step: 0.05, default: 1.0 },
    ],

    solve(input, settings) {
      const env = input.envelope, src = input.source, L = src.pos;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const budget = Math.max(1, input.limits.maxFacets | 0);
      const refl = input.limits.reflectivity;
      const T = RF.Engine.targetFrame(input.target);
      const R = input.paint.res, paint = input.paint.cells;
      const C = T.C;
      const D = V.dist(C, L);
      const axis = V.norm(V.sub(C, L));                 // dish axis = toward the target
      const ledAx = V.norm(src.axis);
      const [e1, e2] = V.basis(ledAx);                  // frame around the LED axis
      const notes = [];

      // ---------------------------------------------------------------- helpers
      // distance from the LED to the envelope wall along a unit direction (0 if none)
      const wall = (u) => {
        const iv = RF.Geo.envInterval(env, L, u);
        if (!iv) return 0;
        const t = iv[1];
        return (isFinite(t) && t > 0) ? t : 0;
      };
      // paraboloid radius: r = 2f / (1 - u·axis)
      const paraR = (u, f) => {
        const c = 1 - V.dot(u, axis);
        return c > 1e-6 ? 2 * f / c : Infinity;
      };

      // A large deterministic set of LED directions, distributed ∝ cos(LED angle) so that
      // every candidate carries the same flux (Lambertian intensity = cos).
      const M = 24000;
      const cands = [];
      for (let k = 0; k < M; k++) {
        const ct = Math.sqrt((k + 0.5) / M);            // density ∝ cos
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = k * GOLDEN;
        const u = V.add(V.mul(ledAx, ct), V.add(V.mul(e1, st * Math.cos(ph)), V.mul(e2, st * Math.sin(ph))));
        const w = RF.Source.intensity(src, Math.acos(Math.max(-1, Math.min(1, ct))));
        if (w <= 0) continue;
        cands.push({ u, ct, w, r: 0, lu: ct, un: 0 });
      }

      // ---------------------------------------------------------------- choose focal length
      // The image a facet paints has size ~ w·D/r.  With N facets we want the images to
      // cover the painting with a little overlap: s* = sqrt(cov·A_paint/N).  The focal is
      // then chosen so the mean facet distance r is near w·D/s*, but never so large that the
      // dish catches too little of the LED (a dark design scores nothing).
      let f = settings.focal > 0 ? settings.focal : 0;
      if (!(f > 0)) {
        const dEnv = Math.max(env.half[0], env.half[1], env.half[2]);
        const lo = Math.max(0.5, keep * 0.8), hi = dEnv * 2.5;
        const NTRY = 32, minFlux = 0.18;
        const cell = 2 * T.half / Math.max(1, R);
        let areaPaint = 0; for (let k = 0; k < R * R; k++) if (paint[k] > 0) areaPaint += cell * cell;
        const ledSize = src.shape === 'disc' ? 2 * (src.radius || 1)
          : src.kind !== 'planar' ? 2 * (src.radius || 1)
          : Math.max(0.2, Math.sqrt(Math.max(1e-6, (src.w || 1) * (src.h || 1))));
        const sTarget = Math.sqrt(4.5 * Math.max(1, areaPaint) / Math.max(1, budget));
        const rTarget = ledSize * D / Math.max(1e-6, sTarget);
        const rows = [];
        for (let it = 0; it < NTRY; it++) {
          const ff = lo * Math.pow(hi / lo, it / (NTRY - 1));
          let n = 0, rs = 0;
          for (let i = 0; i < cands.length; i++) {
            const c = cands[i], r = paraR(c.u, ff), rw = wall(c.u);
            if (!(r >= Math.max(keep * 1.2, 0.5)) || !(r <= 0.97 * rw)) continue;
            rs += r; n++;
          }
          rows.push({ f: ff, n, meanR: n ? rs / n : 0, frac: n / cands.length });
        }
        const ok = rows.filter((r) => r.frac >= minFlux && r.n > 0);
        if (ok.length) {
          // closest mean r to the target, but never below the f that gives the most light
          let best = ok[0], bestD = Infinity;
          for (const r of ok) { const d = Math.abs(Math.log(r.meanR / rTarget)); if (d < bestD) { bestD = d; best = r; } }
          f = best.f;
        } else {
          f = rows.reduce((a, b) => (b.meanR > a.meanR ? b : a), rows[0]).f;
        }
        notes.push('focal ' + f.toFixed(1) + ' mm (auto, image ' + sTarget.toFixed(0) + ' mm target, r* ' + rTarget.toFixed(0) + ' mm)');
      } else notes.push('focal ' + f.toFixed(1) + ' mm (set)');

      // ---------------------------------------------------------------- facet directions
      const rmin = Math.max(keep * 1.25, 1.0);
      const usable = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i], r = paraR(c.u, f), rw = wall(c.u);
        if (!(r >= rmin) || !(r <= 0.97 * rw)) continue;
        if (c.lu < (settings.minCos || 0)) continue;
        c.r = r;
        // area of the paraboloid patch this candidate stands for
        const un = Math.sqrt(Math.max(1e-6, f / r));    // |u·n| for a paraboloid
        c.un = un;
        c.area = r * r * Math.PI / (M * c.ct * un);
        c.amp = Math.max(1e-6, c.lu * un);                // ∝ illuminance per unit facet area
        usable.push(c);
      }
      if (!usable.length) {
        return { surfaces: [], intent: [], notes: ['no usable dish directions: the focal length is too large or the envelope too small'], extras: { autoFocal: f } };
      }
      const N = Math.min(budget, usable.length);
      // even stride through the (uniform) candidate list
      const stride = usable.length / N;
      const facets = [];
      for (let k = 0; k < N; k++) facets.push(usable[Math.min(usable.length - 1, Math.floor((k + 0.5) * stride))]);
      let area = 0;
      for (const c of usable) area += c.area;            // total usable dish area
      // per-facet area: equal amplitude (A ∝ 1/(cos·|u·n|)) or equal area
      let wsum = 0;
      for (const c of facets) {
        // equal contribution at a target point: E·(image area) = A·cos·|u·n|·(wD/r)^2 is
        // constant when A ∝ r²/(cos·|u·n|)
        c.wgt = settings.equalise === false ? 1 : (c.r * c.r) / c.amp;
        wsum += c.wgt;
      }
      const wmean = wsum / N;
      for (const c of facets) c.areaFacet = Math.min(area / N * 4, area / N * (c.wgt / wmean));
      notes.push(N + ' facets on the dish, total area ' + Math.round(area) + ' mm²');

      // ---------------------------------------------------------------- aim points from the paint
      // Systematic resampling of the painted cells with density ∝ paint weight.
      const aims = [];
      // mean facet distance -> image size -> how far to pad the aim region so the target's
      // edges get the same light as its middle (the images are centred outside the edge).
      let meanR = 0; for (const c of facets) meanR += c.r; meanR /= Math.max(1, N);
      const ledSize = src.shape === 'disc' ? 2 * (src.radius || 1)
        : src.kind !== 'planar' ? 2 * (src.radius || 1)
        : Math.max(0.2, Math.sqrt(Math.max(1e-6, (src.w || 1) * (src.h || 1))));
      const cell = 2 * T.half / Math.max(1, R);
      let P = settings.padAim === -1 ? 0 : settings.padAim > 0 ? settings.padAim
        : Math.round(0.5 * ledSize * D / Math.max(1e-6, meanR) / Math.max(1e-6, cell));
      P = Math.max(0, Math.min(Math.floor(R / 3), P));
      const RW = R + 2 * P;
      const pp = new Float64Array(RW * RW);
      for (let pj = 0; pj < RW; pj++) for (let pi = 0; pi < RW; pi++) {
        const i = Math.max(0, Math.min(R - 1, pi - P)), j = Math.max(0, Math.min(R - 1, pj - P));
        pp[pj * RW + pi] = paint[j * R + i];
      }
      let W = 0;
      const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, RW))));
      const morton = (i, j) => {
        let code = 0;
        for (let b = 0; b < bits; b++) { code |= ((i >> b) & 1) << (2 * b); code |= ((j >> b) & 1) << (2 * b + 1); }
        return code;
      };
      const order = [];
      for (let j = 0; j < RW; j++) for (let i = 0; i < RW; i++) order.push([morton(i, j), j * RW + i]);
      order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cdf = new Float64Array(RW * RW + 1);
      for (let n = 0; n < RW * RW; n++) { const k = order[n][1]; W += pp[k] > 0 ? pp[k] : 0; cdf[n + 1] = W; }
      if (W > 0) {
        const rnd = rng((input.seed | 0) + 12345);
        for (let n = 0; n < N; n++) {
          const target = (n + 0.5) / N * W;
          let lo = 0, hi = RW * RW;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= target) lo = m; else hi = m; }
          const k = order[Math.min(RW * RW - 1, lo)][1];
          const i = k % RW, j = (k / RW) | 0;
          const h = 2 * T.half / R;
          const u0 = -T.half + (i - P + 0.5) * h, v0 = -T.half + (j - P + 0.5) * h;
          const ju = (rnd() - 0.5) * h * settings.fill, jv = (rnd() - 0.5) * h * settings.fill;
          aims.push(RF.Engine.targetUVtoWorld(T, u0 + ju, v0 + jv));
        }
        for (let n = aims.length - 1; n > 0; n--) { const m = Math.floor(rnd() * (n + 1)); const t = aims[n]; aims[n] = aims[m]; aims[m] = t; }
      } else {
        for (let n = 0; n < N; n++) aims.push(C.slice());
      }

      // ---------------------------------------------------------------- build facets
      const surfaces = [], intent = [];
      const oct = []; for (let i = 0; i < 8; i++) oct.push([Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
      // exact check on the compiled facet: the outline carries the ellipsoid's sag, which is
      // what the host verifies (a tangent-polygon check misses facets that dip out at the rim)
      const fits = (f) => {
        let G;
        try { G = RF.Geo.compile([f]); } catch (e) { return false; }
        for (const poly of RF.Geo.outline(G, 0)) for (const p of poly) {
          if (!RF.Geo.envInside(env, p, 1e-7)) return false;
          if (keep > 0 && V.dist(p, L) < keep * (1 - 1e-5)) return false;
        }
        return true;
      };
      let used = 0, minR = Infinity, maxR = 0;
      for (let k = 0; k < N; k++) {
        const c = facets[k], Z = aims[k];
        const rUse = c.r;
        const P = V.add(L, V.mul(c.u, rUse));
        const sh = V.norm(V.sub(L, P));
        const ah = V.norm(V.sub(Z, P));
        let n = V.add(sh, ah);
        if (V.len(n) < 1e-6) continue;                  // source and aim in opposite directions: no mirror
        n = V.norm(n);
        const [ex, ey] = V.basis(n);
        const di = V.dist(Z, P);
        let rad = Math.sqrt(c.areaFacet / Math.PI) * (settings.facetScale || 1);
        let facet = null;
        for (let attempt = 0; attempt < 9; attempt++) {
          const pts3 = oct.map(([cx, cy]) => V.add(P, V.add(V.mul(ex, cx * rad), V.mul(ey, cy * rad))));
          facet = {
            type: 'facet', id: 'F' + k, group: 'A', P, S0: L.slice(), Z: Z.slice(), flat: false, di,
            clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
          };
          if (fits(facet)) break;
          rad *= 0.75;
          facet = null;
        }
        if (!facet) continue;                           // no room for a facet here
        const id = 'F' + k;
        surfaces.push(facet);
        // intent: the paint cell nearest the aim (for the inspector only)
        const [uu, vv] = RF.Engine.worldToTargetUV(T, Z);
        const ci = Math.max(0, Math.min(R - 1, Math.floor((uu + T.half) / (2 * T.half) * R)));
        const cj = Math.max(0, Math.min(R - 1, Math.floor((vv + T.half) / (2 * T.half) * R)));
        intent.push({ facet: id, cells: [[cj * R + ci, 1]] });
        used++;
        minR = Math.min(minR, c.r); maxR = Math.max(maxR, c.r);
      }
      notes.push(used + ' facets placed, r ' + minR.toFixed(1) + '–' + maxR.toFixed(1) + ' mm, image ' + (ledSize * D / Math.max(1, maxR)).toFixed(0) + ' mm (smallest)');
      return { surfaces, intent, notes, extras: { autoFocal: f, facets: used } };
    },
  };
  RF.Solvers.register(mosaicDef);

  // ------------------------------------------------------------------ the tuner (-auto)
  // It tries a small ladder of the static solver's settings, traces each candidate with the
  // SAME seed (so differences are geometry, not noise), and keeps the best for the goal.
  // Only a solver whose id ends in -auto may trace; this one is scored separately.
  function autoScore(goal, tr) {
    if (goal === 'throw') return tr.throwM || 0;
    if (goal === 'efficient') {
      // light actually delivered to the painting (onPaint), with a small peak-intensity term
      const on = tr.fidelity ? tr.fidelity.onPaint : (tr.lmOnTarget || 0) / Math.max(1e-9, (tr.energy && tr.energy.emitted) || 1);
      return on + 1e-5 * (tr.peakCd || 0);
    }
    return tr.fidelity ? tr.fidelity.fidelity : 0;
  }
  function autoCandidates(autoFocal) {
    const out = [];
    const seen = new Set();
    const push = (c) => { const k = JSON.stringify(c); if (!seen.has(k)) { seen.add(k); out.push(c); } };
    for (const m of [0.55, 0.75, 1.0, 1.35, 1.8]) push({ focal: Math.max(1, Math.round(autoFocal * m)) });
    push({ focal: 0 });                       // the static auto focal
    push({ focal: 0, facetScale: 0.8 });      // smaller facets, less mutual shadowing
    push({ focal: 0, facetScale: 1.15 });     // bigger facets, more light
    push({ focal: 0, minCos: 0.45 });         // only the bright part of the dish
    return out;
  }
  RF.Solvers.register({
    id: 'bench-ernie55flash--mosaic-auto', name: 'LED-image mosaic (auto-tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful',
        options: [{ value: 'faithful', label: 'faithful (match the painting)' }, { value: 'throw', label: 'throw (reach)' }, { value: 'efficient', label: 'efficient (of the brightness ceiling)' }] },
      { key: 'rays', label: 'Rays per candidate', type: 'number', min: 20000, max: 1000000, step: 20000, default: 200000 },
      { key: 'candidates', label: 'Max candidates', type: 'number', min: 3, max: 20, step: 1, default: 8 },
    ],
    solve(input, settings, tools) {
      const base = {};
      for (const f of mosaicDef.settings) base[f.key] = f.default;
      base.minDistance = settings.minDistance || 0;
      const first = mosaicDef.solve(input, base);
      if (!tools || typeof tools.trace !== 'function') return first;
      const autoFocal = (first.extras && first.extras.autoFocal) || 30;
      const goal = settings.goal || 'faithful';
      const limit = Math.max(3, Math.min(20, settings.candidates | 0 || 8));
      const budgetRays = tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : 2e7;
      const rays = Math.max(20000, Math.min(1000000, settings.rays | 0 || 200000, Math.floor(budgetRays / Math.max(1, limit))));
      const cands = autoCandidates(autoFocal).slice(0, limit);
      const seed = (input.seed | 0) || 1;
      let best = null, tried = 0, traced = 0;
      for (const c of cands) {
        const out = mosaicDef.solve(input, Object.assign({}, base, c));
        if (!out || !out.surfaces || !out.surfaces.length) continue;
        let tr;
        try {
          tr = tools.trace(out.surfaces, { rays, seed });
          traced++;
        } catch (e) { continue; }
        tried++;
        const score = autoScore(goal, tr);
        if (!best || score > best.score) best = { score, out, tr, c };
      }
      if (!best) return first;
      const notes = (best.out.notes || []).slice();
      notes.push('auto: goal ' + goal + ', candidate ' + JSON.stringify(best.c) + ', score ' + best.score.toFixed(4) + ' over ' + traced + ' traced candidates');
      best.out.notes = notes;
      best.out.extras = Object.assign({}, best.out.extras, { auto: { goal, candidate: best.c, score: best.score, tried, traced, rays } });
      return best.out;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);