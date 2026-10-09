# Spec headlamp v3 — exploration, 9 October 2026

V3 is available in the solver menu alongside v2. It improves several source/housing combinations, especially the round filament lamp and small Osram module. It is **not a universal replacement**: the default up-firing LED trades left reach for right reach, and the rear-firing round lamp remains sensitive to how the judge aims it. V2 remains available and the app’s preferred solver was not changed.

[Open the plot gallery](index.html) · [Every result and repeat](ALL-RESULTS.md) · [Raw rows, settings and notes](results.json) · [Solver](../../solvers/spec-hl-v3.js)

## What changed

This builds on v2’s reflector construction. It does not introduce a new optical surface or alter the ray tracer, regulation presets or judge.

V2 fits the regulation plus a painted secondary target. V3 tries three designs: the v2 objective, a gentle road-lighting objective, and a stronger shoulder objective. The new target asks for a useful amount of light at distance, with tapered width and limited foreground demand. It uses an absolute intensity target, capped at 80% of the model’s estimated collected/reflected flux, instead of rescaling an arbitrary painting. That cap limits what is requested; it is not a guarantee of the delivered beam.

Each design gets a 2-million-ray host trace. Selection first considers expected failures, which account for uncertain rows, then balanced left/right reach. The reach term is 80% geometric mean of farthest reach plus 20% geometric mean of continuous reach. When compliance is comparable, neither side may fall below 90% of the fallback’s pilot reach, and the combined reach must improve by more than 4%. A sufficiently large compliance gain may override the reach guard. All candidate readings and the selection are recorded in the solver notes.

This safeguard is imperfect: the pilot can choose a design whose independently measured left reach is worse. The default LED demonstrates that. “Fallback” means a real alternative is traced, not a guarantee that v3 dominates v2 on every measurement.

## Controlled configurations

All cases use right-hand traffic, a 100-facet limit, the stock ECE R112 B and FMVSS LB2V presets, seed 1, and default solver settings unless stated otherwise. The solve allowance was 300 seconds; v3 actually took 33–96 seconds in these runs. A separate browser test used the normal 120-second allowance.

Box dimensions below are depth × width × height. The exact source positions, envelope coordinates and emitter parameters are retained in the JSON results and saved scenes.

| Configuration | Source model | Usable envelope / placement |
|---|---|---|
| Round filament | HB3, 13.2 V, 1,860 lm; axial 5.1 mm filament | Ø165 × 100 mm deep, nominal 7-inch housing; source halfway back |
| Deep rectangular filament | Same HB3 | 160 × 165 × 100 mm; source 110 mm behind the opening |
| Default up LED | Generic 2 × 2 mm, 1,885 lm | Default box, 55.9 × 105.18 × 54.92 mm; default slightly tilted up-firing source |
| Low-luminance up LED | Nichia 519A 5000 K R9080, 5 A, 1,265 lm; apparent area 8.6 mm² | Same default box and source transform |
| Rear-firing round LED | Generic 2 × 2 mm, 1,885 lm | Ø165 × 100 mm; source at the opening facing rearward; fixture’s mounting obstruction retained |
| Small Osram | CSLNM1, 4 A, 931 lm; apparent area 1.5211 mm² | 45 × 60 × 40 mm; up-firing module fixture |
| Long projector reference | Same HB3 | Ø90 × 220 mm; source 195 mm behind the opening, 25 mm from the back |

The 519A is the project’s flat apparent-source equivalent of a domed LED; this experiment does not trace an actual silicone dome. The models do not measure CRI’s effect on visibility, thermal sag, production tolerances or a complete bulb/package assembly. These are comparisons within the project’s declared source models.

## V2 versus v3

Reach is **right/left, metres**, at the stock judge’s selected aim. F/U means **definite failures / uncertain rows**. These are the seed-1, 8-million-ray results; zero failures with uncertain rows is not a compliance pass.

