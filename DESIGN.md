# Flux — working design notes

This is the shared, project-local working document for UI decisions, open questions,
and deferred work. Agents should read this file rather than reconstructing the
discussion from separate harness memories. Updated 2026-09-25.

Status: **layout exploration**. The production app and solvers have not been
changed. [Interactive layout study](design/index.html) is a separate prototype.

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
