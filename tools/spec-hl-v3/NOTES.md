# Spec headlamp v3 experiment — 2026-10-09

Mode: exploring. User authorized autonomous implementation and comparisons. Local work; no publishing requested.

Goal: improve compliance and useful reach/width together, keep distant shoulders lit, avoid excessive foreground. Compliance is judged by the unchanged stock engine/judge, not the solver's model. No claim of physical homologation. Reference knowledge: projector-liou/NOTES.md and the project memory, especially the 2026-10-07 subjective-beam criteria and the latest 10-09 judge fixes.

Plan / pseudocode before edits:
1. Freeze six scenes, both ECE R112 B and FMVSS LB2V, 100-facet cap, seed 1, default solver settings. HB3 at 13.2 V; actual preset flux/area in results. The 7-inch housing uses the project's estimated usable Ø165 × 100 mm. Separate Ø90 × 220 mm projector reference.
2. Solve each baseline; verify geometry; save scene before tracing; trace 2 M guided rays to screen; save full rows, energy, beam and road samples after each run. Final comparisons retrace saved designs at 8 M rays. Repeat decisive v2/v3 comparisons with independent ray seeds.
3. Fork v2 as a separate solver. Preserve its reflector construction initially. Add a flux-budgeted, absolute road target to its angular fit, with broad shoulders and controlled foreground; widen its internal window for near left shoulder. Separate regulation penalties from this secondary objective. Test ablations before choosing defaults.
4. Validate settings effects, geometry, energy, saved-scene replay and app worker loading. Inspect actual beam images and road samples. Keep failed experiments and report limitations.
5. Deliver results, commands, proposed next experiments and registered v3 without replacing v2.

Benchmark assumptions: six scenes are controlled design fixtures, not measurements of commercial lamps. 519A uses the project's flat apparent-source equivalent of a domed emitter. The LED source models do not model CRI-dependent human vision or thermal sag. Comparison uses the same preset, source, envelope, facet cap, seed and scoring code for every solver.

## Instrument validation / mistakes caught during setup
- `verify.violations.budget` is null when valid, not an array. Initial two baseline solves were rejected by a harness exception; they must be rerun. No performance inference from them.
- `Math.max(...map.cd)` exceeded the JS argument count. Fixed to a loop; saved scenes permit retracing without a repeated solve.
- `Road.beamOf` takes mirror **+1 or −1**, not a boolean. Passing false made every road sample read H=0, producing suspiciously identical R/L reach. Caught by reading the implementation and the raw samples. All harnessVersion-missing results are INVALID for road metrics; version 2 has an executable assertion comparing actual horizontal lookups at -5/0/+5 degrees. Final results must be version 2.
- Every accepted trace asserts energy accounting closes to 1e-6 relative. Configuration overrides are checked after settings sanitation, before solve; geometry verification rejects violations.

## Early experiments (not the final v3)
R112/default up LED, 8 M rays, ray seed 1: v2 15/0/4, 1153 lm, farthest R/L 63.5/53.5 m. Absolute road weight 1: 16/0/3, 941 lm, 77.5/42.5 m. Negative on left reach: rejected as a universal default.
Weight .3: 13/0/6, 1081 lm, 87/46.5 m. Weight 3 + left goal 80 m + target 10 lx: 14/0/5, 784 lm, 92.5/50 m. Strong target on 519A: 14/1/4; cannot assume a setting transfers between emitters.

V3 implementation: separate self-contained copy of v2 plus absolute, flux-budgeted road target; internal horizontal window extends to ±25 degrees. Three candidates: v2-equivalent, gentle road target, stronger road/shoulder target. Host 2 M guided trace ranks expected failures first, then geometric mean of L/R reach, including continuous reach. For comparable compliance, neither shoulder may fall below 90% of the fallback. This pilot selection requires external 8 M validation; it is not guaranteed compliance. No engine/judge edits.

