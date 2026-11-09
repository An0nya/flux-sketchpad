/* endless-relief.js: Endless road v2 — the relief axis (pencroff, 11-09).
   Relief is an independent axis: flat / rolling / hilly / mountain / pass / steep-pass.
   It decouples grade from biome (the old endlessGrade derived grade from the biome walk).

   This file CONSUMES harbert's shared scheduler (RF.EndlessAxes.parse/timeline/valueAt in
   js/endless-axis-config.js) for the relief value at each block. The grade-pick and cumulative
   height function are owned here. The height function feeds RF.Touge.elevate (drive-touge.js)
   the same way the old endlessElev did — no solver boundary, no changes to the 3D pipeline.

   The height function keeps the old endlessElev structure: fixed 16-tile blocks (ENDLESS_BLOCK),
   RAMP=100m vertical curves at block boundaries. The grade for each block comes from the
   scheduler's relief value at that block's start tile (not from the biome walk). The scheduler's
   one-rung-at-a-time constraint is at the RUN level; block-level sampling may cross run
   transitions, but the RAMP smooths the grade transition at block boundaries regardless.

   Interface:
     reliefAt(seed, block, settings) -> { relief: 'mountain', grade: 0.04 }
     reliefGrade(seed, block, settings) -> signed grade (rise/run)
     reliefHeightFn(seed, settings) -> fn(absS, off) absolute elevation (cumulative grade walk)

   settings = the raw endless-axes settings object (parsed internally by RF.EndlessAxes.timeline):
     relief: 'auto' | 'flat' | 'rolling' | 'hilly' | 'mountain' | 'pass' | 'steep-pass' | {min, max}
   No DOM, no dependencies, loads in Node (like endless-axis-config.js). */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  const RELIEF_BLOCK = 16 * 200;   // one relief block = 16 tiles = 3.2 km (matches ENDLESS_BLOCK)
  const RAMP = 100;                // vertical-curve ramp at block boundaries (m), matches the old RAMP

  // grade ranges per relief rung (rise/run, signed magnitude before the ± seed)
  const RELIEF_GRADES = {
    'flat':       [0, 0],
    'rolling':    [0.005, 0.015],   // ±0.5-1.5%
    'hilly':      [0.01, 0.03],     // ±1-3%
    'mountain':   [0.02, 0.06],     // ±2-6% (matches the old mountain biome)
    'pass':       [0.04, 0.08],     // ±4-8% (matches the old forested-pass preset)
    'steep-pass': [0.06, 0.12],     // ±6-12%, clamped at 12% like custom grades
  };

  // seeded RNG matching D.rng's hash convention (same as endless-axis-config.js)
  function rng(seed, salt) {
    let s = (Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(salt | 0, 0x85EBCA6B)) >>> 0;
    return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // pick a signed grade from the relief rung's range, seeded by block
  function pickGrade(relief, seed, block) {
    const [lo, hi] = RELIEF_GRADES[relief] || [0, 0];
    if (lo === 0 && hi === 0) return 0;
    const R = rng(seed ^ 0x27D4EB2F, block + 1);
    const mag = lo + (hi - lo) * R();
    return (R() < 0.5 ? -1 : 1) * mag;
  }

  // the relief value + grade at a block, consuming the shared scheduler.
  // NOTE: pass RAW settings (not pre-parsed) — timeline() parses internally; double-parsing breaks ranges.
  function reliefAt(seed, block, settings) {
    const E = RF.EndlessAxes;
    const tilesK = (block + 2) * 16 + 64;
    const tl = E.timeline(seed, settings, tilesK);   // timeline parses internally
    const relief = E.valueAt(tl.axes.relief, block * 16);
    const grade = pickGrade(relief, seed, block);
    return { relief, grade };
  }

  // the grade for a block (replaces endlessGrade in the v2 integration)
  function reliefGrade(seed, block, settings) {
    return reliefAt(seed, block, settings).grade;
  }

  // build the cumulative height function (replaces endlessElev's internal grade walk)
  // returns fn(absS, off) -> absolute elevation, deterministic in (seed, s, settings)
  // Structure matches the old endlessElev: fixed 16-tile blocks, RAMP at boundaries.
  // The grade for each block comes from the scheduler's relief value at that block's start tile.
  function reliefHeightFn(seed, settings) {
    const E = RF.EndlessAxes;
    // pre-generate a generous timeline (the road is endless but z(s) is lap-periodic)
    const tilesK = 4096;
    const tl = E.timeline(seed, settings, tilesK);   // timeline parses internally

    const g = [], cum = [0];   // g[b] = block grade; within a block the grade ramps g[b-1]->g[b] over the first RAMP m and g[b]->g[b+1] over the last
    const blockZ = (b) => RAMP * (g[b - 1 < 0 ? 0 : b - 1] + g[b]) / 2 + (RELIEF_BLOCK - 2 * RAMP) * g[b] + RAMP * (g[b] + g[b + 1]) / 2;
    const ensure = (b) => {
      while (g.length <= b + 1) {
        const i = g.length;
        const relief = E.valueAt(tl.axes.relief, i * 16);
        g.push(pickGrade(relief, seed, i));
        if (i > 0) cum[i] = cum[i - 1] + blockZ(i - 1);
      }
    };
    ensure(1);
    const zAt = (s) => {
      const b = Math.max(0, Math.floor(s / RELIEF_BLOCK)); ensure(b);
      const u = s - b * RELIEF_BLOCK, g0 = g[b], gP = g[b - 1 < 0 ? 0 : b - 1], gN = g[b + 1];
      if (u < RAMP) { const t = u / RAMP; return cum[b] + gP * u + (g0 - gP) * u * u / (2 * RAMP); }
      if (u > RELIEF_BLOCK - RAMP) { const w = u - (RELIEF_BLOCK - RAMP); return cum[b] + RAMP * (gP + g0) / 2 + (RELIEF_BLOCK - 2 * RAMP) * g0 + g0 * w + (gN - g0) * w * w / (2 * RAMP); }
      return cum[b] + RAMP * (gP + g0) / 2 + g0 * (u - RAMP);
    };
    return (s, off) => zAt(s);
  }

  RF.EndlessRelief = { RELIEF_BLOCK, RAMP, RELIEF_GRADES, reliefAt, reliefGrade, reliefHeightFn };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.EndlessRelief;
})(typeof globalThis !== 'undefined' ? globalThis : this);
