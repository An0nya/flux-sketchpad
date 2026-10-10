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
