/* endless-cover-water.js: Endless road v2 — the cover + water axes → verge / foliage / water knobs (barbicane, 11-10).
   CONSUMES harbert's shared scheduler (RF.EndlessAxes in js/endless-axis-config.js) for the cover and water
   ladder values at each tile, and maps them to the scenery-generation knobs:
     cover  → trees / bushes / deer / rocks / fence / foliage density
     water  → creek / waterFeature / waterWidth / bridge probability

   The cover rungs (bare / grass / park / forest) control what grows beside the road; water rungs
   (none / creek / river / large) control water features. Combined: trees and bushes are denser near
   water (a creek in a park runs through woodland; a river through bare ground has scrub on the banks).

   Interface:
     coverWaterAt(seed, k, settings) -> { cover, water, trees, bushes, deer, rocks, fence,
       creek, waterFeature, waterWidth, bridgeProb, foliageDensity }

   settings = the RAW endless-axes settings object (parsed internally by RF.EndlessAxes.timeline —
     do NOT pre-parse; double-parsing breaks ranges, same rule as endless-relief.js):
       cover: 'auto' | 'bare' | 'grass' | 'park' | 'forest' | {min,max}
       water: 'auto' | 'none' | 'creek' | 'river' | 'large' | {min,max}

   Blending: 'gradual' runs blend knobs over the first ~15% (same contract as settlement-road's
   densityAt). 'sharp' runs switch hard. Blending is between the two cover values (or two water values),
   so "park -> forest" gradually adds trees, "creek -> river" widens water.

   Deterministic in (seed, k, settings). No DOM, loads in Node. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // cover rung → foliage knobs. trees/bushes are counts (0..n); deer is a probability (0..1);
  // rocks only appear on bare ground; fence is on grass/bare (not dense forest/park).
  const COVER_KNOBS = {
    'bare':  { trees: 0, rocks: 2, deer: 0.1,  fence: true,  foliageDensity: 0.05 },
    'grass': { trees: 1, rocks: 0, deer: 0.3,  fence: true,  foliageDensity: 0.25 },
    'park':  { trees: 3, rocks: 0, deer: 0.5,  fence: false, foliageDensity: 0.55 },
    'forest':{ trees: 5, rocks: 0, deer: 0.8,  fence: false, foliageDensity: 0.85 },
  };

  // water rung → water knobs. creek: -1|0|1 side; waterFeature: boolean (visible water near road);
  // waterWidth: metres, for rendering; bridgeProb: probability of a bridge (culvert for creek).
  const WATER_KNOBS = {
    'none':  { waterFeature: false, waterWidth: 0,   bridgeProb: 0 },
    'creek': { waterFeature: false, waterWidth: 3,   bridgeProb: 0.15 },
    'river': { waterFeature: true,  waterWidth: 30,  bridgeProb: 0.7 },
    'large': { waterFeature: true,  waterWidth: 120, bridgeProb: 0.9 },
  };

  // water-adjacent multiplier for trees/bushes: a creek boosts foliage ~30%, a river ~50%, a lake
  // ~80% (scenery clusters near water). Applied AFTER the cover knobs.
  const WATER_FOLIAGE = {
    'none':  1.0,
    'creek': 1.3,
    'river': 1.5,
    'large': 1.8,
  };

  // seeded RNG matching D.rng's hash convention (same as endless-axis-config.js)
  function rng(seed, salt) {
    let s = (Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(salt | 0, 0x85EBCA6B)) >>> 0;
    return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // the run containing tile k (same pattern as settlement-road's runAt). Runs are startK-sorted.
  function runAt(runs, k) {
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (k >= r.startK && (k < r.endK || r.endK === Infinity)) return r;
    }
    return runs.length ? runs[runs.length - 1] : null;
  }

  // blend two cover-knob sets. When a 'gradual' run moves from one cover rung to another,
  // blend the numeric knobs (trees, rocks, deer, foliageDensity). Unseeded: the ramp is the
  // fraction; the caller adds seeded jitter afterward.
  function blendKnobs(fromKnobs, toKnobs, t) {
    const out = {};
    const keys = ['trees', 'rocks', 'deer', 'foliageDensity'];
    for (const k of keys) out[k] = fromKnobs[k] + (toKnobs[k] - fromKnobs[k]) * t;
    return out;
  }

  // cover knobs at tile k, including a 'gradual' blend if the current run started from a
  // different cover rung. fence is the TARGET rung's value (not blended — a fence just appears).
  function coverKnobsAt(tl, k) {
    const E = RF.EndlessAxes;
    const runs = tl.axes.cover;
    const run = runAt(runs, k);
    const target = (run && COVER_KNOBS[run.value]) || COVER_KNOBS['bare'];
    if (!run || run.style !== 'gradual' || !run.from || !COVER_KNOBS[run.from]) return { ...target };
    const span = run.endK - run.startK;
    if (!(span > 0) || !Number.isFinite(span)) return { ...target };
    const blendLen = Math.max(1, Math.round(span * 0.15));
    const t = (k - run.startK) / blendLen;
    if (t >= 1) return { ...target };
    const source = COVER_KNOBS[run.from];
    const blended = blendKnobs(source, target, t);
    return Object.assign(blended, { fence: target.fence });   // fence is the target's, not blended
  }

  // water knobs at tile k. Water doesn't blend (a creek becomes a river at a single tile — the
  // ramp is the visual bridge, not a gradual on-screen change). The non-numeric knobs
  // (waterFeature) follow the target rung.
  function waterKnobsAt(tl, k) {
    const runs = tl.axes.water;
    const value = RF.EndlessAxes.valueAt(runs, k);
    return { ...(WATER_KNOBS[value] || WATER_KNOBS['none']) };
  }

  // creek side: -1 (left of the road), 1 (right), or 0 (no creek). Seeded by tile.
  function creekSide(seed, k, waterKnobs) {
    if (waterKnobs.waterWidth <= 0) return 0;
    const R = rng(seed ^ 0x85EBCA6B, k + 1);
    return R() < 0.5 ? -1 : 1;
  }

  // timeline memo (same pattern as settlement-road: one entry, geometric horizon growth).
  let _key = null, _tl = null, _horizon = 0;
  function timelineFor(seed, settings, k) {
    const E = RF.EndlessAxes;
    const skey = seed + '|' + (typeof settings === 'string' ? settings : JSON.stringify(settings || {}));
    const need = k + 64;
    if (skey === _key && (_horizon >= need || _horizon >= 10000)) return _tl;
    const base = (skey === _key) ? _horizon : 0;
    const horizon = Math.min(10000, Math.max(need, base * 2, 4096));
    _tl = E.timeline(seed, settings, horizon);   // timeline parses settings internally (pass RAW)
    _key = skey; _horizon = horizon;
    return _tl;
  }

  // the knobs for tile k. Deterministic in (seed, k, settings).
  function coverWaterAt(seed, k, settings) {
    const E = RF.EndlessAxes;
    const ki = Math.max(0, Math.floor(k));
    const tl = timelineFor(seed, settings, ki);
    const cover = E.valueAt(tl.axes.cover, ki);
    const water = E.valueAt(tl.axes.water, ki);
    const cKnobs = coverKnobsAt(tl, ki);
    const wKnobs = waterKnobsAt(tl, ki);

    // seeded per-tile draw for the tree/bush counts (round the blended value with seeded jitter)
    const R = rng(seed ^ 0x27D4EB2F, ki + 1);
    const wf = WATER_FOLIAGE[water] || 1.0;
    const jitterTree  = (cKnobs.trees  * wf) + (R() * 2 - 1) * 0.5;
    const jitterBush  = ((cKnobs.trees > 0 ? cKnobs.trees * 0.8 : 0.5) * wf) + (R() * 2 - 1) * 0.5;
    const jitterRock  = cKnobs.rocks + (R() * 2 - 1) * 0.5;
    const trees  = Math.max(0, Math.round(jitterTree));
    const bushes = Math.max(0, Math.round(jitterBush));
    const rocks  = Math.max(0, Math.round(jitterRock));

    return {
      cover, water,
      trees, bushes, deer: cKnobs.deer, rocks,
      fence: cKnobs.fence,
      creek: wKnobs.waterFeature ? 0 : creekSide(seed, ki, wKnobs),
      waterFeature: wKnobs.waterFeature,
      waterWidth: wKnobs.waterWidth,
      bridgeProb: wKnobs.bridgeProb,
      foliageDensity: cKnobs.foliageDensity * wf,
    };
  }

  RF.EndlessCoverWater = { COVER_KNOBS, WATER_KNOBS, WATER_FOLIAGE, coverWaterAt, coverKnobsAt, waterKnobsAt, creekSide };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.EndlessCoverWater;
})(typeof globalThis !== 'undefined' ? globalThis : this);