# Handoff: vm-agents-2026-10-30 review (2026-11-05)

A review of the swarm branch `vm-agents-2026-10-30` (26 commits on top of `main` 6541ccf, fast-forwardable). Fixes from the review and from the
audits that followed it are on **`claude/exciting-brown-9x0vlq`**. That branch is the merge candidate; don't merge the swarm branch itself.

## 1. Merge checklist

1. On the Mac (real GPU):
   - Run `node tests/gate.js --full`.
   - Re-pin the frame hashes the swarm recorded on the host GPU after 781454a. Those builds had the GPU material ids
     shifted (see 3.2), so these pins certify wrong renders: FG/SC clear frame, SD `DIRECT16`, WT dry, AM ambient, and any other pin
     re-recorded between 781454a and 71ba3db (`git log -p 781454a^..71ba3db -- tests/regress | grep RE-PIN`).
2. Check that the ground shader links on an iPhone in Safari. route-parts-64 grew part/partShape/crossing to `[64]` vec4. They were only compiled
   on SwiftShader here.
3. Known red regardless: `node:scene-digest`. It has been red on `main` for at least 15 commits (forest@7@tiles95 and city@7@tiles95 objects moved).
   Find the cause before re-pinning.
4. Merge with a squash, or with a merge commit whose message describes the content. The swarm commit messages are all "import shared-workspace app changes".

## 2. Commits on `claude/exciting-brown-9x0vlq` (on top of the swarm tip 71ba3db)

| commit | what |
|---|---|
| 3f934a7 | Review fixes:<br>- heatShimmer flip dropped the wetBounce shader variant<br>- table key carried wetness with wetBounce off<br>- oncoming wet-bounce gated by the direct beam (dropped above a cut-off)<br>- wetBounce reads wetness via `wetnessOf`<br>- wetVeil used a fixed 0.25 dry floor (now `dryStreakFloorOf`; touge pass passes dryStreaks/roadSurface)<br>- endlessTile works→toll→vms order (exclusivity read unset fields)<br>- registry wetness note<br>- beam-atlas re-pin (stale since ff45bc1)<br>- new `tests/endless-feature-exclusive.js` |
| 67c3a0d | DL-drive-layout writes its screenshot to the ignored `tests/shots/`; the 495 KB PNG is untracked. OPTIONS.md wetness row |
| 262c709 | GPU material-id constants back to main's (see 3.2). The node copies of ignored-when / S1-runtime-options honour `PLAYWRIGHT` (they hard-coded VM paths, which broke `all.js` everywhere else) |
| 2944a84 | Endless elevation: one vertical curve per block edge. The grade stepped 2–9 % every 3.2 km. Adds a continuity check to le-chonk-hills |
| 0142865 | (optimizer) Halo: under moment2 the polar pass gets the first moment (polar tables were writing depth² into red). Wet bounce in every table; CC sweep +moment 3 (386 variants compile) |
| 39a978b | (optimizer) tableKey includes `surfKOf` while wetBounce is on |
| d08f6b4 | (optimizer) CPU frame key + groundKey include roadSurfaces/roadSurface |
| 3d639e7 | (optimizer) Endless traffic density reads the tile under the car, not the car slot index (+ `tests/endless-traffic-density.js`) |
| f3ca8f6 | (optimizer) mirrorCars under multilane use `mlLanes().right`, not the median side |
| 8adb4f6 | (optimizer) tileWorld verge edges follow the multilane cross-section (+ `tests/multilane-verge.js`) |

Each behaviour fix has a check that fails without the fix and passes with it (verified by stashing the fix).

## 3. Findings worth knowing about

### 3.1 How bugs got in
- **Imports pushed red.** Imports went in with 1, 2 and 4 failing Node tests ("Node tests touched: N failing" in the commit body). That's how
  beam-atlas (since ff45bc1) and foliage (since 781454a) went red in the gate.
