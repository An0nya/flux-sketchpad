# Spec mode: regulation-style beam targets

Branch `spec-mode` (2026-10-04). Status: phase 1 is built and tested. Phases 2–4 are a plan.
This file covers what exists, what is unverified, what comes next, which new optics and solvers
are worth building, and how the existing backlog maps onto all of it.

## The idea in one paragraph

Paint mode asks for a *relative* shape. Headlamp regulations ask for *absolute*, one-sided
numbers in angular coordinates. A test point can have a minimum (75R ≥ X cd) or a maximum
(B50L ≤ Y cd). A zone can carry a cap (the glare zone above the cut-off) or a floor. On top
of that, the cut-off has to be sharp. Spec mode adds that vocabulary on top of Paint. The
painting stays as a secondary goal. The report judges the traced **far field**, which is what
a goniometer measures. Constraints are soft (a score), and a hard pass/fail verdict sits
alongside. The verdict respects Monte-Carlo noise.

## Phase 1: what is built

| Piece | File | What it does |
|---|---|---|
| Exit-ray recording | `js/engine.js` (`P.recordExit`, `ctx.ex`, `exitCoverage`) | Stores every ray's last straight leg (origin, direction, energy, bounces) once it is past the optics. Zero cost when off. Progressive runs record byte-identical to one-shot runs. |
| Far field | `js/farfield.js` (`RF.FarField`) | Bins exit legs by direction into an H/V grid. Exact solid angle per bin. Summed-area tables give O(1) kernel reads with shot-noise σ. The same code bins by **where legs cross a screen at distance D** (seen from the source): that is the apparent intensity a screen photometer at D reads. One switch moves between near field and far field. |
| Judge | `js/spec.js` (`RF.Spec.evaluate`) | Constraint kinds: points (min and/or max), polygon zones (min/max), cut-off gradient scan, global intensity cap. Each verdict is `pass` / `fail` / `unsure` at ±2σ, with a margin in decades and a soft score (1 when met, 0 at a factor of 2 off). Includes an aim-tolerance search (re-aim within ±tol and keep the best result) and a "×N more rays would settle it" hint. LHT mirrors H. |
| Feasibility | `RF.Spec.feasibility` | No trace needed. Brightness-theorem ceiling per min-point: R·L·A⊥(envelope) plus the LED's own direct intensity. Flux lower bound for the min-zones. |
| Asking a solver | `RF.Spec.workingPaint` | Turns spec + painting into the relative target that the existing paint solvers accept: floor = mins, ceiling = maxes, shape = paint × paintCd × weight, converted to plane illuminance (E = I cos θ / r²). **No solver changes.** `RF.Solvers.paintOf(scene)` routes it to every solver in mode D. |
| Seed paint | `RF.Spec.seedPaint` | A plausible low-beam painting in H/V: flat cut-off at 0.57°D on the oncoming side, a 15° rise on the own side, a hot zone under the elbow, and a wide foreground. |
| UI | `js/spec-ui.js`, small hooks in `ui.js`, `panels.js`, `controller.js`, `index.html`, `css/app.css` | **Spec** tab (extends Paint: same brush, solver and budget). Sidebar: preset, traffic, **Measure at ∞ / 25 m / 10 m / target**, measurement settings (kernel, aim tolerance, angle convention, bin), paint-as-secondary-goal settings, an editable constraint table, the report, and **Compare distances** (re-judges the same trace at several distances, no re-trace). Result → **Far field**: log-cd map by direction with the spec drawn on it, coloured by verdict; tap it to read cd ± σ. The Editor overlays the spec projected onto the plane, and a **Solver target** toggle shows what the solver is actually asked for. |
| Tests | `tests/spec.js` (in `tests/all.js`) | Isotropic source reads P/4π in all three conventions. Lambertian source reads (P/π)·cos θ. Conv-A bins tile 4π. hv∘dir = identity. Progressive = one-shot. Exit energy = target + target back + escaped. A screen at 10⁹ m = far field. A point source at the centre reads the same at any screen distance. Judge verdicts on synthetic fields (cut-off found at the right V, G exact, re-aim clears a glare point, LHT mirrors, unsure inside 2σ). Working target carves holes and lifts floors. Seed paint stays under the cut-off. Old scenes load with the default spec. |

