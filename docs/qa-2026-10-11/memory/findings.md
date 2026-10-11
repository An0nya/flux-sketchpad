# QA area: memory (port 8806) — HEAD 2dc83f6
Note: the BRIEF's `require(npm root -g + '/playwright')` fails here (no global playwright); scripts use /Users/anya/Projects/agent-qa/node_modules/playwright (Chromium 151).

### Mode B direction picker throws ReferenceError and never draws (Editor pane blank in Stamp mode)
- Severity: broken UI
- Repro: repro-picker.js — boot, RF.UI.setMode('B'), wait 3 s. Also direct: RF.Render2D.drawPicker(canvas, RF.UI.vPick, scene, reports, null).
- Observed: "ReferenceError: clearZero is not defined" (3 console errors in 3 s; one per redraw); Editor pane shows only the caption and legend, no polar map. Expected: the direction-from-source picker image.
- Evidence: picker-modeB.png; direct call returns the ReferenceError.
- Reproduced: 2 of 2 (repro-picker.js, and the long-session trial run hit it on each Mode B visit)
- Cause (confirmed by reading): js/render2d.js:128 in pickerImage() uses `clearZero && !(v > 0)` — neither `clearZero` nor `v` exist in that function; the line was copy-pasted from gridCanvas (render2d.js:65) in commit 91de232 "Inspector: show a selection as if it were alone". Because it throws before `pickerCache = ...` (line 131), the cache never fills and the whole picker loop (120×120 dirInfo calls) re-runs and throws on every draw.

### README claims "never uses fetch, XHR, workers" and "No server needed"; the code uses all three, and file:// silently loses 35 of 37 solvers
- Severity: wrong result (docs) / broken UI on file://
- Repro: repro-file.js — open file:///Users/anya/Projects/flux-sketchpad/index.html in headless Chromium, wait for boot.
- Observed: only 2 solvers registered (spoke, constellation; 0 worker solvers), scene.solve.id falls back to 'spoke'; console "Fetch API cannot load file:///.../solvers/index.json. URL scheme "file" is not supported." No notice in the UI tells the user the bundled solvers are missing. Over http the same page registers 37 solvers and boots with 'auto' (a worker solver).
- Expected per README.md:10-12: works fully from file://, no fetch/XHR/workers.
- Code: js/solver-host.js:22 `new Worker('js/solve-worker.js')`, :89 and :92 `fetch('solvers/...')`; js/ui.js:359 `new Worker('js/preview-worker.js')`, ui.js:1377 `fetch('samples/' + k + '.jpg')`; js/solve-worker.js:35 importScripts of a Blob URL.
- Reproduced: 1 of 1 (Chromium). Safari's file:// rules differ (it may allow some of this); not tested.

### Idle page never goes idle: the first-load Optics turntable redraws every frame until the user drags the Optics view
- Severity: perf/memory
- Repro: workers-idle.js part "idle" (boot, no input, sample every 5 s for 60 s via CDP Performance.getMetrics, no forced GC), then drag #surface-canvas once and sample 30 s more ("idle-touched"). Data: workers-idle.csv.
- Observed (Chromium headless): untouched, main-thread TaskDuration grows 5.15 → 24.02 s over 61 s of idle (~31% of one core busy), JS heap saw-tooths 10 → 36 MB between GCs (steady allocation), renderer RSS 543 → 384 MB. After one drag on Optics (RF.UI.orbitFirst → false): TaskDuration +0.2 s over 30 s, JS heap flat at 8.0 MB.
- Expected: an idle page with nothing changing should not redraw or allocate.
- Code: js/ui.js:1329-1344 — orbitWanted() returns true while ui.orbitFirst (only cleared by orbitTouched, i.e. a hand move of the Optics view); orbitFrame calls drawSurfaceView() every rAF, and a 250 ms setInterval (ui.js:1344, never cleared) restarts it. Stops only when the tab is hidden, Optics is collapsed, or reduced motion is set.
- Reproduced: 1 of 1 measured run; the behaviour is also the documented intent in the code comment, so the bug is the cost, not the motion.
- Safari relevance (inference, not measured): a continuous per-frame canvas redraw plus garbage is the kind of load where WebKit's lazier GC and canvas backing-store retention can show as high idle process memory; a strong candidate for part of the 1.4 GB idle figure. Untested in WebKit.

### RF.Modes.geometry caches every distinct painting forever (unbounded Map)
- Severity: perf/memory
- Repro: repro-geocache2.js — call RF.Modes.geometry(randomPaint, 100, 3) for 2000 distinct paints, GC, read CDP Runtime.getHeapUsage. Output in geocache2.txt.
- Observed: ArrayBuffer backing storage after GC 11.5 → 35.4 → 59.4 → 107.4 MB at 0 / 500 / 1000 / 2000 entries (~48 KB per entry at res 100, linear, survives GC); JS heap +3.3 MB. Expected: a bounded cache (the previous one or a small LRU).
- Code: js/modes.js:31 `const geoCache = new Map()`; :34-45 sets an entry (Float32Array R² + Int8Array R², plus a R²/7-char key) per distinct paint and never evicts. Page-side caller: js/ui.js:604-611 runs RF.Modes.evaluate after every finished Mode A trace, which calls geometry() (modes.js:82,110,135,166) with the current painting. Each new painting (stroke, pattern, image import, preset) adds an entry; ~0.2 MB each at res 200. Also loaded in the solve worker (js/solver-env.js), where a worker terminate resets it.
- Reproduced: 1 of 1 (mechanism measured with synthetic paints; the per-stroke growth rate in real use is computed, not measured).
- Not Safari-specific, but it is the one confirmed grow-only structure on the page.