## Proposed next experiment: source placement (Anya's question)
Allowing a solver to propose source position can change collection, image blur and usable reflector aperture. Interface change is modest; search cost and realistic constraints are the larger task. Start with an outer loop over a small, declared set of mounting positions, solve each reflector, then judge the actual optics. Orientation is a separate, optional search. Require allowed mounting regions, package/board/heatsink volumes, clearance and exit-aperture constraints. Return the proposed source transform with the optical surfaces; apply, verify, preview and undo as one transaction. Do not silently relocate the existing source in current fixed-source comparisons. This is a proposal, not an implemented interface change or a measured benefit.

Additional implementation trap: `tools.trace` requires `spec:true` to return a spec judgment. Four early guarded-v3 cases omitted it and always fell back. Archived under `bench-out/spec-hl-v3/invalid-missing-spec-request`, then re-solved with the corrected request. The validation script now asserts the real selector requests both spec and road data.

## 2026-10-09 (Opus): beam-quality report (js/beam-quality.js, report only)
Module + 14 known-answer tests (tests/beam-quality.js, in all.js). Run over the saved designs: `node tools/spec-hl-v3/quality.js` → docs/spec-hl-v3/quality.{md,json}; window ±25° × 10D…5U from the plot JSONs.
Medians over 6 scenes × 2 specs (seed 1, 8 M): foreground lm share below 4D: v2 51 %, v3 52 %, SQM 37 %, dish 14 %, mosaic 10 %. Lobes: mosaic 1, v2/v3/dish 3, SQM 5. ¼-core height: mosaic 3.6°, dish 4.5°, SQM 6°, v2/v3 ~10°. IIHS demerits (straight + 4 curves): v2 24.2, mosaic 24.5, v3 25.1, dish 38.9, SQM 55.
NEGATIVE: roughness (Σ|I − blur| ÷ Σ blur) does not separate SQM from mosaic at any blur scale tried (σ 0.75×0.25 … 3×1); at large scales the smooth synthetic hotspot reads rough. What Anya sees as blotchy is multi-lobed structure, which `lobes` captures; roughness only catches fine ripple.

