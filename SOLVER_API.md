# Writing a solver for Flux

A solver turns a lighting problem (LED, envelope, target, painted intent) into reflector geometry.
It is **one self-contained JavaScript file** that calls `RF.Solvers.register({...})`. No other file
needs to change. The app runs loaded solvers in a Web Worker (no page access); everything that could be
gamed — what was placed, whether it fits, how good the light is — is computed by the app, not the solver.

Start from `examples/solver-example.js`. Develop and score headless:

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
Anything else in `js/` is the app and is not available to a solver.

## What the app checks and scores (not you)

Placed / unplaced counts, every surface inside the envelope and outside the LED clearance (measured on
the real surface), well-formed intent. Then a trace: delivered light, beam coverage, uniformity U₀,
delivered ÷ intended, peak cd ± noise, % of the brightness ceiling (design and envelope), throw, blocked
and shadowed light. Runtime scaling vs facet budget (`--scaling`, a log-log slope; < 2 = sub-quadratic).

Two layers: a **solver** never changes its own settings; a **tuner** (separate) picks settings for a goal.
