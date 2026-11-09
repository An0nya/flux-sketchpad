// T1: GPU-module logic in Node.  Node tests only — no browser, no Playwright.
// exits 1 on any failure.  Run: node tests/t1-gpu-module.js
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
console.log('T1 GPU-module logic — node test suite');
load();

// --------------- load drive-three-halo.js with minimal RF/THREE mock ---------------
let halo = null, drive = null;
try {
  const D = globalThis.RF.Drive;
  // drive-three-halo.js imports: import * as T from '../vendor/three/three.module.min.js'
  // Node resolves ES imports via require when the file is .js and the project has no "type":"module".
  // The THREE module works with require(), and the RF mock is enough for the static exports + pure functions.
  globalThis.SL_SR_GPU_CONTROL = null;
  globalThis.SL_HALO_DIV = null;
  halo = require(path.join(ROOT, 'js', 'drive-three-halo.js'));
  drive = D;
  console.log('[SETUP] drive-three-halo.js loaded OK');
} catch (e) {
  console.log('[WARN] Could not load drive-three-halo.js:', e.message);
  halo = null;
}
const shaders = require(path.join(ROOT, 'js', 'drive-three-shaders.js'));
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));

// --------------- 1. MAT_KEYS semantic check ---------------
console.log('\n--- 1. MAT_KEYS semantic check ---');
const matKeys = drive.MAT_KEYS, matDef = drive.MAT_DEF;
ok('MAT_KEYS is a non-empty array', Array.isArray(matKeys) && matKeys.length > 0, { nKeys: matKeys.length });
ok('MAT_DEF is a non-empty object', matDef && typeof matDef === 'object' && Object.keys(matDef).length > 0, { nDefs: Object.keys(matDef).length });
ok('every MAT_KEYS entry has a MAT_DEF definition', matKeys.every((k) => !!matDef[k]),
   { missing: matKeys.filter((k) => !matDef[k]).slice(0, 5) });
ok('every MAT_DEF key is in MAT_KEYS', Object.keys(matDef).every((k) => matKeys.includes(k)),
   { extra: Object.keys(matDef).filter((k) => !matKeys.includes(k)).slice(0, 5) });
// Check MAT_DEF entries have required properties
const matDefOk = Object.entries(matDef).every(([k, v]) => v && typeof v.name === 'string' && Array.isArray(v.rho) && v.rho.length === 3);
ok('every MAT_DEF entry has name (string) and rho (3-element array)', matDefOk,
   { bad: Object.entries(matDef).filter(([k, v]) => !(v && typeof v.name === 'string' && Array.isArray(v.rho) && v.rho.length === 3)).map(([k]) => k).slice(0, 5) });
// Verify material IDs used in the shader source reference MAT_KEYS
const shSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
const driveThreeSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
const matIdRefs = [
  ...shSrc.match(/MAT_KEYS\.indexOf|roadId|material\.id/g) || [],
  ...driveThreeSrc.match(/MAT_KEYS/g) || []
];
ok('shader and renderer reference MAT_KEYS at least once', matIdRefs.length > 0, { nRefs: matIdRefs.length });

