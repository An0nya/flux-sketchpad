// pencroff — endless-road-v2: srcArgs starvation guard (cyrus's root cause, board item 15).
// The srcArgs opts object at drive-anim.js:~1747 is the ONLY input to source() on the live render
// path (and to the worker cfg path, which serializes V.srcArgs at :2015). It once omitted
// endlessAxes + 10 other tile keys that source() reads at :59, so every rebuild was a no-op for the
// whole tiles option group — the v2 axes/multilane/tunnel/etc. never reached the renderer. Node
// tests call source() directly with full opts, so they stayed green and missed it (cyrus 16:41Z).
// This guard reads the srcArgs literal from the source and asserts every key source() consumes is
// present — a text guard, but the right level: it catches the exact regression (a key dropped from
// the srcArgs object) in milliseconds, without a browser. The page-level proof is D4-drive-tiles.
// Run: node tests/endless-srcargs-wiring.js — exits 1 on failure.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + extra : '')); } };

const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');

// The keys source() reads from the opts (4th) argument at the src.tiles build line.
const TILES_KEYS = ['endlessAxes', 'endlessPreset', 'endlessPresetCustom', 'tileTerrain', 'multilaneRoad', 'endlessTunnel', 'endlessCrossing', 'junctionGantries', 'yawSmooth', 'driftMode', 'lampRule'];

// Find the srcArgs assignment: V.srcArgs = [o.scene, ..., { ...opts... }, { ...tiles+traffic... }]
const m = src.match(/V\.srcArgs = \[o\.scene,.*?\]; const old = V\.src;/);
ok('srcArgs assignment found in drive-anim.js', !!m, 'the V.srcArgs = [...] line is missing or changed shape');

if (m) {
  const srcArgsLine = m[0];
  // The opts object is the 5th element (index 4): { leafyFoliage: ..., wet: D.wetnessOf(o) > 0, ... }
  // Extract the last object literal in the array (the tiles+traffic opts).
  const optsMatch = srcArgsLine.match(/\{ leafyFoliage:.*?wet: D\.wetnessOf\(o\) > 0[^}]*\}/);
  ok('tiles+traffic opts object found in srcArgs', !!optsMatch, 'the opts object literal is missing or moved');

  if (optsMatch) {
    const optsText = optsMatch[0];
    for (const key of TILES_KEYS) {
      ok('srcArgs opts carries ' + key, optsText.includes(key + ':'), 'key "' + key + '" is absent from the srcArgs opts object — source() will see it as undefined');
    }
  }
}

// Also verify the worker path serializes V.srcArgs (so the fix propagates to workers automatically).
ok('worker cfg serializes V.srcArgs (fix propagates to workers)', /src:\s*V\.srcArgs/.test(src), 'the worker cfg message must carry V.srcArgs so workers rebuild from the same opts');

// Behavioural proof (not just text): call source() through the SAME opts shape srcArgs builds, with
// and without the keys, and confirm the keys actually reach src.tiles.
const { load } = require('./load.js');
const RF = load(['endless-axis-config', 'endless-relief', 'endless-settlement-road', 'endless-cover-water', 'endless-traffic']);
const A = RF.DriveAnim;
const axesF = RF.EndlessAxes.fromUi({
  settlement: { lo: 'city', hi: 'city' }, roadClass: { lo: 'street', hi: 'street' },
  relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' }
}, 1);

// BEFORE: the starved opts (what srcArgs was before the fix)
const optsStarved = { leafyFoliage: false, reflectiveClothing: false, wild: true, seed: 7, density: 1, cline: 'broken', oncoming: true, preceding: true, onKcd: 30, onMode: 'generic', trafficDensity: 1, trafficRange: 120, safeGap: false, trafficLogic: false, trafficMarkers: true, trafficLighting: 'off', endlessRoad: true, elevatedView: true, speed: 50, mountainPass: false, tiles: true, tileCache: false, streetLamps: 'sodium', tex: true, wet: false };
// AFTER: the fed opts (what srcArgs is after the fix)
const optsFed = Object.assign({}, optsStarved, { endlessAxes: axesF, endlessPreset: 'off', endlessPresetCustom: '', tileTerrain: false, multilaneRoad: true, endlessTunnel: false, endlessCrossing: false, junctionGantries: false, yawSmooth: false, driftMode: false });

const srcStarved = A.source('road', 3.5, false, {}, optsStarved);
const srcFed = A.source('road', 3.5, false, {}, optsFed);

ok('starved opts: src.tiles.axes is empty (the bug)', srcStarved.tiles.axes === '', 'axes = ' + JSON.stringify(srcStarved.tiles.axes));
ok('starved opts: src.tiles.multilane is false (the bug)', srcStarved.tiles.multilane === false, 'multilane = ' + srcStarved.tiles.multilane);
ok('fed opts: src.tiles.axes reaches source()', srcFed.tiles.axes === axesF, 'axes mismatch');
ok('fed opts: src.tiles.multilane reaches source()', srcFed.tiles.multilane === true, 'multilane = ' + srcFed.tiles.multilane);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
