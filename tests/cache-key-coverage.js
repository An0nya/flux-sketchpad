// tests/cache-key-coverage.js — B3: declaration-based cache key coverage
// Replaces the old source-code-parsing approach. Reads RF.Options.cacheDefs
// (the recipe declarations in js/cache-keys.js) and checks them against the
// option registry. Every picture-affecting profile option must appear in at
// least one cache recipe OR be explicitly exempt.
//
// Additionally: a sensitivity test that proves changing an option value
// changes the corresponding cache key.

const { load } = require('./load.js');
const RF = load();
const assert = require('assert');

const ok = (name, pass, detail) => { console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  - ' + detail : ''}`); if (!pass) process.exitCode = 1; };

// ---- 1. Verify cacheDefs exist and have expected caches ----
ok('RF.Options.cacheDefs is an object', typeof RF.Options.cacheDefs === 'object' && RF.Options.cacheDefs !== null);
const cacheNames = Object.keys(RF.Options.cacheDefs || {});
ok('cacheDefs includes stillFrame', cacheNames.includes('stillFrame'));
ok('cacheDefs includes ground', cacheNames.includes('ground'));
ok('cacheDefs includes animScene', cacheNames.includes('animScene'));
console.log('Caches defined: ' + cacheNames.join(', '));

// ---- 2. Option map: collect all option ids from all cache recipes ----
const optionMap = RF.Options.cacheOptionMap ? RF.Options.cacheOptionMap() : {};
if (typeof optionMap !== 'object') {
  console.log('[FAIL] RF.Options.cacheOptionMap() did not return an object');
  process.exit(1);
}

// Merge all cache option ids into one set
const allCacheOpts = new Set();
for (const name of cacheNames) {
  const ids = optionMap[name] || [];
  for (const id of ids) allCacheOpts.add(id);
}
ok('option map covers all caches', allCacheOpts.size > 0, allCacheOpts.size + ' unique option ids across ' + cacheNames.length + ' caches');

// ---- 3. Exemption list ----
// Same exemptions as before, verified against current registry
const EXEMPT = {
  trafficBeams:    'GPU-only recompile; in V.p read each frame',
  surfaceSheen:    'GPU-only per-frame; in V.p.look',
  lampPitch:       'GPU-only per-frame; in V.p.look',
  afs:             'GPU-only per-frame; in V.p.look',
  corneringLamps:  'GPU-only per-frame; in V.p.look',
  wetVeil:         'GPU-only recompile; in V.p',
  lampCone:        'GPU-only per-frame; in V.p',
  lampConeGain:    'GPU-only free; in V.p',
  lampClass:       'GPU-only free; in V.p',
  lampRoad:        'GPU-only per-frame; in V.p',
  scatterCycleFade:'GPU-only recompile; in V.p.look',
  powerlineReflectance: 'Free; in V.p.look',
  trafficSubTick:  'Free; in V.p.look',
  canvasShape:     'GPU-only per-frame; viewport aspect, not picture content',
  cabinView:       'Pure 2D overlay; read from o.cabinView each frame',
  cabinStyle:      'Overlay-only; drawn each frame',
  cabinFovFrame:   'Overlay-only; drawn each frame',
  cabinDigitalRedesign: 'Overlay-only; drawn each frame',
  cabinGaugeLight:   'Overlay-only; drawn by drawCabin each frame, zero render change (ecf2)',
  cabinZoom:         'Overlay-only; drawn by drawCabin each frame, zero render change (ecf2)',
  cabinOffsetX:      'Overlay-only; drawn by drawCabin each frame, zero render change (ecf2)',
  cabinOffsetY:      'Overlay-only; drawn by drawCabin each frame, zero render change (ecf2)',
  imperialUnits:   'Display-only; read via fmtSpeed each frame',
  playing:         'View state, not picture content',
  driveScrub:      'View state, not picture content',
  speed:           'View state, not picture content',
  expMode:         'Exposure mode label; ev is the actual value',
  glare:           'Exposure level; derived from wetness/visibility',
  ev:              'Display-time tone mapping, not during scene build',
  mt:              'Worker thread count; performance, not picture',
  largeCard:       'Diagnostics; UI layout',
  animateUI:       'Diagnostics; UI animation',
  panelMode:       'Diagnostics; UI layout',
  fpsCounter:      'Diagnostics; overlay',
  sceneDetails:    'Diagnostics; overlay',
  debugTimings:    'Diagnostics; overlay',
  dynamicResolution: 'Performance; render scale',
  frameTargetMs:   'Performance; frame timing',
  minFps:          'Performance; frame timing',
  samples:         'Performance; ray count for solver',
  detailedModels:  'In V.p; read each frame by tileWorld',
  gpuRenderer:     'Renderer swap; handled by V.three',
  wet:             'Derived: wetnessOf(o) is in cache keys',
  trafficLightRange: 'Per-frame GPU; in V.p.look',
  trafficNearest:  'Per-frame GPU; in V.p.look',
  simCeiling:      'Performance; solver resolution ceiling',
  trafficShuffle:  'Table-rebuild; handled by trafficLogic in tkey',
  trafficOutIds:   'Table-rebuild; handled by trafficLogic in tkey',
};

console.log('\nExemptions (' + Object.keys(EXEMPT).length + ' total):');
for (const [id, reason] of Object.entries(EXEMPT)) {
  console.log('  ' + id + ': ' + reason);
}
console.log('');

// ---- 4. Coverage check ----
const profile = RF.Options.OPTIONS.filter(o => o.kind === 'profile');
const pictureAffecting = profile.filter(o => !EXEMPT[o.id]);
const missing = [];

for (const o of pictureAffecting) {
  if (!allCacheOpts.has(o.id)) {
    missing.push(o.id + ' (' + o.group + '/' + o.cost + ')');
  }
}

ok('every picture-affecting profile option is in at least one cache recipe (or exempt)',
  missing.length === 0,
  missing.length ? 'MISSING: ' + missing.join(', ') : `${pictureAffecting.length} options checked, ${Object.keys(EXEMPT).length} exempt`);

// ---- 5. Exemption list validation ----
const exemptIds = Object.keys(EXEMPT);
const unknownExempt = exemptIds.filter(id => !profile.find(o => o.id === id));
ok('every exempt option exists in the registry', unknownExempt.length === 0,
  unknownExempt.length ? 'unknown: ' + unknownExempt.join(', ') : `${exemptIds.length} exempt ids all valid`);

// ---- 6. Stale exemption check ----
const staleExempt = exemptIds.filter(id => allCacheOpts.has(id));
ok('no exempt option appears in a cache recipe (exemption list is not stale)',
  staleExempt.length === 0,
  staleExempt.length ? 'stale exemptions: ' + staleExempt.join(', ') : 'all active');

// ---- 7. Halo family regression ----
const haloOpts = ['haloMoment', 'haloWidthStep', 'haloCrossingRefine', 'haloRefineNeighbour'];
const haloMissing = haloOpts.filter(id => !allCacheOpts.has(id));
ok('halo family: haloMoment, haloWidthStep, haloCrossingRefine, haloRefineNeighbour are all in at least one cache',
  haloMissing.length === 0, haloMissing.length ? 'missing: ' + haloMissing.join(', ') : 'all 4 present');

// ---- 8. Road surfaces check ----
['roadSurfaces', 'roadSurface'].forEach(id => {
  ok('roadSurfaces in option map: ' + id, allCacheOpts.has(id) || optionMap.stillFrame.includes(id));
});

// ---- 9. Sensitivity test: changing an option changes the cache key ----
(function sensitivityTest() {
  const o = Object.assign({}, RF.Options.defaults());
  // Ensure non-null values for the options we test
  if (o.visibility == null) o.visibility = 0;
  if (o.onMode == null) o.onMode = 'off';
  const extras = [3.5, 'straight', [255, 255, 255]];

  const key1 = RF.Options.cacheKey('stillFrame', o, extras);

  // Change a value that IS in the stillFrame cache
  const o2 = Object.assign({}, o);
  o2.wetBounce = !o2.wetBounce;  // flip wetBounce

  const key2 = RF.Options.cacheKey('stillFrame', o2, extras);
  ok('sensitivity: changing wetBounce changes the stillFrame key',
    key1 !== key2, 'key1 length=' + key1.length + ', key2 length=' + key2.length);

  // Change a value that is NOT in stillFrame (should NOT change the key)
  const o3 = Object.assign({}, o);
  o3.mt = (o3.mt || 1) + 1;  // mt is not in stillFrame

  const key3 = RF.Options.cacheKey('stillFrame', o3, extras);
  ok('sensitivity: changing mt (not in stillFrame) does NOT change the stillFrame key',
    key1 === key3, key1 === key3 ? '' : 'unexpected change');

  // ---- 9b. Equivalence: 'f' type normalisation - truthy non-boolean !== true ----
  // B3's type 'f' uses !!raw (matching old !!o.flag behavior). Verify no truthy-non-bool
  // causes divergence for options with explicit type:'f' in any recipe (not splat options).
  var fCaches = ['stillFrame', 'ground', 'animScene'];
  var fExtras = { stillFrame: [3.5, 'straight', [255,255,255]], ground: [3.5, 'straight', [255,255,255]], animScene: [3.5, 42, 0] };
  var fSafe = 0, fRisky = [];
  // Collect ids with explicit type:'f' from recipes (not splats — those emit raw values)
  var fOptions = [];
  var fSeen = {};
  for (var ci = 0; ci < fCaches.length; ci++) {
    var recipe = RF.Options.cacheDefs[fCaches[ci]];
    if (!recipe) continue;
    var cExtras = fExtras[fCaches[ci]];
    for (var si = 0; si < recipe.length; si++) {
      var step = recipe[si];
      if (step.type === 'f' && step.id) {
        var key = fCaches[ci] + '.' + step.id;
        if (!fSeen[key]) { fSeen[key] = true; fOptions.push({ cache: fCaches[ci], id: step.id, extras: cExtras }); }
      }
    }
  }
  for (var fi = 0; fi < fOptions.length; fi++) {
    var fo = fOptions[fi];
    var oFuzz = Object.assign({}, o);
    oFuzz[fo.id] = 1;
    var fuzzKey = RF.Options.cacheKey(fo.cache, oFuzz, fo.extras);
    oFuzz[fo.id] = true;
    var cleanKey = RF.Options.cacheKey(fo.cache, oFuzz, fo.extras);
    if (fuzzKey !== cleanKey) fRisky.push(fo.cache + '.' + fo.id);
    else fSafe++;
  }
  ok("'f' normalisation: no truthy-non-boolean divergence for type:'f' entries",
    fRisky.length === 0, fRisky.length === 0 ? fSafe + ' safe' : 'DIVERGES: ' + fRisky.join(', ') + ' / ' + fSafe + ' safe');

  // ---- 9c. animScene structural equivalence ----
  // The animScene recipe produces an array whose first 35 JSON entries match the pre-B3
  // hand-written skey byte-for-byte (verified by nicholl 35/35 audit and pencroff).
  // This self-consistency check ensures the recipe is stable.
  var so = Object.assign({}, RF.Options.defaults());
  so.visibility = 0; so.onMode = 'off';
  var sExtras = [3.5, 42, 0];    // laneDrive, us, SUBTICK
  var newSkey = RF.Options.cacheKey('animScene', so, sExtras);
  var newParts = JSON.parse(newSkey);
  ok('animScene recipe produces a stable deterministic key (35+ entries)',
    newParts.length >= 35, newParts.length + ' entries');
  // Re-key to verify idempotence
  var reSkey = RF.Options.cacheKey('animScene', so, sExtras);
  ok('animScene cache key is idempotent',
    newSkey === reSkey, newSkey === reSkey ? 'idempotent' : 'non-deterministic');
})();

// ---- 10. Live-key wiring guard (neb's three-part design) ----
(function wiringGuard() {
  var WETNESS = RF.Drive.wetnessOf || function(o) { return o.wet ? 1 : 0; };
  var ANIM = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'js', 'drive-anim.js'), 'utf8');

  // Evaluate the live key, which for animScene includes the hand-written traffic tail
  // from the call site (the tail is still appended by the live code).  The call site
  // pattern is:
  //   const skey = RF.Options.cacheKey('animScene', o, [...]), tkey = JSON.stringify([skey, o.oncoming, ...]);
  // We evaluate the same tail on our o so the guard sees the actual live key.
  // Find the tail array by bracket-matching after 'tkey = JSON.stringify([skey,'.
  var tailIdx = ANIM.indexOf('tkey = JSON.stringify([skey,');
  if (tailIdx < 0) throw new Error('cannot find tkey expression');
  var open = ANIM.indexOf('[', tailIdx), depth = 0, tailExpr = '';
  for (var ji = open; ji < ANIM.length; ji++) {
    if (ANIM[ji] === '[') depth++;
    else if (ANIM[ji] === ']') { depth--; if (depth === 0) { tailExpr = ANIM.slice(open, ji + 1); break; } }
  }
  if (!tailExpr) throw new Error('unbalanced tkey bracket');
  // Remove the leading 'skey,' so we are left with '[o.oncoming, ...]'
  tailExpr = '[' + tailExpr.slice(7);   // skip '[skey, '
  var D = { wetnessOf: WETNESS };
  var liveKey = function(name, o, ex) {
    var key = RF.Options.cacheKey(name, o, ex);
    if (name !== 'animScene') return key;
    // Evaluate the tail: the expression reads o.* and D.wetnessOf(o)
    var tail;
    try {
      tail = new Function('o', 'skey', 'D', 'return JSON.stringify(' + tailExpr + ');')(o, key, D);
    } catch(e) { throw new Error('tail eval failed: ' + e.message); }
    return key + '|' + tail;
  };

  // Pre-B3 frozen subject lists — generated by notes/neb/tools/b3-frozen-lists.js,
  // the only source that was never derived from the recipe.  Ordered.
  var FROZEN_STILLFRAME = ["scene","wet","wetSheen","wetModel","roadSurfaces","roadSurface","visibility","scatter","trafficHalo","haloCars","haloRange","haloBins","haloDiv","haloPolar","haloPolarBand","haloPolarLamps","crestOcclusion","haloJitter","haloJitterAmount","haloBlur","haloDepthBlur","haloAutoRange","haloNearSub","haloLampWin","haloCrossingRefine","haloConeEqui","haloMoment","haloConePass","haloConeAngle","trafficShadows","shadowRes","trafficShadowRoad","trafficShadowObjects","trafficShadowSoft","scatterCull","scatterCullEps","scatterRange","haloGain","scatterMode","scatterRes","scatterBlur","scatterCache","scatterCycle","scatterNearFade","scatterNearFadeRange","scatterNearBias","scatterBinCounts","scatterQuality","scatterGain","onMode","people","animals","signs","reflectiveClothing","oncoming","preceding","trafficMarkers","RL","ambient","smooth","res","fov","seed","haloWidthStep","qualityGovernor","distanceLod","dryStreaks","heatShimmer","signalConesOn","trafficLighting","wetBounce","wetBouncePlane"];
  var FROZEN_GROUND = ["scene","wet","wetSheen","wetModel","visibility","scatter","trafficHalo","haloCars","haloRange","haloBins","haloDiv","haloPolar","haloPolarBand","haloPolarLamps","crestOcclusion","haloJitter","haloJitterAmount","haloBlur","haloDepthBlur","haloAutoRange","haloNearSub","haloLampWin","haloCrossingRefine","haloConeEqui","haloMoment","haloConePass","haloConeAngle","trafficShadows","shadowRes","trafficShadowRoad","trafficShadowObjects","trafficShadowSoft","scatterCull","scatterCullEps","scatterRange","haloGain","scatterMode","scatterRes","scatterBlur","scatterCache","scatterCycle","scatterNearFade","scatterNearFadeRange","scatterNearBias","scatterBinCounts","scatterQuality","scatterGain","RL","ambient","smooth","fov","haloWidthStep","qualityGovernor","distanceLod","dryStreaks","heatShimmer","signalConesOn","trafficLighting","wetBounce","wetBouncePlane","roadSurfaces","roadSurface"];
  var FROZEN_ANIMSCENE = ["scene","people","animals","signs","reflectiveClothing","posts","powerlines","veg","obstacle","rpm","wild","seed","density","cline","signalConesOn","tiles","mountainPass","leafyFoliage","multilaneRoad","endlessTunnel","endlessCrossing","junctionGantries","driftMode","driftDynamics","driftAfs","driftCabin","yawSmooth","cabinLight","cabinMirror","roadSurfaces","roadSurface","oncoming","preceding","onKcd","onMode","trafficDensity","trafficRange","safeGap","trafficLogic","trafficMarkers","tileCache","tileTerrain","elevatedView"];
  var FROZEN = { stillFrame: FROZEN_STILLFRAME, ground: FROZEN_GROUND, animScene: FROZEN_ANIMSCENE };

  // Unique ids declared by the recipe (id + opts from each step, for the "no dead wiring" check).
  var recipeCoverage = {};
  for (var rn in RF.Options.cacheDefs) {
    if (!RF.Options.cacheDefs.hasOwnProperty(rn)) continue;
    var cov = [];
    for (var si = 0; si < RF.Options.cacheDefs[rn].length; si++) {
      var step = RF.Options.cacheDefs[rn][si];
      if (step.id) cov.push(step.id);
      if (step.opts) {
        var opts = Array.isArray(step.opts) ? step.opts : step.opts.split(',');
        for (var oi = 0; oi < opts.length; oi++) { var oid = opts[oi].trim(); if (oid) cov.push(oid); }
      }
    }
    recipeCoverage[rn] = cov.filter(function(v, i, a) { return a.indexOf(v) === i; });
  }

  // Measured allow-list: ids whose flip does not change the live key, with a reason.
  // haloRefineNeighbour: dead unless haloCrossingRefine is ON (not in the default base).
  // onMode (stillFrame): the { id:'onMode' } step emits the string, but off->on doesn't change
  //   the pure stillFrame key (it is only picture-affecting in 'high-dip' via seedHighDip splat).
  var ALLOW = { stillFrame: ['haloRefineNeighbour', 'onMode'], ground: ['haloRefineNeighbour'], animScene: [] };

  // Flip helpers — handle null/undefined defaults by probing with type alternates.
  var flip = function(o, id) {
    // Value in play (base overrides, then defaults).
    var cur = o.hasOwnProperty(id) ? o[id] : RF.Options.defaults()[id];
    if (cur === null || cur === undefined) return [true, 1, 'on'];  // probe all three
    if (typeof cur === 'boolean') return [!cur];
    if (typeof cur === 'number') return [(cur || 0) + 1];
    if (typeof cur === 'string') return [cur === 'off' ? 'on' : 'off'];
    return [true, 1, 'on'];
  };

  var caches = ['stillFrame', 'ground', 'animScene'];
  var fails = [];
  var ex = { stillFrame: [3.5, 'straight', [255,255,255]], ground: [3.5, 'straight', [255,255,255]], animScene: [3.5, 42, 0] };
  var extrasCount = { stillFrame: 3, ground: 4, animScene: 3 };  // ground: [laneDrive, presetCheck, shape, mirrored]
  // Ground's second extra: whether the preset is not ECE (used to separate beam tables).
  var groundExtras = [3.5, 'straight', [255,255,255], false];  // matched to the live call-site shape

  for (var ci = 0; ci < caches.length; ci++) {
    var cName = caches[ci];
    var e = cName === 'ground' ? groundExtras : ex[cName];
    var eCount = extrasCount[cName];
    var baseOpts = Object.assign({}, RF.Options.defaults());
    baseOpts.visibility = 0;
    baseOpts.oncoming = true; baseOpts.preceding = true;   // make splats live
    var baseKey = liveKey(cName, baseOpts, e.slice(0, eCount));

    // — A — no DROP: every option the OLD live key covered must still change the NEW live key —
    for (var fi = 0; fi < FROZEN[cName].length; fi++) {
      var fid = FROZEN[cName][fi];
      var probes = flip(baseOpts, fid);
      var hit = false;
      for (var pi = 0; pi < probes.length; pi++) {
        var alt = Object.assign({}, baseOpts); alt[fid] = probes[pi];
        if (liveKey(cName, alt, e.slice(0, eCount)) !== baseKey) { hit = true; break; }
      }
      if (!hit) fails.push(cName + ': LOST ' + fid);
    }

    // — B — no dead wiring: every option the recipe declares must change the live key, unless allow-listed —
    for (var di = 0; di < recipeCoverage[cName].length; di++) {
      var did = recipeCoverage[cName][di];
      if (ALLOW[cName].indexOf(did) >= 0) continue;
      var dprobes = flip(baseOpts, did);
      var dhit = false;
      for (var dp = 0; dp < dprobes.length; dp++) {
        var dalt = Object.assign({}, baseOpts); dalt[did] = dprobes[dp];
        if (liveKey(cName, dalt, e.slice(0, eCount)) !== baseKey) { dhit = true; break; }
      }
      if (!dhit) fails.push(cName + ': declared but not wired: ' + did);
    }

    // — C — every extras position must be read —
    for (var ek = 0; ek < eCount; ek++) {
      var ep = e.slice(0, eCount);
      if (typeof e[ek] === 'boolean') ep[ek] = !e[ek];
      else if (typeof e[ek] === 'number') ep[ek] = e[ek] + 1;
      else if (typeof e[ek] === 'string') ep[ek] = e[ek] + '__X';
      else ep[ek] = [9, 9, 9];
      if (RF.Options.cacheKey(cName, baseOpts, e.slice(0, eCount)) === RF.Options.cacheKey(cName, baseOpts, ep)) {
        fails.push(cName + ': extras position ' + ek + ' is never read');
      }
    }
  }

  ok('live-key wiring guard: no drops, no dead wiring, no unread extras',
    fails.length === 0,
    fails.length === 0 ? 'clean (' + FROZEN_STILLFRAME.length + '/' + FROZEN_GROUND.length + '/' + FROZEN_ANIMSCENE.length + ' subject ids, ' + recipeCoverage.stillFrame.length + '/' + recipeCoverage.ground.length + '/' + recipeCoverage.animScene.length + ' coverage ids)' : 'FAILS: ' + fails.join(' | '));
})();

console.log('\ncache-key coverage (B3 declaration-based): ' + pictureAffecting.length + ' picture-affecting options, ' + exemptIds.length + ' exempt, ' + missing.length + ' missing');