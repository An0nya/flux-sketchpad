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
