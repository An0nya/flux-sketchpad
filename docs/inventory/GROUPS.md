# GROUPS: a proposal for organising the drive controls

Written 2026-10-22 on feat/option-registry. **Nothing in the UI was moved or hidden.** The `group` field in `js/options-registry.js` records this proposal (so the generated listing at the bottom stays in step with the code), and you can change any of it by editing one word per option and re-running `node docs/inventory/scripts/gen-options-docs.js`. Labels: OBSERVED = read in the code or the running page; PROPOSAL = my suggestion, your call.

## 1. How the controls are organised today (OBSERVED)

- **Toolbar (always visible, 4 option controls plus Game):** the scene select (which also holds "mountain pass"), the speed slider, Drive / pause, Game, and glare. A "More" button sits at the end of this row.
- **More (a collapsed panel; about 95 elements carry a data attribute in the page I counted, which includes the beam library and file widgets):** everything else, in the order the code happened to add it: road shape, road surface (wet road, wet sheen, streak model), air (visibility, air beam level), lamp halos / lamp class / road lamp light, traffic halo and halo quality, oncoming headlamps, view angle, supersampling, exposure (mode, EV), oncoming and preceding traffic, then the two collapsed sub-groups below, then route tiles, clothing, high beam, the object switches, traffic and renderer switches, resolution, seed and density, beam library.
- **Two collapsed groups inside More**, each remembering open or closed: "advanced air beam" (steps, method, resolution, blur, cache, cycle, near fade, near sampling, a debug text box) and "advanced halo" (bins, table divisor, polar mode, polar lamps, gain; the air-beam gain slider sits here too, although it belongs to the air beam).
- **Spec > Road sidebar (not the drive bar):** marking reflectivity RL, oncoming intensity in kcd, beam smoothing.
- **No control at all:** 14 registry entries are changed only by tests, by other options, or never (listed in section 5).

There are two presets today, and they are the pattern to copy (section 4): **air beam level** and **halo quality**.

## 2. Proposed groups

"Top layer" = I suggest it stays visible without opening More. "Advanced" = I suggest it is hidden until asked for (a collapsed section, like the two that exist). Counts are options, not controls.

| group | what it is for | members | top layer | advanced / can be hidden |
|---|---|---|---|---|
| **Camera and playback** `view` | where you look from and whether it moves | playing, speed, fov | playing, speed | fov |
| **Road and route** `road` | what road you are driving | scene, mountainPass (a value of the scene select), tiles, cline, seed, density, tileCache; wild, res (no control) | scene (+ pass) | tiles, tileCache, cline, seed, density |
| **Road surface** `surface` | how wet and shiny the road is | wetness (the dry / damp / wet button), wetSheen, wetModel, surfaceSheen, RL (sidebar); wet, tex (no control) | wetness | wetSheen, wetModel, surfaceSheen, RL |
| **Fog and air beam** `air` | the haze and the visible beam in it | visibility, airLevel; then the advanced air beam: scatter, scatterMode, scatterRes, scatterBlur, scatterCache, scatterCycle, scatterCycleFade, scatterNearFadeRange, scatterNearBias, scatterBinCounts, scatterGain; scatterQuality (written by airLevel) | visibility | all of the advanced air beam; keep airLevel as the one dropdown |
| **Traffic halo** `halo` | the glow around oncoming lamps in fog | haloQuality, trafficHalo; haloBins, haloDiv, haloPolar, haloPolarLamps, haloGain | haloQuality (or fold into the air group) | everything except haloQuality |
| **Street lamps** `street-lamps` | lamps along the road and their glow | streetLamps, lampHalos, lampClass, lampRoad | streetLamps | lampHalos, lampClass, lampRoad |
| **Traffic** `traffic` | other cars, how they behave, how much they light | oncoming, preceding, onMode, trafficDensity, trafficLogic, safeGap, trafficBeams, trafficRange, trafficLightRange, trafficNearest, trafficShuffle, trafficOutIds; onKcd (sidebar); onDist, preDist (no control) | oncoming, preceding | onMode, onKcd, safeGap, trafficRange, trafficLightRange, trafficNearest, trafficShuffle and its list |
| **Scenery and objects** `scenery` | what stands beside the road | people, animals, signs, posts, veg, obstacle, rpm, reflectiveClothing, leafyFoliage, detailedModels, deerBehaviour | none (one row of switches) | reflectiveClothing, leafyFoliage, detailedModels, deerBehaviour |
| **Our lamp** `own-lamp` | the car's own beam and how it moves | ownLow, ownHigh, high (session), afs, corneringLamps, lampPitch, smooth (sidebar) | high beam | all the rest |
| **Exposure and eye** `exposure` | how the picture is brightened and the eye modelled | expMode, ev (three buttons), glare, ambient | glare, ev | expMode, ambient |
| **Speed and quality** `performance` | how hard the page works | gpuRenderer, samples, simCeiling, dynamicResolution, minFps, mt; frameTargetMs (written by minFps) | none | all |
| **Panels and layout** `diagnostics` | badges and layout switches, not part of the scene | fpsCounter, debugTimings, sceneDetails, fitControls, largeCard | none | all |
| **Internal** `internal` | state the code keeps, with no user control | scatterNearFade, scatterTableSteps, view, pedStop, lampRule, gameOptions | none | never shown |

