# RENDER: passes, programs, sampler and uniform budgets, cache keys, frame-budget machinery

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). Read-only; no browser was run (a gate was running on the machine).
OBSERVED = read at the cited line, or computed by a script over the repo's own shader text. INFERRED = deduced; no GLSL compiler, GPU or browser was involved, so every "sampler" and "uniform vector" number below is a TEXT count, not a measured active count.

Render terms used (first use): a **fragment shader** is the small program the GPU runs for every pixel; a **sampler** is a texture the shader reads (the GPU allows a fixed number per shader, `MAX_TEXTURE_IMAGE_UNITS`, 16 here); a **uniform vector** is one slot of 4 numbers the CPU passes to the shader (limit `MAX_FRAGMENT_UNIFORM_VECTORS`, 1024 here); a **render target** is an off-screen picture; a **pass** is one draw into a target; a **program** is one compiled vertex+fragment pair.

## 1. What one GPU frame does, in order (OBSERVED, drive-anim.js `frame()` 1206-1246, `draw()` 928-963, drive-three.js `render()` 291-314)

1. `airTick()` / `tableStrip()` (drive-anim.js:2331-2358): first-open air deferral. `resolutionPrepare()` (:1009): if the dynamic scale changed, `prepare(layout())` rebuilds sizes.
2. CPU world build: `activate` (:758), `placedObjects`/`tileWorld` (:372, :512) or `Touge.world` (drive-touge.js:105); `glareSources` (:1233).
3. `V.gl.draw(f)` (:928):
   1. `f.groundGPU` = `V.three.render(p, world, dist, T.A.f, T.O.f, ss)` (drive-three.js:291):
      1. `update(p, world, dist)` (:215): uploads every uniform (lamps, lights, markings, traffic, atlas, lamp-road table).
      2. `shading()` chooses the fragment text for ground, ribbon and all objects: `(lit extras, mountain, table, atlas)` (:46-54, :293, :308).
      3. Table pre-pass (air beam table mode only): `runTable` (:134) draws 3 banks (x1 or x8 cached versions) and optional separable blur; paced by `TABLE_BUDGET_MS = 8` ms per frame (table-pace.js:6).
      4. Halo table pass(es) `halo.build` (drive-three-halo.js:162): not on the pass, not on air-hold frames (drive-three.js:295).
      5. Ground pass into `target` (half-float RGBA + depth, p.w x p.h): flat = one full-screen quad `mat`; pass = lamp shadow depth renders (2 x 2048x1024) + ribbon + sky.
      6. Lamp halo sprites `lampHalo.draw` (:299), additive, into the same target.
      6b. Lamp cone (LAMP-CONE-MIST, opt-in) `lampCone.draw`, additive, after the halo; returns before any GL state change unless lampCone is 'on' and visibility is set. Cache: post pass, no key (draws every frame).
      6c. Object-pass cone (LAMP-CONE-OBJECTS, opt-in lampCone): after the objects render into objectTarget (drive-three.js, before the objects blit), `lampCone.drawObjects` adds the same cone to object pixels with alpha >= 0.5, integrated only up to each object's distance (t = depth * 5000, the depth the object shaders write). Writes a new float target that the blit reads; returns before any GL call unless lampCone is 'on' and a cone frame ran. Sky, road and glowing (alpha 0) pixels pass through unchanged.
      7. Blit `target` to texture A of the compose stage (`gl.blitFramebuffer`, :305).
      8. Objects pass: `objectView.update` (drive-three-objects.js:168) then render of instanced objects and mesh cars into `objectTarget` (float RGBA + depth, p.w x ss by p.h x ss) (:307-309); blit (LINEAR if ss > 1) to texture O (:311).
   2. Compose (raw WebGL2, `FS_COMPOSE` :814): A + O + pattern layer array B + asphalt grain -> HDR target.
   3. Glare (only if `glare` > 0): bright pass `FS_BRIGHT` (:842) -> per band `FS_REDUCE` (:849) + two `FS_BLUR` (:856) passes accumulating into `acc`.
   4. Final `FS_FINAL` (:863): exposure `uK`, flip, veil, glare sources (32), to the canvas.
