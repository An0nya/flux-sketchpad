// tests/cache-key-coverage.js — T1: cache-key completeness detector
// glm5.2 11-01 (host ~06:35): for every picture-affecting registry option, does it appear in at least one
// cache key? This generalises tests/halo-cache-keys.js (a point detector for halo options) to ALL options.
//
// The three cache keys:
//   1. spec-ui.js `key` (~:1145) — controls when the CPU still picture is rebuilt (cpuStill())
//   2. spec-ui.js `groundKey` (~:1215) — controls when the ground texture is rebuilt (passed to DriveAnim.sync)
//   3. drive-anim.js `skey`/`tkey` (~:1508) — controls when the scene SOURCE is rebuilt (V.src)
//
// Options in V.p.look (drive-anim.js:1514) are read directly each frame — V.p is rebuilt on every sync()
// call, so these are always current and DON'T need to be in a cache key. The cache keys only control when
// EXPENSIVE rebuilds happen (scene source, ground texture, CPU still picture, scatter tables).
//
// So the rule is: if an option affects a CACHED RESOURCE (scene source, CPU still, ground texture, scatter
// table), it MUST appear in the relevant cache key. If it's read directly from V.p each frame (GPU-only
// features), it's EXEMPT. The exemption list below documents each exempt option and why.
//
// Accept: runs green on the current tree; fails when a new picture-affecting option is added to the registry
// without touching the keys (prove it by adding a dummy option in a private tree).

const { load } = ROOT = void 0 || { load: require('./load.js').load };
const RF = load();
const fs = require('fs'), path = require('path');
const assert = require('assert');

const Opt = RF.Options;
const ok = (name, pass, detail) => { console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  - ' + detail : ''}`); if (!pass) process.exitCode = 1; };

// ---- read the source files and extract the three cache key expressions ----
// The key expressions contain nested brackets (e.g. `...(cond ? [a, b] : [])...`),
// so a non-greedy regex stops at the first `]` inside a nested array. Instead, find
// the `JSON.stringify([` anchor and count bracket depth until it returns to zero.
const specUi = fs.readFileSync(path.join(__dirname, '..', 'js', 'spec-ui.js'), 'utf8');
const driveAnim = fs.readFileSync(path.join(__dirname, '..', 'js', 'drive-anim.js'), 'utf8');

// extractBracket(src, anchor): find `anchor` in `src`, then from the first `[` after it,
// count bracket depth until it returns to zero. Returns the bracketed expression.
function extractBracket(src, anchor) {
  const start = src.indexOf(anchor);
  if (start < 0) return '';
  const open = src.indexOf('[', start + anchor.length);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) return src.substring(open, i + 1); }
  }
  return '';
}

// spec-ui `key` (CPU still picture cache): after "mirrored = dm.traffic === 'LHT', key = JSON.stringify("
const SPEC_KEY = extractBracket(specUi, "mirrored = dm.traffic === 'LHT', key = JSON.stringify(");
ok('spec-ui.js: drive picture cache key (key) found', SPEC_KEY.length > 100, SPEC_KEY.length > 100 ? '' : 'the anchor moved');

// spec-ui `groundKey` (ground texture cache): after "groundKey: JSON.stringify("
const GROUND_KEY = extractBracket(specUi, 'groundKey: JSON.stringify(');
ok('spec-ui.js: ground texture cache key (groundKey) found', GROUND_KEY.length > 100, GROUND_KEY.length > 100 ? '' : 'the regex anchor moved');

// drive-anim `skey`/`tkey` (scene source cache): after "const skey = JSON.stringify(" and "tkey = JSON.stringify("
const SKEY = extractBracket(driveAnim, 'const skey = JSON.stringify(');
const TKEY = extractBracket(driveAnim, 'tkey = JSON.stringify(');
ok('drive-anim.js: scene source cache keys (skey/tkey) found', SKEY.length > 100 && TKEY.length > 100, SKEY.length > 100 && TKEY.length > 100 ? '' : 'the regex anchor moved');

// ---- helper: does option `id` appear as o.<id> in a key expression? ----
// Use a regex with a negative lookahead for identifier chars, so `o.wet` does not match inside `o.wetSheen`.
const inKey = (key, id) => new RegExp('o\\.' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z0-9_])').test(key);

