# Spec headlamp solver — results

`solvers/spec-hl-v2.js` (v2.0) is a solver written for Spec mode: it reads `input.spec` (the rows, the cut-off, the aiming rule the host judges with) and builds the reflector for those, not for a painting. `solvers/spec-hl-v1.js` is the first working version, kept frozen. No file of the app was changed; the only edits outside the two solver files are their entries in `solvers/index.json`, this document and `docs/spec-hl/`. Everything below was measured with the repo's own judge (`RF.Spec.evaluate` on a traced far field, ±2σ verdicts), 25 m plane, default scene / LED / envelope unless a row says otherwise.

Branch `spec-solver` (from `spec-mode`). `node tests/all.js` passes.

## Result

Official bench (`tests/bench-spec.js`, 8M rays: 2M pilot + guided Refine rounds, generic LED, 100-facet budget). **Sure fails** (rows the judge fails, not just "unsure"):

| R112 class B | box | slim | module | sealed7 |
|---|---|---|---|---|
| spoke | 4 | 4 | 5 | 5 |
| dish-fit | 3 | 3 | 3 | 4 |
| opus-mosaic-auto | 0 | 0 | 6 | 2 |
| fill-fix | 0 | 4 | 3 | 4 |
| spec-hl-v1 | 0 | 1 | 0 | 1 |
| **spec-hl-v2** | **0** | **0** | **0** | **1** |

| FMVSS 108 LB2V | box | slim | module | sealed7 |
|---|---|---|---|---|
| spoke | 7 | 5 | 6 | 11 |
| dish-fit | 6 | 6 | 7 | 7 |
| opus-mosaic-auto | 3 | 3 | 2 | 5 |
| fill-fix | 2 | 6 | 5 | 5 |
| spec-hl-v1 | 1 | 1 | 5 | 4 |
| **spec-hl-v2** | **0** | **0** | **1** | **2** |

Beam quality, same runs: lumens inside the spec window (of 1885 lm) and the soft score (1 = every row met with room):

| R112 B | box | slim | module | sealed7 |
|---|---|---|---|---|
| opus-mosaic-auto | 818 · 0.94 | 697 · 0.97 | 692 · 0.67 | 1219 · 0.81 |
| fill-fix | 317 · 0.96 | 247 · 0.74 | 357 · 0.74 | 969 · 0.77 |
| spec-hl-v2 | 1153 · 0.95 | 1052 · 0.95 | 1105 · 0.85 | 1069 · 0.85 |

| LB2V | box | slim | module | sealed7 |
|---|---|---|---|---|
| opus-mosaic-auto | 817 · 0.88 | 870 · 0.93 | 870 · 0.93 | 1178 · 0.83 |
| fill-fix | 777 · 0.91 | 434 · 0.85 | 509 · 0.83 | 933 · 0.84 |
| spec-hl-v2 | 1198 · 0.99 | 1146 · 0.99 | 1137 · 0.94 | 1072 · 0.92 |

The baselines that reach 0 fails on the box do it with 30–70 % less light in the window (opus 818 lm, fill-fix 317 lm, vs 1153 lm). Per-row values for every cell: `docs/spec-hl/bench/*.json` (output of `--json`); the command is at the end.

