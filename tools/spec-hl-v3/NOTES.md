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
