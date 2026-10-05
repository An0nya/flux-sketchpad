/* Bundled model solver: GPT-6 Luna (Codex), Flux solver benchmark run 2026-09-25 (workspace work-luna6-codex-flux-solver-20260925-2235).
 * Copied verbatim from that run's solvers/solver.js (sha256 66c068a7cfb3…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote.
 * Exception (2026-10-05): display-only tools.preview calls added for Watch solve (showCand in solve). */
(function () {
/* Rework ModeA's direction-cell plan into unequal facets, staggered radii, and overlapping tiles. */
function makePlan(input, s, facetType, radiusBias) {
  const scene = {
    source: input.source,
    target: input.target,
    envelope: input.envelope,
    modeA: {
      paint: input.paint.cells,
      budget: s.budget,
      facetType,
      reflectivity: s.reflectivity,
      minDistance: s.minDistance,
    },
  };
  const plan = RF.ModeA.plan(scene);
  if (plan.error) return { surfaces: [], report: plan.report, intent: [] };

  resizeFluxCells(plan, s.sizeContrast);
  staggerRadii(plan, s.radialSwing);
  overlapZones(plan, s.zoneSpread);
  biasDimZoneRadii(plan, radiusBias);
  return enforceCandidateConstraints(scene, RF.ModeA.build(plan));
}

// Keep ModeA's occasional surface-envelope miss from escaping into a scored candidate.
// The host verifier checks the real curved surface; invalid facets become explicit unplaced intents.
function enforceCandidateConstraints(scene, output) {
  const before = RF.Solvers.verify(scene, output);
  const invalidIds = new Set([
    ...before.violations.envelope,
    ...before.violations.keepOut,
  ]);
  if (invalidIds.size) {
    output = Object.assign({}, output, {
      surfaces: output.surfaces.filter((f) => !invalidIds.has(f.id)),
      intent: output.intent && output.intent.map((it) => it.facet != null && invalidIds.has(it.facet)
        ? Object.assign({}, it, { facet: null }) : it),
    });
  }
  const after = invalidIds.size ? RF.Solvers.verify(scene, output) : before;
  output.report = Object.assign({}, output.report, {
    surfaceCheck: {
      dropped: invalidIds.size,
      droppedIds: [...invalidIds].sort(),
      errors: after.errors,
      envelope: after.violations.envelope,
      keepOut: after.violations.keepOut,
      budget: after.violations.budget,
      intentErrors: after.intentErrors,
      ok: !after.errors.length && !after.violations.envelope.length && !after.violations.keepOut.length && !after.violations.budget && !after.intentErrors.length,
    },
  });
  return output;
}

// Re-split each spoke's existing captured interval by a deterministic, high-contrast flux
// distribution. The angular boundaries still tile the same captured directions without gaps.
function resizeFluxCells(plan, contrast) {
  if (!(contrast > 0)) return;
  const bySpoke = new Map();
  for (const it of plan.items) {
    if (!bySpoke.has(it.spoke)) bySpoke.set(it.spoke, []);
    bySpoke.get(it.spoke).push(it);
  }
  const out = [];
  for (const sp of plan.spokes) {
    const old = bySpoke.get(sp.j);
    if (!old || !old.length || !sp.best) continue;
    old.sort((a, b) => a.ta - b.ta);
    const n = old.length;
    const th0 = old[0].ta, th1 = old[n - 1].tb;
    const f0 = sp.fluxAt(th0), f1 = sp.fluxAt(th1);
    const weights = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // Exponential shares create genuinely different angular and painted tile sizes.
      const crest = 0.5 + 0.5 * Math.cos(2 * Math.PI * (i / n + 0.173 * sp.j));
      const w = Math.exp(Math.log(1 + 24 * contrast) * crest);
      weights.push(w); sum += w;
    }
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const fa = f0 + (f1 - f0) * acc / sum;
      acc += weights[i];
      const fb = i === n - 1 ? f1 : f0 + (f1 - f0) * acc / sum;
      const ta = i === 0 ? th0 : sp.thAt(fa);
      const tb = i === n - 1 ? th1 : sp.thAt(fb);
      const tc = sp.thAt((fa + fb) * 0.5);
      const dir = RF.Solver.dirOf(plan.F, tc, sp.pc);
      let m = sp.best.m0;
      while (m + 1 < sp.best.m1 && sp.tb[m + 1] <= tc) m++;
      const plane = sp.best.planes[m];
      const rc = plane.k / RF.V.dot(plane.n, dir);
      out.push({
        spoke: sp.j, ta, tb, tc, pa: sp.pa, pb: sp.pb, pc: sp.pc,
        w: fb - fa, dir, rc, pq: RF.Solver.areaMap(plan.F, dir),
      });
    }
  }
  plan.items = out;
  plan.zones = RF.Solver.partitionZones(out.map((it) => ({ w: it.w, p: it.pq[0], q: it.pq[1] })), plan.info);
  plan.intent = plan.zones.map((z) => ({ facet: null, cells: z && !z.empty ? z.cells.map((c) => [c.idx, c.w]) : [] }));
  plan.report.zones = plan.zones.map((z) => ({ facet: null, flux: z && !z.empty ? z.W / plan.info.sum : 0, aim: z && !z.empty ? z.aim : null }));
}