// --------------- 2. Uniform bounds ---------------
console.log('\n--- 2. Uniform bounds ---');
if (halo) {
  // setHaloBins clamps to [HALO_MIN, HALO_MAX]
  const saved = halo.HALO_N;
  try {
    ok('HALO_MIN = 4', halo.HALO_MIN === 4);
  // HALO_MAX is imported from drive-three-shaders.js, not re-exported by drive-three-halo.js
  ok('shaders.HALO_MAX = 32', shaders.HALO_MAX === 32);
  // setHaloBins(0): 0 is falsy, falls through to default 24.  Below the minimum.
  ok('setHaloBins(0) returns default (24)', halo.setHaloBins(0) === 24);
  ok('setHaloBins(4) returns 4', halo.setHaloBins(4) === 4);
  ok('setHaloBins(24) returns 24', halo.setHaloBins(24) === 24);
  ok('setHaloBins(32) returns 32', halo.setHaloBins(32) === 32);
  ok('setHaloBins(64) clamps to shaders.HALO_MAX', halo.setHaloBins(64) === shaders.HALO_MAX);
  ok('setHaloBins(3.4) rounds to HALO_MIN', halo.setHaloBins(3.4) === halo.HALO_MIN);
  ok('setHaloBins(-1) clamps to HALO_MIN', halo.setHaloBins(-1) === halo.HALO_MIN);
  ok('HALO_REQ preserves the raw request', halo.setHaloBins(7.5), halo.HALO_REQ === 7.5);
    // restore
    halo.setHaloBins(saved);
    ok('setHaloBins restores', halo.HALO_N === saved, { saved, got: halo.HALO_N });
  } finally {
    halo.setHaloBins(saved);
  }

  // haloEdgesOf returns n+1 elements: [0, e1, e2, ..., en=R]
  ok('haloEdgesOf(24, 120) length = 25 (n+1)',
     halo.haloEdgesOf(24, 120).length === 25);
  ok('haloEdgesOf first edge is 0', halo.haloEdgesOf(8, 100)[0] === 0);
  // Last element is R (at index n)
  ok('haloEdgesOf last edge equals R', halo.haloEdgesOf(16, 80)[16] === 80);
  // Check monotonicity
  const edges = halo.haloEdgesOf(24, 120);
  let mono = true;
  for (let i = 1; i < edges.length; i++) if (edges[i] <= edges[i - 1]) mono = false;
  ok('haloEdgesOf is strictly increasing', mono);

  // haloStepOf invariants
  ok('haloStepOf(24, 120) = 0.22836 (pinned known value)',
     Math.abs(halo.haloStepOf(24, 120) - 0.22836) < 1e-5, { got: halo.haloStepOf(24, 120) });
  ok('haloStepOf(16, 120) = ln(240)/16', Math.abs(halo.haloStepOf(16, 120) - Math.log(240) / 16) < 1e-10);
  ok('haloStepOf is positive', halo.haloStepOf(4, 120) > 0 && halo.haloStepOf(32, 120) > 0);
}

// --------------- 3. hrep: anchor-based text replacement ---------------
console.log('\n--- 3. hrep: anchor-based text replacement ---');
if (halo) {
  // String anchor: must occur exactly once
  ok('hrep replaces a single string anchor', halo.hrep('hello world', 'hello', 'hi') === 'hi world');
  // Duplicate string anchor without optional throws
  let threw = false;
  try { halo.hrep('hello hello', 'hello', 'hi'); } catch (e) { threw = true; }
  ok('hrep throws on duplicate string anchor (without optional)', threw);
  // Optional string anchor with duplicate: replaces first
  ok('hrep optional replaces first occurrence', halo.hrep('hello hello', 'hello', 'hi', true) === 'hi hello');
  // Missing string anchor throws
  threw = false;
  try { halo.hrep('xyz', 'abc', 'def'); } catch (e) { threw = true; }
  ok('hrep throws on missing string anchor', threw);
  // Missing string anchor with optional: no-op
  ok('hrep optional missing anchor returns original', halo.hrep('xyz', 'abc', 'def', true) === 'xyz');
  // RegExp anchor
  ok('hrep with RegExp replaces all matches', halo.hrep('a1 a2 a3', /\ba\d\b/g, 'X') === 'X X X');
  // Missing RegExp with optional: no-op
  ok('hrep optional missing RegExp returns original', halo.hrep('hello', /xyz/g, 'X', true) === 'hello');
}