The full member list, with where each control sits today, its default and what it needs, is generated at the bottom of this file.

## 3. Things that are the same thing twice, or nearly (OBSERVED)

| pair | what is going on | suggestion |
|---|---|---|
| `airLevel` and `scatter` (+ 8 more) | the level dropdown writes `scatter`, mode, resolution, blur, cache, cycle, near fade, near sampling and quality together; the individual controls stay and the dropdown reads "custom" when they disagree | keep the level in the top layer, the individual ones advanced (already so) |
| `haloQuality` and `trafficHalo` + 5 | the same pattern. `trafficHalo` itself is outside the advanced group and also exists inside the preset | move `trafficHalo` into the advanced halo group or drop it from the top |
| `wet` and `wetness` | `wet` is a leftover true/false mirror of `wetness > 0`; one reader still uses `wet` directly | retire `wet` after that reader moves (not done here) |
| `scatterNearFade` and `scatterNearFadeRange` | old on/off replaced by short / medium / long; stored value is converted at load | leave as is, internal |
| `minFps` and `frameTargetMs` | the second is computed from the first | one control already; keep `frameTargetMs` internal |
| `scene` `mountainPass` `tiles` | three ways to say "which road": the scene select writes `mountainPass` for the pass, and `tiles` turns the route on or off | one "road" control with the three values plus a route switch; owner's call |
| `ev`, `evm`, `evp` | one option, three buttons | fine; just one row in the proposal |
| `onMode` and `onKcd` | `onKcd` only matters in manual mode, and lives in a different place (sidebar) | show it next to `onMode` only when manual is picked |
| `trafficShuffle`, `ownLow`, `ownHigh` | three ways to pick a saved beam, for traffic and for our car | one "beams" sub-group in Our lamp or Traffic |
| `fitControls`, `largeCard`, `fpsCounter`, `debugTimings`, `sceneDetails` | layout and diagnostic switches next to scene switches | their own group (above), hidden by default |

## 4. The preset pattern, and where it could be used again

How the two existing presets work (OBSERVED, `RF.Drive.airLevelBundle`, `haloLevelBundle`, `airLevelOf`, `haloLevelOf` in js/drive.js):

1. One dropdown with named levels (halo quality: off / low / medium / ultra; air beam: off / baseline / low / medium / high / max).
2. Picking a level writes a fixed bundle of the detailed options in one go (one save, one redraw).
3. The detailed options sit in a collapsed "advanced" group that remembers open or closed.
4. The dropdown's shown value is computed from the detailed options, and reads **custom** when they match no level, so hand editing never lies.
5. The dropdown itself is never saved; only the detailed options are. The registry marks these as `kind: 'derived'` and lists the bundle's members.

PROPOSAL, same pattern for (each would be a new derived entry, none exists yet): **street lighting** (streetLamps + lampHalos + lampClass + lampRoad: off / basic / detailed); **road surface** (wetness + wetSheen + wetModel: dry / damp / wet / wet + streaks); **quality** (samples + simCeiling + dynamicResolution + minFps: fast / balanced / sharp); **traffic** (oncoming + preceding + trafficDensity + trafficLogic + trafficBeams + trafficHalo: none / light / realistic). A preset that needs another option on to work (the halo bundle sets `trafficHalo` but not `trafficBeams`, so "medium" can show nothing) should list that prerequisite, which the registry's `requires` is meant for.