// Move facet centers along their own source rays, within the envelope's exact slab interval.
function staggerRadii(plan, swing) {
  if (!(swing > 0)) return;
  const S = plan.S, env = plan.env;
  const spokeCount = Math.max(1, plan.spokes.length);
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i], d = it.dir;
    let lo = 0, hi = Infinity, valid = true;
    for (let k = 0; k < 3; k++) {
      const a = env.center[k] - env.half[k], b = env.center[k] + env.half[k];
      if (Math.abs(d[k]) < 1e-14) {
        if (S[k] < a || S[k] > b) valid = false;
        continue;
      }
      const x = (a - S[k]) / d[k], y = (b - S[k]) / d[k];
      lo = Math.max(lo, Math.min(x, y));
      hi = Math.min(hi, Math.max(x, y));
    }
    lo = Math.max(lo, plan.keep);
    if (!valid || !(hi > lo)) continue;
    const pad = 0.025 * (hi - lo), low = lo + pad, high = hi - pad;
    if (!(high > low)) continue;
    const base = Math.max(low, Math.min(high, it.rc));
    // Keep a spoke coherent; adjacent facets no longer jump to unrelated radial shells.
    const phase = 2 * Math.PI * 2 * it.spoke / spokeCount;
    const wave = 0.5 + 0.5 * Math.sin(phase);
    it.rc = Math.min(high, base + 0.42 * swing * (high - low) * wave);
  }
}

// Contract tile centers slightly and enlarge the desired image. A balanced soft assignment lets
// several nearby facets claim each painted cell while preserving both paint-cell weights and each
// facet's original captured-flux share.
function overlapZones(plan, spread) {
  if (!(spread > 1)) return;
  const pull = 0.12 * (spread - 1);  // cap aim contraction at 12%; most overlap comes from wider tiles
  for (let i = 0; i < plan.zones.length; i++) {
    const z = plan.zones[i];
    if (!z || z.empty) continue;
    const aim = [
      plan.info.cu + (z.aim[0] - plan.info.cu) * (1 - pull),
      plan.info.cv + (z.aim[1] - plan.info.cv) * (1 - pull),
    ];
    const cellI = Math.floor((aim[0] + plan.info.T.half) / plan.info.cell);
    const cellJ = Math.floor((aim[1] + plan.info.T.half) / plan.info.cell);
    if (cellI >= 0 && cellJ >= 0 && cellI < plan.info.res && cellJ < plan.info.res && plan.info.paintAt(cellI, cellJ) > 0) {
      z.aim = aim;
    } else {
      let nearest = null, best = Infinity;
      for (const c of plan.info.cells) {
        const d2 = (c.u - aim[0]) ** 2 + (c.v - aim[1]) ** 2;
        if (d2 < best) { best = d2; nearest = c; }
      }
      z.aim = nearest ? [nearest.u, nearest.v] : aim;
    }
    z.sigma *= spread;
    if (z.cov) z.cov = z.cov.map((x) => x * spread * spread);
    if (plan.report.zones[i]) plan.report.zones[i].aim = z.aim.slice();
  }
  plan.intent = balancedOverlapIntent(plan);
}

