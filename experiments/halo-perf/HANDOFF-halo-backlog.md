# Handoff: oncoming-halo optimisation backlog (2026-11-28)

Branch `halo-perf` (An0nya/flux-sketchpad), worktree `~/Projects/flux-hdr-spike`. Companion to `HANDOFF-object-shader.md`
(scene/object pass) in the same folder; evidence for both is in `NOTES.md`. Labels: **OBSERVED** = measured or read in the code;
**INFERRED** = reasoning, not tested. Priorities are Anya's: temporal accumulation first, the CDF fix if it's easy, Crysis mode for fun.

## What we know about the halo's cost (OBSERVED unless marked)

- The cost is the **table build**; scene shaders reading the table cost < 1 ms (Mac build-vs-read split, NOTES "Build vs read split").
- The build scales with **lamps × cells in their footprint × steps**. On the Mac crawl save: 76 ms; `scatterCull: fast` → 18 ms;
  haloDiv 4 → 16 ms; 2 cars → 20 ms; 12 bins → 31 ms. Crest occlusion costs ~20 ms there. The swarm's four newer features cost ~2 ms.
- Old iPhone, lean save with one car at 16 m: halo screen 14–70 ms depending on table size and refine; new iPhone 5–9 ms.
- The **crest map** stage (7–13 ms on the old phone) runs only with a halo and is built when crest occlusion **or** traffic shadows is on.
  Untested: both off at once.
- The WebGL table is width-capped: bins sit side by side, so 32 bins × 512 cells = 16384 = MAX_TEXTURE_SIZE.

## Measuring: Mac or phone?

- **On the Mac (any session can do it):** relative effects, i.e. "does this change cut halo screen, by how much, does the picture change".
  Tools: `halo-ablate.js` (frame and build time per variant, saves loaded, any canvas size), `halo-energy.js` (halo light totals
  per region), the GST readout in a headless page, and page tests with pixel pins. Mac numbers rank changes correctly for the
  build, since it's linear in work.
- **On the phones (Anya):** absolute fps, the old GPU's disproportions (scene 5–7×, halo up to 7.7× slower than the new phone),
  Safari shader-compile behaviour, and thermal throttling. Use "Time this frame" with a loaded state; read stages as shares of
  the "Real frames" line.
- So: develop and A/B on the Mac, then confirm on the phones at each milestone.

## 1. Temporal accumulation for the halo table (main item)

**Idea.** Spread the march over frames. Each frame samples the table at a different sub-step offset, blends it into a history
table, and reprojects the history so it lines up after motion. That gives fewer steps per frame for the same converged result,
or a coarser table without the grid showing. It's the standard froxel-fog approach (Wronski 2014, Frostbite 2015).
It can be prototyped in **WebGL**; it doesn't need the WebGPU port.

**What exists (OBSERVED):** `haloJitter` 'interleaved'/'jittered' vary offsets across neighbouring cells and the blur averages them;
'jittered' is a fixed hash, so it doesn't change per frame. The own-beam air table already cycles 8 jitter seeds over frames
(`scatterCycle`, `drive-three.js` ~l.109–280), with no reprojection, because our lamps move with the camera.

**Plan sketch (option `haloTemporal`, default off):**
1. A per-frame phase k = frame % N picks the sub-step offset (reuse the interleaved pattern's offsets) and cuts steps per bin
   (6 → 6/N).
2. A history pair of the bin table (ping-pong). After the build, a blend pass: `hist = mix(reproject(hist), current, α)`, α ≈ 1/N…0.25.
3. **Reprojection:** the table is screen-space. For our camera motion, map each cell through the previous frame's camera
   (eye/yaw/pitch are in the uniforms). **Lamp motion** (oncoming cars, ~40 m/s closing) can't be reprojected that way: use
   neighbourhood clamping (clamp history to the current frame's local min/max), lower α near fast or near lamps, and reset on
   lamp spawn, key change or setting change.
4. Alternative worth a spike: accumulate in the **lamp-relative polar table**, which moves with its lamp, so history lines up for free.
5. Measure: halo screen ms (should drop ~N×), plus a ghosting check with an oncoming car passing (screenshots at a few distances).
   Pixel pins will differ by design, so add new pins with the option on, and show Anya before/after.

## 2. CDF moment mode (`haloMoment: 'moment2'`, UI "moment: CDF"): low priority, fix if easy

**Symptom (Anya):** weird artifacts. **INFERRED cause (from the code, untested):** the second table stores raw, prefix-summed Σw·s²
in **half floats** (`m2bin`/`m2cum`), and the lookup gets the variance as E[s²] − E[s]² after differencing prefix sums
(`drive-three-shaders.js` ~l.164–173). At 100 m, s² ≈ 10⁴ with ~3 significant digits, so a bin's true variance (~75 m²) sits in
the rounding noise. It also overflows past s ≈ 256 m (half max 65504), and Anya runs 400 m range.
**Fix options:**
- Store the central moment per bin, Σw·(s − bin centre)², not prefix-summed (small numbers).
- Or make the m2 targets 32-bit float.

**Confirm first:** read `m2cum` at an artifact pixel and compare with the CPU twin (`haloLookup` in `drive-three-halo.js`).
**Also remove** the unconditional per-frame readback `halo.m2dbg` in the moment2 path (a pipeline stall every frame;
looks like debug leftovers).

## 3. Crysis mode (for fun)

A preset: crossing refine 2048, shadow maps 2048×1024, polar 1024×256, > 32 bins, everything maxed.
**Walls (INFERRED):** `HALO_MAX = 32` (shader arrays) and the side-by-side bin layout (32 × 512 = 16384 px). A 1024-wide polar
at 32 bins would need 32768 px. WebGL route: move bins into texture-array layers (`sampler2DArray`, one layer per bin or group),
which also lifts the screen-table width cap. WebGPU route: a 3D texture / storage buffer, free with the port. Presets live in
`js/share-presets.js` (check how the existing look presets are declared before adding one).

## 4. Smaller halo levers to test (cheap, phone readings)

- **Crest occlusion off + traffic shadows off** together: does the crest map stage (7–13 ms, old phone) go away, and how much does the look change?
- Table size (1/2.8 vs 1/1.8) and refine (0 / 32 / 128) at one loaded pose, with "Time this frame". The earlier comparison was
  retracted (stale readout line), so this is still open.
- Polar: per-lamp is sharp but expensive and shows its grid; auto shortens the beam (Anya). `halo-energy.js` checks whether
  light is lost or only smeared (written, not run yet).

## 5. The WebGPU compute port (original handoff item 3, deferred)

Still valid for headroom: froxel compute (one thread per screen cell walks its slices front to back with all lamps, prefix in-thread),
tiled light culling, a 3D table without width caps. The catch is getting the result back into WebGL every frame.
`hdr-spike` probe D measured the Safari canvas copy blocking ~4.2 ms (see `experiments/hdr-headlamp/README.md` on hdr-spike).
Only worth it once the build cost after 1 and 4 still dominates, or when the drive moves to WebGPU.
