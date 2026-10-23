# HAZARDS: the 15 cross-cutting integration hazards, ranked

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). Read-only; nothing was run in a browser, so "consequence" lines are INFERRED unless a line says OBSERVED. Evidence lines are file:line from this checkout.

Ranking = how likely it is to bite the owner silently x how hard it is to notice. Each hazard names the options that interact and the one "seam" (a single shared place) that would remove it. The seams are the four from the brief: **option registry** (one declared list of options with their rules), **scene resolver** (one place that decides which objects a scene contains and how they are built), **road frame** (one description of the road geometry that flat road and mountain pass both implement), **budget check** (a Node-side check that every shader program stays inside the GPU's limits).

Terms, defined once: a *fragment shader* is the small GPU program run for every pixel; a *sampler* is a texture it reads (max 16 per shader here); a *uniform vector* is a 4-number slot the CPU hands to the shader (max 1024 here); a *cache key* is the text a cached result is filed under, and a *state leak* is a result reused after an input changed that the key did not include.

---

## H1. The game leaves its settings behind in the live options object (and can save them)
- **What (OBSERVED)**: while a minigame runs, `sync()` does `Object.assign(I.o, st.gameOptions)` (js/drive-anim.js:2163). `I.o` is the same object as the saved options (`o = dvOpts(ui)` is passed at js/spec-ui.js:1139), so the game's overrides (`scene:'road', tiles, wild, seed, speed, wet, wetness, people:false, animals:false, obstacle:false, trafficLogic:false, oncoming:true, preceding:false`, optionally `onMode:'generic'`; drive-anim.js:1929-1931) are written into the live object. Any `setDV` during a game, including pressing play (`setDV(ui,'playing',...)`, drive-anim.js:1578) or the quiet speed slider (spec-ui.js:1139), then writes the WHOLE object to localStorage (spec-ui.js:907-911).
- **Restore is incomplete (INFERRED from code)**: exit does `Object.assign(info().o, st.gameSaved.options)` (drive-anim.js:1906), but `gameSaved.options` is a copy of keys that existed at game start (:1909). `wetness` is not in DV_DEF and stays undefined until the road button is clicked once, so the game's `wetness` value is not removed on exit, and `wetnessOf` prefers `wetness` over `wet` (drive.js:92): a wet game can leave the road wet with `wet` restored to false.
- **Evidence it is a known problem**: reports/TR-touge-r2.md lists "MG2 18/1 (known exit-restore HDR failure only)"; MG2 is excluded from the gate (tests/gate.js:10).
- **Interacts**: every option in `gameOptions`, `wet`/`wetness`, `playing`, `onMode`.
- **Seam**: option registry with a layered store (base profile / session overlay / game overlay): reads see the overlay, writes go to the base, leaving a game drops the overlay with no key bookkeeping.

## H2. Every option is frozen into the saved profile at the first save, so new defaults never arrive
- **What (OBSERVED)**: `setDV` stores the whole `dvOpts` object (spec-ui.js:907-911), and `dvOpts()` merges `DV_DEF` under it (:890). After one save, every key has a stored value; changing a `DV_DEF` default later only affects profiles that never saved, `?reset` or `?safe`. The code already works around it by inference for `onKcd` (spec-ui.js:890, "Old setDV saved the whole option set, so onKcd = 30 is the old default, not a choice") and `scatterNearFade`, `wet`, `glare`, `minFps`.
- **Consequence**: defaults described in commit messages (`samples` 1, `lampHalos` off, `haloBins` 24) are what the owner sees only on a fresh profile; a tester and the owner can see different "defaults". Tests build baselines by assigning a long list of options explicitly (e.g. tests/regress/LHS1-lamp-halos.js:28), so they never notice.
- **Interacts**: all 87 `DV_DEF` keys; migrations accumulate in one long line of about eight clauses (spec-ui.js:890).
- **Seam**: option registry: store only keys the user changed, defaults and versioned migrations live in the registry.
- **Status (feat/option-registry, 2026-10-22): partly fixed.** A whole-object profile saved by an older build now takes the current default for each key still at a known superseded default (`defaultHistory` in js/options-registry.js, `defaultsVersion` in the profile; seeded for `tiles`, `glare`, `gpuRenderer`, `reflectiveClothing`). Still true: the profile is written whole, and a user who chose a value equal to an old default cannot be told from one who never changed it.

## H3. On the mountain pass, one program goes over the 16-sampler limit when the air beam table is on
- **What (INFERRED, script over the repo's own shader text, docs/inventory/scripts/reach.mjs)**: the instanced-object program on the pass needs 17 samplers (plain + table) or 18 (lit + table); limit 16. The flat equivalent needs 15 of 16, so flat has one spare; pass mesh cars need 15. The ribbon needs only 5-6 on main (9 on the two touge-halo branches, which add only the halo call) and 15 only if it were given both the table lookup and the halo call.
- **Why it hides**: three samplers for the traffic halo are declared in every program built from the ground text whether `trafficHalo` is on or not, and the three `scatBankB*` fade banks are declared in every table program even with `scatterCycleFade` off (RENDER.md section 3). The failure appears only when the first pass frame compiles with the air beam in table mode.
- **Interacts**: `mountainPass`, `scatterMode`, `trafficBeams`/`afs`/`lampPitch`/`corneringLamps` (lit variant), `trafficHalo`, `detailedModels`.
- **Seam**: budget check (a Node test that assembles every variant and fails above 16 samplers / 1024 uniform rows; the script exists), plus folding the six table banks into one array texture.

## H4. The pass silently drops features whose controls stay visible
- **What (OBSERVED)**: no halo on the pass (`!p.touge`, js/drive-three.js:295), (the ribbon main has had a halo term since TOUGE-ELEV B2 and the air-beam `inScatter` term since TOUGE-AIR-RIBBON), no people (drive-scenes.js:176), no leafy foliage / tree impostors (drive-three-objects.js:172,211), `scene`/`wild` overridden (drive-anim.js:33). The controls for all of these stay enabled (spec-ui.js sync loop 1012-1051 has no pass test; the only pass test in spec-ui is the scene select, :921,1014). The air hold still waits for a halo that is never built (drive-anim.js:2333).
- **TOUGE-AIR addition (OBSERVED 2026-10-23)**: on the pass the air-beam table (`scatterMode` table) no longer crashes the object program, but the cycle blend (`scatterCycleFade`) is ignored there (the second bank set is compiled out to stay under 16 samplers) and the control stays enabled; the air beam lights objects only, never the road (ribbon has no `inScatter`). **CLOSED by TOUGE-AIR-RIBBON (OBSERVED 2026-10-23)**: the ribbon main calls `inScatter`, so the road is lit too (direct and table), and the table is built in the car frame (the same as the lit passes' lamp and eye uniforms after `passShader`), so slope poses agree with direct mode. Still true: the cycle blend is ignored on the pass; pass direct is no longer byte-equal to main (the road is lit); pass air off is.
- **Interacts**: `mountainPass` x `trafficHalo`, `haloQuality`, `scatter`, `scatterMode`, `people`, `leafyFoliage`, `scene`, `wild`.
- **Seam**: option registry `requires`/`conflicts` fields with a "greyed because: not available on the mountain pass" rule (DESIGN.md), fed by a per-road-type capability list.

## H5. "Is this the pass?" is spelled three ways, which disagree whenever the GPU is off
- **What (OBSERVED)**: `o.mountainPass` (option), `p.touge = mountainPass && V.three` (drive-anim.js:1159), `src.tiles.mountain` / `A.touge` (drive-anim.js:57; drive-touge.js:36). ~90 branch sites (TOUGE.md section 2). Example: `source()` and the route code test `tiles.mountain`, while elevation tests `p.touge`; the cache keys test `!!o.mountainPass` (drive-anim.js:1153) not `p.touge`.
- **Consequence**: CPU fallback draws a flat pass through code written for the elevated one; a branch added with the wrong spelling works on one renderer only.
- **Seam**: road frame: one object `A` with `elevated`, built once; every other test asks `A`.

## H6. The traffic halo silently needs traffic beams and clear-air-off, and nothing tells you
- **What (OBSERVED)**: `haloN(o)` returns 0 unless `o.trafficBeams && sigmaOf(look) > 0 && trafficHalo > 0` (js/drive.js:819). The UI shows the halo selects whenever air is on (spec-ui.js:1027-1033) and does not look at `trafficBeams`. Halo family options `haloBins/haloDiv/haloPolar/haloPolarLamps/haloGain` are likewise inert with `trafficHalo` 0. The `?halobins` URL parameter is overwritten by the stored `haloBins` (default 24 is never null) at the first halo build (drive-three-halo.js:167-168; INFERRED).
- **Interacts**: `trafficHalo`, `trafficBeams`, `visibility`, `haloQuality` bundle (it sets `trafficHalo:16` but not `trafficBeams`, drive.js:917-921).
- **Seam**: option registry `requires` + a bundle that lists its prerequisites ("halo quality medium needs traffic beams").

## H7. The same content is built by two or three different builders
- **What (OBSERVED, OBJECTS.md D1-D16)**: street lamps are hand-built twice with different recipes (drive-anim.js:556-565, drive-touge.js:127-133; the pass copy has no `street` vector, so lamp-road/lamp-class orientation is undefined there); posts/rails are `K.post` in flat and a different recipe on the pass (drive-touge.js:112-114); headlamp emission is set in three places (drive-anim.js:349, spec-ui.js:1078, drive-touge.js:161); deer behaviour is computed in three places; people are built by 8 call sites with 4 different seed/id conventions.
- **Consequence**: a fix or an option (clothing, lamp class, deer behaviour) reaches some builders and not others.
- **Interacts**: `reflectiveClothing`, `streetLamps`, `lampClass`, `lampRoad`, `deerBehaviour`, `detailedModels`, `people`, `posts`.
- **Seam**: scene resolver (one function: content entry + road frame + options -> objects) with the kit as its only constructor.

## H8. The junction pedestrian ignores the clothing option, and clothing colours depend on which path built the walker
- **What (OBSERVED)**: the junction crosser's kit is built with no `reflectiveClothing` and no seed (drive-anim.js:532) and always requests kind `'dark'` (:549); the urban crosser requests `'dark'` (:572); wild-chunk walkers reuse the ids `p0`, `p1`... in every chunk and pass no seed (:630, :640), so every chunk's first walker gets the same colour and strips (INFERRED from `unitOf`, drive-scenes.js:46-51); the minigame draws clothing from the mode but scores `noHiViz` from an RNG bit (drive-game.js:120,145,168), so score and picture can disagree.
- **Interacts**: `reflectiveClothing`, `people`, `seed`, `wild`, `tiles`.
- **Seam**: scene resolver: one `person(entry)` constructor that always receives the resolved clothing mode, seed and a globally unique id.

## H9. The CPU "still" is a different scene from the live one, and the click probe reads it
- **What (OBSERVED)**: `cpuStill` builds with `buildScene`, scene seed 7, and passes only `people/animals/signs/reflectiveClothing/oncoming/preceding` (spec-ui.js:1077); it never sees posts, veg, obstacle, studs, leafy, tiles, wild, traffic logic, lamp road/class, or the pass. The tap/hover probe reads that picture (js/ui.js:1047 -> `ensureCpuStill`, spec-ui.js:1114). `expMode` auto/adapt force the 2.5 s CPU still on every redraw (spec-ui.js:1103), undoing LAZYCPU's ~10 ms option changes (OVERNIGHT-RULES.md, LAZYCPU note).
- **Consequence (INFERRED)**: clicking a point reports luminance and depth of a scene other than the one on screen; on the pass it reports the flat road. Choosing auto exposure silently makes every option change slow again.
- **Seam**: scene resolver feeding BOTH renderers from one description; or a GPU depth/luminance read-back for the probe.

## H10. Test coverage of the options that changed most last night sits outside the curated gate
- **What (OBSERVED, COVERAGE.md)**: the curated gate is 40 tests (18 node + 22 page) of 143 + 96. The halo family, lamp halos, lamp road/class, reflective clothing, scatter detail options, trafficLogic, tiles, seed, wild, `samples`, `simCeiling`, dynamic resolution are covered only by tests outside the curated list. 58 of 74 js files have no `MAP` entry, so editing them runs the full gate; that includes drive-touge.js, drive-touge-three.js, drive-game.js, drive-models.js (tests/gate.js MAP). `--touched` can pick tests that `--full` never runs (e.g. LHS1, LDR1). The one known-failing test, NE-state-leak, is a state leak nobody has explained.
- **Seam**: option registry `tests` and `owner` fields: the MAP and the "options with no gate test" list are generated from it.

## H11. Cache keys are written by hand in 8+ places, with one over-keyed and one known-incomplete
- **What (OBSERVED, RENDER.md section 5)**: `groundKey` (spec-ui.js:1141) is used for the ground cache, the adaptive-exposure key and the auto-exposure key, so any halo/air tweak (even `haloGain`) clears the CPU picture buffer, resizes GL and opens a first-open timeline entry (drive-anim.js:1160-1162). `tableKey` (drive-three.js:105) has no attitude term on the pass. `autoKey` (drive-anim.js:2180) ignores scene-only options (INFERRED stale auto exposure). NE-state-leak documents an order-dependent leak in the table cache (tests/regress/NE-state-leak.js header).
- **Interacts**: all `scatter*`, `halo*`, `wet*`, `fov`, `visibility`, `expMode`.
- **Seam**: option registry `cost` class (free uniform / table rebuild / ground rebuild / scene regenerate): keys are derived from the class instead of hand-listed.

## H12. Two near-limits: flat objects at 15/16 samplers, and uniform rows already hit the 1024 cap once
- **What (INFERRED + one OBSERVED crash)**: flat objects with table + traffic lighting need 15 of 16 samplers. Uniform rows are estimated at 788-864 of 1024 for the worst programs; commit 5f9d514 records "FRAGMENT shader uniforms exceed MAX_FRAGMENT_UNIFORM_VECTORS (1024)" when the lamp-road table took one row per float. `light[64]`, `reflection[64]`, `lightRGB[64]`, `reflectionRGB[64]`, `lightStreet[64]` are 320 rows by themselves.
- **Interacts**: any new lit feature (every new array lands in the shared ground text and so in every program family).
- **Seam**: budget check.

## H13. Fixed-size arrays throw instead of degrading
- **What (OBSERVED, drive-three.js)**: more than 16 route parts (:239), 64 lights or reflections (:273), 128 markings (:230), 16 crossings (:232), more than two own lamps (:219) each `throw`, which the frame handler turns into `gpuFallback` (drive-anim.js:1239). Ordinary flat routes reach 12 parts and a mountain route 19 (reports/TR-touge-r2.md); a denser scene (`density`, `trafficNearest`, street lamps on) moves objects toward 64.
- **Seam**: budget check with per-feature declared caps, and a degrade path (drop the farthest) in place of a throw.

## H14. Options that live outside the declared list
- **What (OBSERVED)**: `wetness`, `deerBehaviour`, `ownLow`, `ownHigh`, `view`, `scatterTableSteps`, `pedStop`, `lampRule` are read from the options object but are not in `DV_DEF`; `airLevel` and `haloQuality` are derived dropdowns that rewrite 10 and 6 other options and read "custom" after a hand edit. `scatterQuality` has no control, `scatterTableSteps` has no writer in js/ (tests only). `wet` is read raw at drive-anim.js:1236 while everything else uses `wetnessOf`.
- **Consequence**: `?reset` cannot restore what is not declared; code must tolerate `undefined`; bundles drift (H1's wetness leak is one instance).
- **Seam**: option registry (every option declared, derived values marked `derived`, bundles list their members).

## H15. Shaders are patched by text replacement, and several caches key on source text
- **What (OBSERVED)**: `withLighting`, `tableSource`, `passShader` patch the ground text with `String.replace` on exact substrings and throw if one is missing (drive-three-shaders.js:284 "P2 shared shading prefix changed"; drive-touge-three.js "BA5 touge pass: traffic loop text changed"). Object material maps pick their mode by searching the material closure's source text for `hivis-tape`, `face === 5`, `win(h, seed)`, `const zc` (drive-three-objects.js:143-150), and the facade comment at drive-scenes.js:288 notes the foliage test encodes function text.
- **Consequence**: an innocent edit to the shared ground text or a renamed variable can break the pass or objects only at first compile of that variant, and tests pin shader text hashes (tests/beam-atlas.js) so they must be re-pinned.
- **Seam**: shader feature chunks that declare their hooks (each feature adds a chunk, uniforms and samplers explicitly); the budget check reads those declarations instead of parsing text.