How to try it: open the app, click **Spec**, then **Fit target to spec**, then **Seed low-beam
paint**, then **Rebuild**. Read the report, then switch **Measure at** between ∞ and 10 m.

### Your 10 m question, measured

Setup: the default scene's fixture (envelope 56 × 105 × 55 mm), ECE preset, seeded paint,
built-in spoke solver, 100 facets, 1 M rays. The same trace, judged at different distances:

| Measured at | Verdict | 50L (≤ 13.2k) | Zone III max (≤ 625) | Cut-off G | Cut-off found at |
|---|---|---|---|---|---|
| ∞ (goniometer) | 8 pass / 3 fail | 17.6k | 1.41k | 1.09 | V −0.15° |
| 50 m | 8 / 3 | 20.2k | 1.58k | 1.18 | −0.15° |
| 25 m | 8 / 2 / 1 unsure | 23.1k | 1.77k | 0.98 | −0.15° |
| **10 m** | 8 / 3 | **27.1k (+54%)** | **2.17k (+53%)** | 0.64 | **+0.05°** |
| 5 m | 8 / 3 | 32.8k | 5.42k | 1.25 | +0.35° |

At 10 m, this fixture's near field inflates the points just under the cut-off by about half
and lifts the measured cut-off by about 0.2°. That is about the size of the parallax estimate
(aperture ÷ distance ≈ 0.3–0.6°). The 0.57° offsets between test points are the same order,
so a 10 m target plane is not a goniometric measurement for a lamp this size. The regulations
use 25 m for this reason, and 25 m still differs visibly from ∞ here. The far-field view is
the honest default. Use **Compare distances** on your own scenes. Your current low beam is a
different fixture, so these numbers don't transfer to it.

### While we were in there (backlog items folded in)

- **`di: Infinity` reloaded flat** (old engine trap). JSON writes Infinity as `null`, and
  `facetQuadric` reads a null `di` as flat. A collimating facet therefore came back flat
  after save/load. Now it is written as 1e308 and read as ∞. There is a regression test in
  `tests/spec.js`. This mattered here because a spec design must reload identically.
- **The in-page verification suite was broken on `main`.** On `main` it reports 9 passed and
  14 failed: since Auto became the default solver, the page has the worker bundle loaded, and
  the checks' synchronous solves threw "auto is asynchronous". Node never noticed because Auto
  isn't loaded there. `testScene()` now pins the built-in solver, the app's `defaultScene()`
  drops the pin, and #14b pins it for its DOM pass. The page now reports 23 pass / 0 fail /
  1 skip, the same as Node.

## ⚠ Unverified, check before trusting a pass

This session could not reach UNECE, EUR-Lex or any mirror (the egress policy blocks them).
Everything below is **from memory** and is flagged in the UI (`verified: false`, a ⚠ line in
the report).

1. **ECE R112 class B values.** B50L ≤ 350 · 75R ≥ 10,100 · 75L ≤ 10,600 · 50L ≤ 13,200 ·
   50R ≥ 10,100 · 50V ≥ 5,100 · 25L/25R ≥ 1,700 · Zone III ≤ 625 · Zone IV ≥ 2,500. Check
   each value, its position (e.g. 0.57U 3.43L), and the amendment it comes from. One search
   summary claimed B50L has a 50 cd minimum as well. Unconfirmed.
2. **The Zone III polygon** is approximate.
3. **Missing rows:** points 1–8 (overhead-sign / segment minimums, with their sums), Zone I
   (a relative cap, ≤ 2× the 50R value, which needs a new `ratio` constraint kind), and the
   class-specific notes.