- **Pins measured on broken trees.** Frame hashes were re-recorded on the host GPU against the wrong-material build, so a green pin there doesn't mean a correct picture.
- **Source-text tests.** 17 Node suites, plus several in `regress/`, assert on code strings. They break on correct refactors and miss behaviour.

### 3.2 GPU material-id double correction (fixed in 262c709)
- **8b553f4** inserted `marker-amber`/`marker-red` mid-list (ids 23/24, every later id +2) and left the GLSL constants alone.
- **781454a** moved the markers to the end, which put the ids back to main's: wall 25, wall-light 26, win-dark 27, win-warm 28, win-cool 29, car-paint 30, tyre 31.
  The same commit also shifted the constants by −2.
- **Result:** on the GPU path, car paint drew as win-warm, glass as wall, tyres as win-cool, and the facade rules picked the wrong ids.
- **Confirmation:** FG-fog CPU/GPU parity on SwiftShader went from 4 building failures (road/forest × dry/wet) to 98/98 passing after the fix.
- **Permanent fix:** generate the GLSL ids from `RF.Drive.MAT_KEYS` (one source of truth).

### 3.3 Open bugs (not fixed). All opt-in features unless noted

Endless generator (`js/drive-anim.js`):
- **Mostly straight.** 61 % straight tiles (mountain 75 %) against 13 % for the default walk. The tight-S rule `Math.abs(p1.curvature) >= 1/250` is true for every curve
  (radii are only 150 and 250 m), so it flattens every S-bend. It also cancels the mountain switchback rule (curve answers the previous with the opposite sign),
  except under the `switchbacks` preset.
  - With the rule off: 46 % straight (mountain 34 %). Heading excursion is about 1,650° over 80 km either way, so the rule doesn't stop loops.
  - The rest of the straightness comes from `ENDLESS_WEIGHTS` (open 50 % straight, forest 60 %, city all straight kinds). That one is a design call.
- **Switchback / no-loop rules read raw neighbours, not adjusted ones.** 3,283 runs of three same-sign curves under `switchbacks` (5 seeds × 3,000 tiles).
  - The optimizer's A1 patch (memo plus chaining on adjusted tiles) cut that to 0 and dropped a warm call below 1 µs. But it reshapes about 5 % of tiles, which breaks the
    `le-chonk-presets` switchbacks check and the `le-chonk-cabin` drift-yaw check at tile 7.
  - Settle the tight-S rule (above) first, then decide whether to re-pin.
  - The patch and its test are saved at `docs/handoff/2026-11-05/A1-endless-memo.patch` and `endless-chain.js`, with notes in that folder's README.
    That folder and this file should be dropped before merging.
- **Custom presets:** tunnel/layby neighbour checks hard-code 0.10/0.07 instead of the custom probability (back-to-back tunnels and laybys). The crossing's tunnel-neighbour test
  calls `endlessBiome` without preset/custom. `custom.fuel` is parsed but never read (hard 0.05). `mix` weights aren't normalised
  (`{open:1, forest:1}` gives 100 % open). `gradeBiome` takes abs() of both ends.
- **Readout:** `whereAt` calls `endlessTile` without preset/custom (wrong biome readout).
- **Negative tile indices:** `endlessVerge` uses `k % 16`, which is wrong for negative k.
- **Performance:** about 4.3 µs per `endlessTile` call, an estimated several hundred calls per frame. `endlessElevCache` is unbounded (keyed by custom JSON).
- **Multilane:** under multilane the base scene's own objects (delineators, scene deer placed by `place()`) still use the two-lane edges and stand on the carriageway.
- **Duplicate markings:** `src.markings` checks only `o.multilaneRoad`, but highway-loop/toll-loop imply multilane, so the lane lines are doubled.

Option interference:
- **Presets leak outside endless.** endlessPreset applies multilane and gantries with `endlessRoad` off. tileTerrain needs endless + elevatedView but declares only tiles.
- **Drift angle disagreement.** With driftAfs or driftCabin on and driftDynamics off, the beam and cabin follow the lagged angle while the camera arc uses the raw one.
  Drift sub-options aren't gated on driftMode.