| Configuration | ECE v2 → v3 reach | ECE v2 → v3 F/U | FMVSS v2 → v3 reach | FMVSS v2 → v3 F/U |
|---|---:|---:|---:|---:|
| Round filament | 65/53 → **76/60** | 0/5 → 0/4 | 59/44 → 59/44 | 0/1 → 0/1 |
| Deep rectangular filament | 62/46 → **76/50** | 0/3 → 0/4 | 50.5/27 → **61/48** | 2/3 → 1/2 |
| Default up LED | 63.5/53.5 → **87/46.5** | 0/4 → 0/6 | 80.5/51 → 76.5/54.5 | 0/3 → 0/2 |
| 519A up LED | 64/46 → 64/46 | 0/3 → 0/3 | 61/44 → 61/44 | 0/0 → 0/0 |
| Rear-firing round LED | 80.5/56 → **88/61.5** | 2/1 → 0/4 | 130.5/65 → 130.5/65 | 1/0 → 1/0 |
| Small Osram | 62/45 → **73.5/50.5** | 0/4 → 0/4 | 64.5/56 → 64.5/56 | 0/0 → 0/0 |

**What survived the independent ray sample:** every v2/v3 design was retraced with seed 71, still at 8 million rays. The round-filament ECE gain remained (67/51.5 → 74/59 m), as did the small Osram gain (61.5/46.5 → 77.5/49 m). The rectangular filament’s FMVSS gain remained substantial (53.5/28 → 60.5/47.5 m), with failures still reduced from two to one. Its remaining definite failure is the upper boundary glare constraint.

The default LED’s ECE left-side loss also remained: 52.5 → 44.5 m, while right reach rose from 64.5 → 88 m. That is a real tradeoff in these saved designs, not a one-sample improvement claim. The 519A selected the v2 fallback under both presets; stronger objectives did not earn their cost. Its FMVSS all-pass result became one uncertain row with the fresh sample. The small Osram’s FMVSS fallback passed all 26 rows in both samples.

**Rear-firing caution:** its ECE v3 farthest reach is encouraging, but seed 1 has a near-road gap: continuous right reach is zero while farthest reach is 88 m. The fresh sample moves the judged aim and gives 117.5/67 m with a definite Zone III failure. This design needs aim stability and gap repair before its long reach is useful evidence of a better lamp. No geometry changed between those two measurements.

The useful result is redistribution, not more output. For example, round-filament ECE window flux falls from 1,019 to 934 lm while both road edges reach farther. The figure also shows narrower, brighter lobes and uneven broad fill. V3 has not solved beam smoothness or removed excessive foreground everywhere.

## How the other solvers compare

All six primary configurations were also tested with `sqm-hl`, `sqm-hl-dish`, `opus-mosaic-auto` and `dish-fit-auto`: 72 primary cases in total, including v2 and v3. Both “dish” variants were included to remove ambiguity. These are default-setting comparisons, not exhaustive tuning of each method.

- **Mosaic is a useful brightness/coverage reference.** On the default LED in ECE it gives 78.5/39 m and 17/0/2 pass/fail/uncertain. V3 reaches farther on both sides there, but has more uncertain rows. In several FMVSS cases mosaic reaches much farther on the right while losing the left or failing glare rows. A bright plot alone would overstate its success.
- **SQM retains a construction advantage:** a continuous reflector rather than v3’s independent patches. That is valuable even where the score is worse. In these defaults it struggles with both filament configurations; the round-filament ECE cases have seven definite failures. The two SQM variants sometimes select identical designs. The arbitrary-shell version is not consistently better: the small Osram ECE case has eight definite failures versus one for ordinary SQM.
- **Dish-fit can throw light far**, but the saved defaults have definite failures in every primary case here. V3 generally buys better constraint handling at the cost of independent facet geometry and additional selection work.

See the gallery’s “all six solvers” expansion for each comparison, including negative results. Tables include continuous reach and shoulder coverage, so isolated distant light does not hide nearby gaps.