// Low-radiance paint zones need a larger source image (softer tiles), not the sharpest outer
// source view. Move only those zones inward along their existing source rays, within the envelope.
function biasDimZoneRadii(plan, strength) {
  if (!(strength > 0)) return;
  const meanPaint = plan.info.sum / Math.max(1, plan.info.n);
  let moved = 0, strongest = 0;
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i], z = plan.zones[i];
    if (!z || z.empty || !(z.W > 0)) continue;
    let area = 0;
    for (const c of z.cells) {
      const level = plan.info.paintAt(c.i, c.j);
      if (level > 0) area += c.w / level;
    }
    if (!(area > 0)) continue;
    const localPaint = z.W / area;
    const dim = Math.max(0, Math.min(1, 1 - localPaint / Math.max(meanPaint, 1e-30)));
    if (!(dim > 0)) continue;
    const interval = rayRadialInterval(plan, it.dir);
    if (!interval) continue;
    const pad = 0.025 * (interval.hi - interval.lo);
    const near = interval.lo + pad, far = interval.hi - pad;
    if (!(far > near)) continue;
    const base = Math.max(near, Math.min(far, it.rc));
    const shift = 0.5 * strength * dim;
    it.rc = base - shift * (base - near);
    if (shift > 0) moved++;
    strongest = Math.max(strongest, shift);
  }
  plan.report.intensityRadiusBias = { moved, strongest };
}

function rayRadialInterval(plan, d) {
  const S = plan.S, env = plan.env;
  let lo = 0, hi = Infinity, valid = true;
  for (let k = 0; k < 3; k++) {
    const a = env.center[k] - env.half[k], b = env.center[k] + env.half[k];
    if (Math.abs(d[k]) < 1e-14) {
      if (S[k] < a || S[k] > b) valid = false;
      continue;
    }
    const x = (a - S[k]) / d[k], y = (b - S[k]) / d[k];
    lo = Math.max(lo, Math.min(x, y));
    hi = Math.min(hi, Math.max(x, y));
  }
  lo = Math.max(lo, plan.keep);
  return valid && hi > lo ? { lo, hi } : null;
}

// Sparse iterative proportional fitting over each cell's original owners plus its four nearest
// zone centers. This adds local overlap without changing either marginal (paint-cell or facet flux).
function balancedOverlapIntent(plan) {
  const zones = plan.zones, cells = plan.info.cells, active = [];
  const owners = new Map();
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    if (!z || z.empty || !(z.W > 0)) continue;
    active.push(zi);
    for (const c of z.cells) {
      let map = owners.get(c.idx);
      if (!map) owners.set(c.idx, map = new Map());
      map.set(zi, (map.get(zi) || 0) + c.w);
    }
  }
  const byCell = cells.map(() => []), byZone = zones.map(() => []);
  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci], ownerMap = owners.get(cell.idx) || new Map(), candidates = new Set(ownerMap.keys());
    const nearest = [];
    for (const zi of active) {
      const z = zones[zi], du = cell.u - z.aim[0], dv = cell.v - z.aim[1];
      const d2 = du * du + dv * dv;
      let at = 0;
      while (at < nearest.length && nearest[at].d2 <= d2) at++;
      if (at < 4) { nearest.splice(at, 0, { zi, d2 }); if (nearest.length > 4) nearest.pop(); }
    }
    for (const q of nearest) candidates.add(q.zi);
    for (const zi of candidates) {
      const z = zones[zi], du = cell.u - z.aim[0], dv = cell.v - z.aim[1];
      const sigma = Math.max(plan.info.cell * 0.5, z.sigma);
      const exponent = Math.min(40, 0.5 * (du * du + dv * dv) / (sigma * sigma));
      const prior = (ownerMap.get(zi) || 0) / Math.max(cell.w, 1e-300);
      const score = Math.max(1e-30, (z.W / plan.info.sum) * Math.exp(-exponent) * (1 + 4 * prior));
      const edge = { ci, zi, value: score };
      byCell[ci].push(edge); byZone[zi].push(edge);
    }
  }
  const zoneTotal = active.reduce((sum, zi) => sum + zones[zi].W, 0);
  const zoneTargets = zones.map((z) => z && !z.empty && zoneTotal > 0 ? z.W * plan.info.sum / zoneTotal : 0);
  const passes = Math.min(2000, 300 + active.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let ci = 0; ci < cells.length; ci++) {
      const edges = byCell[ci]; let total = 0;
      for (const e of edges) total += e.value;
      const scale = cells[ci].w / Math.max(total, 1e-300);
      for (const e of edges) e.value *= scale;
    }
    for (const zi of active) {
      const edges = byZone[zi]; let total = 0;
      for (const e of edges) total += e.value;
      const scale = zoneTargets[zi] / Math.max(total, 1e-300);
      for (const e of edges) e.value *= scale;
    }
  }
  let maxCellError = 0, maxFacetError = 0;
  for (let ci = 0; ci < cells.length; ci++) {
    let total = 0;
    for (const e of byCell[ci]) total += e.value;
    maxCellError = Math.max(maxCellError, Math.abs(total - cells[ci].w) / Math.max(cells[ci].w, 1e-300));
  }
  for (const zi of active) {
    let total = 0;
    for (const e of byZone[zi]) total += e.value;
    maxFacetError = Math.max(maxFacetError, Math.abs(total - zoneTargets[zi]) / Math.max(zoneTargets[zi], 1e-300));
  }
  plan.report.intentBalance = { passes, maxCellRelativeError: maxCellError, maxFacetRelativeError: maxFacetError };
  return zones.map((z, zi) => ({
    facet: null,
    cells: byZone[zi].filter((e) => e.value > 0).map((e) => [cells[e.ci].idx, e.value]),
  }));
}

