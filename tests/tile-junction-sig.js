// nicholl 11-10 (arc flagged by spilett 06:56Z, ruled in by pencroff, landed as js/drive-anim.js fix):
// the traffic-state copy predicate guards on seed/density/tiles-bool/trafficLogic ONLY, so a same-seed
// toggle of the junction-bringing fields — endlessPreset / endlessPresetCustom / tileTerrain / multilaneRoad
// / endlessTunnel / endlessCrossing / junctionGantries / endlessAxes — kept cars their memoed routes for
// junction tiles that no longer exist in the re-sourced src. The fix gives src a _tileSig (set in
// trafficSource) and the predicate now compares it. This node test covers the _tileSig plumbing through
// RF.DriveAnim.source(); the full src-rebuild path (an options toggle mid-drive) can't run headlessly.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;
const FLAGS = { wild: true, signs: true };
const base = { seed: 7, tiles: true, endlessRoad: true };
const src = (over) => A.source('road', 3.5, false, FLAGS, Object.assign({}, base, over || {}));

ok('src._tileSig exists when tiles are on, and is a string', (() => { const s = src(); return typeof s._tileSig === 'string' && s._tileSig.length > 0; })());
ok('src._tileSig is empty when tiles are off', (() => { const s = A.source('road', 3.5, false, FLAGS, { seed: 7 }); return s._tileSig === ''; })());
ok("src._tileSig reflects the tile-bringing fields (preset/custom/terrain/axes/tunnel/crossing/gantry/multilane)", (() => {
  const s0 = src();
  const a = s0._tileSig.split('|');
  if (a.length !== 8) return false;
  const sig = (over) => src(over)._tileSig;
  return sig({ endlessPreset: 'off' }) === s0._tileSig
    && sig({ endlessPreset: 'city-loop' }) !== s0._tileSig
    && sig({ endlessPreset: 'custom', endlessPresetCustom: '{"biome":"city"}' }) !== s0._tileSig
    && sig({ tileTerrain: true }) !== s0._tileSig
    && sig({ multilaneRoad: true }) !== s0._tileSig
    && sig({ endlessTunnel: true }) !== s0._tileSig
    && sig({ endlessCrossing: true }) !== s0._tileSig
    && sig({ junctionGantries: true }) !== s0._tileSig
    && sig({ endlessAxes: '{"kind":"flat"}' }) !== s0._tileSig
    && sig({ endlessAxes: s0.axes || '' }) === s0._tileSig;
})());
ok('src._tileSig is equal for repeated identical settings (function is deterministic)', src() === undefined || src()._tileSig === src()._tileSig);
ok('src._tileSig differs between two different custom bodies at the same seed', src({ endlessPreset: 'custom', endlessPresetCustom: '{"biome":"city"}' })._tileSig !== src({ endlessPreset: 'custom', endlessPresetCustom: '{"biome":"open"}' })._tileSig);
// wiring guard: the copy predicate carries the _tileSig compare (the rebuild path can't run headlessly —
// asserted at the source, anchored, and flagged as such; spilett's pre-fix proof documents the extracted block)
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok("wiring: the copy predicate compares src._tileSig [wiring text, flagged — see header]", anim.includes('old._tileSig === V.src._tileSig) V.src.traffic.state = old.traffic.state'));
console.log(fail === 0 ? `\nall ${pass} junction-state-copy checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