4. **Cut-off sharpness:** G ≥ 0.13, scanned at 2.5° on the oncoming side. Check the value,
   the scan positions, the step (0.05° or 0.1°), and whether G uses illuminance at 25 m or
   intensity. Also check the cut-off *position* requirement (the horizontal part at 0.57°D
   after aiming) and the kink definition.
5. **Goniometer convention.** Automotive photometry uses CIE "Type A" (confirmed by vendor
   pages: Instrument Systems AMS series, GL Optic). Whether Type A maps to this app's `A`
   (V = elevation, H = azimuth) or `B` is **not** verified against CIE 121 or LM-75. Inside
   ±10° H they differ by < 0.05°. At ±45° they differ by up to ~3°.
6. **Photometer acceptance / measuring distance.** The default kernel is ±0.15°. The real
   receptor size limits (in minutes of arc) should set it.
7. **R149** (which supersedes R112/R98 for new approvals) and **FMVSS 108 / SAE J1383** are
   not in yet. Add them as presets once the tables are transcribed.

How to fix all of this: paste the regulation table (or the PDF) into a session, and a preset
can be transcribed with page citations and `verified: true` per row.

## Phase 2: a solver that targets the spec (next)

Phase 1 only *asks* paint solvers through a rasterised working target. They don't know that a
maximum is a hard ceiling, or that a cut-off is an edge. Two changes, in order of value:

1. **Edge-anchored aims (the industry's way; LucidShape's MacroFocal reflector works like
   this).** Each facet's LED image has a known extent: the tile model `Σ_tile`, a 2D
   covariance. Today that collapses to a scalar σ ("Deferred: algorithms" in DESIGN.md has
   this exact proposal). For facets serving the region under a cut-off, aim them so the
   image's *top edge* (along the image's minor axis, rotated to the cut-off's slope) sits on
   the line, with the image hanging below it. The cut-off then comes from geometry, not from
   flux balancing. This mostly fixes Zone III / B50L, which the current solvers leak into.
   - Implementation: a solver setting `edgeAnchor` in `lab-sqm` / Fill & fix. Needs the
     cut-off polyline in solver input (below), plus image orientation. Orientation is set by
     the facet's azimuth around the LED, so placement needs an orientation objective. That is
     the parked "edge-aware orientation" item.
2. **A constrained flux fit.** `nnlsShares` (lab-sqm) fits patch fluxes to the paint in
   relative error. With a spec, it becomes: find g ≥ 0 maximising the worst margin, subject to
   `B g ≥ min` at min-samples, `B g ≤ max` at max-samples, Σg ≤ captured flux, plus a paint
   term with its own weight. That is an LP, or a QP with the paint term. The matrix is small
   (columns = patches, a few hundred; rows = spec samples, a few thousand). A vendored
   `javascript-lp-solver` UMD build keeps `file://` working. Don't use glpk.js (WASM).
   Alternative with no dependency: projected gradient on the soft objective, same structure
   as the current multiplicative updates.

**Solver interface change:** add an optional `input.spec` holding `{ items (traffic
resolved), conv, kernel, centre }` next to `input.paint`. Spec-aware solvers read it.
Everything else keeps reading the working paint. `tools.trace` should also expose the far
field: `trace(...).farField(opts)` → a grid, so a solver can score itself with
`RF.Spec.evaluate` exactly as the host does. That gives one definition, as with fidelity.

**Auto:** a `spec` goal for the tuner. It ranks by worst margin, then score, with guardrails
on light-on-target. RF.Modes already has a `cutoff` goal whose glare/edge measures are a
weaker proxy. Spec mode should replace that goal in D, not run beside it.

## Phase 3: optics architectures and the solvers they need

What's reachable depends on the optic. Sorted by payoff for low beams, against how far each
is from what exists:

| Architecture | What it is | How the cut-off happens | What's needed | Payoff |
|---|---|---|---|---|
| **Faceted free-form (MF-style)** | What Flux makes now | Facet images aimed against the line | Phase 2 edge anchoring | High, and closest to existing |
| **Faceted compound ellipsoid** (Chu et al. 2020, *Applied Optics* 59(16) 4872; doi 10.1364/AO.385680) | SQM kept faceted: "shieldless low beam" | Patch boundaries chosen so the images stack under the line | A variant of `lab-sqm` that keeps patches discontinuous plus edge anchoring; backlog item "replicate Chu 2020" | High: published, and SQM's own method |
| **SQM v0.4, shallow profile** | One continuous mirror: near-LED patches blur and fill, the far rim is sharp | Far-rim patches make the edge | Backlog item. Pairs with edge anchoring for the rim | Medium |
| **Projector** | Ellipsoidal reflector → shield at the 2nd focus → aspheric lens | **The lens images the shield edge**, giving the sharpest cut-offs | Engine: everything exists (absorbing plane = shield, lenses.js has plano-convex). Solver: ellipsoid from source + 2nd focus, shield polygon from the spec's cut-off line (mapped through the lens), lens focal length from the beam's spread. Your idea of a 45° dump facet as a stand-in shield works today as an experiment. | High for the cut-off; lower efficiency (the shield blocks a sizeable share, roughly 20–40% from memory) |
| **Paraboloid + fluted / pillow lens** | Collimate, then spread with a lenslet array (the Fresnel look) | Lenslet prescriptions; weak cut-off | A lens-array solver: each lenslet is a "unit" with a footprint, so it fits the same flux-fit structure | Medium; good for fog / DRL |
| **TIR collimator / multi-part optics** | TIR body + exit lenslets, or a reflector + lens chain | Usually paired with a shield or a lens to make the cut-off | `lenses.js` has a TIR preset. A TIR *solver* (free-form TIR walls for a target) is a big build. Multi-emitter arrays need **multi-source support in the engine** (one source today). | Medium-high for ADB / matrix beams, low for a basic low beam |
| **Retro-sphere recycling** | A spherical mirror sends back-light to the LED to be re-emitted | — | Check first whether the engine models light returning onto the die (probably it's absorbed or passes through) | Low, academic |

**Order:** do this only after phase 2. The spec mode is the yardstick. Without it, a projector
or TIR solver would be judged by paint fidelity, which is the wrong metric for a beam.

**The interface that keeps this generic:** every solver for any architecture exposes
*controllable units* (facet, patch, lenslet, TIR zone), each with a predicted footprint, i.e.
a column `B_j` of light per sample per unit flux. The phase-2 constrained fit then works
unchanged across architectures. Only the geometry generator differs.

## Phase 4: infrastructure this will lean on

- **Multi-source engine.** Needed for TIR arrays, ADB and dual-LED low/high beams. Today
  `scene.source` is a single object.
- **Pinned comparison** (backlog: "comparison against a pinned previous result with a shared
  brightness scale"). In Spec mode, pin a run's far field and show both reports side by side.
  This is the natural A/B for design iterations. `Compare distances` already uses the same
  machinery.
- **Per-unit attribution in the far field.** Exit records could carry the first surface
  (`ctx.rayK` already exists). Clicking a failing point in the far field would then list the
  facets lighting it. This is the inspector's spot selection, moved to angle space, and the
  debugging tool phase 2 will need.
- **Speed.** A far-field build costs ~60–120 ms per 500k rays, which is fine. Points near 350
  cd need many rays: at 500k rays a ±0.15° kernel holds ~5 rays at B50L levels (±45%). Options:
  importance sampling toward max-points, or adaptive kernels (wide for low maxima, narrow
  near the cut-off). Worker pool / WebGPU stays as it is in DESIGN.md.
- **Saved geometry metadata** (backlog): a spec verdict depends on the exact design, so a
  saved scene should state which solver/version/settings produced it. `sc.solve` already
  carries id + version.

## Backlog mapping

| Backlog item (source) | Relation to Spec mode | Status |
|---|---|---|
| Real-units Editor: lux scale, ceiling marker (DESIGN.md, Inspector step 4) | Spec mode works in cd. "Paint level 1 = cd" puts the painting in real units for the solver; brightness-theorem ceilings per point are in the report | **Partly done** (in D); a lux scale on the Editor itself is still open |
| Delivered ÷ intended as a map (DESIGN.md) | The far-field verdict colours are this, per constraint; Paint's Fidelity view already maps it per cell | Mapped |
| Candidate algorithm: keep the 2D source-image spread, align narrow spread across cut-offs (DESIGN.md, Deferred) | = phase 2, edge anchoring | **Planned (phase 2)** |
| Edge-aware orientation (memory: parked) | Needed for edge anchoring | Planned (phase 2) |
| Auto: built-in low-beam pattern fails its own glare guardrail in quick mode | The spec gives that guardrail a real definition; Auto's `cutoff` goal should read the spec in D | Planned (phase 2, the Auto goal) |
| Replicate Chu et al. 2020 (memory) | A phase-3 solver; the spec is its yardstick | Planned (phase 3) |
| SQM v0.4 shallow profile (memory) | Phase-3 solver; edge anchoring for the rim | Planned (phase 3) |
| Projector ideas: shield facet + lens, paraboloid + fluted lens, TIR array / coarse ADB, retro-sphere (memory) | Phase-3 architectures table | Planned (phase 3; multi-source engine first for arrays) |
| Old engine traps: `di: Infinity` → null on save | Breaks reloading spec designs | **Fixed here** |
| Old engine traps: parab not in verify whitelist; negative `di` silently flat; convex-only polygon clips; spoke 0.03 mm envelope overshoot | Not on the spec path | Open (unchanged) |
| Comparison against a pinned result with a shared scale (DESIGN.md) | The natural A/B in Spec mode | Planned (phase 4) |
| Per-facet intent / overlap-capable intent (DESIGN.md) | Units-with-footprints is the same idea, generalised | Folds into phase 2's interface |
| Speed: worker pool, coarse-then-exact footprints (memory) | Spec mode needs more rays for low maxima | Phase 4 |
| Benchmark v3, rescoring past solvers (memory) | A spec-scored track would be a new benchmark axis | Later |
| UI walkthrough / reorg (memory) | Spec adds a sidebar section and a Result view; fold it into the walkthrough | Later |
| Stamp mode rethink | Unrelated | — |
| In-page verification suite (found broken on `main`) | — | **Fixed here** |

## Reading: education, not tools

No open-source tool for regulation-driven headlamp design turned up (the commercial ones are
LucidShape, SPEOS and LightTools). The *method* is well documented, though:

- Wördenweber, Wallaschek, Boyce, Hoffman, *Automotive Lighting and Human Vision* (Springer,
  2007). Headlamp optics (reflector, projection, free-form) and the regulations, written from
  industry practice.
- Koshel (ed.), *Illumination Engineering: Design with Nonimaging Optics* (Wiley/IEEE, 2013).
  Étendue, tailoring, and tolerancing.
- Chaves, *Introduction to Nonimaging Optics* (CRC); Winston, Miñano, Benítez, *Nonimaging
  Optics* (Elsevier, 2005). SMS and edge-ray methods.
- Fournier, *Freeform Reflector Design with Extended Sources* (CREOL dissertation, 2010).
  Source of SQM's compensation; already on your Downloads list.
- Oliker's supporting quadrics; the TU/e inverse-reflector / optimal-transport papers (e.g.
  arXiv 2503.21182). Full-distribution inverse design; no inequality constraints.
- Kosmatka, GE patent US 4,704,661 (1987): faceted headlamp reflector.

The DESIGN.md "Literature" block lives on `solver-lab` (2bb1e84). Per the memory notes, that
branch was local-only, so it isn't on this branch either.