What v2 leaves open at 8M rays: dim rows (Zone III, Points 1+2+3 / 4+5+6, Point 8) and the cut-off sharpness row come back "unsure" regardless of the design, because 65 mm-photocell readings of 60–500 cd hold a few dozen rays. The verdicts never reach pass without ~10× the rays (the report's "×N the rays would settle it" says the same). v2 designs the true margin, not the noise.

### In the app (Chromium, solver chosen in Reference & debug → Solver, 4M rays + one guided Refine → 8M)

| scene | verdict | figure |
|---|---|---|
| default, R112 B | 16 pass · 0 fail · 3 unsure | `docs/spec-hl/app-r112b.png`, `app-r112b-report.png` |
| FMVSS LB2V | 23 pass · 0 fail · 3 unsure | `app-lb2v.png`, `app-lb2v-report.png` |
| default + hot-spot painting | 15 pass · 0 fail · 4 unsure | `app-hot-paint.png`, `app-hot-paint-report.png` |
| H4-type filament (`hb3`), R112 B | 16 pass · 0 fail · 3 unsure | `app-filament-hb3.png`, `app-filament-hb3-report.png` |

Far fields of the same default scene (log scale, aimed the way the judge aims, spec overlaid): `docs/spec-hl/ff-box-{spoke,fillfix,mosaic,spec-hl-v1,spec-hl-v2}.png`; LB2V: `ff-lb2v-spoke.png`, `ff-lb2v-spec-hl-v2.png`.

## How it works

1. **Read the problem.** Bands per far-field pixel from the rows: a minimum and a maximum in cd, each with a margin derived from the measurement noise the judge will have at that level (`designRays`, guided, zone-extreme rule), plus `safety` % on top. An implicit glare ceiling above the cut-off (median of the spec's own ceilings above the horizon, R112 625 cd).
2. **Shell.** Directions from the LED to the envelope walls are cut into tiles (nearest-hit ownership: the flux a tile carries matches the engine's per-unit intercept within ±4 %); each tile becomes a unit that can be a two-curvature facet with a chosen aim (H, V in degrees) and aperture spreads.
3. **Fit.** Per-unit far-field patterns are traced exactly once per (unit, shape) and translated in angle, so a move costs a look-up, not a trace. Greedy placement, annealing, large-neighbourhood repair; judge-mimicking cut-off terms (steepest-step knee, gate at 2 % of the scan max, G window, linearity / inclination, straightness).
4. **Calibration.** The built design is traced with per-facet attribution; the measured patterns replace the modelled ones and the aims are polished (2 rounds, model ↔ real agreement ≈ 1.0 by region).
5. **Safeguards.** A seed restart when the model itself clearly fails the compliance rows; a warning (and no restart) when the mirrors can catch < 5 % of the LED's light; a time governor that cuts search/polish/calibration to fit the host's 120 s budget (the app stops a solver at 120 s and silently keeps the previous design — found when four parallel browsers starved the CPU).

Aiming: the judge aims by the steepest log-step of a vertical scan once the reading holds ≥ 2 % of the scan's maximum. Noise in the dim skirt above the cut-off can win that contest and move the beam by up to 0.75°, which fails rows that were fine. v2 designs against it: a knee well above the gate, the skirt above the cut-off held under the gate over the judge's whole aim window, and for FMVSS presets each row's bounds also hold under ±0.2° of vertical aim jitter.

### Settings (Reference & debug → Solver)

| key | default | |
|---|---|---|
| `quality` | normal | fast / normal / best. `best` ≈ 2.5× the time (55–72 s on the bench machine) |
| `safety` | 10 | extra margin on every row, % |
| `designRays` | 8e6 | the trace the judge will use; fewer rays ⇒ wider margins |
| `paintWeight` | 0.05 | the painting as the secondary goal; effective weight is capped at 0.15 (0.3 started trading Zone IV away) |
| `softBelow` | 1 | rows with weight below this are best effort |
| `minDistance`, `seedOffset` | 0, 0 | |

Solve time 22–35 s normal (up to ~55 s when a restart runs; ~70 s with a 400-facet budget).

## Secondary goals (paint / extra zones on top of compliance)

- **Painting.** `input.paint.cells` is the working paint (the app clamps the painting between the spec's floors and ceilings); the solver pulls toward the painted shape only where the paint asks for more than the floors already do, with a weight that is capped so the spec stays primary. With nothing beyond the floors painted it adds no secondary term.
- **Extra rows.** The Spec tab has no weight column, so a row is secondary if its name starts with `~` (also `soft`, `wish`, `secondary`, `extra`) or its weight is below `softBelow`. Secondary rows get lighter margins and weight; they are best effort. The judge counts them like any row, so a missed wish shows as a fail in the report; the solver protects the compliance rows.

Default box, R112 B, 8M rays, intensity (cd) at four probe points after aiming; compliance stays 0 sure fails on the hard rows:

| | 2R 1D | 0 3D | 6L 1.5D | 8R 2.5D | peak |
|---|---|---|---|---|---|
| no secondary | 20.1k | 16.9k | 28.0k | 8.3k | 38k |
| hot-spot painting, weight 0.1 (σ 1.6° at 1.5R 1D) | **60.9k** | 20.3k | 53.6k | 14.8k | 62k |
| foreground wash painting | 27.9k | 21.3k | 57.2k | 10.8k | 70k |
| `~Hot 2R 1D` ≥ 30k, `~Foreground fill` ≥ 16k | 26.6k | 17.4k | 21.3k | 16.4k | 45k |

Painting is the strong channel (3× at the spot); soft rows move the number part of the way (20k → 27k toward 30k; the foreground fill reached 9.6k of 16k). Figures: `sec-none.png`, `sec-hot-paint.png`, `sec-wide-paint.png`, `sec-soft-rows.png`.

## Configuration sweep

Default box unless stated; R112 B; "p/f/u" = pass / sure fail / unsure; rays as noted. The 4M rows overstate fails (see the sft25r note). This sweep ran on the solver as of 81cbafa, before the aim-window skirt and the FMVSS jitter bounds; the bench, app and robustness tables above are on the final file.

| config | rays | p/f/u | note |
|---|---|---|---|
| generic (default) | 8M | 16/0/3 | |
| generic-warm (1257 lm) | 4M | 15/0/4 | |
| osram-cslpm1 @8.6 A | 4M | 16/0/3 | |
| nichia519a-domed @5 A | 4M | 14/0/5 | |
| lmp-w5050sq3 @8 A | 4M | 15/0/4 | |
| osram-hwqp | 4M | 15/0/4 | |
| sft40-3000k @4 A (861 lm) | 4M | 15/0/4 | |
| sft40-cw @8 A (2272 lm) | 4M | 15/0/4 | the first fit failed in the model; the seed restart fixes it |
| sft25r (884 lm) | 4M / 32M | 14/1/4 → 17/0/2 | the 4M sure fail is a dim-zone reading (Zone IV 1361 ± 201); gone at 32M, seeds 1–3 also unsure at 4M |
| filament hb3, default position | 8M | 12/0/7 | baselines: spoke 2 fails, fill-fix 6 |
| hb3 centred in the envelope | 8M / 32M | 11/5/3 → 17/0/2 | 35 % of the light escapes unshaped; its 450 cd glow sits on the judge's 2 % gate so the aim latches on noise at ≤ 8M; baselines: spoke 3, fill-fix 4 |
| hb3 axis up | 8M | 11/0/8 | |
| LED axis forward | 4M | 15/0/4 | only 14 % of the light reaches a mirror |
| LED axis 45° up / backward | 4M | 16/0/3, 15/0/4 | |
| LED axis down (away from the dish) | 4M | 7/10/2 | infeasible; the solver now says so (0.3 % of the light catchable) and stops early |
| envelope ×0.5 / ×0.75 / ×1.5 | 8M | 16/0/3 each | |
| envelope ×2 | 8M | 15/1/3 | cut-off sharpness 0.53 > 0.4 (image too sharp at that scale), model fails too |
| budget 20 / 50 | 8M | 13/2/4, 15/0/4 | 20 facets cannot do it (75R 9.3k of 10.1k) |
| budget 200 / 400 | 8M | 16/0/3 each | 44 s / 71 s |
| ECE R112 class A | 8M | 14/0/4 | |
| R112 B, left-hand traffic | 8M | 16/0/3 | |
| R112 A / B driving beam (peak aim) | 8M | 7/0/0 each | |
| hotspot (angle / goniometric, distance ∞) | 8M | 3/0/0 | |
| FMVSS UB2 / LB2M | 8M | 20/0/0, 21/0/1 | |
| FMVSS LB2V + hb3 | 8M | 19/3/4 | 10U–90U boundary: direct filament light |

## How often the judge's own noise fails a good design

Fixed design, re-traced with 6 trace seeds at 8M rays, over 4 design seeds per scene (24 judgments per cell). "Plain" is the first picture after Rebuild (unguided); "guided" is after Refine.

| scene | plain sure-fail | guided sure-fail |
|---|---|---|
| R112 B default | 1/24 | 0/24 |
| R112 B + hot painting | 5/24 | 1/24 |
| FMVSS LB2V | 6/24 | 5/24 |

LB2V's remaining fails are near-misses on dim zones just above the step (`1.5U 1R–3R`, `0.5U 1R–3R`, ~7–10 % short) and the cut-off inclination when one outer scan column latches on a stray step. Without the ±0.2° aim-jitter bounds it was 11/24 and 9/24. The same bounds make R112 worse (default 1/24 → 6/24 plain), so they are off for R112. These are small samples; the design-to-design spread is large (one LB2V design: 0/6, another 5/6).

## Known limits

- Dim rows stay "unsure" at ≤ 8M rays whatever the design; sharpness is "unsure" more often than not.
- FMVSS LB2V on the box still fails now and then (above); the `10U–90U` boundary on a box with a bare LED is direct light a mirror cannot remove (an absorbing shield would; not implemented).
- An isotropic filament in the middle of the envelope, an LED facing away, a ×2 envelope with 100 facets and a 20-facet budget are not reachable; the first three come back with a note or a model verdict saying why.
- Attempts that were measured and dropped: dumping excess flux in "free" pixels, more repair rounds, a cost-based restart (no better on the judge: 14/0/5 vs 16/0/3 on the ×0.75 envelope), `guideGain 0`, a tighter skirt, quality `best` as a default (helps LB2V, 2.5× the time), a Monte Carlo of the judge on the model field (overestimated the failure rate several-fold when checked against real traces, e.g. predicted 69 % where 0/8 failed; removed), and a floor "guard" on the skirt cap (made aim latching worse).
- Premise notes. In Spec mode the host solves on its own plane (`md.solveAt`, 25 m), so pushing the target plane out is for what the panels show, not for the solver; angle-based (goniometric, distance ∞) measurement is live in this branch and the solver works in angles throughout (`hotspot` passes 3/0/0).

## Versions

| version | commit | what |
|---|---|---|
| v1.0 `spec-hl-v1.js` | 324228f | first working pipeline: bands from `input.spec`, exact per-unit patterns, edge-anchored greedy + anneal + repair, real-trace calibration. Frozen. |
| v2.0 `spec-hl-v2.js` | 462cef4 → latest | noise-derived row margins, robust judge aim (knee above the gate, skirt cap, bright scan), sharper shell, screened candidate search, secondary rows by name, painting-beyond-floors detection with capped weight, seed restart, coverage warning, time governor, FMVSS aim-jitter bounds |

## Reproduce

```
node tests/bench-spec.js --load solvers/spec-hl-v1.js,solvers/spec-hl-v2.js \
  --solvers spoke,dish-fit,opus-mosaic-auto,fill-fix,spec-hl-v1,spec-hl-v2 \
  --fixtures box,slim,module,sealed7 --preset ece-r112-b        # and --preset fmvss-lb2v
```

In the app: Reference & debug → Solver → "Spec headlamp v2", then Rebuild and Refine.
