# Oncoming halo performance, before any WebGPU port (2026-11-27)

Exploring mode. Untracked: not committed to any branch yet.

Question: where does the drive's time go when the oncoming air beam (traffic halo) is on, and would a WebGPU
compute port of the table build help? Handoff item 3 in `experiments/hdr-headlamp/README.md`.

## How it was measured

`halo-ablate.js`: Playwright, headless Chromium, ANGLE Metal on the Mac M4. It loads a `flux-state` save, pauses,
and changes one option per variant. For each frame it does a 1 px readback sync, calls `RF.DriveAnim._.frame()`,
then syncs again, and keeps the median of 20–30 frames. The halo build time is the existing `SL_HALO_TIMING` hook (`halo.ms`).
Single runs, no repeats: treat differences under ~1 ms as noise. Mac numbers only; nothing here was measured on a phone.

```
CW=856 CH=482 NF=20 node halo-ablate.js <port> save-crawl.json out.jsonl   # VARS='[["name",{opt:val}],...]' to pick variants
```

Saves: `save-low.json` = Anya's "(1)" (looks good, 75 fps on the Mac per Anya), `save-crawl.json` = her "(2)"
(crawls even on the Mac), `save-full.json` = her full-quality one (not timed yet).

## Results (OBSERVED, Mac, 856×482 unless noted)

Crawl save (16 lamps, 32 bins, haloDiv 1.4, table 512×345, cull off):

| variant | frame ms | halo build ms | passes |
|---|---|---|---|
| baseline | 91.5 / 93.6 (two runs) | 74.7 / 75.9 | 16 |
| halo off | 16.6 | — | 0 |
| cull fast | 35.5 | 18.0 | 10 |
| cull exact | 94.9 | 76.5 | 16 |
| haloDiv 2 (428×241) | 64.1 | 46.6 | 16 |
| haloDiv 4 (214×121) | 32.4 | 15.6 | 16 |
| 12 bins | 48.2 | 31.2 | 16 |
| 2 cars (4 lamps) | 36.2 | 19.6 | 4 |
| haloDiv 4 + cull fast | 29.0 | 8.5 | 10 |
| crest occlusion off | 69.0 | 53.5 | 16 |
| the 11 other feature toggles | 89.8–94.4 | 73–77.5 | 16 |

Save (1) (4 lamps, 12 bins, table 214×121):

| variant | frame ms | halo build ms |
|---|---|---|
| baseline | 22.1 | 4.9 |
| halo off | 12.3 | — |
| the 4 newer features off (moment, crossing refine, refine neighbour, cone-equi) | 19.8 | 2.4 |
| shadows off | 19.6 | 5.2 |
| crest occlusion off | 23.1 | 5.0 |

(An earlier save (1) sweep ran on a 564×317 canvas by accident: `low.jsonl`. Same pattern.)

## What it shows

- OBSERVED: the crawl save's halo build scales close to linearly with cells, with bins, and with lamps.
  It is fragment-bound arithmetic, not draw-call overhead:
  boxes × lamps × steps ≈ 512·345·32 · 16 · 6 ≈ 540M integrand evaluations per frame.
- OBSERVED: `scatterCull: fast` cuts the crawl build 76 → 18 ms; `exact` cuts nothing here. Skipping work is the lever.
- OBSERVED: the swarm's four newer features cost ~2.5 ms of build on save (1) and are noise on the crawl save.
- OBSERVED: on save (1) the halo is ~10 ms of frame but only ~5 ms of build. INFERRED: the rest is outside
  the build (the table lookup in every scene shader, or the polar table). Not yet split.
- Polar: `msPolar` ≈ `halo.ms` in every crawl row, yet turning polar off saves nothing. INFERRED: the polar
  timer's readback waits for all the queued screen-table work. Don't trust that split.
- The screen table is width-clamped: 512 × 32 bins = 16384 = MAX_TEXTURE_SIZE, so haloDiv 1.4 at 32 bins gets
  fewer cells than it asks for. A WebGPU 3D texture or storage buffer removes that wall.
- Shadows cost ~2.5–3 ms on save (1). Anya: 512×512 maps look nearly the same, so low settings could drop resolution further (backlog).

## Build vs read split (OBSERVED, Mac, 856×482)