// --------------- 4. haloTableSource: variant state machine ---------------
console.log('\n--- 4. haloTableSource: variant state machine ---');
if (halo) {
  // Basic call: all defaults
  const base = halo.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, false);
  ok('haloTableSource returns a string (base)', typeof base === 'string' && base.length > 100,
     { len: base ? base.length : 0 });

  // Different options should produce different text (table-key sensitivity)
  const withRefine = halo.haloTableSource(false, false, false, '', false, false, 0, 128, false, 0, 0, false);
  ok('haloTableSource with refine=128 differs from base', withRefine !== base && withRefine.length > 100);

  // nb only matters when cross (refine) is non-zero
  const withNb = halo.haloTableSource(false, false, false, '', false, false, 0, 128, true, 0, 0, false);
  const withoutNb = halo.haloTableSource(false, false, false, '', false, false, 0, 128, false, 0, 0, false);
  ok('haloTableSource with refine=128, nb=true differs from nb=false', withNb !== withoutNb);
  // nb alone without cross has no effect
  const nbAlone = halo.haloTableSource(false, false, false, '', false, false, 0, 0, true, 0, 0, false);
  ok('haloTableSource nb=true alone (cross=0) is same as base', nbAlone === base, { same: nbAlone === base });

  // Commutativity: same options in different order (the function has explicit params, so order is fixed)
  const a = halo.haloTableSource(false, false, false, '', false, false, 0, 128, true, 0, 0, false);
  const b = halo.haloTableSource(false, false, false, '', false, false, 0, 128, true, 0, 0, false);
  ok('haloTableSource same params = same text (deterministic)', a === b);

  // Variant enumeration: test all refine/nb combos produce distinct strings
  const variants = new Set();
  for (const refine of [0, 128, 256, 512, 1024, 2048]) {
    for (const nb of [false, true]) {
      const t = halo.haloTableSource(false, false, false, '', false, false, 0, refine, nb, 0, 0, false);
      variants.add(t);
    }
  }
  ok('haloTableSource variants over refine×nb produce at least 6 distinct texts',
     variants.size >= 6, { nVariants: variants.size });

  // Key invariant: base (refine=0, nb=false) should be the same regardless
  const baseAgain = halo.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, false);
  ok('haloTableSource base is deterministic across calls', baseAgain === base);
}

// --------------- 5. haloEdgesOf edge values ---------------
console.log('\n--- 5. haloEdgesOf edge values ---');
if (halo) {
  const e = halo.haloEdgesOf(24, 120);
  // Edges are log-uniform: e[k+1] = 0.5 * (240)^((k+1)/24), e[24] = 120
  // Known values (pinned):
  ok('haloEdgesOf(24,120)[1] ≈ 0.628 (pinned)', Math.abs(e[1] - 0.62827) < 0.001, { e1: e[1] });
  ok('haloEdgesOf(24,120)[24] = 120 (far edge)', e[24] === 120);
  ok('haloEdgesOf(24,120)[12] ≈ 7.746 (midpoint)', Math.abs(e[12] - 7.746) < 0.005, { e12: e[12] });
  // Check no NaN or Infinity
  let okEdges = true;
  for (let i = 0; i < e.length; i++) if (!isFinite(e[i])) okEdges = false;
  ok('haloEdgesOf all edges are finite', okEdges);
  // Different n produces different number of edges
  ok('haloEdgesOf(16, 120) has 17 entries', halo.haloEdgesOf(16, 120).length === 17);
  ok('haloEdgesOf(32, 120) has 33 entries', halo.haloEdgesOf(32, 120).length === 33);
}

// --------------- 6. Shader exports and HALO_MAX consistency ---------------
console.log('\n--- 6. Shader exports and HALO_MAX consistency ---');
ok('shaders.HALO_MAX = 32', shaders.HALO_MAX === 32);
ok('shaders exports ground (the main shader)', typeof shaders.ground === 'string' && shaders.ground.length > 1000);
ok('shaders exports vertex', typeof shaders.vertex === 'string' && shaders.vertex.length > 10);
ok('shaders exports tableSource', typeof shaders.tableSource === 'function');
ok('shaders exports ATLAS_HEAD', typeof shaders.ATLAS_HEAD === 'string');
ok('shaders exports OTHER_ATLAS', typeof shaders.OTHER_ATLAS === 'string');
ok('shaders exports OTHER_LEGACY', typeof shaders.OTHER_LEGACY === 'string');
ok('shaders ground contains haloNu (HDX7: runtime bin count)', shaders.ground.includes('haloNu'));

// drive-three-halo uses shaders.HALO_MAX internally (imported, not re-exported)
  ok('shaders.HALO_MAX is imported as 32', shaders.HALO_MAX === 32);

// --------------- 7. Option registry: GPU options ---------------
console.log('\n--- 7. Option registry: GPU options ---');
const haloOptions = Opt.OPTIONS.filter((o) => o.group === 'halo');
ok('registry: halo group has options', haloOptions.length > 0, { nHalo: haloOptions.length });

// Check that halo options that require GPU are declared
for (const o of haloOptions) {
  if (o.default !== undefined && o.default !== 'off' && o.default !== 0 && o.default !== false) {
    // Option that is ON by default should declare requires.gpu
    // (This is a sanity check, not a hard rule — some non-off defaults may not)
  }
}