4. Game masks `V.three.masks(...)` (:315) and detector, only in game mode (drive-anim.js:1244).
5. `recordFrame` (:1016): frame times, dynamic-resolution step.

CPU alternative (`gpuRenderer` off or GPU failed): `objects()` (:743) -> `D.render(...)` per 16-px tile rows, optionally on up to 6 workers (`mt`, :1253-1311), upload via `texSubImage2D` (:925), then the same compose/glare/final. Separate CPU still for the click probe: `cpuStill` (spec-ui.js:1072), skipped by LAZYCPU (section 6).

## 2. Program families (OBSERVED from `new T.ShaderMaterial`/raw `FS_*` sites)

| family | where created | fragment text | variants (cache by text in three.js) |
|---|---|---|---|
| ground (flat, full-screen) | drive-three.js:40 `mat` | `ground` (drive-three-shaders.js:8-240) + `withLighting` if `extras` + `tableSource` if table | extras {off,on} x atlas {off,on (only with extras)} x table {off,on} = 6 |
| ribbon (pass terrain) | drive-touge-three.js:58 | ground prefix + `surface()` body + own main, then the same transforms + `passShader` | 6 |
| sky (pass) | drive-touge-three.js:63 | tiny | 1 |
| shadow depth (pass) | drive-touge-three.js:59 | tiny | 1 |
| instanced objects | drive-three-objects.js:163 (one material per material-key bucket, same text) | `objectFragment` or `leafyFragment` + same transforms | (2) x 6 x {flat, pass} = 24 |
| mesh cars | drive-three-models.js:107 | ground prefix + own main | 6 x {flat, pass} |
| table pre-pass | drive-three.js:56 | `tablePassSource(ground)` or lit version | 3 (plain, lit, lit+atlas) |
| table blur | drive-three.js:59 | `tableBlurSource` | 1 |
| halo table pass | drive-three-halo.js:126 | THEAD + legacy/atlas other-beam + screen/polar main | 4 |
| lamp halo sprite | drive-three-lamphalo.js:76 | own, no samplers | 1 |
| lamp cone (mist, opt-in lampCone) | drive-three-lampcone.js (draw after lamp halo, drive-three.js) | own program, no samplers; uniforms: 8 lamps x (vec3 pos, vec2 street, vec3 tint, float scale), 120 vec4 table, ~6 scalars (text count, INFERRED, not run through the scripts) | 1 |
| lamp cone, object pass (LAMP-CONE-OBJECTS) | drive-three-lampcone.js `drawObjects`, called from the objects block of drive-three.js | OWN program (FRAG_OBJ, built from the ground cone source). Adds 2 samplers (`uObj` objectTarget colour, `uDepth` objectTarget depth) to that program only. The object program (drive-three-objects.js) is NOT changed: its 15-18 sampler and 794-864 row counts stay as above. Uniform rows (upper bound, not compiler-measured): 8 lamps x (vec3 pos, vec2 street, vec3 tint, float scale) + coneTab4 vec4[120] + about 10 scalars (objCap, reach, gain, sigma...) = about 150. Cache keys: none added (no frame cache; table cache keyed by class/kind; gain and reach are uniforms). |
| compose / bright / reduce / blur / final | drive-anim.js:814-870 (raw GL, `P.*`) | `FS_*` | 5 |

`renderer.info.programs.length` is exposed as `programCount()` (drive-three.js:286) and used by the first-open timeline (drive-anim.js:2375). The mounting of variants is the "state leak" surface described in section 5: `shading()` keeps its own cache flags on each material (`userData.p2/tg/tbl/at`, drive-three.js:49).

## 3. Who owns each sampler (OBSERVED declarations; method in section 4)