- **cabinLight without cabinView** pushes a glare source with no visible dome, so auto-exposure dims by about 17 %.
- **trafficLighting:** on endless tiles `lampRule` is ignored. Choosing 'no-lamps' then turning streetLamps back on by hand leaves `lampRule` off.
- **Registry rules disagree with the UI:**
  - dryStreaks and wetBounce have UI gates but no registry rule.
  - wetVeil's rule says it needs wetness > 0, but it works at 0 with dryStreaks.
  - haloWidthStep's note says "mutually exclusive" with crossing refinement, but the code composes them.
  - The `crossingRefineOn` line reference is stale.
- **Slider rebuilds.** The cabinWetnessSlider fires setDV on every input tick, which rebuilds the scatter table while wetBounce is on.

Other:
- **Signal cones:** every frame they rescan `world.objects` once per signal. Cache the list per world.
- **Uniform limits:** route-parts-64 is unverified against mobile limits (see 1.2).
- **regress-node G21** (geometry cache 0.4→5.0 MB) appeared once in the optimizer's run while it had code stashed. Probably not real, but re-check it.
- **Scenes:** endless sits on top of the selected scene (`source()` builds the base scene and repeats its static objects along the tile route, ~:1075), so city
  buildings can appear in a forest biome. Agreed direction: make endless a scene, following the `__pass` / mountainPass pattern (brief B9).

## 4. Test status

- **Node gate on the fix branch** (before the optimizer commits): 94 suites, all clean except `scene-digest`, which was red already. With full history, the shallow-clone
  failures turned out as follows:
  - duv and models-proto pass.
  - foliage was a real failure: the material-id bug (fixed).
  - regress-node F5 needs a rerun with full history (`git fetch --unshallow`).
- **Page tests on SwiftShader**, three shard sessions plus this container. 28 of 78 ran; it's slow, 1–10 minutes per test.
  - **Clean:** WG, BA, BA5, TOUGE-ELEV-B, PP, BT, TL2, LCM1, CC, LDR1, SB1, OV, DC, DW, PM.
  - **Timeouts (environment):** UX1, UX2, SF, SF1, TOUGE-AIR, TOUGE-AIR-RIBBON, TOUGE-SKY-VEIL, BJ1, BJ2, SCULL, CD-lampcone-depth, SP.
  - **Hash mismatches (expected on SwiftShader):** FG/SC clear frame, WT dry, SD DIRECT16.
  - **Unresolved:** CD-controls-dedupe "Play advances distance and time" failed 3 times while also being wall-killed. Check on the real GPU.
- **Coverage** (c8 over all 94 Node suites): lines 81.4 %, functions 73.1 %, branches 83.6 %. Lines average about 105 characters, so line % flatters.
  - Lowest: drive-anim.js 44 % (1,880 uncovered lines), drive-three-halo.js 43 %, drive-layout.js 40 %, beams.js 38 % (functions 0 %),
    drive-touge-three.js 31 %, drive-three-models.js 23 %, solve-cache.js 29 %, sealed-beam-source.js 26 %.
  - **Never loaded by any Node suite:** ui.js, spec-ui.js, panels.js, gpu-trace.js, render.js, drive-three.js, drive-three-lampcone.js, render-gl.js, render2d.js,
    solver-host.js, eurobeat.js, compare-ui.js, drive-three-beamcone.js, input.js, plus small workers.
  - Two of today's bugs (the shimmer/wet-bounce recompile and the material ids) lived in modules no Node test loads.

## 5. Direction (owner decisions, 2026-11-05)

