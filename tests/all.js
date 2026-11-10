// Run every gate: node tests/all.js — exits 1 if any fails.
// 1. syntax of every browser script (the headless suite never loads ui.js / panels.js / render*.js)
// 2. the 24-check suite  3. undo/redo  4. evaluation metrics  5. layout  6. per-hit facet attribution
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); let failed = 0;
// Each test gets HANG_MS. Node 25.8 sometimes never finishes exiting (stuck in process.exit → platform shutdown →
// pthread_join, seen on facet2.js after its checks had passed), and an unbounded wait stalled the whole suite. A hang is
// killed and retried once; it is always reported, and two in a row count as a failure.
const HANG_MS = 240000;
const hung = (e) => e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL');
const run = (label, args) => {
  const once = () => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: HANG_MS, killSignal: 'SIGKILL' });
  let note = '';
  try {
    let out;
    try { out = once(); }
    catch (e) { if (!hung(e)) throw e; note = '  (hung once: killed after ' + HANG_MS / 1000 + ' s, passed on retry)'; out = once(); }
    console.log('✓ ' + label + (out.trim() ? '  — ' + out.trim().split('\n').pop() : '') + note);
  } catch (e) {
    failed++;
    console.log('✗ ' + label + (hung(e) ? '  — HUNG twice (no exit within ' + HANG_MS / 1000 + ' s), killed' : '') + '\n' + String(e.stdout || '') + String(e.stderr || ''));
  }
};
for (const d of ['js', 'tests']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) run('syntax ' + d + '/' + f, ['--check', path.join(d, f)]);
// minimaxai (10-31, reviewed glm5.2 11-01, qwen3.8max P2 11-01): the sweep above parses each .js under the COMMONJS goal, but for a .js
// whose import/export appears before the error, `node --check` reports success whatever is below it — so the sweep never effectively
// parsed the 13 ES-module files in js/ (the entire GPU renderer). That happened for real: a stray ')' in js/drive-touge-three.js (the BA5
// traffic-pitch rewrite) passed this sweep and broke the GPU renderer's dynamic import, so every model's drive view silently fell back to
// the CPU renderer. Parse the js/ files as modules too: a .mjs copy under the same goal the browser uses. Test-only; no app file changes.
{
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'flux-esm-syntax-'));
  try {
    for (const f of fs.readdirSync(path.join(root, 'js'))) if (f.endsWith('.js')) {
      const copy = path.join(tmp, f.replace(/\.js$/, '') + '.mjs');
      fs.copyFileSync(path.join(root, 'js', f), copy);
      run('syntax (module) js/' + f, ['--check', copy]);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
run('checks (tests/headless.js)', ['tests/headless.js']);
run('undo/redo (tests/history.js)', ['tests/history.js']);
run('metrics (tests/metrics.js)', ['tests/metrics.js']);
run('layout (tests/layout.js)', ['tests/layout.js']);
run('attribution (tests/attribution.js)', ['tests/attribution.js']);
run('photometry (tests/photometry.js)', ['tests/photometry.js']);
run('CCT checks (tests/cct.js)', ['tests/cct.js']);   // nemotron 11-01: was run by no gate (name-confused with cct-defaults.js, a different file)
run('CCT defaults per preset (tests/cct-defaults.js)', ['tests/cct-defaults.js']);
run('duv: manual green/magenta tint, byte-identical at 0 (tests/duv.js)', ['tests/duv.js']);
run('auto-high (tests/auto-high.js)', ['tests/auto-high.js']);
run('eye adaptation: smoothing step response (tests/eye-adapt.js)', ['tests/eye-adapt.js']);
run('drive controls: view angle, traffic range, fixed eye (tests/drive-controls2.js)', ['tests/drive-controls2.js']);
run('two-curvature facet (tests/facet2.js)', ['tests/facet2.js']);
run('solvers (tests/solvers.js)', ['tests/solvers.js']);
run('modes + auto (tests/modes.js)', ['tests/modes.js']);
run('spec mode + far field (tests/spec.js)', ['tests/spec.js']);
run('multi-part optics + multi-emitter (tests/optics-parts.js)', ['tests/optics-parts.js']);
run('watching a solve: worker previews (tests/preview.js)', ['tests/preview.js']);
run('road model + IIHS metrics (tests/road.js)', ['tests/road.js']);
run('beam quality report (tests/beam-quality.js)', ['tests/beam-quality.js']);
run('le-chonk scrubber + wet veil options (tests/le-chonk-scrub-veil.js)', ['tests/le-chonk-scrub-veil.js']);
run('le-chonk side marker lamps option (tests/le-chonk-markers.js)', ['tests/le-chonk-markers.js']);
run('le-chonk endless biome road prototype (tests/le-chonk-endless.js)', ['tests/le-chonk-endless.js']);
run('le-chonk elevatedView 3D-route prototype (tests/le-chonk-elevated.js)', ['tests/le-chonk-elevated.js']);
run('le-chonk endless biome elevation (tests/le-chonk-hills.js)', ['tests/le-chonk-hills.js']);
run('le-chonk endless road presets (tests/le-chonk-presets.js)', ['tests/le-chonk-presets.js']);
run('le-chonk endless tile verge + consent toggles (tests/le-chonk-verge.js)', ['tests/le-chonk-verge.js']);
run('le-chonk endless generator sweep, 120 seeds (tests/le-chonk-endless-sweep.js)', ['tests/le-chonk-endless-sweep.js']);
run('halo-family cache-key detector (tests/halo-cache-keys.js)', ['tests/halo-cache-keys.js']);
run('cache-key coverage detector: every picture-affecting option is in at least one cache key (tests/cache-key-coverage.js)', ['tests/cache-key-coverage.js']);
run('catch-and-ignore block audit: every SILENT catch is exempted (tests/catch-ignore-audit.js)', ['tests/catch-ignore-audit.js']);
run('option-plumbing completeness: registry, UI control, look projection, node test, gate registration (tests/option-plumbing.js)', ['tests/option-plumbing.js']);
// glm5.2 (qwen3.8max orphan-tests recommendation): 11 green sub-second node suites that nothing ran
run('AFS substeps (tests/afs-substeps.js)', ['tests/afs-substeps.js']);
run('AHB fix (tests/ahb-fix.js)', ['tests/ahb-fix.js']);
run('beam store (tests/beam-store.js)', ['tests/beam-store.js']);
run('cycle phase (tests/cycle-phase.js)', ['tests/cycle-phase.js']);
run('deer bolt animation (tests/deer-bolt-anim.js)', ['tests/deer-bolt-anim.js']);
run('flux CLI (tests/flux-cli.js)', ['tests/flux-cli.js']);
run('halo edges tail (tests/halo-edges-tail.js)', ['tests/halo-edges-tail.js']);
run('high beam (tests/high-beam.js)', ['tests/high-beam.js']);
run('near eye bins (tests/near-eye-bins.js)', ['tests/near-eye-bins.js']);
run('ped kinds (tests/ped-kinds.js)', ['tests/ped-kinds.js']);
run('traffic halo (tests/traffic-halo.js)', ['tests/traffic-halo.js']);
// nemotron 11-01: 4 declared node: tests run by NOTHING -- not NODE, not all.js, not the gate MAP, not any require (found while settling why option-plumbing is red)
run('halo levels (tests/halo-levels.js)', ['tests/halo-levels.js']);
run('scatter range (tests/scatter-range.js)', ['tests/scatter-range.js']);
run('halo width step (tests/halo-width-step.js)', ['tests/halo-width-step.js']);
run('traffic sub-tick (tests/traffic-subtick.js)', ['tests/traffic-subtick.js']);
run('le-chonk multilane highway phase 0 (tests/le-chonk-multilane.js)', ['tests/le-chonk-multilane.js']);
run('le-chonk render-level ON-vs-OFF diff (tests/le-chonk-render-diff.js)', ['tests/le-chonk-render-diff.js']);
run('le-chonk endless tunnel tiles (tests/le-chonk-tunnel.js)', ['tests/le-chonk-tunnel.js']);
run('le-chonk endless level crossings (tests/le-chonk-crossing.js)', ['tests/le-chonk-crossing.js']);
run('le-chonk cabin view + drift mode (tests/le-chonk-cabin.js)', ['tests/le-chonk-cabin.js']);
run('le-chonk yaw smoothing (tests/le-chonk-yaw.js)', ['tests/le-chonk-yaw.js']);
run('le-chonk imperial units (tests/le-chonk-units.js)', ['tests/le-chonk-units.js']);
run('le-chonk road surfaces option (tests/le-chonk-surfaces.js)', ['tests/le-chonk-surfaces.js']);
run('ideal-beam goals (tests/ideal-beam.js)', ['tests/ideal-beam.js']);
run('haloLampWin: off is the old schedule, on anchors a lamp window (tests/step5-lampwin.js)', ['tests/step5-lampwin.js']); // step5-preview (LW)
run('every option with a control has one on the page, and every control on the page is an option (tests/control-map.js)', ['tests/control-map.js']); // step5-preview (the shared id -> selector map)
run('ignoredWhen rules are honoured where they say they are: the controlled option does not move the render while the rule holds, and does when it does not (tests/ignored-when.js)', ['tests/regress/ignored-when.js']); // step5-preview (the behavioural ignoredWhen check)
run('haloMoment: each bin mean is clamped into its own bin, so a nearly-empty bin cannot throw an interior knot (tests/halo-moment-clamp.js)', ['tests/halo-moment-clamp.js']); // step5-preview (P3 mean clamp)
run('option rebuild: a cost that says scene-regenerate is carried by a rebuild key, and no option is dead (tests/option-rebuild.js)', ['tests/option-rebuild.js']); // step5-preview (open sweep)
run('the drive bar beam label is a live readout of the beam in use (tests/step5-beam-readout.js)', ['tests/step5-beam-readout.js']);
run('driftDynamics: the opposite-lock angle lags with the tyre relaxation and is capped at 8 degrees, and OFF is the raw angle (tests/step5-drift-dynamics.js)', ['tests/step5-drift-dynamics.js']); // step5-preview (wishlist §6)
run('every halo option is projected into the renderer (tests/halo-look-projection.js)', ['tests/halo-look-projection.js']); // nemotron (inert-option guard)
run('driver\'s-eye view (tests/drive.js)', ['tests/drive.js']);
run('detailed models prototype (tests/models-proto.js)', ['tests/models-proto.js']);
run('leafy foliage prototype (tests/foliage.js)', ['tests/foliage.js']);
run('detailed models final geometry (tests/models-m2.js)', ['tests/models-m2.js']);
run('optional GPU Drive wiring + vendor pins (tests/drive-three.js)', ['tests/drive-three.js']);
run('P2 Drive lighting extras (tests/p2-drive-lighting.js)', ['tests/p2-drive-lighting.js']);
run('TL1/TL2 traffic road light taper and options (tests/tl-traffic-taper.js)', ['tests/tl-traffic-taper.js']);
run('eurobeat pattern data (tests/eurobeat.js)', ['tests/eurobeat.js']);
run('Mountain pass speeds and adaptive lighting (tests/touge-r2.js)', ['tests/touge-r2.js']);
run('Mountain pass parity: lamps, deer bolt, detail, edge lines (tests/pass-parity.js)', ['tests/pass-parity.js']);
run('wet road sheen: GGX BRDF + legacy frames unchanged (tests/wet-ggx.js)', ['tests/wet-ggx.js']);
run('road wetness 0..1: dry and wet frames unchanged, damp in between (tests/wetness.js)', ['tests/wetness.js']);
run('fog: off frames unchanged, Koschmieder attenuation, monotone, presets (tests/fog.js)', ['tests/fog.js']);
run('visible beam in fog: in-scatter off = pinned frames, cone, density peak, convergence, determinism (tests/scatter.js)', ['tests/scatter.js']);
run('SD air-beam scatter table: CPU twin within 10 percent of direct at 15-30 m, finite, monotone, zero without fog (tests/scatter-table.js)', ['tests/scatter-table.js']);
run('SE table pacing helpers and near-eye fade on the CPU twin (tests/scatter-table-pace.js)', ['tests/scatter-table-pace.js']);
run('SF2 near-fade range and scatter gain, CPU twin and helpers (tests/scatter-fade-gain.js)', ['tests/scatter-fade-gain.js']);
run('scene snapshot: studs, posts, signs, lamps, deer, people, trees, markings per scene (tests/scene-snapshot.js)', ['tests/scene-snapshot.js']);
run('scene digest: where every scenery object sits, 2 seeds, tiles on and off (tests/scene-digest.js)', ['tests/scene-digest.js']);
run('scenery parameters: the forest and city generator equals the old builders (240 cases), rates keep the other classes in place, backdrop, options (tests/scenery-params.js)', ['tests/scenery-params.js']);
run('tile options: roadTile weights (byte-identical with none or all 1, side and phase fixed), lamp rule off / urban-only / sparse / all (tests/tile-options.js)', ['tests/tile-options.js']);
run('SB2 wet sheen from studs and paint: source admission, caps, paint gloss, GPU ids (tests/sb2-sheen.js)', ['tests/sb2-sheen.js']);
run('saveable beams: format, checksum, grid, bundle, synthetic (tests/beams.js)', ['tests/beams.js']);
run('BA5 GPU beam atlas: packing, shader text, pick equality (tests/beam-atlas.js)', ['tests/beam-atlas.js']);
run('scene details: registry and metric maths (tests/scene-details.js)', ['tests/scene-details.js']);
run('option round-trip: every profile option survives dump -> read, extras survive, loadState writes back (tests/option-roundtrip.js)', ['tests/option-roundtrip.js']); // glm5.2 (step5-preview open item #1)
run('quality governor option: shed state machine + wiring, default off (tests/frenchie-quality-governor.js)', ['tests/frenchie-quality-governor.js']); // frenchie (backlog 3-P)
run('distance LOD option: profile caps + wiring, default off (tests/frenchie-distance-lod.js)', ['tests/frenchie-distance-lod.js']); // frenchie (backlog 3 LOD)
run('dry-pavement streaks option: gates + weights, default off (tests/frenchie-dry-streaks.js)', ['tests/frenchie-dry-streaks.js']); // frenchie (Anya 10-31 dryStreaks)
run('heat shimmer option (GPU only): splice + wiring, default off (tests/frenchie-heat-shimmer.js)', ['tests/frenchie-heat-shimmer.js']); // frenchie (backlog heat shimmer, ACTIVE per Anya)
run('signal cones option: visor geometry when on, OFF byte-identical, no glare double-count (tests/frenchie-signal-cones.js)', ['tests/frenchie-signal-cones.js']); // frenchie (backlog 5 signal cones)
run('traffic-lighting presets: registry, valid preset maps, OFF writes nothing (tests/frenchie-traffic-lighting.js)', ['tests/frenchie-traffic-lighting.js']); // frenchie (backlog 5 presets)
run('wet-road bounce (4-O): OFF byte-identical, ON marches mirrored own lamps, keys carry it (tests/frenchie-wet-bounce.js)', ['tests/frenchie-wet-bounce.js']); // frenchie
run('halo shader anchors guarded via hrep, composed variants pinned (tests/frenchie-halo-anchors.js)', ['tests/frenchie-halo-anchors.js']); // frenchie
run('road surfaces physics option: k(s)/floor laws, OFF byte-identical, wiring, keys (tests/frenchie-road-surfaces.js)', ['tests/frenchie-road-surfaces.js']); // frenchie (Anya item 4, ROAD-SURFACES §7 resolved)
run('touge shader anchors guarded (rep throws on moved anchor; no bare .replace outside helper) — tests/frenchie-touge-anchors.js', ['tests/frenchie-touge-anchors.js']); // frenchie (pool 4)
run('image tolerance self-test: FLIP, PNG, compare, known-bad control (tests/image/selftest.js)', ['tests/image/selftest.js']); // B1
run('T1 GPU-module logic: MAT_KEYS, uniform bounds, hrep, variant state machine, haloTableSize, haloState (tests/t1-gpu-module.js)', ['tests/t1-gpu-module.js']); // T1
run('cabin miata photo cabin (tests/cabin-miata.js)', ['tests/cabin-miata.js']);   // le-chonk 11-09 // B1
run('T2 drive-anim: IDM invariants, idmStep, traffic/curve/AFS/sim constants, seeded long runs, LOD, export surface (tests/t2-drive-anim.js)', ['tests/t2-drive-anim.js']); // T2
run('T4 optics/solver invariants: beams, ideal-beam, sealed-beam, solve-cache, solver, geometry, state (tests/t4-optics.js)', ['tests/t4-optics.js']); // T4
console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
