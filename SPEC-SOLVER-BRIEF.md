# Brief: a solver for beam specifications (Spec mode)

For a fresh session building Flux's first spec-native reflector solver. Written 2026-10-05 on branch `spec-mode`.
Read this, then `SOLVER_API.md` (the contract, plus its "Spec mode" section), then `SPEC-MODE.md`: the judge, and
every measurement behind the numbers below.

## The job

Make reflector designs that **pass** a low-beam regulation as the app judges it. Primary targets:

- `ece-r112-b`: UN R112 class B passing beam.
- `fmvss-lb2v`: FMVSS 108 lower beam LB2V, visually aimed (VOL).

Do it in the bench fixtures with the default LED. "Pass" means every row passes, decided at ±2σ in the
far field. No existing solver manages that.

Everything here is relative to the app's own judge (`RF.Spec.evaluate`). Don't change the judge or the presets to
make a design pass; if you think a rule is transcribed wrong, flag it to Anya with the citation (each preset row
has `ref`).

## Where things stand (what you're beating)

`tests/bench-spec.js`, generic 2 × 2 mm LED at 150 cd/mm² (1,885 lm), 8 M rays (2 M + guided). Cells give
**sure fails** / unsure rows · peak cd:

| Solver | box 105×55×56 | slim 120×35×50 | module 60×40×45 | 7" bucket Ø165×100 |
|---|---|---|---|---|
| **R112 class B** | | | | |
| spoke (built in) | **4**/4 · 61k | **4**/5 · 40k | **5**/5 · 46k | **5**/3 · 83k |
| dish-fit | **3**/4 · 82k | **3**/3 · 63k | **3**/2 · 47k | **4**/2 · 78k |
| mosaic auto | **0**/3 · 89k | **0**/2 · 72k | **6**/2 · 51k | **2**/3 · 135k |
| Fill & fix | **0**/2 · 25k | **4**/5 · 14k | **3**/4 · 11k | **4**/2 · 151k |
| Fill & fix light | **6**/4 · 27k | **4**/2 · 25k | **6**/2 · 22k | **1**/4 · 157k |
| **FMVSS LB2V** | | | | |
| spoke | **5**/5 · 54k | **5**/2 · 36k | **6**/3 · 32k | **11**/0 · 60k |
| dish-fit | **6**/2 · 48k | **5**/2 · 51k | **8**/2 · 40k | **8**/1 · 42k |
| mosaic auto | **4**/2 · 72k | **1**/2 · 61k | **3**/2 · 47k | **5**/2 · 102k |
| Fill & fix | **8**/1 · 63k | **2**/4 · 23k | **3**/3 · 19k | **4**/0 · 109k |
| Fill & fix light | **7**/1 · 27k | **7**/2 · 19k | **7**/2 · 26k | **4**/1 · 121k |

The existing solvers are paint solvers fed a rasterised working target. They are chaotic: small input changes,
settings or distances reshuffle results between 0 and 12 fails (SPEC-MODE.md, "Settings × distance").

**Brightness is not the problem.** Peaks of 50–150k cd are 2–15× the 75R / 50R minimums (10.1k), and the
brightness-theorem ceiling is far above that. What fails is **control**:

1. **Dim, bounded light above the cut-off.**
   - R112 sign points 1–8 need 65–125 cd each (sums 190 / 375), while B50L ≤ 350 cd and zone III ≤ 625 cd.
     B50L is 0.8° from point 8.
   - FMVSS: 0.5U 1R–3R must hold 500–2,700 cd; 1.5U 1R–3R ≥ 200; 2U 4L ≥ 135; 4U 8L/8R ≥ 64. The 125 cd
     boundary sits above 10° U.
   - Paint solvers either leave this region dark, or (SQM) hit the points with a whole patch's LED image: 1.4–3.6k cd
     streaks, 20× over. A dim glow painted in the seed overshoots B50L and zone III.
   - You need units whose delivered intensity can be budgeted between a floor and a ceiling a factor of ~2–3 apart.
2. **The cut-off itself.**
   - R112's gradient must be 0.13 ≤ G ≤ 0.40 at 2.5° L. Many designs are too *sharp* (G 0.5–1.4).
   - The inflections at 1.5° / 2.5° / 3.5° L must be within 0.2° (R112 spread; FMVSS each end vs the middle).
   - Zone III / B50L leak from facets whose images straddle the line.
3. **FMVSS shape.** US beams want light 0.5–1.5° above horizontal just right of centre: a step, not R112's 15° rise.
   It is the most common FMVSS miss (16 of 20 designs).