## Part 1 result: long-session memory (observation, Chromium 151 headless, dpr 1)
Script longsession.js, data long.csv (one row per cycle, sampled after 2x HeapProfiler.collectGarbage), errors long.errors.txt.
49 cycles in ~8 min: 16 mix (preset → modes A/B/C/D → spec standard → spoke/constellation solve at 100k rays → every 3rd cycle a worker solve replaced mid-run → 7 Result views, 4 surface views, orbit drag, collapse/expand panes), then 6 each of presets-only, solves-only, views-only, worker solve+replace, spec+ff/road/drive, then 3 idle (20 s).
- Not reproduced: no monotonic growth. Nodes 4.6-5.9k, listeners 670-930, Documents 1, DOM canvases 4, detached canvases held by RF 9 (constant from cycle 1), canvas pixels 4.5-7 MB: all flat.
- Renderer RSS swings 470-1190 MB with no trend; peaks follow mix and spec cycles (far-field grids, drive render). Typed arrays reachable from RF: 23-125 MB, also swinging, dropping back each time. Far-field grids at 0.1 degree are about 6 Float64 arrays x 270k bins per grid (js/farfield.js:66-127), so 10-15 MB per grid per trace.
- JS heap after GC went 12.5 (boot) → 15-25 (middle) → 25.6 / 26.5 / 34.6 MB in the 3 idle samples at the end. Partly the undo history (93 of its 100-entry cap, 2.8 MB as JSON, js/history.js:93 + ui.js:1776), which plateaus at the cap. The idle-end rise is NOT attributed (no heap-snapshot diff taken); labelled unexplained.
- Which cycle type drives it: spec/mix cycles drive the transient peaks; none of the per-phase blocks shows retained growth.
- Worker churn: 8 abort-and-rebuild cycles of the solve worker (workers-idle.csv, "worker" rows) left renderer RSS flat at 414-458 MB and page.workers() at 2. Caveat: verify-worker.js confirms the replace path does run (aborts tir-array-v2, 'auto' completes in 8-12 s), but the "worker" phase of longsession.js finished in ~2.5 s per cycle, so those 6 cycles may not have run a full solve; the mix-phase ones did.
- Retina check (repro-hits-dpr.js, hits-dpr.txt): a 2M-ray trace with Result on Hits at deviceScaleFactor 2 peaks at 68 MB backing store vs 66 at dpr 1; the hits canvas only goes to 512². Nothing there.
- Per-worker heap was not measured: CDP sessions to the workers failed ("err" column in workers-idle.csv).

## Suspected (not reproduced)
- Safari-specific candidates for the 1.4 GB idle / 3 GB solving figures (inference; WebKit not available here):
  1. The idle Optics turntable (finding above): constant redraw + garbage at idle. Most likely contributor of the ones found.
  2. js/ui.js:640-659 hitsCanvas allocates a new Float64Array(M*M) (up to 2048² = 32 MB) plus a new ImageData (render2d.js:59 createImageData on every gridCanvas call, even when the canvas is reused) per rebuild; rebuilds happen about once a second per slot while a trace runs on the Hits view. Chromium collects these quickly; WebKit's handling of large short-lived buffers may not. Not reproduced at dpr 2 in Chromium.
  3. js/solve-worker.js:35 makes a Blob URL for each solver source and never revokes it; every abort (solver-host.js:46-48) rebuilds the worker and re-imports all ~35 bundled sources (1.7 MB). Per spec these are freed when the worker ends; if WebKit keeps worker-created blob URLs registered longer, each Stop or replaced solve would leak ~1.7 MB. Not measurable here.
  4. Canvases whose width is set on every rebuild (js/spec-ui.js:329, 346, 754, 901; js/ui.js:678) reallocate their backing store each time. These are keyed caches, so it only happens on a key change.
- js/history.js: each undo entry is a full JSON-parsed copy of scene intent including the paint grid; at res 200 the 100-entry cap holds ~100 x 40k-number arrays (several MB of JS objects). Bounded, but not small.
- Static audit (Part 2), checked and found clean: engine grid binning clamps both edges (engine.js:218-219); farfield binning bounds-checks (farfield.js:85-86); photometry fidelity divisions guarded by the `paint.some(w>0)` early return (photometry.js:203); notices capped at 8 (controller.js:24); global listeners/ResizeObservers attached once at boot (ui.js:1606-1711); the picker cache and hitsCache are keyed and reused; download/image-import object URLs are revoked (panels.js:678, ui.js:1441/1446); the preview worker is a single long-lived instance (ui.js:359).
