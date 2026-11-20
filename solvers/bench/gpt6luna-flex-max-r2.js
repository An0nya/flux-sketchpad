/*
 * Static paint solver for Flux.
 *
 * The reflector is laid out as small, disjoint angular tiles as seen from the LED.  Each tile is
 * a curved facet (an ellipsoid) whose centre normal sends the LED image to a paint-weighted sample
 * on the target.  The tile's clip is made by projecting the corners of its source-direction cell
 * onto the facet's tangent plane.  Equal-probability source cells therefore catch approximately
 * equal flux; stratified target samples put that flux in proportion to the painting.  No rays are
 * traced here: all placement, aperture, and focus choices are geometric / first-order optics.
 */
(function () {
'use strict';
const paintTilesDefinition = {
  id: 'bench-gpt6luna-flex-max-r2--paint-tiles', name: 'Paint tiles (static image solver)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'radial', label: 'Aperture depth', type: 'range', min: 0.35, max: 0.9, step: 0.05, default: 0.55,
      help: 'Fraction of the usable depth along the throw axis; the facets share one shallow exit plane to limit mutual blocking.' },
    { key: 'aperture', label: 'Angular tile fill', type: 'range', min: 0.3, max: 1, step: 0.05, default: 0.8,
      help: 'How much of each equal-flux source-direction tile a facet covers.' },
    { key: 'angularCoverage', label: 'Source flux quantile', type: 'range', min: 0.5, max: 0.98, step: 0.02, default: 0.9,
      help: 'Use the central fraction of the LED emission distribution; extreme grazing rays are left unused.' },
    { key: 'blurCells', label: 'Minimum image width (paint cells)', type: 'range', min: 0.5, max: 4, step: 0.25, default: 4,
      help: 'For tiny or point sources, defocus just enough to avoid a sub-cell image.' },
  ],

  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, Engine = RF.Engine;
    const source = input.source;
    const sources = input.sources && input.sources.length ? input.sources : [source];
    const env = input.envelope;
    const paint = input.paint && input.paint.cells;
    const R = input.paint && input.paint.res | 0;
    const cap = Math.max(0, Math.floor(+input.limits.maxFacets || 0));
    if (!source || !source.pos || !env || !input.target || !paint || !R || !cap) {
      return { surfaces: [], intent: [], notes: ['No usable paint problem or facet budget.'] };
    }

    const max = (a, b) => a > b ? a : b;
    const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
    const sourceKeep = max(0, +env.keepOut || 0);
    const minD = max(0, +settings.minDistance || 0);
    const keep = max(sourceKeep, minD);
    const radial = clamp(+settings.radial || 0.55, 0.35, 0.9);
    const aperture = clamp(+settings.aperture || 0.8, 0.3, 1);
    const fluxQuantile = clamp(+settings.angularCoverage || 0.9, 0.5, 0.98);
    const blurCells = clamp(+settings.blurCells || 4, 0.5, 4);
    const refl = isFinite(+input.limits.reflectivity) ? +input.limits.reflectivity : 0.9;
    const S0 = source.pos.slice();
    const T = Engine.designFrame(input.target);
    const cellSize = 2 * T.half / R;

    // Total painted mass and a deterministic, spatially-local order for stratified sampling.
    let paintMass = 0;
    const painted = [];
    const spreadBits = (x) => {
      x = (x | (x << 8)) & 0x00ff00ff;
      x = (x | (x << 4)) & 0x0f0f0f0f;
      x = (x | (x << 2)) & 0x33333333;
      x = (x | (x << 1)) & 0x55555555;
      return x >>> 0;
    };
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i, w = +paint[k] || 0;
      if (w > 0 && isFinite(w)) {
        painted.push({ k, i, j, w, code: (spreadBits(i) | (spreadBits(j) << 1)) >>> 0 });
        paintMass += w;
      }
    }
    if (!(paintMass > 0)) return { surfaces: [], intent: [], notes: ['The paint is empty.'] };
    painted.sort((a, b) => a.code - b.code || a.k - b.k);
    const paintCdf = new Float64Array(painted.length + 1);
    for (let i = 0; i < painted.length; i++) paintCdf[i + 1] = paintCdf[i] + painted[i].w;

    // Cell-centred stratification through a Morton (Z-order) traversal avoids row-wise clumping.
    const samplePaint = (n) => {
      const out = [], rng = new RF.rng.Rng((input.seed | 0) ^ 0x51ed270b);
      for (let q = 0; q < n; q++) {
        const x = (q + 0.5) * paintMass / n;
        let lo = 0, hi = painted.length;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (paintCdf[m] <= x) lo = m; else hi = m; }
        const c = painted[lo], fx = rng.next(), fy = rng.next();
        out.push({
          cell: c.k, weight: c.w,
          u: -T.half + (c.i + fx) * cellSize,
          v: -T.half + (c.j + fy) * cellSize,
        });
      }
      return out;
    };

    // Combined source covariance is used only for a first-order estimate of the finite LED image.
    // It also makes several nearby emitters broaden the image instead of pretending they are points.
    const sourcePower = sources.reduce((s, x) => s + max(0, +x.power || 0), 0) || 1;
    const meanSource = [0, 0, 0];
    for (const x of sources) {
      const w = max(0, +x.power || 0) / sourcePower;
      for (let a = 0; a < 3; a++) meanSource[a] += w * x.pos[a];
    }
    const cov = new Array(9).fill(0);
    for (const x of sources) {
      const w = max(0, +x.power || 0) / sourcePower;
      let C = null;
      try { C = RF.Source.extentCov(x); } catch (_) { C = null; }
      const d = V.sub(x.pos, meanSource);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        cov[3 * a + b] += w * ((C ? C[3 * a + b] : 0) + d[a] * d[b]);
      }
    }
    const covQuad = (a) => {
      let z = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) z += a[i] * cov[3 * i + j] * a[j];
      return Math.max(0, z);
    };

    // Invert the source's polar emission CDF.  The azimuth and this quantile are uniform in
    // emitted flux, regardless of whether the LED is Lambertian, Gaussian, conical, or isotropic.
    const frame = RF.Source.frame(source);
    const thetaMax = RF.Source.thetaMax(source);
    const NTH = 720, polarCdf = new Float64Array(NTH + 1);
    let prior = 0, polarTotal = 0;
    for (let i = 1; i <= NTH; i++) {
      const t = thetaMax * i / NTH;
      const y = RF.Source.intensity(source, t) * Math.sin(t);
      polarTotal += (prior + y) * 0.5 * thetaMax / NTH;
      polarCdf[i] = polarTotal;
      prior = y;
    }
    if (polarTotal > 0) for (let i = 0; i <= NTH; i++) polarCdf[i] /= polarTotal;
    const thetaAt = (q) => {
      q = clamp(q, 0, 1);
      if (!(polarTotal > 0)) return thetaMax * q;
      let lo = 0, hi = NTH;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (polarCdf[m] < q) lo = m; else hi = m; }
      const f = (q - polarCdf[lo]) / max(1e-15, polarCdf[hi] - polarCdf[lo]);
      return thetaMax * (lo + f) / NTH;
    };
    const dirAt = (q, phi) => {
      const th = thetaAt(q), st = Math.sin(th), ct = Math.cos(th);
      return V.norm(V.add(V.mul(frame.a, ct), V.add(V.mul(frame.u, st * Math.cos(phi)), V.mul(frame.v, st * Math.sin(phi)))));
    };

    // Put the facets on one shallow plane perpendicular to the throw.  Their input apertures
    // still tile LED directions, but reflected rays leave the reflector layer instead of crossing
    // a stack of facets at different depths.  The azimuth sector is centred on the projected throw
    // direction; for a source aimed across the throw this is the forward half of its emission.
    const panelAxis = V.norm(V.sub(T.C, S0));
    const panelInterval = Geo.envInterval(env, S0, panelAxis);
    const panelEnter = Math.max(0, panelInterval[0]);
    const panelExit = panelInterval[1];
    const panelLow = Math.max(keep + 1.5, panelEnter + 0.5);
    const panelDistance = isFinite(panelExit) && panelExit > panelLow + 1
      ? Math.min(panelExit - 0.35, panelLow + radial * (panelExit - panelLow)) : NaN;
    const axialSource = V.dot(frame.a, panelAxis);
    const lateralThrow = V.sub(panelAxis, V.mul(frame.a, axialSource));
    const lateralLen = V.len(lateralThrow);
    const phiCentre = lateralLen > 1e-7
      ? Math.atan2(V.dot(lateralThrow, frame.v), V.dot(lateralThrow, frame.u)) : 0;
    const phiSpan = Math.abs(axialSource) > 0.78 ? 2 * Math.PI : Math.PI;

    // Oversample the equal-flux direction grid a little: some rays do not meet this panel inside
    // the envelope (or would strike at grazing incidence).  Select the feasible tiles evenly below.
    let nPhi = 0, nMu = 0, nSites = 0;
    const gridBudget = cap < 4 ? 1 : Math.ceil(cap * 1.65);
    if (cap < 4) {
      nPhi = 1; nMu = 1; nSites = 1;
    } else {
      const tLo = thetaAt(0.06), tHi = thetaAt(fluxQuantile), tMid = 0.5 * (tLo + tHi);
      let best = -Infinity;
      for (let m = 1; m <= gridBudget; m++) {
        const p = Math.floor(gridBudget / m);
        if (p < 4) continue;
        const count = p * m;
        const dx = phiSpan * Math.max(0.15, Math.sin(tMid)) / p;
        const dy = Math.max(1e-4, tHi - tLo) / m;
        const aspectPenalty = Math.abs(Math.log(dx / dy));
        const score = count - 8 * aspectPenalty;
        if (score > best) { best = score; nPhi = p; nMu = m; nSites = count; }
      }
      if (!nSites) { nPhi = Math.max(4, gridBudget); nMu = 1; nSites = gridBudget; }
    }

    // Candidate source-direction tiles and their physically projected corner rays.
    const candidateSites = [];
    const qLoBase = 0.06, qHiBase = fluxQuantile;
    for (let j = 0; j < nMu; j++) for (let i = 0; i < nPhi; i++) {
      let e, rays;
      if (cap < 4) {
        // A single compact angular patch is the useful limiting case; a whole-hemisphere polygon
        // would be non-convex and physically unbuildable.
        e = dirAt(0.35 * fluxQuantile, phiCentre);
        const [b0, b1] = V.basis(e, frame.u), d = 0.11;
        rays = [V.norm(V.add(e, V.add(V.mul(b0, -d), V.mul(b1, -d)))),
                V.norm(V.add(e, V.add(V.mul(b0,  d), V.mul(b1, -d)))),
                V.norm(V.add(e, V.add(V.mul(b0,  d), V.mul(b1,  d)))),
                V.norm(V.add(e, V.add(V.mul(b0, -d), V.mul(b1,  d))))];
      } else {
        const q0 = qLoBase + (qHiBase - qLoBase) * j / nMu;
        const q1 = qLoBase + (qHiBase - qLoBase) * (j + 1) / nMu;
        const p0 = phiCentre - phiSpan / 2 + phiSpan * i / nPhi;
        const p1 = phiCentre - phiSpan / 2 + phiSpan * (i + 1) / nPhi;
        const pm = 0.5 * (p0 + p1);
        e = dirAt(0.5 * (q0 + q1), pm);
        rays = [dirAt(q0, p0), dirAt(q0, p1), dirAt(q1, p1), dirAt(q1, p0)];
      }
      const forward = V.dot(e, panelAxis);
      if (!(forward > 0.06) || !isFinite(panelDistance)) continue;
      const r = panelDistance / forward;
      if (!(r > keep + 1.5) || !isFinite(r)) continue;
      const P = V.add(S0, V.mul(e, r));
      if (!Geo.envInside(env, P, -2e-5)) continue;
      const aim0 = V.norm(V.sub(T.C, P)), n0 = V.norm(V.sub(aim0, e));
      if (-V.dot(n0, e) <= 0.12) continue;
      candidateSites.push({ e, rays, exit: r, rLow: r, rBase: r, fixedPlane: true, ordinal: candidateSites.length });
    }
    let sites = candidateSites;
    if (sites.length > cap) {
      const picked = [];
      for (let k = 0; k < cap; k++) picked.push(sites[Math.floor((k + 0.5) * sites.length / cap)]);
      sites = picked;
    }

    // A candidate is an exact ellipsoid image of the LED (or its first-order virtual image) with
    // a tangent-plane polygon aperture.  Its focus is placed at the target for extended LEDs; a
    // point-like image is deliberately softened to at least blurCells × one paint cell.
    const makeFacet = (site, sample, scale, r, id) => {
      const P = V.add(S0, V.mul(site.e, r));
      const Q = Engine.targetUVtoWorld(T, sample.u, sample.v);
      const outAxis = V.norm(V.sub(Q, P));
      const n = V.norm(V.sub(outAxis, site.e));
      const cosIn = -V.dot(n, site.e);
      if (!(cosIn > 0.12)) return null;
      const clipPts = [];
      const rel = V.sub(P, S0), numerator = V.dot(n, rel);
      for (const raw of site.rays) {
        const q = V.norm(V.lerp(site.e, raw, scale));
        const den = V.dot(n, q);
        if (!(den < -1e-8)) return null;
        const t = numerator / den;
        if (!(t > 0) || !isFinite(t)) return null;
        clipPts.push(V.madd(S0, q, t));
      }
      const ex = V.inPlane(n, frame.u), ey = V.cross(n, ex);
      const pts2 = clipPts.map((p) => { const d = V.sub(p, P); return [V.dot(d, ex), V.dot(d, ey)]; });
      // Sort the four projected vertices around their centroid and reject a folded / degenerate tile.
      const cx = pts2.reduce((s, p) => s + p[0], 0) / pts2.length;
      const cy = pts2.reduce((s, p) => s + p[1], 0) / pts2.length;
      const order = [0, 1, 2, 3].sort((a, b) => Math.atan2(pts2[a][1] - cy, pts2[a][0] - cx) - Math.atan2(pts2[b][1] - cy, pts2[b][0] - cx));
      const poly2 = order.map((k) => pts2[k]);
      let signedArea = 0;
      for (let k = 0; k < 4; k++) { const a = poly2[k], b = poly2[(k + 1) % 4]; signedArea += a[0] * b[1] - b[0] * a[1]; }
      if (Math.abs(signedArea) < 1e-6) return null;
      let sign = 0;
      for (let k = 0; k < 4; k++) {
        const a = poly2[k], b = poly2[(k + 1) % 4], c = poly2[(k + 2) % 4];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 1e-8) continue;
        if (sign && cr * sign < 0) return null;
        sign = cr;
      }
      const ordered3 = order.map((k) => clipPts[k]);
      const minx = Math.min(...poly2.map((p) => p[0])), maxx = Math.max(...poly2.map((p) => p[0]));
      const miny = Math.min(...poly2.map((p) => p[1])), maxy = Math.max(...poly2.map((p) => p[1]));
      const patchWidth = Math.max(maxx - minx, maxy - miny, 0.1);
      const patchRadius = Math.max(...ordered3.map((p) => V.dist(p, P)));
      const D = V.dist(P, Q);

      // First-order finite-source image widths on the tilted target plane.
      const ndot = V.dot(T.n, outAxis);
      let wu = Infinity, wv = Infinity;
      if (Math.abs(ndot) > 1e-5) {
        const effective = (tu) => V.sub(tu, V.mul(T.n, V.dot(tu, outAxis) / ndot));
        const projected = (tu) => {
          const b = effective(tu), bp = V.sub(b, V.mul(site.e, V.dot(b, site.e)));
          return 2 * Math.sqrt(3) * D / Math.max(1e-6, r) * Math.sqrt(covQuad(bp));
        };
        wu = projected(T.tu); wv = projected(T.tv);
      }
      const sourceMin = Math.min(wu, wv);
      const desired = Math.max(sourceMin, blurCells * cellSize);
      const extra = Math.sqrt(Math.max(0, desired * desired - sourceMin * sourceMin));
      const di = D / (1 + extra / patchWidth);
      if (!(di > 1e-5) || !isFinite(di)) return null;
      return {
        surface: {
          type: 'facet', id, P, S0, Z: Q, di, flat: false,
          clip: { kind: 'poly', pts3: ordered3 },
          optics: { interaction: 'reflect', reflectivity: refl },
        },
        sample, r, scale, patchRadius,
      };
    };

    // Check the actual compiled ellipsoid outline (not just its planar aperture) against the
    // convex envelope.  Clearance uses a conservative centre-distance minus whole-patch-radius
    // bound, so every point on the mirror stays outside every emitter's hard keep-out.
    const fits = (candidate) => {
      let G;
      try { G = Geo.compile([candidate.surface]); } catch (_) { return false; }
      const polys = Geo.outline(G, 0), P = candidate.surface.P;
      let extent = candidate.patchRadius;
      for (const poly of polys) for (const p of poly) {
        if (!Geo.envInside(env, p, -2e-5)) return false;
        extent = Math.max(extent, V.dist(P, p));
      }
      extent += 0.1;
      for (const x of sources) if (V.dist(P, x.pos) - extent < keep + 0.1) return false;
      return true;
    };

    // Find the best usable facet for each equal-flux direction tile.  A short deterministic
    // back-off lets tiles near an envelope wall keep a useful aperture without violating bounds.
    const built = [];
    const targetSamples = samplePaint(sites.length);
    for (let k = 0; k < sites.length && built.length < cap; k++) {
      const site = sites[k], sample = targetSamples[k];
      const minR = Math.max(site.rLow, keep + 2.5);
      if (!site.fixedPlane && !(site.rBase > minR)) continue;
      const span = site.fixedPlane ? 0 : site.rBase - minR;
      let best = null, bestScore = -1;
      const radiusTrials = site.fixedPlane ? 1 : 5;
      for (let ir = 0; ir < radiusTrials; ir++) {
        const r = site.rBase - span * ir / Math.max(1, radiusTrials - 1);
        for (let is = 0; is < 7; is++) {
          const scale = aperture * (1 - is * 0.11);
          if (scale < 0.25) continue;
          const cand = makeFacet(site, sample, scale, r, 'F' + built.length);
          if (!cand || !fits(cand)) continue;
          const score = scale * scale * (0.35 + 0.65 * r / site.exit);
          if (score > bestScore) { best = cand; bestScore = score; }
          // At a given radius the first passing scale is the largest one; smaller ones cannot improve it.
          break;
        }
      }
      if (best) built.push(best);
    }

    const surfaces = built.map((x) => x.surface);
    const intent = built.map((x) => ({ facet: x.surface.id, cells: [[x.sample.cell, x.sample.weight]] }));
    const avgScale = built.length ? built.reduce((s, x) => s + x.scale, 0) / built.length : 0;
    const avgRadius = built.length ? built.reduce((s, x) => s + x.r, 0) / built.length : 0;
    return {
      surfaces, intent,
      notes: [
        `Static panel tiling: ${built.length}/${cap} facets; ${nPhi}×${nMu} candidate grid, mean aperture fill ${avgScale.toFixed(2)}, mean LED radius ${avgRadius.toFixed(1)} mm.`, 
        'Facet centres share a shallow throw-normal plane to limit inter-facet blocking; each ellipsoid images the LED onto a paint-weighted target sample. solve() uses geometry only.',
      ],
    };
  },
};
RF.Solvers.register(paintTilesDefinition);