## Liou in the long envelope

The long housing alone did not rescue the screenless defaults. I also used the notes’ cleanup-shield recipe: `shield: cleanup`, `leak: 0.25`, `focal: 54`, `pathScan: 16,24,32`. Everything else stayed at its default. This is a targeted reference experiment, not a claim of the best possible projector.

| Long-envelope design | ECE P/F/U | ECE R/L, m | FMVSS P/F/U | FMVSS R/L, m |
|---|---:|---:|---:|---:|
| V2 reflector | 16/0/3 | 61/42 | 23/1/2 | 58/39.5 |
| Liou default, screenless | 8/7/4 | 28/0 | 20/5/1 | 52.5/16.5 |
| Liou cleanup recipe | 14/0/5 | 60/49 | 22/3/1 | 83/53.5 |

Cleanup improves the useful distribution substantially, but the ECE fresh sample has one definite failure and five uncertain rows; FMVSS still has two definite failures. The seed-1 FMVSS failures include missing sign light and excessive light near the right cutoff. The ECE Zone III reading is 2,176 cd against a 625 cd ceiling yet classified uncertain by the unchanged zone/noise rule. This is why “zero definite failures” must not be translated into “compliant.”

The Liou notes’ diagnosis remains a good research direction: near-source reflector patches form tall images, and repeatedly sliding those images downward can shift their shape again. A longer envelope does not automatically make the solver choose better collection geometry. Suppressing or redirecting those troublesome patches may be worth more than adding another target-shape weight.

## What was tried and rejected

An unguarded road weight of 1 on the default LED improved ECE right reach from 63.5 to 77.5 m but reduced left reach from 53.5 to 42.5 m and window flux from 1,153 to 941 lm. That was rejected as a universal default. Weight 3 with a longer left goal did not transfer cleanly to the 519A, where it introduced a definite failure. This led to the candidate menu and fallback rather than one global aggressive setting.

Several harness errors were caught before final reporting: a geometry-check result was interpreted as the wrong type; a large-grid maximum overflowed JavaScript’s argument limit; a boolean was passed where the road mirror parameter requires +1/−1; and an early v3 pilot omitted `spec:true`. Affected results were rerun or archived. The mirror error produced suspiciously identical left/right readings, which is what prompted the raw-data check. Final reported measurements require harness version 2; old road results are invalid.

## Verification and limits

The complete existing test suite passed. Additional controls establish that road weight zero reproduces v2’s 15 surfaces exactly at a 16-facet test budget, positive weight changes actual geometry, the target respects its flux cap, the three small-budget designs pass geometry checks, and the selector requests both spec and road measurements and preserves the fallback on a tie. Every accepted benchmark design was checked for envelope, keep-out and facet-budget violations; every trace checks energy accounting to 1e−6 relative.

An actual browser worker solve completed in **48.134 seconds**, placed 99 facets, and reported no browser warnings/errors. The saved browser design was independently retraced at 8 million rays: 13/0/6 and 78/54 m. It selected the stronger road candidate, unlike the 300-second benchmark’s gentle choice. The time-bounded search can stop at different points; saved scenes, not a promise of bit-identical re-solving, are the reproduction artifact.

![Completed browser solve](browser-v3.jpg)

The 78 comparison cases plus 26 independent retraces are **exploration**, not statistical certification. Two ray samples reveal instability; they do not establish its full distribution. The linear plots are true direction-space far fields, added as a third accumulator without changing the sampling. Export asserts that the original measured lumens and every energy-ledger value remain identical. The plotted beam uses ±0.2° smoothing; the regulation rows use their stock measurement kernels.

