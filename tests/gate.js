#!/usr/bin/env node
// Gate runner: node tests/gate.js [--touched | --full | --list] [--jobs N] [--only a,b] [--base main]
//   --touched  run only the tests mapped to files changed against --base (default main), plus new test files; an unmapped
//              changed js/ file falls back to the full gate (so a gap in the map can never silently skip tests).
//   --full     the whole curated gate (use at merge checkpoints).
//   --only     explicit comma list of test names (page = tests/regress/<name>.js, node = tests/<name>.js).
// Node suites and "parallel" page tests run in a pool of --jobs workers (default 3); "solo" page tests (real GPU or timing
// sensitive) run alone afterwards so parallel load cannot distort them. Every test has a hard wall limit and is killed by PID.
// Prints "name exit fails seconds" per test, then a total. Exit 1 if anything failed or timed out.
// Known-failing page tests (QOL1, G20, D1, D5, F2, FO-foliage, M1-models-proto) are NOT in the gate; run them with --only.
// NE-state-leak left this list 11-09 (ardan): the order-dependent leak was the adaptive object supersampling state (V.ss), not
// the scatter cache; pinned in the test, it passes on the host GPU (tree 8dde4446fa24) and is now wired into PAGE_PAR.
// MG2-minigame-2 is fixed (neb, 11-04: the baseline is now captured after the drive layout settles) and is green, but it stays out of the gate: its full run is ~370 s and overran the wall limit twice under load, so it is still run with --only.
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), net = require('net');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2), has = (f) => args.includes(f), val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const JOBS = +val('--jobs', 3), BASE = val('--base', 'main'), WALL_MS = +val('--wall', 600000);
const PW = process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright';