| sampler | declared in | feature that owns it | always compiled in? |
|---|---|---|---|
| `beam` | ground prefix (drive-three-shaders.js:11) | our low/high beam LUT | yes |
| `materials`, `marks` | ground prefix | material table, marking table | yes (`marks` is declared but unreachable in objects/mesh cars) |
| `otherBeam` | `withLighting` (:283+) | traffic beams / oncoming beam table, or the BA5 atlas | only in `extras` variants (trafficBeams, lampPitch, afs, corneringLamps, yaw, pitch) |
| `haloTex`, `haloPolarTex`, `haloPolarTex2` | ground prefix (:43,46,80) | traffic halo table, polar table, second polar table | **yes, in every program built from the ground prefix, whether or not `trafficHalo` is on** |
| `scatBank0..2` | `TABLE_DECL` (:311) | air beam table mode, current version | in table variants (`scatMode` on) |
| `scatBankB0..2` | `TABLE_DECL` (:332) | air beam table cycle blend (`scatterCycleFade`) | in table variants, **even with the fade off** |
| `passDepth`, `passShadow0`, `passShadow1` | `passShader` (drive-touge-three.js:4) | mountain pass terrain depth and lamp shadows | pass variants |
| `materialMap` (sampler2DArray), `sdfNodes`, `treeCard` | objectFragment (drive-three-objects.js:14-16, drive-models-glsl.js:4-5) | per-object material maps, SDF actors, tree cards | objects only |
| `bodyMap` | drive-three-models.js:16 | mesh car body map | mesh cars only |
| `otherBeam` (halo pass) | drive-three-halo.js:48 | halo | halo pass |
| `src`, `uTex`, `uA`, `uO`, `uB`, `uT`, `uHdr`, `uGlare` | blur / compose / bright / reduce / final | post-processing | each 1-3 |

## 4. Sampler and uniform-vector counts per program (script, INFERRED)

Method (reproducible): `docs/inventory/scripts/reach.mjs`. It loads the repo's own shader strings (`ground`, `withLighting`, `tableSource`, `passShader`, `objectFragment` imported from js/), assembles each variant exactly as `shading()` does, strips comments, splits top-level GLSL functions by brace matching, walks the call graph from `main`, and counts `uniform sampler*` names that are (a) declared, (b) mentioned outside their declaration ("textual"), (c) mentioned in code reachable from `main` ("reachable"). A real GLSL compiler counts what it keeps active, which is at most "textual" and most likely close to "reachable" (it drops dead functions); neither was measured. All of these are ShaderMaterial (three.js prepends its own matrix and camera uniforms, which add no samplers for these shaders; OBSERVED by the material constructors) and there are no `#if` guards (grep: 0 in all shader files), so a variant is whatever text the string replacements produce.

Counts (declared / textual / reachable); limit 16:

| program | plain | lit (+atlas same) | plain + table | lit + table (+atlas same) |
|---|---|---|---|---|
| FLAT ground | 6 / 6 / 6 | 7 / 7 / 7 | 12 / 12 / 12 | 13 / 13 / 13 |
| TOUGE ribbon | 9 / 8 / 5 | 10 / 9 / 6 | 15 / 14 / 5 | 16 / 15 / 6 |
| FLAT objects | 9 / 8 / 8 | 10 / 9 / 9 | 15 / 14 / 14 | 16 / 15 / **15** |
| TOUGE objects | 12 / 11 / 11 | 13 / 12 / 12 | 18 / 17 / **17** (measured on the GPU, ANGLE Metal, 2026-10-23: link failure) | 19 / 18 / **18** (measured: link failure) |
| TOUGE objects after TOUGE-AIR (`tableSource(src, false)`: no `scatBankB0..2`) | | | 15 / 14 / 14 | 16 / 15 / **15** (measured: links) |
| FLAT mesh car | 7 / 5 / 5 | 8 / 6 / 6 | 13 / 11 / 11 | 14 / 12 / 12 |
| TOUGE mesh car | 10 / 8 / 8 | 11 / 9 / 9 | 16 / 14 / 14 | 17 / 15 / **15** (measured 15; 12 after TOUGE-AIR) |
| table pass | 6 / 5 / - | 7 / 6 / - | - | - |
| halo pass | 1-2 | | | |