- **Product:** a realistic real-time preview, physically grounded, cutting corners only where the eye won't notice. Judged by eye; no reference footage.
- **Hardware:** Apple Silicon. Safari/WebKit WebGL2 is primary; Chrome/ANGLE-Metal is secondary. About 30 fps "high" presets on the Mac; phones may downgrade.
- **Oncoming halo sampling:** equiangular sampling is already used for lamp/beam cones. It was rejected for the oncoming halo because a narrow low beam lights only about
  5–40 m in front of the lamp, far from closest approach (drive.js ~:972). The fix is to clip the ray to the beam's lit interval first, then sample
  equiangularly inside it. `haloLampWin` is a hard-coded version of that.
  - Once this plus temporal accumulation lands: keep `haloCrossingRefine` as reference only; retire `haloWidthStep`, `haloRefineNeighbour` and `haloMoment` blend/moment2;
    keep `haloMoment: on` only if FLIP says it earns its cost.
  - `trafficSubTick` should default to on.

## 6. Build briefs (none started; ready to hand out)

Common preamble for every brief:
- **Branch:** start from `claude/exciting-brown-9x0vlq` (a branch name or a full sha, not a short hash). Push one new branch per brief; the owner merges.
- **History:** first `git fetch --unshallow origin main`, because several tests `git show` old commits.
- **Commits:** small and logical, with no agent-name tags in code comments.
- **Tests:** for every behaviour fix, an executed check that fails without the fix and passes with it.
  - No source-text assertions and no new frame hashes.
  - State the cause of any re-pin in the commit.
  - A test that exposes a bug goes in `tests/pending/` (outside the gate) and in the report.
- **No GPU:** run page tests through a Playwright shim that drops `--use-gl/--use-angle` and adds
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox` (`PLAYWRIGHT=/path/to/shim`).
  It's slow, so run only the mapped tests, and treat timeouts as environment.
- **Final report:** what was built, verified vs not, open questions, commit list.

- **B1 Tolerance image tests + FLIP reference harness.**
  - Replace exact frame hashes with tolerance comparison: per-pixel tolerance plus FLIP (LDR) in plain JS, with references per GPU class under `tests/refs/` and a documented update command.
  - Convert FG, SC, WT and SD first; keep the old hash as an opt-in strict mode for the owner's GPU.
  - Add a reference harness: a high-sample CPU render (and `haloCrossingRefine 2048` on the GPU) scored by FLIP per scene.
  - Add a dev A/B viewer page (side-by-side, flicker, FLIP heatmap) for judging by eye. Document in `tests/IMAGE-TESTS.md`.
- **B2 Standard test runner.**
  - An adapter so the existing scripts run under `node --test` and `@playwright/test` unchanged: sharding, retries reported as *flaky* (not clean), timeouts, reports, `--only-changed`.
  - Convert 3–5 page tests natively with a shared browser/server fixture.
  - A GitHub Actions workflow: Node suites + SwiftShader page tests sharded on ubuntu, chromium + **webkit** projects, plus a self-hosted Apple Silicon job for the real GPU.
  - `tests/RUNNER.md` mapping gate.js features to their standard equivalents.
- **B3 Cache keys derived from the registry.**
  - Registry metadata per cache: stillFrame, ground, animScene, scatterTable, haloTable, … Each lists its member options, conditional inclusion and normalisation.
  - One `RF.Options.cacheKey(name, look, extras)` used at all ~16 sites; byte-identical where the old keys were right.
  - Replace cache-key-coverage / halo-cache-keys with declaration checks plus an executed sensitivity test.
- **B4 Shader variants via `#define`.**
  - Replace the ~54 `hrep`/`.replace` text patches with `#ifdef` blocks + `material.defines`, one axis at a time, proving each step behaviour-identical.
  - One shared wet-bounce/mirror helper on the CPU (4 copies today) and one GLSL function (3 copies).
- **B5 Split drive-anim.js.**
  - Move traffic sim, cabin/mirror/drift and timeline/scrubber into their own classic scripts on RF. Keep `RF.DriveAnim`'s surface identical.
  - Reformat only the moved code. Leave the endless generator for after A1/item 19 land.