// ---- the curated gate -------------------------------------------------------------------------------------------------
const NODE = ['all', 'regress-node', 'glare-all', 'scatter-table', 'scatter-table-pace', 'scatter', 'scatter-fade-gain', 'fog', 'options-registry', 'control-map', 'step5-beam-readout', 'step5-drift-dynamics', 'halo-moment-clamp', 'option-rebuild', 'cct', 'halo-levels', 'scatter-range', 'halo-width-step', 'traffic-subtick', 'frenchie-quality-governor', 'frenchie-distance-lod', 'frenchie-dry-streaks', 'frenchie-heat-shimmer', 'frenchie-signal-cones', 'frenchie-traffic-lighting', 'frenchie-wet-bounce', 'frenchie-touge-anchors', 'frenchie-halo-anchors', 'wetness', 'wet-ggx', 'foliage', 'beams', 'beam-atlas', 'traffic-beams', 'tl-traffic-taper', 'pass-parity', 'deer-tilt', 'car-tilt-lift', 'scene-digest', 'scenery-params', 'tile-options', 'options-migration', 'options-docs', 'share-presets', 'sampler-budget', 'high-dip', 'scatter-cull', 'halo-crossing-refine', 'halo-refine-neighbour', 'halo-moment', 'halo-auto-range', 'halo-near-sub', 'halo-look-projection', 'canvas-shape', 'state-dump', 'drive-sheet', 'le-chonk-scrub-veil', 'le-chonk-markers', 'le-chonk-endless', 'le-chonk-elevated', 'le-chonk-hills', 'le-chonk-presets', 'le-chonk-verge', 'le-chonk-endless-sweep', 'halo-cache-keys', 'le-chonk-multilane', 'le-chonk-render-diff', 'le-chonk-tunnel', 'le-chonk-crossing', 'le-chonk-cabin', 'le-chonk-yaw', 'le-chonk-units', 'step5-lampwin', 'cache-key-coverage', 'catch-ignore-audit', 'afs-substeps', 'ahb-fix', 'beam-store', 'cycle-phase', 'deer-bolt-anim', 'flux-cli', 'halo-edges-tail', 'high-beam', 'near-eye-bins', 'ped-kinds', 'traffic-halo', 'shader-balance-guard', 'frenchie-road-surfaces', 'le-chonk-surfaces', 'option-coverage', 'barbicane-seed', 'barbicane-ambient', 'barbicane-trafficHalo', 'barbicane-mt', 'barbicane-haloBins', 'barbicane-haloDiv', 'barbicane-haloPolarLamps', 'barbicane-haloGain', 'barbicane-scatterCullEps', 'barbicane-scatterBinCounts', 'barbicane-scatterQuality', 'barbicane-scatterNearBias', 'barbicane-lampCone', 'barbicane-lampClass', 'barbicane-lampRoad', 'barbicane-reflectiveClothing', 'barbicane-posts', 'barbicane-tex', 'barbicane-surfaceSheen', 'barbicane-wild', 'barbicane-density', 'barbicane-tiles', 'barbicane-corneringLamps', 'barbicane-smooth', 'barbicane-cabinFovFrame', 'barbicane-cabinMirror', 'barbicane-cabinDigitalRedesign', 'barbicane-trafficLogic', 'barbicane-onDist', 'barbicane-preDist', 'barbicane-onKcd', 'barbicane-cline', 'barbicane-res', 'barbicane-frameTargetMs', 'barbicane-simCeiling', 'barbicane-minFps', 'barbicane-samples', 'frenchie-crest-bounce', 'image/selftest', 'endless-feature-exclusive', 'multilane-verge', 'frenchie-halo-cone-equi', 't1-gpu-module', 'runner-selftest', 'cabin-miata', 'le-chonk-chain', 't2-drive-anim', 'le-chonk-lampcache', 'le-chonk-ui-controls', 'gate-coverage', 'car-rigid', 'drive-touge', 'node-route-parts-cap', 'world-pA-repro', 't4-optics', 'tile-junction-sig'];  // pencroff 11-10: restore nicholl's Layer C promotion (dc5fd60) dropped by bee0's stale NODE line  // frenchie 11-02: frenchie-* re-registered + 58 suites restored that the 11-01 16:28 edit dropped (Claude host results: gate NODE gutted, shadow ea3ae10)   // nemotron 11-01: cct + 4 declared tests that no gate ran (NODE, all.js, MAP and require all missed them)   // nemotron 11-01: js/cct.js's own 17 checks (tests/cct.js) were run by no gate -- distinct from cct-defaults.js   // review 11-05: endless-feature-exclusive (works->toll->vms exclusivity), endless-traffic-density (biome gate reads tile under car)
const PAGE_PAR = ['SB1-studs-everywhere', 'OV-scene-details', 'CD-controls-dedupe', 'UX2-drive-ux', 'UX1-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'PM-pass-mesh', 'PP-pass-parity', 'P2-drive-lighting', 'WG-wet-ggx', 'WT-wetness', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range',
  // FULL-COVERAGE (owner 2026-10-27): these used to run only via the --touched map, and 4 of them sat stale on main after a change in another file. Agents: --full is for merge checkpoints only; use --touched.
  'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'TOUGE-SKY-VEIL', 'TOUGE-HALO-TILT', 'TOUGE-ELEV-B', 'LCM1-lamp-cone', 'GS1-glare-sources', 'BJ1-shadow-cache', 'BJ2-halo-table-pin', 'E2-pass-lamp-cone', 'E2-crest-occlusion', 'CD-lampcone-depth', 'HB-high-dip-gpu', 'SCULL-scatter-cull', 'SP-polar-auto', 'CPSM-cone-shadow', 'SPEED0-stop', 'CC-halo-variant-compile', 'DL-drive-layout', 'BG-wetbounce-compile', 'NE-state-leak'];   // pencroff 11-03: CC compiles the halo table variant space (driver-authoritative); DL checks the drive layout places every named control   // ardan 11-09: NE-state-leak wired here after its cause was found and pinned
const PAGE_SOLO = ['P1-drive-three', 'SE-table-pacing', 'AC-air-cache-generations', 'S1-runtime-options', 'ignored-when'];   // S1 (step5-preview): the runtime option audit - every variant/cache-key option must move the picture, survive, and round-trip   // P1 needs the real GPU; SE measures per-frame ms; AC sizes its budget from the measured ms per row
const GROUPS = {
  render: ['P1-drive-three', 'P2-drive-lighting', 'PM-pass-mesh', 'PP-pass-parity', 'WT-wetness', 'WG-wet-ggx', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range', 'SB1-studs-everywhere', 'OV-scene-details'],
  ui: ['CD-controls-dedupe', 'UX2-drive-ux', 'UX1-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'CPU-FALLBACK-PAUSE', 'DL-drive-layout'],
  scatter: ['SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'AC-air-cache-generations', 'SF-silhouette-fade', 'SF1-car-silhouette', 'FG-fog', 'node:scatter', 'node:scatter-table', 'node:scatter-table-pace', 'node:scatter-fade-gain', 'node:fog'],
  beams: ['BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'P1-drive-three', 'node:beams', 'node:beam-atlas', 'node:traffic-beams'],
  wet: ['WT-wetness', 'WG-wet-ggx', 'node:wetness', 'node:wet-ggx', 'node:frenchie-road-surfaces', 'node:frenchie-wet-bounce', 'node:frenchie-dry-streaks', 'node:frenchie-crest-bounce', 'node:frenchie-halo-cone-equi'],
  nodeAll: NODE.map((n) => 'node:' + n),
};
// EVERY matching entry contributes (union) - the loop below does not stop at the first match, so a later, more specific
// entry is never shadowed by an earlier, broader one. A changed js/ file with no match at all => full gate.
const MAP = [
  [/^js\/drive-three-shaders\.js$/, ['render', 'ui', 'node:sampler-budget', 'BG-wetbounce-compile', 'node:shader-balance-guard', 'node:frenchie-road-surfaces', 'node:frenchie-crest-bounce', 'node:frenchie-halo-cone-equi']], 
  // SG1-far-car-fog wired 11-05 (harbert/nemo/spilett): the mesh-car/material-id test was DARK - in no gate lane at all (spilett find, Claims 266: not in PAGE_PAR/PAGE_SOLO/MAP, --list 188 names without it; the gate could not catch 0490 car-pixel move). This wildcard entry covers BOTH 0490 files (drive-three-objects.js + drive-three-models.js) plus the renderer itself - legitimate bonus coverage (renderer changes can move the frame; ~9 s per drive-three.js change).
  // Cause: ayrton 0490 material-id fix (host 12:09Z) moved the pin 6bb8075a -> 6c05384c (harbert runs: 99e9 on 9878c2f1a5a6 post-s2, 2ff1 on 0d206d50d4fd pre-d280, ca63 + spilett d556 on f6297432a54d post-d280, e989 on 15ca2939933c post-v10 - FIVE runs, FOUR trees, ONE hash; car px 828 -> 856).
  // EXPECTED-FAIL semantics (spilett): the [FAIL] pre-re-pin is not a defect - it is the expected failure that defines the re-pin (a re-pin whose test does not fail on the old pin means nothing to re-pin). POST-WIRING expectation (nemo): the first gate that runs SG1 should show 7/7 PASS - a red SG1 after this lands means something moved, investigate.
  // COVERAGE LIMITATION (documented by decision, harbert ~16:30): js/drive-three-shaders.js and js/drive.js changes reach SG1 only via render, which excludes SG1 - a shader-class pin move would be INVISIBLE to the gate; the hash held across le-chonk s2 road-band shader change (99e9/2ff1 agree across the s2 boundary) - evidence, not guess; revisit with evidence if a shader change ever moves the pin. /^js\/drive-models\.js$/ is the CPU-side models module - its list stays untouched by this change (deliberately NOT covered: not a 0490 file; GPU frames are built by drive-three*).
  // CAUTION: mapped filters by exists - a rename of drive-three-models.js (or drive-three-objects.js) would fall out of the wildcard and re-darken SG1 SILENTLY (S1/ignored-when lesson). GENERAL LESSON for the next reader: drive-models.js and drive-three-models.js are two names that look like a subset of each other and are NOT - the CPU-side module vs the GPU mesh-material file; that near-collision produced this very defect class (0490), so check which file you are wiring before touching this MAP.
[/^js\/drive-three(-objects|-models)?\.js$/, ['render', 'ui', 'PL3-powerlines-reflectance', 'BG-wetbounce-compile', 'HB-high-dip-gpu', 'SG1-far-car-fog']],
  [/^js\/ui\.js$/, ['ui']], [/^js\/drive-anim\.js$/, ['render', 'ui', 'nodeAll', 'PL3-powerlines-reflectance', 'GS1-glare-sources', 'SPEED0-stop', 'node:frenchie-halo-cone-equi']], [/^js\/spec-ui\.js$/, ['ui', 'scatter', 'beams', 'node:options-migration', 'PL3-powerlines-reflectance', 'DD-dropdowns', 'node:frenchie-halo-cone-equi']],
  [/^js\/drive\.js$/, ['render', 'nodeAll', 'PL3-powerlines-reflectance', 'GS1-glare-sources', 'node:frenchie-road-surfaces', 'node:frenchie-crest-bounce', 'node:frenchie-halo-cone-equi', 'node:barbicane-seed', 'node:barbicane-ambient', 'node:barbicane-trafficHalo', 'node:barbicane-mt', 'node:barbicane-haloBins', 'node:barbicane-haloDiv', 'node:barbicane-haloPolarLamps', 'node:barbicane-haloGain', 'node:barbicane-scatterCullEps', 'node:barbicane-scatterBinCounts', 'node:barbicane-scatterQuality', 'node:barbicane-scatterNearBias', 'node:barbicane-lampCone', 'node:barbicane-lampClass', 'node:barbicane-lampRoad', 'node:barbicane-reflectiveClothing', 'node:barbicane-posts', 'node:barbicane-tex', 'node:barbicane-surfaceSheen', 'node:barbicane-wild', 'node:barbicane-density', 'node:barbicane-tiles', 'node:barbicane-corneringLamps', 'node:barbicane-smooth', 'node:barbicane-cabinFovFrame', 'node:barbicane-cabinMirror', 'node:barbicane-cabinDigitalRedesign', 'node:barbicane-trafficLogic', 'node:barbicane-onDist', 'node:barbicane-preDist', 'node:barbicane-onKcd', 'node:barbicane-cline', 'node:barbicane-res', 'node:barbicane-frameTargetMs', 'node:barbicane-simCeiling', 'node:barbicane-minFps', 'node:barbicane-samples']], [/^js\/table-pace\.js$/, ['scatter']], [/^js\/beam-atlas\.js$/, ['beams']],
  [/^js\/(cct|source-presets)\.js$/, ['nodeAll', 'beams']], [/^js\/drive-three-.*\.js$/, ['render']], [/^js\/drive-touge-three\.js$/, ['TOUGE-ELEV-B', 'TOUGE-SKY-VEIL', 'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'BJ1-shadow-cache', 'E2-crest-occlusion', 'node:sampler-budget']], [/^js\/drive-three-(beamcone|shadowmaps|objects)\.js$/, ['CPSM-cone-shadow', 'node:sampler-budget']], [/^js\/drive-three-halo(-cull)?\.js$/, ['CPSM-cone-shadow', 'TOUGE-HALO-TILT', 'BJ2-halo-table-pin', 'E2-crest-occlusion', 'SCULL-scatter-cull', 'SP-polar-auto', 'HB-high-dip-gpu', 'node:scatter-cull', 'node:halo-crossing-refine', 'node:halo-refine-neighbour', 'node:halo-moment', 'node:halo-auto-range', 'node:halo-near-sub', 'node:sampler-budget', 'CC-halo-variant-compile', 'node:frenchie-halo-cone-equi']],   // SC: the culling bound (drive-three-halo-cull.js) and its tests; CC: the variant-space compile check (pencroff 11-03)
  [/^js\/drive-scenes\.js$/, ['render', 'ui', 'nodeAll', 'PL1-powerlines']],
  [/^js\/drive-touge\.js$/, ['PL2-powerlines-pass', 'node:glare-all', 'E2-pass-lamp-cone', 'HB-high-dip-gpu']],   // REFLECTIVE-CLOTHING: pedestrians are built here; the RC test is a new regress file, picked up automatically
  [/^js\/drive-three-lamphalo\.js$/, ['LCM1-lamp-cone']],   // deleted in Brief U (kept so the deletion is not an unmapped change: the cone took its exports)
  [/^js\/drive-three\.js$/, ['LCM1-lamp-cone', 'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'AC-air-cache-generations', 'E2-crest-occlusion', 'node:frenchie-crest-bounce', 'node:frenchie-halo-cone-equi']],
  [/^js\/drive-three-lampcone\.js$/, ['LCM1-lamp-cone', 'E2-pass-lamp-cone', 'CD-lampcone-depth']], [/^tests\/regress\/LCM1-lamp-cone\.js$/, ['LCM1-lamp-cone']],
  [/^js\/drive-models\.js$/, ['node:deer-tilt', 'node:pass-parity', 'node:scene-digest', 'PM-pass-mesh', 'PP-pass-parity']], [/^tests\/deer-tilt\.js$/, ['node:deer-tilt']],   // DEER-TILT (Brief T)
  [/^tests\/regress\/GS1-glare-sources\.js$/, ['GS1-glare-sources']],
  [/^js\/lamp-dist\.js$/, ['LCM1-lamp-cone', 'LDR1-lamp-road', 'GS1-glare-sources', 'node:glare-all']], [/^tests\/regress\/LDR1-lamp-road\.js$/, ['LDR1-lamp-road']],
  [/^js\/options-registry\.js$/, ['ui', 'nodeAll', 'node:drive-controls2', 'node:scenario-node', 'DD-dropdowns', 'option-coverage', 'S1-runtime-options', 'ignored-when']],   // OPTION-REGISTRY: the defaults of every option; tests/options-registry.js and options-migration.js are in NODE
  [/^js\/share-presets\.js$/, ['ui', 'node:share-presets']],   // SHARE-PRESET: #preset=<name> links; tests/share-presets.js
  [/^tests\/drive-three-page\.js$/, ['P1-drive-three', 'FG-fog', 'SC-beam-scatter']], [/^tests\/regress\/CC-halo-variant-compile\.js$/, ['CC-halo-variant-compile']], [/^tests\/regress\/BG-wetbounce-compile\.js$/, ['BG-wetbounce-compile']], [/^tests\/regress\/DL-drive-layout\.js$/, ['DL-drive-layout']],
  [/^index\.html$/, ['ui']], [/^js\/drive-layout\.js$/, ['ui', 'render', 'nodeAll', 'DL-drive-layout']],   // UI step C: the drive layout shell moves every drive control and sizes the canvas; DL: the layout placement check (pencroff 11-03)
  [/^tests\/load\.js$/, ['nodeAll']], [/^tests\/gate\.js$/, ['nodeAll']],   // a change to the gate itself runs the node suite (it used to select ZERO tests)
  [/^js\/compare-ui\.js$/, ['RESET-DRIVE-SETTINGS', 'AB-compare', 'B4b-layout']], [/^css\/app\.css$/, ['ui', 'RESET-DRIVE-SETTINGS', 'G13-pane-rows-fit', 'B4b-layout']],   // RESET-DRIVE-SETTINGS: the reset button lives in the A/B solve-cache bar; its CSS is the spec-mode gate
  [/^js\/(solver|solvers|solve-worker|mode[AB]|feasibility|engine|beam-quality|beam-store|ideal-beam|sealed-beam-source|farfield|photometry|starter-lamps)\S*\.js$/, ['render', 'ui', 'nodeAll']],   // frenchie (open pool 5): solver/spec core was unmapped (full-gate fallback)
  [/^js\/(modes|panels|ui|controller|history|input|profile|checks[123]|core|geometry|lenses|eurobeat|render-gl|render2d|manufacturability.*|.*-worker|gpu-trace)\S*\.js$/, ['ui', 'nodeAll']],   // frenchie (open pool 5): app shell + workers were unmapped
  [/^js\/drive-game\.js$/, ['ui', 'nodeAll', 'node:minigame', 'node:minigame-2', 'node:game-curves']],   // frenchie (open pool 5): game mode was unmapped
  [/^js\/drive-three-(beamcone|shadowmaps|models-glsl)\.js$/, ['render', 'ui', 'nodeAll']],   // frenchie (open pool 5): the remaining drive-three modules
  [/^js\/(beams|compare|drive-models-glsl|exports|layout|render|road|scene-details|solve-cache|source|spec|state)\.js$/, ['ui', 'nodeAll', 'render']],   // frenchie (open pool 5): core data/spec/road modules were unmapped
  [/^js\/cabin-miata\.js$/, ['node:cabin-miata', 'node:le-chonk-cabin']], [/^img\/cabin\//, ['node:cabin-miata']],   // le-chonk 11-09: cabin module + assets
  [/^tests\/image\//, ['node:image/selftest', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'WT-wetness']],   // B1: the image-comparison library (compare/flip/png) was unmapped, so editing it ran no test; its node self-test plus the four page tests that call it
  [/^tests\/runner\/protected-suites\.txt$/, ['node:gate-coverage']],   // neb 11-09: a change to the protected list must run the tripwire that reads it; without this row the file maps to nothing, --touched resolves an EMPTY plan and the lander refuses the patch ('gate.js selected no tests' - my refused gid 1fe1)
  [/^tests\/runner\//, ['node:runner-selftest']],   // neb 11-09: the gate's own selector + helpers (select/tags/node-suites/fail-lines/print) are unmapped; a change to them must run the selector's self-test
  [/^js\/cache-keys\.js$/, ['node:cache-key-coverage', 'node:halo-cache-keys', 'nodeAll']],   // B3: the cache recipe module; cache-key-coverage + halo-cache-keys cover it directly
  [/^js\/endless-axis-config\.js$/, ['node:endless-axis-config', 'node:catch-ignore-audit']],   // endless-road-v2: pure node data logic; catch-ignore-audit rides along per spilett's rule (audit suites must not be narrowed away)
  [/^js\/endless-relief\.js$/, ['node:endless-relief', 'node:catch-ignore-audit']],   // endless-road-v2: the relief axis (pencroff); consumes endless-axis-config, pure node data logic
  [/^js\/endless-settlement-road\.js$/, ['node:endless-settlement-road', 'node:catch-ignore-audit']],   // endless-road-v2: the settlement+road-class value-to-knob map (nemo); consumes endless-axis-config, pure node data logic
  [/^(docs|\.claude)\//, []], [/\.md$/, []], [/^tests\/scenario\//, ['node:scenario-node']],
  [/^tests\/regress\/NE-state-leak\.js$/, ['NE-state-leak']],   // ardan 11-09: map the test file to itself - without this row --touched resolves an EMPTY plan for a change to it and the lander refuses the patch ('gate.js selected no tests'); now that it passes it is wired (PAGE_PAR) and out of KNOWN_FAILING
];
const NOT_TESTS = ['gate', 'load', 'serve', 'drive-three-page', 'pinned-defaults'];   // drive-three-page.js is the browser-side helper of P1/FG/SC (Brief U: it gained the lampCone argument), not a Node test; it is in MAP
// NE5: open, reproducible-in-order checks we have not explained. Run by hand with --only; never in the gate.
// ardan 11-09: empty. NE-state-leak was the last entry - explained (adaptive object supersampling, V.ss) and fixed by pinning
// V.pinSS in the test, verified PASS on the host GPU (tree 8dde4446fa24); it is now in PAGE_PAR.
const KNOWN_FAILING = [];
let DARK_PAGES = [];   // DARK PAGE TESTS (spilett, 11-05): page tests on disk that NO gate set selects — the blind spot whose count is now reported (see plan())
// ---- plan -------------------------------------------------------------------------------------------------------------
const sh = (...a) => { try { return execFileSync(a[0], a.slice(1), { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };
function plan() {
  if (val('--only')) return val('--only').split(',').map((n) => n.startsWith('node:') ? n : (fs.existsSync(path.join(root, 'tests', n + '.js')) && !fs.existsSync(path.join(root, 'tests/regress', n + '.js')) ? 'node:' + n : n));
  const exists = (x) => x.startsWith('node:') ? fs.existsSync(path.join(root, 'tests', x.slice(5) + '.js')) : fs.existsSync(path.join(root, 'tests/regress', x + '.js'));
  const curated = [...NODE.map((n) => 'node:' + n), ...PAGE_PAR, ...PAGE_SOLO].filter(exists);   // a queued delete must not redden the staged gate: run only the curated names whose file is there
  // FULL-COVERAGE 2 (10-29): --full also runs every test the MAP names, so a test reachable only via --touched cannot be skipped at a merge (4 were: CPU-FALLBACK-PAUSE, PL3, drive-controls2, scenario-node).
  const mapped = [...new Set(MAP.flatMap(([, gs]) => gs.flatMap((g) => GROUPS[g] || [g])))].filter((x) => !curated.includes(x) && !KNOWN_FAILING.includes(x) && exists(x));
  const full = curated.concat(mapped);
  let rp = []; try { rp = fs.readdirSync(path.join(root, 'tests/regress')); } catch (e) { /* no regress dir: nothing can be dark */ }
  DARK_PAGES = rp.filter((f) => /\.js$/.test(f)).map((f) => f.slice(0, -3)).filter((n) => !NOT_TESTS.includes(n) && !full.includes(n)).sort();   // counted, not silent: on disk, in no curated list and no MAP entry (the SG1 class)
  if (!has('--touched')) return full;
  const files = new Set([...sh('git', 'diff', '--name-only', BASE + '...HEAD').split('\n'), ...sh('git', 'diff', '--name-only', 'HEAD').split('\n'), ...sh('git', 'ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  const picked = new Set(); let unmapped = [], deleted = [];
  for (const f of files) {
    const t = /^tests\/regress\/(.+)\.js$/.exec(f), n = /^tests\/([^/]+)\.js$/.exec(f);
    if ((t || n) && !fs.existsSync(path.join(root, f))) { deleted.push(f); continue; }   // a DELETED test file: nothing of it can run, so the full gate runs instead (the queue reads an empty plan as "the gate could not run" and refuses the request)
    if (t) { if (!KNOWN_FAILING.includes(t[1])) picked.add(t[1]); continue; }   // known-failing tests never run by --touched either (new regress files are picked up automatically)
    if (n && !NOT_TESTS.includes(n[1])) { picked.add('node:' + n[1]); continue; }   // a changed Node test runs itself; gate.js, load.js and serve.js are not tests (picking gate.js ran a nested full gate), load.js is in MAP
    let hit = false; for (const [re, gs] of MAP) if (re.test(f)) { hit = true; for (const g of gs) (GROUPS[g] || [g]).forEach((x) => picked.add(x)); }
    if (!hit && /^(js|css|index\.html)/.test(f)) unmapped.push(f);
  }
  if (unmapped.length) { console.log('unmapped changed files, running the full gate: ' + unmapped.join(', ')); return full; }
  if (deleted.length) { console.log('deleted test files, running the full gate: ' + deleted.join(', ')); return full; }
  return full.filter((x) => picked.has(x)).concat([...picked].filter((x) => !full.includes(x) && (x.startsWith('node:') ? fs.existsSync(path.join(root, 'tests', x.slice(5) + '.js')) : fs.existsSync(path.join(root, 'tests/regress', x + '.js')))));
}
// ---- run --------------------------------------------------------------------------------------------------------------
function freePort() { return new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function runOne(name, port) {
  const node = name.startsWith('node:'), file = node ? path.join('tests', name.slice(5) + '.js') : path.join('tests/regress', name + '.js');
  const env = Object.assign({}, process.env, { PLAYWRIGHT: PW, PATH: '/opt/homebrew/bin:' + process.env.PATH }); if (name === 'P1-drive-three') env.P1_REAL_GPU = '1';
  const t0 = Date.now(); let out = '';
  return new Promise((resolve) => {
    const c = spawn(process.execPath, node ? [file] : [file, String(port)], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false; const to = setTimeout(() => { timedOut = true; try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, WALL_MS);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => { clearTimeout(to); try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ }   // reap leftover browsers of this test's process group
      const fails = (out.match(/^\s*\[?(FAIL|✗|not ok)/gm) || []).length; const s = ((Date.now() - t0) / 1000).toFixed(0);
      try { fs.mkdirSync(path.join(root, 'tests/gate-logs'), { recursive: true }); fs.writeFileSync(path.join(root, 'tests/gate-logs', name.replace(':', '-') + '.log'), out); } catch (e) { /* ignore */ }
      resolve({ name, code: timedOut ? 'TIMEOUT' : code, fails, s }); });
  });
}
async function pool(items, n, fn) { const res = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; const r = await fn(it); res.push(r); console.log(`${r.name} exit ${r.code} fails ${r.fails} ${r.s}s`); } })); return res; }
(async () => {
  const tests = plan();
  // neb 11-10 (item 2): --list prints the UNION of the plan. A test that is also named in a MAP
  // row stays in that union even if it has dropped out of node:all - so "is it in the plan?" is
  // not the same question as "will node:all run it?". node:all is the NODE array alone
  // (nodeAll: NODE.map(n => 'node:' + n)), so this mode prints exactly that set. It prints one
  // name per line and nothing else, so a caller can parse it as a set.
  if (has('--list-node-all')) { console.log(GROUPS.nodeAll.join('\n')); return; }
  if (DARK_PAGES.length) console.log('dark page tests, on disk but in NO gate set (not curated and not in the MAP) — ' + DARK_PAGES.length + ': ' + DARK_PAGES.join(', '));   // loud, not silent (rule 15): a test nobody selects is indistinguishable from a passing one; the spaces and brackets keep this line out of mergeq's name regex
  if (has('--list')) { console.log(tests.join('\n')); return; }
  const solo = tests.filter((t) => PAGE_SOLO.includes(t)), par = tests.filter((t) => !PAGE_SOLO.includes(t));
  const needsPage = tests.some((t) => !t.startsWith('node:')); let server = null, port = 0;
  if (needsPage) { port = await freePort(); server = spawn('python3', ['tests/serve.py', String(port)], { cwd: root, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1500)); }
  const t0 = Date.now(); let res = [];
  try {
    res = res.concat(await pool(par, JOBS, (t) => runOne(t, port)));
    // A page test that fails in the parallel pool is re-run alone once: some checks are load-sensitive (SD's frame-hash pin passed alone twice and
    // failed under 3-way load). A pass on the solo re-run counts as clean but is reported as LOAD-SENSITIVE so it is not forgotten.
    for (const r of res.slice()) if ((r.code !== 0 || r.fails > 0) && !r.name.startsWith('node:')) { const again = await runOne(r.name, port); console.log(`${r.name} solo re-run exit ${again.code} fails ${again.fails} ${again.s}s`); if (again.code === 0 && again.fails === 0) { r.code = 0; r.fails = 0; r.flaky = true; } }
    res = res.concat(await pool(solo, 1, (t) => runOne(t, port)));
  }
  finally { if (server) { try { process.kill(server.pid); } catch (e) { /* gone */ } } }
  const bad = res.filter((r) => r.code !== 0 || r.fails > 0);
  const flaky = res.filter((r) => r.flaky); if (flaky.length) console.log('LOAD-SENSITIVE (failed in the pool, passed alone): ' + flaky.map((r) => r.name).join(' '));
  console.log(`\n${res.length} tests, ${bad.length} not clean, ${((Date.now() - t0) / 1000).toFixed(0)}s` + (bad.length ? '\nNOT CLEAN: ' + bad.map((r) => `${r.name}(${r.code}/${r.fails})`).join(' ') : ''));
  process.exit(bad.length ? 1 : 0);
})();
