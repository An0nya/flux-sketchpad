# Writing a solver for Flux

A solver turns a lighting problem (LED, envelope, target, painted intent) into reflector geometry.
It is **one self-contained JavaScript file** that calls `RF.Solvers.register({...})`. No other file
needs to change. The app runs loaded solvers in a Web Worker (no page access); everything that could be
gamed — what was placed, whether it fits, how good the light is — is computed by the app, not the solver.

<!-- builtin -->
Start from `examples/solver-example.js`. Develop and score headless:
<!-- /builtin -->
<!-- workspace-only:
Start from `examples/solver-starter.js` (a sealed box of mirrors: valid output that scores 0). Develop and score headless:
-->

```bash
node tools/run-solver.js path/to/my-solver.js --scaling          # --budget N sets the facet cap (default 100)
```

In the app: sidebar → Reference & debug → Solver → **Load solver file…**

## The contract

```js
RF.Solvers.register({
  id: 'my-solver', name: 'My solver', version: '0.1',
  modes: ['paint'],                 // 'paint' (a painted target) and/or 'stamps' (explicit per-facet requests)
  settings: [                       // YOUR knobs, rendered in the sidebar; types: number | range | select | checkbox
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },  // required
    { key: 'passes', label: 'Refinement passes', type: 'range', min: 0, max: 8, step: 1, default: 3 },       // e.g.
  ],
  solve(input, settings, tools) {   // may be async; deterministic for (input, settings, seed)
    return { surfaces, intent, notes };
  },
});
```

**limits are the user's, not yours:** `input.limits = { maxFacets, reflectivity }` — never place more than
`maxFacets` (fewer is fine), apply `reflectivity` to every facet. Do **not** declare `budget` or
`reflectivity` as settings: the app ignores such settings, fills them from the limits, and the runner warns.

**input** (a deep copy — mutate freely): `limits`, `source` (pos, axis, kind, shape, w/h/radius, dist, power in lm),
`sources` (every emitter, `source` first; see *Multi-part optics and multiple emitters*),
`envelope` (box `center`, `half`; `keepOut` = the **LED clearance**, a hard limit), `target` (distance,
size, res, tilt; see `RF.Engine.targetFrame`), `paint: { res, cells }` (res² relative weights, row-major,
v up), `stamps`, `seed`.

**tools**: `trace(surfaces, { rays, seed, attribution, occlusion, paint })` → the real engine, scored with **the
app's own definitions**:
`{ fidelity, grid, res, energy, raysPerCell, noise, blocked, peakCd, peakNoise, ofCeiling, ofEnvelope, throwM,
lmOnTarget, perFacet?, shadowed? }`. **`fidelity`** is the headline score: `{ fidelity, within, gapsDark, gapCells,
under, over, noiseCeiling, fidelityNoiseCeiling, ratio: {p5, p25, p50, p75, p95}, onPaint, spill, spillNear,
kernelCells, verdict, ratioAt }`.  **`fidelity` = F1 of `within` and `gapsDark`** (their harmonic mean, 2ab/(a+b): near 0 if either is).  `within` = share of painted cells
within ×/÷1.25 of the paint at the best overall brightness (edge cells may match the paint blurred by the smallest
LED image, `kernelCells` wide).  `gapsDark` = share of the unpainted cells near the paint (the gaps between strokes;
within kernel + 2 cells) that stay under 10% of a typical painted cell (or the blurred paint's halo), with partial credit that
reaches 0 at 30% of a painted cell above that: a flood fails it, and a dark design fails `within`.  `verdict[cell]` 0 within · 1 too dim · 2 too bright · 3 lit gap · −1 other, at paint resolution; `noiseCeiling` = what a perfect design would score at this ray
count. It uses the user's paint, or `paint` if you pass one (e.g. your own working target). Same seed ⇒ common random numbers (candidates differ by geometry, not
dice); `noise` ≈ relative error per cell, `peakNoise` the error on `peakCd`. `perFacet` (landed energy per
facet id) needs `attribution: true`; `shadowed` needs `occlusion: true` (one extra pass). `grid` is at the
sim resolution `res`, which can differ from `paint.res` — convert with `RF.Engine.toPaintGrid(grid, res,
paint.res)`. `progress(0…1)`. `budget: { rays, ms }` — exceeding either stops the solver.

