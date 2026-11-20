/* Static paint solver: a disjoint shell of ellipsoidal facets around the LED.
 *
 * 1. Sample LED directions on a Fibonacci lattice, keep the ones inside the envelope /
 *    emission cone / away from the target half-space, and pick a spread of high-flux ones.
 * 2. Give each one a disc aperture sized by its angular spacing (and equalised for LED cosine).
 * 3. Assign aims by greedy coverage: each successive facet goes where painted weight per
 *    already-illuminated area is largest.  Spots are the LED image (plus deliberate defocus
 *    when the paint has more cells than facets), so coverage is measured in paint cells.
 * No rays are traced here: all of this is geometry and the LED's analytic intensity.
 */
(function () {
  'use strict';
  const STATIC_SOLVER = {
    id: 'bench-hy4flash-max--reflect-paint', name: 'Reflect paint (static shell)', version: '0.2',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'radiusFrac', label: 'Shell distance fraction', type: 'range', min: 0.3, max: 0.98, step: 0.02, default: 0.85 },
      { key: 'tileScale', label: 'Facet size', type: 'range', min: 0.3, max: 3, step: 0.05, default: 2 },
      { key: 'backBias', label: 'Max direction toward target', type: 'range', min: -0.9, max: 0.9, step: 0.05, default: -0.1 },
      { key: 'cosMin', label: 'Min LED cosine', type: 'range', min: 0, max: 0.9, step: 0.02, default: 0.05 },
      { key: 'incMin', label: 'Min reflection cosine', type: 'range', min: 0.05, max: 0.9, step: 0.02, default: 0.2 },
      { key: 'spread', label: 'Directional spread', type: 'range', min: 0.3, max: 2, step: 0.05, default: 0.9 },
      { key: 'blurGain', label: 'Defocus gain', type: 'range', min: 0, max: 4, step: 0.05, default: 0.75 },
      { key: 'focusFrac', label: 'Image distance (0 = auto)', type: 'range', min: 0, max: 1, step: 0.02, default: 0 },
      { key: 'erode', label: 'Keep aims inside paint (cells)', type: 'range', min: 0, max: 5, step: 0.5, default: 2 },
      { key: 'edgePenalty', label: 'Avoid aims next to gaps', type: 'range', min: 0, max: 8, step: 0.25, default: 0 },
      { key: 'useVG', label: 'Two-curvature facets', type: 'checkbox', default: false },
    ],
    solve(input, settings) {
      const V = RF.V, env = input.envelope, src = input.source, T = RF.Engine.targetFrame(input.target);
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const N = Math.max(1, input.limits.maxFacets | 0), R = input.limits.reflectivity;
      const rng = new RF.rng.Rng((input.seed | 0) ^ 0x51a7);
      const paint = input.paint.cells, res = input.paint.res, ncell = res * res;
      const fr = RF.Source.frame(src), aimC = V.norm(V.sub(T.C, src.pos));
      const thetaMax = src.kind === 'planar' ? (src.dist === 'cone' ? RF.U.rad(src.halfAngle || 60) : Math.PI / 2)
        : (src.dist === 'cone' ? RF.U.rad(src.halfAngle || 60) : Math.PI);
      const cosMax = Math.cos(thetaMax);
      let painted = 0, psum = 0;
      for (let k = 0; k < ncell; k++) if (paint[k] > 0) { painted++; psum += paint[k]; }

      // ---- candidate directions -------------------------------------------------------
      const M = Math.min(1200, Math.max(256, 10 * N)), GA = Math.PI * (3 - Math.sqrt(5));
      const cand = [];
      for (let k = 0; k < M; k++) {
        const ct = 1 - ((k + 0.5) / M) * (1 - cosMax), st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const phi = k * GA + 0.37;
        const d = V.add(V.mul(fr.a, ct), V.add(V.mul(fr.u, st * Math.cos(phi)), V.mul(fr.v, st * Math.sin(phi))));
        if (V.dot(d, aimC) > settings.backBias || ct < settings.cosMin) continue;
        const iv = RF.Geo.envInterval(env, src.pos, d), tout = iv[1];
        if (!(tout > keep + 3)) continue;
        let r = tout * settings.radiusFrac;
        if (r < keep + 2) continue;
        const P = V.madd(src.pos, d, r);
        const sh = V.neg(d), ah = V.norm(V.sub(T.C, P)), inc = V.dot(sh, ah);
        if (inc < settings.incMin) continue;
        const I = RF.Source.intensity(src, Math.acos(Math.min(1, ct)));
        cand.push({ d, r, P, inc, q: I * Math.max(0, inc), ct });
      }
      if (!cand.length) return { surfaces: [], intent: [], notes: ['no usable direction in the envelope'] };
      // weighted farthest-point selection: high flux, but directions stay apart
      const sep = Math.sqrt(4 * Math.PI / Math.max(4, N)) * settings.spread * 0.55;
      const nc = cand.length, dots = new Float32Array(nc * nc);
      for (let i = 0; i < nc; i++) for (let j = 0; j < nc; j++) dots[i * nc + j] = V.dot(cand[i].d, cand[j].d);
      const chosen = [], chosenIdx = [];
      for (let pass = 0; pass < Math.min(N, nc); pass++) {
        let bi = -1, bs = -Infinity;
        for (let i = 0; i < nc; i++) {
          if (cand[i].used) continue;
          let crowding = 0;
          for (const j of chosenIdx) {
            const a = Math.sqrt(Math.max(0, 2 * (1 - dots[i * nc + j])));
            crowding += Math.exp(-((a / sep) ** 2));
          }
          const s = cand[i].q / (1 + crowding);
          if (s > bs) { bs = s; bi = i; }
        }
        cand[bi].used = true; chosen.push(cand[bi]); chosenIdx.push(bi);
      }
      // nearest angular neighbour sets the aperture; cap it by the envelope and LED clearance
      const minAng = chosen.map((c, i) => {
        let m = Infinity;
        for (let j = 0; j < chosen.length; j++) if (j !== i) m = Math.min(m, 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, (1 - dots[chosenIdx[i] * nc + chosenIdx[j]]) / 2)))));
        return isFinite(m) ? m : 0.35;
      });
      for (let i = 0; i < chosen.length; i++) {
        const c = chosen[i];
        const sh = V.neg(c.d), ah = V.norm(V.sub(T.C, c.P)), nrm = V.norm(V.add(sh, ah));
        const ex = V.inPlane(nrm, aimC), ey = V.cross(nrm, ex);
        let rad = settings.tileScale * Math.min(c.r * Math.sin(minAng[i] / 2) * 0.85, c.r * 0.16);
        // equalise the flux each tile catches: ∝ intensity × cosine / area
        const fl = c.q / Math.max(1e-6, rad * rad);
        const fmean = chosen.reduce((s, q2) => s + q2.q / Math.max(1e-6, (settings.tileScale * Math.min(q2.r * Math.sin(minAng[chosen.indexOf(q2)] / 2) * 0.85, q2.r * 0.16)) ** 2), 0) / chosen.length;
        rad *= Math.max(0.6, Math.min(1.6, Math.sqrt(fmean / fl)));
        // The safe radius is monotone: bisect it against the envelope and LED clearance.
        // The extra margin covers the sag of the curved ellipsoid between its outline corners.
        const fits = (a) => {
          for (const s of [-1, 1]) for (const t of [-1, 1]) {
            const q = V.add(c.P, V.add(V.mul(ex, s * a), V.mul(ey, t * a)));
            if (!RF.Geo.envInside(env, q, -0.02) || V.dist(q, src.pos) < keep + 1.2) return false;
          }
          return true;
        };
        if (!fits(rad)) {
          let lo = 0, hi = rad;
          for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
          rad = lo;
        }
        c.rad = Math.max(0.4, rad); c.ex = ex; c.ey = ey; c.nrm = nrm;
      }

      // ---- spot size and greedy aim assignment ---------------------------------------
      const cell = 2 * T.half / res, D = V.dist(T.C, src.pos);
      const ledMin = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h))
        : (src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius);
      let radMean = 0; for (const c of chosen) radMean += c.rad; radMean /= chosen.length;
      let rMean = 0; for (const c of chosen) rMean += c.r; rMean /= chosen.length;
      const natural = ledMin * D / Math.max(1, rMean) / cell;        // LED image width, cells
      const wanted = Math.max(1, Math.sqrt(Math.max(1, painted) / Math.max(1, chosen.length)));
      let focus = D;
      if (settings.focusFrac > 0) focus = D * settings.focusFrac;
      else if (settings.blurGain > 0) {
        // The smallest LED image the envelope can make sets the native spot width.  When the
        // painting has fewer cells than facets can cover at that width, defocus by moving the
        // image in front of the target: the mirror aperture then paints a patch about as wide
        // as one facet's share of the painting.
        const kern = RF.Photometry.achievableKernel(input).cells;
        if (kern > 0 && kern < 2 * Math.sqrt(painted / Math.max(1, chosen.length))) {
          const targetWidth = 4 * Math.sqrt(painted / Math.max(1, chosen.length));
          const extra = settings.blurGain * (targetWidth - kern) * cell / 2;
          focus = Math.max(D * 0.03, D / (1 + extra / Math.max(0.5, radMean)));
        }
      }
      const kernCells = RF.Photometry.achievableKernel(input).cells;
      const spotRadius = (kernCells > 0 ? kernCells / 2 : natural / 2) + radMean * Math.max(0, D / focus - 1) / cell;
      const sigma = Math.max(0.55, 0.35 * Math.max(natural, wanted), 0.45 * spotRadius);
      const rad = Math.ceil(Math.min(res, 3 * sigma));
      const illum = new Float64Array(ncell), seen = new Uint8Array(ncell);
      // static spill sensitivity: how much of a spot centred on a cell would fall on unpainted cells
      const sens = new Float64Array(ncell);
      const thin = (() => { // a broad LED image cannot respect thin strokes: pull the aims toward their centres
        if (!(kernCells > 4)) return false;
        let thinCount = 0;
        for (let k = 0; k < ncell; k++) {
          if (!(paint[k] > 0)) continue;
          const ci = k % res, cj = (k / res) | 0;
          let edge = false;
          for (const [di, dj] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
            const ii = ci + di, jj = cj + dj;
            if (ii < 0 || jj < 0 || ii >= res || jj >= res || !(paint[jj * res + ii] > 0)) { edge = true; break; }
          }
          if (edge) thinCount++;
        }
        return thinCount > 0.5 * painted;
      })();
      const penalty = settings.edgePenalty + (thin ? 2.5 : 0);
      if (penalty > 0) {
        const kw = []; let ksum = 0;
        for (let d = -rad; d <= rad; d++) { const q = Math.exp(-(d * d) / (2 * sigma * sigma)); kw.push(q); ksum += q; }
        const tmp = new Float64Array(ncell);
        for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
          let s = 0;
          for (let d = -rad; d <= rad; d++) { const ii = i + d; if (ii >= 0 && ii < res) s += kw[d + rad] * (paint[j * res + ii] > 0 ? 0 : 1); }
          tmp[j * res + i] = s / ksum;
        }
        for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
          let s = 0;
          for (let d = -rad; d <= rad; d++) { const jj = j + d; if (jj >= 0 && jj < res) s += kw[d + rad] * tmp[jj * res + i]; }
          sens[j * res + i] = s / ksum;
        }
      }
      // erosion: aim only at cells whose neighbourhood is painted, so a finite image does not flood the gaps
      const okAim = new Uint8Array(ncell);
      const maskFor = (E) => {
        okAim.fill(0);
        let count = 0;
        for (let k = 0; k < ncell; k++) {
          if (!(paint[k] > 0)) continue;
          const ci = k % res, cj = (k / res) | 0;
          let clear = true;
          for (let dj = -E; dj <= E && clear; dj++) for (let di = -E; di <= E; di++) {
            if (di * di + dj * dj > E * E + 0.25) continue;
            const ii = ci + di, jj = cj + dj;
            if (ii < 0 || jj < 0 || ii >= res || jj >= res || !(paint[jj * res + ii] > 0)) { clear = false; break; }
          }
          if (clear) { okAim[k] = 1; count++; }
        }
        return count;
      };
      let erodeUsed = 0;
      for (let e = Math.ceil(settings.erode); e >= 0; e--) {
        if (maskFor(e) >= Math.max(8, 0.02 * painted)) { erodeUsed = e; break; }
      }
      if (erodeUsed > 0) maskFor(erodeUsed);
      const surfaces = [], intent = [], notes = [];
      for (let i = 0; i < chosen.length; i++) {
        let bestCell = -1, bestScore = -Infinity;
        for (let k = 0; k < ncell; k++) {
          if (!okAim[k]) continue;
          const s = ((paint[k] / psum) / (0.12 + illum[k]) + (seen[k] ? 0 : 0.02 / Math.sqrt(N))) / (1 + penalty * sens[k]);
          if (s > bestScore) { bestScore = s; bestCell = k; }
        }
        if (bestCell < 0) { // erosion removed everything: retry without it
          for (let k = 0; k < ncell; k++) if (paint[k] > 0) okAim[k] = 1;
          i--; continue;
        }
        const ci = bestCell % res, cj = (bestCell / res) | 0;
        const [uu, vv] = RF.Engine.cellCenter(T, ci, cj), Z = RF.Engine.targetUVtoWorld(T, uu, vv);
        seen[bestCell] = 1;
        for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue;
          illum[jj * res + ii] += Math.exp(-(di * di + dj * dj) / (2 * sigma * sigma));
        }
        const c = chosen[i];
        const id = 'F' + surfaces.length;
        const pts3 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
          V.add(c.P, V.add(V.mul(c.ex, a * c.rad), V.mul(c.ey, b * c.rad))));
        const f = { type: 'facet', id, P: c.P, S0: src.pos.slice(), Z, flat: false, clip: { kind: 'poly', pts3, ref: c.ex },
          optics: { interaction: 'reflect', reflectivity: R, twoSided: false } };
        if (settings.useVG) { f.vg = [1 / focus, 1 / focus]; f.ax = V.mul(T.tu, -1); }
        else f.di = focus;
        surfaces.push(f); intent.push({ facet: id, cells: [[bestCell, 1]] });
      }
      notes.push(surfaces.length + ' facets; ' + cand.length + ' candidates, focus ' + focus.toFixed(0) + ' mm, tiles ' + radMean.toFixed(2) + ' mm, natural image ' + natural.toFixed(2) + ' cells, wanted ' + wanted.toFixed(2));
      return { surfaces, intent, notes };
    },
  };

  RF.Solvers.register(STATIC_SOLVER);

  /* Optional tuner: the same static algorithm, run a handful of times with different settings.
   * Every candidate is traced with the SAME seed (common random numbers), so the comparison is
   * geometry, not dice.  It may trace because its id ends in -auto; the static solver above may not.
   */
  RF.Solvers.register({
    id: 'bench-hy4flash-max--reflect-paint-auto', name: 'Reflect paint (tuned)', version: '0.1',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select',
        options: [{ value: 'faithful', label: 'Faithful' }, { value: 'throw', label: 'Throw' }, { value: 'efficient', label: 'Efficient' }],
        default: 'faithful' },
    ],
    solve(input, settings, tools) {
      const base = Object.assign(RF.Solvers.defaults(STATIC_SOLVER), { minDistance: settings.minDistance || 0 });
      // ordered, fixed candidate list: (0) tuned defaults, then flux/throw-oriented variants
      const variants = [
        {},
        { tileScale: 2.5 },
        { tileScale: 3 },
        { tileScale: 2, focusFrac: 0.6 },
        { tileScale: 2.5, focusFrac: 0.5, erode: 1 },
        { tileScale: 3, focusFrac: 1, erode: 1 },
        { tileScale: 2, blurGain: 0.4, spread: 0.7 },
      ];
      const seed = 0x5eed1234;                       // identical for every candidate, every call
      const budgetRays = tools && tools.budget && isFinite(tools.budget.rays) ? Math.max(0, tools.budget.rays) : 2e6;
      const per = Math.min(100000, Math.floor(budgetRays / variants.length));
      // Below 12k rays per candidate a comparison is noise: fall back to the static defaults.
      const use = per >= 12000 ? variants : [];
      const rays = per;
      const tried = [];
      for (const v of use) {
        if (!tools || !tools.trace) break;
        const cfg = Object.assign({}, base, v), out = STATIC_SOLVER.solve(input, cfg, tools);
        if (!out.surfaces.length) continue;
        const r = tools.trace(out.surfaces, { rays, seed });
        const f = r.fidelity || {};
        tried.push({ cfg, out, fidelity: f.fidelity || 0, onPaint: f.onPaint || 0, peak: r.peakCd || 0 });
      }
      if (!tried.length) return STATIC_SOLVER.solve(input, base, tools);
      let bestFid = 0; for (const t of tried) bestFid = Math.max(bestFid, t.fidelity);
      const goal = settings.goal || 'faithful';
      let best = tried[0], bestScore = -Infinity;
      for (const t of tried) {
        if (goal !== 'faithful' && t.fidelity < 0.85 * bestFid) continue;  // never abandon the painting
        const on = Math.min(2, t.onPaint / 0.2), pk = Math.log10(1 + t.peak / 1000);
        const score = goal === 'throw' ? pk + 0.4 * t.fidelity + 0.1 * on
          : goal === 'efficient' ? on + 0.4 * t.fidelity
            : t.fidelity + 0.08 * Math.min(1, on);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      const notes = (best.out.notes || []).concat([
        'auto goal ' + goal + ': ' + tried.length + ' candidates @ ' + rays + ' rays/seed ' + seed +
        ' → ' + JSON.stringify(Object.keys(best.cfg).filter((k) => k !== 'minDistance')
          .reduce((o, k) => (o[k] = best.cfg[k], o), {})),
      ]);
      return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
    },
  });
})();
