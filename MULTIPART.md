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

### `projector-v2` (2026-10-04, experimental): first draft, does not beat v1 yet
Depth-map reflector (each cell picks its own confocal-ellipsoid depth; shell test against the other facets), lens
picked by a meridional traced field map (free k, biconvex; the map also places image points on the real focal
surface), shield auto/on/off with defocus, curved `quad` strips clipped to the envelope, 6 flat upper-band facets
(intensity = refl × luminance × patch area), traced spec calibration (≤ 4 rounds × 1 M rays, ~10–16 s).

Bench at 8 M rays, sure fails / unsure · peak (v1 re-run at 8 M alongside):

| preset | solver | box | slim | module | sealed7 |
|---|---|---|---|---|---|
| R112 B | v1 | **4**/3 · 23k | **8**/1 · 28k | **7**/4 · 17k | **6**/6 · 31k |
| R112 B | v2 | **7**/4 · 8.8k | **8**/5 · 7.6k | **6**/6 · 10k | **6**/4 · 22k |
| FMVSS LB2V | v1 | **11**/0 · 19k | **12**/2 · 21k | **10**/3 · 15k | **10**/1 · 26k |
| FMVSS LB2V | v2 | **9**/1 · 12k | **14**/1 · 6.5k | **10**/3 · 6.6k | **10**/3 · 19k |

- **Upper band works in principle:** the FMVSS 0.5U–4U rows and the R112 sign points now pass on box (v1 fails
  them all), but the blobs (≈ 9–11° tall: the LED seen from 6–13 mm) leak into FMVSS 10U–90U.
- **The hot spot is flux-starved** (75R / 50R / Zone IV, FMVSS 1.5D 2R and 2D–4D wide points): on the box fixtures the
  lens acceptance cone at the focus (tan ≈ 0.4–0.5), not the envelope, bounds the reflector to 6–13 mm from the LED.
  The depth-map freedom can't use the envelope there; a faster lens (biconvex / higher NA) is the lever.
- **Engine gotcha found:** a polygon clip is convex-only (`geometry.js` intersect). A non-convex shield polygon silently
  passes light (v1's R112 / FMVSS shapes happen to be convex). v2 builds the shield as convex strips.
- Biconvex candidates that are ball-like (t > 0.75 a) are skipped: the meridional model and the 3D trace disagree there.

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

### `tir-array-v2`: exact conic dome, toric `quad` exit lenslets, blur-aware aims, partitioned option, traced calibration
- **Why v1 fell from 42.7 % to 3–7 % at K ≥ 3:** it's the scoring scene, not the allocation. The paint-fidelity blur
  allowance (`achievableKernel` in `js/photometry.js`) comes from the envelope and `scene.source`, assuming a reflector
  could sit at the far side of the box. The bench widens the envelope with K, so the kernel shrinks from 2.44 to 0.82
  cells. The identical K=1 design scores 39.5 % (envelope half-y 22), 25.0 % (62) and 2.2 % (102). Three copies of the K=1 design
  (`split: shared`) score 2.4 % at K=3. The gap band then catches the TIR's ±5–9° LED image.
- **Bench:** `tools/tir-array-bench-v2.js` (1 M paint rays, 2 M guided spec rays). Paint fidelity v1 → v2:
  K=1 42.7 → 65.4 %, K=3 3.0 → 30.9 %, K=5 6.7 → 31.9 %. R112 B fails / unsure v1 → v2: 1/6 → 4/5, 2/5 → 1/7, 4/4 → 2/4.
  FMVSS LB2V: 7/1 → 6/3, 7/1 → 7/1, 7/2 → 6/3. 0 violations, 12–19 s.
- **Most of the gain is blur-aware aiming.** The predicted LED image is 15 paint cells, which is bigger than every
  region, so every lenslet ends up flat (fan 0). Paint calibration rounds don't help and are kept only when better.
  Spec calibration at 3e5 rays is too noisy: K=1 R112 picked a "1 fail" round that shows 4 fails at 2 M rays.

## Known gaps

- **Report metrics assume reflector-only optics.**
  - "% of ceiling" uses the facet brightness-theorem table: the projector reads 173–200 % because lens parts aren't in it.
  - "blocked" counts light that ends on a shield and can exceed 100 % (it is normalised by first-surface outflow).
  - Needed: a parts-aware ceiling (aperture silhouette) and a blocked metric that knows shields are meant to absorb.
- ~~No curved refracting patch~~ **Built (round 2):** `quad` general quadric patch (any interaction), `iorFront`
  (glass | glass interfaces), `fresnel: 'exact'` (angle-dependent Fresnel splitting, traced), bounce cap 16.
  True freeform (polynomial / NURBS sag) deliberately skipped (Anya, 10-04).
- **Reflector solvers ignore the extra emitters.** They design for `input.source` and ignore any lens the user adds; that is expected.
- **Emitter editing:** emitters can't be dragged in the 3D view yet (sidebar only).
- **Backlog (Anya, 10-04): a per-emitter popup in the Optics pane**, like the facet report you get when the pane is expanded:
  - Click an emitter and its card opens. It shows a local rendering of the LED with its axis / emission cone (where it points), plus its share of flux on target.
  - The card holds inline copies of the emitter controls (position, aim, power, on/off, match source), so you don't need the sidebar.
  - Pairs with dragging emitters in 3D. Not started.

## Backlog: light guides and FDM-printed optics (Anya, 10-04; not started)

Light guides are TIR bodies with extraction features. The engine can already guide light. It **cannot** extract or
diffuse it, so this needs engine work first:
1. **Scattering interactions:** a Lambertian reflector (white paint, printed dots) and rough refraction (the refracted
   direction jittered by a slope distribution: etched or textured faces).
2. **Bodies and volume scattering:** know which body a ray is inside (closed bodies, not just per-surface indices),
   then a free-path draw inside it: a scatter length, a Henyey–Greenstein phase function, absorption per mm.
3. **Bounce cap per scene:** guides take tens to hundreds of bounces (16 now; the per-hit counter saturates at 255).
4. **A lit-appearance metric:** luminance uniformity across the emitting face, and efficiency (out the face vs
   leaked / absorbed). Guides aren't judged by a beam pattern.
5. **The fidelity blur allowance is reflector-only** (`Photometry.achievableKernel`: the smallest LED image from any
   envelope point). With lens parts or several emitters it measures the envelope, not the optic (tir-array-v2
   root cause). Needs an allowance based on the actual optic, like the "% of ceiling" gap.

**FDM idea (clear high-flow PETG/PLA):** model the print as an **anisotropic medium** rather than explicit geometry
(hundreds of layer interfaces would blow the bounce cap):
- **Layer and road boundaries:** per mm of path, a ray crosses |d·z_print| / layer height layer boundaries, plus
  road boundaries across the road direction. Each crossing scatters or reflects with a probability that depends on
  the angle (thin voids: grazing rays TIR inside one layer, so a layer can act as a slab waveguide).
- **Outer-wall layer lines:** periodic ridges along print z, i.e. a one-axis lenticular diffuser (rough refraction
  with an anisotropic slope distribution).
- **Uses:**
  - Rank print orientations: re-trace with z_print rotated and compare loss and diffusion.
  - Design for FDM: use road direction and wall ridges as deliberate extraction or spread features.
- **Calibration:** without measurements this only ranks orientations qualitatively. Absolute predictions need test
  bars printed in 2–3 orientations, measured with an LED and a lux meter or phone, then a fit of the scatter per
  crossing and the attenuation per mm.