**output**
- `surfaces`: facets `{ type: 'facet', id, P, S0, Z, flat, di, clip: { kind: 'poly', pts3 }, optics }`
  (see `js/geometry.js` header), or `plane` / `rev` surfaces. Unique string ids.
- `intent` (optional): `[{ facet: id | null, cells: [[paintCell, weight], …] }]` — what each facet is
  meant to light. **Overlap is allowed.** `facet: null` = an intent you couldn't place.
- `notes` (optional): free-text diagnostics.

<!-- builtin -->
**What your solver can use** — exactly the files in `js/solver-env.js`, loaded the same way in the app's
worker, the runner and the scorer: `RF.V` (vectors), `RF.Geo`, `RF.Source`, `RF.Engine`, `RF.Solver`
(tile model, flux helpers), `RF.Photometry` (peak, ceilings, throw), `RF.Solvers` (incl. the default
solver: `RF.Solvers.get('spoke')`), and **`RF.ModeA`**, the default solver's core, in two halves so you
can change the middle:

```js
const plan = RF.ModeA.plan(scene);   // spokes, equal-flux direction cells (plan.items), zones (plan.zones), intent
// …edit plan.items / plan.zones (e.g. zone aims, weights)…
const { surfaces, intent, report } = RF.ModeA.build(plan);   // build(plan(scene)) ≡ generate(scene)
```

`scene` here is `{ source, target, envelope, modeA: { paint, budget: input.limits.maxFacets, facetType, reflectivity: input.limits.reflectivity, minDistance } }`.
<!-- /builtin -->
<!-- workspace-only:
**What your solver can use**: exactly the files in `js/solver-env.js`, loaded the same way in the app's worker,
the runner and the scorer: `RF.V` (vectors), `RF.Geo` (surfaces, envelope tests: `envInside`, `envInterval`),
`RF.Source` (the LED: `frame`, sampling), `RF.Engine` (target frame and cells: `targetFrame`, `designFrame`,
`cellCenter`, `toPaintGrid`), `RF.Photometry` (fidelity, peak, ceilings) and `RF.Solvers`. In this task
**`solve()` may not trace rays**: `tools.trace` and the engine's tracing functions throw inside `solve()` (a
solver id ending in `-auto`, the optional tuner, is exempt). Trace from the runner while you develop.
-->
Anything else in `js/` is the app and is not available to a solver.

## Spec mode (beam specifications)

In Spec mode (mode D: SPEC-MODE.md), the user's goal is a regulation-style beam spec (UN R112, FMVSS 108, or their own),
judged on the traced **far field**: intensity by direction in cd, at points, zones and cut-off scans in (H, V)
degrees. Paint solvers still work there; they get a rasterised **working paint** (floors at minimums, holes at
maximums, the user's painting in between). A solver that reads the spec directly gets more:

- **`input.spec`** (only in Spec mode; absent otherwise): `{ preset, items, conv, kernel, step, window: [h0, h1, v0, v1],
  traffic, measure: { distance }, aim: { mode, line, scan, box, itemReaim }, centre }`.
  - `items`: the enabled constraints, traffic side resolved (H > 0 = right, V > 0 = up, degrees), each
    `{ kind, name, min?, max?, minRel?, maxRel?, w }`. Kinds:
    - `point`: `h, v`.
    - `zone`: `poly` [[h, v], …]; the dimmest point must meet `min`, the brightest `max`.
    - `sum`: `pts`; the sum of the points.
    - `gradient`: a cut-off scan at `h` over `v0…v1`, G = log E(v) − log E(v + `dv`), its maximum within
      [`min`, `max`].
    - `linearity`: the inflection height at each of `hs` within `max` degrees; `ref: 'centre'` measures each against
      the middle one.
    - `imax`: the beam maximum.
  - `minRel` / `maxRel`: `{ ref, factor }`, a bound relative to another item's measured value.
  - `aim`: how the report aims the lamp before judging. `'cutoff'`: the steepest step of a scan at the
    gradient item's `h` is moved onto `line` (vertical only). `'peak'`: the maximum onto HV. `'design'`: as built.
    Then `box` (whole-lamp re-aim limits, R112) or `itemReaim` (every point / zone read up to that far off, FMVSS ¼°).
    The vertical position of your cut-off is therefore normalised by the judge; its shape, sharpness and the
    horizontal placement are yours.
- **`input.target`** in Spec mode is a far plane at the user's "Solve at" distance (default 25 m), square, untilted,
  sized to the spec window. Aim facets in **degrees**: `d = RF.FarField.dirOf(h, v, spec.conv)` is a world
  direction (x = throw, y = left, z = up), and a facet's aim point is `Z = P + d × L` for any large L (use
  `input.target.distance` or more). `input.paint` is the working paint on that plane.
