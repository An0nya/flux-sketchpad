# GPU trace (WebGPU) — what exists, how far it matches, what to do next

Status 2026-10-15: built, validated against the CPU engine in Chromium (SwiftShader software WebGPU), **on by default for the
page trace wherever WebGPU gives an adapter** (your choice in the checkbox wins), timed once on the M4 (see Speed). **Solver workers follow
the same default since W3c** (see "Solvers" below), and dish-fit-auto / sealed-beam-v1 / sealed-beam-v2 use it by default. Files: `js/gpu-trace.js`, `tests/gpu.js` + `tests/gpu-page.js` + `tests/gpu.html`,
`tests/gpu-app.js`.

## What it is

`RF.GpuTrace` runs the engine's Monte-Carlo trace (`Engine.traceRange`) as a WGSL compute kernel: one ray per invocation,
the same BVH, exact quadric intersection, clip kinds, reflect / refract / TIR / exact-Fresnel / absorb, bounce cap, energy
floor, target grid, far-field streams, guided emission and its learning, recorded hits + first surface per ray. Every
source kind is sampled on the GPU (planar rect/disc, volume, point, opaque coil/sphere, dome walk, gaussian table,
multi-emitter mixtures). The first `pathLimit` rays (drawn paths) still run on the CPU.

**Same rays.** Ray i's random stream (core.js `streamSeed` + mulberry32) is integer arithmetic, so the GPU draws the same
u32 values as the CPU. What differs is floating point: WGSL has no f64, so everything is f32 (~1e-7 relative).

**Order-free sums.** Every deposit is rounded to 2⁻²⁴ of one ray's emitted energy and added to a 64-bit integer (two
u32 atomics with carry); the ledger is reduced per workgroup first. Integer sums don't depend on thread order, so a GPU
run is bit-reproducible on one device, and one dispatch ≡ two chunks (tested). Rounding: ≤ 3e-8 of a ray per deposit.

**Not on the GPU:** exit-ray lists (`P.recordExit`, used by spec-hl v1–v3's `patternsFromTrace`, `tests/spec.js`,
`diag-stray.js`) → `supports(P)` refuses and the caller stays on the CPU. Preview-worker traces (200 k, Watch solve) stay on
the CPU too.

## Where it is used

- **Page trace (default on):** Simulation → Advanced → *GPU trace (WebGPU)*. Per browser (`localStorage flux/gpu`), like the
  solve time limit: a property of the machine, never saved in a scene. **Never chosen → on wherever `navigator.gpu` exists**; the
  trace starts on the CPU and moves to the GPU as soon as an adapter and device are ready (any error, no adapter or a lost device
  leaves it on the CPU). Unticking stores `'0'` and that stays off. When on, the page loop keeps one batch in flight (sized to
  ~150 ms from the measured rate, never above `batchMax`) and redraws as before; the footer says `· GPU`. Any GPU error drops
  that run back to the CPU from where it got to. The solve worker follows the same preference (W3c): never chosen → on wherever
  `navigator.gpu` exists, unticked → off.
- **Per-device ray cap:** `RF.GpuTrace.rayCap(env)` (pure; tested in `tests/regress-node.js`, F1) returns `{ cap, batch, why }`
  from `{ gpu, limits, deviceMemory, mobile }`. Each signal can only lower the cap: touch-first device (UA mobile, or coarse
  pointer without hover) → 150 k; `navigator.deviceMemory` ≤ 2 GB → 100 k, ≤ 4 GB → 250 k; adapter storage-buffer limit at the WebGPU
  spec's 128 MiB floor → 250 k. Desktops with none of these have no cap. `batch` (rays per GPU call) is a twentieth of the smaller
  buffer limit, 64 k–8 M, and ≤ 262 k on a touch device. The numbers are judgement, **not measured on any phone**. The page
  traces `min(sim.rays, cap)`; the scene's own `sim.rays` is untouched (saved scenes mean the same), the footer says
  `capped from 500,000 for this device (why)` and the rays tile gets a `*`. Simulation → Advanced shows *Limit rays to this
  device* (only on a device that has a cap); unticking it (`localStorage flux/rayCap = 'off'`) traces the full count. The cap
  applies to the page trace on the CPU as well as the GPU; solvers and `tools.trace` use `sim.rays` as before.
