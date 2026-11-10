/* endless-settlement-road.js: Endless road v2 — the settlement + road-class axes → tile knobs (nemo, 11-10).
   CONSUMES harbert's shared scheduler (RF.EndlessAxes in js/endless-axis-config.js) for the settlement and
   road-class ladder values at each tile, and maps them to the tile-generation knobs:
     settlement → buildings / driveways / intersections / peds / trafficDensity   (0..1 densities)
     roadClass  → laneCount / roadWidth / median / shoulder (cross-section) + tileWeights (all 8 TILE_KINDS)
   speedLimit = RF.EndlessAxes.speedLimitAt (the lower of the two rungs' SPEED — harbert's table, not duplicated).
   userCurviness (config.userCurviness, 0.25..4) biases the curve-kind weights inside the road-class pick.
   Settlement densities blend across a 'gradual' entry (over the first ~15% of the run, per styleAt's contract
   "the consumer owns the actual interpolation"); 'sharp' = a hard switch.

   Interface:
     settlementRoadAt(seed, k, settings) -> { settlement, roadClass, tileWeights, laneCount, roadWidth,
       median, shoulder, buildings, driveways, intersections, peds, trafficDensity, speedLimit }
   settings = the RAW endless-axes settings object (parsed internally by RF.EndlessAxes.timeline — do NOT
     pre-parse; double-parsing breaks ranges, same rule as endless-relief.js):
       settlement: 'auto'|'city'|'suburb'|'rural'|'wild'|{min,max}
       roadClass:  'auto'|'dense-highway'|'remote-highway'|'surface-2+2'|'suburban-1+1'|'two-lane'|'street'|{min,max}
       userCurviness: 0.25..4 (default 1)
   Deterministic in (seed, k, settings). No DOM, loads in Node (like endless-axis-config.js / endless-relief.js). */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // The 8 tile kinds — MUST match drive-anim.js TILE_KINDS. pickKind counts an UNNAMED kind as weight 1, so
  // tileWeightsFor names all 8 (a 0 weight is honoured and never picked; an absent one would silently get 1).
  const TILE_KINDS = ['straight', '250R', '250L', '150R', '150L', 'intersection', 't-junction', 'urban'];
  const CURVE_KINDS = ['250R', '250L', '150R', '150L'];   // the radii biased by userCurviness

  // settlement rung → 0..1 densities (city dense → wild sparse). Design defaults, tunable (see REPORT.md).
  const SETTLEMENT_DENSITY = {
    'city':   { buildings: 0.90, driveways: 0.70, intersections: 0.80, peds: 0.90, trafficDensity: 0.90 },
    'suburb': { buildings: 0.60, driveways: 0.80, intersections: 0.50, peds: 0.55, trafficDensity: 0.60 },
    'rural':  { buildings: 0.25, driveways: 0.40, intersections: 0.18, peds: 0.15, trafficDensity: 0.30 },
    'wild':   { buildings: 0.08, driveways: 0.10, intersections: 0.05, peds: 0.05, trafficDensity: 0.12 },
  };
  const DENSITY_KEYS = ['buildings', 'driveways', 'intersections', 'peds', 'trafficDensity'];

  // road-class rung → cross-section. laneCount = total lanes; median = a barrier (not just paint); metres.
  const ROADCLASS_GEOMETRY = {
    'dense-highway':  { laneCount: 4, roadWidth: 15.0, median: true,  shoulder: 3.0 },
    'remote-highway': { laneCount: 4, roadWidth: 14.0, median: true,  shoulder: 2.5 },
    'surface-2+2':    { laneCount: 4, roadWidth: 13.0, median: false, shoulder: 2.0 },
    'suburban-1+1':   { laneCount: 2, roadWidth: 9.5,  median: false, shoulder: 1.5 },
    'two-lane':       { laneCount: 2, roadWidth: 7.5,  median: false, shoulder: 1.0 },
    'street':         { laneCount: 2, roadWidth: 6.5,  median: false, shoulder: 0.5 },
  };

  // road-class rung → curve-kind base weights (scale matches drive-anim ENDLESS_WEIGHTS, ~0..3). Higher class
  // = more straight + gentler (250 m) curves; lower class = tighter (150 m) curves.
  const ROADCLASS_CURVE = {
    'dense-highway':  { straight: 3.0, '250R': 1.0, '250L': 1.0, '150R': 0.2, '150L': 0.2 },
    'remote-highway': { straight: 2.5, '250R': 1.2, '250L': 1.2, '150R': 0.5, '150L': 0.5 },
    'surface-2+2':    { straight: 2.0, '250R': 1.2, '250L': 1.2, '150R': 0.8, '150L': 0.8 },
    'suburban-1+1':   { straight: 2.0, '250R': 0.8, '250L': 0.8, '150R': 1.2, '150L': 1.2 },
    'two-lane':       { straight: 1.5, '250R': 0.6, '250L': 0.6, '150R': 1.5, '150L': 1.5 },
    'street':         { straight: 1.2, '250R': 0.3, '250L': 0.3, '150R': 2.0, '150L': 2.0 },
  };

  // settlement rung → junction/urban base weights (city many → wild none), scaled by ROADCLASS_JUNCTION so a
  // freeway (dense-highway) stays junction-free even through a city, while a street is junction-heavy.
  const SETTLEMENT_KIND = {
    'city':   { intersection: 0.9, 't-junction': 0.7, urban: 3.0 },
    'suburb': { intersection: 0.6, 't-junction': 0.5, urban: 1.5 },
    'rural':  { intersection: 0.25, 't-junction': 0.2, urban: 0.4 },
    'wild':   { intersection: 0.05, 't-junction': 0.05, urban: 0.0 },
  };
  const ROADCLASS_JUNCTION = {
    'dense-highway': 0.05, 'remote-highway': 0.1, 'surface-2+2': 0.4,
    'suburban-1+1': 0.8, 'two-lane': 1.0, 'street': 1.2,
  };

  const DEFAULT_CURVE = ROADCLASS_CURVE['two-lane'];
  const DEFAULT_GEOM = ROADCLASS_GEOMETRY['two-lane'];
  const DEFAULT_DENSITY = SETTLEMENT_DENSITY['rural'];
  const DEFAULT_JUNCTION = SETTLEMENT_KIND['rural'];

  // the run containing tile k (runs are startK-sorted; scan back from the end like valueAt). Needed for the
  // blend, which uses startK/endK/style/from — valueAt alone only returns the value.
  function runAt(runs, k) {
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (k >= r.startK && (k < r.endK || r.endK === Infinity)) return r;
    }
    return runs.length ? runs[runs.length - 1] : null;
  }

  // settlement densities at k, blended across a 'gradual' entry (first ~15% of the run, from `from` to
  // `value`); 'sharp' (or no `from`, or a fixed axis) = the rung's densities outright.
  function densityAt(runs, k) {
    const run = runAt(runs, k);
    const target = (run && SETTLEMENT_DENSITY[run.value]) || DEFAULT_DENSITY;
    if (!run || run.style !== 'gradual' || !run.from || !SETTLEMENT_DENSITY[run.from]) return target;
    const span = run.endK - run.startK;
    if (!(span > 0) || !Number.isFinite(span)) return target;
    const blendLen = Math.max(1, Math.round(span * 0.15));
    const t = (k - run.startK) / blendLen;
    if (t >= 1) return target;
    const source = SETTLEMENT_DENSITY[run.from];
    const out = {};
    for (const key of DENSITY_KEYS) out[key] = source[key] + (target[key] - source[key]) * t;
    return out;
  }

  // tileWeights: all 8 kinds named. Curves from roadClass (× userCurviness), junctions from settlement
  // (× the roadClass junction gate). Clamped ≥0; pickKind falls back to uniform if the total is ≤0, so a
  // degenerate config still renders. The kind draw is one RNG pull either way, so side/phase never move.
  function tileWeightsFor(roadClass, settlement, userCurviness) {
    const curve = ROADCLASS_CURVE[roadClass] || DEFAULT_CURVE;
    const junction = SETTLEMENT_KIND[settlement] || DEFAULT_JUNCTION;
    const jGate = ROADCLASS_JUNCTION[roadClass] === undefined ? 1 : ROADCLASS_JUNCTION[roadClass];
    const uc = Number.isFinite(+userCurviness) ? +userCurviness : 1;
    const w = { straight: curve.straight };
    for (const ck of CURVE_KINDS) w[ck] = curve[ck] * uc;
    w['intersection'] = junction['intersection'] * jGate;
    w['t-junction'] = junction['t-junction'] * jGate;
    w['urban'] = junction['urban'] * jGate;
    for (const kd of TILE_KINDS) w[kd] = Math.max(0, +(w[kd] || 0));   // name all 8, clamp ≥0
    return w;
  }

  // timeline memo (single-entry: a road is generated tile-by-tile at one seed+settings). The scheduler has no
  // internal cache and generates runs lazily up to tilesK, so we hold one timeline and grow its horizon
  // geometrically (capped at the scheduler's 10000-tile guard) as k advances — amortised O(k), not O(k²).
  let _key = null, _tl = null, _horizon = 0;
  function timelineFor(seed, settings, k) {
    const E = RF.EndlessAxes;
    const skey = seed + '|' + (typeof settings === 'string' ? settings : JSON.stringify(settings || {}));
    const need = k + 64;
    if (skey === _key && (_horizon >= need || _horizon >= 10000)) return _tl;   // reuse (10000 = capped)
    const base = (skey === _key) ? _horizon : 0;
    const horizon = Math.min(10000, Math.max(need, base * 2, 4096));
    _tl = E.timeline(seed, settings, horizon);   // timeline parses settings internally (pass RAW)
    _key = skey; _horizon = horizon;
    return _tl;
  }

  // the knobs for tile k. Deterministic in (seed, k, settings).
  function settlementRoadAt(seed, k, settings) {
    const E = RF.EndlessAxes;
    const ki = Math.max(0, Math.floor(k));
    const tl = timelineFor(seed, settings, ki);
    const settlement = E.valueAt(tl.axes.settlement, ki);
    const roadClass = E.valueAt(tl.axes.roadClass, ki);
    const density = densityAt(tl.axes.settlement, ki);
    const geom = ROADCLASS_GEOMETRY[roadClass] || DEFAULT_GEOM;
    const userCurviness = (tl.config && tl.config.userCurviness) || 1;
    return {
      settlement, roadClass,
      tileWeights: tileWeightsFor(roadClass, settlement, userCurviness),
      laneCount: geom.laneCount, roadWidth: geom.roadWidth, median: geom.median, shoulder: geom.shoulder,
      buildings: density.buildings, driveways: density.driveways, intersections: density.intersections,
      peds: density.peds, trafficDensity: density.trafficDensity,
      speedLimit: E.speedLimitAt(tl.axes, ki),
    };
  }

  RF.EndlessSettlementRoad = {
    TILE_KINDS, CURVE_KINDS, SETTLEMENT_DENSITY, ROADCLASS_GEOMETRY, ROADCLASS_CURVE, SETTLEMENT_KIND,
    ROADCLASS_JUNCTION, settlementRoadAt, tileWeightsFor, densityAt, runAt,
  };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.EndlessSettlementRoad;
})(typeof globalThis !== 'undefined' ? globalThis : this);