- **`tools.trace(surfaces, { rays, spec: true })`** adds `spec: { verdict, n: { pass, fail, unsure }, score, worst, aim,
  shift, guided, rows: [{ name, kind, value, sd, bound, isMin, verdict, margin, at }] }`. This is the report's own
  judge (`RF.Spec.evaluate`) on the far field at the spec's measuring distance. `rays` ≤ 2 M per call (~2–4 s in
  Node). Spec traces are **guided** by default: a quarter of the rays as a pilot, then rounds that send more rays where
  the window is dim, each weighted so nothing is biased. That cuts the error on dim rows (sign points, B50L, zone III)
  2–8×. `guided: false` = plain. `verdict` per row: `'pass'` / `'fail'` = decided at ±2σ, `'unsure'` = noise decides.
- Available in the solver environment as well: `RF.FarField` (directions, solid angles, grids) and `RF.Spec`
  (`evaluate`, `itemsOf`, `windowOf`, `FIXTURES`, …).
- **Bench:** `node tests/bench-spec.js --load path/to/solver.js --solvers my-id --fixtures box,slim,module,sealed7
  --preset ece-r112-b|fmvss-lb2v [--rays 8e6]` (minutes per row; prints a table, `--json` keeps every row).

## Multi-part optics and multiple emitters

A solver isn't limited to reflector facets. Its `surfaces` may also **refract** (lenses, TIR bodies:
`optics: { interaction: 'refract', ior, fresnelT }`, front = the air side) or **absorb** (shields, flanges:
`interaction: 'absorb'`). The pieces you can build from (all exact quadrics, see `js/geometry.js`):

- `facet`: an ellipsoid with foci `S0` and `P + di·unit(Z − P)`: images the LED onto any 3D point (a projector
  reflector segment aims its image into a lens's focal plane this way).
- `rev` with `seg.kind`: `line` (cone / cylinder / annulus), `arc` (sphere zone), and **`conic`**:
  `{ kind: 'conic', zv, R, k, r0, r1 }`, a zone of a conic of revolution (`k` = 0 sphere, −1 paraboloid,
  (−1, 0) ellipsoid, < −1 hyperboloid). A hyperbolic face with `k = −n²`, `R = (n − 1) f` collimates a point at
  distance `f` exactly (the app's **Aspheric** lens preset; `RF.Geo.conicSag(R, k, r)` gives the sag).
- `plane`: a flat patch with a polygon clip (a shield edge).

Rules for parts:
- **The facet budget counts reflecting surfaces only.** Lens and shield parts are free, but are checked against the
  envelope and the LED clearance like everything else.
- **Declare the interactions a ray needs**: `output.needs = { bounces: 3 }` (reflector + lens entry + exit). The app
  raises its bounce cap to that (with a notice; max 8). `input.limits.bounces` is the current cap. Trace your own
  candidates with `tools.trace(surfaces, { bounces: 3, … })`, or the lens light is cut off at the first interaction.

**Multiple emitters.** A scene can hold several LEDs (`scene.emitters`: extra full source objects with `id`,
`enabled`; the sidebar's *More emitters*). **`input.sources`** lists them all (apparent, domes flattened), first =
`input.source`, which older solvers keep reading. Every emitter has its own LED clearance (the host checks each).
Traces draw each ray's emitter in proportion to power, so every ray carries the same energy.

## What the app checks and scores (not you)

Placed / unplaced counts, every surface inside the envelope and outside the LED clearance (measured on
the real surface), well-formed intent. Then a trace: delivered light, beam coverage, uniformity U₀,
delivered ÷ intended, peak cd ± noise, % of the brightness ceiling (design and envelope), throw, blocked
and shadowed light. Runtime scaling vs facet budget (`--scaling`, a log-log slope; < 2 = sub-quadratic).

Two layers: a **solver** never changes its own settings; a **tuner** (separate) picks settings for a goal.
