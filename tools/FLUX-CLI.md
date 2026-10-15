# flux.js — the command-line front door (for agents and scripts)

`node tools/flux.js <command> …` loads the same `js/` files the page loads (via `tests/load.js`) and prints **JSON on
stdout**. Errors go to stderr with exit code 1. No browser, no npm install. Start here instead of hand-wiring `RF.*`.

| command | what it answers |
|---|---|
| `list solvers` | every bundled solver: id, file, group (default / legacy / benchmark), model credit |
| `list spec-presets` | Spec presets (ECE R112, FMVSS 108 …): id, label, verified |
| `list sources` | light-source presets (LEDs, R37 halogen filaments …) |
| `scene <scene.json>` | summary: mode, solver, source, envelope, surface counts per group, sim, target |
| `trace <scene.json> [--rays N] [--spec id,id]` | Spec-mode scene or `--spec`: far-field peak cd + where, lm in window, pass/fail/unsure per preset with every row. Other modes: delivered fraction, paint fidelity, spill, coverage, U0 |
| `compare <a.json> <b.json> [--rays N] [--spec id,id]` | traces saved designs under common settings; A/B metrics, per-preset verdict counts and rows, and B − A deltas as JSON |
| `solve <scene.json> [--solver id] [--set k=v …] [--out new.json]` | runs a solver exactly as the page's host does (inputOf → solve → verify → apply). Default solver = the scene's, else the app's preferred one. A `--set` the solver would silently change is an error |
| `heatmap <scene.json> --out ff.png [--rays N] [--scale k]` | far-field image: sqrt(cd / peak), cividis colour map (no red/green), grey H-V crosshair, 1 px = one 0.05° bin × k. JSON gives the degree range so pixels can be mapped back |

Spec judging uses the Spec panel's recipe: a quarter of the rays as a pilot, then guided rounds. Results labelled
`scene:<preset>` use the Spec settings SAVED in the scene (aim tolerance, kernel, re-aim …). A bare preset id applies that
preset fresh. The two can differ: `examples/sealed-beam-7in-low.json` reads 15/7/4 against its saved LB2V settings and
14/11/1 against a fresh LB2V (2 M rays, 2026-10-14).

Examples:
```
node tools/flux.js trace examples/sealed-beam-7in-low.json --rays 2e6 --spec fmvss-lb2m
node tools/flux.js solve my-scene.json --solver sealed-beam-v1 --set beam=high --out solved.json
node tools/flux.js heatmap solved.json --out ff.png
```

## Layer 2: the real page (Playwright)
For what Node can't draw (WebGL drive view, WebGPU traces, the panels as the user sees them). Each call starts its own
static server on a free port and its own headless Chromium on the real GPU (`channel: 'chromium'`), so it never touches
the shared Browser pane and two calls can run at once. A few seconds of start-up per call.

| command | what it does |
|---|---|
| `shot [scene.json] --out x.png [--pane result\|scene\|editor\|optics\|page] [--display ff\|drive\|road\|grid\|hits\|smooth\|fid] [--expand] [--mode A-D] [--viewport WxH] [--mobile] [--wait ms]` | loads the scene, waits for the solve and trace to finish, screenshots one pane (or the page). `--mobile` = 390×844 at 3× with touch (the F1 ray cap applies, as on a phone). JSON reports mode, display, ray count, whether the GPU traced, and any page errors |
| `page [scene.json] --eval "<expression>"` | the expression's value as JSON, evaluated in the live app (`RF` is the app). Promises are awaited |

Playwright is found from `$PLAYWRIGHT`, a global install, or `~/Projects/agent-qa/node_modules/playwright`.

## Layer 3: api.json
`node tools/flux.js manifest --out api.json` writes the repo-root `api.json`: every solver with its settings (keys,
types, ranges, defaults, options), Spec presets, light-source presets, examples, the commit. GitHub Pages serves it next to
`index.html`, so a reader with no browser (a chat model, a crawler) sees what exists. `tests/flux-cli.js` FAILS when it is
stale: regenerate it after adding a solver, a setting or a preset.

## A/B comparison

```
node tools/flux.js compare a.json b.json --rays 300000 --spec fmvss-lb2m
```

No solver runs. Comparison uses the same `RF.Compare` implementation as Result → Compare A/B, including the pilot
and guided trace rounds. Both designs use B’s seed and the greater bounce limit (at least 3), a common far-field
window, and B’s spec and road settings. `--spec id,id` applies fresh presets; without it both use B’s saved spec.
Multiple presets share their combined window and finest bin size; mixed angle conventions must be compared separately.
Both beams are independently aimed by the same judging procedure. The pictures share axes, cividis colours and
one intensity scale. `diff` contains numeric B − A deltas or null for unavailable metrics and string verdicts.
Metrics: lumens in the common window, peak cd at the spec kernel, IIHS-style 5 lx right/left reach, quarter-peak core
width/height, paint fidelity against each design’s own painting, and pass/fail/unsure counts per requested preset.
Different paintings make fidelity a comparison of each design against its own brief; the other rules are common.
This is a new comparison trace: sampling counts and measuring distance can differ from an existing Result report.
CLI defaults to 2 M rays (like `trace`); the page defaults to 300k and exposes the ray count.

In the page, Pin as A snapshots the current saved geometry (including enabled groups). A remains fixed during edits
and undo/redo. Replace A and Unpin A are explicit. Compare / Refresh runs in a separate, stoppable worker; editing B
marks the displayed result out of date. Side by side / A only / B only share the same scale. Arrows, signs and blue/orange
mark differences; an increase does not necessarily mean an improvement.

Pinned A is stored separately in IndexedDB for reload recovery. Snapshots at most 256 KiB (UTF-8 JSON) are also embedded
as optional `compareA: { version: 1, scene: ... }` metadata in scene JSON. Larger pins stay browser-only and the UI says
so. No trace or solved scene semantics change; older files have no pin. Opening a different scene replaces/clears its pin.

Solve cache is off by default under Result → Solve cache. It stores verified solver output in IndexedDB, capped at
40 entries / 32 MiB of estimated serialized output plus record overhead, evicting least recently used entries first.
The key hashes the solver input, problem scene, sanitized settings and seed, solver id/version and registry source,
engine/host source fingerprints, budget, backend choice and thread count. Reload after changing app code to use its new
fingerprint. Re-solve anyway bypasses the next lookup; Clear solve cache leaves A intact. Storage failures visibly fall
back to solving. A cache hit restores surfaces through the normal verification/apply path, then retraces the design.
All worker solvers require the separate uncertain-solver opt-in: source inspection cannot prove that a helper never
uses a clock. For page solvers, clock/random/budget/delegation references in source are also treated as uncertain,
even progress-only clocks. This deliberately includes deterministic worker solvers. Preferences are per browser and immediate.