`halo-ablate.js` serves a patched `js/drive-three.js` to the test browser only (page.route). Two switches:
SL_HALO_FREEZE = build once, then keep reading without rebuilding. SL_HALO_NOREAD = rebuild every frame, lookup off.

| save | on | freeze (no build) | noread (no read) | off |
|---|---|---|---|---|
| (1) | 21.5 / 21.4 | 16.7 | 20.6 | 12.3 |
| crawl | 88.6 / 88.7 | 20.7 | 87.9 | 16.3 |

Solving on − off = build + read + X, freeze = off + read + X, noread = off + build + X:

| save | build | read | X (on whenever the halo is on, in neither) |
|---|---|---|---|
| (1) | 4.8 | 0.9 | 3.5 |
| crawl | 67.9 | 0.7 | 3.7 |

- The **read is cheap** (< 1 ms). This retracts Claude's earlier theory that the scene shaders reading the table were the other half.
- The build is the only part that scales with settings.
- X ≈ 3.6 ms is a fixed cost that comes with the halo being on.
  Follow-up on save (1), table frozen (`split-x-low.jsonl`): freeze 16.0, + cone pass off 16.0, + shadows off 14.5, + polar off 16.3,
  + crest off 16.8, halo off 12.1. So ~1.5 ms is traffic shadows; cone, polar and crest move nothing on their own.
  INFERRED: crest off alone may not stop the crest height map, because shadows on also builds it (SMF fallback, `drive-three.js` ~l.444).
  The other ~2.4 ms is still unattributed; a per-stage readout should find it.

## Old phone (OBSERVED by Anya, 2026-11-27, fps counter)

- Scatter beam (halo) off: stable 25 fps. With heavy traffic: 20. Heavy traffic with lit surface sheen off: 26.
- Everything off (trees, oncoming traffic and their beams): 35 fps max.
- Save (1) with the halo on: ~15 fps (her earlier estimate). INFERRED: halo ≈ 66 − 40 ≈ 26 ms per frame on the old phone.
- Goal (Anya): 20 fps stable on the old phone with the halo on. Full 30 fps would need a whole-app WebGPU port, if that.

## New phone (OBSERVED by Anya, 2026-11-27)

- Low traffic halo + heavy traffic (3 cars / 300 m): 50–60 fps.
- Scatter beam quality high: 30 fps. xhigh: 13 fps.
- Wet road on (streaks + bounce) and our air beam at max: 10 fps. Everything on except supersampling: 7 fps.

- Reference look (OBSERVED by Anya, new phone, 2026-11-27 9:31): "looks excellent" on the mountain pass where the bins
  don't line up with the elevation (bins are most visible there). 24 fps, 40.9 ms mean, 52 ms p95, phone warm.
  Settings: range 400 m, 12 bins, table 1/2.8, near quality x1, cone-clipped equiangular on, crossing refine 32,
  neighbour bin refined, moment on, polar off, crest on, jittered, blur medium, depth blur off, cone pass 2,
  traffic shadows all cars 1024×512, road + object shadows on, edge 2x2, interpolated motion, cull fast, gain x4, glare dry-low.
  Correction (Anya, 9:41): it sits around 50 fps; the 24 was a dip at the moment of the screenshot.