## What you get (all in the solver environment, in the app's worker too)

- **`input.spec`:**
  - the constraints in (H, V) degrees, traffic resolved, each with min / max (or relative bounds);
  - the measuring distance and kernel (R112: 25 m, ±0.0745°; FMVSS: 18.3 m, ±0.229°);
  - how the judge aims the lamp: R112 puts the cut-off inflection at 2.5° L on 0.57° D, then may move the whole lamp
    within 0.5 L / 0.75 R / ±0.25; FMVSS puts the max gradient on 0.4° D, then allows ¼° at every test point.
- **Aim in degrees:** `RF.FarField.dirOf(h, v, conv)` gives a world direction; facet aim point
  `Z = P + d × L`. The input target is a 25 m plane, if you want plane coordinates instead.
- **`tools.trace(surfaces, { rays: ≤ 2e6, spec: true })`:** the judge's verdict and every row's value, ± and
  margin. Guided by default (dim rows 2–8× less noisy). ~2–4 s per 2 M rays in Node.
- **Physics helpers:** `RF.Solver` (tile model: the LED image a facet makes, as a covariance); `RF.Source.apparent`
  (the emitter as the optics see it; domed LEDs magnified); `RF.Photometry` (brightness ceilings). The default solver's
  core `RF.ModeA.plan / build` is reusable.
- **Facets** (`js/geometry.js` header): ellipsoid / paraboloid (`di`, ∞ = collimated), flat, or two-curvature
  (`vg`, `ax`). The two-curvature facet gives anisotropic images: wide and short, which is what a cut-off wants.

## How to work

- Branch from `spec-mode` (not main). One self-contained file in `solvers/` registering an id; add it to
  `solvers/index.json` when it's worth shipping.
- Inner loop: your own script calling `solve()` + `tools.trace({ spec: true })` on one fixture.
- Checkpoints: `node tests/bench-spec.js --load solvers/your-file.js --solvers your-id --fixtures box,slim,module,sealed7
  --preset ece-r112-b` (and `fmvss-lb2v`). It takes minutes per row; `--json` keeps every row's numbers.
- `node tests/all.js` must stay green.
- Limits:
  - deterministic for (input, settings, seed);
  - never more than `input.limits.maxFacets` facets (a ceiling, not a target);
  - stay inside the envelope and outside `keepOut`;
  - apply `limits.reflectivity`;
  - a solve in the app is aborted at 120 s; aim for ≤ 30 s.

## Suggested approach (SPEC-MODE.md "Phase 2"; decide with Anya)

1. **Edge-anchored aims for the cut-off.** For facets lighting the region under the line, aim each so the *top edge*
   of its LED image (the tile model gives its extent and orientation) sits on the cut-off, with the image hanging
   below it. This is how commercial MacroFocal reflectors work. The sharpness then comes from geometry. Watch G's
   maximum (0.40 for R112): stacked edges that line up perfectly are too sharp, so stagger them by a few hundredths
   of a degree.
2. **A constrained flux fit.** Columns = units (facets), rows = spec samples. Predicted intensity B·g with g ≥ 0;
   maximise the worst margin subject to B g ≥ min at min-samples, B g ≤ max at max-samples, Σ g ≤ captured flux.
   It's a small LP / QP (hundreds of units, a few thousand rows). A dependency-free projected-gradient version is
   fine. Re-fit with traced columns once the geometry exists (per-facet attribution: `tools.trace({ attribution:
   true })` gives landed energy per facet id).
3. **Dedicated dim units for the sign points / FMVSS upper band.** Small or deliberately defocused facets whose
   images are spread wide, so 65–600 cd is reachable without a hot core. Budget their flux in the fit.
4. Optional: compound / faceted ellipsoid ideas from Chu et al. 2020, *Applied Optics* 59(16) 4872.

## Gotchas

- **The far field, not the target plane, is judged.** Plane-based aiming at 25 m still carries up to ~0.1°
  parallax per 40 mm facet offset; aim in degrees.
- **Noise.** R112's photocell is ±0.0745°, about 7 µsr. Rows near a bound stay "unsure" at 2 M rays even guided.
  Optimise margins (`row.margin`, in decades) rather than counting passes.
- **The aim normalises your cut-off height,** but it is found by the steepest step near the line. A bright
  streak far above (within ±3° of the line for R112) can still capture it.
- **Left-hand traffic** mirrors H; the spec items are already resolved for the user's choice.
- The bench LED is `generic`. Real emitters (`js/source-presets.js`) range 30–200 cd/mm². Domed ones trace a
  real dome but are handed to you as their flat apparent size.