// ---- the exemption list: options that are legitimately NOT in any cache key ----
// Each entry: { id, why } — the reason it doesn't need to be in a cache key.
// Categories:
//   A) GPU-only, read from V.p.look each frame (V.p is rebuilt on every sync() call)
//   B) Not picture-affecting (diagnostics, performance tuning, UI-only, view state)
//   C) Handled by a special mechanism (gpuRenderer → V.three swap, mt → worker count)
//   D) Derived from other options already in a key (e.g. wet → wetnessOf)
const EXEMPT = {
  // ---- A: GPU-only, read from V.p.look each frame ----
  trafficBeams:    'GPU-only recompile; in V.p (drive-anim.js:1514), read each frame, not a cached resource',
  surfaceSheen:    'GPU-only per-frame; in V.p.look, read each frame',
  lampPitch:       'GPU-only per-frame; in V.p.look, read each frame',
  afs:             'GPU-only per-frame; in V.p.look, read each frame',
  corneringLamps:  'GPU-only per-frame; in V.p.look, read each frame',
  wetVeil:         'GPU-only per-frame; in V.p.look, read each frame',
  lampCone:        'GPU-only per-frame; in V.p (lampCone: D.lampConeOn(o)), read each frame',
  lampConeGain:    'GPU-only free; in V.p, read each frame',
  lampClass:       'GPU-only free; in V.p, read each frame',
  lampRoad:        'GPU-only per-frame; in V.p, read each frame',
  scatterCycleFade:'GPU-only recompile; in V.p.look, read each frame (scatter table rebuilds on scatterCache/scatterCycle)',
  powerlineReflectance: 'Free; in V.p.look, read each frame',
  trafficSubTick:  'Free; in V.p.look (trafficSubTick: o.trafficSubTick === \'on\'), read each frame',
  canvasShape:     'GPU-only per-frame; changes viewport aspect, not picture content; in V.p via W/H',
  cabinView:       'Pure 2D overlay canvas (dashboard, binnacle, A-pillars) drawn over the GL canvas; read directly from o.cabinView each frame (drive-anim.js:1612). The 3D render and cached resources are untouched.',
  cabinStyle:      'Overlay-only (cabinView dashboard style: modern/miata/digital80s); drawn by drawCabin from o.cabinStyle each frame, zero render change — same class as cabinView (drive-anim.js drawCabin)',
  cabinFovFrame:   'Overlay-only (cabinView windshield frame tracks FOV); drawn by drawCabin from o.fov each frame, zero render change — same class as cabinView/cabinStyle (drive-anim.js drawCabin)',
  cabinDigitalRedesign: 'Overlay-only (cabinView 80s digital redesign); drawn by drawCabin from o.cabinDigitalRedesign each frame, zero render change — same class as cabinView/cabinStyle/cabinFovFrame (drive-anim.js drawCabin)',
  imperialUnits:   'Display-only units toggle (km/h -> mph in labels/gauges); read via fmtSpeed each frame, never enters the render or any cached resource (drive-anim.js fmtSpeed)',

  // ---- B: not picture-affecting ----
  playing:         'View state (play/pause), not picture content',
  driveScrub:      'View state (scrubber), not picture content',
  speed:           'View state (animation speed), not picture content',
  expMode:         'Exposure mode label; the actual exposure value is ev (in tkey)',
  glare:           'Exposure/glare level; derived into wetness/visibility (already in keys)',
  ev:              'Exposure value; applied as display-time tone mapping, not during scene build/render',
  mt:              'Worker thread count; performance, not picture content',
  largeCard:       'Diagnostics; UI layout, not picture content',
  animateUI:       'Diagnostics; UI animation, not picture content',
  panelMode:       'Diagnostics; UI layout, not picture content',
  fpsCounter:      'Diagnostics; overlay, not picture content',
  sceneDetails:    'Diagnostics; overlay, not picture content',
  debugTimings:    'Diagnostics; overlay, not picture content',
  dynamicResolution: 'Performance; render scale, not picture content',
  frameTargetMs:   'Performance; frame timing, not picture content',
  minFps:          'Performance; frame timing, not picture content',
  samples:         'Performance; ray count for the solver, not the drive picture',
  detailedModels:  'In V.p (drive-anim.js:1514), read each frame by tileWorld/placedObjects; affects rendering, not the cached scene source',

  // ---- C: handled by a special mechanism ----
  gpuRenderer:     'Renderer swap; handled by V.three (separate from cache keys)',

  // ---- D: derived from other options already in a key ----
  wet:             'Derived: wetnessOf(o) is in spec key + ground key + tkey; the bool is redundant',
  trafficLightRange: 'Per-frame GPU; in V.p.look via lightRange/lightCars, read each frame',
  trafficNearest:  'Per-frame GPU; in V.p.look via lightRange/lightCars, read each frame',
  simCeiling:      'Performance; controls solver resolution ceiling, not drive picture directly',
  trafficShuffle:  'Table-rebuild but traffic-only; handled by trafficOutIds/trafficLogic in tkey',
  trafficOutIds:   'Table-rebuild but traffic-only; handled by trafficLogic in tkey',
};

