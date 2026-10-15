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

Not here yet (planned): **Layer 2** = real-page commands through Playwright (`shot` canvas screenshots of Optics /
Result / Drive / Far field, `page --eval` to drive the live app) for what Node can't draw (WebGL drive view, WebGPU);
**Layer 3** = a generated static `api.json` manifest (solvers, params, presets, version) so a crawler without a browser
can see what exists.
