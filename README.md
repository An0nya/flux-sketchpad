# Flux — reflector sketchpad

A browser sketchpad for designing segmented reflectors (and simple lenses) around one idea:
**every optical segment forms an image of the light source on the target.** You arrange those
source images so they tile the pattern you want, and a Monte-Carlo ray tracer shows what you
actually get.

## Running it

**No server needed.** Open `index.html` directly (`file://`). Every script is a classic
`<script>`, not an ES module, and the app never uses fetch, XHR, workers or dynamic imports. If a
script fails to load anyway, the page shows a banner that names the missing module instead of
going blank.

> Verified in this session only over `http://localhost`. The in-app preview pane I tested with
> renders `file://` pages as a static snapshot without their relative assets. See
> *Honest gaps*.

The verification suite runs headless in Node (v18+; this session used v25.8.1):

```bash
node tests/headless.js
```

Options: `--only 1,2,14` runs a subset, `--json out.json` writes results. Exit code 1 means a
check failed. The same checks run in the page under **Verification → Run all checks**.

`tests/serve.py` is a tiny no-cache static server that I used for browser testing only (port
8743). The app doesn't need it.

## A two-minute tour

| Panel | What it is |
|---|---|
| **Scene** (big, left) | Isometric (orthographic) 3D view with an unrestricted trackball: drag to orbit, pinch/wheel to zoom, two-finger or shift-drag to pan. Handles: amber = source (drag to move), yellow tip = emission axis (drag to aim in any 3D direction), grey = envelope faces (drag to resize), blue = target (drag its distance). *Fixture* / *Whole scene* re-frame the view; orbit round to see the target's lit side with the heatmap on it. Up to 240 traced ray paths are drawn. |
| **Target** (top middle) | Left is the mode's editor: A = painted intent, B = direction-from-source picker, C = profile cross-section. Right is the simulated accumulator grid. The grid resolution, the component shown (total / direct / via surfaces) and the *display smoothing* toggle sit here. Smoothing blurs the picture only; every statistic uses the raw grid. |
| **Surfaces** (bottom middle) | The optics alone, either as shaded translucent polygons with normal arrows or as per-surface source→surface→out ray pairs. |
| **Stats + Physical limits** (bottom) | Stats with their definitions (coverage and uniformity always shown together), an energy bar whose bins sum to the emitted power, and a persistent physical-limits report naming the binding constraint quantitatively. |
| **Side panel** | Mode controls first, then source, target, envelope, lenses, simulation (Advanced), scene contents (toggle/clear groups), definitions, verification, and read-only solver diagnostics. |

Presets (top bar) replace the scene after an inline confirmation: headlamp beam (A), tall deep
box with the LED on a side wall (A), three stamped tiles (B), parabolic reflector (C), CPC
collimator (C), freeform lens profile (C, refract), TIR collimator, and Fresnel spotlight. Any
setting a preset changes (e.g. *bounces raised to 4 for the CPC*) is announced in the notices
under the stats.

**Modes**

- **A · Paint.** Paint the left grid (brush size and level under it; quick patterns in the side
  panel). *Generate* places facets whose source images tile the painting. With *auto* on, it
  re-generates when you pause.
- **B · Stamp.** Tap the simulated map to stamp a tile, drag it to move it, and set its scale in
  the side panel. The scale slider's range is clamped to what that facet can physically paint,
  and the reason is stated. The left panel is the second 2D picker: direction from the source
  (drag a marker to choose it by hand, or leave *Auto*). Placing or moving a stamp fires a
  single-ray preview through the engine (cyan path in the scene).
- **C · Profile.** Tap to add points, drag to move them. Revolve (default) or extrude; mirror,
  flip facing, reverse axis; tag the profile reflect / refract / absorb. A closed profile tagged
  *refract* is a solid lens.

Lenses (any mode): plano-convex, biconvex, TIR collimator and an N-ring Fresnel lens, all
parametrised and placed on an axis through the source.

## How it works

### One exact primitive

Every optical surface is a **quadric** `XᵀQX + L·X + K = 0`, written in the surface's own local
frame and clipped by an aperture (rectangle, disc, convex polygon, or axial ring). Planes, spheres,
cones, cylinders, ellipsoids and paraboloids are all quadrics, so **ray/surface intersection is an
exact, numerically stable quadratic root everywhere**. Nothing is paraxial or tessellated in the
tracer. Revolved profiles are exact cone frusta (smooth in azimuth, faceted only along the
profile) unless you ask for azimuthal facets.