The road panels intentionally match the existing app: the 25 m apparent-intensity beam is used as an angular lookup for two identical lamps. They show a vertical sensor 25 cm high, not lux on horizontal asphalt. Their 5-lux boundary is an IIHS-style visibility diagnostic, not a full IIHS vehicle rating. The [IIHS description](https://www.iihs.org/ratings/about-our-tests/headlights) and [test protocol](https://www.iihs.org/media/714fb5d9-b769-48ae-9fec-49bca8fd8ada/-1871994291/Ratings/Protocols/current/headlight_test_rating_protocol.pdf) explain the broader vehicle test.

## Next experiments worth doing

1. **Stability before more reach:** select across more than one pilot sample and small aim offsets. Penalize a severe glare row even when the total expected-failure count prefers it. This belongs in the solver’s selection objective; the official judge can remain unchanged.
2. **A road-area objective:** reward the dimmer part of both shoulders from 50–100 m and penalize holes and excessive foreground. Keep farthest reach, continuous reach and lit area separate. The present target is only a first approximation to those goals.
3. **Source placement:** this is a plausible high-value search variable. The interface change is moderate: return a proposed source transform alongside the surfaces and apply/preview/verify/undo them together. The larger cost is rerunning the optical solve for each placement. Begin with a small set of realistic mounting positions; add orientation separately. Require package, board/heatsink, clearance and exit-aperture constraints. Position alone adds three search variables; unconstrained pose adds three more. No placement interface change was made here.
4. **Compare source size at matched lumens:** the current 519A comparison changes both emitting area and flux. A matched-flux control would separate those effects. Also try the dedomed 519A preset and a compact high-CRI emitter in the same envelope; neither is assumed better without tracing.
5. **Geometry families:** a wide, shallow horizontal source/reflector arrangement; a dedicated projector with a smaller emitter; and a source farther from the worst near-vertex facets. For a future shared-source system, separate cutoff/hotspot and broad-fill optics could make the compromise easier. These are untested proposals.
6. **Manufacturing costs:** track facet steps, surface slope changes, obstruction and collection loss alongside photometry. SQM’s continuity is valuable; v3’s better measured score does not make its patchwork equally easy to manufacture.

The distant-shoulder and low-foreground goals came from Anya’s notes. The [Liou paper](https://citeseerx.ist.psu.edu/document?doi=42c9ca71de31f895ea74aeac36d1d1863abf8d77&repid=rep1&type=pdf), regulation presets and available reference beams inform the experiments, but they do not establish what modern OEMs optimize. I would treat these secondary goals as explicit, adjustable preferences rather than inferred industry ground truth.

## Reproduce

From the repository root:

```sh
node tools/spec-hl-v3/batch.js --jobs 2 --rays 8000000
node tools/spec-hl-v3/batch.js --jobs 2 --solvers spec-hl-v3 --rays 8000000
node tools/spec-hl-v3/batch.js --jobs 2 --solvers spec-hl-v2,spec-hl-v3 --rays 8000000 --seed 71 --retrace yes
node tools/spec-hl-v3/batch.js --jobs 1 --scenes projectorLong --solvers projector-liou,spec-hl-v2 --rays 8000000
node tools/spec-hl-v3/batch.js --jobs 1 --scenes projectorLong --solvers projector-liou --rays 8000000 --tag liou-cleanup --settings '{"shield":"cleanup","leak":0.25,"focal":54,"pathScan":"16,24,32"}'
node tools/spec-hl-v3/batch.js --jobs 1 --scenes projectorLong --solvers projector-liou --rays 8000000 --seed 71 --tag liou-cleanup --retrace yes
node tools/spec-hl-v3/validate.js
node tests/all.js
bench-out/spec-hl-v3/plot-venv/bin/python tools/spec-hl-v3/publish-plots.py
python3 tools/spec-hl-v3/report.py
```

`batch.js` resumes missing results and reuses saved scenes. To re-solve with changed settings, choose a new `--tag`; do not silently overwrite an existing comparison. The plotting environment is local to ignored `bench-out/spec-hl-v3/plot-venv` and needs matplotlib/numpy. The gallery, report, raw rows and selected saved scenes are in this documentation folder; full trace grids, logs, ablations and all baseline scenes remain in `bench-out/spec-hl-v3`.