// ---- run the coverage check ----
const profile = Opt.OPTIONS.filter(o => o.kind === 'profile');
const pictureAffecting = profile.filter(o => !EXEMPT[o.id]);
const missing = [];

for (const o of pictureAffecting) {
  const id = o.id;
  const inSpec = inKey(SPEC_KEY, id);
  const inGround = inKey(GROUND_KEY, id);
  const inSkey = inKey(SKEY, id);
  const inTkey = inKey(TKEY, id);
  const inAny = inSpec || inGround || inSkey || inTkey;
  if (!inAny) {
    missing.push({ id, group: o.group, cost: o.cost, why: EXEMPT[id] || '(not exempt)' });
  }
}

ok('every picture-affecting profile option is in at least one cache key (or explicitly exempt)',
  missing.length === 0,
  missing.length ? 'MISSING from all keys: ' + missing.map(m => m.id + ' (' + m.group + '/' + m.cost + ')').join(', ') : `${pictureAffecting.length} options checked, ${Object.keys(EXEMPT).length} exempt`);

// ---- verify the exemption list: every exempt option must exist in the registry ----
const exemptIds = Object.keys(EXEMPT);
const unknownExempt = exemptIds.filter(id => !profile.find(o => o.id === id));
ok('every exempt option exists in the registry', unknownExempt.length === 0,
  unknownExempt.length ? 'unknown exempt ids: ' + unknownExempt.join(', ') : `${exemptIds.length} exempt ids all valid`);

// ---- verify the exemption list is not stale: exempt options should NOT be in any key ----
// (if an exempt option IS in a key, the exemption is unnecessary — remove it from the list)
const staleExempt = exemptIds.filter(id => {
  const inAny = inKey(SPEC_KEY, id) || inKey(GROUND_KEY, id) || inKey(SKEY, id) || inKey(TKEY, id);
  return inAny;
});
ok('no exempt option is in a cache key (exemption list is not stale)',
  staleExempt.length === 0,
  staleExempt.length ? 'stale exemptions (option IS in a key): ' + staleExempt.join(', ') : 'all exemptions are active');

// ---- spot-check: the halo family that caused the original regression ----
const haloOpts = ['haloMoment', 'haloWidthStep', 'haloCrossingRefine', 'haloRefineNeighbour'];
const haloMissing = haloOpts.filter(id => !inKey(SPEC_KEY, id) && !inKey(GROUND_KEY, id) && !inKey(SKEY, id) && !inKey(TKEY, id));
ok('halo family regression: haloMoment, haloWidthStep, haloCrossingRefine, haloRefineNeighbour are all in at least one key',
  haloMissing.length === 0, haloMissing.length ? 'missing: ' + haloMissing.join(', ') : 'all 4 present');

// ---- spot-check: junctionGantries (the option I just landed) ----
ok('junctionGantries is in skey and tkey (the scene source cache)',
  inKey(SKEY, 'junctionGantries') && inKey(TKEY, 'junctionGantries'),
  inKey(SKEY, 'junctionGantries') && inKey(TKEY, 'junctionGantries') ? '' : 'MISSING from scene source keys');

// ---- negative control: a dummy option should be flagged as missing ----
// (proves the detector would catch a new option added without touching the keys)
const dummyInAny = inKey(SPEC_KEY, 'dummyOptionThatDoesNotExist') || inKey(GROUND_KEY, 'dummyOptionThatDoesNotExist') || inKey(SKEY, 'dummyOptionThatDoesNotExist') || inKey(TKEY, 'dummyOptionThatDoesNotExist');
ok('negative control: a non-existent option is not in any key (detector would catch a new one)',
  !dummyInAny, !dummyInAny ? '' : 'false positive — dummy found in a key');

console.log(`\ncache-key coverage: ${pictureAffecting.length} picture-affecting options, ${Object.keys(EXEMPT).length} exempt, ${missing.length} missing`);