**Curved facets are exact conics.** A facet is stored as design intent: centre `P`, design
source point `S0`, aim `Z`, and an image distance `di`.

- **Flat facet:** the plane through `P` whose normal is the bisector of `P→S0` and `P→Z`. The
  derivation is commented at `facetQuadric` in `js/geometry.js`: from `r = d − 2(d·n)n` with
  `d = −ŝ` and `r = â`, you get `n ∥ ŝ + â`.
- **Curved facet:** the ellipsoid of revolution with foci `S0` and `I = P + di·â`. It is a
  paraboloid when `di = ∞`. Its normal at `P` is the same bisector, so the aim is unchanged, and
  it images the design source point stigmatically onto `I`. The coefficients are computed
  relative to `P` with a cancellation-free eccentricity term, so `di → ∞` passes smoothly into
  the paraboloid.

The **tile-size model** the solvers use to choose `di` and facet sizes is first-order:
`Σ_tile = J_A Σ_A J_Aᵀ + J_S Σ_S J_Sᵀ`, with Jacobians taken by central differences on the exact
geometry. It is only a model; the tracer produces the picture. It stops being accurate when:

- the facet aperture or the source is not small relative to its distance from the facet (the
  second-order terms grow like `(a/d)²` and `(s/d)²`), or
- the source point sits far from the design point `S0` (off-design aberrations).

Check #9 measures it against the tracer.

**Faces.** Every surface has a front.

- *Reflect:* the front reflects with reflectivity R (default 0.9). A ray arriving at the back
  face is absorbed (counted as *back faces*) unless the surface is flagged two-sided. The engine
  and the checks support that flag, but the UI doesn't expose it.
- *Refract:* front = air side, back = glass. It carries an index *and* a separate Fresnel
  transmission coefficient. TIR is the no-real-solution branch of Snell and is lossless.
- *Absorb:* both faces absorb.

### Engine

A BVH is used for nearest-hit search, so occlusion is always "the nearest surface wins". The
target plane is also an occluder. Bounces default to 1 with a hard cap of 8. A ray that meets a
surface after its budget is spent stops there (it is never allowed to pass through). The energy
floor defaults to 1%.

**Direct and via-surface light go to separate accumulators.** Every ray's energy ends in exactly
one bin: on target (direct), on target (via surfaces), absorbed, back faces, Fresnel loss
(untraced interface reflection), escaped, target back, or cut (bounce cap / energy floor). The UI
shows `Σ − emitted` live.