(Mesh car rows use the real fragment template sliced out of js/drive-three-models.js by the script. `bodyMap` is declared there but never read, so it does not count as reachable; `marks` is unreachable in objects and mesh cars. Mesh cars on the pass with table + lighting sit at 15 reachable: one under the limit.)

Reading the table (INFERRED):
- **TOUGE-AIR (measured 2026-10-23, real GPU): the failing program IS the pass instanced-object program with the table (18 active: passDepth, passShadow0, passShadow1, beam, materials, otherBeam, haloTex, haloPolarTex, haloPolarTex2, scatBank0-2, scatBankB0-2, materialMap, sdfNodes, treeCard; `marks` dropped by the compiler). The pass programs now compile the table without the B bank set: 15.** The probe counts samplers kept in ANGLE's translated (Metal) source via `WEBGL_debug_shaders`; it agrees with this table's reachable column in every program but the mesh car (reachable 15, measured 15) and the ribbon (6-9 measured, the passDepth name drops out of the table-mode ribbon).
- **On the pass, instanced objects with the air beam in table mode need 17-18 samplers: over 16.** Without the table they need 11-12. This is the first program to overflow with the air beam, not the ribbon. The ribbon's main never reads the table banks or the halo textures, so it needs 5-6 on main.
- A ribbon variant that called both `inScatter` (table) and `haloScatter` would need 6 + 3 halo + 6 table = 15 reachable (declared 16): one sampler from the limit. Checked with `git show` (no checkout): BOTH touge-halo branches (exp/touge-halo and feat/touge-halo-elev) add only `haloScatter` to the ribbon main (drive-touge-three.js:51 on each), so on them the ribbon needs 9, not 15. If the owner's crash was on one of those branches or on main, the program over the limit is the instanced-object program (17-18) and not the ribbon.
- The flat objects program with table + traffic lighting is at 15 of 16: one more sampler anywhere in `withLighting`, the table or the ground prefix breaks FLAT too.
- Always-compiled-in samplers that exist for features that may be off: the three halo textures (every ground-prefix program), the three `scatBankB*` fade banks (every table program). Folding the six `scatBank*` into one `sampler2DArray` (as `materialMap` already is) or compiling the B banks only when `scatterCycleFade` is on would give 5 back to every table program.
- Feature cost in samplers (differences in the table above): lit extras +1 (`otherBeam`); table +6; halo +3 (always); pass +3; objects +3; mesh car +1.

Uniform vectors (limit 1024, **observed to be hit once**: commit 5f9d514 "P2-drive-lighting crashed: FRAGMENT shader uniforms exceed MAX_FRAGMENT_UNIFORM_VECTORS (1024). The 475-float lampDistTab took one slot per float"). The script's estimate counts one slot per declared name (an upper bound, since scalars pack) and n slots per array element:

| program | estimated rows |
|---|---|
| FLAT ground plain | 584 |
| FLAT ground lit + atlas + table | 788 |
| TOUGE ribbon lit + atlas + table | 858 |
| FLAT objects lit + atlas + table | 794 |
| TOUGE objects lit + atlas + table | 864 |

Check of the method: undoing the packing fix (lampDistTab4[120] -> 475 slots) gives 788 - 120 + 475 = 1143 > 1024 for the flat lit program, consistent with the recorded crash. Headroom in the worst program is about 160 rows (INFERRED, upper-bound rows).