- **Solvers:** `tools.traceAsync(surfaces, o)`: same options and result as `tools.trace`, plus `res.gpu`. On the GPU when the preference is on (default
  on with an adapter) and the trace needs nothing GPU-less; otherwise it is the CPU trace in a promise. The solve worker starts the device at its first
  `traceAsync` (a solve that never calls it never wakes the GPU); `RF.SolverHost.lastStats().gpuTraces` says how many of a solve's traces ran there.
  `tools.trace` is untouched and stays synchronous. Solvers that call `traceAsync` **by default**: `dish-fit-auto` (`traceGpu`), `sealed-beam-v1` and
  `sealed-beam-v2` (`tuneGpu`); `opus-mosaic-auto` has the setting off (1.17x only: its traces are 22 % of the run). A scene that saved the setting keeps it.
- Node / headless runners: no WebGPU → `traceAsync` is the CPU trace.

## How close is "the same"?

`node tests/gpu.js --swiftshader` (all pass, 2026-10-11):

| check | result |
|---|---|
| emission directions, 8 source kinds, 50 k rays each | p50 5–11e-8 rad, p99.9 ≤ 1.6e-6 rad; dome: 0.014 % of rays take the other Fresnel branch |
| Mode A test scene, 400 k rays, recorded hits | **0 rays** with a different first surface; grid L1 7e-6; landing shift p99 3.5e-4 mm on 20 mm cells |
| dome LED / gaussian disc / HB3 coil / 2 emitters / lens + shield + paraboloid dish | ≤ 0.0017 % rays differ; grid L1 ≤ 7e-5; ledger ≤ 1e-5 of emitted |
| Spec box (auto solver, ECE), unguided 1 M at the CPU's aim | rows agree to **0.000 σ**, no verdict flips |
| Spec box, guided 2 M (the solver/host default) | rows agree as two independent estimates: max 1.5 σ√2; lm in window 984.57 vs 984.65 |
| page (`node tests/gpu-app.js --swiftshader`) | page trace on GPU, 0.0004 % rays differ vs CPU; worker `traceAsync` on GPU agrees to 3e-8 in lm |

Two things to know:

1. **WGSL's built-in trig is not accurate enough.** The spec allows sin/cos 2⁻¹¹ absolute and atan2 4096 ULP, and SwiftShader
   uses that slack (1e-4 rad emission errors, 0.14 % of rays on a different facet). The kernel has its own polynomial
   sin/cos/atan2/asin (~1e-7) with exact range reduction from the integer draw. Don't use the builtins in this kernel.
2. **Guided traces are chaotic, and so is the judge's aim.** A guide weights dim far-field cells by 1/I; the few rays f32 moves
   across a 0.1° bin edge shift the guide by up to 1.2 %, so later rounds are a different (equally valid) sample. Likewise
   the cut-off aim on the same rays moved 0.06° (−0.48° vs −0.37° inflection) and flipped two borderline rows (75L,
   linearity). Same instability as between seeds (the 10-10 aim notes); the GPU doesn't add it, it exposes it.

## Speed

SwiftShader is WebGPU on the CPU (4 threads here) and runs ~4× *slower* than V8 single-threaded: 0.1 vs 0.4 M rays/s — says
nothing about a real GPU.

**Measured 2026-10-14, Apple M4 (adapter `apple` / `metal-3`), Playwright `channel: 'chromium'` + `--enable-unsafe-webgpu`
(real Metal, not SwiftShader).** The app's default scene (Mode A, `defaultScene()` + `regenerateA` → 100 facets, res 100, no far-field
streams), `recordHits` on as the page runs it, 240 drawn paths on the CPU, one `traceRange(0, N)` per call after a 4096-ray warm-up,
wall clock around the call (includes buffer creation and read-back). Two invocations, 3 runs each; the CPU is the page's own V8 engine
on the same machine:

| N | CPU (M rays/s) | GPU (M rays/s) | GPU / CPU |
|---|---|---|---|
| 500 k | 1.05–1.10 (455–475 ms) | 14.0–16.6 (30–36 ms) in the second invocation; 8.9–14.4 in the first | ~8–15× |
| 2 M | 1.06–1.10 (1.82–1.89 s) | 13.7–22.0 (91–146 ms) | ~13–20× |

Totals agreed (lm 1355.0319 CPU vs 1355.0318 GPU at 500 k; 1354.4307 vs 1354.4340 at 2 M). The run-to-run spread on the GPU is wide
(~±25 %); 6 runs per N is not a benchmark suite. Other scenes (Spec mode with far-field streams, guided traces) were not timed.
An iPhone/Android GPU: not measured.

