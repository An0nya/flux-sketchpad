# GROUPS: proposed groups for the drive controls

## Registry listing (generated)

<!-- BEGIN GENERATED groups (docs/inventory/scripts/gen-options-docs.js) -->
Generated from the `group` and `where` fields of `js/options-registry.js`. `where` is where the control sits today; nothing has been moved.

| group | label | options | toolbar | More | advanced air | advanced halo | sidebar | no control |
|---|---|---|---|---|---|---|---|---|
| `view` | Camera and playback | 3 | 2 | 1 | 0 | 0 | 0 | 0 |
| `road` | Road and route | 9 | 2 | 5 | 0 | 0 | 0 | 2 |
| `surface` | Road surface | 7 | 0 | 4 | 0 | 0 | 1 | 2 |
| `air` | Fog and air beam | 14 | 0 | 2 | 10 | 1 | 0 | 1 |
| `halo` | Traffic halo | 7 | 0 | 2 | 0 | 5 | 0 | 0 |
| `street-lamps` | Street lamps | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| `traffic` | Traffic | 15 | 0 | 12 | 0 | 0 | 1 | 2 |
| `scenery` | Scenery and objects | 11 | 0 | 11 | 0 | 0 | 0 | 0 |
| `own-lamp` | Our lamp | 7 | 0 | 6 | 0 | 0 | 1 | 0 |
| `exposure` | Exposure and eye | 4 | 1 | 3 | 0 | 0 | 0 | 0 |
| `performance` | Speed and quality | 7 | 0 | 6 | 0 | 0 | 0 | 1 |
| `diagnostics` | Panels and layout | 5 | 0 | 5 | 0 | 0 | 0 | 0 |
| `internal` | Internal (no control) | 6 | 0 | 0 | 0 | 0 | 0 | 6 |

#### Camera and playback (`view`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `playing` | drive / pause | profile | toolbar | false | - |
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
| `tileCache` | cache ground | profile | More | false | needs `tilesOn` [disabled] |
| `mountainPass` | mountain pass (scene select) | profile | toolbar | false | - |
| `cline` | centre line | profile | More | "solid" | needs `usRoad` [disabled] |
| `res` | still picture width | profile | no control | 640 | - |

#### Road surface (`surface`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `wet` | wet (legacy mirror of wetness) | profile | no control | false | - |
| `wetSheen` | wet sheen | profile | More | false | needs `wetOn` [disabled] |
| `wetModel` | streak model | profile | More | "legacy" | needs `wetOn` [disabled], `wetSheenOn` [disabled] |
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
| `scatterGain` | air beam gain | profile | advanced halo | 1 | needs `tableModeTip` [none] |
| `airLevel` | air beam level | derived | More | (derived) | - |

#### Traffic halo (`halo`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `trafficHalo` | traffic halo | profile | More | 0 | needs `air` [hidden], `trafficBeamsOn` [none]; ignored when `mountainPassAir` [none] |
| `haloBins` | halo bins | profile | advanced halo | 24 | needs `air` [hidden], `haloOn` [none] |
| `haloDiv` | halo table divisor | profile | advanced halo | 0 | needs `air` [hidden], `haloOn` [none] |
| `haloPolar` | halo polar | profile | advanced halo | "off" | needs `air` [hidden], `haloOn` [none] |
| `haloPolarLamps` | halo polar lamps | profile | advanced halo | 2 | needs `air` [hidden], `haloOn` [none] |
| `haloGain` | halo gain | profile | advanced halo | 1 | needs `air` [hidden], `haloOn` [none] |
| `haloQuality` | halo quality | derived | More | (derived) | - |

#### Street lamps (`street-lamps`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `lampHalos` | lamp halos | profile | More | "off" | needs `gpu` [tooltip] |
| `lampClass` | lamp class | profile | More | "III" | needs `lampDistUsed` [none] |
| `lampRoad` | road lamp light | profile | More | "off" | needs `lampsPresent` [none] |
| `streetLamps` | street lamps | profile | More | "sodium" | needs `tilesOrPass` [disabled] |

#### Traffic (`traffic`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `trafficShuffle` | traffic beams source | profile | More | "off" | needs `symmetricOncoming` [tooltip] |
| `trafficOutIds` | beams left out of traffic | profile | More | [] | needs `shuffleLibrary` [none] |
| `onMode` | oncoming headlamps | profile | More | "symmetric" | - |
| `trafficDensity` | traffic density | profile | More | 1 | - |
| `trafficLogic` | traffic logic | profile | More | false | - |
| `safeGap` | gap guard | profile | More | true | conflicts `trafficLogicOn` [disabled] |
| `trafficBeams` | traffic beams | profile | More | false | - |
| `oncoming` | oncoming traffic | profile | More | false | - |
| `preceding` | preceding traffic | profile | More | false | - |
| `onDist` | oncoming distance (CPU still) | profile | no control | 80 | - |
| `preDist` | preceding distance (CPU still) | profile | no control | 50 | - |
| `onKcd` | oncoming intensity (kcd) | profile | Spec > Road sidebar | 30 | needs `manualMode` [none] |
| `trafficRange` | traffic range | profile | More | 400 | - |
| `trafficLightRange` | traffic light range | profile | More | "150" | needs `trafficBeamsLight` [none] |
| `trafficNearest` | nearest cars with traffic light | profile | More | "8" | needs `trafficBeamsLight` [none] |

#### Scenery and objects (`scenery`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `people` | people | profile | More | true | ignored when `mountainPassPeople` [none] |
| `animals` | deer | profile | More | true | - |
| `signs` | signs | profile | More | true | - |
| `reflectiveClothing` | reflective clothing | profile | More | "mix" | needs `peoplePresent` [none] |
| `posts` | posts | profile | More | true | - |
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
| `expMode` | exposure mode | profile | More | "fixed" | - |
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

#### Panels and layout (`diagnostics`)

| option | label | kind | sits in | default | needs / ignored / conflicts |
|---|---|---|---|---|---|
| `fitControls` | fit controls | profile | More | true | - |
| `largeCard` | large scorecard | profile | More | true | - |
| `fpsCounter` | FPS badge | profile | More | false | - |
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