Where the rows are (arrays, element x vector slots): `light[64]` + `lightRGB[64]` + `reflection[64]` + `reflectionRGB[64]` + `lightStreet[64]` = 320 (street lamps, lit surfaces, signs, studs); `lampDistTab4[120]` (lampRoad); `part[16]` + `partShape[16]` (flat route parts); `trafficDir[64]` + `trafficLamp[64]` (traffic beams, 32 cars x 2 lamps); `beamMeta/beamGrid/beamTint/trafficBeamIdx[16]` = 64 (atlas); `trafficPitch[64]` (pass only); `haloE[32]`; `crossing[16]`, `skip[16]`, `lamp[2]`.

Array caps that THROW (OBSERVED, drive-three.js): `more than two own lamps` (:219), `too many ground markings` > 128 (:229), `too many marking openings` > 16 (:230), `too many crossings` > 16 (:232), `too many route parts` > 16 (:239), `too many light/reflection sources` > 64 (:273). These are exceptions in the frame path (the frame falls back to CPU via `gpuFallback`, drive-anim.js:1239). Ordinary flat routes reach 12 route parts, a mountain route 19 (reports/TR-touge-r2.md).

## 5. Cache keys, and what feeds them (the "state leak" class)

A leak here means: an option changes what a cached thing should contain, the option is not in the key, and the old content is reused. Diff method: for each key, list the fields in the key and the fields its cached product reads. "Gap" is stated only where the code shows one.

