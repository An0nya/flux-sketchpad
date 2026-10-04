# Flux — working design notes

This is the shared, project-local working document for UI decisions, open questions,
and deferred work. Agents should read this file rather than reconstructing the
discussion from separate harness memories. Updated 2026-09-25.

Status: **layout exploration**. The production app and solvers have not been
changed. [Interactive layout study](design/index.html) is a separate prototype.

> **Spec mode (2026-10-04, branch `spec-mode`):** regulation-style beam targets, the far field, and the plan
> for spec-aware solvers and new optics: see `SPEC-MODE.md`.

## Direction

Anya wants a snappy, minimalist optical sketchpad with full control available on
demand. Retain Opus's collapsible controls and the quieter visual feel of `/astra/`:
floating corner headers, no header separator lines, restrained typography, muted
heat colors, thin rays, and a discreet XYZ tripod. Reduce visual competition rather
than shrinking controls or hiding necessary information.

- Keep a large Scene view. Default composition: reflector bottom-left, target
  top-right, both visible. Preserve a source marker, without the busy setup handles.
- Rename Surfaces to **Optics** and make it the fixture editing/inspection view:
  source, envelope, surfaces, and local setup controls.
- Split Target into **Editor** (Paint / Stamp / Profile) and **Result**. They are
  independently arranged but remain a working pair. Their maps should be aligned
  and equally scaled where their coordinate systems match. Do not link Profile or
  the Stamp direction picker blindly to target coordinates.
- Keep the full settings sidebar, with meaningful collapsed summaries. Relevant
  local controls can be duplicated if they share state, ranges, and undo behavior.
- Keep collapse chevrons. Add draggable boundaries and explicit expand/restore.
  Selecting a pane highlights it; selection does not resize it. Expanding preserves
  the prior layout for restoration. Never move a canvas underneath an active drag.
- Mobile uses a stable primary canvas and labeled pane navigation. Scroll settings
  independently. Do not force the user to find a sliver between draggable canvases
  to scroll the page.

## Layout study

The study is self-contained under `design/`; it does not load or write the app's
saved scenes. Its reference geometry, trace, and metrics come from the unchanged
Opus engine. Editor marks are local draft edits, not a new optical solve. The
progress preview is explicitly a demonstration. No solver performance claims are
made from this artifact.

Prototype interaction model:

1. Select an open pane → subtle emphasis; reveal its local controls in reserved space.
2. Collapse → retain an accessible title in the pane strip.
3. Expand → Editor and Result remain paired; Scene/Optics focus individually.
4. Restore → recover previous split proportions and collapsed panes.
5. Drag the main divider → resize the Scene and right workspace without changing data.
6. Narrow available space → stack Editor/Result; phone → labeled single-pane navigation.
7. Open metrics details → bounded overlay; canvas layout does not shrink.

The study tests these choices, not exact final breakpoints or proportions. Test
with the sidebar open as well as closed. Essential controls cannot depend on hover.
Keyboard focus and touch targets must remain visible and usable.

## Defaults

Treat source, envelope, painted intent, camera, sampling, and overlays as one
starting experience. Anya prefers Astra's simple recognizable generated image and
whole optical path. Start with solid optics, normals off, sparse thin rays, and
enough samples for a legible result. Use a mildly asymmetric painting to verify
orientation. Smoothing is a labeled display option, not camouflage for poor sampling.

Exact production values are not approved. The layout study's reference scene is
for composition only. Avoid overwriting existing saved scenes when defaults change.

## Progress

**Keep the dropdown strip.** Anya proposed it to make changes visibly cause work,
especially when a complex solve delays the new result. Earlier suggestions to
remove it are superseded.

- Fixed graphical activity/current/stale indicator, with accessible short text.
- Dropdown names the current stage: generating or tracing. Real progress when
  measurable; indeterminate otherwise. Do not invent an overall solve percentage.
- Keep the strip clear of interactive controls. Do not reflow canvases every run.
- Remove persistent ray count and render time from the header; keep them in details.
- Distinguish coarse preview from final refinement. Older work must not replace a
  newer edit. Cancellation and keep-best belong with later expensive solve modes.
- Existing trace milliseconds measure accumulated tracing work, not total user wait.

## Results and constraints

Compact view: a few headline metrics and a concise constraints/design-issues
summary. Proposed headlines: Delivered light, Coverage, Uniformity. Exact definitions
must remain visible in details; do not quietly alter scoring in a GUI pass.

Expanded view: all metrics, definitions, sampling confidence, and energy accounting
in a bounded drawer or deliberate results view. The existing expanding footer
crushes/crops the canvases; the replacement must preserve usable view sizes.

The energy bar is **fractions of emitted light energy**, not ray counts. Label it
“Where the light went.” Use muted proportional segments with readable adjacent
labels/values. Tiny bins retain their real widths; rows supply usable targets.
Unresolved energy gets a pattern plus a label, not a color-only distinction.

Preserve the exact engine accounting underneath. Delivered light can separate
direct and via optics. Back-face absorption, target-back termination, untraced
interface reflection, and stopped tracing must not be conflated casually. Untraced
reflection is not absorption. Desired-region light versus spill is potentially
useful but is separate bookkeeping work, not a label change.

Keep three questions separate: physical feasibility estimates, this generated
design's actual issues, and sampling confidence. “No global limit detected” can
coexist with dropped facets or blurred zones; it is not a success certificate.
Lead with actionable design issues, with successful checks underneath.