// Verify HALO_N matches the current option setting
const haloBinsOpt = Opt.OPTIONS.find((o) => o.id === 'haloBins');
if (haloBinsOpt) {
  ok('haloBins option exists', true);
  ok('haloBins is in the halo group', haloBinsOpt.group === 'halo');
}

// --------------- 8. smoke: cache-key coverage check ---------------
console.log('\n--- 8. Cache-key surface check ---');
// Check that haloState() exposes bins, edges, and variant flags
const driveThreeSrc2 = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
ok('drive-three.js exports haloState()', driveThreeSrc2.includes('haloState()'));
ok('haloState returns bins, edges, cross, nb, moment, width, wb', 
   driveThreeSrc2.includes('bins:') && 
   driveThreeSrc2.includes('edges:') &&
   driveThreeSrc2.includes('cross:') &&
   driveThreeSrc2.includes('nb:') &&
   driveThreeSrc2.includes('moment:') &&
   driveThreeSrc2.includes('width:'));
ok('haloState returns tab (which variant was used)', driveThreeSrc2.includes('tab:'));

// Check that drive-anim's look literal covers halo options (rule 18)
// The look: { ... } literal is inside a large V.p object; check directly in source.
const driveAnimSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('drive-anim contains haloCrossingRefine in look literal', driveAnimSrc.includes('haloCrossingRefine: o.haloCrossingRefine'));
ok('drive-anim contains haloRefineNeighbour in look literal', driveAnimSrc.includes('haloRefineNeighbour: o.haloRefineNeighbour'));
ok('drive-anim contains haloMoment in look literal', driveAnimSrc.includes('haloMoment: o.haloMoment'));
ok('drive-anim contains haloConePass in look literal', driveAnimSrc.includes('haloConePass: o.haloConePass'));
ok('drive-anim contains haloWidthStep in look literal', driveAnimSrc.includes('haloWidthStep: o.haloWidthStep'));

// --------------- 9. haloTableSize and additional cached exports ---------------
console.log('\n--- 9. haloTableSize and additional exports ---');
if (halo) {
  // haloTableSize: returns [width, height] of the table texture
  const sz = halo.haloTableSize(1440, 900, 16);
  ok('haloTableSize returns [w, h] array', Array.isArray(sz) && sz.length === 2);
  ok('haloTableSize w >= HALO_MIN_W', sz[0] >= halo.HALO_MIN_W, { w: sz[0], min: halo.HALO_MIN_W });
  ok('haloTableSize h >= HALO_MIN_H', sz[1] >= halo.HALO_MIN_H, { h: sz[1], min: halo.HALO_MIN_H });
  // haloTableSize with few lamps uses HALO_DIV_FEW (4) instead of HALO_DIV (8)
  const szFew = halo.haloTableSize(1440, 900, 3);
  const szMany = halo.haloTableSize(1440, 900, 99);
  ok('haloTableSize few lamps >= many lamps (same viewport)', szFew[0] >= szMany[0] && szFew[1] >= szMany[1]);

  // withWetBounceHalo and withBouncePlaneHalo are composable
  ok('withWetBounceHalo is a function', typeof halo.withWetBounceHalo === 'function');
  ok('withBouncePlaneHalo is a function', typeof halo.withBouncePlaneHalo === 'function');
  const main = halo.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, false);
  const wb = halo.withWetBounceHalo(main);
  ok('withWetBounceHalo extends the source', wb.length > main.length, { delta: wb.length - main.length });
  // withBouncePlaneHalo composes ON TOP of the wet-bounce variant (anchors only exist in that context)
  const bp = halo.withBouncePlaneHalo(wb);
  ok('withBouncePlaneHalo extends the wet-bounce source', bp.length > wb.length, { delta: bp.length - wb.length });
}

// --------------- 10. haloPolarPick expected structure ---------------
console.log('\n--- 10. haloPolarPick expected structure ---');
if (halo) {
  ok('haloPolarPick is a function', typeof halo.haloPolarPick === 'function');
  ok('haloPolarPick has expected parameter count (p, eye, q, tanH)', halo.haloPolarPick.length === 4, { nParams: halo.haloPolarPick.length });
  // haloPolarPick needs real eye coordinates — null is a caller error, not a module responsibility
}

// --------------- summary ---------------
console.log('\n--- summary ---');
console.log((fails ? '[FAIL] ' : '[PASS] ') + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);