| key (location) | guards | fields in the key | fields the product reads that are NOT in the key | verdict |
|---|---|---|---|---|
| `prepare.key` -> `V.gkey` (drive-anim.js:1151, 1160) | `V.g` (CPU ground / placeholder), `V.rgba`, GL resize | `I.groundKey`, W, H, simCeiling, cline&us, tiles, `!!V.three`, trafficBeams, lightRange, lightCars, surfaceSheen, lampPitch, afs, corneringLamps, lampRGB, `V.high`, ownLow, ownHigh, lamp tint, trafficPool.key | `o.tex` (via `look.grain`) | no gap found: `V.g` is a placeholder whenever `V.three`, wet-sheen, tiles or lighting extras are on (:1161), the only cases where grain is read |
| `groundKey` (spec-ui.js:1141) | doubles as the "invalidate everything" key (also the adapt key and the auto-exposure key) | lane, US/EU preset, scene, wetness, wetSheen, wetModel, visibility, scatter..., all halo fields, all scatter fields, RL, ambient, smooth, fov, shape, mirrored | - | **over-keyed**: any halo/air change (even `haloGain`, `scatterGain`) clears `V.rgba`, calls `V.gl.resize/setGround` and opens a first-open timeline entry (:1160-1162) (INFERRED: nothing in the GPU path needs that rebuild) |
| `skey` / `tkey` (drive-anim.js:1153) | `V.act` (actor clocks) and `V.src` (scene source) | scene, lane, us, people, animals, signs, reflectiveClothing, posts, veg, obstacle, rpm, wild, seed, density, cline, tiles, mountainPass, leafyFoliage (skey) + oncoming, preceding, onKcd, onMode, trafficDensity, trafficRange, safeGap, trafficLogic, tileCache, [streetLamps, tex, wetness] for tiles (tkey) | `speed` (written every frame, :1219: harmless), `lampRule`, `pedStop`, `scenery`, `flags` (never set from options) | no gap found against `srcArgs` (:1154); note `deerBehaviour` and `detailedModels` are applied later and are correctly outside |
| `fkey` (:1155) | oncoming-driver flash counter | scene, seed, trafficDensity, trafficLogic | oncoming/preceding (not in the key: toggling traffic keeps the old count) | cosmetic |
| `cpuStill key` (spec-ui.js:1074) | the CPU picture `rd.drive` | lane, scene, wetnessOf, wetSheen, wetModel, visibility, scatter..., halo..., onMode(+seed), people, animals, signs, reflectiveClothing, oncoming+[onDist,onKcd], preceding+preDist, RL, ambient, smooth, res, fov, shape, lamp tint | `dm.preset` (US/EU), `beamG.conv`, the beam LUT itself; these ride on `rd` identity (INFERRED: `rd.drive` lives on `rd`, recreated with the design) | key also holds many fields `D.render` does not read (scatterCache, scatterCycle...): over-keyed, harmless. **The still never reads lampRoad/lampClass/posts/veg/rpm/tiles/leafy** (section 7 of OBJECTS.md) |
| `tmKey` (spec-ui.js:1083) | tone map of the CPU still | expMode, ev, glare | - | complete |
| adapt key (drive-anim.js:1186) | smoothed exposure | groundKey, ev, glare, expMode | scene-only options (people, density...) | by design: no snap |
| `autoKey` (:2180) | frozen auto exposure `V.kAuto` taken from the still's tone map | groundKey, ev | scene-only options (posts, veg, density, trafficDensity...) | INFERRED gap: auto exposure freezes at the first still and is not refreshed when only those change |
| `tableKey` (drive-three.js:105-109) | cached air-beam table versions | lamp positions (quantised), yaw, pitch, corner L/R, afs, lampPitch, corneringLamps, LUT identity, lamp tint, visibility, hfov, w, h, eye, conv, scatter, scatterTableSteps, scatterRes, scatterBlur, extras, table size, blur sigma, near-fade name, nearBias>0, binCounts text, quality | **attitude / `worldFromCar` (pass)**, `trafficLamp` positions if the table includes traffic light (it uses `extras` for the compile variant only: INFERRED no traffic term) | known gap on the pass; excludes `scatterGain` and `scatterCycleFade` on purpose |
| `tabSize.key` (:138) | table render targets | tw x th | - | complete |
| `shading()` flags `p2/tg/tbl/at` (:49) | which fragment text each material holds | lit extras, mountain, table, atlas | - | complete; but `atlasOn` is read as a module variable set earlier in `update()` (:253): order-dependent by construction |
| halo `rts` key (drive-three-halo.js:~148) | halo render targets | tw x th x HALO_N | - | complete (bin count change reallocates) |
| `atlasKey` (drive-three.js:207) | packed traffic beam atlas | pool.key, weights, entry conventions | - | complete |
| `maps` key (drive-three-objects.js:143) | per-object material maps | material function SOURCE TEXT (`hivis-tape`, `face === 5`, `win(h, seed)`, `const zc` substrings) or the material name | any change of those closures' text | **text-matching key**: renaming a variable in a facade or vest closure silently changes the cache bucket or material mode |
| `rd.animLut.k` (spec-ui.js:1140) | beam LUT for the live view | `o.smooth` | the design | design changes recreate `rd` |
| `ui.dvPending` (spec-ui.js:877-886) | debounced `scatterRes` / `scatterCycle` | pending value read through `ov(k)` (:1011) | the renderer reads `dvOpts` only: the label shows the pending value before it applies | by design (500 ms) |

Observed leak: **NE-state-leak** (tests/regress/NE-state-leak.js, the only entry in `KNOWN_FAILING`, gate.js): a table-off frame taken after a particular order of table settings (cache on cycle 8, bin text valid/invalid/empty, all five quality presets, quarter res, quality steps) is not byte-equal to the first table-off frame (hash 60195c37 instead of c033bd7c). Each step alone from a fresh page returns to c033bd7c; the cause is "not explained" per the test's own header. Candidates in the code that survive across settings (INFERRED, not tested): `slots`/`slotValid`/`fillIdx` kept when `cache` flips (`tabKey` is only compared in the cache branch, drive-three.js:155,159), `cyc` phase state (:76), `tabStats` globals, `compilePending`.

Mixed readers of one setting (the class behind many leaks): wetness is read as `D.wetnessOf(o)` almost everywhere but as raw `o.wet` at drive-anim.js:1236 (texture amplitude), and `look.wet`/`look.wetness` both exist in V.p.look (:1159). `scatterQuality` has no control (written only by the air-level bundle) yet is in four keys.