function makeDesign(input, s, facetType, radiusBias) {
  return makePlan(input, s, facetType, radiusBias);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))];
}

// Total variation (half L1) compares the whole target map to the paint distribution. Because
// unpainted target cells have desired weight zero, spill is part of the error, not invisible.
function patternMetrics(input, output, trace) {
  const paint = input.paint.cells, paintGrid = RF.Engine.toPaintGrid(trace.grid, trace.res, input.paint.res);
  const desiredTotal = paint.reduce((sum, x) => sum + Math.max(0, x), 0);
  let targetTotal = 0, inPaint = 0, tv = 0;
  const ratios = [];
  for (let i = 0; i < paint.length; i++) {
    const actual = Math.max(0, paintGrid[i] || 0), intended = Math.max(0, paint[i] || 0);
    targetTotal += actual;
    if (intended > 0) { inPaint += actual; ratios.push(actual / intended); }
  }
  if (targetTotal > 0 && desiredTotal > 0) {
    for (let i = 0; i < paint.length; i++) {
      const actual = Math.max(0, paintGrid[i] || 0) / targetTotal;
      const intended = Math.max(0, paint[i] || 0) / desiredTotal;
      tv += Math.abs(actual - intended);
    }
    tv *= 0.5;
  } else tv = 1;

  const ratioMean = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const normalizedRatios = ratioMean > 0 ? ratios.map((x) => x / ratioMean) : ratios;
  const e = trace.energy || {}, delivered = (e.direct + e.reflected) / Math.max(1e-30, e.emitted || 0);
  const paintEfficiency = delivered * inPaint / Math.max(1e-30, targetTotal);
  const expected = new Map();
  for (const z of output.intent || []) {
    if (z.facet === null || z.facet === undefined) continue;
    expected.set(z.facet, (expected.get(z.facet) || 0) + z.cells.reduce((sum, c) => sum + Math.max(0, c[1]), 0));
  }
  const observed = trace.perFacet || {}, expectedSum = [...expected.values()].reduce((a, b) => a + b, 0);
  const observedSum = Object.values(observed).reduce((a, b) => a + b, 0);
  let facetTV = 1;
  if (expectedSum > 0 && observedSum > 0) {
    const ids = new Set([...expected.keys(), ...Object.keys(observed)]);
    facetTV = 0;
    for (const id of ids) facetTV += Math.abs((observed[id] || 0) / observedSum - (expected.get(id) || 0) / expectedSum);
    facetTV *= 0.5;
  }
  const intendedCells = ratios.length;
  const halfMeanCoverage = ratioMean > 0 ? ratios.filter((x) => x >= 0.5 * ratioMean).length / Math.max(1, intendedCells) : 0;
  return {
    delivered,
    paintEfficiency,
    spill: targetTotal > 0 ? Math.max(0, 1 - inPaint / targetTotal) : 1,
    mapTV: tv,
    facetTV,
    facetCount: Object.keys(observed).length,
    p5: percentile(normalizedRatios, 0.05),
    p50: percentile(normalizedRatios, 0.50),
    p95: percentile(normalizedRatios, 0.95),
    halfMeanCoverage,
    peakCd: trace.peakCd,
    peakNoise: trace.peakNoise,
    blocked: trace.blocked,
    raysPerCell: trace.raysPerCell,
  };
}

