# sqm-hl — a supporting-quadric (SQM) headlamp solver for Spec mode

Working notes, started 2026-10-06 with Anya (checkpoint written at ~60 % of the session; read this first when resuming).
Solver file: `solvers/sqm-hl.js` (GENERATED — edit `tools/sqm-hl/dev/*.js`, then `node tools/sqm-hl/build.js`).
Registered in `solvers/index.json` (live dropdown: "SQM headlamp (continuous reflector)"), v0.1, pushed 2026-10-06 night. Paint mode works (no `input.spec` → the painting is the target).

## The ask (Anya's words, condensed — all of it still binding)
- A NEW standalone solver using SQM for headlamp beams; a SECOND ("bonus", `sqm-hl-dish`) where the base shell/dish is not limited to the ellipsoidal SQM shell: chosen automatically (or by an input), try to FILL the envelope / capture as much flux as possible, fall back to a smaller area if needed; facets should connect edge to edge "for the most part".
- Compliance with the regulation (Spec mode rows) is PRIMARY. Fidelity to the paint is secondary; the paint is an optional weighted contribution (her paint = "a decent target, not the ideal one"). Secondary goals: IIHS-style reach, uniformity, a wide/bright/long/comfortable beam (intensity per degree of declination chosen so the road looks evenly lit from behind the lamp).
- Judge noise: don't chase exact wins. Loose bar = value ± error inside the limit and not an order of magnitude off. The stock grader can't be counted on (noise; her WebGPU/WebGL tracer comes later). Verify with bigger ray budgets only occasionally.
- LEDs are the requirement (default scenes: an up-facing 2×2 mm LED with a rectangular box above it; a rear-firing LED with a shallow box behind it). The HB3 filament fell by the wayside; her scene `~/Downloads/reflector-scene-2.json` (not in the repo) is the hard extra case. Moving the source for tests is fine; the solver must degrade gracefully for impossible placements. The envelope in that scene (Ø350 × 148 mm) is NOT a real 7 inch; the source was never deliberately placed.
- Facet budget: accept the full range. ~16 facets = a nominal beam, 40–50 = starting to pass, test at 100, 200–300 = the practical upper limit of the algorithm's cost.
- Settings: TWO TIERS (constraints/quality first; all other parameters in "Advanced"). Keep ranges OPEN (note default + reasonable range in the label; only physical limits as min/max — `RF.Solvers.sanitize` clamps number/range settings to min/max, so never set a `max` below what could be useful). Pre-restrictions to avoid long sweeps (e.g. "reflector area > 80 % of the envelope aperture").
- Time: 30 s ideal for a complex solver; ≤ 1 min upper limit for "fast" at 100 facets; 5 min is her personal limit (unless 1000 facets / 1 M rays per candidate).
- Few traces per solve (default time limit 120 s, user can raise it 1–30 min). Crossing AND diverging rays are both allowed; facets may have two curvatures (`vg` + `ax`).
- Stray light: a spare facet may act as a shield (reflect the offending light into a safe direction, or back to the source for a multibounce path); absorbing parts are free of the facet budget.
- Do not edit `js/` (report engine/modeling limits instead). STANDING PERMISSION to commit and push this solver and the next one when satisfied, unless the main engine had to change.

