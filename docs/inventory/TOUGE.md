# TOUGE: everything the mountain pass does differently, and what a flat road would need to share the code

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). Read-only; no browser run.
OBSERVED = read at the cited line (or computed by a command). INFERRED = deduced, not run. Prior reports (reports/TOUGE-survey.md, TOUGE-ELEV-A.md, TOUGE-ELEV-B.md, TOUGE-halo-experiment.md, TG-touge-proto.md, TR-touge-r2.md) were read and their line numbers re-checked against main f52ed8a; where main differs from a report it is said.

State of main relative to those reports (OBSERVED): TOUGE-ELEV-A (road-relative tail-lamp z) IS on main (drive.js:656-657). TOUGE-ELEV-B and TOUGE-halo-experiment (halo on the pass) are NOT on main: drive-three.js:295 still reads `if (!p.touge && !p.airHold) halo.build(p, world); else u.haloOn.value = 0;`.

## 1. "Is this the pass?" has three spellings

| spelling | meaning | defined | examples |
|---|---|---|---|
| `o.mountainPass` | the saved option; true even when the GPU is off | DV_DEF js/spec-ui.js:840; set by the scene select (spec-ui.js:921) | source() drive-anim.js:33,35,57; supported() :1048; mt() :1264; street-lamp button :1881; sync notices :2182-2183; game options :1929; skey/tkey :1153-1154 |
| `p.touge` | the pass AS RENDERED = `mountainPass && V.three` (needs the GPU renderer) | drive-anim.js:1159 | drive-three.js:234,243,265,295,298,308; drive-three-objects.js:171,172,206,211,217; drive-anim.js:375,1167,1168,1233,1824; drive-game.js:113,207; drive.js:656-657 |
| `src.tiles.mountain` / `A.touge` | the scene SOURCE is the pass route; `A.touge` is the per-route "elevated" flag = `!!p.touge` passed to `Touge.route(dist, lane, elevated)` (drive-touge.js:34-36) | drive-anim.js:57 (`mountain: !!o.mountainPass`); drive-touge.js:36 | traffic and camera logic drive-anim.js:67,104,111,163,171,179,194,211,221,243,290,300,313,484,513,759,1368,1794,1832; drive-game.js:107,138,184,197; lift() drive-touge.js:68; hazards drive-anim.js:1942,1944 |

Consequence (OBSERVED from the above): with the GPU off, `mountainPass` is true and `src.tiles.mountain` is true but `p.touge` is false, so `Touge.world` builds the pass objects with `elevated = false` (A.height = 0, drive-touge.js:37) and the CPU path draws a FLAT pass. The code announces this at drive-anim.js:2182 ("CPU fallback stays flat"). A branch that tests the wrong spelling behaves differently on CPU and GPU (e.g. drive-anim.js:386 uses `src.tiles.mountain` to choose the route and `!!p.touge` for elevation in the same expression).

## 2. Every pass branch, what it skips or replaces

### 2.1 Render path (GPU)

