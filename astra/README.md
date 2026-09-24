# FLUX · an optical sketchpad

A dependency-free Canvas 2D reflector designer. Paint a destination, stamp source
images onto it, or draw a cross-section and revolve/extrude it. The simulation
samples a finite emitter and intersects real finite surfaces; every heatmap is
computed from those rays at runtime.

## Open it

**No build, install, network connection, or HTTP server is required.** Open
`index.html` directly. Classic scripts work on `file://`; a visible message explains
that direct-file mode performs the design search on the main thread. Ray tracing
still runs in small progressive batches.

**Recommended for a responsive design search:** serve this directory locally:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765`. HTTP enables the dedicated worker. This server serves
only this directory; no external resources, fonts, libraries, or services are used.
Stop it with Ctrl+C if you started it in a terminal. The demo session's detached
server is recorded in `server.pid` and writes to `server.log`.

## Try it

1. The initial ribbon scene has a finite disc emitter. **Generate reflector** builds
   its source-image tiles. Select Ring, Split, or Spot for another target.
2. Orbit by dragging empty scene space. Orbit has no pole clamp. Wheel zooms;
   Shift-drag pans. Drag the labelled SOURCE, SOURCE Z, TARGET, and ENVELOPE handles.
   Source moves in the viewing plane; Source Z and Target move along world Z;
   Envelope scales the packaging volume. Individual dimensions are in the disclosure.
3. **Stamp:** tap the intended target, drag a tile, adjust its width, duplicate it,
   or delete it. A highlighted centre-ray preview accompanies the solved surface.
   Width is clamped above the selected candidate's estimated finite-source floor.
4. **Profile:** tap radius/axial-height points. Revolve makes a dish; Extrude makes
   a trough. Parabola gives an editable starting profile with its focus at the
   current source. Flip changes winding; Mirror is available for extrusion.
5. For lenses, start with **Glass / on-axis lens**, then open **Add a lens**.
   Plano-convex, biconvex, annular Fresnel, and experimental TIR cup are available.
   This scene preset visibly chooses six bounces; simply building a lens never
   changes the user's bounce setting. A single interaction cannot traverse a lens.
6. Tap a surface in the secondary view to change reflect/absorb/refract, mirror
   reflectivity, glass index, two-sidedness, or focal length (analytic patches only).

Scene presets replace the scene after confirmation. Ordinary mode changes do not
relocate the source, reset the envelope, or change simulation settings. Paint and
profile editors preserve their contents when switching modes. Generation replaces
the currently generated optical surfaces. Existing geometry does not automatically
follow a moved source: regenerate to design for its new position.

The viewport is designed down to 768 px. All canvases accept two-finger pan and
pinch zoom. Numerical entries and standard buttons retain their native keyboard
behaviour; canvas authoring uses Pointer Events. Map zoom/pan and secondary-camera
position are view-only conveniences and are not included in scene JSON.

## Reading the output

- **Coverage:** fraction of all cells with nonzero energy.
- **Uniformity:** `1 − σ/μ` over lit cells only. It can be negative. A single bright
  cell gives 1.000, which is why coverage sits immediately beside it.
- **Intercepted:** primary emitted power encountering any optical surface,
  including absorbing back faces. A primary ray is counted only once.
- **Via surfaces / direct:** fractions of emitted power arriving after an optical
  interaction / with none. Refracted paths are included in "via surfaces".
- **Energy ledger:** target + absorbed + escaped + unresolved = emitted.
  "Unresolved" means the bounce cap or energy floor ended tracking; it is not
  silently called absorption. Reflected and refracted target subtotals can overlap
  for mixed paths and are explicitly labelled accordingly.
- **Trace time:** accumulated measured simulation CPU time, excluding design,
  worker messages, rendering, and scene compilation. The performance test also
  measures end-to-end simulation construction and tracing.

The heatmap uses a square-root *colour transfer* normalized to the current peak,
so faint paths remain visible. Colours are relative, not an absolute photometer.
"Smooth display only" interpolates image pixels; it never changes the accumulator
or any statistic. Coarse preview uses up to 600 rays, then refines to the chosen
count after interaction stops. Large runs publish repeated partial accumulators.

Scene state saves automatically to `localStorage`. Save makes this explicit;
Export JSON produces the complete optical scene, design input, seed, and settings.
Open validates and restores that file. Traced grids are recomputed, not persisted.

## Physics and design decisions

See **[PHYSICS.md](PHYSICS.md)** for derivations and implementation pointers. Briefly:

- Exact ray/plane, ray/triangle, and ray/paraboloid intersections, accelerated with
  a bounding-volume hierarchy (a tree that excludes surfaces a ray cannot reach).
- Reflective paraboloids use the exact local normal. **Their intersections are not
  paraxial.** The inverse tile-size estimate is paraxial; large angles, deep patches,
  and off-axis astigmatism visibly depart from that estimate.
- Mirrors have absorbing backs unless two-sidedness is explicitly enabled.
  Default reflectivity is 0.9. Refraction uses Snell, unpolarized Fresnel power
  splitting, and total internal reflection. Reflected and transmitted energy
  branches both continue through the same occlusion engine.
- Lens meshes have outward normals and finite thickness. The current medium rule
  assumes separated glass bodies in air, not nested or intersecting materials.
- Placement searches equal-optical-path ellipsoids/paraboloids at varying radii,
  uses source angular density and projected solid angle for flux ranking, and
  allocates weighted painted zones. It does not place facets on a spherical shell.

## Honest limitations

This is a working exploratory tool, **not a globally convergent optical optimizer**.
These are substantive limitations, not just cosmetic TODOs:

1. Painted patterns use a greedy, source-image-aware construction. Tile allocation
   is weighted by the requested brightness; actual intercepted flux varies between
   facets. There is no final nonlinear optimization of the whole traced pattern.
   Detailed targets can remain uneven or blurry. The ray trace shows that error.
2. Envelope growth retains a feasible previous design when a new search has lower
   interception on 10,000 identical samples. This protects *measured* interception
   during an unchanged design's growth sequence. It does not prove a global optimum,
   guarantee all unseen sampling seeds, or compare unrelated source/target settings.
3. Minimum-feature and étendue notices are geometric/paraxial estimates. They are
   useful warnings, **not rigorous general impossibility proofs** for arbitrary
   off-axis optics. The tool has no absolute target-brightness demand input or exact
   phase-space feasibility solver. A source-image floor constrains stamps, but
   their requested size still need not equal the traced off-axis footprint.
4. The TIR preset is a closed expanding dielectric cup with a recessed entrance,
   **not an optimized TIR collimator**. Its real boundary physics is implemented;
   the ideal freeform collimating construction is unfinished.
5. Revolved/extruded profiles and lenses are faceted meshes. Refinement derives
   from the budget; their triangle count can exceed the reflector's tile budget.
   A freeform refractive profile must close around its material and have outward
   winding. The editor warns about this but does not infer or repair topology.
6. A profile is source-relative and aligned to world Z, not automatically to an
   arbitrary source axis. Source-axis changes affect emission, not existing geometry.
   Geometry outside an envelope is omitted on profile generation; a partly clipped
   refractive profile can consequently be open. Check that warning before treating
   it as a lens. Lens presets instead reject the entire construction if it cannot fit.
7. Shrinking/moving an envelope can leave previously authored surfaces outside it;
   the trace continues to represent those real surfaces until regeneration. No
   surface is invisibly clipped by the tracer.
8. Stamping uses automatic position selection. There is no optional angular picker.
   Surface ray-pair display illustrates local reflection/refraction directions;
   full branched and occluded paths are shown in the main scene trace.
9. Two-finger gestures are implemented but were not tested with physical touch
   hardware. Canvas controls lack a full screen-reader editing alternative.

No diffraction, interference, polarization state, spectrum/dispersion, material
roughness, bulk glass absorption, or thermal emitter model is included.

## Verification

```sh
node tests/run.cjs
```

This executes the common numerical suite without a browser or dependencies and
writes `tests/results.json`. **Run physics checks** in the app runs that same suite
plus browser-only regressions which exercise DOM input and pointer handlers for
each design mode. The user's scene is restored afterwards. See
**[VERIFICATION.md](VERIFICATION.md)** for measured results, failures found during
development, and the distinction between what was run and what remains unverified.

## Files

| File | Responsibility |
| --- | --- |
| `js/math.js` | Vectors, seeded random stream, Snell and Fresnel |
| `js/state.js` | Serializable state, validation, shared edit reducer |
| `js/geometry.js` | Finite surfaces, intersection, acceleration, enclosure tests |
| `js/engine.js` | Emitter sampling, nearest-hit propagation, energy accounting |
| `js/design.js` | Inverse tiles, placement, profile sweeps, lens geometry |
| `js/render.js` | Orthographic 3D projection and Canvas 2D drawing |
| `js/input.js` | Pointer authoring, direct manipulation, pan/zoom/orbit |
| `js/worker.js` | Background design and progressive tracing |
| `js/app.js` | UI binding, persistence, lifecycle and browser regressions |
| `js/checks.js` | Shared executable numerical checks |

All lengths use one arbitrary but consistent unit. Choosing millimetres is fine;
uniformly scaling the scene changes no geometric-optics pattern.

---

## Solver changes (post-Astra, 2026-09-18)

The original build is preserved verbatim in `../work-codex-astra-reflector-v3-ASTRA-BASELINE/`.
Physics, tracer and UI are unchanged; only the facet allocator in `js/design.js` was
reworked. All 22 checks in `tests/run.cjs` pass before and after.

### 1. Facet solid angle decoupled from the candidate lattice

`candidatePositions` generated `angular = max(192, count*8)` sampling directions and
tagged each candidate with `omega = 4π/angular`, which `makeFacet` then used to *size*
the facet. Those are two different quantities: a lattice sampling weight and the solid
angle a facet should cover. Welding them made total captured angle `count · 4π/(8·count)`
— a constant. Measured interception was flat at 36.5–37.3% from 25 facets to 800:

| facets | 25 | 100 | 200 | 400 | 800 |
|---|---|---|---|---|---|
| intercepted | 36.8% | 37.1% | 37.4% | 37.2% | 37.3% |
| solve time | 71 ms | 1.1 s | 5.9 s | 37.8 s | 247.7 s |

Candidates now carry `share = 2π · design.fill / count`, so N facets split `fill` of the
forward hemisphere and capture is independent of lattice density. At `fill = 1`
interception is 76–81% across the same range. `fill = 0.25` reproduces the old sizing
exactly, and does reproduce the old numbers — that is the parity check.

`fill` trades capture against spill, **not** against precision. Edge sharpness is set by
the source-image floor `blur = (dt/ds) · source_size`, which contains no width term;
shrinking facets below it only discards aperture. The floor moves with geometry — a
larger envelope, a source further from the reflector, or a smaller emitter.

### 2. Global-greedy assignment instead of request-order greedy

`solve` walked requests in `zones()` order and gave each one first pick of the whole
candidate set. That order comes from a weighted-quantile sweep and therefore correlates
with position on the target, so first-come-first-served on the angular exclusion
systematically handed one edge of the painted region the best solid angle.

Now scoring and placement are separate passes: every (request, candidate) pair is scored
in closed form, each request keeps its `KEEP` best, and the best pair *anywhere* takes a
facet. A fallback pass rescans the full candidate list for any request whose kept set was
exhausted, so placement count never regresses below the original.

### 3. Cost

`Geo.fits` (a 16-step shrink loop) and `tileEstimate` (which allocates two objects per
call) no longer run during scoring. The two `.some()` scans that made placement O(N³) —
measured exponent rising 1.73 → 2.71 across 25→800 facets — are replaced by a lattice
bitmask for the angular exclusion and a spatial hash for the separation test. Both are
exact, not approximate: every candidate sits on a lattice direction, and marking every
cell an exclusion ball touches means two overlapping balls always share a cell.

| facets | before | after | |
|---|---|---|---|
| 100 | 1.09 s | 0.11 s | 10× |
| 200 | 5.88 s | 0.44 s | 13× |
| 500 | 69.1 s | 2.4 s | 29× |

The facet budget slider now reaches 500. Whether quality saturates before that is
**scene-dependent, and an earlier claim here that it always does was wrong.** On the
coarse default `bar` preset (round 0.6 emitter, 32x24 target at 55 units) coverage and
uniformity do plateau near 100 facets. On a real low-beam scene (0.1-aspect emitter,
100x50 target at 128 units, grid 100) they do not: unlit cells inside the painted region
fall 20.3% -> 7.5% -> 0.2% from 100 to 200 to 500 facets. A narrow die and a finer target
grid both push the saturation point up. Count buys pattern resolution, not capture.

### 4. `design.edgeBias` — contrast-weighted zone allocation (optional, default 0)

Plain quantile allocation spends facets in proportion to painted flux, which is a
uniformity objective: it has no opinion about *where* error lands, so it smooths
interiors and rounds edges. Above 0, `edgeBias` weights the painted boundary up and
shrinks the tiles landing on it. On a `bar` preset at 100 facets with a 0.15-unit
emitter, `edgeBias = 1` raised the measured cutoff gradient from 0.473 to 0.870, with
uniformity falling from −0.10 to −0.29. That trade is the point.

It is **inert** whenever every requested tile already sits under the source-image floor,
since tile size enters only through `max(0, size − blur)`. `feasibility()` now says so
explicitly rather than leaving a slider that silently does nothing.

### 5. Two regressions this restructure introduced, and what fixed them

Worth recording because neither showed up in the 22 checks, and only one showed up on
the default preset.

**Pre-shrink scoring.** Stage 1 ranked candidates on the closed-form facet width, but
`makeFacet`'s envelope loop can take `0.85^16` off it and recomputes `focal` as it goes.
Ranking on the asked-for geometry rather than the achieved geometry quietly preferred
candidates that were about to be cut down. Invisible on the roomy default envelope;
on a 12.5-deep one it cost 12% of total facet solid angle and pushed median facet radius
from 16.8 to 18.3, which is a ~14% interception loss (solid angle goes as w^2/r^2).
Fixed by re-scoring each request's shortlist with the real post-shrink score before
placement — the original's criterion, paid for `PREFILTER` candidates per request rather
than for every candidate.

**Prefilter too narrow.** With the cheap prefilter at 24 the re-scoring had too small a
pool to recover from, leaving a 1-3 point gap. 64 restores parity; 192 measures identical,
so 64 is sufficient.

Measured parity after both fixes, on the exported low-beam scene (`fill = 0.25`, which
reproduces the original facet sizing exactly):

| facets | 100 | 200 | 500 |
|---|---|---|---|
| baseline intercepted | 33.26% | 32.80% | 33.64% |
| current intercepted | 33.21% | 32.83% | 33.64% |

**Method note.** Both regressions were found by comparing chosen facet sets — total solid
angle, median width, median radius — not by comparing the headline efficiency number.
The efficiency number said "worse"; the radius distribution said *why*.

## Known issues (reported 2026-09-18, not yet fixed)

Anya's list, logged so it is not lost. None are addressed by the solver work above.

All three are sign/convention bugs in one basis construction, not structural. Root causes
traced but deliberately NOT fixed — each one changes how every existing scene looks, so
they want doing together and with intent.

1. **Target map is vertically inverted.** `targetHit` returns `v = q[1]/height + 0.5`, so
   v increases with world +Y (up). `drawMap` paints cell index `i` at canvas row
   `floor(i/n)`, which increases downward. World up therefore lands at the bottom of both
   the INTENDED and SIMULATED maps. Self-consistent between paint and trace, which is why
   the solver is unaffected, but wrong against the 3D view.
2. **Target map appears mirrored — but this is probably a viewpoint issue, not a
   coordinate bug.** The default camera (`view.yaw = 0.62`) sits *behind* the target
   plane, looking back at the source. Any image on a plane reads mirrored from the far
   side, so the map may be entirely correct and simply viewed from the back. The likely
   fix is moving the default camera to the source side — a `view.yaw` default, not a
   basis change.
   ⚠️ An earlier attempt negated `u` for the target only (`V.frame` returns
   `u = [-1,0,0]` for a −Z normal, which looked like the culprit). It made things
   **worse**: mirrored *and* inverted, i.e. a 180° rotation, because the vertical
   convention in issue 1 is entangled with it. Reverted. Do not repeat it. Whatever is
   done here must be driven by an on-screen measurement with an **asymmetric** test
   pattern — a symmetric preset like `bar` cannot show handedness, which is exactly how
   the wrong fix got as far as it did.

3. ~~**Target breaks at extreme tilt.**~~ **Fixed.** `V.frame` picked its reference axis as
   `Math.abs(n[1]) < 0.9 ? [0,1,0] : [1,0,0]`, and that switch is discontinuous: at
   |n_y| = 0.9, i.e. **tilt ≈ ±64°**, the reference flipped and the target's local u/v
   rotated 90° in one step, so width and height swapped. Everything past 64° was wrong.

   The target plane only ever rotates about world X, so its horizontal axis is always world
   horizontal and there is no basis to derive. `V.planeFrame` (`js/math.js`) projects
   `[-1,0,0]` onto the plane instead, and the four target call sites use it. `V.frame` is
   deliberately untouched — it also builds every facet's basis, and changing it would move
   solver output.

   Verified: identical to `V.frame` to **1.1e-16** wherever |n_y| < 0.9, so no behaviour
   changed below the old threshold; largest step in `u` per 0.25° of tilt went
   **1.414 → 0.000000**; a ray traced through `targetHit` is smooth across 64°; the basis
   stays orthonormal at a fully horizontal plane. Tilt slider is now ±89°, which reaches
   the road-plane case it previously could not express.

Fixing 1 and 2 is a row-order flip and a `u` sign flip — but see the warning in issue 2
before attempting either.

## Auto-tune and intent-relative metrics

`stats()` gained `intentFilled`, `intentOnTarget`, `intentUniformity` and `intentCells`,
all computed inside the painted region. The pre-existing `coverage` and `uniformity` are
whole-target-plane measures that do not know where the painting is, so **both are
maximised by a thin even wash across everything** — fine as diagnostics, actively
misleading as objectives. They are now labelled as such in the stats panel.

`js/tune.js` does coordinate descent over facet budget, capture fill and design emitter,
tracing 20,000 rays per combination and scoring with one of three intent-relative
objectives. Each carries a small guard term so it cannot win by putting no light on the
target. Measured on the exported low-beam scene, 12 evaluations, ~17 s:

| objective | result | filled | on-target | intent unif. | captured |
|---|---|---|---|---|---|
| Fill the intent | 500 facets, fill 0.5, emitter 0.5 | 0.887 | 0.970 | 0.171 | 59.3% |
| Contain the beam | 500 facets, fill 0.5, emitter 0.25 | 0.863 | 0.973 | 0.132 | 59.1% |
| Even interior | 350 facets, fill 0.15, emitter 0.5 | 0.639 | 0.966 | **0.330** | 21.5% |

The third row is the honest shape of the trade: evenness costs two thirds of the captured
light. The search runs in the existing web worker and reports progress per evaluation.

## Layout

Header and the metrics bar are pinned and compact (46 px header); sidebar and workspace
scroll independently; ☰ collapses the sidebar. The scene canvas **flexes to fill whatever
height is left** rather than being a fixed or draggable size — on a short screen a divider
only ever traded one cramped view for another, so the surfaces panel, the target-plane
panel and the constraint notes are each collapsible instead, and the scene absorbs the
space. Notes are collapsed by default.

Above 1280 px wide the surfaces and target-plane panels move into a side column beside the
scene rather than stacking under it, which hands their whole vertical budget back to the
render. Measured at a 1512x800 viewport, the scene canvas went 79 px -> 248 px (compact
chrome) -> 529 px (side column), i.e. 792x529 with a 408 px side column.

⚠️ The sidebar collapse originally set `grid-template-columns:0 minmax(0,1fr)` with
`aside{display:none}`. With the aside removed from the grid, auto-placement put the
workspace in the **0-width first track**, so the page appeared to slide off to the left.
Collapsing now switches `main` to a single track.

⚠️ This stylesheet appends overrides after the original media queries, so the responsive
canvas heights at narrow widths are superseded. Fine at desktop widths; revisit if the
narrow breakpoints start mattering.
