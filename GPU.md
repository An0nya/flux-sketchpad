# GPU trace (WebGPU) — what exists, how far it matches, what to do next

Status 2026-10-11: built, validated against the CPU engine in Chromium (SwiftShader software WebGPU), **off by default**,
**not yet timed on a real GPU**. Files: `js/gpu-trace.js`, `tests/gpu.js` + `tests/gpu-page.js` + `tests/gpu.html`,
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

## Where it is used (all opt-in)

- **Page trace:** Simulation → Advanced → *GPU trace (WebGPU, experimental)*. Per browser (`localStorage flux/gpu`), like
  the solve time limit: a property of the machine, never saved in a scene. When on, the page loop keeps one batch in
  flight (sized to ~150 ms from the measured rate) and redraws as before; the footer says `· GPU`. Any GPU error drops that
  run back to the CPU from where it got to.
- **Solvers:** `tools.traceAsync(surfaces, o)` — same options and result as `tools.trace`, plus `res.gpu`. On the GPU only
  when the user switched it on and the trace needs nothing GPU-less; otherwise it is the CPU trace in a promise. **No solver
  calls it yet**: `tools.trace` is untouched and stays synchronous, so every existing solver gives byte-identical results.
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

## Speed: unknown on real hardware

SwiftShader is WebGPU on the CPU (4 threads here) and runs ~4× *slower* than V8 single-threaded: 0.1 vs 0.4 M rays/s.
Those numbers say nothing about an M4. To measure: `python3 tests/serve.py 8746`, open
`http://localhost:8746/tests/gpu.html` in Safari 26 / Chrome, press *Quick*. Or `node tests/gpu.js --cases speed` on the Mac
(Playwright's Chromium uses Metal there). Guess, not a measurement: tens of M rays/s, i.e. 20–100× one CPU core.

Known costs that will matter once it's fast: per call it creates and maps buffers sized to the whole accumulator (grid + every
stream + guide table, tens of MB in Spec mode) and 20 B/ray when hits are recorded; the hot-cell atomics contend. Fixes if
the bench shows them: persistent buffers, reading back only touched ranges, a 16 B record.

## Where the time goes today (CPU profiles, box fixture, ECE, one solve each, this container)

| solver | wall | in the ray loop | hot spots |
|---|---|---|---|
| dish-fit-auto | 17 s | **70 %** (17 traces, 6.8 M rays) | the trace |
| opus-mosaic-auto | 81 s | 28 % (20 traces, 13 M rays) | `best` 29 %, `blobDelta` 20 %, `tryAt` 10 % (local search) |
| spec-hl-v3 | 116 s | 44 % (3 judge traces + its own exit-list traces) | `traceUnit` 9 %, `addMut` / `moveDelta` / `pc` 21 %, `finishPattern` 8 % |
| spec-hl-v2 | 32 s | 31 % | — |
| sqm-hl / sqm-hl-ideal | 50–58 s | **5 %** | polish `trial` + `costPx` 31 %, OT Newton `evalF` 15 %, `logBlur` 14 %, `footprint` 9 % |
| fill-fix | 16 s | 0 % | — |

And the page (10-10 note): a 500 k trace spent ~5 % of its wall time tracing; the redraws were the cost (fixed by redraw
throttling). So a GPU trace alone speeds up dish-fit-auto-like tuners, Refine to 8–50 M, and final-pick verification — not
SQM, and not the page at default ray counts.

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

## WebGL scene pane (not built)

`js/render.js` draws the Scene and Optics views with Canvas 2D (orthographic camera, facets as polygons, the heat map as an
affine image, ray polylines). A WebGL2 pane would be a rewrite of `drawScene` / `drawSurfaceView` (~500 lines): tessellated
facet meshes (clip polygon + sag), instanced lines for envelope and paths, the heat map as a texture, hits as point sprites
(millions, which Canvas can't draw), picking kept on the CPU camera math. No three.js (the app has no build and runs from
file://; vendoring it is ~600 KB). Independent of the trace backend; worth doing when redraw time is the complaint again.