| file:line | spelling | what happens on the pass |
|---|---|---|
| drive-three.js:234 | `!p.touge` | flat route-part uniforms (`part[16]`, `partShape[16]`) are NOT uploaded (the analytic ground that reads them is not drawn) |
| drive-three.js:243-247 | `p.touge` | uploads `worldFromCar`/`carFromWorld` from `Touge.attitude(dist)` and rotates eye and lamp uniforms into the car frame; flat resets `carFromWorld` to identity |
| drive-three.js:265 | `p.touge` | per-traffic-lamp pitch `trafficPitch[i]` from the surface grade |
| drive-three.js:293 | always | `shading(pass.material, extras, true, tableOn)`: the ribbon material gets `passShader()` text patches (3 extra samplers) |
| drive-three.js:324 (`blendOn = !p.touge`) | TOUGE-AIR | the table's cycle-blend bank set (`scatBankB0..2`, `scatFade`, `scatFract`) is left out of every pass program (`shading(..., blend)` -> `tableSource(source, blend)`), and `runTable` never picks a blend slot on a touge frame. Pass object program with the table: 18 -> 15 active samplers (was a link failure, the GPU frame fell back to the flat CPU pass). The cycle blend (`scatterCycleFade`) is therefore ignored on the pass; the control stays enabled (HAZARDS H4). The table pre-pass is now built from the car-frame eye and lamps (TOUGE-AIR-RIBBON, next rows) |
| drive-three.js:297 | `!p.airHold` | traffic halo is built on the pass too (TOUGE-ELEV-B2, TILT); `haloOn = 0` only on air-hold frames (SN). Was `!p.touge` before 0fed388 |
| drive-three.js:298 | `p.touge` | the full-screen analytic ground `scene` is replaced by `pass.update(world.A,dist); pass.shadows(renderer); pass.scene`: a 191 x 11 ribbon mesh (2 m stations, -35 m to ~+347 m; drive-touge-three.js:75) plus a sky quad, and two 2048x1024 depth renders from the lamps (shadows) |
| drive-three.js:299 | any | lamp-halo sprite pass `lampHalo.draw(p, world, target)` runs on the pass too (INFERRED: no `touge` test in drive-three-lamphalo.js; its projection uses the flat camera maths, so placement on grades is unverified) |
| drive-three.js:308 | `!!p.touge` | every object material is re-shaded with `mountain = true` (passShader: +3 samplers, rotated frames, depth compare) |
| drive-three-objects.js:171 | `p.touge && p.detailedModels` | only the mesh-car swap runs; deer/people/trees stay as the pass world made them |
| drive-three-objects.js:172, 211 | `!p.touge` | detailed trees, impostor cards, leafy foliage are skipped on the pass |
| drive-three-objects.js:206 | `p.touge` | culling bounds computed in the car frame (`carFromWorld`) |
| drive-three-objects.js:217 | `p.touge` | `aTie` carries surface gradient (`passSlope`) instead of box tie ranks |
| drive-touge-three.js (whole file) | - | ribbon fragment = ground prefix + `surface()` body + its OWN `main()`; that main calls `haloScatter` (drive-touge-three.js:51, TOUGE-ELEV-B2) and **no `inScatter(...)`** (compare drive-three-shaders.js:231-232 in the flat main). The sky quad (drive-touge-three.js:64, TOUGE-SKY-VEIL) uses the ground prefix and calls `haloScatter(1e20)` when `haloOn` (120 m saturation, reads only `gl_FragCoord`) |

Direct consequence (OBSERVED by reading; the render itself was not run): on the pass the air beam (direct or table) and the traffic halo are never added to the ground, only to objects (objectFragment drive-three-objects.js:115-116, mesh cars drive-three-models.js:27-28). In table mode the table is built (cost) for the benefit of objects only.

### 2.2 Scene source, route, traffic (CPU logic shared by both renderers)