// Optional trace-driven tuner.  The static solver above remains deterministic and trace-free;
// this separate -auto solver only uses a small, fixed candidate set and returns one of its outputs.
RF.Solvers.register({
  id: 'bench-gpt6luna-flex-max-r2--paint-tiles-auto', name: 'Paint tiles (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select',
      options: [
        { value: 'faithful', label: 'Faithful paint' },
        { value: 'throw', label: 'Maximum throw' },
        { value: 'efficient', label: 'Balanced efficiency' },
      ], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const minDistance = Math.max(0, +settings.minDistance || 0);
    const candidates = goal === 'faithful' ? [
      { radial: 0.55, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.55, aperture: 0.8, angularCoverage: 0.9, blurCells: 3 },
      { radial: 0.50, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.55, aperture: 0.7, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.60, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
    ] : goal === 'throw' ? [
      { radial: 0.55, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.50, aperture: 1.0, angularCoverage: 0.98, blurCells: 0.5 },
      { radial: 0.45, aperture: 0.9, angularCoverage: 0.98, blurCells: 0.5 },
      { radial: 0.60, aperture: 0.9, angularCoverage: 0.9, blurCells: 1.5 },
      { radial: 0.55, aperture: 1.0, angularCoverage: 0.9, blurCells: 1.5 },
    ] : [
      { radial: 0.55, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.50, aperture: 0.9, angularCoverage: 0.9, blurCells: 3 },
      { radial: 0.55, aperture: 0.7, angularCoverage: 0.9, blurCells: 3 },
      { radial: 0.60, aperture: 0.8, angularCoverage: 0.9, blurCells: 4 },
      { radial: 0.50, aperture: 0.8, angularCoverage: 0.98, blurCells: 4 },
    ];
    const makeStatic = (p) => paintTilesDefinition.solve(input, Object.assign({ minDistance }, p), tools);
    const fallback = makeStatic(candidates[0]);
    if (!tools || typeof tools.trace !== 'function' || !input.paint || !input.paint.cells || !input.paint.cells.some((x) => x > 0)) {
      fallback.notes = (fallback.notes || []).concat([`Auto tuner (${goal}): trace unavailable or no painted cells; returned the static default.`]);
      return fallback;
    }

    // Split the host's ray budget across candidates and use common random numbers (same seed).
    // At most 80k rays per candidate keeps this optional solve bounded while still comparing maps.
    const budgetRays = tools.budget && isFinite(tools.budget.rays) ? Math.max(0, tools.budget.rays) : Infinity;
    const rays = Math.floor(Math.min(80000, budgetRays / candidates.length));
    if (rays < 5000) {
      fallback.notes = (fallback.notes || []).concat([`Auto tuner (${goal}): ray budget too small to compare candidates; returned the static default.`]);
      return fallback;
    }

    const results = [];
    let tracesDone = 0;
    for (let i = 0; i < candidates.length; i++) {
      const output = i === 0 ? fallback : makeStatic(candidates[i]);
      if (!output.surfaces.length) {
        results.push({ output, params: candidates[i], fidelity: 0, onPaint: 0, peak: 0, throwM: 0, placed: 0 });
        continue;
      }
      try {
        const trace = tools.trace(output.surfaces, { rays, seed: input.seed });
        tracesDone++;
        const f = trace && trace.fidelity;
        results.push({
          output, params: candidates[i],
          fidelity: f && isFinite(f.fidelity) ? f.fidelity : 0,
          onPaint: f && isFinite(f.onPaint) ? f.onPaint : 0,
          peak: isFinite(trace && trace.peakCd) ? trace.peakCd : 0,
          throwM: isFinite(trace && trace.throwM) ? trace.throwM : 0,
          placed: output.surfaces.length,
        });
      } catch (e) {
        // Keep a valid static result if the host declines a trace (e.g. a shortened time budget).
        if (!results.length) results.push({ output: fallback, params: candidates[0], fidelity: 0, onPaint: 0, peak: 0, throwM: 0, placed: fallback.surfaces.length });
        break;
      }
    }
    if (!results.length) return fallback;

    const bestOnPaint = Math.max(0, ...results.map((x) => x.onPaint));
    const bestPeak = Math.max(0, ...results.map((x) => x.peak));
    const cap = Math.max(1, +input.limits.maxFacets || 1);
    let best = results[0], bestScore = -Infinity;
    for (const x of results) {
      const light = bestOnPaint > 0 ? Math.min(1, x.onPaint / (0.1 * bestOnPaint)) : 0;
      const F = x.fidelity * light;
      const g = Math.max(0, Math.min(1, (F - 0.50) / 0.25));
      const X = 0.7 * (bestOnPaint > 0 ? Math.min(2, x.onPaint / bestOnPaint) : 0) / 2
        + 0.3 * (bestPeak > 0 ? Math.min(2, x.peak / bestPeak) : 0) / 2;
      let score;
      if (goal === 'faithful') {
        score = F;
      } else if (goal === 'throw') {
        score = Math.log1p(Math.max(0, x.throwM)) + 0.1 * x.fidelity
          + 0.05 * (bestOnPaint > 0 ? x.onPaint / bestOnPaint : 0);
      } else {
        // Task-shaped proxy: fidelity first, then delivered flux / peak, then fewer facets.
        score = F + g * 0.5 * X + 0.02 * (1 - x.placed / cap);
      }
      if (score > bestScore) { bestScore = score; best = x; }
    }
    best.output.notes = (best.output.notes || []).concat([
      `Auto tuner goal=${goal}: selected radial=${best.params.radial}, aperture=${best.params.aperture}, angularCoverage=${best.params.angularCoverage}, blurCells=${best.params.blurCells}; ${tracesDone}/${candidates.length} traces at ${rays} rays each, seed ${input.seed}; fidelity=${best.fidelity.toFixed(3)}, onPaint=${(100 * best.onPaint).toFixed(1)}%, throw=${best.throwM.toFixed(1)} m.`, 
    ]);
    return best.output;
  },
});
})();
