# OBJECTS: every object type the drive scene can contain, every path that builds it, and where the paths diverge

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). Read-only inventory; no code changed, no browser run.
OBSERVED = read at the cited file:line. INFERRED = deduced from code, not run. "Common builder" = the kit in js/drive-scenes.js:52-167 (`RF.Drive.kit(ctx)`: post, sign, tree, bush, deer, person, car, parkedCar, signal, rpm, obstacle), whose methods are wrapped at :155-167 so each result is tagged `cls` and, for deer/person/tree/car, carries `detail` (the data the detailed SDF/mesh models are built from).

## 1. The builders (who produces objects)

| id | entry point | used for | notes |
|---|---|---|---|
| B1 `buildScene(name, ctx, o)` | drive-scenes.js:417 | static scenes `road`, `forest`, `city` (+ hidden `targets`), the CPU still, and the live view when `wild` is off or the scene is not `road` (drive-anim.js:37-41) | scene seed is hard-coded 7 (`seed: 7`, drive-anim.js:38; spec-ui.js:1077); `foliageSeed` carries the option seed |
| B2 `wildChunk(ctx, o)` | drive-scenes.js:382 | random scenery for scene `road` when `wild` is on: 300 m chunks, seed `mix(k)` per chunk (drive-anim.js:42-45) | people/deer come back as `actors` data, built later by place() |
| B3 `place(src, dist, A, tauOf, skip, deerBehaviour)` | drive-anim.js:627 | re-poses walkers and deer each frame and creates their objects with a NEW kit (:630, :650) | the only place wild actors become objects |
| B4 `tileWorld(p, dist, t, tauOf)` | drive-anim.js:512 | route tiles: junction posts/sign/signals, street lamps, the urban crosser; calls place() and trafficObjects() | returns the pass world early when `src.tiles.mountain` (:513) |
| B5 `Touge.world(p, dist, t, tauOf)` | drive-touge.js:105 | the mountain pass: rails, posts, trees, crest deer, lamps, signs, studs, traffic | hand-assembled; see TOUGE.md |
| B6 `trafficObjects(src, cars, A, p)` | drive-anim.js:357 | cars: template objects built once per kind (`K.car` at drive-anim.js:59-60), then instanced per car | headlamp emission set by applyTrafficHeadlamps (:349) and, on the pass, overwritten by `trafficLight` (drive-touge.js:161) |
| B7 `gameObjects(g, world, lane)` | drive-anim.js:1935 | minigame hazards (person/deer) | its own kit (:1936) |
| B8 `D.Models.actors(obs, on)` | drive-models.js:134 | converts `detailPart` person/deer/tree objects to SDF models when detailed models are on (GPU and CPU) | called from placedObjects (:372), tileWorld (:585), Touge.world (:142), gameObjects (:1942, :1944) |
| B9 GPU object view `objects(...).update` | drive-three-objects.js:168 | adds GPU-only objects: tree impostor cards, mesh cars (`mesh-car`), leaf cutouts | not reachable from the CPU renderer |
| B10 `addTraffic`, `addObstacles` | drive-scenes.js:359, 366 | oncoming/preceding cars and crates for the CPU still and `buildScene` | the live view does NOT use addTraffic (live traffic is trafficSource, drive-anim.js:50) |

## 2. Object types and their creation paths

Counts of call sites below come from `grep -n "[A-Za-z]\.<method>(" js/drive-anim.js js/drive-scenes.js js/drive-touge.js js/drive.js js/drive-game.js js/drive-models.js` with `Math.sign` and the kit definitions removed.

### 2.1 Person (pedestrian)