| file:line | spelling | what happens |
|---|---|---|
| drive-anim.js:33 | `opts.mountainPass` | `source()` forces `tiles: true, wild: false` and `name = 'road'`: the `scene` option is overridden, `wild` ignored |
| drive-anim.js:35 | `!opts.mountainPass` | leafy foliage never on the pass |
| drive-anim.js:57 | `mountain:` | `src.tiles.mountain` set; `groundCache`, lamps, `density`, `flags` copied |
| drive-anim.js:67 | `tiles.mountain` | traffic always uses logic cars (`logicCars`) even with `trafficLogic` off |
| drive-anim.js:104, 211, 221 | `tiles.mountain` | speed limits and approach acceleration from the bend recipe (`curveEnvelope`) |
| drive-anim.js:111, 243 | `!tiles \|\| mountain` | junction/signal lookups return null (the pass has no junctions) |
| drive-anim.js:163-194 | via `RF.Touge.tile` | curvature sections use the pass tile recipe, not `roadTile(seed, k)` |
| drive-anim.js:290, 300, 313 | `tiles.mountain` | oncoming (dir < 0) advance along the lane, camera always runs the logic model |
| drive-anim.js:375 | `p.touge && p.A.touge` | eye illuminance by `Touge.eyeLux` (line of sight over crests) |
| drive-anim.js:386 | `src.tiles.mountain`, `!!p.touge` | route from `Touge.route(dist, lane, !!p.touge)` |
| drive-anim.js:484 | `tc.mountain` | pedestrian-stop logic off |
| drive-anim.js:513 | `tiles.mountain` | tileWorld returns `RF.Touge.world(...)`: the whole flat tile builder (junctions, crosser, lamps) is bypassed |
| drive-anim.js:759 | `tiles.mountain` | `activate` uses `Touge.activate` (crest-deer clocks) |
| drive-anim.js:1167-1168 | `p.touge` | frameSources: `Touge.world` + `Touge.glareSources` (line-of-sight aware) instead of `D.glareSources` |
| drive-anim.js:1233 | `V.p.touge` | same for the drawn frame |
| drive-anim.js:1264 | `o.mountainPass` | CPU worker threads off |
| drive-anim.js:1368 | `tiles.mountain` | camera uses the logic path (speed follows bends) even with trafficLogic off |
| drive-anim.js:1794, 1809 | mountain | tile label shows grade; speed label shows actual |
| drive-anim.js:1824, 1826, 1832 | `p.touge`, `tiles.mountain` | Auto high beam sensor uses `Touge.world`/`Touge.blocked`; no urban input |
| drive-anim.js:1881 | `o.tiles \|\| o.mountainPass` | street-lamp select enabled on the pass |
| drive-anim.js:1898, 1929, 1942, 1944 | mountain / `A.touge` | minigame: pass hazard objects use `Models.actors(moved,true)` + `Touge.lift` |
| drive-anim.js:2182-2183 | `o.mountainPass` | notices ("CPU fallback stays flat" / proto pill) |
| drive-anim.js:2217, 2237, 2294 | `p.touge` | scene-details/readouts: grade %, bank %, attitude |
| drive-anim.js:1153-1154, 1159 | option + `V.three` | skey/tkey include `!!o.mountainPass` (not `p.touge`); `touge:` field of V.p |
| drive.js:656-657 | `p.touge` | tail-only lamp source z = 0.68 + road height (TOUGE-ELEV-A) |
| drive-game.js:107,113,127,138,167,184,187,197,207 | mountain / `p.touge` | hazard placement on pass tiles; braking uses grade (:207) |
| drive-models.js:142,160 | comment refs | eye lift for deer on terrain; mesh car basis |
| drive-three-models.js:91 | comment ref | mesh-car lamp mount classification |
| spec-ui.js:921, 1014 | option | scene `<select>` value `'__pass'` maps to `mountainPass` (not a scene id) |
| drive-worker.js:6 | file list | the worker loads drive-touge.js so the CPU path can build the pass |

### 2.3 What the pass skips or replaces, by feature (the question "halo, air beam, click probe, AFS...")