## 6. Frame-budget machinery (OBSERVED)

| mechanism | where | rule |
|---|---|---|
| Sim size ceiling `simCeiling` | drive-anim.js:976-988 | W = min(ceiling, canvas css width x dpr), floor 640 (MIN_SIM), even; ceilings low 640 / medium 960 / high 1600 / ultra 2560 / native 3840 |
| Dynamic resolution | :989-1014, :1030 | scales [1, .85, .7, .55, .4, .3]; slow (avg > 1.15 x target) 6 frames -> step down, fast (avg < 0.7 x target) 60 frames -> step up; 20-frame cooldown; a step-down within 30 s of a step-up doubles the hold before the next step-up (30..240 s). Disabled by `V.pinSS` or `dynamicResolution` off. Target = `frameTargetMs` = 1000 / `minFps` |
| Supersampling `samples` | :1198-1204 | '1' | '2' | 'auto' (2 up to 1100 px, then 1); `adaptSS(t1 - t0)` (:1230): smoothed ms > 18 -> ss 1, < 8 for 20 frames -> back to 2. It runs on the GPU path too (ss sizes `objectTarget`, drive-three.js:307) but there `t1 - t0` is only the CPU-side frame prep, since the object trace is skipped (`V.three ? [0, h]`, :1227) |
| Air hold (SN) | :2330-2340 | when `V.three` and (table mode or `trafficHalo`): the first `AIR_HOLD_FRAMES = 2` frames draw with the air off so the first paint happens before the air shaders compile; while holding, paused views request their own frames. Not pass-aware |
| Table pacing (SE) | drive-three.js:150-176; table-pace.js | with cache on, a table version fills in horizontal bands into a spare bank; band rows = floor(8 ms / measured ms-per-row), first band 8 rows; completed spare swaps into its slot; empty slot -> scatter term 0 |
| Table cycle | drive-three.js:77-83, 186-195 | 8 versions, phase advances with distance travelled (`cyclePhase`), optional blend of two neighbours |
| LAZYCPU | spec-ui.js:1067-1123 | `skipStill(ui, o)` = `!forceCpuStill && expMode == 'fixed' && gpuRenderer && !popout`: the 2.5 s CPU picture is not rendered while the GPU view shows; `lazyStill(o)` stands in; `ensureCpuStill(ui)` renders on demand for the click probe; `RF.SpecUI.forceCpuStill = true` renders it every redraw (tests that compare CPU pictures). `expMode` auto/adapt turn it back on |
| GPU failure | drive-anim.js:2134-2143 | on shader/context failure: dispose three, set `V.gpuFailure`, pause the sim if it was playing (CPU-FALLBACK-PAUSE), notice. Retries at most 3 times (`gpuCreate` :2144) |
| Context lost/restored | :1122-1146 | stop, then rebuild; `renderers` WeakMap keeps one three renderer per GL context (drive-three.js:15-23) |
| Worker pool | :1253-1311 | min(6, cores - 2) CPU trace workers; off whenever `V.three` or any of 7 options (mt() :1264) |
| First-open timeline | :2359-2412 | marks when programs are created and when the table recomputes; closes after `TL_GRACE_MS` |
| Frame ring / FPS badge | :1016-1037 | last 120 intervals; gaps above `FRAME_GAP_CAP_MS` dropped; paused views record nothing |

## 7. What would let a feature declare its budget (facts for DESIGN.md)

Per feature the following are already knowable from the text: samplers added (section 3), uniform rows added (section 4), shader variant flags it flips (`extras`, `table`, `atlas`, `mountain`), cache keys it must join (section 5), and its GPU cost note. A render feature registry could assert at load time (in Node, with the script of section 4) that every variant stays <= 16 samplers and <= 1024 rows. The script already runs in Node from the repo's own strings, so this check does not need a browser.