| # | creation site | builder | kind (clothing request) | kit options | options that change it |
|---|---|---|---|---|---|
| P1 | drive-scenes.js:274 (peopleStage, forest/city list items) | B1 | scene's own list: `it.kind` (dark/hivis/light) (:205, :217) | kit(ctx) with ctx.seed 7, id by counter `pedN++` | `people`, `reflectiveClothing` (ctx), scene `kerbPeople` (`tiles`), `scenery` overrides rate (:273-275) |
| P2 | drive-scenes.js:275 (peopleStage extras, rate > 1) | B1 | random `['dark','hivis','light']` (:275) | separate kit `xk` with `pedSalt 'x'` (:239) | same plus scenery rate |
| P3 | drive-scenes.js:335 (road scene, static) | B1 | hard-coded dark / hivis / light at three fixed spots | ctx.seed 7, counter id | `people`, `reflectiveClothing` |
| P4 | drive-scenes.js:354 (hidden `targets` scene) | B1 | `t.kind` from the caller | - | test scene only |
| P5 | drive-scenes.js:402-405 (wildChunk) creates ACTOR DATA with `ptype` drawn from `['dark','dark','hivis','light']` (:403); object built at drive-anim.js:640 | B2 -> B3 | `a.ptype` | kit built at drive-anim.js:630 with `reflectiveClothing: src.pedMode` but NO `seed`, and `id: a.id` WITHOUT the chunk index | `people`, `reflectiveClothing`, `density`, `seed` (chunk seed only), `wild` |
| P6 | drive-anim.js:549 (junction crosser during a red) | B4 | HARD-CODED `'dark'` | kit built at :532 with NO `reflectiveClothing`, no seed, no id | `people` (flag :547), tile kind. **Ignores the clothing option** (always `pedMode(undefined)` = `mix`, drive-scenes.js:42) |
| P7 | drive-anim.js:572 (urban-tile crosser, one per cycle) | B4 | HARD-CODED `'dark'` | kit built at :571 WITH `reflectiveClothing: cfg.pedMode`, id `cross:<tile>:<start>`, no seed | `people` (:568), `reflectiveClothing` via cfg.pedMode (:57) |
| P8 | drive-anim.js:1940 (minigame hazard) | B7 | `h.noHiViz ? 'dark' : 'hivis'` (RNG at spawn, drive-game.js:120,145) | kit :1936 with `reflectiveClothing` read from `info().o` | clothing mode; independent of the score rule (see D6) |
| - | pass (drive-touge.js:105-152) | B5 | none | **no person is ever built on the pass**: `FEATURE_PRESETS.pass.people = false` (drive-scenes.js:176) and world() has no person call | `people` option has no effect |
| - | detail conversion | B8 | SDF pedestrian from `detail.ptype` + `pedMats` (drive-models.js:139; kit sets pedMats at drive-scenes.js:161) | `detailedModels` | GPU and CPU |

The model case the owner found is P6/P7 (and P8): callers pass a literal kind where P1-P5 take it from the scene. P6 is worse than the owner described: it also builds its kit without the clothing mode (see D1).

### 2.2 Deer

| # | site | builder | notes |
|---|---|---|---|
| E1 | drive-scenes.js:268 (deerStage list) and :269 (extras) | B1 | `animals`; scene list positions |
| E2 | drive-scenes.js:336 (road scene static: two deer at fixed s) | B1 | `animals` |
| E3 | drive-scenes.js:354 (`targets`) | B1 | test scene |
| E4 | actors from wildChunk (drive-scenes.js:407-409) built at drive-anim.js:640 | B2->B3 | `animals`, `deerBehaviour` (attention state computed in place(), :636-641) |
| E5 | drive-anim.js:650-651 (static scene deer re-built with attention when `deerBehaviour`) | B3 | NEW kit with `A` (route) rather than `A:null` + move(); different construction path from E1-E3 |
| E6 | drive-touge.js:125 (two crest deer per 1600 m lap, fixed s 160 and 969) | B5 | own attention computation (:124); honours `animals` (flags.animals !== false, :122) |
| E7 | drive-anim.js:1939 (hazard) | B7 | uses `pose(..., deerEnabled)` |

`deerBehaviour` undefined means "follow `detailedModels`" (drive-models.js:38); options `deerBehaviour` / `detailedModels` are read by E4, E5, E6, E7 separately.

### 2.3 Cars (traffic, parked, hazard cars)