## 5. Options with no control (OBSERVED)

`wet` (legacy), `tex`, `wild`, `res`, `onDist`, `preDist`, `frameTargetMs` (derived), `scatterQuality` (written by the air level), `scatterNearFade` (legacy), and the test-only `scatterTableSteps`, `view`, `pedStop`, `lampRule`; plus the game overlay `gameOptions`. `tex` and `wild` are saved and read, but nothing in the UI changes them (no control found by grep of js/); whether they should get one or be removed is your call. `onDist` and `preDist` are read only by the old CPU still picture and have no test.

## 6. What the rules mean for grouping

Whole groups are conditional, which is the argument for hiding rather than greying: the whole **Fog and air beam** and **Traffic halo** groups do nothing while visibility is "clear" (today they are hidden then); most of the **advanced air beam** does nothing unless the method is "table"; **Traffic halo** needs "traffic beams" on and nothing says so (HAZARDS H6); the pass ignores air beam, halo and people options (H4); **street lamp** options need tiles or the pass. The registry records each of these as a named rule with the file where the code enforces it (see OPTIONS.md, "Rules the registry declares"), so a group header could one day say "greyed because: ..." without anyone re-deriving it.

## 7. What I did not decide (questions for you)

- Whether the top layer should be a short list of presets (air, road surface, traffic, quality) or a short list of the real options above. The registry supports either.
- Whether `scatterGain` should move to the air group (its home) from the halo group (where it sits now). I left it where it is.
- Whether options that nothing can change (`tex`, `wild`, `onDist`, `preDist`) should get controls or be deleted from the saved profile.
- The sidebar rows (RL, onKcd, smooth) live in Spec > Road, a different panel. I grouped them by meaning; moving them is a UI decision.

## Registry listing (generated)

<!-- BEGIN GENERATED groups (docs/inventory/scripts/gen-options-docs.js) -->
Generated from the `group` and `where` fields of `js/options-registry.js`. `where` is where the control sits today; nothing has been moved.

| group | label | options | toolbar | More | advanced air | advanced halo | sidebar | no control |
|---|---|---|---|---|---|---|---|---|
| `view` | Camera and playback | 4 | 3 | 1 | 0 | 0 | 0 | 0 |
| `road` | Road and route | 13 | 2 | 9 | 0 | 0 | 0 | 2 |
| `surface` | Road surface | 8 | 0 | 5 | 0 | 0 | 1 | 2 |
| `air` | Fog and air beam | 14 | 0 | 2 | 10 | 1 | 0 | 1 |
| `halo` | Traffic halo | 34 | 0 | 4 | 0 | 30 | 0 | 0 |
| `street-lamps` | Street lamps | 5 | 0 | 5 | 0 | 0 | 0 | 0 |
| `traffic` | Traffic | 16 | 0 | 13 | 0 | 0 | 1 | 2 |
| `scenery` | Scenery and objects | 13 | 0 | 13 | 0 | 0 | 0 | 0 |
| `own-lamp` | Our lamp | 7 | 0 | 6 | 0 | 0 | 1 | 0 |
| `exposure` | Exposure and eye | 4 | 1 | 3 | 0 | 0 | 0 | 0 |
| `performance` | Speed and quality | 9 | 0 | 8 | 0 | 0 | 0 | 1 |
| `diagnostics` | Panels and layout | 7 | 0 | 7 | 0 | 0 | 0 | 0 |
| `internal` | Internal (no control) | 6 | 0 | 0 | 0 | 0 | 0 | 6 |

#### Camera and playback (`view`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `playing` | drive / pause | profile | toolbar | false | - |
| `driveScrub` | time scrubber | profile | toolbar | false | - |
| `speed` | speed (km/h) | profile | toolbar | 50 | - |
| `fov` | view angle | profile | More | 60 | - |

