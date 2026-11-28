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