| # | site | notes |
|---|---|---|
| C1 | drive-anim.js:59-60 `K.car(0,0,{face,lamps,kcd})` template per kind (oncoming/preceding), then `trafficObjects` (:357) instances it per car | the live traffic. kcd `+o.onKcd || 30` is baked at template creation (`onKcd` change -> tkey rebuild) |
| C2 | drive-scenes.js:361-362 `addTraffic` (CPU still / buildScene) | different path: `D.Headlamp.apply(scene.objects, ...)` called by cpuStill (spec-ui.js:1078) with `lut` not `p.lowLut||p.lut` |
| C3 | drive-scenes.js:301 `parkedStage` -> `k.parkedCar` (city) | static, no lamps, `face 1` |
| C4 | `mesh-car` objects (GPU only), `Models.actors`/`drive-three-models.js` `adapt` | replace the primitive car when `detailedModels`; the lamp discs are re-mounted on the mesh (drive-touge.js:54-66 `meshLamp`) |
| C5 | drive-touge.js:143 `trafficObjects(...)` then `trafficLight(placed,A,p)` (:148,161) | headlamp emission recomputed with road-relative geometry, replacing applyTrafficHeadlamps' result |
| C6 | tile world (drive-anim.js:517) | uses the same trafficObjects, route `A` from tileRoute |

Headlamp emission is therefore set in three places (C1 applyTrafficHeadlamps, C2 Headlamp.apply in cpuStill, C5 trafficLight).

### 2.4 Posts, rails, reflectors

| # | site | notes |
|---|---|---|
| T1 | drive-scenes.js:263 postsStage, :333 (road static), :385 (wildChunk, `o.posts !== false`) | kit `post` = pole + reflector disc facing the car (drive-scenes.js:61-65) |
| T2 | drive-anim.js:533 (junction posts, `flags.posts !== false`) | kit |
| T3 | drive-touge.js:112-114: W-beam box + cylinder `cls 'rail'` and TWO reflector discs `cls 'post'` per 8 m, hand-built, not `K.post` | honours `flags.posts` only for the discs (:114); the rails are always built |
| T4 | buildScene post-filter (drive-scenes.js:423) removes `cls 'post'`/`'veg'` AFTER building when `posts === false` or `veg === false` | the only class switches handled by filtering rather than by not building |

### 2.5 Signs
Sites: drive-scenes.js:264 (signsStage), :334 (road static), :388 (wildChunk, `o.signs`), drive-anim.js:534 (junction, `flags.signs !== false`), drive-touge.js:137 (one yellow sign per 200 m, `flags.signs !== false`). All use `K.sign`. The `signs` option: skey (drive-anim.js:1153).

### 2.6 Trees and bushes (vegetation)

| # | site | notes |
|---|---|---|
| V1 | drive-scenes.js:246-260 (roadsideStage trees/bushes + extras), :337 (road static bush), :393-394 (wildChunk, `o.veg !== false`) | `veg`; rates from scenery params |
| V2 | drive-scenes.js:16-34 `vergeFoliage` (leafy low bushes, `cls 'veg'`, `foliage: true`) appended at :412 and :422 | `leafyFoliage`; road/forest only; never on the pass |
| V3 | drive-touge.js:118-119 `K.tree` at fixed offsets (`1.5*lane + 6 + 3 sin(s)`) every `18/(density/1.5)` m; drop-side trees every 36 m | `veg` (flags.veg), `density` |
| V4 | `Models.tree` (drive-models.js:137) -> sphere-cluster trees | `detailedModels` |
| V5 | GPU impostor tree cards and leaf cutouts (drive-three-objects.js:172-188, :211) | GPU only; skipped on the pass (:172 `!p.touge`) |

### 2.7 Street lamps (pole, arm, head, light source)