- **B6 Cone-clipped equiangular oncoming halo.**
  - Clip each view ray to the beam's support, then sample equiangularly about the lamp within that interval. Implement on both CPU (`trafficHalo`) and GPU, default off.
  - Measure against the `haloCrossingRefine 2048` reference across distances; report visible banding plus cost per quality tier.
  - Propose it as the "high" default and list the halo options it makes redundant.
- **B7 Temporal accumulation for fog scatter.**
  - Per-frame blue-noise jitter plus an exponential history of the scatter term only. Reset on cuts, large motion and option or scene changes; reproject where valid.
  - Float/half-float history with an RGBA8 fallback for WebKit.
  - Avoid visible ghosting at 50–100 km/h. Measure convergence and cost.
- **B8 Mesopic vision.**
  - Per-source S/P ratio from the existing spectra. CIE 191 mesopic weighting from the adapted luminance, plus Kirk & O'Brien 2011 low-light mapping (desaturation, blue shift) and optional mild acuity loss.
  - CPU/GPU parity; a strength slider (default 0 = byte-identical) with A/B; cheap enough for 30 fps on WebKit.
  - Tests: S/P per lamp kind, identity at photopic levels, monotonic desaturation. Document parameters with citations.
- **B9 Endless as a scene.**
  - A scene-select value (like `__pass`) that turns on tiles + endless and suppresses the base scene's static objects. endlessPreset becomes its sub-select.
  - Retire the `endlessRoad` toggle from the UI and migrate old states via options-migration. Gate every preset implication on the endless scene.
  - Update the registry rules, layout (DL test) and docs.
- **B10 Quality tiers + developer panel + device capability.**
  - One `quality` option (low/medium/high/ultra) collapsing the halo/scatter/shadow/resolution knobs; the existing governor steps tiers by frame time; explicit knobs override ("custom").
  - Move the ~40 prototype/expert toggles behind a Developer disclosure. Make `trafficSubTick` default on.
  - Query WebGL2 limits at startup (Safari/iOS as the floor) and pick array sizes/variants that fit, lowering the tier instead of falling back to CPU. Add a Node check of uniform-vector count per variant.
- **B11 Optimizer leftovers** (on the merge-candidate branch, in this order):
  1. Item 19: narrow or drop the tight-S rule; never override switchbacks.
  2. Then A1 (memo + adjusted-neighbour chaining; settle the le-chonk-presets/cabin pins).
  3. A2: one feature table instead of the 12 copy-pasted blocks (fixes the custom-probability bugs).
  4. A3: signal-cone lamp cache.
  5. Remaining open bugs in 3.3.
- **T1–T4 Coverage** (tests only, one branch each):
  - **T1 GPU-module logic in Node:** a harness importing drive-three*/halo/cones with a fake renderer. Cover variant state machines over toggle sequences, the GLSL material-id→MAT_KEYS semantic check, uniform bounds, halo plan selection, and table-key sensitivity.
  - **T2 drive-anim through `RF.DriveAnim`:** IDM/signals/junctions/turns invariants over seeded long runs, state dump/load round-trip, timeline, governors, curve helpers.
  - **T3 UI in jsdom:** one control per registry option and placed by the layout; spec-ui sync vs registry rules over random states; control round-trips; undo/redo; trafficLighting preset behaviour.
  - **T4 Optics/solver:** beams/ideal-beam/sealed-beam/solve-cache/solver-pool/geometry/state, using physical invariants (energy, symmetry, scaling, round-trips); render2d/gpu-trace pure helpers.
- **Needs the Mac (do locally):** self-hosted runner registration, the frame-hash re-pins, Safari/iPhone WebGL limits, tuning the 30 fps presets, judging mesopic/temporal by eye.

## 7. Infra

A separate review of the swarm infrastructure (agent-qa) was done. It is kept out of this public repo. The owner has it.