Known costs: per call it creates and maps buffers sized to the whole accumulator (grid + every
stream + guide table, tens of MB in Spec mode) and 20 B/ray when hits are recorded (twice: the GPU buffer and its read-back copy); the hot-cell atomics contend. Fixes if
the bench shows them: persistent buffers, reading back only touched ranges, a 16 B record.

Buffer bytes for the page's 500 k default trace (from `layout()` and the `createBuffer` calls; default scene: res 100, 100 surfaces,
no far-field streams): accumulator 4·(78 + 4·10 000 + 6·100) = 163 kB, twice (GPU + read-back); hit records 20 B × 500 k = 10 MB, twice
= 20 MB (the page's first batch is ~300 k rays → 12 MB); plus the geometry/aux buffers (small), and on the JS side `Rr` (10 MB) and
the ctx hit arrays (~10 MB). So ~40 MB in all: **this alone is unlikely to crash a phone**, and the page's crash at 500 k has *not* been
reproduced or traced to its cause. Spec mode adds far-field streams (tens of MB, above). The cap is a guard, not a diagnosed fix.

## Where the time goes today (CPU profiles, box fixture, ECE, one solve each, this container)

| solver | wall | in the ray loop | hot spots |
|---|---|---|---|
| dish-fit-auto | 17 s | **70 %** (17 traces, 6.8 M rays) | the trace |
| opus-mosaic-auto | 81 s | 28 % (20 traces, 13 M rays) | `best` 29 %, `blobDelta` 20 %, `tryAt` 10 % (local search) |
| spec-hl-v3 | 116 s | 44 % (3 judge traces + its own exit-list traces) | `traceUnit` 9 %, `addMut` / `moveDelta` / `pc` 21 %, `finishPattern` 8 % |
| spec-hl-v2 | 32 s | 31 % | — |
| sqm-hl / sqm-hl-ideal | 50–58 s | **5 %** | polish `trial` + `costPx` 31 %, OT Newton `evalF` 15 %, `logBlur` 14 %, `footprint` 9 % (re-profiled in W3c, box-ece, below) |
| fill-fix | 16 s | 0 % | — |

And the page (10-10 note): a 500 k trace spent ~5 % of its wall time tracing; the redraws were the cost (fixed by redraw
throttling). So a GPU trace alone speeds up dish-fit-auto-like tuners, Refine to 8–50 M, and final-pick verification — not
SQM, and not the page at default ray counts.

## W3c rollout: what changed, what it measured (2026-10-15, Apple M4, Node and Chromium with the tab in front)

**sqm-hl profile (Node, box-ece, 100 facets, normal quality; self time of 38.5 s):** polish `costPx` 25.8 % + `trial` 12.4 % + `put` 8.3 % (= 19.1 s inclusive),
`footprint` 18.6 % (9.1 s inclusive, 24 % of the run), `logBlur` 8 %, OT Newton `evalF` 5.8 %. Rewritten for speed with **byte-identical output** (digests equal on box-ece for all
four variants and the default paint scene; `tests/sqm-reference.js` keeps the old code as a bit-exact reference): `footprint` accumulates into a dense scratch array in first-touched order
instead of a Map and writes convention-A angles without allocating; the polish caches ln T* and every pixel's current cost (one `costPx` per touched pixel instead of two) and uses scratch
arrays instead of closures and arrays per trial; `logBlur` clips its window at the grid edge once. After: 25.4 s (polish 11.6 s, footprint 4.4 s, logBlur 2.3 s, evalF unchanged 2.2 s).
Not done, and why: the polish is Gauss-Seidel over units (each unit's best move depends on the previous ones' applied moves) and one trial is microseconds, so it is not poolable; a
"skip units whose neighbourhood did not change" variant (exact) was tried and skipped 38 of 8,377 unit turns (63 % of turns move something), so it was dropped. The shaping candidates and
the shell ranking are independent in principle, but they are clock-governed and share one mutable problem object: a refactor, not done. `evalF` is `Math.log` / `Math.exp` on values
that change every Newton step: nothing exact to cache.

**Defaults** (a scene that saved a setting keeps it): Solver threads min(4, cores − 2) (4 here); worker GPU follows the page default; `dish-fit-auto.traceGpu`, `sealed-beam-v1/v2.tuneGpu` on;
`sealed-beam-v1.tuneAim` frozen (v2 already was). Without a GPU these are the same CPU traces (a solver that sees `res.gpu === false` on its first GPU batch returns to the pool path).

**Wall time, seconds, seeds 1 / 2 / 3** (sealed-beam: tuner seeds 12345 / 777 / 4242). Before = commit 5b9818b with its defaults; after = this branch with its defaults (Node: `--pool 4`, no GPU;
page: nothing stored in localStorage, so 4 threads and the Metal adapter). Timings were taken while another agent's browser kept 1-2 cores busy (load 3-5), so every row is CONTENDED, except the
"clean" column (load 1-2, seed 1, repeated afterwards). Outputs: Node before = after digest for every row except the sealed-beam-v1 tuner (frozen aim changes the search on purpose).

| solver | Node before | Node after | page before | page after | page clean before → after (seed 1) |
|---|---|---|---|---|---|
| dish-fit-auto | 5.7 / 3.4 / 4.7 | 4.1 / 2.6 / 3.4 | 5.6 / 3.3 / 7.9 | 3.1 / 1.5 / 1.9 (GPU) | 5.6 → 1.8 |
| opus-mosaic-auto | 29.2 / 29.3 / 27.4 | 14.4 / 15.5 / 14.7 | 34.2 / 33.0 / 43.2 | 27.2 / 20.6 / 19.4 | 33.1 → 16.5 |
| spec-hl-v3 | 44.3 / 42.8 / 41.5 | 16.6 / 14.6 / 16.4 | 40.3 / 40.0 / 58.0 | 24.5 / 20.0 / 25.8 | 39.4 → 14.1 |
| sqm-hl | 38.7 / 40.4 / 39.2 | 25.8 / 26.1 / 25.9 | 37.0 (s1) | 25.5 (s1) | 37.1 → 22.8 |
| sealed-beam-v1 tuner | 77 / 72 / 69 | 20 / 19 / 19 | 89 / 70 / 72 | 7.6 / 7.8 / 6.4 (GPU) | not repeated |
| sealed-beam-v2 tuner | 33 / 28 / 31 | 33 / 28 / 30 (no GPU in Node) | 31 / 29 / 42 | 8.2 / 8.1 / 8.1 (GPU) | not repeated |

**Quality** (the finished design traced with 1 M guided Spec rays; expected fails, lower is better, and pass/fail/unsure). Identical (same digest) wherever the code path is the same:
mosaic and spec-hl-v3 in every environment and thread count, dish-fit-auto in Node, sqm-hl everywhere. Differences:

| | seed 1 | seed 2 | seed 3 |
|---|---|---|---|
| sealed-beam-v1 before (scan, CPU) | 6.61 (18/6/2) | 6.61 (16/6/4) | 7.41 (16/7/3) |
| sealed-beam-v1 after, Node (frozen) | 6.54 (17/6/3) | 6.86 (17/6/3) | 6.04 (20/6/0) |
| sealed-beam-v1 after, page (frozen + GPU) | 6.41 (18/6/2) | 6.77 (16/6/4) | 6.73 (16/6/4) |
| sealed-beam-v2 before = after (Node and page, frozen already; GPU gave the same design) | 4.98 (17/4/1) | 3.41 (15/3/4) | 4.57 (15/4/3) |
| dish-fit-auto page, GPU vs CPU | 4.71 = 4.71 | 4.86 = 4.86 | 4.74 (13/4/2) vs 4.52 (9/3/7): the one seed where f32 changed the design |

Reading: mean expected fails of the v1 tuner 6.88 → 6.48 (Node) / 6.64 (page): not worse; n = 3 cannot rank them. dish-fit seed 3 is +0.22 expected fails with one more fail and four more passes: within the run-to-run
spread of these searches, so the GPU default stays, but it is the one place where the default changes a result.

**Threads, determinism:** same design for no pool / 0 / 1 / 2 / 3 / 4 workers: dish-fit-auto, opus-mosaic-auto, spec-hl-v3 (`tests/solver-rollout.js`, `tests/regress/W3c-solver-rollout.js`; W3b did 0-8).

**Background tab.** A tab behind another tab is demoted by the OS (W3b: 4.3-4.5x slower; an inaudible tone brought a 25.9 s solve back to 5.7 s). It is not reproducible in Playwright (visibilityState stays
'visible'), so this rollout re-measured nothing there; the flow is tested with a faked visibility. Behaviour now: off until chosen. The first solve that ran while the tab was hidden (it was hidden at the start or went
hidden during the run) asks once, when the user is back: "Keep it fast" (stores 1, ticks Simulation → Advanced → *Keep solving at full speed in a background tab*) or "No thanks" (stores 0, never asked again).
The question is a click, so the browser's autoplay rule is met; no AudioContext is created before it. A solve that ran only in the front never asks.

## What else is worth parallelising

The heavy solvers share one structure: per-facet **footprints** (a sparse far-field pattern from deterministic aperture ×
source samples — SQM `footprint`, spec-hl `traceUnit`, mosaic blobs) and a **local search** whose move is "shift / scale /
swap one footprint, cost = Σ over touched pixels". In order of payoff per effort:

1. **Solvers that already trace in a loop → `traceAsync`.** dish-fit-auto, opus-mosaic-auto, projector-liou's final pick
   (`await tools.trace` already: a rename), spec-hl-v3's 3-candidate check. One-line changes per call site in an async
   `solve`; results change only at noise level, and only when the user has GPU on.
2. **CPU work that isn't the GPU's job:** SQM's `logBlur` (14 %: a separable blur re-normalising every pixel) and the polish's
   per-trial allocations (`touched` arrays, closures, two `Math.log` per pixel per trial) look like 2–5× with plain JS. Tuners
   that try independent settings (the `*-auto` solvers, the planned Autotune button) can use a worker pool (M4: 10 cores).
3. **GPU footprints.** One kernel for every facet's footprint (facets × aperture × source samples → bins) serves SQM, spec-hl
   and the mosaic family. Noise-free like today; same numbers up to f32.
4. **GPU move evaluation.** All candidate moves of all units scored at once (Jacobi), then a non-conflicting subset applied.
   This changes the search (today's sweeps are Gauss–Seidel), so results change: a solver decision, not infrastructure.

## "Test configs with quick traces instead of computing them?"

Partly. Where the model is exact and cheap, tracing loses even on a fast GPU: SQM's polish scores a 0.05° aim move by
re-indexing a sparse footprint (microseconds, noise-free); a trace scores it with shot noise, and telling two nearby moves
apart takes millions of rays each, even with common random numbers. Where the model is *wrong*, the trace wins outright, and
the notes are full of those cases: SQM's T* passing the judge while the built HB3 beam fails 8–9 rows, projector-liou's
lens-path leakers and its `refine` loop that never converges, the cut-off aim that only exists in a trace. A cheap exact trace
makes "propose with the model, decide with the trace" affordable everywhere: verify K finalists instead of 1–3, Autotune by
traced score, retrace after every refine round.

A primitive that would serve every solver: `tools.traceMany([candidateA, candidateB, …], o)`: K candidates, the same rays
(common random numbers, so differences are low-noise), one GPU submission. Not built.

A CPU idea for the same goal: rays are deterministic per index, so after a move only rays whose path touches the moved facet
(old or new footprint; first surface from `rayK`) need retracing. Exact, and much cheaper than a full trace for single-bounce
reflectors. Not built.

## WebGL scene pane (built, opt-in)

`js/render-gl.js`, Simulation → Advanced → "WebGL scene view" (per browser, `flux/glScene`, off by default). A WebGL2 canvas sits under the 2D one in
the Scene and Optics views and draws the facet meshes (fills, edges), the target plane with the heat map as a texture, the ray paths (instanced
screen-space quads) and, in the Result display "hits", every recorded hit as a point sprite on the target plane. The 2D canvas on top keeps the source,
handles, gizmo, labels, selection outline, envelope and the dashed paths. The vertex shader is `Camera.project` (same clamp at the eye), so picking,
handles and fit stay on the CPU camera and agree with the pixels. No libraries. Canvas 2D is the fallback when WebGL2 is missing, the context is lost,
or a draw throws (`RF.RenderGL.failure()`); the page does not reload. With it on, the "Rays drawn" limit goes from 2,000 to 20,000.
Measured on an Apple M4 (real GPU): redraw is cheap in Canvas 2D at the default 240 rays (<= 11 ms with the readback); the win is many drawn rays
(2000 rays: 17-21 ms -> 5-7 ms) and per-hit points. Numbers and method: `tests/bench/scene-redraw.js`, `tests/bench/gl-hits.js`; check: `tests/regress/W3a-webgl-scene.js`.
Differences from 2D: facet edges are drawn after all fills (not interleaved in depth order), the envelope and dashed lines are on the 2D overlay (above the facets), thin lines are 1 device px minimum.