| # | site | notes |
|---|---|---|
| L1 | drive-anim.js:556-565 (tiles: urban/junction per `lampRule`, a lamp every 50 m; hand-built cylinder + box + ellipsoid + `lights.push({..., street:[...]})`) | `streetLamps`, `lampRule` (never set, always 'urban-only'), `tiles` |
| L2 | drive-touge.js:127-133 (pass: a near-copy of L1 with different arm geometry, `yaw`, and `lights.push` WITHOUT `street`) | `streetLamps`; positions from `lampSpots` (:96) |
| L3 | drive-scenes.js:295-297 polesStage (city: plain poles, NO head, no light) | city scene |
| - | no street lamps exist in the non-tile road/forest scenes | OBSERVED: no `street-lamp` class built outside L1/L2 |

Divergence: L2's light has no `street` vector, which L1 supplies for the lamp-distribution table (`lampRoad`, `lampClass`) and the lamp-halo cone (INFERRED: `u.lightStreet` is only set `if (q.street)`, drive-three.js:274, so `lampRoad 'table'` and class II-V orientation have no street side on the pass).

### 2.8 Signal heads
Only the tile junction (drive-anim.js:535-540): pole and arm are hand-built boxes, the head is `K.signal` (drive-scenes.js:141-145), a second head is mirrored by hand for the opposite approach (:539-544) with manual field flipping. The pass has none.

### 2.9 Obstacles (crates)
drive-scenes.js:367 (`addObstacles`), :399 (wildChunk), drive-touge.js:136 (`flags.obstacle`). Tiles: from `src.objects` of whichever source is active.

### 2.10 Studs / raised markers (`rpm`)
`laneStuds(k, markings, ...)` at drive-scenes.js:398 (wildChunk, feature gate `resolveFeatures({preset:'road', overrides:{studs:o.rpm}})`), :420 (buildScene: only when `opt.rpm === true`, i.e. the animated view asks, the still does not), drive-touge.js:141 (preset `'pass'`). Three gates, one resolver function, different presets.

### 2.11 Markings and ground paint
`laneMarkings` (drive.js:161) called at drive-anim.js:39, :44, :56 (tiles), drive-scenes.js:384, drive-touge.js:150. Junction paint is hand-built `marks.push` in tileWorld (drive-anim.js:524-530). Pass markings are shifted by `dist` in world() (:151) like tiles; GPU draws them (`nMark`, drive-three.js:229).

### 2.12 Buildings / facades
Only drive-scenes.js:285-293 `backdropStage` (city; `facadeStyle: seed % 3`, material closure `win(h, seed)` whose SOURCE TEXT the foliage and material-map code inspects: drive-three-objects.js:143-150 matches `source.includes('win(h, seed)')`, `'hivis-tape'`, `'face === 5'`, `'const zc'`). No buildings in tileWorld or the pass (grep of drive-anim.js for facade/backdrop/building returns no creation).

### 2.13 Rails (pass only)
drive-touge.js:112-113. Not in any other path.

## 3. Divergences (explicit list)