## 2026-10-09 (Opus): Anya's SQM foreground range (Downloads/reflector-scene-{5,7,9}.json, sqm-hl, ECE, generic-warm 1257 lm)
Settings differ in peakCap / fluxFrac / washCap / dimFrac (5: 300k/.7/0/0 · 7: 150k/.95/4000/.1 · 9: 150k/.95/15000/.15).
8 M: lumens below 4D 19 / 35 / 55 % (matches Anya's read). All 0 fails. IIHS demerits 57 / 60 / 41: scene 9 wins because its wash fills the near-left edge (continuous left 32 m vs 0); a blanket foreground ceiling will cost IIHS points unless near-left is lit on purpose.
The foreground-peak ratio does not separate them (0.40/0.43/0.39: scene 9's wash is broad, not hot) → use the lumen share. The lobe count reads 13–14 on these banded beams: prominence relative to the lobe's own height is too loose; proposed fix: prominence as a share of the main peak.
Hotspot height: Anya reads far field / linear / spec aim at the saved 500 k rays. At 500 k (3 seeds) the 0–3R hotspot sits at 1.5D (s5), 1.0–1.125D (s7), 1.25–1.375D (s9): matches her "5 sits ½° low, 7 sits higher". At 8 M the judge aims s7 0.35° lower (cut-off inflection found at −0.12° vs differently at 500 k) and s7's height advantage mostly vanishes (1.5D). s7 has the softest cut-off (sharpness 0.24): a soft cut-off makes the aim, and so the hotspot height, ray-count dependent. 500 k horizontal aim also wanders ±0.4° between seeds (s5).

## 2026-10-09 (Opus): ideal-beam goals (js/ideal-beam.js, report only) + lobe-count fix
Goals in md.ideal (Spec → "Ideal beam" section; footer tile "N / M ideal-beam goals"; trace o.ideal → res.road.ideal): hotTop ≤ 1.0° D, hotFill ≥ 0.6 of peak (hotH 1.5 ± 4 × 1.5°), wash ≥ 0.25 of peak (±15 × 0.5–3.5D), washHoles ≤ 10 %, fill3L ≥ 0.6 (3L→0 mean ÷ 0→3R mean, 0.5–1.5D; was 0.7 from a peak ratio, recalibrated to the mean the check uses: scene 7 = 0.61), fgCap ≤ 30 % lm below 4D, strayMax 0.8, nearLeft 15 m, reachR/L off. hotFill / washHoles / strayMax are Opus guesses, not calibrated.
Footer reach now reads "0 (far)" when the by-the-book IIHS number is 0 but the edge is lit farther out (Anya 10-09).
Lobes: prominence is now the dip as a share of the MAIN peak (15 %); medians mosaic 1, dish 1, v2 2, v3 3, SQM 5. SQM scenes 5/7/9 still read 7–13.
tests/ideal-beam.js: a synthetic beam meeting 8/8, each break fails only its goal (dimming the wash also trips washHoles, by definition).
Scores (default goals): round-filament ECE dish 7/8, mosaic 5/8, v2 4/8, v3 3/8, SQM 1/8. Anya's scenes at 500 k: 5 → 3/8, 7 → 3/8, 9 → 4/8; none meets hotFill (0.47–0.56) or washHoles (0.11–0.19).

## 2026-10-09 (Opus): ideal-beam calibration with Anya (sorted contact sheets, 67 beams)
- hotFill → info only ("evenness"). Relative fill let a flat 15 kcd band beat a tight 40 kcd hotspot. New goal hotContrast = hotspot-box mean ÷ wash-box mean ≥ 1.5 (flat bands ~1.1–1.2, v2 1.16–1.41, scenes 5/7/9 1.38/1.47/1.58, mosaic/dish 1.8–2.2). Quirk: a deep hotspot under a dim wash box reads high (round-filament SQM 3.78); the hotTop goal fails that beam.
- washHoles → graded goal: full credit ≤ 30 %, none from 60 % (Anya: < 20 % fine, up to 40 % okay for a shallow strip). The wash box now starts at washTop 1.0° D: ECE's left cut-off is at 0.57° D, so a box starting at 0.5° D counted the dark above that line as holes.
- stray → strayLow goal: a separate lobe below 4° D ≤ 0.5 × peak (catches v3's floods 1.06/1.74/0.72 and v2's up-LED lobe 1.09). Side lobes in the 0–4° D band → info only (Anya: unoptimized, not bad).
- The score is now Σ credit over the goals (tile "5.8 / 8"). md.ideal stores only changed knobs (it used to freeze the whole default set into the scene on first open).
Rescored with defaults (8 M): dish 7/8, mosaic 6/8, scene 9 6/8, v2 5/8, scene 5 4/8, v3 4.35/8, scene 7 3/8 (6 at 500 k: hotTop flips with the aim), SQM round-filament 2.17/8. fill3L (≥ 0.6) fails on almost everything (0.44–0.55); only scene 7 at 500 k passes. Candidate for the next calibration pass.

### 10-09 fill3L re-look (Opus, exploring)
8 M reads: scene 5 0.45, scene 7 0.49, scene 9 0.53, mosaic 0.44, dish 0.47, v3 0.53; only scene 7 @ 500 k passes (0.61), and that read is where the 0.6 default came from. So the default was set off the noisy low-ray aim, not a real beam. Every 8 M beam falls to about half its 0→3R level across 3L→0. Inference (unverified): part of that is geometry, since the ECE left cut-off sits at 0.57° D, the left box's top edge rides the cut-off gradient while the right box sits fully under the raised right-side line. Plot: docs/spec-hl-v3/fill3L.png (untracked). Open for Anya: lower the bar (~0.5), move the boxes down, or keep 0.6 as a real target.
Resolved (Anya 10-09): box stays where it is; the cut-off-fade overlap is deliberate, to reward a sharper cut-off (longer reach). Default lowered 0.6 → 0.5. Pass at 8 M: scene 9, v3 (0.53); near-miss scene 7 (0.49), dish (0.47); fail scene 5 (0.45), mosaic (0.44).

### 10-09 step 4 start: SQM's own ideal beam T* scored before any mirror (Opus, exploring)
Script: scratchpad tstar/tstar.js (loads sqm-hl.js with its private-RF wrapper opened, aborts the solve right after T.design).
T* (noise-free, design frame) vs the built beam at 8 M, Anya's scenes 5 / 7 / 9:
  hotTop      T* 0.75 / 0.63 / 0.63° D   → built 1.13 / 1.13 / 1.0   (the build loses ~0.4° of hotspot height)
  hotContrast T* 1.49 / 1.56 / 1.56      → built 1.38 / 1.47 / 1.58
  fill3L      T* 0.57 / 0.59 / 0.59      → built 0.45 / 0.49 / 0.53  (the build loses ~0.1)
  foreground  T* 15 / 35 / 60 %          → built 19 / 35 / 55 %       (passes straight through: washCap decides it)
  nearLeft    T* 16 / 16 / 16 m          → built 15.5 / 15.5 / 15
  score       T* 6 / 6 / 6               → built 4 / 3 / 7 (scene 9 is 7 after fill3L → 0.5)
Read: the target already meets most goals; the hotspot-top and 3L losses happen between T* and the mirrors, foreground is decided in T*.
Caveats: T* window is only ±15° × ±10°, so its foreground share is clipped; T* is in the design frame, the built beam in the judged aim.

### 10-09 step 4: sqm-hl-ideal built (Opus)
Decisions (Anya): shape SQM's ideal beam T* from the goals, as a new solver; leftover light → widen the hotspot to ±5°, then brighten it
(opt-in `leftover: uncollected` keeps plain SQM's sink); `overshoot` knob default 0.4°, 0 = measure the loss on the model and solve again.
Build: tools/sqm-hl/dev/ideal.js, only in `node tools/sqm-hl/build.js --ideal` → solvers/sqm-hl-ideal.js. Shared edits: build.js flag,
solver-main.js (id/settings/notes, all behind IDEAL), js/spec.js solverSpec now carries `ideal: RF.IdealBeam.of(md)`. Rebuilt sqm-hl.js /
sqm-hl-dish.js differ from the old files only in those gated lines.
Model check first: SQM's noise-free model shows the hotspot loss (scene 5 T* 0.75° D → model 1.125, traced 1.13; scene 7 0.63 → 0.88, traced
1.13), so the measure mode uses the model, not a trace.
T* (no mirrors) after two fixes, scenes 5 / 7 / 9: all 7/7 goals (nearLeft not checked on T*: no road model in the solver).
  Fix 1: a hot box placed at the design top reads 0.25° lower after the soft edge + SQM's log blur → the box top is corrected in the design loop.
  Fix 2: scene 5's peakCap 300k made the boxes outspend the budget → s < 0 now dims road plateau and boxes together.
  The top stops at 0.75° D in all three however far the box is lifted: the cut-off's fade is the ceiling, not the box (plain scene 5 T* also 0.75).
  Scenes 7/9 max out the hotspot (±5°, × 1.5) and still leave ~200 lm uncollected after the foreground cap; hotGain is the knob.
Pre-existing SQM quirk seen on the way (not ours): the first T.design call reports G = null and worst −3 on every cut-off try (plain too).

### 10-09 sqm-hl-ideal first runs, 8 M traces (one run each, n = 1; exploring)
Sheet: docs/spec-hl-v3/sqm-ideal-sheet.png (untracked). Scenes 5 / 7 / 9, plain → ideal 0.4° → ideal measured:
  goals       4 → 5 → 7   |  3 → 5 → 6   |  7 → 5 → 6
  reach R/L   60/32.5 → 74/44.5 → 73.5/45  |  55/32 → 60/28.5 → 71.5/31  |  63.5/35 → 67/31.5 → 66.5/35.5
  peak kcd    56 → 60 → 65  |  32 → 67 → 89  |  40 → 68 → 59
  hard fails  0 → 0 → 1 (cut-off linearity 0.50 > 0.20)  |  0 → 1 (cut-off sharpness 0.52 > 0.40) → 0  |  0 → 0 → 1 (Zone IV 1295 < 2500)
  ⚠ LEGAL REGRESSION: 3 of 6 ideal runs fail one row; plain fails none. Unsure rows also up (2 → 5).
Observations: foreground gone in all six (fg goal met everywhere); hotspot much more distinct. The measured-overshoot runs push the hotspot up
into the rising (15°) part of the ECE cut-off at ~3–4° R, touching the horizon — the likely source of the linearity / sharpness fails (inference).
The overshoot 0.4 runs mostly miss hotTop at 1.13° D (model too), so 0.4 is too small for these scenes; measured loss 0.40–0.53°.
⚠ SQM's model verdict reads every cut-off row as NaN / unsure ("Cut-off sharpness NaN") on all six — the model is blind to the rows that
fail in the trace. Same family as the T* "G = null" quirk; whether plain sqm-hl has it too is NOT yet checked.
Model vs trace disagree on hotTop for scene 9 measured (model 0.88, trace 1.13).

### 10-09 ⚠ SQM's model has been blind to the cut-off rows since 21fc616 (found + fixed, Opus)
21fc616 (10-09 02:37, "cut-off scan ignores steps whose dark side holds < 10 rays") reads neff from RF.FarField.intensityAt, which returned
neff 0 whenever Σe² = 0 — i.e. for EVERY bin of a noise-free grid (SQM's T.judgeGrid has E2 = 0). So every scan step was skipped and
sharpness / linearity read NaN in SQM's model and T* judge (plain sqm-hl and dish too, since this morning; their polish could not see those rows).
Fix (js/farfield.js intensityAt): neff = Infinity when e > 0 and Σe² = 0 (a traced bin with light always has Σe² > 0, so traces are unchanged).
After: T* G = 0.35 (design 0.34). This also explains the "G = null / worst −3" quirk logged above.
Consequence: the first sqm-hl-ideal sheet compared ideal (solved blind) with Anya's plain designs (solved before 21fc616) — unfair. Rerun
with plain re-solved: scratchpad ideal2/.
⚠ Second bug (found by the rerun, fixed): build.js wrote the variant flag as a bare `RF.SqmVariant = …`, which resolves to the APP's RF, not
the file's private RF — so any SQM file loaded after the dish (or ideal) file registered itself as that variant. The app only worked
because index.json loads plain sqm-hl first. Fixed: `globalThis.RF.SqmVariant` (the sandbox's RF). Checked in the worst load order
(ideal, dish, plain): all three register with the right settings, the app's RF has no SqmVariant. The ideal2 rerun was invalid (plain
crashed; the "ideal" runs were plain code under the ideal id) and is discarded.

### 10-09 the noise-free fix, revised: noise guards only on traced grids (Opus)
The neff = Infinity patch un-blinded SQM's model but then 931dba1's rule ("the cut-off is the steepest edge with darkness above it")
aimed plain sqm-hl's model 2.9° HIGH on scene 5 (model fails 9 rows; the 1 M check trace read at that aim: 9 fails). With CUT.above = 0
(old steepest-step rule) the same solve aims at 0.05° and the check trace passes 13 / 0 / 6.
Both 21fc616 (minRays) and 931dba1 (above) are SHOT-NOISE guards. Final fix (js/spec.js scanCut): apply them only when G.eRay > 0
(a trace; eRay = power / rays). Noise-free model grids (SQM T.judgeGrid, spec-hl-v3 judgeModel: eRay 0) use the old rule. js/farfield.js
reverted. Traced verdicts unchanged by construction.
⚠ spec-hl-v3 (and likely v2) were ALSO blind to their cut-off rows from 02:37 → this fix, same cause.

### 10-09 fair rerun (both bugs fixed; plain re-solved; n = 1 each) — sheet docs/spec-hl-v3/sqm-ideal-sheet-2.png (untracked)
Traced hard fails: plain 1 / 0 / 0, ideal 0.4° 0 / 0 / 0, ideal measured 0 / 0 / 0 → the legal regression of the first sheet was the blind model, gone.
Goals (plain → 0.4° → measured): scene 5 5 → 6 → 6 · scene 7 5 → 6 → 5 · scene 9 3 → 4 → 5. Modest.
Reach R/L: 5 67/33.5 → 68/30.5 → 68/30.5 · 7 69.5/41 → 61/22.5 → 73.5/32 · 9 58/28.5 → 59/23.5 → 65/32.5.
Problems seen:
 1. Fixed 0.4° on scenes 7 / 9 delivers only ~480 lm (plain 528 / 733, measured 690): the hotspot maxes at hotGain 1.5, the foreground cap
    takes its share, ~200 lm stays uncollected and the dish shrinks to cover only what T* asks. Against Anya's intent (leftovers → hotspot).
 2. The hotspot is a compact blob at ~4° R climbing toward the horizon (the elbow), not a ±4–5° pool centred at hotH 1.5 → hotContrast fails.
 3. T*'s own goals got worse once the cut-off judge worked (T* 7/7 earlier was an artifact of the blind sharpness loop): the working blur
    loop softens the edge → T* hotTop 0.88–1.13, 3L fill 0.35–0.45.
 4. Measured mode: loss reads 0.53° on all three; the second solve won twice, lost once (scene 5: worse, discarded); costs 2× time and hit
    the slow-run path on scene 9.
10-09 next round (Anya approved 1 + 4): hotGain default 1.5 → 4 (≈ no cap; the spec ceilings stop it), overshoot default 0.4 → 0.55
(measured loss). Problem 2 under discussion: Anya's reference = two 7" round H4 isoplots (Cibie: 18 kcd max at 1D 1.2R, 441 lm; Marchal:
19.7 kcd at 0.8D 1R, 510 lm): small hotspot just right of V near the cut-off, nested elliptical contours, outer contours following the
cut-off incl. the 15° rise (the Z that carries right reach). She does NOT want the box pinned to the left line (kills the Z incentive).
Proposal: hot box top = cut-off line shifted down (follows the Z), dome-shaped peaking at hotH (≈ 0.5 at ± hotW), top correction moves
only the offset. Diagnosis: the blob at 4R came from a flat-topped box raised by the lift and clipped by a sloped cut → tallest at the elbow.

### 10-09 goal boxes overlaid + what the goals reward (figs docs/spec-hl-v3/goal-boxes-{samples,synthetic}.png, untracked)
- The cheapest pattern that scores 8/8 is two rectangles (40 kcd block 2.5L–5.5R × 0.6–2.1D on a flat 6.6 kcd slab ±15° × 1–3.5° D)
  + a near-left patch. No goal looks at 0–1° D right of ~3R → the horizon streak / 15° kink / notch Anya wants is invisible to the goals.
- hotH only anchors boxes; nothing scores WHERE the peak is. Every realised beam and the T* itself peak at ~4–5° R on the 15° rise.
- T* with hotGain 4 (scenes 7 / 9): hotspot 193–258 kcd at ~4.5R 0.5D; the middle of the wash goes dark: ECE Zone I (±9° × 1.72–4° D,
  max 2 × 50R). SQM's bands (target.js refMin) set that ceiling from 50R's MINIMUM (10,100 cd → ≈ 16 kcd after margin), not 2 × the beam's
  own 50R → the wash can never exceed ~16 kcd there however bright the hotspot. Conservative vs the regulation; makes "wash ≥ ¼ peak"
  impossible once the hotspot brightens (also a cap on plain SQM's foreground/wash).
- "All leftovers into the hotspot" and "wash ≥ ¼ of peak" fight: brightening the peak lowers every relative goal.
Anya's proposal: split the wash box at 0°, right half moved up to the horizon (rewards the right-side streak that helps on curves).

### 10-09 Anya: Zone I fix OK (worried it lets foreground shoot up); split wash: 15° kink or 45° notch?; hot box further left; B50L notch
- Road distance of each down-angle (mount 0.65 m, flat road): 0.57° D 65 m · 1° 37 m · 1.5° 25 m · 1.72° 22 m · 2° 19 m · 2.5° 15 m · 3.5° 11 m · 4° 9 m.
  ⇒ ECE Zone I (1.72–4° D) = road 9–22 m. Our "wash" goal box (1–3.5° D at ≥ ¼ peak) = road 11–37 m: the goal itself asks for near-road
  light. The regulation's Zone I ≤ 2 × 50R is exactly the "keep the foreground under the far road" rule Anya likes.
- SQM's "notch" misalignment (inference): the judged aim moves sideways within the R112 re-aim box (0.5 L / 0.75 R / ± 0.25; model aims
  seen 10-09: +0.30° scene 5, +0.35° scene 9) and SQM feeds back only the VERTICAL miss (cutShift) → the dark spot designed at B50L
  (3.43 L 0.57 U, ≤ 350 cd) is read 0.3° away. Plain scene 5 trace failed B50L 542 > 350. Her LB2V shield's "0.86D 3.5L diffuser block"
  is the same trick (FMVSS max at 0.86 D 3.5 L).

### 10-09 round 4 build (Anya: wash B = 0.75–2.25° D; "candela within 0–2° D is the only thing that matters")
Goals (js/ideal-beam.js, report): + hotPos (peak within hotH ± 1.5), + streak (2.5° R → washW, horizon/cut-off down 1.5°, ≥ 0.25 peak;
both a 15° kink and a 45° step fill it), hotspot box hotLeft 4 / hotRight 5.5 (old hotW maps onto both), wash 0.75–2.25° D and it now
EXCLUDES the hotspot box (at 0.75–2.25 the two overlap: the hotspot propped up the wash level, hid its holes and was compared with itself).
Calibration on 17 traced beams (thresholds unchanged): streak ≥ 0.25 passes mosaic / dish / v2 (0.27–0.29), fails every SQM (0.11–0.23);
hotPos fails exactly the ideal variant's drifted peaks (3.25–5° R); contrast 1.3–2.6 (dish / mosaic 2.4–2.6); mosaic wash 0.24 (just under).
sqm-hl-ideal T*: hot = dome peaking at hotH (½ at the box edges), top edge parallel to the horizon-capped cut-off and never above it
(the lift had pushed the top over the line → clipped unevenly → tallest at the elbow again); streak floor; Zone I (maxRel) ceiling reset
from T*'s own 50R and T* rebuilt. T* now 9/9 on scenes 5 and 7, peak at 1.5 / 2.75° R.
Not done: sideways aim feedback for the B50L notch (the judge's re-aim chases the best rows, so moving the design may just move the re-aim — needs its own look).

### 10-09 round 4 results (8 M, n = 1; sheet docs/spec-hl-v3/sqm-ideal-sheet-4.png, untracked; plain reused from round 3)
Hard fails (trace): plain 1 / 0 / 0, ideal default 0 / 0 / 0, ideal measured 0 / 0 / 0.
Goals /10 (plain → default → measured): 5: 6 → 6 → 6 · 7: 6 → 5 → 7 · 9: 4.9 → 7 → 7.
Window lumens: 696/528/733 → 698/828/833 (left-over light now collected). Peak 47/31/30 → 61/115/83 kcd.
Reach R: 67 → 66 · 69.5 → 69.5/67.5 · 58 → 71.5.   Reach L: 33.5 → 26 · 41 → 29 · 28.5 → 37.5 (left drops on 5 and 7).
Streak passes in all six ideal runs (0.28–0.45; plain 0.11–0.21); foreground 4–11 % (plain 23 / 34 / 58 %).
Still failing: hotPos — the built beams (and T* on scenes 7 / 9 at the second design call, hotspot brightened ×3) peak at ~3.5° R on
the 15° rise; hotTop 1.13–1.25° D everywhere (model loss 0.7–0.8°, the measured second solve does not recover it); nearLeft 16 m.
Measured overshoot: second solve kept 1 of 3; same or worse otherwise → no evidence it earns its 2× time.