#### Road and route (`road`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `scene` | scene | profile | toolbar | "road" | ignored when `mountainPassScene` [none] |
| `wild` | random scenery | profile | no control | true | ignored when `mountainPassScene` [none] |
| `seed` | scenery seed | profile | More | 7 | needs `seedUsed` [disabled] |
| `density` | scenery density | profile | More | 1.5 | needs `densityUsed` [disabled] |
| `tiles` | route tiles | profile | More | true | - |
| `endlessRoad` | endless biome road (prototype) | profile | More | false | needs `tilesOn` [disabled] |
| `tileCache` | cache ground | profile | More | true | needs `tilesOn` [disabled] |
| `mountainPass` | mountain pass (scene select) | profile | toolbar | false | - |
| `elevatedView` | 3D route pipeline for every scene (prototype) | profile | More | false | needs `gpu` [tooltip] |
| `endlessPreset` | endless road preset (prototype) | profile | More | "off" | needs `tiles` [undefined] |
| `tileTerrain` | terrain skirts on endless tile roads (opt-in, pricy) | profile | More | false | needs `tiles` [undefined] |
| `cline` | centre line | profile | More | "solid" | needs `usRoad` [disabled] |
| `res` | still picture width | profile | no control | 640 | - |

#### Road surface (`surface`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `wetVeil` | wet-road reflections in the glare veil | profile | More | false | needs `wetOn` [disabled], `wetSheenOn` [disabled] |
| `wet` | wet (legacy mirror of wetness) | profile | no control | false | - |
| `wetSheen` | wet sheen | profile | More | false | needs `wetOn` [disabled] |
| `wetModel` | streak model | profile | More | "ggx" | needs `wetOn` [disabled], `wetSheenOn` [disabled] |
| `tex` | road texture | profile | no control | true | - |
| `surfaceSheen` | lit surface sheen | profile | More | false | - |
| `RL` | marking reflectivity RL | profile | Spec > Road sidebar | 200 | - |
| `wetness` | road: dry / damp / wet | extra | More | (unset) | - |

#### Fog and air beam (`air`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `visibility` | air visibility | profile | More | null | - |
| `scatter` | air beam steps | profile | advanced air beam | 0 | needs `air` [hidden]; ignored when `mountainPassAir` [none] |
| `scatterMode` | air beam method | profile | advanced air beam | "direct" | needs `air` [hidden]; ignored when `mountainPassAir` [none] |
| `scatterRes` | beam res | profile | advanced air beam | "half" | needs `air` [hidden], `tableMode` [disabled] |
| `scatterBlur` | beam blur | profile | advanced air beam | "off" | needs `air` [hidden], `tableMode` [disabled] |
| `scatterCache` | beam cache | profile | advanced air beam | "off" | needs `air` [hidden], `tableMode` [disabled] |
| `scatterCycle` | beam cycle | profile | advanced air beam | 0 | needs `air` [hidden], `tableMode` [disabled], `cacheOn` [disabled] |
| `scatterBinCounts` | slice samples (debug) | profile | advanced air beam | "" | needs `air` [hidden], `tableModeHidden` [hidden] |
| `scatterQuality` | air beam quality (written by the air level) | profile | no control | "steps" | needs `air` [hidden], `tableModeHidden` [hidden] |
| `scatterCycleFade` | cycle blend | profile | advanced air beam | "off" | needs `air` [hidden], `tableMode` [disabled], `cacheOn` [disabled], `cycle8` [hidden] |
| `scatterNearFadeRange` | beam near fade | profile | advanced air beam | "medium" | needs `air` [hidden], `tableMode` [disabled] |
| `scatterNearBias` | near-eye sampling | profile | advanced air beam | 0 | needs `air` [hidden], `tableModeHidden` [hidden] |
| `scatterGain` | air beam gain | profile | advanced halo | 0.5 | needs `tableModeTip` [none] |
| `airLevel` | air beam level | derived | More | (derived) | - |