| # | divergence | evidence | consequence |
|---|---|---|---|
| D1 | The junction crosser (P6) hard-codes kind `'dark'` AND builds its kit without the clothing mode or a seed | kit at drive-anim.js:532 has `{Lw, A:null, rand}` only; person at :549; compare :571 and :630 which pass `reflectiveClothing` | `reflectiveClothing = none/small/vest` never applies to this walker; colour hash seed 0 (`unitOf(seed|0=0, pid, ...)`, drive-scenes.js:101-102) |
| D2 | The urban crosser (P7) hard-codes `'dark'`, passes the mode but no seed | :571-572 | clothing mode honoured; kind never `hivis`/`light`, so in `mix` it is never a vest and strips are a coin flip on `cross:<tile>:<start>` |
| D3 | Wild-chunk walkers share ids across chunks: `id: a.id` (e.g. `p0`) at :640 has no chunk index, while the time clock uses `k + ':' + a.id` (:635), and no seed is passed | drive-anim.js:630,635,640 | every chunk's walker `p0` gets the same torso colour and strip choice (INFERRED from `unitOf(seed=0, 'p0', salt)`); changing the scene `seed` does not recolour them |
| D4 | Static-scene walkers (P1-P3) hash on ctx.seed 7 and a per-kit counter; wild (P5) on seed 0 + actor id; crossers (P6/P7) on seed 0 + their ids; hazards (P8) on seed 0 + `hazard:N` | drive-scenes.js:418 (`seed: 7` default), :101 | four independent colour streams for the same visual class |
| D5 | The pass builds no people at all, whatever `people` says | drive-scenes.js:176; drive-touge.js:105-152 | UI toggle `people` is live but inert on the pass |
| D6 | Minigame: hazard "hi-vis or not" is an RNG bit (`noHiViz`, drive-game.js:120,145) used for scoring (:38,168), while the drawn clothing comes from the clothing mode through `kind` (drive-anim.js:1940) | In mode `none` a `hivis` hazard is drawn dark; in mode `vest` a `noHiViz` hazard wears a vest (drive-scenes.js:101-104) | score and picture can disagree (INFERRED; the score code never reads the mode: grep of drive-game.js for pedMode/reflectiveClothing is empty) |
| D7 | Street lamps built twice with different recipes (L1/L2); L2 lacks `street` | drive-anim.js:556-565 vs drive-touge.js:127-133 | `lampRoad`/`lampClass` have no street side on the pass (INFERRED) |
| D8 | Pass posts/rails are not `K.post` | drive-touge.js:112-114 | post look can drift from the flat posts; rails ignore `posts` |
| D9 | `deerBehaviour` handled in three places: place() (E4/E5), Touge.world (E6), gameObjects (E7) | drive-anim.js:636-651; drive-touge.js:121-126; drive-anim.js:1938 | each computes attention separately |
| D10 | Static scene deer with behaviour (E5) are rebuilt with `A` (route); everything else is built `A:null` then `move()`d | drive-anim.js:650 vs :630 | two pose paths for the same object |
| D11 | The CPU still builds its scene from B1 with `seed 7`, no posts/veg/obstacle/rpm/leafy/detailed/tiles/wild/traffic-logic; the click probe reads THIS picture (ui.js:1047 -> ensureCpuStill) | spec-ui.js:1077; drive-anim.js `source()` options vs cpuStill args | tap-to-read-luminance reports a different scene from the one on screen; on the pass it reports the flat road |
| D12 | Class switches: posts and veg are removed by filtering after the build (drive-scenes.js:423); signs/people/animals are not built; obstacle added after; rpm gated by `resolveFeatures` | drive-scenes.js:264-275,420-424 | removing an item by filter keeps the RNG stream consumed, not-building changes later draws (the comment at :189-195 says the stage code was arranged to avoid this) |
| D13 | `resolveFeatures` presets exist for road/forest/city/pass but only `studs` is ever read from them; `FEATURE_DEFAULTS.people/animals/...` are not consulted by the builders | grep `resolveFeatures` -> drive-scenes.js:398,420; drive-touge.js:141 only | the 'one resolver' exists as an interface, used for one flag |
| D14 | Hazard objects on the pass are converted with `Models.actors(moved, true)` (always detailed) while the rest of the pass uses `!!p.detailedModels` | drive-anim.js:1942 vs drive-touge.js:142 | hazard figures can be detailed when the option is off |
| D15 | Headlamp emission set in three places (C1, C2, C5) | drive-anim.js:349-356; spec-ui.js:1078; drive-touge.js:161-174 | a fix to one does not reach the others |
| D16 | Tail-lamp object z 0.78 (drive-scenes.js) vs traffic source z 0.68 (drive.js:656-657) on flat roads | reports/TOUGE-ELEV-A.md "OBSERVED, not changed" | known, left for byte identity |

## 4. What a single resolver would need to hold (facts for the later step)

Per object class: which `flags` key switches it (`people`, `animals`, `signs`, `posts`, `veg`, `obstacle`, `rpm`), which builders must honour it (B1, B2, B4, B5, B7), which kit options it needs (`reflectiveClothing`, `seed`, `id`), and which options feed the clothing/colour hash. Today the kit needs `ctx` per call site and five of eight person sites construct their own ctx.