## Inspector and direct editing backlog

- Facet selection links geometry, assigned target zone, predicted footprint, and
  (eventually) actual traced contribution. Reverse target-to-facet selection useful.
- Dropped zones need visible diagnostics despite having no facet to click.
- Thin-ring dim spot: dropped facets remain a hypothesis, not a confirmed cause.
- Stamp resize: corner handle and wheel interaction; rotation is a later solver
  orientation objective, not merely rotating a decorative rectangle.
- Optional idle rotation; stable orientation by default for comparison.

### Inspector build log (2026-09-25, branch `inspector`)

- Step 1: every recorded hit carries its first surface + bounce count (`tests/attribution.js`,
  solo-trace oracle + negative control). Recording cost is within noise (116 vs 115 ms / 200k rays).
- Step 2: shared facet/zone selection. Observations (one scene, `127.0.0.1:8746`, not validated further):
  test-scene facet A1 delivers 10.0 of the 15.2 units it sends when traced alone; zone 70 of Anya's
  default gets light from its facet **plus 28 others** (tiles far larger than zones: 13-cell zone).
- The 4 "unclickable" zones are a SOLVER issue: their facets (A0, A1, A98, A99) carry 1e-4–1e-2 × the
  median flux. Suspect (unchecked): `Math.max(1, floor(quota))` in modeA's spoke allocation gives dim
  edge spokes a facet each. ~4% of the budget.
- Zone selection replaced by **spot selection** (Anya 09-25): zones are this solver's intent, other
  solvers may have none, and zone clicks can't reach spill or gaps. Spot = ~10 px disc, zoom for finer.
- **Loss view (step 3) done.** `Engine.facetLosses`: shadowed / blocked-by-whom / escaped, measured by
  exact retrace; gated by the identity "k alone catches exactly caught + shadowed" (exact, not
  statistical). **Test-scene A1 mystery solved:** not shadowed (0.3%); **34% of what it catches runs
  into A2** on the way out. Anya's default scene: zero shadowing, 1.0% blocked overall (worst A84, 6%
  into A85). Its loss budget closes: delivered 69.3% ≈ intercepted 78.2% × R 0.9 − 1% blocked; so ~22%
  never reaches the reflector, ~8% is mirror absorption, ~1% facet-on-facet.
- **Photometry (step 4, `js/photometry.js`, gated in `tests/photometry.js`).** Anya's default at 1M rays:
  peak 164 kcd = **16% of its design ceiling** (1.01 Mcd: Σ R·L·A⊥ over its facets) and **10% of the
  envelope ceiling** (1.67 Mcd); throw 811 m; 692 lm on target; reflector 5,396 mm², aperture 3,537 mm².
  Individual facets DO reach their own ceilings (A28 102%, A33 109% pooled 4M) — so the gap is not
  brightness per facet, it's that facets point at different spots (the design ceiling assumes every
  facet aims at one point). Expected for a flood-ish paint; % of ceiling is a spot-beam score.
- **Bug found + fixed:** past the 2M hit cap (≈2.8M rays here) selection numbers silently read low (A28
  at 64%). `Engine.hitCoverage` gives the rays the hit list covers; hit-derived numbers scale by it.
- **Step 5 done:** Optics Setup toggle (handles off ⇒ clicks only select); first-load orbit at 4°/s
  until the first drag/pan/zoom in Optics; sidebar "Optics idle orbit" slider 0/5/10/20/30/60 s/never
  (default never). Paused under reduced motion, hidden tab, collapsed Optics, any drag.
- **Open after step 5 (need Anya):** (1) delivered ÷ intended as a Result *map* view (numbers exist:
  Details percentiles + spot readout) — diverging ramp around 1.0, protan-safe; (2) real-units Editor +
  unit selection; (3) inspector label overlap when neighbours are both labelled.
- **Zone overlap is a solver-interface NECESSITY** (Anya 09-25: a solver that doesn't overlap is likely
  heavily under-optimised): our solver partitions the paint, so
  `report.zoneOf` stores ONE owner per cell. Other solvers (and benchmarked models) may deliberately
  overlap intents. The solver interface must report intent **per facet** (its own weighted cell list or
  footprint), not an owner map; the inspector's spot view then lists every intent under the spot.
