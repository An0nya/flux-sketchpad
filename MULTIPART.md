# Multi-part optics and multiple emitters

Branch `claude/multipart-optics-solvers-vn7kzd` (2026-10-04), off `spec-solver` (which contains `spec-mode`). Status:
the engine and contract are built and tested. Two experimental solvers are first drafts with honest numbers.

## Engine and contract (built, `tests/optics-parts.js`)

| Piece | Where | What |
|---|---|---|
| Conic surface of revolution | `js/geometry.js` (`rev`, `seg.kind: 'conic'`) | Ellipsoid, paraboloid, hyperboloid or oblate zone, `{ zv, R, k, r0, r1 }`. One exact quadric, so the intersection is exact. Ellipsoid focus 1 → focus 2 misses by 5e-14 mm; the paraboloid collimates exactly. |
| Aspheric lens | `js/lenses.js` (`asphere`), lens picker "Aspheric (projector)" | Hyperbolic face with k = −n² and R = (n−1)f toward the source, flat exit face. Collimates its focus to 1e-14° (spherical plano-convex at the same f/a: 7.8°). |
| Multiple emitters | `scene.emitters`, `RF.Source.all / totalPower / makeMixture`, sidebar "More emitters" | Extra full source objects with `id` and `enabled`. Each ray's emitter is drawn by power (one extra uniform, drawn only with more than one emitter), so single-emitter runs are **byte-identical** to before. P.power = the sum. LED clearance is checked per emitter. Spec feasibility: envelope ceiling from the brightest emitter, direct light and flux summed. Old files load with `emitters: []`. |
| Solver contract | `js/solvers.js`, SOLVER_API.md "Multi-part optics and multiple emitters" | `input.sources` (`input.source` = the first, unchanged). Refracting and absorbing parts are free of the facet budget. `output.needs.bounces` makes the app raise the cap with a notice (the controller, `tests/bench-spec.js` and `tools/run-solver.js` all honour it). `tools.trace(surfaces, { bounces })`. |

Backwards compatibility: every existing test passes unchanged, and old solvers see the same input (plus `sources`).
The facet budget counts reflecting surfaces, which is every surface an existing solver makes.

## Solvers (experimental, in `solvers/index.json`)

### `projector-v1`: ellipsoidal facets + focal-plane shield + aspheric condenser
Each reflector facet is an exact ellipsoid with foci at the LED and at a point in the lens focal plane,
I = F + (0, f·tanH, −f·tanV). The lens inverts the image, so focal-plane position maps to direction. The shield's top
edge is the spec's cut-off line mapped through that inversion (R112: flat + 15° rise; FMVSS: step). Solves in 0.1 s.
It doesn't trace yet.

Bench at 2 M rays (guided), sure fails / unsure · peak:

| preset | box | slim | module | sealed7 |
|---|---|---|---|---|
| R112 B | **1**/9 · 23k | **5**/7 · 28k | **5**/6 · 17k | **1**/11 · 30k |
| FMVSS LB2V | **10**/2 · 19k | **12**/3 · 22k | **9**/3 · 15k | **9**/4 · 26k |

- **R112:** competitive on box and sealed7 (baselines 0–6). The unsure counts need 8 M rays.
- **FMVSS fails by construction.** Its upper band (0.5U–4U rows) needs light *above* the cut-off, and the shield removes all of it.
- **Next:**
  - Light above the cut-off: a few dim direct facets outside the lens path, or shield windows.
  - Traced calibration of the 75R / 50R minimums.
- **Space limit:** the box fixtures leave ~26–32 mm in front of an up-facing LED, so f ≈ 10–14 mm and the lens is Ø17–20 mm. Only ~18–37 % of the flux gets through.
- **Paint scenes:** default = 0 % fidelity (16 % delivered); test = 20 %. One facet sits inside the test scene's LED clearance (the margin is too thin).

### `tir-array-v1`: one TIR collimator per emitter, prism-cell exit faces
- **Body:** the `lenses.js` TIR body (dome, cavity, RK4 TIR wall), tilted toward its unit's share of the paint (≤ 12°).
- **Exit face:** a grid of refracting `plane` prism cells, each aimed by vector Snell at the weighted centre of an equal-flux sub-region of the paint.
- **Flux split:** the paint is cut into horizontal slices by emitter power.
- **Parts only:** 0 facets, `needs.bounces` 4.
- **Test scenes:** `tools/tir-array-bench.js` (K LEDs in a row facing +x).

| emitters | paint fidelity | lm on target | R112 B fails / unsure |
|---|---|---|---|
| 1 | 42.7 % | 915 / 1000 | 1 / 6 |
| 3 | 3.0 % | 2722 / 3000 | 2 / 5 |
| 5 | 6.7 % | 4535 / 5000 | 4 / 4 |

- Very efficient (~91 % on target).
- **Limit:** the LED-image blur (±10° from the dome, ±3–6° from the TIR wall) floods the gaps, and spec glare (B50L, BR, zone III) comes from the same blur.
- **The drop with 3 or more emitters is not an engine problem.** A combined trace equals the sum of the per-emitter traces (0.4 % on-target difference, L1 4.8 % at 600k rays). So it is in the solver's allocation: unexplained, and the next thing to look at.
- **Next:**
  - Exact conic dome (or a conic lens in the cavity).
  - Shrink the target regions by the predicted blur.
  - Traced rebalance.

## Known gaps

- **Report metrics assume reflector-only optics.**
  - "% of ceiling" uses the facet brightness-theorem table: the projector reads 173–200 % because lens parts aren't in it.
  - "blocked" counts light that ends on a shield and can exceed 100 % (it is normalised by first-surface outflow).
  - Needed: a parts-aware ceiling (aperture silhouette) and a blocked metric that knows shields are meant to absorb.
- **No curved off-axis refracting patch.** There is no toric/cylindrical lenslet primitive (the TIR exit uses flat prisms), and no angle-limited rev segment.
- **Reflector solvers ignore the extra emitters.** They design for `input.source` and ignore any lens the user adds; that is expected.
- **Emitter editing:** emitters can't be dragged in the 3D view yet (sidebar only).