#### Traffic halo (`halo`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `trafficHalo` | oncoming headlamp scatter | profile | More | 0 | needs `air` [hidden], `trafficBeamsOn` [none] |
| `haloCars` | oncoming scatter cars | profile | More | 4 | needs `air` [hidden], `haloOn` [none] |
| `haloRange` | oncoming scatter range (m) | profile | advanced halo | 250 | needs `air` [hidden], `haloOn` [none] |
| `haloBins` | halo bins | profile | advanced halo | 12 | needs `air` [hidden], `haloOn` [none] |
| `haloDiv` | halo table divisor | profile | advanced halo | 2.8 | needs `air` [hidden], `haloOn` [none] |
| `haloPolar` | halo polar | profile | advanced halo | "off" | needs `air` [hidden], `haloOn` [none] |
| `haloPolarBand` | auto polar table size | profile | advanced halo | "128x32" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `polarAuto` [none] |
| `haloPolarLamps` | halo polar lamps | profile | advanced halo | 2 | needs `air` [hidden], `haloOn` [none] |
| `haloGain` | halo gain | profile | advanced halo | 0.25 | needs `air` [hidden], `haloOn` [none] |
| `crestOcclusion` | crest occlusion | profile | advanced halo | "off" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `passHalo` [none] |
| `haloJitter` | halo sampling | profile | advanced halo | "jittered" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloJitterAmount` | halo jitter amount | profile | advanced halo | 0.25 | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloBlur` | halo blur | profile | advanced halo | "light" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloDepthBlur` | halo depth blur | profile | advanced halo | "light" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloLampWin` | lamp-window steps | profile | advanced halo | "off" | ignored when `crossingRefineOn` [none] |
| `haloCrossingRefine` | crossing-bin refinement | profile | advanced halo | 0 | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloRefineNeighbour` | refine eye-side neighbour bin | profile | advanced halo | "off" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `crossingRefineOn` [none] |
| `haloMoment` | halo first-moment bins | profile | advanced halo | "off" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloAutoRange` | halo table auto range | profile | advanced halo | "4-8" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloNearSub` | halo near quality | profile | advanced halo | 1 | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloConePass` | cone pass | profile | advanced halo | "2" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `haloConeAngle` | cone pass angle | profile | advanced halo | 30 | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `trafficShadows` | traffic shadows | profile | advanced halo | "all" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `passHalo` [none] |
| `shadowRes` | traffic shadow map size | profile | advanced halo | "512x512" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `passHalo` [none] |
| `trafficShadowRoad` | traffic shadows on the road | profile | advanced halo | "on" | needs `gpu` [tooltip], `passHalo` [none] |
| `trafficShadowObjects` | objects cast traffic shadows | profile | advanced halo | "on" | needs `gpu` [tooltip], `passHalo` [none] |
| `trafficShadowSoft` | traffic road shadow softening | profile | advanced halo | "off" | needs `gpu` [tooltip], `passHalo` [none] |
| `scatterCull` | oncoming in-scatter culling | profile | advanced halo | "fast" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `scatterCullEps` | culling threshold (fast) | profile | advanced halo | 0.001 | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none], `cullFast` [none] |
| `scatterRange` | scatter range (m) | profile | advanced halo | 120 | needs `air` [hidden] |
| `haloWidthStep` | halo width-driven samples | profile | advanced halo | "off" | needs `gpu` [tooltip], `air` [hidden], `haloOn` [none] |
| `trafficSubTick` | traffic sub-tick interpolation | profile | advanced halo | "off" | - |
| `haloQuality` | oncoming scatter quality | derived | More | (derived) | - |
| `haloRangeRow` | oncoming range | derived | More | (derived) | - |

#### Street lamps (`street-lamps`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `lampCone` | lamp cone (mist) | profile | More | "auto" | needs `gpu` [tooltip], `lampsPresent` [none], `air` [hidden] |
| `lampConeGain` | cone gain | profile | More | 0.5 | needs `coneOn` [hidden] |
| `lampClass` | lamp class | profile | More | "III" | needs `lampDistUsed` [none] |
| `lampRoad` | road lamp light | profile | More | "off" | needs `lampsPresent` [none] |
| `streetLamps` | street lamps | profile | More | "sodium" | needs `tilesOrPass` [disabled] |

#### Traffic (`traffic`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `trafficShuffle` | traffic beams source | profile | More | "off" | needs `symmetricOncoming` [tooltip] |
| `trafficOutIds` | beams left out of traffic | profile | More | [] | needs `shuffleLibrary` [none] |
| `onMode` | oncoming headlamps | profile | More | "symmetric" | - |
| `trafficDensity` | traffic density | profile | More | 0.5 | - |
| `trafficLogic` | traffic logic | profile | More | false | - |
| `safeGap` | gap guard | profile | More | true | conflicts `trafficLogicOn` [disabled] |
| `trafficBeams` | traffic beams | profile | More | false | - |
| `oncoming` | oncoming traffic | profile | More | false | - |
| `preceding` | preceding traffic | profile | More | false | - |
| `trafficMarkers` | side marker lamps on traffic cars | profile | More | false | - |
| `onDist` | oncoming distance (CPU still) | profile | no control | 80 | - |
| `preDist` | preceding distance (CPU still) | profile | no control | 50 | - |
| `onKcd` | oncoming intensity (kcd) | profile | Spec > Road sidebar | 30 | needs `manualMode` [none] |
| `trafficRange` | traffic range | profile | More | 250 | - |
| `trafficLightRange` | traffic light range | profile | More | "250" | needs `trafficBeamsLight` [none] |
| `trafficNearest` | nearest cars with traffic light | profile | More | "8" | needs `trafficBeamsLight` [none] |

