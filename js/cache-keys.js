// js/cache-keys.js — B3: cache keys derived from registry metadata
//
// Each cache that stores a picture-critical resource declares a recipe:
// an ordered list that produces the same JSON.stringify array as the old
// hand-written key. cacheKey(name, o, extras) walks the recipe.
//
// Old pattern: key = JSON.stringify([o.a, o.b, ...])
// New pattern: key = RF.Options.cacheKey('stillFrame', o, [laneDrive, shape, tint])
//
// Coverage: tests/cache-key-coverage.js reads the recipe's option ids
// against the registry instead of parsing source code.
// tests/halo-cache-keys.js is absorbed.

(function () {
  'use strict';

  // ---- Shared value builders ----
  // These produce values for cache keys that aren't simple option lookups.
  const D = {
    // wetnessOf(o) — derived from wetness and wet-related wetters
    wetnessOf: function (o) { return RF.Drive && RF.Drive.wetnessOf ? RF.Drive.wetnessOf(o) : 0; },
    // o.roadSurface || 'stock'
    roadSurface: function (o) { return o.roadSurface || 'stock'; },
    // !!o.roadSurfaces
    roadSurfaces: function (o) { return !!o.roadSurfaces; },
    // o.oncoming ? [o.onDist, o.onKcd] : undefined (splat when truthy)
    oncomingSplat: function (o) { return o.oncoming ? [o.onDist, o.onKcd] : undefined; },
    // o.preceding ? o.preDist : undefined
    precedingSplat: function (o) { return o.preceding ? o.preDist : undefined; },
    // o.haloCrossingRefine ? [o.haloCrossingRefine, o.haloRefineNeighbour] : undefined
    hcrSplat: function (o) { return o.haloCrossingRefine ? [o.haloCrossingRefine, o.haloRefineNeighbour] : undefined; },
    // o.tiles ? o.endlessPresetCustom || '' : ''
    tilesCustom: function (o) { return o.tiles ? o.endlessPresetCustom || '' : ''; },
    // o.tiles ? o.endlessAxes || '' : '' (harbert 11-10, endless-road-v2 part 2: the axis settings JSON; '' = OFF)
    tilesAxes: function (o) { return o.tiles ? o.endlessAxes || '' : ''; },
    // o.tiles ? o.endlessPreset : 'off'
    tilesPreset: function (o) { return o.tiles ? o.endlessPreset : 'off'; },
    // o.tiles ? [o.streetLamps, o.tex, wetnessOf(o), o.lampRule] : undefined
    tilesLampSplat: function (o) { return o.tiles ? [o.streetLamps, o.tex, D.wetnessOf(o), o.lampRule] : undefined; },
    // o.onMode === 'high-dip' && o.seed — conditional seed
    seedHighDip: function (o) { return o.onMode === 'high-dip' ? o.seed : undefined; },
  };

  // ---- Recipe entries ----
  // An entry is an object with one of:
  //   { id: 'optionId' }           — emit o.optionId (type-specific norm from registry)
  //   { id: 'optionId', type: 'b'|'n'|'s'|'f' }  — emit with explicit type: b=!!, n=+..||0, s=String, f=exactly-true
  //   { ext: N }                   — emit extras[N]
  //   { drv: 'fnName' }            — call D.fnName(o), push result (use 'splat' below instead for arrays)
  //   { spl: 'fnName' }            — call D.fnName(o); if array, spread its elements; if undefined, skip
  //   { sub: [...entries] }        — emit a sub-array (used inside conditional blocks)
  //   { many: 'fnName' }           — call D.fnName(o); if array, emit each as a separate array element
  //
  // Normalisation types for { id } entries:
  //   'b' = boolean (!!v) — default for boolean options
  //   'n' = number (+v || 0) — default for numeric options
  //   's' = string (v || '') — default for string/select options
  //   'f' = flag (v === true)

  // ---- Recipe: stillFrame (CPU still picture, spec-ui.js cpuStill `key`) ----
  // extras[0] = rd.laneDrive, extras[1] = rv.shape, extras[2] = lampTint(ui)
  var stillFrame = [
    { ext: 0 },
    { id: 'scene' },
    { drv: 'wetnessOf', opts: [] },   // derived — wetness itself is exempt; wetters (wetSheen, etc.) are listed separately
    { id: 'wetSheen' },
    { id: 'wetModel' },
    { drv: 'roadSurfaces', opts: 'roadSurfaces' },
    { drv: 'roadSurface', opts: 'roadSurface' },
    { id: 'visibility' },
    { id: 'scatter' },
    { id: 'trafficHalo' },
    { id: 'haloCars' },
    { id: 'haloRange' },
    { id: 'haloBins' },
    { id: 'haloDiv' },
    { id: 'haloPolar' },
    { id: 'haloPolarBand' },
    { id: 'haloPolarLamps' },
    { id: 'crestOcclusion' },
    { id: 'haloJitter' },
    { id: 'haloJitterAmount' },
    { id: 'haloBlur' },
    { id: 'haloDepthBlur' },
    { id: 'haloAutoRange' },
    { id: 'haloNearSub' },
    { id: 'haloLampWin' },
    { spl: 'hcrSplat', opts: 'haloCrossingRefine,haloRefineNeighbour' },
    { id: 'haloConeEqui' },
    { id: 'haloMoment' },
    { id: 'haloConePass' },
    { id: 'haloConeAngle' },
    { id: 'trafficShadows' },
    { id: 'shadowRes' },
    { id: 'trafficShadowRoad' },
    { id: 'trafficShadowObjects' },
    { id: 'trafficShadowSoft' },
    { id: 'scatterCull' },
    { id: 'scatterCullEps' },
    { id: 'scatterRange' },
    { id: 'haloGain' },
    { id: 'scatterMode' },
    { id: 'scatterRes' },
    { id: 'scatterBlur' },
    { id: 'scatterCache' },
    { id: 'scatterCycle' },
    { id: 'scatterNearFade' },
    { id: 'scatterNearFadeRange' },
    { id: 'scatterNearBias' },
    { id: 'scatterBinCounts' },
    { id: 'scatterQuality' },
    { id: 'scatterGain' },
    { id: 'onMode' },
    { spl: 'seedHighDip', opts: 'seed,onMode' },
    { id: 'people' },
    { id: 'animals' },
    { id: 'signs' },
    { id: 'reflectiveClothing' },
    { spl: 'oncomingSplat', opts: 'oncoming,onDist,onKcd' },
    { spl: 'precedingSplat', opts: 'preceding,preDist' },
    { id: 'trafficMarkers' },
    { id: 'RL' },
    { id: 'ambient' },
    { id: 'smooth' },
    { id: 'res' },
    { id: 'fov' },
    { ext: 1 },
    { ext: 2 },
    { id: 'seed' },
    { id: 'haloWidthStep' },
    { id: 'qualityGovernor' },
    { id: 'distanceLod' },
    { id: 'dryStreaks' },
    { id: 'heatShimmer' },
    { id: 'signalConesOn' },
    { id: 'trafficLighting' },
    { id: 'wetBounce' },
    { id: 'wetBouncePlane' },
  ];

  // ---- Recipe: ground (ground texture cache, spec-ui.js groundKey) ----
  // extras[0] = rd.laneDrive, extras[1] = !ECE, extras[2] = rv.shape, extras[3] = mirrored
  var ground = [
    { ext: 0 },
    { ext: 1 },
    { id: 'scene' },
    { drv: 'wetnessOf', opts: [] },
    { id: 'wetSheen' },
    { id: 'wetModel' },
    { id: 'visibility' },
    { id: 'scatter' },
    { id: 'trafficHalo' },
    { id: 'haloCars' },
    { id: 'haloRange' },
    { id: 'haloBins' },
    { id: 'haloDiv' },
    { id: 'haloPolar' },
    { id: 'haloPolarBand' },
    { id: 'haloPolarLamps' },
    { id: 'crestOcclusion' },
    { id: 'haloJitter' },
    { id: 'haloJitterAmount' },
    { id: 'haloBlur' },
    { id: 'haloDepthBlur' },
    { id: 'haloAutoRange' },
    { id: 'haloNearSub' },
    { id: 'haloLampWin' },
    { spl: 'hcrSplat', opts: 'haloCrossingRefine,haloRefineNeighbour' },
    { id: 'haloConeEqui' },
    { id: 'haloMoment' },
    { id: 'haloConePass' },
    { id: 'haloConeAngle' },
    { id: 'trafficShadows' },
    { id: 'shadowRes' },
    { id: 'trafficShadowRoad' },
    { id: 'trafficShadowObjects' },
    { id: 'trafficShadowSoft' },
    { id: 'scatterCull' },
    { id: 'scatterCullEps' },
    { id: 'scatterRange' },
    { id: 'haloGain' },
    { id: 'scatterMode' },
    { id: 'scatterRes' },
    { id: 'scatterBlur' },
    { id: 'scatterCache' },
    { id: 'scatterCycle' },
    { id: 'scatterNearFade' },
    { id: 'scatterNearFadeRange' },
    { id: 'scatterNearBias' },
    { id: 'scatterBinCounts' },
    { id: 'scatterQuality' },
    { id: 'scatterGain' },
    { id: 'RL' },
    { id: 'ambient' },
    { id: 'smooth' },
    { id: 'fov' },
    { ext: 2 },
    { ext: 3 },
    { id: 'haloWidthStep' },
    { id: 'qualityGovernor' },
    { id: 'distanceLod' },
    { id: 'dryStreaks' },
    { id: 'heatShimmer' },
    { id: 'signalConesOn' },
    { id: 'trafficLighting' },
    { id: 'wetBounce' },
    { id: 'wetBouncePlane' },
    { drv: 'roadSurfaces', opts: 'roadSurfaces' },
    { drv: 'roadSurface', opts: 'roadSurface' },
  ];

  // ---- Recipe: animScene (scene source, drive-anim.js skey) ----
  // extras[0] = I.rd.laneDrive, extras[1] = I.us
  // Note: skey/tkey has many conditional extras — we match the full original expression exactly.
  // This recipe defines the OPTION part; call-site extra values are appended via the extras array.
  var animScene = [
    { id: 'scene' },
    { ext: 0 },  // I.rd.laneDrive
    { ext: 1 },  // I.us
    { id: 'people' },
    { id: 'animals' },
    { id: 'signs' },
    { id: 'reflectiveClothing' },
    { id: 'posts' },
    { id: 'powerlines' },
    { id: 'veg' },
    { id: 'obstacle' },
    { id: 'rpm' },
    { id: 'wild' },
    { id: 'seed' },
    { id: 'density' },
    { id: 'cline' },
    { id: 'signalConesOn' },
    { id: 'tiles', type: 'f' },
    { id: 'mountainPass', type: 'f' },
    { id: 'leafyFoliage', type: 'f' },
    { id: 'multilaneRoad', type: 'f' },
    { id: 'endlessTunnel', type: 'f' },
    { id: 'endlessCrossing', type: 'f' },
    { id: 'junctionGantries', type: 'f' },
    { id: 'driftMode', type: 'f' },
    { id: 'driftDynamics', type: 'f' },
    { id: 'driftAfs', type: 'f' },
    { id: 'driftCabin', type: 'f' },
    { id: 'yawSmooth', type: 'f' },
    { id: 'cabinLight', type: 'f' },
    { spl: 'tilesCustom', opts: 'tiles,endlessPresetCustom' },
    { spl: 'tilesAxes', opts: 'tiles,endlessAxes' },
    { ext: 2 },  // SUBTICK reference
    { id: 'cabinMirror', type: 'f' },
    { drv: 'roadSurfaces', opts: 'roadSurfaces' },
    { drv: 'roadSurface', opts: 'roadSurface' },
    // --- tkey traffic options (appended after skey in the real tkey; superset by design —
    //     V.act.clear fires on more inputs than before, not fewer. Safe/conservative.) ---
    { id: 'oncoming' },
    { id: 'preceding' },
    { id: 'onKcd' },
    { id: 'trafficDensity' },
    { id: 'trafficRange' },
    { id: 'safeGap' },
    { id: 'trafficLogic', type: 'f' },
    { id: 'tileCache', type: 'f' },
    { id: 'endlessRoad', type: 'f' },
    { spl: 'tilesPreset', opts: 'tiles,endlessPreset' },
    { id: 'tileTerrain', type: 'f' },
    { id: 'elevatedView', type: 'f' },
    { spl: 'tilesLampSplat', opts: 'tiles,streetLamps,tex,lampRule' },
  ];

  // ---- cacheKey(name, o, extras) ----
  function cacheKey(name, o, extras) {
    var recipe = RECIPES[name];
    if (!recipe) throw new Error('unknown cache: ' + name);
    var parts = [];
    walk(recipe, o, extras, parts);
    return JSON.stringify(parts);
  }

  // Tracing version: returns the key AND the set of option ids actually read.
  // step.id entries are traced; step.drv/step.spl entries report their declared opts.
  // Use this in tests to verify the recipe covers what it claims.
  function cacheKeyTrace(name, o, extras) {
    var recipe = RECIPES[name];
    if (!recipe) throw new Error('unknown cache: ' + name);
    var parts = [], trace = [];
    walk(recipe, o, extras, parts, trace);
    return { key: JSON.stringify(parts), trace: trace };
  }

  // Recursive walk of the recipe. If trace array is passed, records the option ids
  // actually read (via step.id) and the declared opts from drv/spl entries.
  function walk(recipe, o, extras, parts, trace) {
    for (var i = 0; i < recipe.length; i++) {
      var step = recipe[i];
      if (step.ext !== undefined) {
        parts.push(extras[step.ext]);
        if (trace) trace.push('_ext_' + step.ext);
      } else if (step.drv) {
        parts.push(D[step.drv](o));
        if (trace && step.opts) { if (Array.isArray(step.opts)) trace.push.apply(trace, step.opts); else trace.push.apply(trace, step.opts.split(',')); }
      } else if (step.spl) {
        var val = D[step.spl](o);
        if (val !== undefined) {
          if (Array.isArray(val)) parts.push.apply(parts, val);
          else parts.push(val);
        }
        if (trace && step.opts) { if (Array.isArray(step.opts)) trace.push.apply(trace, step.opts); else trace.push.apply(trace, step.opts.split(',')); }
      } else if (step.id) {
        var raw = o[step.id];
        if (trace) trace.push(step.id);
        var type = step.type || defaultType(step.id);
        if (!type) { parts.push(normByType(raw)); }
        else switch (type) {
          case 'b': parts.push(!!raw); break;
          case 'n': parts.push(+raw || 0); break;
          case 's': parts.push(String(raw || '')); break;
          case 'f': parts.push(!!raw); break;
          default: parts.push(raw);
        }
      } else if (step.sub) {
        walk(step.sub, o, extras, parts, trace);
      }
    }
  }

  // Default normalisation type for an option, inferred from the registry
  function defaultType(id) {
    if (typeof RF === 'undefined' || !RF.Options || !RF.Options.OPTIONS) return null; // null = use runtime value's type
    var list = RF.Options.OPTIONS;
    var opt = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { opt = list[i]; break; } }
    if (!opt) return null;
    // Boolean: has boolean default
    if (typeof opt.default === 'boolean') return 'b';
    // Number: default is a number and values are numeric (or null)
    if (typeof opt.default === 'number' && (!opt.values || opt.values.length === 0 || typeof opt.values[0] === 'number')) return 'n';
    // Unable to determine from registry — use runtime value's type
    return null;
  }

  // Normalise a value by its runtime type (fallback when registry doesn't declare the type)
  function normByType(v) {
    if (typeof v === 'boolean') return !!v;
    if (typeof v === 'number') return +v || 0;
    return String(v || '');
  }

  // ---- All recipes ----
  var RECIPES = {
    stillFrame: stillFrame,
    ground: ground,
    animScene: animScene,
  };

  // ---- Option-id collector: which ids appear in a recipe ----
  function recipeOptions(recipe) {
    var ids = [];
    function collect(steps) {
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.id) ids.push(s.id);
        if (s.opts) { if (Array.isArray(s.opts)) ids.push.apply(ids, s.opts); else ids.push.apply(ids, s.opts.split(',')); }  // drv:/spl: entries list the options they touch (string form avoids regex-breaking nested [])
        if (s.sub) collect(s.sub);
      }
    }
    collect(recipe);
    return ids;
  }

  // ---- Named recipe-id collector (for scene-key.js post-B3) ----
  function recipeIds(name) {
    var r = RECIPES[name];
    if (!r) throw new Error('unknown recipe: ' + name);
    return recipeOptions(r);
  }

  // ---- Option map for coverage tests ----
  function optionMap() {
    var m = {};
    for (var name in RECIPES) {
      if (RECIPES.hasOwnProperty(name)) {
        m[name] = recipeOptions(RECIPES[name]);
      }
    }
    return m;
  }

  // ---- Mount ----
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RECIPES: RECIPES, cacheKey: cacheKey, D: D, recipeOptions: recipeOptions, recipeIds: recipeIds, optionMap: optionMap, cacheKeyTrace: cacheKeyTrace };
  }
  if (typeof RF !== 'undefined' && RF.Options) {
    RF.Options.cacheKey = cacheKey;
    RF.Options.cacheDefs = RECIPES;
    RF.Options.cacheOptionMap = optionMap;
    RF.Options.recipeIds = recipeIds;
    RF.Options.cacheKeyTrace = cacheKeyTrace;
  }
})();