RF.Solvers.register({
  id: 'flux-explorer-fidelity-v06', name: 'Flux Explorer: Fidelity', version: '0.6', modes: ['paint'],
  settings: [
    { key: 'budget', label: 'Facet budget', type: 'range', min: 1, max: 2000, step: 1, default: 100 },
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'reflectivity', label: 'Reflectivity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'style', label: 'Facet style', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'curved', label: 'curved' }, { value: 'flat', label: 'flat' }], default: 'auto' },
    { key: 'sizeContrast', label: 'Facet size contrast', type: 'range', min: 0, max: 1, step: 0.05, default: 0.25, help: 'Unequal captured-light shares produce different facet and tile sizes.' },
    { key: 'zoneSpread', label: 'Target-zone overlap', type: 'range', min: 1, max: 2, step: 0.05, default: 2, help: 'Broaden tiles and share painted cells across nearby facet intents.' },
    { key: 'radialSwing', label: 'Radial placement variation', type: 'range', min: 0, max: 1, step: 0.05, default: 0, help: 'Move whole spoke bands outward by different amounts; large swings increase blocking.' },
    { key: 'radiusBias', label: 'Dim-zone radius bias', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75, help: 'Try closer facets for dim paint zones; bright zones keep the baseline radius.' },
  ],
  solve(input, s, tools) {
    const styles = s.style === 'auto' ? ['curved', 'flat'] : [s.style];
    const baselineSettings = Object.assign({}, s, { sizeContrast: 0, zoneSpread: 1, radialSwing: 0 });
    const specs = [{ label: 'Spoke baseline', settings: baselineSettings, type: 'curved', bias: 0, baseline: true }];
    const biases = s.radiusBias > 0 ? [0, s.radiusBias] : [0];
    const seen = new Set(['0|1|0|curved|0']);
    for (const bias of biases) for (const type of styles) {
      const key = `${s.sizeContrast}|${s.zoneSpread}|${s.radialSwing}|${type}|${bias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({ label: `paint fit ${type}, radius bias ${bias.toFixed(2)}`, settings: s, type, bias, baseline: false });
    }
    const candidates = specs.map((spec) => Object.assign(spec, { output: null, metrics: null }));
    const metricRays = 200000;
    // Watch solve (display only): each traced candidate with its own trace, at most once a second.  Reads c only.
    let lastShow = 0;
    const showCand = (c, traced, label) => {
      if (!tools || !tools.preview || tools.preview.none) return;
      const t = Date.now(); if (t - lastShow < 1000) return; lastShow = t;
      try { tools.preview(c.output.surfaces, { label, trace: traced, note: c.label }); } catch (e) { /* display only */ }
    };
    for (let i = 0; i < candidates.length; i++) {
      tools.progress(0.05 + 0.15 * i);
      const c = candidates[i];
      c.output = makeDesign(input, c.settings, c.type, c.bias);
      const check = c.output.report && c.output.report.surfaceCheck;
      if (check && !check.ok) c.traceError = 'surface verification still fails after filtering';
      if (c.output.surfaces.length && !(check && !check.ok)) {
        try {
          const traced = tools.trace(c.output.surfaces, { rays: metricRays, attribution: true });
          c.metrics = patternMetrics(input, c.output, traced);
          showCand(c, traced, 'candidate ' + (i + 1) + '/' + candidates.length);
        } catch (e) {
          c.traceError = String(e && e.message || e);
        }
      }
    }

    const valid = candidates.filter((c) => c.metrics);
    const baseline = valid.find((c) => c.baseline);
    const floor = baseline ? baseline.metrics.paintEfficiency - 0.02 : Math.max(0, ...valid.map((c) => c.metrics.paintEfficiency)) - 0.02;
    const eligible = valid.filter((c) => c.metrics.paintEfficiency >= floor);
    const ranked = (eligible.length ? eligible : valid).slice().sort((a, b) =>
      a.metrics.mapTV - b.metrics.mapTV || b.metrics.paintEfficiency - a.metrics.paintEfficiency || Number(b.baseline) - Number(a.baseline));
    if (!ranked.length) {
      const cells = input.paint.cells.map((w, i) => [i, Math.max(0, w)]).filter((c) => c[1] > 0);
      tools.progress(1);
      return {
        surfaces: [],
        intent: cells.length ? [{ facet: null, cells }] : [],
        notes: ['No candidate produced traceable geometry that passed the surface constraints; all painted intent is reported unplaced.'],
      };
    }
    const chosen = ranked[0];
    const fmt = (c) => c.metrics ? `${c.label}: paint ${(100 * c.metrics.paintEfficiency).toFixed(1)}%, spill ${(100 * c.metrics.spill).toFixed(1)}%, map TV ${c.metrics.mapTV.toFixed(3)}, facet TV ${c.metrics.facetTV.toFixed(3)}` : `${c.label}: not traced`;
    const notes = (chosen.output.report ? chosen.output.report.warnings || [] : []).slice();
    const surfaceCheck = chosen.output.report && chosen.output.report.surfaceCheck;
    if (surfaceCheck && surfaceCheck.dropped) notes.push(`surface constraint guard dropped ${surfaceCheck.dropped} invalid facet(s): ${surfaceCheck.droppedIds.join(', ')}; their intended cells remain explicitly unplaced.`);
    if (surfaceCheck && !surfaceCheck.ok) notes.push('surface verification failed after filtering; no candidate met the geometry constraints.');
    notes.push(`map objective chose ${chosen.label}; full-target map TV (half L1; lower is better), with unpainted spill counted as error. In-pattern efficiency guard: within 2.0 percentage points of Spoke baseline (${baseline ? (100 * baseline.metrics.paintEfficiency).toFixed(1) : 'unavailable'}%).`);
    notes.push(`chosen: ${fmt(chosen)}; total delivered ${(100 * chosen.metrics.delivered).toFixed(1)}%; painted-cell delivered/intended ratios normalized by their unweighted mean, p5/p50/p95 ${chosen.metrics.p5.toFixed(2)} / ${chosen.metrics.p50.toFixed(2)} / ${chosen.metrics.p95.toFixed(2)}; painted cells above half that mean ${ (100 * chosen.metrics.halfMeanCoverage).toFixed(1)}% (coverage proxy, not app beam); peak ${Math.round(chosen.metrics.peakCd).toLocaleString()} cd ±${Math.round(100 * chosen.metrics.peakNoise)}%; rays/cell ${chosen.metrics.raysPerCell.toFixed(1)}; ${chosen.metrics.facetCount} facets with landed-light attribution.`);
    notes.push(`candidates: ${valid.map(fmt).join(' | ')}.`);
    const balance = chosen.output.report && chosen.output.report.intentBalance;
    if (balance) notes.push(`overlap intent balance max relative error: cells ${(100 * balance.maxCellRelativeError).toExponential(1)}%, facets ${(100 * balance.maxFacetRelativeError).toExponential(1)}%.`);
    for (const c of candidates) if (c.traceError) notes.push(c.type + ' trace failed: ' + c.traceError);
    tools.progress(1);
    return {
      surfaces: chosen.output.surfaces,
      intent: chosen.output.intent,
      notes,
      extras: chosen.output.report,
    };
  },
});
})();