- **Step 4 metrics wishlist (Anya 09-25: "super fun, meaningful to me")**, photometry in flashlight terms:
  fixture: source luminance (cd/mm²), reflector area + projected aperture, peak cd (noise-flagged),
  brightness-theorem ceiling L·R·A_aperture and % of it reached, ANSI FL1 throw (2·√cd m), lm on target.
  Facet: area / projected area, its cd ceiling vs measured, distance from LED, flux share,
  shadowed / blocked losses. Fixture-level → Details drawer; facet/spot-level → expanded Optics.
  **% of ceiling** (Anya): fixture → from emitter + envelope; facet → from emitter + facet projected area
  (cd ceiling) AND from the source cone it captures (lm ceiling), both. Spot → the ceiling exists per
  direction (L·R·aperture projected toward it) but a spot below it is usually intentional (the paint
  isn't a white box), so show it as information, never as a score.
  **Delivered ÷ intended**: already inside Mode A's U₀ (sim ÷ paint per paint cell) but never shown;
  surface it as a Result display option + the spot readout. Core solver-validation metric.
  **Editor in real units (idea):** paint is relative today; the solver scales to what it captures. Two
  limits apply: brightness (cd ceiling per direction, reachable only over ~an emitter-image-sized spot)
  and flux (Σ paint ≤ lm captured). A lux scale on the Editor from the captured flux + a ceiling marker
  would show infeasible paint at paint time.
- Baseline idea: a single smooth paraboloid (Mode C) as the benchmark's floor. Anya's pattern (hot core
  + spill) is roughly what a parabola does; whether it matches the delivered map is untested.
- Brightness-theorem sanity (A28, default scene): bound I ≤ L·R·A_proj = 318 cd/mm² × 0.9 × 115 mm²
  ≈ 33 kcd. Map peak cell: 46 kcd at 50k rays (p99.5), 38 kcd at 1M (p90 33.7k). Consistent with
  shot noise on a max over ~60 cells (2.3σ at 1M), not proof of correctness. ⇒ small-selection peaks
  read high at default ray counts. Candidate gate: per-facet p90 ≤ bound at high N.
- Observation (Anya's default scene, 50k rays, one run): at the pattern centre **36 facets** land light,
  top share 6%, and the 4 facets meant for that spot aren't in the top 4. The hot centre is made of
  spill. 10 o'clock of centre: intended facets lead at 11–21% each.
- Planned: per-facet loss accounting. Design flux vs actually intercepted = **shadowed by other
  facets**; intercepted vs landed = **re-hit / cut / escaped**. Neither shows today: shadowing isn't a
  loss (the shadowing facet redirects that light), and re-hits sit inside the footer's "cut" bucket.
- Multi-hop optics (lenses): first-surface ownership stays; the selected facet's retraced bundle
  shows every hop, and surfaces on that path get a secondary highlight.

## Deferred: algorithms, acceleration, rendering

The base Opus build has not received solver optimizations. The nominal “Astra” build
includes subsequent interactive Opus additions: complex generation constraints and
auto-tune/solve. Attribute the original and later work accurately.

Anya reports some settings take double-digit seconds on her M4 and noticeably heat
her phone. These are user reports, not new independent measurements.

All of the following are **outside the current GUI pass**:

- Selectable solver algorithms; algorithm distinct from single-solve/auto-tune mode.
- A worker for responsiveness, progress, and cancellation; small CPU worker pool
  for independent searches if profiling justifies it. This does not require WebGPU.
- GPU compute if appropriate; three.js rendering does not automatically accelerate
  the JavaScript optical solver/tracer. Lit/reflective visual meshes are appealing
  but remain distinct from the physical ray calculation.
- Higher static-scene ray counts / progressive accumulation and fast drag previews.
- Preserve saved generated geometry with algorithm/version/settings metadata.
  Current app loading can re-solve; reopening a result should not silently change it.
- Candidate algorithm: retain 2D source-image spread/orientation during assignment,
  align narrow spread across cutoffs, use broad footprints for wash, refine against
  tracing. The existing tile model calculates covariance but fitting reduces it to
  scalar sigma. This approach is proposed, not implemented or validated.
- Comparison against a pinned previous result with a shared brightness scale.

## Build approach and open decisions

One primary agent owns the first integrated layout pass. Splitting panes among
agents now would create overlapping edits and repeated visual-context loading.
After interfaces settle, metrics/progress components or an independent QA pass
could become bounded delegated tasks. No agents have been dispatched.

Before implementation, review the study for: compact-desktop layout, when maps
stack, focus/restore behavior, drawer placement, and local-tool density. Then settle
the exact defaults and headline metric definitions. Size the deeper inspector work
separately. Production verification still includes `node tests/all.js`, actual
pointer/keyboard interactions, screenshots at relevant sizes, saved-state/undo
checks, and no overflow or zero-sized camera regressions. No benchmark pass count
is a substitute for seeing the interface work.

## Anya's review of the layout study (2026-09-25)

Recorded by Claude from Anya's message. These are her calls unless marked otherwise.

- **Likes the study GUI overall.** It's the base for the redesign.
- **Metrics strip is too sparse on desktop.** Put the energy bar ("Where the light went") in the footer when there's room.
- **Settings is a sidebar, not a pane.** It should either overlay the page or push the whole page over. On mobile it currently opens inside the selected canvas and gets cut off, which is wrong.
- **Desktop pane selector is broken.** The selector stays visible, collapsed panes vanish entirely, and the only way back is Restore layout. Collapsed panes must be restorable one at a time.
- **"Preview activity" → rename.** Candidates: Rerun / Simulate / Recalculate.
- **Restore what the study dropped:** undo/redo, save/restore. Export/import (save to disk, open from disk) can move to the sidebar. Brush strength control. Scroll-to-zoom in Editor, Result, and Optics (not only Scene).
- **Unplanned wording changes to revert or fix:** "layout study" label; the Scene legend; "the complete path" is gibberish ("the complete picture" is acceptable).
- **Luminance scale is too muted.** It needs more range.
- **Expand is too strong.** Expand should reveal more controls and enlarge a small pane (under ~25% of the page) enough to work in, e.g. to draw in the Editor. Not fullscreen.
- **Observation (Claude, checked against `design/fixture.js`).** The Result pane is a real trace. It comes from the unchanged engine with 59 of 64 facets placed and 5 dropped. The paint is the plain two-block shape shown in the Editor, so the lumpy Result is the current solver's actual output for that paint.

**Order (Anya):** GUI and Optics-pane work comes before solvers. Solver migration will also need a standard solver interface (scene/controls in, surfaces + report out) so new solvers plug in. Next step: compare the current build, `/astra/`, and this study, then regroup on what to implement.

### Decisions, round 2 (Anya, 2026-09-25)

- **Header:** keep the current app's header. Save and Restore become text buttons. The export/import/reset menu moves to a pinned block at the top of the sidebar. Ray count moves to the footer. Sim time stays as a tiny, low-contrast detail, "just for fun".
- **Sidebar:** right side. Full height below the header, like `/astra/`. It should read as a sidebar, not a pane. Slightly narrower (currently 340px). Desktop: pushes the page over. Mobile: overlays.
- **Footer:** add simulated ray count and facet count (placed/budget) to the collapsed footer. Plus a slightly richer issue line. Energy bar shown only when there's width for it (responsive; hides below a breakpoint).
- **"Reference"** in the study footer just meant "the frozen precomputed run". In the app, that slot is the live design-issues summary.
- **Expand:** makes the active pane prominent (larger, local controls revealed). It does NOT collapse or hide other panes. Not fullscreen.
- **Click-to-focus:** the Editor must not paint unless it's already the active pane. The first click only activates it. This saves a lot of accidental undos.
- **Main button:** "Simulate" is acceptable. Note: the current button ("Generate") re-solves *and* re-traces, and auto-after-edits usually reruns it anyway, so "Rebuild"/"Regenerate" may describe it better. Open.
- **Scene default:** the study's whole-path composition, but mirrored: reflector bottom-left, target top-right.
- **Solvers:** the `/astra/` build's solver (tag `astra-final`) is more advanced than the current one. Anya iterated on it before the swap. The solver migration should port it, not just the current spoke solver. SQM (supporting quadrics) is wanted as an alternate solver: its surface is continuous, so it's closer to buildable.
- **Click-to-focus gates scroll-to-zoom too**, so a stray scroll can't zoom a random pane. **Exception:** drag-to-orbit works immediately, with no activating click.
- **Main button = "Rebuild"** (Anya, agreed).
- **Pane headers:** title plus collapse/expand pinned to the top corners. Only the tools wrap. When a pane is under 380px wide, the tools drop to their own line (a container query on the pane's width). Done in step 1.
- **Brush controls → one slim row** (Anya): step 4.
- **Inactive panes, quieter tools** (Anya's idea, open): proposal is to *dim* them rather than hide or slide them. See the reply in the session. Mode tabs (Paint/Stamp/Profile) would live in both the Editor header and the top of the sidebar, always visible.
- **Sidebar breakpoint:** pushes above 1024px, overlays at ≤1024px (Anya). Panes keep their split layout down to phone width.
- **Heat colours:** default is Astra's single-hue teal ramp with a faint washed-out hue drift, slightly less range than inferno, linear mapping. View → "false-colour heat maps" switches to inferno (Anya). "More range" was a note for the study, not for this build.
- **Default camera:** whole scene, 35 mm, eye behind the lamp at az 200° / el 32°: reflector bottom-left, target up and right. With the current default scene (1 m target at 1 m), the fixture is still small. That's a default-scene question.
- **Motion:** collapse/expand animate, gated on prefers-reduced-motion. The Details drawer grows out of the footer as one shape.
- **Setup handles live in Optics** (step 4b, Anya): the Scene shows the source marker only. The Scene header is "Reset view" (back to the load view) plus "Setup" (brings the handles, envelope and target-distance handle back into the Scene). Optics has an Envelope toggle, on by default.

## Stamp mode rethink (Anya, 2026-09-25, for later)

Currently: stamps are placed on the **Result** map, and the **Editor** is a direction picker (which emitted angle the facet captures). Anya: that's backwards.

Wanted: **place, size and rotate the stamp on the target map in the Editor** (intent), and let the **solver** find where the facet must sit to deliver that size and rotation, within the constraints. The Result shows what was achieved. The direction picker becomes an optional manual override.

- **Solver half (the bigger one):** tile size + rotation become objectives of the Mode B placement search. Image rotation is set by the facet's azimuth around the source; image size by its distance and curvature. This supersedes the 09-24 "stamp ROTATE = orientation objective" note and absorbs the planned stamp resize handles.
- **UI half:** stamp handles (move / corner-resize / rotate) in the Editor; the Result becomes read-only for stamps; show achieved vs requested size/rotation when constraints prevent a match.
- **Why it's distinct from Paint (Anya):** each stamp must become **one facet, or fail with a stated reason**, not a grid of tiny tiles. That's closer to how real reflectors are designed.
- **Physics it implies (checked, first-order):** tile size ≈ source size × (facet→target ÷ source→facet), so small, sharp stamps force facets **farther from the source**. The facet's width doesn't lower this blur floor. A small stamp that must also be *bright* needs that far facet to be large too (étendue: less solid angle per mm² of facet farther out). Failure reports should name the binding limit, e.g. "needs a facet ~70 mm out; the envelope allows 45".

## Solver interface — spec (2026-09-25, agreed with Anya)

**Provenance.** Astra's untouched baseline (`agent-qa/work-codex-astra-reflector-v3-ASTRA-BASELINE`)
solves by (1) equal-flux quantiles of painted cells in *raster order*, (2) candidate positions on
constant-optical-path ellipsoids (foci = LED, aim point), (3) greedy per-request placement with
solid-angle + spatial exclusion (~O(requests × candidates)). It has no fill / cutoff-bias /
design-emitter knobs and no tuner: those (and `tune.js`) came later in interactive work, Opus 5
per Anya. `tune.js` = one-pass coordinate descent over budget × fill × design emitter (~16 evals),
each a full rebuild + real 20k-ray trace (no paths), 3 objectives measured inside the paint with
guard terms; starts from the user's settings. No per-facet feedback; compares noisy scores blind.

**Two layers.**
1. **Solver** — settings in, geometry out, deterministic for a given (input, settings, seed). May
   iterate internally (analytic, or a few cheap traces) but never changes its own settings.
2. **Tuner** — given a goal, picks a solver's settings by trying them. Generic: reads the solver's
   declared settings schema, so one tuner drives any solver. Benchmark: prescribed parameters +
   prescribed tuner goals are required; models may add their own settings, modes and tuners.

**Registry.** A solver file calls `RF.Solvers.register({ id, name, version, modes: ['paint'|'stamps'],
settings: [schema…], solve(input, settings, tools) })` and needs no other edits. Schema fields:
`{ key, label, type: 'number'|'range'|'select'|'checkbox', min, max, step, options, default, help }`,
rendered into the sidebar. Default solver = spoke v1; the switcher, settings of non-default solvers
and the grader live under Reference & debug (not the project's main purpose).

**Input** (plain data, no DOM): `{ source, envelope, target, paint: { res, cells }, stamps, seed }` —
the problem half of the scene, deep-copied. **Tools:** `trace(surfaces, { rays, seed, attribution })`
→ `{ grid, perFacet?, occlusion, noise }` (common random numbers: same seed for every candidate so
differences are geometry, not dice; returns its own noise estimate), `progress(pct)`, `budget { rays, ms }`.

**Output:** `{ surfaces, intent?: [{ facet: id|null, cells: [[paintCell, weight]…] }], notes?, extras? }`.
Intent is optional, per facet, **overlap allowed**; `facet: null` = an intent the solver couldn't place.

**Host-owned facts** (never trusted from the solver): `verify(output)` → placed, dropped (null-facet
intents), envelope + keep-out compliance per surface, intent well-formedness, surface validity.
Scoring (delivered map, U₀, % of ceiling, occlusion, delivered÷intended) is also host code.
**Saved with the geometry:** `scene.solve = { id, version, settings, seed }`; reopening shows what
was solved, Rebuild re-solves with the same solver.

**Isolation.** UI runs solvers in a Web Worker: responsive, and a solver has no access to the page,
so it can't patch the grader or tracer; the host terminates a solver that overruns its budget.
Headless tests call the same registry synchronously.

**Conformance suite** (every registered solver): stays inside envelope + keep-out, same seed ⇒ same
output, intent well-formed, metadata round-trips, never mutates its input.

**Build order:** (a) registry + spoke v1 adapter (byte-identical output) + verify + `scene.solve` +
inspector reads standard intent; (b) worker host + budget kill; (c) load-solver-from-file + hidden
switcher + schema-rendered settings; (d, post-compaction) generic tuner, Astra port, SQM.

### Solver interface — build log (2026-09-25, branch `solver-interface`)
- (a) `js/solvers.js` registry + `verify` + `runSync/runAsync`; `js/solver-spoke.js` = spoke v1, byte-identical
  to modeA (gated). Inspector reads the standard per-facet intent. **Verifier gap found by its own negative
  control:** the keep-out sphere can be entered *between* a patch's edges; interior samples are now measured on
  the real surface (a chord-only test raised false alarms on concave facets). Default scene: closest facet
  15.07 mm vs 15 mm keep-out — clean.
- (b)+(c) loaded solvers run ONLY in `js/solve-worker.js` (page holds a proxy); budget 60 s / 2e7 rays, overrun ⇒
  worker terminated + sources reloaded. Built-in spoke stays inline (trusted, ~40 ms) — Anya may overrule.
  `examples/solver-example.js` = template (settings, progress, intent, trace + attribution feedback).
  Hostile tests passed live: DOM access fails, infinite loop stopped, Forget restores the default.
- **Open (Anya 09-25): keep-out** is arguably a solver parameter; see discussion — split proposed into a hard
  packaging clearance (problem, verified) vs a minimum-distance preference (solver setting).
- Next (post-compaction): generic tuner; port Astra/Opus-5 solver (`astra-final`: fill, cutoff bias, design
  emitter); SQM; benchmark harness (headless runner using the same worker contract).

### Paint fidelity (2026-09-26)

The headline measure of how well a design reproduces the painting (`RF.Photometry.fidelity`, shown in the footer,
Details, the Result map's Fidelity view and the spot inspector; returned by `trace()`):
- **painted right:** painted cells within ×/÷1.25 of their painted level, at the design's best overall brightness.
  Near an edge a cell may instead match the paint blurred by the smallest LED image (a conservative kernel: the LED's
  short side, foreshortened, over the envelope within 60° of the LED axis).
- **gaps dark:** unpainted cells within (kernel + 2) cells of the paint should stay under max(1.25 × the blurred
  paint, 10% of a typical painted cell); each earns credit on a ramp that reaches 0 at 0.3 × a typical painted cell
  above that allowance (so a smear gets partial credit and a flood none).  Without this half, flooding scored best.
- **Headline = F1** (harmonic mean) of the two, so it is near 0 if either half is: a flood and a pitch-black
  design both score 0.  (A 50/50 average gave both 50%.)
- Also reported: ratio percentiles, interior/edge split, light on the paint, spill (and spill just outside the edge),
  and a noise ceiling (what a perfect design would score at the current ray count).
- Known-answer controls and mutation checks: tests/photometry.js.
- Built-in solvers: Spoke (default) and Constellation (a demonstration of a poor solution: tiny facets, one LED
  image per painted cell).
- Benchmark notes (trial results, scoring decisions) are kept privately, outside this repo.

## Solver lab (2026-09-29, branch `solver-lab`, not pushed)

Goal (Anya): a flexible solver that *can* reach ~95% fidelity on the test scenes while capturing and delivering most of
the light, with peak intensity closer to the possible maximum than to 0; efficient with facets; ~5 s static, a minute
is fine for a tuner.  Everything below is exploring-mode; numbers are 1M rays on a trace seed the solvers never see.

**Tools.** `tools/bench.js` (solvers × scenes → table + `bench-out/bench.jsonl`), `tools/bench-scenes.js` (one factor
changed per scene: LED orientation, die, coil, throw, envelope, paintings, sparse 8–24 facets, cursive hello; held-out
and Anya's scene files are read from the private agent-qa repo, never copied here).  Metrics beyond fidelity:
`ofPoss` = peak ÷ (capturable light × reflectivity spread exactly like the paint, capped by the envelope ceiling);
`ofIdeal` = mean painted cell's delivered ÷ that ideal.

**Bundled model solvers** (`solvers/`, verbatim + a scope wrapper, credited in the picker via `solvers/index.json`).
Baseline on 28 scenes: dish-fit (Sonnet 5.5) 89.4% fidelity / 47% on paint; Mosaic (Opus 5.5) 84.4 / 39;
finite-image (Sol 6) 80.7 / 20; bowl-image (Sol 6.1) 84.2 / 11.

**Engine additions.**
- Two-curvature facets: `facet` + `vg: [v1, v2]` (vergences 1/mm) + `ax`.  Built on the exact ellipsoid at the mean
  vergence with the tangent-plane curvature set by the generalised Coddington equations.  ⚠️ A symmetric osculating
  paraboloid FAILED the tracer check (coma: 6 mm facet blurred to 2 mm at 600 mm) — oblique facets need the cubic sag.
  `tests/facet2.js` checks through the engine's own rays.
- Opaque-coil emission (`source.emission: 'surface'`): Lambertian skin, intensity ∝ projected area, dark end-on.

**Fill & fix (`solvers/lab-fill-fix.js`, v0.3).**  Shell of stacked paraboloids (LED at the focus, axis to the target;
focal length may only shrink going backward, so nothing blocks) → equal-weight tiles (flux × (r/r_med)^κ, κ from the
paint's fine detail) → exact geometric footprints (real quadric, real normals, every LED sample reflected; no Monte
Carlo) → greedy pursuit, blurriest facets first, then lift-and-replace sweeps with boosting of failing cells; the shell
is picked by predicted fidelity (the app's own metric on the model's field).  Settings: Priority / Facet shapes /
Quality; the rest under Advanced.
- Suite (36 scenes, normal quality): mean fidelity **88.8%**, 41% on paint (dish-fit 87.3 / 42).  Wins big where
  spreading matters: full wash +29, Anya's 400-facet beamshot +30 (defaults; 87.7% with 71% of the light on paint),
  half-plane +9, test +7.  Anya's 245-facet scene at min distance 0: **95.1% fidelity, 74% on paint, 76% of possible
  peak**.  Still behind on the long 2×0.5 die, few-facet rings/bars and text.
- What found the bugs (each silent): measuring footprints against the TOTAL grid (direct LED light inflated σ 3×);
  a wall-hugging shell whose tilted facets built a sawtooth (42% blocked); flat-plane outlines (0.45–1.7× the planned
  light per facet); planning before pulling facets into the envelope (16-facet designs moved 43% after planning).
- Tried and falsified: per-facet dimming (no suite gain); a self-balancing gap weight (neutral, kept).  Below ~5
  points per scene, single-scene changes are greedy-placement chaos: judge on the suite mean.
- ⚠️ Min facet distance interacts with the no-blocking rule: rear directions must sit on small paraboloids, so a
  15 mm minimum cut Anya's scene from 92% to 49% of the light reachable.  The footer now warns (app-wide floor + the
  solver's own number).

**UI fixes on the branch.** Solver stop/stage/elapsed status; a newer solve request stops the running one (fixes the
silent revert); undo re-solves worker solvers and keeps map zoom; ⌘/Ctrl-click erases; plain shaded Optics view;
Min facet distance next to the budget; model solvers' knobs under Advanced.  Dev servers now send `no-store`
(`tests/serve.py`): the plain Python server let browsers keep a 3-day-old geometry.js.

**Next.** Supporting quadrics (continuous reflector) with Fournier-style virtual-target compensation; edge-aware
image orientation (long dies, cutoffs); a lithophane-style import curve for photos.

### Supporting quadrics (`solvers/lab-sqm.js`, v0.2, 2026-09-29)
One continuous reflector: N aims (weighted k-means of the paint), one ellipsoid per aim (foci: the LED and a second
focus on the line to the aim), the nearest ellipsoid wins each direction.  Findings, each measured:
- Plain multiplicative flux balancing fails: seen from the LED every aim sits within ~2°, so neighbouring patches
  differ by ~0.3% in radius; 86/100 patches stayed empty.  Annealed entropic (Sinkhorn) balancing down to τ = 6e-5
  (log-radius units) converges; a per-direction shortlist of 16 patches makes it ~4× faster.
- Fitting the envelope to its worst direction squashes the surface onto the LED; fit 90% of the light instead and
  leave the rest uncovered.
- The exact-geometry prediction must be smoothed at the sample spacing (unsmoothed: 18% predicted vs 41% traced).
- Per-patch defocus (second focus in front of the target so each patch fans over its own region) did not help the
  wash (42.5 → 34.9 at full strength); kept as a searched option.
- 8 scenes: mean fidelity 70.7%, **65% of the light on paint** (Fill & fix 41%).  Default scene in the app: 78.3% /
  64%, a visibly smooth dish.  Fails on photo-like paints with many patches (Anya's 245-facet scene: the balance
  diverges).  Default quality fast (~2 s): the opening × spread search bought nothing on the default scene.

### Supporting quadrics v0.3 (2026-09-30): what fixed the photo paints and the wash
Same method, six changes; every number is 1M rays on the bench's trace seed.  Numbers in the table and per-scene lists are
bench rows (`bench-out/bench.jsonl`, tags `sonnet-*`); numbers marked (dev) are single-scene runs of `tools/dev/sqm-dev.js`
at the same rays and seed, not in the jsonl.  9-scene suite (default, test, led-back, p-wash, p-halfplane, p-hotwash, sparse-spot-16, held-ring,
anya-shot-245), mean fidelity / light on paint, one change added at a time:

| step (tag) | fidelity | on paint |
|---|---|---|
| v0.2 baseline (`sonnet-baseline`) | 58.7 | 57.4 |
| + damped-Newton balance (`sonnet-newton1`) | 64.9 | 60.0 |
| + predictor fixed (`sonnet-truepred`; defocus focus fixed in `sonnet-focusfix`) | 64.9 | 64.0 |
| + reflector-size search (`sonnet-size1`) | 72.1 | 63.9 |
| + least-squares compensation, aim bias 0.3 (`sonnet-nnls1`) | 78.7 | 64.8 |
| + size search after compensation (`sonnet-sizecomp`) | 79.9 | 65.6 |
| + gap weight picked by predicted score (`sonnet-gwpick2`) | 81.2 | 65.6 |
| + aim nudge off (`sonnet-nudge0`) | 82.1 | 66.7 |
| + front-opening search, clean-up (`sonnet-clean2`, final code `sonnet-final2`) | **83.5** | **65.8** |

Per scene, baseline → final: default 78.6 → 87.6, test 55.7 → 77.6, led-back 74.4 → 91.3, p-wash 35.7 → 81.9,
p-halfplane 70.9 → 90.1, p-hotwash 51.1 → 83.7, sparse-spot-16 76.8 → 77.5, held-ring 65.9 → 79.5, anya-shot-245
**19.2 → 82.1**.  26 more scenes (`sonnet-baseline-extra` → `sonnet-final-extra`): 63.0 → 73.8 fidelity, 44.2 → 48.0 on
paint.  Anya's 400- and 1001-facet scenes (`sonnet-baseline-big` → `sonnet-final2-big`): 30.1 → 69.2 and 24.5 → 93.1.

**1. The balance divergence was a shortlist problem, not a step-size problem.**  Seen from the LED's backward half-space
every aim looks the same (the cost is linear in p = cot(θ/2)·(aim offset), and p → 0 at the back), so the 245 patches
compete in a crowd: measured at 245 patches, the 32nd-nearest patch is only 0.1–0.3% farther (in log radius) than the
nearest.  A fixed-length shortlist therefore silently truncates the soft partition, patches outside every list lose
their gradient, and the old annealed Sinkhorn walked to fluxes 2000× off.  Fix: damped Newton on the entropic problem
(dense Cholesky, Levenberg damping, accept only steps that lower the flux error), exact over ALL patches (a per-direction
window that is rebuilt when any size moves more than 0.003 in log units keeps the cost down; results identical to the
plain O(directions × patches) loop), a coarse-to-fine cold start (aims merged 4:1, split again with local sub-problems
and a mean-cost shift), a "revive" step for patches that lost all flux, and a cold restart if a warm solve fails.
Re-scaling a design must go through radius, not β: r = β(β+2c)/(2β+2c(1−cosθ)) is not homogeneous in β.
**2. The predictor lied about thin LED images.**  It smeared the sum of LED-image samples with a box sized by the LED's
LONGER side, in both axes: a 0.8 × 0.2 mm LED (Anya's scene) is a thin bar on the target, so predicted 74% vs traced 48%
for the same design (dev).  Found by tracing single patches (`tools/dev/patchcheck.js`: per-patch blob centre / spread agreed
within 2%, per-patch landed energy within ±4%, so the error had to be in how blobs were summed).  Now: per-patch LED
lattice (n_u × n_v) chosen so neighbouring samples land ≤ 1 cell apart on the target, no blur; predicted 59.2 vs traced
57.5 on the same scene (dev).  Everything downstream (compensation, the searches) needs this.
**3. Reflector size is the blur control.**  The LED's image is (LED size) × (patch→target ÷ patch→LED): a smaller reflector
paints bigger images and loses no light (the partition is scale-free).  The old fit made the reflector as big as the
envelope allows, i.e. the sharpest possible images, which is right for edges and wrong for a wash: p-wash 35.1 → 80.1 at
size 0.35 with 65% on paint (dev, no compensation).  The design search tries sizes {1, 0.6, 0.36}, re-balances warm, runs 2 compensation passes
on each and keeps the best predicted fidelity + 0.25 × light on paint (the predictor is now good enough to rank designs).
Ranking before compensation picked the wrong size (compensation moves the optimum: with it, fixed sizes gave test 70.6 at 1
vs 77.6 at 0.6, half-plane 74.5 at 1 vs 88.2 at 0.45 (dev)).
**4. Compensation by non-negative least squares.**  The prediction is a sum of per-patch blobs F = Σ g_j B_j; the
columns B_j are kept from the predictor.  Choosing the fluxes g ≥ 0 that make F match the paint in RELATIVE error (a dim
cell counts as much as a bright one, as in the score) is a Lee–Seung multiplicative fit; new shares are the fit's, damped
0.7 and clamped to 0.2–5× the old.  Thin strokes (text, bars) cannot be lit without lighting their surroundings, so the
gap term must be 0 there but ≈ 0.5 for blobs and washes: both are tried from the same state and the better predicted
one kept.  p-hotwash 70.7 → 82.3 from this step alone (dev, ratio rule vs least squares).
**5. Aims should follow area more than light.**  The score counts cells, not lumens.  k-means weighted by paint gives dim
regions few aims (anya-shot-245: the dimmest third of the cells were 5–20% within).  Weights paint^0.3 (0 = pure
area) took the 245-facet scene 57.5 → 66.1 (dev); pure area starves the bright core of resolution (50% within in
the brightest quartile) unless the direction lattice is 3× finer.  **6. Front opening** (directions within θ of the beam
get no mirror): searched {60°, 75°}; on the 245-facet scene 60 → 75 was 72.4 → 82.1 fidelity for 81.4 → 73.0 light
(`sonnet-nudge0` vs `sonnet-open75`), and the search takes it only when the score gains.

Tried and did not help (all measured): (a) per-patch defocus — the old one was mis-aimed (second focus on the LED→aim
line moved blobs by up to 16 cells; on the patch→aim line it is right) but even fixed it added nothing once the size
search exists (mean 80.3 vs 82.1, `sweep-defocus0.5` vs `sonnet-nudge0`) and it moves each patch's aim direction as seen from the LED, so it re-partitions
everything (warm solves fail); removed.  (b) Moving aims towards residual centroids (`nudge` 0 / 0.3 / 0.7): default 86.6 / 84.0
/ 80.0 (dev; bench mean 82.1 at 0 vs 81.2 before turning it off) — harmful, off.  (c) A Gauss–Newton step on each blob's own
shift, using the columns' gradients: worse on every scene tried (default 86.6 → 81.6, hot-wash 83.7 → 76.5, dev).
(d) Stretching the k-means metric along the LED image's long axis: 57.5 → 55.6 (dev).
(e) Finer direction lattice (cells per patch 40 → 70, 120, 160): fidelity unchanged, several times the cost; coarser (20)
hurts the 245-patch scene (82.1 → 77.0, dev).  (f) Envelope-fit share 0.8 / 0.95 (vs 0.9): 81.7 / 80.9 vs 82.1;
compensation gain 0.5 / 1: 81.8 / 82.0; 6 instead of 4 passes: 82.2 (`sweep-*` tags): a plateau.  (g) Smaller final entropic width improves per-patch flux
error (continuum rms 24% at τ = 1.2e-4 → 3.3% at 1.5e-5, measured on a 4× finer direction lattice) but not fidelity
(48.3 both, dev, measured before the predictor fix), so τ = 3e-5 is a compromise.
Tools: `tools/dev/sqm-dev.js` (solve + trace one scene; `SHOW`, `SHOWPRED`, `BINS`, `COVER`, `CMP`, `NOTES`),
`patchcheck.js` (one patch traced alone vs its prediction; per-facet landed vs predicted energy), `robust.js` (budgets
1–30, min distance, determinism), `tagsummary.js` (bench tags side by side), `profsum.js`.

Remaining failures.  Thin strokes (p-text 59, p-bars 58, p-hello 59): the LED's image is wider than the stroke, so the
gaps stay lit (gaps score 44%) — the same limit as before, only within improved (86–89%).  Big LEDs and small
envelopes (die-3 70, held-big-led 60, env-small 31): images are big and the envelope cannot shrink them.  Opaque coils
and filaments give only 27–31% on paint (most of the light never reaches a mirror).  The least-squares fit shrinks
some patches to fewer than 2 direction cells, and those are not emitted (placed 81–97 of 100 on most scenes, 48 on
p-spots, 65 on coil-transverse; still ≤ the budget, and their light is small).  On the 245-facet scene the dim tail is still 32–40% within and the
brightest quartile 74% (the peak comes out a little flat).  Large budgets are the slowest case: the balance is dense
(N³ per step), so budgets above 300 search less, above 600 search nothing, and at most 1000 patches are used
(decided by the budget alone, never a clock).  Timing was NOT re-measured for the final code (the machine was shared
during the last runs): the numbers in `bench.jsonl` for `sonnet-final*` are inflated; the untested speed claims are the
windowed evaluation (same results, fewer radii) and the reduced search above 300 facets.