## What exists
`dev/` modules (each attaches to a private RF; the build wraps everything so RF is not polluted):
- `fwd.js` — FORWARD MODEL: exact far field of a facet list from aperture samples on the real quadric × emitter samples (skin/die/volume), flux weights cosθ·cosθ/r², occlusion-aware (nearer facets in front along the source ray) — model/trace window flux ratio 1.001, per-class intensity ratio 1.00 ± 0.05 (bright areas); dim (< 300 cd) areas are under-modelled (glow, stray). 0.1 s for 100 facets.
- `target.js` — the IDEAL BEAM T*(h,v) in cd: spec → per-pixel floors/ceilings (margin), road-driven plateau (illuminance ∝ distance^−γ, IIHS 5 lx at 100 m / 60 m, mount 0.65 m), foreground wash (sink for left-over flux), glow above the cut-off (dilated sign-point floors), cut-off line from the aim rule (flat on the oncoming side, 15° ECE / US step on the own side), log-domain blur for the edge, G fed back until the real judge on T* passes (R112 B 19/19, FMVSS LB2V 26/26, noise-free, 0.3 s).
- `plan.js` — aims: flux-weighted k-means over super-pixels, two tiers (main = equal-flux cells; dim = area-weighted wide units).
- `sqm.js` — directions (equal-area grid about the beam axis), damped-Newton semi-discrete OT (log β, soft-min τ schedule) for the confocal ellipsoids/paraboloids, hard assignment.
- `emit.js` — facets: fit scale ("cover only the flux the ideal beam needs"), hull polygons, EXACT envelope clip (chords), DECALS (compact patches for the dim units), two-curvature shaping (vergences to widen images to their cells).
- `pipeline.js` — the solve: coarse→fine OT, base facets, `realize` (tilt + shaping params on fixed geometry), model judge (`RF.Spec.evaluate` on the noise-free model field + analytic direct light), aim POLISH (translation-invariant footprints, tilt-only, trust region, revert on worse), optional verification trace.
- `solver-main.js` — registration, 24 settings (7 tier-1, 17 `adv`), quality presets (fast/normal/best), notes.
Harness (tools/sqm-hl/*.js): `lib.js` (judge a scene, loose verdict), `scenes.js` (box, led-back, slim, module, sealed7, file:…), `bench.js` (parallel runs → table), `run-on-scene.js`, `judge-scene.js`, `worker-test.js` (runs the built file in a worker that loads only `js/solver-env.js` files), `calib-test.js` (model vs trace by class; needs `build/sqm-hl.debug.js`), `ffpng.js` (far-field PNG with spec overlay, log cividis, no red/green), diagnostics (`diag-stray.js`, `profile-debug.js`, `sens-test.js`, `streak-check.js`, `assign-check.js`).
Run: `node tools/sqm-hl/build.js` · `node tools/sqm-hl/bench.js --solvers sqm-hl --scenes box,led-back,slim,module,sealed7,file:$HOME/Downloads/reflector-scene-2.json --load ../../solvers/sqm-hl.js --rays 8e6 --par 3 --tag x --budget 100` (from tools/sqm-hl; results in out/). Baselines: `--solvers spec-hl-v2` (registered by run-on-scene).

## Findings (observations unless marked)
1. Her saved SQM v0.3 design on R112 B: 6 sure fails (B50L 21 kcd, BR 25k, Zone III 85k, Zone IV 0, pts 1+2+3 104, linearity 1.5°). Its far field is a starburst of radial streaks. SQM v0.3 'best' = 234 s in Node (over the 120 s limit), same fails.
2. An axial filament makes every facet's image a streak (σ 0.5–0.9° long × 0.1–0.35° wide) pointing along the facet's azimuth about the axis; length = L·sinψ/r within 5 % (single facets traced alone, direct light removed by a same-seed difference). SQM's dish→beam pairing is rigid: corr(facet height, aim elevation) = −0.90, corr(left-right, aim H) = −0.95 (top of dish lights the bottom of the beam).
3. For compact LED boxes the natural SQM dish keeps most facets at ~½ of the available distance → die images twice as blurry as needed (footprint σ median 1.7° vs 0.6° when only the needed flux is covered). PRINCIPLE (built in): cover exactly the flux the ideal beam needs, from the best-fitting directions, with the biggest uniform scale → continuous surface, sharpest images. Non-uniform per-facet scale (homothety about the LED keeps aim and flux) fails: facets pushed out block each other's reflected rays (48/100 blocked).
4. Dim units must be small compact decals, not OT cells: a 0.6 lm share gets a thin ring-shaped cell whose hull spans half the dish and, with strong defocus (surface moves mm), steals 20–35× its flux.
5. A facet polygon is a convex hull → it can cover directions that have no mirror; fixed by clipping polygons to the envelope exactly (not by clipping against uncovered directions: that cut up to 80 % of some facets).
6. Direct light (uncovered directions) must be modelled as the smooth intensity function; binning coarse direction cells into 0.05° bins made 2 kcd glare spikes that do not exist.
7. The judge's cut-off aim (R112: steepest log-step within ±0.5° of the line, ≥ 2 % of the scan max) latches onto the bottom of the beam's tail when the realised edge is soft → the whole beam is read shifted by ~1°. At ≤ 4 M rays shot noise at the gate level (~150–200 cd = ~5 rays per kernel) also moves it: the SAME design scores 16/0/3 at 8 M rays and 9/5/5 at 4 M (led-back). Compare solvers at ≥ 8 M rays; trust the noise-free model judge for decisions.
8. Edge sharpness: a sharp-edged die image gives G ≈ 1–1.8 (spec: 0.13–0.4). Needs ≥ 0.3° of vertical blur on the facets that form the cut-off (edgeSoft, adapted from the model's G).
9. OT re-solve between polish rounds is unstable (re-realisation changes cells, decals, fit scale). Tilt-only polish on FIXED geometry works (a 0.4° tilt moves a 7 mm facet edge 0.02 mm, so edge-to-edge continuity is essentially kept).
10. Interface wart: `input.spec.measure.distance` is `null` for the far field (JSON copy turns Infinity into null; `isFinite(null)` is true!). Treat null/0/non-finite as ∞. (Cost me an hour: aims got c = null and one facet owned the whole dish.)

11. `tools.scene` does NOT exist in the app's worker (it is a harness extra of bench-spec / run-solver): a solver gets only progress / budget / trace / preview. The verification trace rebuilds its scene from `input` (source, sources[1:], target, envelope, limits.bounces) and traces privately with `RF.Engine` + `ffStreams`.
12. In the app (Chromium worker, Mac mini) the solver runs at about Node speed: 100 facets 7.5 s (before the candidate search; ~15–20 s with it), 300 facets 30 s; my old "browser 5–7× slower" note is WRONG for this solver. Verified on a separate origin (preview server `flux-scratch2`, port 8746).
13. The stock judge at 0.02° resolution sees sharp tile edges that the 0.05° model (bilinear splat of sampled footprints) smooths away: the cut-off aim and the G/linearity rows can disagree between model and stock judge (led-back: model aim (0.5, −0.05)°, stock judge inflection at −0.02° → reads 0.3–0.55° off, 4 sure fails at 8 M AND 24 M rays). Ideas: finer model grid around the cut-off columns; soften every facet whose top lies within the judge's aim window; judge-mimicking edge cost in the polish (hl-v2 does this).
14. Floor margin 1.5 (to compensate image spreading) made things worse overall (chaotic via the aim); default stays 1.2. Per-row pixel weights (a spec point weighs like a whole zone: hl-v2's n^−0.75) helped; seeding the glow units at 1.6× the floor instead of 3× keeps the skirt nearer the judge's gate.
15. The shaping-candidate search (`search`: mainFill ×0.8–1.5, softAll ×0.5–1.6, picked by the noise-free model, switching only on a clear gain) costs ~2 s per candidate; it helped box (2→0 sure fails) and hurt led-back (0→4, finding 13): the model's idea of "better" is not the stock judge's.

## Benchmarks (R112 B, 100-facet budget, 8 M-ray stock judge, Node timings; sure-fail / unsure; loose pass/near/off)
| scene | spec-hl-v2 (baseline) | sqm-hl 0.1 (pushed; candidate search on) |
|---|---|---|
| box (up LED + box) | 0 / 3 · loose 17/2/0 · 11 s | 2 / 7 · 12/4/3 · ~15–24 s |
| led-back (rear LED) | 0 / 1 · 18/0/1 · 8 s | 4 / 5 · 11/3/5 (finding 13) |
| slim | 0 / 3 (earlier table) | 1 / 6 · 16/2/1 |
| module | 0 / 5 | 2 / 5 · 14/3/2 |
| sealed7 | 2 / 2 | 0 / 4 · 16/3/0 |
| her filament scene | 0 / 6 (15 pass) | 1 / 3 (Zone III) · 18/2/1 |
FMVSS LB2V (26 rows, before the search): led-back 24 pass / 1 fail / 1 unsure, box 22/2/2, hb3-in-bucket 22/3/1. Budgets on box (R112 B): 16 → 12 facets used, 7 pass / 7 fail (a nominal beam); 50 → 10/4/5; 199 → 15/0/4 (18 s). Paint mode (app scoring, 1 M rays): default scene fidelity 77.9 %, test scene 84.5 %.
Her saved SQM v0.3: 6 fails / 2 unsure; SQM v0.3 on box 9 fails, led-back 4, slim 7, module 6, sealed7 12 (fast default, 28–38 s). FMVSS and other LEDs/budgets NOT benched yet.

## Known issues / TODO (rough priority)
1. (DONE) paint-mode fallback. Remaining there: tilted target planes (modelled as an x-normal screen), fidelity tuning (77–85 %: the Fill & fix lab solvers reach 96 % on paint).
2. Hot spot: 75R/50R come out 10–30 % low on box/slim/module (floors ≥ 10.1 kcd). Try: larger margin on the most demanding floors, wBand up, calibrated model, more facets near the hot spot.
3. Cut-off: linearity/sharpness unsure or failing; filament scene has a sawtooth edge (vertical-streak facets) → sector/pairing control (edge facets from the dish's sides, crossing or diverging as needed; she allows both) or edge-anchored aims (aim the image TOP edge at the knee, stagger by a few hundredths of a degree).
4. Calibrate with a private far-field trace (`RF.Engine` + `ffStreams`; `tools.trace` returns only the plane grid and spec rows): residual map for the dim areas (model under-predicts glow: Point 7 76 vs 114 cd, BR 213 vs 152) and noise-free-aim verdict for the notes. The notes' 1 M-ray verification verdict is unreliable (finding 7): evaluate the traced field at the model judge's aim shift instead.
5. Dim glow units are 3× the floor (seed factor) → glow ≈ 250–450 cd, above the judge's 2 % gate (~150–200 cd): keep the skirt UNDER the gate (hl-v2 does) so noise cannot capture the aim.
6. (DONE) Timing in the app ≈ Node (finding 12). The governor stops corrections at 55 % of `tools.budget.ms`, candidates at 45 %. Use a separate origin/port for browser tests (flux-scratch / flux-scratch2 in ~/.claude/launch.json; never Restore/Open on her live tab).
7. FMVSS LB2V (18.3 m measuring distance → finite-distance aims through `P.zOf`), other emitters (warm LEDs, domed), budgets 16/50/200/300, filament moved toward the rear, impossible placements (LED outside the envelope → `D.rMin` handles tin > 0; untested).
8. Stray light shield (absorbing polygon or reflecting facet) for uncovered directions that violate ceilings (FMVSS 10U–90U); recycling to the source.
9. Bonus solver `sqm-hl-dish`: base shell chosen automatically among families (natural SQM scaled to the needed flux [built], envelope-filling shells with facets tilted onto the aims, smaller fills as fallback), with a continuity measure (max edge step, mm) and a `maxStep` knob; a small search over fills/families using the model judge (cheap). Per-facet radial scale needs a blocking check (finding 3).
10. (DONE) registered, tests green, pushed. Still to do: a UI review of the long setting labels; docs for SOLVER_API (tools.scene note); sector pairing for the filament; judge-mimicking edge cost (finding 13); calibration trace residual.

## Decisions made without asking (revisit if wrong)
- Solver id `sqm-hl`, version 0.1, modes ['paint'] (only 'paint'/'stamps' are valid); registered by the file only (index.json untouched so far).
- Design margin 20 % on every row; cut-off design G 0.34 (steer 0.28); road γ 0.8; peak cap 80 kcd; wash cap 12 kcd; these are settings.
- Harness committed under tools/sqm-hl/ (not tests/); her scene file is NOT committed.