#### Scenery and objects (`scenery`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `people` | people | profile | More | true | ignored when `mountainPassPeople` [none] |
| `animals` | deer | profile | More | true | - |
| `signs` | signs | profile | More | true | - |
| `reflectiveClothing` | reflective clothing | profile | More | "mix" | needs `peoplePresent` [none] |
| `posts` | posts | profile | More | true | - |
| `powerlines` | power lines | profile | More | "on" | - |
| `powerlineReflectance` | wire reflectance | profile | More | 0.22 | needs `powerlinesOn` [hidden] |
| `veg` | trees | profile | More | true | - |
| `obstacle` | crates | profile | More | false | - |
| `rpm` | road studs | profile | More | true | - |
| `leafyFoliage` | leafy foliage | profile | More | false | ignored when `mountainPassScene` [none], `cityScene` [none] |
| `detailedModels` | detailed models | profile | More | false | - |
| `deerBehaviour` | deer behaviour | extra | More | (unset) | - |

#### Our lamp (`own-lamp`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `lampPitch` | lamp pitch | profile | More | false | - |
| `afs` | AFS | profile | More | false | - |
| `corneringLamps` | cornering lamps | profile | More | false | - |
| `smooth` | beam smoothing | profile | Spec > Road sidebar | "smooth" | - |
| `ownLow` | own low beam | extra | More | (unset) | - |
| `ownHigh` | own high beam | extra | More | (unset) | - |
| `high` | high beam (H key) | session | More | "off" (session) | - |

#### Exposure and eye (`exposure`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `expMode` | exposure mode | profile | More | "adapt" | - |
| `ev` | exposure value | profile | More | 1 | - |
| `glare` | glare | profile | toolbar | "off" | - |
| `ambient` | ambient light (lx) | profile | More | 0 | - |

#### Speed and quality (`performance`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `mt` | threads | profile | More | true | needs `cpuRenderer` [none]; conflicts `mtBlockers` [none] |
| `gpuRenderer` | GPU drive renderer | profile | More | true | - |
| `dynamicResolution` | dynamic resolution | profile | More | false | - |
| `frameTargetMs` | frame target (ms) | profile | no control | 33 | needs `dynResOn` [none] |
| `simCeiling` | resolution ceiling | profile | More | "high" | - |
| `minFps` | minimum frame rate | profile | More | 30 | needs `dynResOn` [none] |
| `samples` | supersampling | profile | More | "1" | - |
| `qualityGovernor` | quality governor | profile | More | "off" | - |
| `distanceLod` | distance LOD | profile | More | "off" | - |

#### Panels and layout (`diagnostics`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `largeCard` | large scorecard | profile | More | true | - |
| `animateUI` | animate UI | profile | More | false | - |
| `panelMode` | panels | profile | More | "auto" | - |
| `canvasShape` | canvas | profile | More | "wide" | - |
| `fpsCounter` | FPS badge | profile | More | true | - |
| `sceneDetails` | scene details panel | profile | More | false | - |
| `debugTimings` | debug timings | profile | More | false | - |

#### Internal (no control) (`internal`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `scatterNearFade` | near fade (legacy) | profile | no control | "on" | - |
| `scatterTableSteps` | table steps override (tests only) | extra | no control | (unset) | - |
| `view` | drive view mode | extra | no control | (unset) | - |
| `pedStop` | pedestrians stop traffic (test control) | extra | no control | (unset) | - |
| `lampRule` | where street lamps stand (test control) | extra | no control | (unset) | - |
| `gameOptions` | minigame overlay | game | no control | (overlay) | - |
<!-- END GENERATED groups -->
