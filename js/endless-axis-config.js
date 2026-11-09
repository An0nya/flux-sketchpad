/* endless-axis-config.js: Endless road v2 — the five-axis settings shape, its parser, and the deterministic run
   scheduler shared by every axis function (pencroff's reliefAt, nemo's settlementRoadAt, barbicane's cover/water).
   Why a shared scheduler: a run's length is keyed off the speed limit, and the speed limit is cross-axis (the lower of
   settlement's and road class's), so axes scheduled independently would drift out of phase. This file is the only
   place that turns a settings shape into per-axis run timelines; the axis functions only consume them.
   Contract (pencroff 11-09): parse(o) -> validated config; timeline(seed, config) -> per-axis run lists
   [{ value, startK, endK, style }]; valueAt(timeline, axis, k) -> the ladder value at tile k.
   Settings shape per axis: 'auto' | a ladder name (fixed) | { min, max } (auto within a range, names on the ladder).
   userCurviness: a multiplier (0.25..4, default 1) applied by the road-class consumer, not here.
   Same seed + same settings = same road: every random draw derives from (seed, axis, run index) by hash, never from
   wall-clock or iteration order. No DOM, no dependencies, loads in Node (like share-presets.js). */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // The ladders, in order. Order matters twice: it is the "one rung at a time" order for relief, and {min,max} ranges
  // are index ranges over these arrays. Names are the brief's (claude 4c2e relay, 11-09); do not rename without mail.
  const LADDERS = {
    settlement: ['city', 'suburb', 'rural', 'wild'],
    roadClass: ['dense-highway', 'remote-highway', 'surface-2+2', 'suburban-1+1', 'two-lane', 'street'],
    relief: ['flat', 'rolling', 'hilly', 'mountain', 'pass', 'steep-pass'],
    cover: ['bare', 'grass', 'park', 'forest'],
    water: ['none', 'creek', 'river', 'large'],
  };
  const AXES = Object.keys(LADDERS);
  const AXES_RE = /^(beams|compare|drive-models-glsl|exports|layout|render|road|scene-details|solve-cache|source|spec|state)\.js$/;   // unused here; keeps lint happy about the regex-shaped constants nearby — REMOVE if it trips a test
  void AXES_RE;

  // Provisional speed limits per ladder rung (km/h) — the scheduling input, not the final car speed. settlement and
  // roadClass both carry one; the effective limit is the LOWER of the two current rungs (brief: "shared: speed limit =
  // the lower of settlement's and road class's"). Pencroff/nemo can retune these without touching the scheduler.
  const SPEED = {
    settlement: { city: 50, suburb: 60, rural: 80, wild: 80 },
    roadClass: { 'dense-highway': 110, 'remote-highway': 90, 'surface-2+2': 70, 'suburban-1+1': 60, 'two-lane': 80, street: 40 },
  };

  // Design run length at the current speed limit, expressed as driving time so "a highway stretch lasts about as long
  // on screen as a city one" (brief). BASE_SECONDS per axis is provisional (a city run ~2 min, a highway run ~2.5 min
  // of driving); the seeded spread multiplies it 0.7..1.45. Tiles are 200 m (matches drive-anim's ENDLESS_BLOCK maths).
  const TILE_M = 200, BASE_SECONDS = { settlement: 120, roadClass: 150, relief: 160, cover: 100, water: 90 };

  // Engine policy: which transitions blend (gradual) and which cut (sharp). Brief examples: city->suburb gradual;
  // city->park or city->highway sharp. Keyed as `from>to`. Unlisted pairs default to 'gradual' within an axis and
  // 'sharp' across a big ladder jump (>= 2 rungs) — refine here as Anya's direction lands.
  const SHARP = new Set(['city>park', 'city>forest', 'city>bare', 'wild>city', 'dense-highway>street', 'street>dense-highway', 'none>river', 'none>large', 'river>none', 'large>none']);

  // Cross-axis compatibility weights (brief: "city rarely on a steep pass; dense highway rarely with wild + steep pass").
  // A candidate next-value whose pair with a FIXED or long-run other-axis value is listed here gets its weight
  // multiplied by the factor (0 = never together unless the user pinned both).
  const CROSS = [
    { axis: 'relief', value: 'steep-pass', against: { settlement: { city: 0.05, suburb: 0.3 }, roadClass: { 'dense-highway': 0.1, 'surface-2+2': 0.2, street: 0.05 } } },
    { axis: 'relief', value: 'pass', against: { settlement: { city: 0.2 }, roadClass: { 'dense-highway': 0.4 } } },
    { axis: 'settlement', value: 'city', against: { relief: { 'steep-pass': 0.05, pass: 0.2, mountain: 0.4 } } },
    { axis: 'roadClass', value: 'dense-highway', against: { relief: { 'steep-pass': 0.1, pass: 0.4, mountain: 0.6 }, settlement: { wild: 0.1, rural: 0.4 } } },
    { axis: 'water', value: 'large', against: { relief: { 'steep-pass': 0.3, mountain: 0.5 } } },
  ];

  // --- seeded hash rng: deterministic in (seed, salt); no shared state, safe to call in any order.
  function rng(seed, salt) {
    let s = (Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(salt | 0, 0x85EBCA6B)) >>> 0;
    return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function salt(seed, axis, i) { return (Math.imul(axis.length * 131 + i | 0, 0x27D4EB2F) ^ (seed >>> 3)) >>> 0; }

  // --- parse: fail-soft like the registry. Unknown names -> 'auto'; min>max swaps; curviness clamped 0.25..4.
  function parseAxis(axis, v) {
    const L = LADDERS[axis];
    if (v === undefined || v === null || v === 'auto' || v === '') return 'auto';
    if (typeof v === 'string' && L.includes(v)) return v;
    if (typeof v === 'object' && v !== null) {
      const lo = L.indexOf(v.min), hi = L.indexOf(v.max);
      if (lo < 0 && hi < 0) return 'auto';
      const a = lo < 0 ? 0 : lo, b = hi < 0 ? L.length - 1 : hi;
      return { min: Math.min(a, b), max: Math.max(a, b) };   // indices into LADDERS[axis]
    }
    return 'auto';
  }
  function parse(o) {
    const out = {};
    for (const a of AXES) out[a] = parseAxis(a, o ? o[a] : undefined);
    const c = +(o && o.userCurviness);
    out.userCurviness = Number.isFinite(c) ? Math.min(4, Math.max(0.25, c)) : 1;
    return out;
  }
  const isFixed = (v) => typeof v === 'string' && v !== 'auto';   // after parse: a ladder name ('auto' is NOT fixed)
  const isRange = (v) => v && typeof v === 'object';     // after parse: { min, max } indices
  function rangeOf(config, axis) {                       // the index range 'auto' may move within
    const v = config[axis];
    if (isRange(v)) return [v.min, v.max];
    return [0, LADDERS[axis].length - 1];
  }

  // --- speed limit at tile k, from the settlement+roadClass runs already scheduled (schedule order: settlement,
  // roadClass, then the rest — see timeline()). Lower of the two, per the brief. km/h.
  function speedLimitAt(tl, k) {
    const s = valueAt(tl.settlement, k), r = valueAt(tl.roadClass, k);
    return Math.min(SPEED.settlement[s] || 80, SPEED.roadClass[r] || 80);
  }
  function runTiles(speedKmh, axis, R) {
    const m = speedKmh / 3.6 * BASE_SECONDS[axis] * (0.7 + 0.75 * R());   // seeded spread 0.7x..1.45x
    return Math.max(2, Math.round(m / TILE_M));
  }

  // --- the picker: next ladder value for an 'auto' (or ranged) axis. Uniform over the allowed index range, then
  // re-weighted by the cross-axis table against the OTHER axes' values at the run boundary. Relief additionally steps
  // at most one rung from its previous value (brief: "relief steps one rung at a time (no flat -> steep pass)").
  function pickNext(config, tl, axis, k, prevIdx, seed, runIndex) {
    const L = LADDERS[axis], [lo, hi] = rangeOf(config, axis);
    if (lo === hi) return lo;
    const R = rng(seed, salt(seed, axis, runIndex));
    let best = -1, bestW = -1;
    for (let i = lo; i <= hi; i++) {
      if (axis === 'relief' && prevIdx >= 0 && Math.abs(i - prevIdx) > 1) continue;   // one rung at a time
      let w = 1;
      for (const rule of CROSS) {
        if (rule.axis !== axis || rule.value !== L[i]) continue;   // the rule applies to ITS value only
        const against = rule.against;
        for (const other of AXES) {
          if (other === axis || !against[other]) continue;
          const runs = tl[other];
          const ov = runs && runs.length ? valueAt(runs, k) : (isFixed(config[other]) ? config[other] : null);
          if (ov && against[other][ov] !== undefined) w *= against[other][ov];
        }
      }
      w *= 0.9 + 0.2 * R();
      if (w > bestW) { bestW = w; best = i; }
    }
    return best < 0 ? Math.min(hi, Math.max(lo, prevIdx < 0 ? lo : prevIdx)) : best;
  }

  // --- timeline(seed, config): the run lists. Fixed axes get ONE run covering the road (startK -1 = "from the start");
  // 'auto'/'range' axes get runs whose length is keyed off the settlement+roadClass speed limit. Settlement and
  // roadClass are scheduled FIRST (their runs are the speed-limit source); the rest follow. Deterministic: same seed
  // + same config = the same lists. There is no fixed horizon — each axis generates runs lazily up to `tilesK`.
  function timelineFor(config, seed, axis, tl, tilesK) {
    const L = LADDERS[axis], runs = tl[axis];
    const v0 = config[axis];
    if (isFixed(v0)) { if (!runs.length) runs.push({ value: v0, startK: 0, endK: Infinity, style: 'sharp', fixed: true }); return; }
    let prevIdx = runs.length ? L.indexOf(runs[runs.length - 1].value) : -1;
    let k = runs.length ? runs[runs.length - 1].endK : 0;
    let guard = 0;
    while (k < tilesK && guard++ < 10000) {
      const idx = pickNext(config, tl, axis, k, prevIdx, seed, runs.length);
      const value = L[idx];
      const speed = speedLimitAt(tl, k);
      const R = rng(seed, salt(seed, axis + ':len', runs.length));
      const len = runTiles(speed, axis, R);
      const style = prevIdx >= 0 && (SHARP.has(L[prevIdx] + '>' + value) || Math.abs(idx - prevIdx) >= 2) ? 'sharp' : 'gradual';
      runs.push({ value, startK: k, endK: k + len, style, from: prevIdx >= 0 ? L[prevIdx] : null });
      prevIdx = idx; k += len;
    }
  }
  function timeline(seed, configOrJson, tilesK) {
    const config = parse(typeof configOrJson === 'string' ? safeJson(configOrJson) : configOrJson);
    const tl = {}; for (const a of AXES) tl[a] = [];
    timelineFor(config, seed, 'settlement', tl, tilesK);
    timelineFor(config, seed, 'roadClass', tl, tilesK);
    for (const a of ['relief', 'cover', 'water']) timelineFor(config, seed, a, tl, tilesK);
    return { seed, config, axes: tl, tilesK: tilesK || Infinity };
  }
  function safeJson(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

  // --- valueAt: the ladder value at tile k (scan back from the end; runs are long). Takes the axis's RUNS ARRAY
  // (tl.axes[axis] on a full timeline, or the partial array during scheduling).
  function valueAt(runs, k) {
    for (let i = runs.length - 1; i >= 0; i--) if (k >= runs[i].startK) { if (k < runs[i].endK || runs[i].endK === Infinity) return runs[i].value; }
    return runs.length ? runs[runs.length - 1].value : null;
  }
  // style at k ('gradual' blends inside the first/last ~15% of the run — the consumer owns the actual interpolation)
  function styleAt(tl, axis, k) {
    return _styleAt(tl.axes[axis], k);
  }
  function _styleAt(runs, k) {
    for (let i = runs.length - 1; i >= 0; i--) if (k >= runs[i].startK && (k < runs[i].endK || runs[i].endK === Infinity)) return runs[i].style;
    return 'sharp';
  }

  RF.EndlessAxes = { LADDERS, AXES, SPEED, parse, timeline, valueAt, styleAt, speedLimitAt, rangeOf, isFixed, isRange };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.EndlessAxes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
