# Solver handoff: building a better default paint solver

Written 2026-09-27 at the end of the session that built the "Mosaic" benchmark solver, for a fresh session that
builds the app's new default solver with Anya. Covers design and physics only. Benchmark scores and held-out
scenes are private: see `~/Projects/agent-qa/FLUX-BENCH-NOTES.md` (the "Benchmark v3" section) and
`~/Projects/agent-qa/work-opus55-flux-solver-20260927-0154/solvers/NOTES.md`.

## What Anya decided (2026-09-27)

- **Goal:** a solid, multipurpose default solver for the app. Not a research or portfolio piece. Automotive
  (cutoff, FMVSS-style limits) is a separate, specialised solver for later.
- **Priority:** fidelity, then uniformity, then light output. Steer away from the "constellation": as many tiny
  facets as possible painting the target like a pixel grid. It's valid, but boring.
- **Facet count is a ceiling,** not a budget to use up.
- **Speed:** about 5 s target for one solve (the app then traces once); 60 s hard cap for huge facet counts or grids.
- **Freeform facets (conic + polynomial) are out:** the trace cost is too high without hardware acceleration.
  **A two-curvature facet is in** (see "Facets" below).
- The solver may change the engine and app here; this is not benchmark mode.

## What exists to start from

- `~/Projects/agent-qa/work-opus55-flux-solver-20260927-0154/solvers/solver.js`: Mosaic v0.5 (static, id
  `opus-mosaic`) plus a tuner (id `opus-mosaic-auto`). The tuner is a separate registration appended after the
  static solver, which it doesn't modify. It's one self-contained file on the published solver API.
- `…/solvers/dev/`: harnesses. `diag.js` does per-facet blocking and prints an ASCII verdict map; `batch.js` runs a
  scene suite with a determinism check; `scenes.js` holds 14 scene variants; `auto.js` runs the tuner.
- Anya's low-beam test scene: `~/Downloads/reflector-scene (2).json`. The LED faces back into the reflector,
  0.8 × 0.4 mm, 10 m throw, 212 facets, 9 paint levels. It contains her hand-tuned Mosaic settings.

## Physics that mattered (each was measured in the run)

**1. What a facet paints.** Take a facet at distance r from an LED of size s, painting a target at distance D,
with image distance di. In paraxial form, a ray from LED point x_s through facet point h lands at

    y = h·(1 − D/di) − x_s·D/r

- **Focused** (di = D): the patch is the LED's image scaled by D/r. That's the smallest patch this facet can make.
- **Defocused:** add the facet's own outline, scaled by m = 1 − D/di.
  - m < 0 means the light converges, crosses a focus and diverges, so the outline is inverted.
  - A flat mirror behaves like m = 1 + D/r.
- For an ellipsoid facet (foci at the LED and at P + â·di), the centre of the LED images exactly. The outline term is
  the facet outline projected from the second focus onto the target. The LED term is each LED point reflected at
  the facet centre (the chief ray).
- This model predicted the fraction of cells within tolerance to within about 3 points of the real trace.

**2. Flux follows solid angle, not distance.** A facet catches the light in its cone of directions. A far facet
paints a smaller, sharper image and needs more mirror area for the same light. A near one is small and blurry.
Near facets are cheap fill; far ones are edges and hotspots. The Mosaic's placement discovered this by itself:
blurry facets placed first took the broad areas, and the sharp distant ones ended up on the hotspot.

**3. Seen from the target, facet outlines must not overlap (the most important constraint).** Light leaves every
facet heading roughly toward the target. If one facet's outline, projected along that direction, overlaps
another's, the rear facet's light hits the front one.

In practice: along each meridian (rear to front around the beam axis), a facet's height above the axis,
ρ = r·sinψ, must keep growing toward the front. A paraboloid does exactly this. Two consequences:

- **Hugging a flat envelope wall builds a sawtooth, and every tooth blocks the next.** The first Mosaic lost 43% of
  its reflected light this way.
- **Coverage trades against sharpness.** Covering one more forward direction caps every facet behind it at that
  direction's height. With a flat top wall, covering 180° of a meridian forces a paraboloid of focal length about
  20 mm, and every facet ends up close to the LED and blurry.

Mosaic's fix was to leave a cone about the beam axis open (openAngle, 90° by default), put every tile at the
envelope wall, and lower rear tiles until the ordering holds. It enforces this as pairwise constraints between
tiles that neighbour along a meridian: r_a·A ≤ r_b·B.