| feature | on the pass | evidence |
|---|---|---|
| traffic halo (`trafficHalo`, haloQuality...) | ON on feat/touge-halo-tilt (TOUGE-ELEV B1/B2, not on main). TILT (TOUGE-HALO-TILT): each source's axis is its own world beam (cos/sin of its trafficPitch, drive-three.js:265 formula) rotated by our carFromWorld, elevation kept as hDir.z (drive-three-halo.js toCarFrame, TMAIN `local`). Off-tilt A/B hook: globalThis.HALO_TILT_OFF. Main reads drive-three.js:297 `if (!p.airHold)` (halo on the pass since 0fed388), and the sky quad gets the same veil (TOUGE-SKY-VEIL) | drive-three-halo.js:126-140; drive-three.js:295 (main); tests/regress/TOUGE-HALO-TILT.js |
| air beam, direct (`scatter` > 0, direct) | drawn on the ground ribbon and on objects. TOUGE-AIR-RIBBON: the ribbon main calls `inScatter(-v, t, scatterJitter())` after the fog blend and before `haloScatter`, as the flat ground main does; the beam pattern is the car-frame lookup patched by `passShader` (`intensity`: `d=carFromWorld*d`). Direct on the pass is therefore no longer equal to main (the road is lit); air off still is | drive-touge-three.js surface() main; tests/regress/TOUGE-AIR-RIBBON.js |
| air beam, table | TOUGE-AIR-RIBBON: the ribbon reads the table at the surface distance `t` (same call as direct, `tableCMix`), and the table pre-pass is built from the CAR-frame eye and lamps: `render()` swaps the unrotated `p.eye` / `p.lamps` into `u.eye` / `u.lamp` for `runTable` only and restores the rotated world-aligned copies afterwards (the table's level car-frame ray and `beamI` lookup then share one frame, no `passShader` patch needed). OBSERVED A/B (real GPU, near fade off, display space): table/direct air contribution ratio and relative L1 on the pass at d=750 / 1100 (pitch -5.7 deg) / 600 = 0.946 / 0.255, 0.953 / 0.262, 0.939 / 0.256, against 0.949 / 0.265 on a flat pose (the integral-only baseline); with the old basis 0.794 / 0.713, 1.071 / 0.754, 0.719 / 0.701. `tableKey` carries the attitude (pitch, roll). The table has a near-eye fade (`scatterNearFadeRange`, default on) that direct does not: with it on table/direct is about 0.58 on flat AND on the pass (design, not a frame error) | tests/regress/TOUGE-AIR-RIBBON.js; drive-three.js render() |
| click probe / hover readout | reads the CPU flat still (`ensureCpuStill`, ui.js:1047; spec-ui.js:1077): on the pass it reports a flat road scene | OBSERVED code path; INFERRED wrong numbers (reports/TOUGE-survey.md item 3) |
| AFS / cornering lamps | plan-view curvature only (`curvatureAt` uses tile curvature); grade and bank not in the lighting path | drive-anim.js:155-160,659-675; survey item 5 |
| traffic beams (`trafficBeams`) | on; direct beam sources are road-relative since ELEV-A; `trafficLamp` uniforms set from world coordinates without `carFromWorld` (INFERRED possible frame mismatch, reports/TOUGE-ELEV-B.md "Not verified") | drive-three.js:267 |
| lamp halos (`lampHalos`) | sprite pass runs (above); no `street` vector on pass lamps | drive-touge.js:132 lacks `street` |
| `lampRoad`/`lampClass` | pass lamps carry no `street` vector (INFERRED: orientation of the distribution undefined) | drive-touge.js:132 vs drive-anim.js:563 |
| people | none, ever | drive-scenes.js:176; no person call in drive-touge.js |
| leafy foliage, detailed trees, tree impostors | skipped | drive-three-objects.js:172,211; drive-anim.js:35 |
| junctions, signals, crossers, side roads | none | `isJunction` checks return null on mountain |
| scenes (`road/forest/city`), `wild`, `density`(partly) | `scene` forced to road, `wild` forced off; `density` still sets tree spacing (drive-touge.js:116) | drive-anim.js:33 |
| CPU renderer | flat pass, explicit notice | drive-anim.js:2182 |
| worker threads (`mt`) | off | drive-anim.js:1264 |
| first-open timeline | no pass compile marks; passShader variants and the shadow passes are not covered by the hold | survey item 6 |
| gate mapping | `js/drive-touge-three.js` is mapped (TOUGE-ELEV-B, TOUGE-SKY-VEIL); `js/drive-touge.js` still has NO entry in tests/gate.js MAP (OBSERVED: MAP regexes cover `drive-three(-objects\|-models)?`, `drive-three-.*`, not `drive-touge*`), so any commit touching them makes `--touched` fall back to the full gate (reports/TOUGE-ELEV-B.md fixed this on its branch only) | tests/gate.js MAP |

## 3. The road-frame interface the pass uses (OBSERVED)

A route object `A` (drive-touge.js:34-45, built on `RF.DriveAnim.tileRoute(0, dist, false, tile)`, drive-anim.js:413-453):

| member | provided by | used by |
|---|---|---|
| `A.at(s, off)` -> `{p:[x,y], t:[tx,ty]}` | tileRoute (flat) | everything that places an object; `K.at` in the kit (drive-scenes.js:54) |
| `A.frame(x, y)` -> `{s, off, t}` | tileRoute (flat) | inverse map used by lift(), blocked(), halo/lamp maths |
| `A.tiles` | tileRoute | route-part uniforms (flat only, drive-three.js:234) |
| `A.height(s, off)` | pass only (drive-touge.js:37) | lift(), lights z, ribbon geometry, shadows |
| `A.surface(s, off, height)` -> `{p:[x,y,z], t:[tx,ty,g], normal, grade, bank}` | pass only (:38-43) | ribbon, mesh-car basis, traffic pitch, trafficLight |
| `A.touge`, `A.dist`, `A.lane` | pass only (:36) | lift() early-out, frame sources, eyeLux |
| `Touge.attitude(dist)` -> `{pitch, roll, forward, left, up}` | pass only (:47-51) | `worldFromCar`/`carFromWorld`, glare sources, trafficLight |
| `Touge.lift(ob, A, root)` | pass only (:67-79) | every pass object is raised onto the surface once (`tougePlaced`) |
| `Touge.world / route / glareSources / eyeLux / blocked / activate / tile / profile / bank / terrain` | drive-touge.js:193 | see section 2 |

## 4. What a flat road needs so the same code serves both (design facts, not a proposal)

1. A flat `A` must expose the pass-only members as identities: `height = 0`, `surface = {p:[x,y,0], t:[tx,ty,0], normal:[0,0,1], grade:0, bank:0}`, `attitude = identity`, `touge = false`. This already exists in practice: `Touge.route(dist, lane, false)` returns exactly that (A.height returns 0 when `elevated` is false, drive-touge.js:37), and the CPU fallback uses it. OBSERVED.
2. `lift(ob, A)` is already a no-op when `!A.touge` (drive-touge.js:68), so a world builder that always calls `lift` is flat-safe.
3. The render fork is the real divide: flat = one analytic full-screen ground (drive-three-shaders.js ground main, route parts as uniforms); pass = ribbon mesh + its own main. For the ribbon to be a drop-in, its main must call the same inScatter/haloScatter/ambient lines as the ground main (today it copies only `surface()` and fog). OBSERVED.
4. Frame choice must be single-sourced: every consumer of eye/ray/lamp positions (table pass, halo pass, lamp-halo sprites, trafficLamp uniforms, click probe, AFS) takes "car frame" or "world frame" from one object. Today the pass rotates `u.eye` after `update()` (drive-three.js:243-247) while the table and halo build their ray basis level.
5. "Is the pass" must be one boolean computed once (today three spellings, section 1).
6. The world builder `Touge.world` and the flat tile builder `tileWorld` build the same classes (rails/posts/trees/lamps/signs/studs/traffic) with different code (OBJECTS.md D7, D8). A shared "scene content" resolver with `A` as a parameter would remove that.

## 5. Sampler budget on the pass (see RENDER.md section 4 for the method)

MAX_TEXTURE_IMAGE_UNITS is 16 per fragment stage (WebGL2 minimum; the owner's crash message says 16; not measured here). Counts below are from a script over the assembled fragment text, reachable-code aware (INFERRED: no GLSL compiler was run).

| program (pass) | variant | samplers reachable from main | over 16? |
|---|---|---|---|
| ribbon | lit + air-beam table | BEFORE TOUGE-AIR-RIBBON: 6 (beam, materials, marks, otherBeam, passShadow0, passShadow1): the table banks were unreachable from the ribbon main (measured 9 active with the halo textures). AFTER: 12 active / 13 declared (measured on the GPU, links; script: reachable 12), + 3 scatBank0..2 | no |
| (historical) ribbon with `haloScatter` added (BOTH touge-halo branches: `git show exp/touge-halo:js/drive-touge-three.js` and `feat/touge-halo-elev:...` line 51 call only `haloScatter`) | lit | 6 + 3 halo = 9 | no |
| ribbon, calling BOTH `inScatter` (table) and `haloScatter` (TOUGE-AIR-RIBBON, with the blend banks left out) | lit + table | 12 active / 13 declared (measured) | no (the 15 estimate counted the 6 blend-set banks; they are compiled out) |
| instanced objects | plain | 11 | no |
| instanced objects | lit + table | **18** (measured 2026-10-23: link failure) -> 15 after TOUGE-AIR | was yes, now no |
| instanced objects | plain + table | **17** | **yes** |
| mesh cars | lit + table | 15 reachable (17 declared; `bodyMap` is declared but never read); 12 after TOUGE-AIR | no |

So on main, and on both halo branches, the program that overflows with the air beam in table mode is the instanced-object program (17-18), not the ribbon (INFERRED from text analysis; the owner's report names the ribbon, which matches the sampler total only for a ribbon variant that calls both scatter and halo, and no such branch exists in `git branch -a`). To settle it: the shader error log in the browser console names the program (`renderer.debug.onShaderError`, drive-three.js:33, throws `GPU drive` + the info log).

## 6. Known gaps (merged from reports, re-verified where marked)

| gap | status |
|---|---|
| halo not built on the pass | closed on main 0fed388 (drive-three.js:297) |
| ribbon and sky: halo term | closed: the ribbon main (ELEV-B2) and the sky quad (TOUGE-SKY-VEIL) both call `haloScatter` when `haloOn`. Air-beam (`inScatter`) term on the ribbon: closed by TOUGE-AIR-RIBBON (road lit, direct and table). On the sky quad: not added (the veil covers the far field; checked by eye only, INFERRED fine) |
| sky quad cost | open (INFERRED, not timed): the halo lookup now runs on every sky pixel, including the ones the ribbon covers (the sky is drawn first with depth test off). Drawing it after the ribbon with depth test on would cull them; that needs its own hash proof |
| `flags.y` on objects | = `ob.glow`, set only for raised road studs (drive-scenes.js:147-150). Trees and foliage are not flagged; `flags.y > 0` skips the air beam and halo on that object (drive-three-objects.js:114-117) (OBSERVED) |
| halo axis level in our frame (no per-car pitch) | closed on feat/touge-halo-tilt (TOUGE-HALO-TILT: the axis carries the car's own pitch, elevation in hDir.z). The air-beam TABLE frame mismatch is closed by TOUGE-AIR-RIBBON (table built from car-frame eye and lamps) |
| `tableKey` has no attitude term | closed on feat/touge-halo-tilt: our attitude pitch and roll (quantized 0.05 deg) are in the key on touge; flat is a constant. Note: tableKey guards the air-beam table only; the halo rebuilds every frame (no halo cache) |
| click probe reads flat CPU still | open (OBSERVED path) |
| AFS/cornering ignore grade and bank | open |
| lampRoad/lampClass need `street` on pass lamps | open (INFERRED) |
| sampler overflow with air beam table on the pass objects | closed by TOUGE-AIR: measured 18 active samplers (the object program; mesh car 15, ribbon 9), now 15 (mesh car 12). Needed 18 - 16: the flat objects with table sit at 15 and are unchanged. The ribbon now spends them: `inScatter` is in its main (TOUGE-AIR-RIBBON), 12 active / 13 declared with the table. |
| drive-touge*.js not mapped in the gate | partly closed: drive-touge-three.js is mapped; drive-touge.js is still not (OBSERVED) |
| air-hold armed by `trafficHalo` on a frame that never builds a halo | open (OBSERVED drive-anim.js:2333) |
| `p.A` is unset on the pass (`V.p.A` undefined; the route exists only as `world.A`) | OBSERVED by reports/TOUGE-ELEV-A.md; any consumer of `p.A` on the pass gets undefined |
| CPU fallback is flat by design | documented (drive-anim.js:2182) |
| tail lamp object z 0.78 vs source z 0.68 | left on purpose (byte identity) |
| route parts: flat shader caps at 16 route sections (`part[16]`), throws `too many route parts` (drive-three.js:239); ordinary flat routes reach 12, the pass route 19 | OBSERVED in reports/TR-touge-r2.md; protected only because the pass never uploads parts |
