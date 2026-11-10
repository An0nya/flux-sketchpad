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
// NOTE: after ecf2 lands, add: cabinGaugeLight, cabinZoom, cabinOffsetX, cabinOffsetY (overlay-only, drawCabin)

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
})();

console.log('\ncache-key coverage (B3 declaration-based): ' + pictureAffecting.length + ' picture-affecting options, ' + exemptIds.length + ' exempt, ' + missing.length + ' missing');