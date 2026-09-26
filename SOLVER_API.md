# Writing a solver for Flux

A solver turns a lighting problem (LED, envelope, target, painted intent) into reflector geometry.
It is **one self-contained JavaScript file** that calls `RF.Solvers.register({...})`. No other file
needs to change. The app runs loaded solvers in a Web Worker (no page access); everything that could be
gamed — what was placed, whether it fits, how good the light is — is computed by the app, not the solver.

Start from `examples/solver-example.js`. Develop and score headless:

```bash
node tools/run-solver.js path/to/my-solver.js --scaling
```

In the app: sidebar → Reference & debug → Solver → **Load solver file…**

## The contract

```js
RF.Solvers.register({
  id: 'my-solver', name: 'My solver', version: '0.1',
  modes: ['paint'],                 // 'paint' (a painted target) and/or 'stamps' (explicit per-facet requests)
  settings: [                       // rendered in the sidebar; types: number | range | select | checkbox
    { key: 'budget', label: 'Facet budget', type: 'range', min: 1, max: 2000, step: 1, default: 100, help: '…' },
  ],
  solve(input, settings, tools) {   // may be async; deterministic for (input, settings, seed)
    return { surfaces, intent, notes };
  },
});
```

**input** (a deep copy — mutate freely): `source` (pos, axis, kind, shape, w/h/radius, dist, power in lm),
`envelope` (box `center`, `half`; `keepOut` = the **LED clearance**, a hard limit), `target` (distance,
size, res, tilt; see `RF.Engine.targetFrame`), `paint: { res, cells }` (res² relative weights, row-major,
v up), `stamps`, `seed`.

**tools**: `trace(surfaces, { rays, seed, attribution, occlusion })` → the real engine, scored with **the
app's own definitions**:
`{ grid, res, energy, raysPerCell, noise, blocked, peakCd, peakNoise, ofCeiling, ofEnvelope, throwM,
lmOnTarget, perFacet?, shadowed? }`. Same seed ⇒ common random numbers (candidates differ by geometry, not
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

`scene` here is `{ source, target, envelope, modeA: { paint, budget, facetType, reflectivity, minDistance } }`.
Anything else in `js/` is the app and is not available to a solver.

## What the app checks and scores (not you)

Placed / unplaced counts, every surface inside the envelope and outside the LED clearance (measured on
the real surface), well-formed intent. Then a trace: delivered light, beam coverage, uniformity U₀,
delivered ÷ intended, peak cd ± noise, % of the brightness ceiling (design and envelope), throw, blocked
and shadowed light. Runtime scaling vs facet budget (`--scaling`, a log-log slope; < 2 = sub-quadratic).

Two layers: a **solver** never changes its own settings; a **tuner** (separate) picks settings for a goal.
