# COVERAGE: option / feature x test matrix, untested options, pedestrian-dependent pins

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). No test was run (the brief forbids browser tests; only `node tests/gate.js --full --list` and `--list` were run, which print names and run nothing).
OBSERVED = counted by command (commands in the Method section). INFERRED = deduced.

## 1. What the tests are (counts by command)

| thing | count | how |
|---|---|---|
| page tests in tests/regress/ | 143 | `ls tests/regress \| wc -l` |
| node tests in tests/*.js (minus gate, load, serve) | 96 | `ls tests/*.js` minus 3; 7 of them are `*-page.js` helpers loaded by page tests |
| curated gate (`node tests/gate.js --full --list`) | 40 = 18 node + 22 page | prints 40 names |
| regress page tests NOT in the curated gate | 121 of 143 | set difference |
| `KNOWN_FAILING` in code | 1 (NE-state-leak) | tests/gate.js:42; the header comment (gate.js:10) lists 9 names as "known-failing, NOT in the gate" - the code list is shorter, but those 9 are simply absent from the curated lists |
| `js/` files with a `MAP` entry in tests/gate.js | 16 of 74 | regexes from the MAP literal applied to `ls js` |
| `js/` files with NO MAP entry (a change makes `--touched` run the FULL gate) | 58 | same |

**`--touched` is not a subset of `--full`.** MAP entries name tests directly (e.g. `LHS1-lamp-halos`, `LDR1-lamp-road`, `TOUGE-ELEV-B` on its branch) that are absent from the curated `--full` list, so a lamp-halo change runs LHS1 but a plain `--full` never does. Two lists decide what "the gate" means: the curated list and the MAP.

Drive-related `js/` files with no MAP entry (OBSERVED): js/beam-quality.js, js/beam-store.js, js/beams.js, js/drive-game.js, js/drive-models-glsl.js, js/drive-models.js, js/drive-touge-three.js, js/drive-touge.js, js/drive-worker.js, js/ideal-beam.js, js/road.js, js/scene-details.js, js/sealed-beam-source.js, js/spec.js, js/starter-lamps.js. Every one of them, if edited, triggers "unmapped changed files, running the full gate". All 58 unmapped files: js/beam-quality.js, js/beam-store.js, js/beams.js, js/checks1.js, js/checks2.js, js/checks3.js, js/compare-ui.js, js/compare-worker.js, js/compare.js, js/controller.js, js/core.js, js/drive-game.js, js/drive-models-glsl.js, js/drive-models.js, js/drive-touge-three.js, js/drive-touge.js, js/drive-worker.js, js/engine.js, js/eurobeat.js, js/exports.js, js/farfield.js, js/feasibility.js, js/geometry.js, js/gpu-trace.js, js/history.js, js/ideal-beam.js, js/input.js, js/layout.js, js/lenses.js, js/manufacturability-ui.js, js/manufacturability.js, js/modeA.js, js/modeB.js, js/modes.js, js/panels.js, js/photometry.js, js/preview-worker.js, js/profile.js, js/render-gl.js, js/render.js, js/render2d.js, js/road.js, js/scene-details.js, js/sealed-beam-source.js, js/solve-cache.js, js/solve-worker.js, js/solver-constellation.js, js/solver-env.js, js/solver-host.js, js/solver-pool-worker.js, js/solver-pool.js, js/solver-spoke.js, js/solver.js, js/solvers.js, js/source.js, js/spec.js, js/starter-lamps.js, js/state.js.

## 2. Option x test matrix (OBSERVED by script; regex approximate, see OPTIONS.md Method)

"set by" = test files that change the option (not merely mention it; lines listing 5+ options are treated as baseline resets). **Gate** = names of curated-gate tests among them. For the generic-word keys the match is stricter (lower bound).

| option | tests that set it | in curated gate (names) | other tests (first 6) |
|---|---|---|---|
| `trafficShuffle` | 3 | BA5-gpu-atlas, BT-traffic-beams, node:traffic-beams | - |
| `trafficOutIds` | 1 | node:traffic-beams | - |
| `playing` | 12 | CD-controls-dedupe | node:controls-dedupe, node:drive-three-page, node:models-m2-page, node:models-proto-page, CPU-FALLBACK-PAUSE, D1-drive-anim-2 ... +5 |
| `scene` | 10 | CD-controls-dedupe, OV-scene-details, SB1-studs-everywhere | node:models-proto-page, D2-drive-worker, D4-drive-tiles, MG-minigame, MG2-minigame-2, RS-resolution ... +1 |
| `wet` | 7 | CD-controls-dedupe, FG-fog, WT-wetness | D5-drive-realism, MG-minigame, MG2-minigame-2, RS-resolution |
| `visibility` | 17 | node:fog, FG-fog, SC-beam-scatter, SD-scatter-table, SE-table-pacing, SF-silhouette-fade, node:scatter-fade-gain, node:scatter-table-pace, node:scatter-table, node:scatter | node:near-eye-bins, HDX7-halo-levels, NE5-air-beam, SG1-far-car-fog, SL-traffic-halo, node:scenario-node ... +1 |
| `scatter` | 7 | SC-beam-scatter, SF-silhouette-fade, SF1-car-silhouette | DD-dropdowns, NE5-air-beam, SG1-far-car-fog, SL-traffic-halo |
| `trafficHalo` | 6 | **none** | node:halo-levels, DD-dropdowns, HDX7-halo-levels, SL-traffic-halo, UX3-safe-reset-fps, node:traffic-halo |
| `lampHalos` | 1 | **none** | LHS1-lamp-halos |
| `lampClass` | 1 | **none** | LDR1-lamp-road |
| `lampRoad` | 1 | **none** | LDR1-lamp-road |
| `haloBins` | 2 | **none** | node:halo-levels, HDX7-halo-levels |
| `haloDiv` | 2 | **none** | node:halo-levels, HDX7-halo-levels |
| `haloPolar` | 1 | **none** | HDX7-halo-levels |
| `haloPolarLamps` | 2 | **none** | node:halo-levels, HDX7-halo-levels |
| `haloGain` | 2 | **none** | node:halo-levels, HDX7-halo-levels |
| `scatterMode` | 10 | SD-scatter-table, SE-table-pacing, SF-silhouette-fade, SF1-car-silhouette | NE-near-eye, SG1-far-car-fog, SL-traffic-halo, SN-air-defer, node:scenario/schema, node:scenario-node |
| `scatterRes` | 7 | SD-scatter-table, SE-table-pacing | DD-dropdowns, NE-near-eye, NE-state-leak, UX3-safe-reset-fps, node:scenario/schema |
| `scatterBlur` | 3 | SD-scatter-table | DD-dropdowns, node:scenario/schema |
| `scatterCache` | 5 | SD-scatter-table, SE-table-pacing, SF1-car-silhouette | NE-state-leak, node:scenario/schema |
| `scatterCycle` | 6 | SD-scatter-table, SE-table-pacing | node:near-eye-bins, DD-dropdowns, NE-state-leak, SM-cycle-distance |
| `scatterBinCounts` | 3 | **none** | node:near-eye-bins, NE-near-eye, NE-state-leak |
| `scatterQuality` | 2 | **none** | NE-state-leak, NE5-air-beam |
| `scatterCycleFade` | 1 | **none** | SM-cycle-distance |
| `scatterNearFade` | 4 | SF-silhouette-fade, node:scatter-fade-gain, node:scatter-table-pace, node:scatter-table | - |
| `scatterNearFadeRange` | 5 | SE-table-pacing, SF-silhouette-fade, node:scatter-fade-gain | node:near-eye-bins, DD-dropdowns |
| `scatterNearBias` | 4 | **none** | node:near-eye-bins, NE-near-eye, NE-state-leak, NE5-air-beam |
| `scatterGain` | 2 | SF-silhouette-fade, node:scatter-fade-gain | - |
| `wetSheen` | 22 | node:fog, CD-controls-dedupe, FG-fog, WT-wetness, node:regress-node, node:scatter, node:wet-ggx, node:wetness | node:drive-perf, node:drive-polish, node:drive-three, node:models-m2-page, node:models-proto-page, node:models-proto ... +8 |
| `wetModel` | 4 | node:fog, WG-wet-ggx, node:scatter, node:wetness | - |
| `expMode` | 2 | CD-controls-dedupe | F2-drive-anim |
| `ev` | 4 | CD-controls-dedupe | node:deer-alert-page, D5-drive-realism, F2-drive-anim |
| `glare` | 6 | CD-controls-dedupe | D1-drive-anim-2, D2-drive-worker, D5-drive-realism, F2-drive-anim, PS-photosafe |
| `onMode` | 10 | node:beam-atlas, CD-controls-dedupe, node:regress-node, node:tl-traffic-taper, node:traffic-beams | node:high-beam, node:p2-drive-lighting-page, node:p2-drive-lighting, D5-drive-realism, QOL1-checks |
| `people` | 12 | node:foliage, CD-controls-dedupe, FG-fog, WT-wetness, node:regress-node, node:scenery-params | node:deer-alert, node:models-m2-page, node:models-proto-page, node:models-proto, node:ped-cross, node:scene-snapshot |
| `animals` | 6 | CD-controls-dedupe, node:scenery-params | node:deer-alert, node:models-m2-page, node:models-proto-page, node:models-proto |
| `signs` | 5 | CD-controls-dedupe, node:scenery-params | node:drive-three-page, node:scene-snapshot, node:touge-page |
| `reflectiveClothing` | 1 | **none** | RC-reflective-clothing |
| `posts` | 1 | **none** | node:scene-snapshot |
| `veg` | 5 | node:foliage | node:deer-alert, node:models-m2-page, node:models-proto-page, node:models-proto |
| `obstacle` | 1 | node:regress-node | - |
| `rpm` | 3 | SB1-studs-everywhere | D1-drive-anim-2, node:scene-snapshot |
| `tex` | 2 | **none** | D1-drive-anim-2, F2-drive-anim |
| `wild` | 2 | **none** | F2-drive-anim, RC-reflective-clothing |
| `mt` | 5 | **none** | node:p2-drive-lighting-page, CT-cct, D2-drive-worker, DP-drive-polish, P0-drive-perf |
| `fitControls` | 3 | CD-controls-dedupe, UX2-drive-ux | RB-drive-robustness |
| `largeCard` | 2 | UX2-drive-ux | RB-drive-robustness |
| `seed` | 6 | **none** | D1-drive-anim-2, D2-drive-worker, HDX7-halo-levels, MG-minigame, MG2-minigame-2, SL-traffic-halo |
| `density` | 2 | **none** | D1-drive-anim-2, FO-foliage |
| `trafficDensity` | 5 | DC-drive-controls, node:regress-node | node:drive-ux, D3-drive-traffic, FO-foliage |
| `trafficLogic` | 5 | **none** | node:drive-ux, node:p2-drive-lighting-page, D6-traffic-logic, UX1-drive-ux, node:touge-page |
| `safeGap` | 1 | node:regress-node | - |
| `tiles` | 12 | **none** | AM-ambient-tiles, CT-cct, D1-drive-anim-2, D2-drive-worker, D4-drive-tiles, D5-drive-realism ... +6 |
| `tileCache` | 7 | node:fog, node:scatter, node:wet-ggx, node:wetness | node:drive-perf, node:drive-polish, DP-drive-polish |
| `mountainPass` | 7 | CD-controls-dedupe, SB1-studs-everywhere | node:ahb-fix, node:drive-touge, node:game-curves, node:scene-snapshot, node:touge-page |
| `gpuRenderer` | 12 | BA5-gpu-atlas, BT-traffic-beams, TL2-traffic-light-range | node:drive-three-page, node:p2-drive-lighting-page, CPU-FALLBACK-PAUSE, CT-cct, D1-drive-anim-2, D2-drive-worker ... +3 |
| `trafficBeams` | 10 | BA5-gpu-atlas, BT-traffic-beams, node:tl-traffic-taper, node:traffic-beams | node:p2-drive-lighting-page, node:p2-drive-lighting, FO-foliage, HDX7-halo-levels, SL-traffic-halo, node:traffic-halo |
| `surfaceSheen` | 3 | **none** | node:p2-drive-lighting-page, node:p2-drive-lighting, FO-foliage |
| `lampPitch` | 4 | SD-scatter-table | node:p2-drive-lighting-page, node:p2-drive-lighting, QOL1-checks |
| `afs` | 2 | SD-scatter-table | TR-touge-r2 |
| `corneringLamps` | 1 | **none** | TR-touge-r2 |
| `fpsCounter` | 5 | FG-fog, UX2-drive-ux, node:regress-node | P0-drive-perf, UX3-safe-reset-fps |
| `sceneDetails` | 1 | OV-scene-details | - |
| `debugTimings` | 5 | UX2-drive-ux | NE-near-eye, P0-drive-perf, TL-first-open, TR-touge-r2 |
| `dynamicResolution` | 6 | **none** | node:drive-perf, node:p2-drive-lighting-page, CT-cct, P0-drive-perf, RS-resolution, node:resolution |
| `frameTargetMs` | 2 | **none** | RS-resolution, node:resolution |
| `streetLamps` | 4 | PP-pass-parity, node:regress-node | D4-drive-tiles, LDR1-lamp-road |
| `cline` | 1 | **none** | D1-drive-anim-2 |
| `speed` | 5 | **none** | D1-drive-anim-2, D4-drive-tiles, D6-traffic-logic, F2-drive-anim, UX1-drive-ux |
| `oncoming` | 27 | node:beam-atlas, BA5-gpu-atlas, BT-traffic-beams, CD-controls-dedupe, OV-scene-details, PM-pass-mesh, SF1-car-silhouette, node:regress-node, node:traffic-beams | node:auto-high, node:drive-ux, node:drive, node:qol1, AH-auto-high, CR2-tilt-lift ... +12 |
| `preceding` | 19 | BA5-gpu-atlas, BT-traffic-beams, CD-controls-dedupe, SF1-car-silhouette, node:regress-node | node:auto-high, node:drive-ux, node:drive, node:ped-cross, AH-auto-high, D3-drive-traffic ... +8 |
| `onDist` | 0 | **none** | - |
| `preDist` | 0 | **none** | - |
| `onKcd` | 1 | **none** | D5-drive-realism |
| `RL` | 11 | node:fog, node:pass-parity, node:regress-node, node:scatter, node:traffic-beams, node:wetness | node:drive-polish, FO-foliage, G16-spec-view-settings, node:sb2-sheen, node:scene-snapshot |
| `ambient` | 2 | **none** | node:models-proto-page, AM-ambient-tiles |
| `smooth` | 0 | **none** | - |
| `res` | 2 | **none** | DD-dropdowns, RS-resolution |
| `fov` | 2 | DC-drive-controls | node:drive-controls2 |
| `leafyFoliage` | 2 | node:foliage | FO-foliage |
| `detailedModels` | 13 | node:pass-parity, PM-pass-mesh, PP-pass-parity, node:traffic-beams | node:car-tilt-lift, node:deer-alert-page, node:deer-alert, node:deer-bolt-anim, node:models-m2-page, node:models-proto-page ... +3 |
| `trafficRange` | 2 | DC-drive-controls | node:drive-controls2 |
| `trafficLightRange` | 1 | TL2-traffic-light-range | - |
| `trafficNearest` | 1 | TL2-traffic-light-range | - |
| `simCeiling` | 1 | **none** | node:resolution |
| `minFps` | 2 | **none** | RS-resolution, node:resolution |
| `samples` | 4 | **none** | node:drive-three-page, node:p2-drive-lighting-page, CPU-FALLBACK-PAUSE, SS-samples |
| `airLevel` | 1 | **none** | NE5-air-beam |
| `haloQuality` | 1 | **none** | HDX7-halo-levels |
| `wetness` | 4 | CD-controls-dedupe, FG-fog, WT-wetness, node:wetness | - |
| `deerBehaviour` | 6 | node:pass-parity, node:traffic-beams | node:deer-alert-page, node:deer-alert, node:deer-bolt-anim, node:game-curves |
| `ownLow` | 6 | BA-beam-library-gpu | BA-beam-library, BB-beam-library-fixes, BB3-beam-colour, BI-beam-indexeddb, node:scenario/browser |
| `ownHigh` | 4 | SF1-car-silhouette | BA-beam-library, BB3-beam-colour, node:scenario/browser |
| `scatterTableSteps` | 3 | SD-scatter-table, SF1-car-silhouette | node:near-eye-bins |
| `view` | 6 | **none** | node:drive-controls2, node:drive-three-page, CPU-FALLBACK-PAUSE, D1-drive-anim-2, D2-drive-worker, F2-drive-anim |
| `pedStop` | 1 | **none** | node:ped-cross |
| `lampRule` | 1 | node:tile-options | - |

### Options with NO test that sets them (3)

`onDist`, `preDist`, `smooth`. `onDist`, `preDist` and `smooth` are real options (the first two only reach the CPU still, spec-ui.js:1077; `smooth` is a sidebar row, spec-ui.js:602). `res` has a test hit only under the loose rule and is a CPU-still width with no UI.

### Options that have tests but none of them is in the curated gate (38)

`trafficHalo`, `lampHalos`, `lampClass`, `lampRoad`, `haloBins`, `haloDiv`, `haloPolar`, `haloPolarLamps`, `haloGain`, `scatterBinCounts`, `scatterQuality`, `scatterCycleFade`, `scatterNearBias`, `reflectiveClothing`, `posts`, `tex`, `wild`, `mt`, `seed`, `density`, `trafficLogic`, `tiles`, `surfaceSheen`, `corneringLamps`, `dynamicResolution`, `frameTargetMs`, `cline`, `speed`, `onKcd`, `ambient`, `res`, `simCeiling`, `minFps`, `samples`, `airLevel`, `haloQuality`, `view`, `pedStop`.

Headline (OBSERVED): the whole traffic-halo family (trafficHalo, haloBins, haloDiv, haloPolar, haloPolarLamps, haloGain), the lamp family (lampHalos, lampClass, lampRoad), reflectiveClothing, the scatter detail options (scatterBinCounts, scatterQuality, scatterCycleFade, scatterNearBias), trafficLogic, tiles, seed, wild, mt, samples, simCeiling, minFps, dynamicResolution and the lighting extras surfaceSheen / corneringLamps are covered only by tests that the curated gate does not run (they run only when a MAP rule names them, or by hand). Their pins are the ones that drifted last night (section 4).

## 3. Feature-area view: which curated-gate test covers which area (INFERRED from names, test headers and the option matrix)

| area | curated-gate tests | not in gate but exists |
|---|---|---|
| air beam, direct and table | SC-beam-scatter, SD-scatter-table, SE-table-pacing, SF-silhouette-fade, SF1-car-silhouette, FG-fog, node:scatter, scatter-table, scatter-table-pace, scatter-fade-gain | NE5-air-beam, NE-near-eye, NE-state-leak (open), SM-cycle-distance, SN-air-defer, TL-first-open |
| traffic halo | node:traffic-beams (beam side only) | SL-traffic-halo, HDX7-halo-levels, node:traffic-halo, node:halo-levels (names in tests/) |
| lamp halos / lamp road | - | LHS1-lamp-halos, LDR1-lamp-road (reachable only via MAP rules on drive-three-lamphalo.js, drive-three.js, lamp-dist.js) |
| wetness / sheen / GGX | WT-wetness, WG-wet-ggx, node:wetness, wet-ggx | - |
| traffic beams / library | BT-traffic-beams, BA5-gpu-atlas, BA-beam-library-gpu, node:beams, beam-atlas, traffic-beams | BA-beam-library, BB-*, BI-beam-indexeddb |
| traffic light range | TL2-traffic-light-range, node:tl-traffic-taper | - |
| scene content / people / objects | node:scenery-params, scene-digest, foliage, tile-options, regress-node, CD-controls-dedupe, SB1-studs-everywhere | RC-reflective-clothing, D3/D4/D5/D6, MG/MG2, models-* |
| mountain pass | PM-pass-mesh, PP-pass-parity, node:pass-parity | TG-touge-proto, TR-touge-r2, TB-touge-banner, node:drive-touge, touge-page, touge-r2 |
| drive UI / controls | UX2-drive-ux, DC-drive-controls, DW-drive-wheel, CD-controls-dedupe, OV-scene-details | UX1, UX3-safe-reset-fps, DD-dropdowns, DP-drive-polish, SS-samples, RS-resolution |
| GPU renderer / lighting | P1-drive-three, P2-drive-lighting | GR-gpu-robust, F1-gpu-default, W3a-webgl-scene, CPU-FALLBACK-PAUSE |
| CPU still / LAZYCPU | - | LC-lazy-cpu |
| high beam / AHB | - | HB-high-beam, AH-auto-high, node:high-beam, ahb-fix |
| minigame | - | MG-minigame, MG2-minigame-2 (known failing), node:minigame, minigame-2, game-curves |
| rescue URLs (?reset, ?safe) | - | UX3-safe-reset-fps |

## 4. Tests whose pins depend on pedestrians (they moved in the last night's work)

Last night's relevant commits on main (OBSERVED `git log`, `git show --stat`): 2af6606 PED-CLOTHING-MODES (touched drive-scenes.js, drive-anim.js, drive.js, drive-models.js, tests/scene-digest.js, regress-node.js, RC-reflective-clothing.js, models-proto.js); e3aae0d re-baselined FG-fog, SC-beam-scatter, SD-scatter-table and the scene-snapshot people column; 07c28c9 re-baselined foliage, P2 (p2-drive-lighting-page) and WT-wetness "with people off"; 5f9d514 re-pinned beam-atlas. Cause per the commit text: clothing colours are now shuffled per walker and the strips/reflectors changed pixels.

Method: 243 test files scanned for `people`, `pedestrian`, `walker`, `person`, `ptype`, `pedMode`, `reflectiveClothing`, `crosser`, `cross:`; 48 files mention them, 14 of those are in the curated gate. "people:false pinned" = the file sets `people: false` (a pixel pin that avoids pedestrians); "people:true" = sets it true. "hash terms" = count of sha/hash/pin words (a rough measure of pixel/text pins).

| test | people mentions | people:false | people:true | hash-ish terms | gate |
|---|---|---|---|---|---|
| T/ped-cross.js | 42 | yes |  | 1 |  |
| T/scenery-params.js | 28 | yes | yes | 0 | GATE |
| T/regress-node.js | 27 | yes | yes | 25 | GATE |
| T/ped-gait.js | 22 |  |  | 0 |  |
| T/scene-snapshot.js | 16 |  | yes | 13 |  |
| R/RC-reflective-clothing.js | 15 |  | yes | 1 |  |
| T/models-proto.js | 13 | yes | yes | 17 |  |
| T/models-m2-page.js | 10 | yes | yes | 0 |  |
| T/pass-parity.js | 10 |  | yes | 0 | GATE |
| T/models-proto-page.js | 9 | yes | yes | 0 |  |
| T/foliage.js | 8 | yes |  | 1 | GATE |
| R/CD-controls-dedupe.js | 6 |  | yes | 0 | GATE |
| R/FG-fog.js | 6 | yes |  | 13 | GATE |
| R/SD-scatter-table.js | 6 | yes |  | 29 | GATE |
| R/WT-wetness.js | 6 | yes |  | 20 | GATE |
| T/minigame.js | 5 |  |  | 0 |  |
| T/models-m2.js | 5 |  |  | 0 |  |
| T/p2-drive-lighting-page.js | 5 | yes |  | 4 |  |
| R/SC-beam-scatter.js | 5 | yes |  | 12 | GATE |
| R/D1-drive-anim-2.js | 4 |  |  | 0 |  |
| R/LC-lazy-cpu.js | 4 |  |  | 0 |  |
| T/scene-digest.js | 4 |  | yes | 17 | GATE |
| T/minigame-2.js | 3 | yes |  | 0 |  |
| T/car-tilt-lift.js | 2 |  | yes | 0 |  |
| T/deer-alert.js | 2 | yes |  | 0 |  |
| T/drive-ux.js | 2 |  |  | 0 |  |
| R/MG-minigame.js | 2 |  |  | 0 |  |
| R/MG2-minigame-2.js | 2 |  |  | 0 |  |
| T/scenario/run.js | 2 |  |  | 6 |  |
| T/traffic-beams.js | 2 | yes | yes | 12 | GATE |

Reading (INFERRED): tests with hash terms AND `people:true` or no `people:false` are the ones whose pixels move when pedestrian code changes: scene-snapshot (16 mentions, 13 hash terms, not in gate), scene-digest (gate), regress-node (gate), models-proto, traffic-beams (gate), SG1-far-car-fog (17 hash terms, not in gate, sets people:true). Tests that pin with `people:false` (FG-fog, SC-beam-scatter, SD-scatter-table, WT-wetness, foliage, p2-drive-lighting-page) were still re-baselined in these commits; for foliage, P2 and WT the commit says the baseline was re-taken "with people off" (07c28c9). Whether the remaining pixel movement in the people:false tests came from the pedestrian change or from the other changes merged the same day (lamp-dist, halo levels, LAZYCPU edge column) is NOT determined here (no tests were run).

Gate tests that depend on the junction crosser (OBJECTS.md P6/P7, which ignore or only partly honour the clothing option): none identified by name; tests/ped-cross.js (42 mentions, not in gate) is the dedicated test for crossers.

## 5. Method (commands)

- `ls tests/regress | wc -l` -> 143; `ls tests/*.js | wc -l` -> 98 (96 + gate/load/serve).
- `node tests/gate.js --full --list` -> 40 names (18 `node:` + 22 page). `node tests/gate.js --touched --list` was not needed (docs/ and .md map to `[]`, gate.js MAP, so a docs-only branch selects nothing).
- `docs/inventory/scripts/options-scan.js` for the option x test matrix; the MAP/unmapped computation is `eval` of the `const MAP = [...]` literal in tests/gate.js applied to `ls js/*.js` (inline in this doc's generation, 6 lines).
- Known limits: regex-based; fixture/bench/tools directories excluded; a test that sets an option through a helper whose argument is not the literal key (e.g. a loop over keys) is missed (possible false "none").