- Polar comparison, same pose (Anya's screenshots 9:38–9:39): per-lamp polar shows fine radial streaks in the beam and a dark
  shaft behind the utility pole. Auto 64×16 is smooth and soft. Off shows blockier screen-table cells. Anya: crossing refine and
  polar are pricy, and polar is "arguably wrong unless the polar table is crazy big".
  The pole shaft: the pole occludes the oncoming beam in the fog (traffic shadows with object casters on). OBSERVED in the
  screenshots; the mechanism (shadow maps sampled in the halo march) is INFERRED from `useSm` in the build.

- Polar grid visibility (Anya's screenshots 9:50/9:52, 4 bins, blur off): auto 64×16 shows radial spokes around the lamp;
  auto 512×64 shows chevron/stair bands across the road. Anya: polar "really chops up the beam" even when finer, and needs blur + more bins.
  INFERRED: any fixed grid (screen cells or polar cells) prints its own shape when the glow has detail finer than the grid.
  The fixes are more cells (cost), blur (softness) or jitter (noise).
  Candidate pattern for the port: temporal accumulation (jittered sample positions per frame, blended with previous frames and
  reprojected), as Wronski 2014 / Frostbite 2015 do for froxel fog. That gives fine effective resolution from a coarse, cheap table.
  The air-beam table's 8-version cycle (scatterCycle) is a non-reprojected cousin of this already in the repo.
  OBSERVED in code: the halo's `haloJitter` is spatial only. 'interleaved' gives neighbouring cells different step offsets
  (2×2/3×3/4×4 pattern) and the blur averages them. 'jittered' adds a fixed hash of cell/slice/step, so it does not change per frame.
  Temporal accumulation would vary the offsets per frame and average over frames instead of over neighbours.
  It can be prototyped in WebGL first (a history texture + a blend pass); it does not need the port.

## First phone readings of the GPU stage readout (OBSERVED by Anya, 2026-11-27 11:13 pm, halo-perf 6ad4815, same paused pass pose)

| stage (ms, mean of 10 probes) | new phone 880×494 | old phone 856×482 |
|---|---|---|
| crest map (all work since frame start, incl. CPU update/shading) | 5.5 | 9.7 |
| halo total | 4.6 | 5.6 |
| · shadow maps / screen / polar | 1.3 / 3.3 / 0.0 | 1.3 / 4.1 / 0.1 |
| scene | 3.8 | 19.7 |
| objects | 2.6 | 16.7 |
| compose / final | 0.4 / 0.3 | 1.7 / 1.0 |
| sum = probe | 17.2 | 54.5 |
| app readout: fps, frame, main | 62.5 fps, 16.4, 9.2 | 17.2 fps, 59.2, 23.8 |

INFERRED: on the old phone at this pose, the halo is ~10% of the frame. Scene + objects ≈ 36 ms are the cost.
This retracts Claude's earlier "halo ≈ 26 ms on the old phone", which came from fps differences between runs with
different settings. 20 fps = 50 ms, so ~4.5 ms has to go, and scene/objects is where it is.
The "crest map" lap also holds the frame's CPU-side update and shading (there's no separate 'prep' lap unless the air table is on),
so it needs splitting before it can be read as the crest pass.
Settings of this run: not recorded yet (ask Anya).

Second reading (11:17 pm). Save: `flux-state-straight-0m.json` = pass, straight tile at 0 m, objects off (people/animals/signs/
posts/veg/powerlines), foliage density 0.5, traffic density 1, 4 halo cars, 12 bins, div 2.8, polar off, refine 32, moment on,
cull fast, traffic shadows all 512², road + object shadows on, glare off. Nearest oncoming car at 16 m, 12° off.

| stage (ms) | new phone 880×494 | old phone 856×482 | old/new |
|---|---|---|---|
| crest map (+ frame CPU) | 2.2 | 6.7 | 3.0× |
| halo total | 5.3 | 15.4 | 2.9× |
| · shadow maps / screen | 0.6 / 4.6 | 1.3 / 13.8 | |
| scene | 3.3 | 18.5 | 5.6× |
| objects | 0.5 | 3.2 | |
| compose / final | 0.3 / 0.4 | 1.2 / 1.0 | |
| sum = probe | 12.0 | 46.1 | |
| app: fps, frame, main, p95 | 90.9, 11.2, 5.3, 21 | 20.4, 47.4, 17.7, **1902** | |

- Anya: the halo climbs quickly with more cars. INFERRED: halo screen ∝ lamps × cells in their footprint. A car at 16 m covers a big part of the screen.
- With objects off, the old phone's two big stages are scene (18.5) and halo screen (13.8). Scene is 5.6× slower than on the new phone while the halo is 2.9×.
  INFERRED, untested: the ground shader loops over every traffic lamp with shadow-map lookups, and the old GPU suffers more there
  (register pressure from the big uniform arrays is one theory). The scene pass is one draw, so splitting it means toggling options, not adding laps.
- p95 1902 ms on the old phone: a ~2 s hitch somewhere in the window. Anya: probably her pausing and unpausing to match the scene.

Toggle round (11:24–11:29 pm, same save, one toggle at a time; car positions differ run to run because the scene can't be frozen).
Correction (Anya): all 5 runs had crossing refinement at 128, not the 32 in the save file, so the halo numbers are inflated by that.
Anya: a loaded state starts paused and has to run a while for the readout to collect and settle, so it isn't a frozen scene for timing.

| old phone (ms) | crest | halo (screen) | scene | objects | sum | fps |
|---|---|---|---|---|---|---|
| rerun, clean pause | 7.9 | 25.6 (24.3) | 19.3 | 3.1 | 58.3 | 16.9 |
| surface sheen off | 7.6 | 21.3 (19.9) | 17.2 | 2.7 | 51.4 | 19.2 |
| lamp pitch off | 7.5 | 25.1 (23.9) | 17.3 | 3.3 | 55.5 | 16.7 |
| 11:28 pair, toggle unknown (ask) | 7.4 | 23.9 (22.5) | 16.5 | 3.3 | 53.3 | 17.9 |
| traffic beams off (playing) | 0.4 | 0.1 | 22.0 | 5.2 | 30.9 | 29.4 |

New phone across the same runs: crest 2.2–2.4, halo 5.5–5.9, scene 2.7–3.0, sum ~12. With traffic beams off: scene 4.8, sum 7.6, 125 fps.

- Scene stays ~17–22 ms on the old phone even with traffic beams off. So it is NOT the traffic-lamp loop; that theory is dropped.
  Sheen and pitch move it by ~2 ms at most, inside run-to-run noise.
- "crest map" falls to 0.4 with traffic beams off. So ~7.5 ms on the old phone is the crest height map plus shadow setup that only
  runs with a halo (crest occlusion on; shadows on also builds it), not frame CPU.
- Halo screen on the old phone varies 14–24 ms run to run (car positions).
- INFERRED: old-phone budget at this save ≈ crest 7.5 + halo 20–25 + scene 17–22 + objects 3 + compose/final 2.5.
- Reproducibility fix: save a state once and load that file on both phones (Performance > Debug > Load state).
  Loading re-seeds traffic deterministically at the saved spot, so both phones see the same cars.

## "Time this frame" resolution sweep (OBSERVED by Anya, 2026-11-27 11:43–11:45 pm, halo-perf 011729d)

Pose: the straight-0m save loaded, nearest oncoming car ~16 m. Anya: crossing refine 32, and the scatter table set to 1/1.8
(haloDiv 1.8, ≈2.4× the cells of the save's 1/2.8). So the halo here is the fine-table case.
Anya: "Time this frame" reads about 1.5–3× slower than a real run. INFERRED causes: the per-stage syncs stop CPU and GPU from
overlapping and add a flush per lap, and an iPhone GPU probably drops its clocks while it idles between the synced bursts.
Use the stage numbers as proportions, not as absolute frame cost.
Each cell: mean over 64 renders of one pose. Old phone in **bold**.

| ceiling (sim) | crest | halo screen | scene | objects | compose+final | sum |
|---|---|---|---|---|---|---|
| 1600 (old 856×482 / new 880×494) | **14.3** / 3.8 | **69.6** [57–77] / 9.0 | **28.9** / 3.9 | **3.8** / 0.5 | **3.1** / 0.7 | **120.8** / 18.1 |
| 960 (same sims: ceiling above both) | **14.5** / 7.4 | **68.1** / 11.0 | **27.6** / 6.5 | **3.8** / 1.0 | **3.1** / 1.1 | **118.0** / 27.2 |
| 640 (640×360) | **12.1** / 4.3 | **50.8** [41–56] / 8.7 | **22.2** / 4.4 | **2.8** / 0.6 | **2.4** / 0.9 | **91.2** / 19.1 |
| 640 + SS2 | **13.1** / 5.0 | **51.7** / 9.0 | **23.1** / 4.9 | **6.0** / 1.1 | **2.8** / 0.9 | **97.4** / 21.1 |

- Old phone is repeatable: 1600 vs 960 is identical work (same sim) and gives 120.8 vs 118.0.
  New phone is NOT: 18.1 vs 27.2 for the same work. INFERRED: thermal/power state. Take new-phone numbers as best-of-several, or cool it first.
- Pixels ×0.56 (856×482 → 640×360) gives old-phone halo screen ×0.73, scene ×0.77, crest ×0.85. So the old phone is only partly per-pixel
  bound. Lowering resolution helps but won't reach 50 ms alone.
- At this pose the old phone spends ~58% of the frame in halo screen (51–70 ms) vs 9 ms on the new phone (7.7× slower; scene 7.4×).
- SS2 only doubles objects (the supersampled pass); everything else is unchanged.

## Table size and the real-speed line (OBSERVED by Anya, 2026-11-27 11:51–11:55 pm, 640×360, SS2, refine 32)

**CORRECTION (Anya, same night): the 8 screenshots are 4 pairs: (1) real run, old app; (2) timed, old app; (3) real run, new app;
(4) timed, new app. The "1/1.8 vs 1/2.8" reading below is RETRACTED.** The Frame-timing line in pair 1 was left over from the
11:45 640+SS2 tap (old phone sum 97.4 is that run exactly), not a table-size comparison. Corrected reading:

| | new phone | old phone |
|---|---|---|
| real run, app frame ms (old app / new app) | 11.4 / 11.5 | 48.0 / 55.9 |
| timed, synced stage sum (old app / new app) | 27.3 / 26.4 | 72.2 / 69.9 |
| synced ÷ real | 2.4× / 2.3× | 1.5× / 1.25× |
| new app "real speed" line | 3.5 ms (3.3× too fast) | 21.4 ms (2.6× too fast) |

- The real-speed line is broken on both phones: it reads 2.6–3.3× faster than the real frame. Candidate causes, not separated:
  the frozen traffic keeps every cache warm (shadow maps 0.1–0.2 timed vs 1.1–1.6 playing), and/or the single canvas-pixel read
  doesn't wait for the GPU on Safari. Replace it with real frames: time the app's own animation loop for a fixed window.


(RETRACTED, see the correction above) Old phone, Frame timing (synced): table 1/1.8 → halo screen 51.7, scene 23.1, crest 13.0, sum 97.4. Table 1/2.8 → halo screen 25.5,
scene 24.6, crest 11.3, sum 72.2. So halo screen ∝ cells, about 2.0× for 2.4× the cells.
New commit, old phone: synced sum 69.9, real speed 21.4 [21.1–21.7] ms ("3.3x slow"). But the same pose PLAYING ran at frame 55.9 ms (18.9 fps).
And the fps counter jumped to 125/333 fps after a timing run (Anya: "outrageously inflated").
- INFERRED: timing renders feed the fps / frame stats; they should be reset after a run (bug, mine).
- INFERRED: real speed < playing because a frozen pose hits every cache. In the synced run shadow maps read 0.1–0.2 vs 1.1–1.6 while
  playing (BJ1 shadow cache), and the crest map, air table and tiles are cached too. Driving pays those misses every frame.
  So "real speed" is the cached floor, not the driving cost. Fix idea: advance the pose slightly per render (as bench() does).
- Objects (OBSERVED in code, js/drive-three-objects.js): objects are ray-traced in the fragment shader. Each draws a proxy box, every pixel
  intersects the shape, writes gl_FragDepth and discards misses. Writing depth per pixel and discarding switch off early depth rejection
  (and Apple's hidden-surface removal), so every covered pixel of every overlapping object runs the full lit shader.
  Candidates: a depth-only prepass (the cheap trace already exists as maskMode) then shading only where depth matches;
  tighter proxies; front-to-back order; objects not supersampled on weak devices (SS2 doubles objects: 2.8 → 6.0 ms, old phone).

## Open

- Backlog (Anya, 2026-11-27): a "crysis" preset for fun: crossing refine 2048, shadow maps 2048×1024, polar 1024×256,
  more than 32 bins, everything maxed. INFERRED walls in WebGL: HALO_MAX = 32 (shader arrays), and the screen table packs bins
  side by side, so 32 bins × 512 cells = 16384 = MAX_TEXTURE_SIZE. A 1024-wide polar table at 32 bins would be 32768 wide.
  Past 32 bins or 1024 polar needs array layers or a 3D texture, which the WebGPU port gives for free.
- CDF artifacts (`haloMoment: 'moment2'`, UI label "moment: CDF"). OBSERVED by Anya: weird artifacts, 2026-11-27 phone screenshot.
  INFERRED cause (Claude, from the code, untested): the second table stores the raw, prefix-summed Σw·s² in half floats
  (`m2bin`/`m2cum` are HalfFloatType), and the lookup gets the variance as E[s²] − E[s]² after differencing two prefix sums
  (drive-three-shaders.js ~l.164–173). At 100 m, s² ≈ 10⁴ while half floats carry ~3 significant digits (rounding step ≈ 4–8 at that size),
  so the variance of a ~30 m-wide bin (≈ 75 m²) sits near the rounding noise. That's cancellation in half precision.
  The value also overflows when w·s² > 65504 (s = 400 m range: s² = 1.6·10⁵).
  Fix directions: store central moments per bin, not prefix sums (Σw·(s − bin centre)², small numbers), or a 32-bit float target.
  To confirm: read back m2cum at an artifact pixel and compare against the CPU twin.
- Found in passing: `haloMoment: 'moment2'` does an unconditional `readRenderTargetPixels` every frame (`halo.m2dbg`,
  drive-three-halo.js), a pipeline stall that looks like leftover debug code. Not fixed.

- Where save (1)'s other ~5 ms goes (lookup vs polar). Needs GPU timer queries per pass on the Mac.
- Phone numbers: none yet. Mac-to-phone scaling is unknown.

## Stage sweep on the Mac, 856×482 (old-phone size), 2026-11-28 — `stage-sweep.js`, rows in `sweep-856.jsonl`

Exploring-mode readings, M4 / ANGLE Metal, headless. Each row = GST2 "Time this frame" (64 kept synced renders of one pose), one
option changed from the save. ms are synced stage means (inflated by the waits). "Real frames" is useless here: headless rAF caps it
at 60 Hz and it swung 11–20 ms between identical baselines, so only the stage columns count. Run-to-run noise (baseline vs
"baseline again"): ~±0.5 ms per stage, ~1.5 ms on the probe total.

| save | variant | crest | halo | scene | objects | probe sum |
|---|---|---|---|---|---|---|
| full | baseline | 5.6 | 21.5 | 5.5 | 3.0 | 38.0 |
| full | halo off | 1.3 | 0.2 | 5.5 | 4.3 | 13.8 |
| full | traffic beams off | 0.8 | 0.2 | 3.8 | 4.1 | 11.3 |
| full | crest+shadows off | 1.4 | 20.3 | 4.8 | 4.8 | 33.7 |
| full | signs off | 5.2 | 21.5 | 5.3 | 1.9 | 36.2 |
| full | SS2 | 5.5 | 21.2 | 5.3 | 4.3 | 38.6 |
| low | baseline | 5.2 | 6.1 | 6.9 | 3.9 | 24.7 |
| low | halo off | 1.1 | 0.2 | 5.2 | 4.4 | 13.4 |
| low | crest+shadows off | 1.1 | 5.0 | 5.9 | 5.2 | 19.6 |
| straight-0m | baseline | 2.7 | 7.3 | 4.7 | 1.1 | 17.1 |
| straight-0m | halo off | 0.3 | 0.2 | 4.0 | 1.2 | 6.9 |
| straight-0m | crest+shadows off | 0.3 | 6.3 | 5.1 | 1.6 | 14.8 |

sheen off, lampPitch off, leafy off, models off: every stage within noise (≤0.5 ms) on all three saves.

**OBSERVED:**
- On the Mac the halo is the frame: halo + the crest map it drags in = 27 of 38 ms on the full save, 11 of 25 on low, 10 of 17 lean.
- Crest occlusion + traffic shadows off removes the crest map (5.6 → 1.4, 5.2 → 1.1, 2.7 → 0.3; the ~1 ms left is in the same lap
  whatever the halo does) and barely moves halo screen (−1 ms). Saves ~4–5 ms per frame on the Mac. Look change: not checked yet.
- Traffic beams off cuts scene 5.5 → 3.8 and 6.9 → 3.9 on the Mac (the traffic-lamp loop in the road shader is ~30–45 % of scene
  here). This contradicts the phone reading "scene stays the same with traffic beams off": so either the old GPU's scene cost is
  something else, or that phone reading had another change in it. Needs a phone A/B with "Time this frame" on one loaded state.
- Objects are small on the Mac (1–4 ms). Signs are the biggest single object item (−1.1 / −1.4 ms). SS2 adds 1.3–1.6 ms to objects
  and nothing elsewhere. Halo off made objects *rise* 1.3 ms on the full save (reproduced in 3 of 3 halo/beams-off rows): INFERRED
  the halo's GPU work was overlapping or hiding part of the objects lap; untested.
- `objectWork()` returned 0/0 on every row. It is not broken: its trace-work output (`maskMode 3`) only exists in the SDF-model
  branch (`kind==4`, `drive-three-objects.js:38`); every other kind goes down the mask path and counts nothing. So it measures
  detailed models only, and none of those was in view. The object handoff overstated it; corrected there.

**So for the phones:** the Mac ranks the halo first by far. The old phone's extra pain (scene 5–7×, objects 6× vs the new phone) is
a GPU-specific disproportion the Mac can't show. The next phone A/B worth doing is traffic beams on/off with "Time this frame".

## Foliage + real frames on the Mac, 2026-11-28 — `sweep-trees-856.jsonl`, `sweep-trees-1600.jsonl`

`stage-sweep.js` with `UNCAP=1` (`--disable-gpu-vsync --disable-frame-rate-limit`): headless real frames are no longer capped at
60 Hz, so the "real" column is now usable. (A first attempt wrote junk at a 16×9 canvas: zsh doesn't word-split `$sz`, so CH was
empty. The script now refuses to run when the canvas doesn't match CW/CH.)

| save, size | variant | halo+crest | scene | objects | real ms (p95) |
|---|---|---|---|---|---|
| straight, 856 | bare (trees off, d0.5) | 10.5 | 4.8 | 1.2 | 5.6 (6.0) |
| straight, 856 | trees d3 + leafy | 10.3 | 4.7 | 1.6 | 5.5 (5.9) |
| straight, 856 | + detailed models | 11.4 | 5.0 | 2.5 | 6.9 (7.4) |
| straight, 856 | trees d3 leafy, oncoming headlamps off | 0.5 | 3.7 | 2.2 | 3.2 (3.6) |
| full, 856 | save (d3) | 26.8 | 5.4 | 3.0 | 25.8 (27.0) |
| full, 856 | trees off | 26.0 | 5.3 | 2.4 | 24.9 (26.3) |
| straight, 1600 | bare | 18.3 | 7.7 | 2.2 | 11.2 (16.6) |
| straight, 1600 | oncoming headlamps off (trees d3 leafy) | 0.5 | 5.4 | 3.8 | 3.7 (4.4) |
| full, 1600 | save (d3) | 39.1 | 10.4 | 4.6 | 49.8 (58.4) |
| full, 1600 | trees off | 38.6 | 10.4 | 3.5 | 48.5 (57.1) |

**OBSERVED (Mac):**
- Trees are cheap on the Mac: density 0.5 → 3, leafy on/off, or trees off all move the real frame ≤ 1.3 ms. Detailed models
  cost ~1.4 ms real at 856. This disagrees with Anya's informal phone finding ("trees and foliage really ate frames"): either the
  phone GPU is disproportionately bad at the object shader (it was 6× slower than the new phone there), or the phone test had
  other changes in it. Needs a phone A/B on one loaded state.
- On a flat road, oncoming headlamps (`trafficBeams`, the strip button) are 40–65 % of the real frame (5.6 → 3.2 ms at 856,
  11.2 → 3.7 at 1600). Off removes halo + crest map entirely and cuts scene by 1–2 ms.
- Synced stage sums overstate the real frame by 1.15× (full, 1600) to 3.2× (straight, 856): the sync costs about the same per
  stage, so light frames inflate most. Shares, not milliseconds.
- Anya's phone readout of 11-28 (new phone, straight, SS2) still shows the old "Real speed (64 renders back to back)" line, so the
  githack link predates `94cb263` (real frames). Its "GPU stages" line with headlamps off still showed halo 5.0: the every-8th
  ring keeps probes from before the toggle (INFERRED: not cleared on option change; minor fix).

## RETRACTION + forest scene, 2026-11-28 — `sweep-forest-*.jsonl`, `save-forest.json`

**Retracted:** "trees are cheap on the Mac" (section above). `save-full.json` loads the *mountain pass* road (mountainPass on), and at
its pose trees off removes 36 of 123 objects; screenshots with trees on/off look the same. That sweep measured a view with almost no
trees. `save-forest.json` = save-full with mountainPass and endlessRoad off, i.e. the forest scene: 1143 objects with trees, 88 without.

Forest, 1600×900, uncapped real frames (stable: baseline 63.5 ms vs "forest again" 63.8):

| variant | crest | halo | scene | objects | real ms (p95) |
|---|---|---|---|---|---|
| forest d3 (save) | 7.0 | 35.4 | 9.6 | 17.6 | 63.5 (72.6) |
| trees off | 4.3 | 35.3 | 9.9 | 3.8 | 50.5 (59.5) |
| density 1.5 | 7.3 | 35.5 | 9.8 | 17.5 | 63.7 |
| leafy off | 7.1 | 35.6 | 9.7 | 17.1 | 63.6 |
| detailed models off | 5.3 | 35.2 | 9.6 | 10.7 | 55.8 |
| oncoming headlamps off | 1.0 | 0.2 | 5.2 | 13.1 | 12.7 (14.2) |
| headlamps off + trees off | 1.0 | 0.1 | 6.4 | 4.2 | 6.5 (7.6) |

The 856×482 run of the same list is **not usable**: its first rows had compose/glare/final at 3–4 ms that fell to 0.6 later, and
baseline vs "again" differ by 14 ms (44.8 vs 30.9). Something was still loading or warming. Rows kept in the file, flagged here.

**OBSERVED (Mac, 1600):**
- Trees cost ~13 ms of a 63.5 ms frame (−20 %), matching Anya's Mac reading (30 → 50–55 fps). Most of it is the objects stage
  (17.6 → 3.8), plus ~2.7 ms of crest map: trees cast traffic shadows (the crest/shadow stage also drops).
- Detailed models cost ~8 ms here (objects 17.6 → 10.7).
- density 1.5 vs 3 and leafy off change nothing in this view. INFERRED: the forest scene's tree count isn't driven by `density`
  near the road, or the visible trees are capped; not checked.
- Oncoming headlamps are ~80 % of the forest frame (63.5 → 12.7). With them off, trees are still half of what's left (12.7 → 6.5).

## Glare flicker through trees (read on origin/glare-model, not measured)

`D.glareSources()` (`js/drive.js:899` on glare-model) drops a lamp from the glare list when one ray from the eye to the lamp centre is
blocked (`occluded(...) continue`). The veil, scatter tail and starburst are all per source, so each one switches fully on or off in
a single frame. There is no ramp and no partial visibility: a lamp behind a trunk is a binary strobe.

## Benchmark mode (BEN), 2026-11-28

Built: `js/drive-bench.js` (buttons **Benchmark** and **save benchmark** in Performance > Timings, shown with GPU stages + Debug
timings + GPU renderer), scenes in `samples/bench/` (Anya's saves: forest = t-junction 11397 m, city = intersection 11092 m,
mountain = 40R 12549 m), `tools/bench-run.js` (same run headless on the Mac, uncapped), `tools/bench-read.js` (table + screenshots,
several files side by side), test `tests/regress/BEN-benchmark.js` (5/5), gate-mapped. `timeFrame()` takes `{ real, realWarm }`
and n = 0 skips the stage breakdown (GST still 17/17). The bench PROFILE is Anya's medium look with SS off.

First Mac run (856×482, `flux-bench-mac-856.json`, 36 s): frames are 6–12 ms there and the real-frame mean swings ±20 % between
identical rows (forest baseline 6.7 vs again 8.5; quick run "trees off" −57 % vs −16 % here). At this size the Mac is too fast for
the benchmark to resolve small changes: use the phones (50–80 ms frames) or run the Mac at CW=1600 CH=900.
**OBSERVED:** forest and city have **no halo** in the bench: those saves have clear air (visibility null), so the oncoming scatter
has nothing to light. Only mountain (visibility 3000 m) exercises the halo: haze off and scatter off each cut ~40 %.
- Profile v2 (11-28, Anya): haze (visibility 3000) in every scene, so forest and city exercise the halo; a "wet road" step in city
  and mountain (wetness 0.6, sheen with ggx streaks, bounce, bounce plane). Quick Mac check: all 13 steps record; city headlamps
  off −47 %, wet road +38 %.
- **Bug found by the benchmark (OBSERVED, not fixed):** wetness + wetSheen + wetVeil + wetBouncePlane on a tiles road crashes the GPU
  renderer: `drive.js:888` (`glareSources` mirror) calls `opts.A.surface(...)`, and the tiles world's A has no `surface`. The drive
  falls back to the CPU picture until a reload. Same line on origin/glare-model; from e15bad0 (11-05). The bench leaves wetVeil off
  and now aborts with an error if `V.glFailed` is set mid-run.