**Determinism.** Ray *i* draws from a counter-based stream seeded by `(seed, i)` only
(murmur3-mixed mulberry32), and rays always accumulate in index order. So a progressive,
time-sliced run is byte-identical to a one-shot run of the same length (check #8). The platform's
unseeded RNG appears nowhere in the project (check #23 scans for it).

**Progressive accumulation.** The page traces in ~12 ms slices per animation frame. While you
drag, runs restart as a ≤1,500-ray preview; when you let go they refine to the full count. A timer
fallback keeps runs going in hidden tabs, where `requestAnimationFrame` is paused.

**Length scale.** Every epsilon is relative to the scene's own size (`1e-9 × optics extent`).
The origin is never nudged along the normal; a relative `tmin` skips the self-intersection root
instead. That is why the bisector aim is exact to ~1e-15 (check #2).

### Mode A: accounting and geometry are separate

**Flux accounting happens in solid angle from the source**, using its actual distribution:

1. Directions are organised around a reflector axis pointing away from the painted pattern.
2. The azimuth range that carries any flux is split into spokes.
3. Within each spoke, θ is split into micro-cells of equal flux, capped at 2.5° wide.
4. Every facet owns an exact direction cell. Its outline is that cell's pyramid cut by the facet
   surface, so facets never overlap and intercept exactly their own flux.

**Geometry is an optimisation, not a prescription.**

- Along each spoke the reflector is a *tailored curve*: each micro-facet's plane starts where the
  previous one ended, with the bisector normal toward the pattern. For a distant target that
  curve is a parabola section. The family has one parameter, the starting radius `r0`.
- For every spoke and every `r0` in a geometric series, the solver keeps the longest contiguous
  run of micro-cells inside the envelope. It chooses the `r0` capturing the most flux; ties go to
  the larger `r0`, which means sharper source images.
- Spokes choose independently, so an asymmetric envelope produces a stretched, asymmetric
  reflector rather than a spherical cap. Check #13 verifies this on the tall-deep-box case: facet
  distances span ×10.5, and a paraboloid fits 10× better than a sphere.
- **Monotone by construction.** The `r0` series is anchored on source and target scale, never
  on the envelope, and a curve's inside-cells can only grow as the envelope grows. So the
  captured flux cannot fall when the envelope grows (check #12).

Facets are then carved from the captured range with equal flux, re-aimed at their own zone, and,
if *curved*, given the ellipsoidal curvature whose tile matches the zone size.

**Zones.** A sequential equal-flux partition (a semi-discrete transport map) matches facets to
target zones while preserving orientation. The painted cells are split into columns carrying the
same flux fractions as the facet columns, then into rows. A cell that straddles a cut is shared
fractionally, so each zone gets exactly its facet's share of the painted flux.

**Source keep-out** (envelope section) is a packaging clearance around the emitter. Pure
interception-maximisation always hugs the source, and a facet 4 mm from a 2 mm die paints a
24-cell blur. The keep-out is how you trade flux for sharpness. It is independent of the
envelope, so it doesn't break monotonicity.

### Mode B: inverse stamping

1. **Direction:** auto, or chosen in the picker. Auto ranks directions by the source's actual
   intensity × incidence obliquity, and skips directions another enabled surface already
   intercepts, or where the reflected chief ray would be blocked.
2. **Distance:** as far out as the envelope allows (a farther facet paints a smaller source
   image).
3. **Normal:** the bisector toward the stamp.
4. **Size:** the requested tile size fixes either the facet **size** (flat facet) or the facet
   **curvature** (curved facet at fixed aperture).

The slider range is the union of what's achievable over all positions along the chosen
direction, so every value in range changes the simulation. Anything outside it is clamped, with
the physical reason given ("the image of the 2 mm source through a facet 62 mm away, m ≈ 16").
Each stamp also reports the fraction of lamp flux its facet intercepts, integrated from the
actual angular distribution.

### Mode C: profile revolve / extrude

Profile points are `(r, z)` in a frame whose origin is the source. The axis is source→aim (the
default), the emission axis, or a world axis. The front side is the **left normal** of the drawn
direction; ticks in the editor show it. A closed refracting profile (both ends on the axis, or
first point = last) is treated as a solid: glass goes inside, air faces out, orientation is
detected automatically, and *Flip facing* still overrides it.

### Lenses

- **Plano-convex:** `R = (n−1)f`, exact for a flat first face. Placed at the front focal point
  `f − t/n`.
- **Biconvex:** thick-lens equation solved iteratively.
- **Fresnel:** N annular prisms. Each prism slope is solved by vector Snell for the ray through
  its ring centre, and the prisms are built from the same revolved line-segment primitive tagged
  `refract`.
- **TIR collimator:** a Cartesian collimating dome, a cylindrical cavity wall, and an outer
  surface integrated (RK4) so its normal ∝ `d_glass − ẑ`. It reports the fraction of the outer
  profile where the TIR condition holds.

Every lens raises the bounce cap *visibly* to what it needs (2, or 3 for TIR).

### When the request is impossible

The report next to the stats reduces each limit to a ratio, `needed / allowed`, and names the
largest as the binding constraint.

- **Minimum feature size:** the best facet's source image (tile model) against the finest painted
  feature, found by chamfer distance transform at the "lit" and "bright" levels, including
  enclosed dark gaps.
- **Étendue:** emitter area × projected emission solid angle of the captured light, against
  envelope exit aperture × pattern solid angle.
- **Interceptable flux:** the design's captured fraction × R, against an optional required
  delivered flux.
- **Facet budget & self-shadowing:** `√(painted cells / N)` against the finest feature, plus the
  measured fraction of intercepted light re-hitting other surfaces.

Check #15 builds one scene that violates each limit, plus an achievable control.

## Verification

`node tests/headless.js` result from this session (`tests/last-run.json`): **24 passed, 0 failed,
5.8 s.** The in-page run (same code) gave **23 passed, 0 failed, 1 skipped**. The skip is #23,
which needs file access. It also passed **#14b**, which drives the real `<input>` elements with
change events.

| # | Check | How |
|---|---|---|
| 1 | Tilt doubling | Mirror rotated by 0.5–20°; beam rotates 2θ to 4e-16 rad. |
| 2 | Bisector aim | 60 random flat and curved facets with tilted targets; centre ray misses by ≤1.0e-15 × path. |
| 3 | Law of reflection | Flat and spherical; angle-in minus angle-out ≤3e-16, coplanarity ≤1e-16. |
| 4 | Snell and TIR | Both directions ≤1.1e-16. Critical angle ±1e-6 rad flips refract↔TIR. TIR is lossless. |
| 5 | Occlusion | Rear mirror gets exactly 0; control (front removed) gets full flux. |
| 6 | Back face | Back-facing mirror: 0 reflected. Control and two-sided variant reflect. |
| 7 | Energy conservation | 113 surfaces, R = 0.9/0.7, absorber, TIR lens, 6 bounces: bins sum to emitted within 7.9e-13. |
| 8 | Determinism | Hash of repeat, progressive (39 slices) and re-solved runs all identical. Another seed differs. |
| 9 | Source-image scaling | Δσ² between extended and point source vs (m·s)²/12 at two magnifications: 12/12 within 4 SE + 1%. Unbinned tile width halves as the facet halves; smallest facet puts 100% in one 2×2 block. |
| 10 | Collimation | 64-ring revolved parabola: max divergence 0.88°, under the first-principles chord bound Δψ = 1.76°. Spot 21 mm vs 393 mm for a 12-facet flat array of the same aperture. |
| 11 | Scale invariance | ×10, ×0.1, ×8: normalised grids identical (0 cells differ), for the scaled geometry *and* for re-solving the scaled intent. |
| 12 | Monotonicity | Two nested envelope sequences: exact interception non-decreasing (52→86% and 77→88%); traced value never falls by more than 4 SE. |
| 13 | Asymmetric envelope | Facets span 83% of the box depth and 71% of its height; distances ×10.5; paraboloid parameter CV 0.067 vs sphere-radius CV 0.70. |
| 14 | Controls wired | All 67 controls, two values each, through the same setter the DOM uses. Primary per-mode controls must change the grid hash; the others must change grid, tallies or report. Only *Required delivered flux* is report-only (by design). |
| 15 | Infeasibility | Checkerboard → feature (×2.29). 5 mm die in a 20 mm box → étendue (×2.75). 95% flux request → interceptable flux (×1.94). Control → none. |
| 16–22 | Extra relations | Reorder = identical hash; save→load = identical hash; mirror symmetry within 1.9σ; ray-doubling distribution within 2.7σ; R = 0 → nothing reflected; one facet → one tile; the same disc built two ways (revolve vs plane) gives an identical hash. |
| 23 | No unseeded RNG | Source scan, headless. |
| 24 | Performance | See below. |

**Tolerances were fixed from first principles before looking at results, and none was loosened.**
Five checks failed on their first run.

Two failures had a wrong *test setup*. I recomputed from first principles, fixed the setup, and
left the tolerance alone:

- **#9:** the 3° emission cone didn't illuminate the facet from the corners of the 4 mm die,
  which needed 3.8°. The cone became 6°. The binned width also floors at one cell, so the
  collapse test now measures unbinned landing points.
- **#11:** the re-solve test scaled the lens focal length but not its base thickness. The
  scene-scale transform now scales all design intent.

Three failures were **real app bugs**, fixed in the app:

- **#14 caught dead or confused controls.**
  - Unlinking the aim point did nothing in Modes A and B. It now moves a separate design plane.
  - Mode B auto-direction put stamps in the shadow of the Mode A reflector. It is now
    occlusion-aware.
  - Some harness contexts were also wrong: the rays setting was ignored, azimuth is degenerate
    at 90° elevation, and one envelope move was too small to bind.
- **#21:** a facet budget of 1 produced a facet spanning 180° of azimuth. There is now a 40°
  per-facet cap, and a binding budget keeps the brightest window.
- **#23** flagged a design note that quoted the forbidden call; the note is now excluded.

Browser testing then found more bugs that the checks can't see:
- Nearest-vs-first handle picking.
- A layout overflow.
- Boot silently failing when a script didn't load.
- A Mode C preset auto-applied on entering the mode, which was a silent scene change.
- The optics view fitting to a revolved surface's origin instead of its outline.

All are fixed.

## Performance (measured, this machine)

| Case | Headless (Node 25) | In page |
|---|---|---|
| 10,000 rays × 211 surfaces × 3 bounces, occlusion on (check #24) | ~10 ms median | 9.3 ms median |
| same scene, 100,000 rays | ~100 ms | 93 ms |
| default headlamp (44 facets, 1 bounce), 1,000,000 rays | 665 ms | 1.5 s of tracing over 2.3 s wall, progressive, 124 frames, p95 frame ≈ 15 ms |
| Mode A solve, budget 48 / 200 | 38 / 42 ms | |
| Mode B solve, 3 stamps | 7 ms | |

In one early in-page run a single 600 ms frame appeared during a 1M-ray run. Re-measuring with
per-frame logging showed no frame over 21 ms, and I couldn't reproduce it. It is probably JIT
warm-up or throttling (the tab was hidden), but I haven't proven that.

## Honest gaps and deviations

- **`file://` not verified by me.** The code has no `file://` hazards (classic scripts only; no
  fetch or modules), but my testing browser couldn't load a `file://` page with its assets. All
  browser testing was done over `http://localhost:8743`.
- **Touch** was exercised with synthetic PointerEvents (touch type, including a two-pointer pinch)
  and wheel events, not on a physical touchscreen.
- **No convex (diverging) facets.** Curved facets are ellipsoids or paraboloids. Tiles larger
  than a paraboloid can make use the *crossed* branch (focus in front of the target), which
  reaches any larger size.
- **Fresnel reflection at refracting interfaces is a loss coefficient**, not a traced reflected
  ray. It is modelled as a coefficient and reported as *Fresnel loss*.
- **The emitter is not an occluder:** light reflected back into the source passes through it.
  Lens edges and the TIR mounting flange are `absorb`.
- **Mode A's objective is maximum interception** with the keep-out as the explicit
  sharpness trade. Pattern fidelity is limited by the source images, and the limits report says so.
  The zone map is a heuristic (orientation-preserving), not an optimiser.
- **The monotonicity guarantee assumes the facet budget is not binding.** When it is, the
  allocator keeps the brightest window of ≤40°-wide facets. Check #12 verifies the default
  budget.
- **Mode C and lens surfaces are not constrained by the envelope.** Only Modes A and B place
  surfaces against it.
- **Target plane placement:** it sits on the +x throw axis with distance and two tilts, and has
  no lateral offset. Unlinking the aim point keeps the design focused on the aim point while
  the observation plane moves.
- **The heatmap colour map** is luminance-monotone (inferno-like), readable without relying on
  hue.

## Files

```
index.html            layout; loads classic scripts in dependency order
css/app.css           theme + responsive layout (≥ 768 px)
js/core.js            vectors, 3×3 helpers, counter-based PRNG, hashing
js/geometry.js        quadric surfaces, exact intersection, clips, BVH, envelope   (surface geometry)
js/source.js          sources: sampling, distributions, extents, outlines
js/engine.js          tracer, energy bookkeeping, progressive stepping, stats       (simulation engine)
js/state.js           serialisable scene, save/load, localStorage, scene transforms (state)
js/solver.js          tile model, vergence solve, direction frames, zone partition
js/modeA.js modeB.js  paint→facets allocator; inverse stamping
js/profile.js lenses.js   Mode C sweep + presets; lens presets
js/feasibility.js     physical limits and binding constraint
js/controller.js      control table + actions shared by the DOM and the checks
js/render.js render2d.js  canvas renderers                                        (rendering)
js/input.js           Pointer Events: drag, orbit, pinch, pan, wheel, tap          (input handling)
js/panels.js ui.js    DOM panels, run loop, interactions
js/checks1-3.js       the verification suite (in-page and headless)
tests/headless.js load.js serve.py   headless runner, loader, test server
tests/shots/          canvas snapshots taken during browser verification
```