**4. Cone-bounded outlines stop facets shadowing each other.** Give each facet the outline of its own cone of
directions (intersect the cone's corner rays with the facet plane). Facets then tile the LED's view with no gaps
and no overlaps, whatever their depths. Measured shadowing: 0.6–0.9%.

**5. An LED facing the target floods the gaps with direct light.** One flat mirror in front of the LED, covering
the cone toward the painting, sends that light straight back. On a test scene, fidelity went from 0.8% to 88.6%,
but only 3.5% of the light landed on the paint. That configuration is physics-limited.

**6. Blur sets the fidelity ceiling.** Where strokes are about as wide as the smallest LED image, edge rows go dim
and the gap rows beside them go bright. A 0.5 mm LED with 5-cell bars was the worst case.

## The Mosaic algorithm, in one paragraph

1. Split the LED's emission into about maxFacets equal-flux tiles. This is a k-d split on an equal-area map of
   directions centred on "straight back from the target".
2. Solve the shell with the ordering constraints.
3. For each facet, rasterise its footprint ("blob") for up to 6 defocus sizes and up to 4×4 sub-cell phases.
4. For each facet and a grid of aim points, march rays from its centre and corners to find the share of its light
   blocked by other facets.
5. Place facets greedily, largest blob first, each where it most lowers a cost that mirrors the scorer. Then run 4
   sweeps that lift each facet and re-place it within a shrinking local window.
6. Emit ellipsoid facets with di = D/(1 − m). Run the host's `RF.Solvers.verify` and drop any facet it flags.

Solve time is about 0.3–0.7 s at 100 facets and grows sub-linearly with the facet count.

## What worked, what failed

Worked:
- **Sub-cell aim phases:** the biggest single gain.
- **Hybrid search:** top-2 per size in the global pass, every phase in local sweeps. Same quality as an exhaustive
  search.
- **Tail cut:** dropping blob cells below 2% of the peak, rescaled to keep the total flux.
- **Moving the hot cost loop to module level.** When it was a closure re-created per solve, V8 deoptimised it and
  every solve after the first in a worker ran 1.7× slower.

Failed:
- **A per-meridian coverage rule** (choose how far forward to cover by flux × sharpness): its model ignored the
  tile-level constraints, and the real shell collapsed. Removed.
- **Scanning the centre phase only, then refining:** −1.3 points. Kept only as the hybrid above.

**Anya's hand-tune beat the tuner on her low-beam scene, by metric and by eye.** Her settings: `gapWeight` 0,
`tight` 0, `farWeight` 0, `maxDefocus` 3, `maxBlobFrac` 3, `openAngle` 3, `mouthCos` 1, `areaMix` 2, `wallMargin`
0.2, `clearance` 0, `minClear` 0, blocker off, `sweeps` 6, and the grid, LED-sample and phase resolutions at max.
My reading is inference, not tested:
- The gap penalty in my cost was too cautious for graded paint. It pulled blobs off soft edges. Turning it off
  bought uniformity for some spill.
- `maxBlobFrac` 1 capped fill blobs at the painting's short side. For a wide, short low beam that forbids wide fill
  blobs.
- The tuner never reached her settings: above 150 facets it tuned only the open cone, and its value lists excluded
  those corners.

## Where I'd take the new solver (proposals; decide with Anya)

1. **Partition first, placement second.** Use the supporting quadric method: each target spot gets a quadric with
   a focus at the LED, and one size per spot. In each direction the nearest quadric is the mirror, and the sizes are
   iterated until each spot gets its share of light. This is semi-discrete optimal transport. The tile shapes then
   come out of the geometry instead of being cut for equal flux. The reflector comes out nearly continuous, which
   works with rule 3 above rather than against it.
2. **Use the blob model from physics 1 for the extended LED.** SQM assumes a point source.
3. **Fill the wash explicitly:** large contiguous regions get a few big defocused facets, or two-curvature ones. A
   cap on how many spots may share a region makes large areas take big soft patches, which is the guard against the
   constellation.
4. **Keep matching pursuit for the hotspot and hard edges,** where its sensitivity to edges earns its cost.
5. **Put uniformity into the objective ahead of light output.** A per-paint-level spread, with two corrections:
   - Subtract shot noise: CV²_signal = CV²_measured − 1/(rays per cell). Otherwise a dimmer design is penalised for
     noise.
   - Leave out edge cells within the blur kernel. Otherwise it penalises the physics-limited fall-off at edges.

## Facets: the two-curvature primitive

A surface z = x²/4f₁ + y²/4f₂ is still a quadric: exact roots, same trace cost. `parab` already has this form with
f₁ = f₂. I'd expose it to solvers as an **intent** primitive rather than raw focal lengths: give P, S0, Z, two image
distances (di_u, di_v) and an orientation. Compile it into the tangent elliptic paraboloid whose two curvatures come
from the Coddington equations for oblique reflection:

- tangential: 1/s + 1/s′ = 2/(R_t·cos θ)
- sagittal: 1/s + 1/s′ = 2·cos θ/R_s

Here θ is the angle of incidence and s = r, the distance from the LED. With raw focal lengths every solver has to
redo that optics. If di_u = di_v, keep today's exact ellipsoid. This is untested, so check it against the tracer
before building on it.

## Gotchas (each one fails without an error)

- `di: Infinity` round-trips through JSON as null, which gives a flat facet. Store curvature 1/di instead (v3 item).
- Negative `di` gives a flat facet: `facetQuadric` tests `!(di > 0)`.
- Polygon clips work only when convex. The tracer requires a hit to be inside every edge's half-plane.
- `verify()` accepts only `facet`, `plane` and `rev`, although the engine traces `parab`.
- The runner always runs the first registered paint solver.
- A grazing corner ray on the facet plane can put an outline corner far outside the envelope. Reject facets whose
  corners land more than 3r out, and always finish with `verify`.
- Fidelity reads low at fewer rays (91.0% at 200k vs 95.6% at 1M, same design). Compare designs at the same ray
  count.
- Determinism: no time-based cutoffs. Use fixed candidate lists and stable sort tie-breaks.

## Open questions for the build session

1. Rebuild on SQM, or evolve Mosaic (it already has the blob model, shell and verify)? The two-curvature facet
   helps either one.
2. How should the default solver pick coverage (the open cone) without a tracer? Mosaic's tuner found per-scene
   optima from 80° to 100°, and Anya's scene wanted about 3°.
3. Uniformity: a gated term in the objective, or part of fidelity itself? This mirrors the v3 scorer question.
   Ideally both use the same definition.
