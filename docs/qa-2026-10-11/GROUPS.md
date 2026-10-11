# GROUPS: root-cause grouping of the 88 QA findings (HEAD 2dc83f6)

Method: each finding's block was read against the code it points at. Tags are the INDEX.md tags, copied exactly.
Severity order used: crash/blocker > wrong result > broken UI > perf/memory > cosmetic. A group takes its highest member.
CONFLICT = the fix would touch a file that a pending branch also changes (ui.js, panels.js, solver-host.js, solvers.js,
solve-worker.js, engine.js, index.html, solvers/, tools/). Paths are relative to ~/Projects/flux-sketchpad/.
Regression-test scripts live under $QA/<area>/ (editing, controls, lifecycle, layout, spec, memory); the editing ones
use port 8805 hard-coded, so copy them and change the port (I did that under $QA/gv/ for the undo check).

## Undo verdict (editing area's Undo-in-Paint and Undo-in-Profile reports vs the controls area)
Both sides are right; they tested different things. I re-ran the editing area's two scripts (editing/p3c_undo_stop.js and editing/p9_profile_taps.js, port changed to 8811 under $QA/gv/)
on my own server: both reproduce exactly as reported (after Undo in Paint groups.A has 0 surfaces and Stop leaves 0 surfaces with "previous design is kept";
in Profile Undo 1 removes a point, Undos 2..9 toast "Undid: Edit" and change nothing, past stack stuck at 10).
- Controls checked the painting itself (paint sum 593.2 -> 638.2 -> 593.2) and the profile point count over ONE undo. Intent restore (history.js apply) is correct; that is what they saw.
- Paint case (G08): history.apply() resets groups.A.surfaces to [] and restoreIntent only re-solves. With a worker solver (the default "Auto") that solve is async, so the scene has NO reflector until it lands;
  Stop then does dirty.delete('A') (ui.stopSolve, G26) and keeps the empty group. Needs a worker solver (default). With a built-in sync solver (Spoke) the re-solve is synchronous and nothing is visible.
- Profile case (G07): needs two or more consecutive Undos in a scene whose `solve` key is absent (presets for Stamp/Profile modes, and the very first state after load).
  Undo -> apply() deletes scene.solve (key not in the snapshot) -> restoreIntent invalidates A and forces a worker solve even in Mode C ->
  the solve writes scene.solve (controller.js applySolve) -> autosave checkpoint sees the intent differ -> pushes the restored snapshot as an "Edit" entry ->
  the next Undo pops that entry and restores the same state, forever. The same mechanism makes Undo enabled right after load and puts the lazily created road default into the next entry.
Fix is in history.js (G07, G08).

## Groups

### G01 Stamp-mode picker draws with an undefined variable
- Root cause: js/render2d.js:128 (pickerImage) writes `clearZero && !(v > 0) ? 0 : 255`; `clearZero` and `v` exist only in gridCanvas (line 55/65). Pasted line. Throws before `pickerCache` is filled, so every frame re-runs the 120x120 loop and throws. Reporters agree and are right.
- Members: L10 C07 F05 E03 M01
- Severity: crash/blocker
- Files: js/render2d.js
- Fix sketch: restore the old alpha (`img.data[o + 3] = 255`, keep the rr > 1 branch which already sets 0). Add a headless "draw every view in every mode" self-test (the repo already has tests/ harnesses) so a ReferenceError in a draw path fails CI.
- Size: S
- Regression: editing/p5_picker.js, layout/20-modes.js, memory/repro-picker.js, lifecycle/p7_modeB.js (all assert no pageerror and a non-blank Editor canvas in Stamp mode)
- CONFLICT: no

### G02 Zoomed map goes NaN after its canvas was 0x0 (collapse/reopen, phone tab switch)
- Root cause: js/render2d.js prepare2d -> View2D.refitKeep (lines 27-31, 37). While the pane is display:none/collapsed the canvas is 0x0; view.zoomed is true so refitKeep runs, fit() at w=h=0 sets fitS=0 and s=0; on reopen f = s/fitS = 0/0 = NaN, so s/ox/oy are NaN permanently. Reporter's cause is correct (confirmed by reading). Zero-size early-out is the fix; the phone tab path is the same bug and is the easier one to hit.
- Members: L02 L03
- Severity: broken UI
- Files: js/render2d.js (prepare2d)
- Fix sketch: in prepare2d, `if (!(box.w > 0 && box.h > 0)) return null` (callers skip drawing) before any fit/refitKeep, so the view keeps its last good state. Also guard refitKeep against fitS === 0 (non-finite factor -> plain fit). Standard pattern: guard clause on degenerate size.
- Size: S
- Regression: layout/06-zoom-collapse.js, layout/07-phone-tabs.js
- CONFLICT: no

### G03 No zoom limits on the 3D/2D cameras
- Root cause: js/render.js:130-134 Camera.zoomAt and js/render2d.js:25 View2D.zoomAt multiply scale without a clamp; handles are drawn at constant pixel size so a 6 px drag at scale 1e-39 becomes 1e39 mm. Reporter's cause is right.
- Members: E11
- Severity: wrong result
- Files: js/render.js, js/render2d.js (zoomAt only)
- Fix sketch: clamp scale to [fit*0.05, fit*200] (relative to the fitted scale). Optionally also have dragHandle refuse non-finite results.
- Size: S
- Regression: editing/p16_zoom.js, editing/p16b_zoom30.js
- CONFLICT: no

### G04 Scene loader accepts anything: bad data bricks boot or half-loads
- Root cause: js/state.js:98-115 deserialize() only merges defaults by key; no type/enum/range validation (mode in A-D, arrays are arrays, target.res integer 10-200, surfaces well-formed). Downstream code (ui.js boot/setMode, controller buildAll, canvas createImageData) then throws. Separately js/ui.js:122 loadScene assigns `ui.store = createStore(scene)` as its first statement, so a throw later in loadScene leaves the broken store live and autosaved. The first reporter says "others are guesses"; the mode-'Z' path is confirmed, the rest all die in the same place (unvalidated input).
- Members: C01 C04 C17
- Severity: crash/blocker
- Files: js/state.js (deserialize + a validate step). The all-or-nothing part of the load problem is solved without touching ui.js if deserialize throws before loadScene runs.
- Fix sketch: schema-validate after mergeDefaults (whitelist enums, coerce/clamp numerics, require arrays, drop malformed surfaces) and throw a clear Error otherwise. loadLocal already catches and returns null -> defaults. For loadScene, build the new store in a local variable and assign `ui.store` only after commit succeeds (all-or-nothing / transaction pattern).
- Size: M
- Regression: controls/probe3_corrupt.js, controls/probe15_io.js, controls/probe15b_upload_brick.js (all with the files/ payloads)
- CONFLICT: partly. state.js is clean; the atomic-load assignment order is in ui.js:122 (CONFLICT). Do the state.js half first; it already stops the brick.

### G05 Number/lens/handle inputs have no sane bounds
- Root cause: js/controller.js CONTROLS rows use `num()` defaults min -Infinity / max +Infinity and panels' clamp only applies finite bounds; actions write raw values: updateLens (controller.js:294, no isFinite, no range), moveStamp (273), setTargetDistance (floor 1e-6, line 331), the src.domeR setter (no re-clamp of z, line 114). The tab freeze at huge target distances is the performance consequence: js/photometry.js:184 boxBlur inner loop runs the full kernel width even when q is off-grid, so cost is O(R^2 * w) and w scales with target distance. Reporter's boxBlur diagnosis is confirmed by the stack; the clamp is the real fix and the control max is the guard.
- Members: C10 C06 E15 E14 C16 E09 E04
- Severity: crash/blocker
- Files: js/controller.js (CONTROLS rows, updateLens, moveStamp, setTargetDistance, domeR setter), js/photometry.js (boxBlur loop bounds). Lens-field panel code in panels.js is NOT needed if updateLens validates (reject non-finite, clamp rings 1..~200, ior 1..4, focal > 0).
- Fix sketch: give every physical control a min and max in CONTROLS (the UI already honours finite bounds); validate/clamp in the action layer (single choke point); restrict boxBlur `q` to [max(0,floor(a0)), min(R,ceil(b0))); moveStamp clamps to +-target half-size like onTap; setTargetDistance floor = envelope front + epsilon (and a feasibility "target inside optic" issue); domeR setter re-clamps z. Pattern: validate at the boundary, clamp in one place.
- Size: M
- Regression: controls/probe1_typed.js, controls/probe2b.js + probe5_hangstack.js, editing/p20_lens_params.js, p21_lens_d_nan.js, p22_fresnel_rings.js, p13c_target_zero.js, p4_stamps.js, controls/probe14_dome.js
- CONFLICT: no

### G06 store.version is never incremented, so stale-result guards are dead
- Root cause: js/controller.js:23 `store.notify` is the only thing that does `version++` and nothing in js/ calls it (grep: one hit, the definition). So `store.version === v` in regenerateAAsync (controller.js:49) and the check in ui.useCandidate (ui.js:465) are always true; applySolve then also does dirty.delete('A'), erasing the dirty flag the mid-solve edit set. Reporter is right.
- Members: F02
- Severity: wrong result
- Files: js/controller.js (bump version in store.invalidate when groups include 'A', or call notify from the actions/ afterChange). ui.js needs no change: both readers already compare versions.
- Fix sketch: optimistic-concurrency token: `store.invalidate = (g) => { for (...) dirty.add; if (g includes 'A') store.version++ }`. Caution: a dropped result (`rep` null) makes tick set pendingA and re-solve; with auto-solve off nothing re-solves and the design just stays dirty/stale, which is the wanted behaviour. After this lands, re-run the stale "Use last candidate" evidence ("Use last candidate" refusal then fires).
- Size: S
- Regression: lifecycle/p4_stale_apply.js, lifecycle/p11_timeout.js
- CONFLICT: no

### G07 History "intent" includes derived/lazy fields, so every solve or tab visit looks like an edit
- Root cause: js/history.js:12-27 intent() keeps `scene.solve` (written by applySolve from the solver's meta: id, version, settings, seed), `solverSettings`, and lazily created `modeD.road` (spec-ui.js roadOf writes it on first Spec visit). The first solve after load/undo/preset changes intent vs the checkpoint base, pushing an "Edit" entry, and during Undo the restored snapshot lacks `solve`, the forced worker solve writes it again, so a fresh "Edit" is pushed each time (the undo loop). Reporter's mechanism for the undo loop is right; its "either exclude solve or have presets carry it" are both valid; the first is the sturdier.
- Members: E06 C12 C18
- Severity: broken UI
- Files: js/history.js (intent, apply keep-list so scene.solve is preserved on restore), js/state.js (put the modeD.road default into defaultScene instead of creating it lazily) or exclude the field in intent().
- Fix sketch: normalise before compare: reduce `solve` to the user's choice ({id} + settings) and treat absent as the default; never include solver-written meta (version, seed). Same for any other lazily created default (fill defaults before the baseline checkpoint). Pattern: separate derived state from intent / canonicalise before diffing.
- Size: M
- Regression: editing/p9_profile_taps.js (9 undos must walk back one edit each), editing/p9d_undo_diff.js, editing/p10_undo_presets.js, controls/probe11_edit_entry.js (Undo disabled after load), controls/probe16b.js (tab visits make no intent change)
- CONFLICT: no

### G08 Undo throws away the solved reflector before the re-solve lands
- Root cause: js/history.js:46-47 apply() rebuilds every DERIVED group as `{ surfaces: [] }`; ui.js restoreIntent then only invalidates and forces a re-solve. For a worker solver the re-solve is async, so groups.A is empty for the whole solve (trace of an empty scene, Optics says "No optical surfaces yet"), and Stop (ui.stopSolve) deletes dirty A so the empty state is kept as "previous design". Reporter's guess (ui.js:84 comment) is right on the first half; the Stop half is G26.
- Members: E02
- Severity: wrong result
- Files: js/history.js (apply: keep group A's current surfaces, only B/C/L are reset since they rebuild synchronously). No ui.js edit needed.
- Fix sketch: preserve groups.A.surfaces across apply() and rely on dirty A (set by invalidate) to mark it stale until the new solve replaces it, same as a normal paint stroke does. Depends on G26 for the Stop path to stay marked out of date.
- Size: S
- Regression: editing/p3c_undo_stop.js, editing/p3_undo_solve.js, editing/p3b_paint_solve.js
- CONFLICT: no

### G09 Switching emitter to "Measured" keeps the previous bulb's shape/volts/power
- Root cause: js/source-presets.js apply(): `if (p.custom && !src.shape)` only sets a shape when none exists, and `if (!m) return p;` (measured, no rows yet) returns before `else delete src.volts`. Reporter's reading is right.
- Members: C13
- Severity: wrong result
- Files: js/source-presets.js
- Fix sketch: when switching kind (planar custom after volume preset) reset shape to rect/disc, delete volts, and reset power to the preset default before the early return. The related carry-over of drive current between emitters is a product call, see Needs Anya.
- Size: S
- Regression: controls/probe13_halogen_measured.js, controls/probe12_emitters.js
- CONFLICT: no

### G10 "clear" on the Mode A reflector is neither undoable nor lasting
- Root cause: js/controller.js:317-323 clearGroup('A') empties derived surfaces and deletes dirty A; surfaces are not part of History.intent (history.js DELETE derived), paint is untouched, so the next invalidate('A') (e.g. a source nudge) re-solves everything, and the footer facet count (rendered from the report) keeps the old number. Include-checkbox re-enable on mode switch (ui.js:136) is by design (visibility follows the tab).
- Members: E10
- Severity: wrong result
- Files: js/controller.js (clearGroup), js/panels.js (the confirm button caller; must set a history hint if kept) -> panels.js is CONFLICT; the footer facets tile source.
- Fix sketch: decide what clear means for A (tiny question for Anya: clear the paint too?). Cheapest fix: for A clear = reset paint (that is intent, so it is undoable and sticks), and make the facets tile read the live surface count.
- Size: S
- Regression: editing/p14_groups.js, editing/p15_clear_BCL.js
- CONFLICT: yes (panels.js)

### G11 Preview-quality trace never upgrades after a paint stroke or tap
- Root cause: js/input.js:68-71 up() calls onPrimaryEnd / onTap BEFORE end() (onInteract(false)), so ui.afterChange -> requestRun(ui.interacting) still sees interacting=true and sets previewRun. ui.interact(false) (ui.js:817-826) only requests the full run when movedSomething, which painting and taps never set. Reporter's cause is right.
- Members: E13
- Severity: wrong result
- Files: js/input.js (call end() before onPrimaryEnd/onTap), or make interact(false) request a full run whenever ui.previewRun is set.
- Fix sketch: end the interaction before committing the gesture. input.js-only change avoids ui.js. Side effect: end() may call requestRun(false) once more; harmless.
- Size: S
- Regression: editing/p19_preview_stuck.js, editing/p19b_tap_preview.js
- CONFLICT: no (input.js)

### G12 Pane minimums ignore the map chrome
- Root cause: js/layout.js K.MIN_H = 140 and K.MIN = 180 are smaller than a map pane's own chrome (K.CHROME = 100 is already used elsewhere in the same file for the stacked-vs-side-by-side decision, plus caption/toolrow and footer wraps), so a divider drag or an Expand can leave a 0-25 px map; ui.js set() only clamps shares to 0.1-0.9. Reporter's cause is right. The chip covering the Result map is the same thing at a small size.
- Members: L05 L16
- Severity: broken UI
- Files: js/layout.js (K.MIN_H >= CHROME + ~120; MIN for the pair row), tests/layout.js (headless arithmetic tests)
- Fix sketch: minimums = chrome + a usable map (e.g. 100 + 120 px); where the window is too small for that, collapse to rails instead of squeezing. Pure arithmetic, so the existing tests/layout.js covers it.
- Size: S
- Regression: layout/14-min-sizes.js, layout/12-dividers.js, layout/26-inspector.js
- CONFLICT: no

### G13 Pane header and tool rows do not wrap / overflow small panes
- Root cause: css/app.css: `.modes.seg` (no flex-wrap, unlike #heat-display), `.ff-tools` (no flex-wrap / right), `.drive-tools` and `.road-tools` assume a large canvas and are absolutely positioned over a 20-60 px Result at 1280x720 (the Spec footer there is 137 px). Reporters' guesses fit.
- Members: L01 L12 L11
- Severity: broken UI
- Files: css/app.css
- Fix sketch: flex-wrap: wrap on the three rows, or move tool rows out of the canvas box into the pane flow (position: static) so they take height from the pane instead of overlaying it.
- Size: S-M
- Regression: layout/01-baseline.js, layout/20-modes.js, layout/21-spec-small.js (run at 1280x720 and 768x1024; script prints overflow probes)
- CONFLICT: no

### G14 Chrome heights change when the solve starts / when the Result head wraps
- Root cause: css/app.css `.foot { flex-wrap: wrap }` plus the PREVIEW tile (#min-row.pv, `.pv-tag` max-width 160 px) pushes Details to a second row (footer 49 -> 94 px) so every pane and map refits twice per solve; `body.solving #btn-generate-top::before` adds 16 px to the button. The map misalignment: the Result head's wrapped view buttons are taller than the Editor head's mode tabs so the two map squares sit 24-36 px apart.
- Members: L07 L17
- Severity: broken UI
- Files: css/app.css
- Fix sketch: reserve space: fixed footer height (or min-height holding two rows) and absolute spinner slot on the button; give both pane heads the same fixed head height (or align the square to the same top). Pattern: reserve space for transient content so layout does not shift.
- Size: S
- Regression: layout/17-solve-jumps.js (rect log), layout/01-baseline.js
- CONFLICT: no

### G15 Spec footer tiles go stale after judge-only changes
- Root cause: js/spec-ui.js:127-128 `changed(ui, false)` updates, renders and redraws the far field but never calls ui.rerenderStats() (roadChanged at :566 does). The footer then refreshes only incidentally from the run loop's 1000 ms stats tick (ui.js:560). Reporter's later "mechanism pinned down" update is correct and the first note (stale for 10 s) is just that tick not firing.
- Members: S01
- Severity: wrong result
- Files: js/spec-ui.js (changed())
- Fix sketch: add `if (ui.rerenderStats) ui.rerenderStats();` in the non-solve branch of changed(). One line.
- Size: S
- Regression: spec/p3-stale-footer.js, spec/p17-stale-quick.js, spec/p16-stale-matrix.js
- CONFLICT: no

### G16 Spec road/drive settings redraw twice and rebuild the road model
- Root cause: js/spec-ui.js:566-570: `rnum` calls set() = setDV/setRV which calls ui.redrawSpec() (a synchronous draw), then roadChanged() sets ui.spec.road = null and redraws again; the drive cache lives on the road model, so the second redraw rebuilds the model and re-renders the picture. Reporter's cause is "read, not instrumented"; reading agrees.
- Members: S05
- Severity: perf/memory
- Files: js/spec-ui.js (rnum/rsel/setRV/setDV/roadChanged)
- Fix sketch: picture-only settings (drive and road view options) should redraw once and not null ui.spec.road; only settings the road model depends on invalidate it. Split roadChanged into modelChanged / viewChanged.
- Size: M
- Regression: spec/p7-storms.js, spec/p8-drive-double.js
- CONFLICT: no

### G17 Spec "Measure at: target" is a snapshot, not a link
- Root cause: js/spec-ui.js:78 stores `ui.store.scene.target.distance` (a number) in modeD.distance instead of a marker, and the button highlight (:248) matches only while the numbers still agree. Reporter is right.
- Members: S06
- Severity: broken UI
- Files: js/spec-ui.js (button + highlight), js/spec.js (gridOpts resolves the sentinel)
- Fix sketch: store distance = -1 (or 'target') and resolve it in RF.Spec.gridOpts against the live target; highlight by sentinel. Check the presets that write distance (FMVSS 18.3 m) are unaffected.
- Size: S
- Regression: spec/p11-misc.js
- CONFLICT: no

### G18 Road "Manual inclination" assumes the cut-off is at 0 deg unless the judge aimed by cut-off
- Root cause: js/road.js:143 `cutV = isFinite(ev.aim.cutV) ? ev.aim.cutV : 0`; cutV is only set by aimOf in 'cutoff' mode (spec.js:449), so under design/peak/manual aim the road shift uses 0 although the beam's cut-off sits at +1.13 deg. Reporter is right; the help text promises "where the judge found it".
- Members: S10
- Severity: wrong result
- Files: js/road.js, js/spec.js (expose the cut-off position found by the aim scan regardless of aim mode)
- Fix sketch: compute the cut-off position separately from the aim mode (the scan aimOf already runs) and use it; if none found, say so in the road note. 
- Size: M
- Regression: spec/p15-road-manual.js
- CONFLICT: no

### G19 Spec report wording errors
- Root cause: string builders in js/spec.js:448 (`Math.abs(line) + '° D'` and `b.v.toFixed(2) + '°'`, no U/D), js/spec-ui.js:488 (same '° D'), js/spec-ui.js:192 (appends " · no re-aim helps" whenever aimBox set and reaim is zero, regardless of manual/live noBox), spec.js:465 + spec-ui.js:31 (the live note is suffixed again each judgement because the previous note is fed back). Reporters' causes fit; the "no re-aim helps" wording is also hit by the live noBox/frozen path (reporter confirmed that in the live run).
- Members: S04 S09 S08 S15
- Severity: cosmetic
- Files: js/spec.js, js/spec-ui.js
- Fix sketch: one `fmtVert(deg)` helper (U/D with sign); build the live note from the base note, not from the previous live note; only mention re-aim box when it was searched.
- Size: S
- Regression: spec/p6-aimline.js, spec/p13-fmvss-aim.js, spec/p14-manual-note.js, spec/p24-live.js
- CONFLICT: no

### G20 Small Spec UI defects
- Root cause: headroom card: js/spec-ui.js:233 rowText prints 10^|margin| with no cap and no check for value <= 0 or unsure verdict. Exposure buttons: spec-ui.js:848/850 step +-0.5 but titles say "One stop". Hotspot centre input: spec-ui.js:632 gives every IDEAL row `min: 0` although the handler accepts negative hotH. Each reporter cause is right.
- Members: S02 S07 S12
- Severity: cosmetic
- Files: js/spec-ui.js
- Fix sketch: cap the headroom factor ("> 1000x" / omit when unsure); fix the two titles ("Half a stop") or step 1; drop min for hotH.
- Size: S
- Regression: spec/p5-consist.js, spec/p11-misc.js, spec/p20-misc2.js
- CONFLICT: no

### G21 Mode geometry cache is unbounded
- Root cause: js/modes.js:31 `geoCache = new Map()`; each distinct painting adds ~48 KB at res 100 and never evicts (modes.js:34-45); ui.js:604-611 evaluates after every finished Mode A trace. Reporter measured it; the real per-stroke rate is computed, not measured.
- Members: M04
- Severity: perf/memory
- Files: js/modes.js
- Fix sketch: keep only the last 1-2 entries (the geometry is cheap to recompute) or an LRU of ~8 (Map insertion order, delete oldest).
- Size: S
- Regression: memory/repro-geocache2.js (ArrayBuffer MB should stay flat at 2000 distinct paints)
- CONFLICT: no

### G22 README claims no fetch/XHR/workers and "no server needed"
- Root cause: README.md:10-12 is stale; code uses Worker (solver-host.js:22, ui.js:359), fetch (solver-host.js:89,92, ui.js:1377) and a Blob importScripts (solve-worker.js:35); over file:// the bundled solvers silently do not load (2 of 37 solvers) and the scene's solver falls back to Spoke.
- Members: M02
- Severity: wrong result (docs); broken UI on file://
- Files: README.md (correct the statement, say "serve with tests/serve.py or any static server"). Optional second part: a visible notice when solvers/index.json fails to load, which touches js/solver-host.js bundle() and ui.js.
- Fix sketch: docs-only change is conflict-free; the notice is a follow-up inside batch B7.
- Size: S
- Regression: memory/repro-file.js
- CONFLICT: no for the README edit; yes for the notice (solver-host.js)

### G23 Solver host has one pending/cancel slot, so overlapping requests corrupt it
- Root cause: js/solver-host.js: ask() sets the module-level `pending`/`cancel` (line ~25-38) with no queue. (a) abort() -> `ready = reload()`, whose load messages occupy that slot; a second abort() in the window terminates the worker, rejects the load and starts a second concurrent reload(); the two reloads share the single slot, one never gets its reply, `ready` never resolves, the solve never starts and its budget timer (armed after ready) never exists. (b) load() awaits `ready` only, not a running solve, so its ask() overwrites the solve's slot: load gets the solve's reply (`d.defs is not iterable`), the solve never settles and the budget timer aborts the load instead. (c) onerror (line ~24) sets worker=null and cancels, but neither terminates the crashed worker nor rebuilds, so the next spawn() has only the built-in solvers. Reporters' diagnoses all check out; they are one root (no request serialisation / worker lifecycle).
- Members: F01 F14 F09
- Severity: crash/blocker
- Files: js/solver-host.js
- Fix sketch: a request queue (promise chain / mutex) so only one ask() is outstanding; correlate replies by request id (add `rid` to messages; the worker echoes it; solve-worker.js needs a one-line echo, so check that file too); abort() cancels only an active `solve`, and a pending reload is awaited, not restarted; onerror -> terminate + `ready = reload()` like abort. Pattern: single-flight queue with request ids.
- Size: M-L
- Regression: lifecycle/p2_reload_race.js, p2b_reload_race_budget.js, p19_nudge.js; lifecycle/p22_load_during_solve.js, p22b_load_budget.js; lifecycle/p15_errors.js, p15b_errors.js; lifecycle/p12b_workers.js (leak check)
- CONFLICT: yes (solver-host.js; maybe solve-worker.js)

### G24 Corrupt flux/solvers key throws on every load
- Root cause: js/solver-host.js:98 (restore) `JSON.parse(... || '[]')` is in a try/catch, but valid non-array JSON passes and `for (const src of saved)` throws.
- Members: C03
- Severity: broken UI
- Files: js/solver-host.js
- Fix sketch: `if (!Array.isArray(saved)) saved = []`; filter to strings.
- Size: S
- Regression: controls/probe3_corrupt.js ("flux/solvers junk" case)
- CONFLICT: yes (solver-host.js)

### G25 tick() has no error isolation; stale selection crashes the heat overlay
- Root cause: js/ui.js tick() runs drawHeat/drawLeft etc. with no try/finally, so any draw exception skips `ui.sceneDirty = false` and the trailing schedule() (this is why G01 stalled the trace). Stale selection: ui.js:1187 zoneOverlay indexes `rep.intent[z].cells` with a zone index from a selection that the new report lacks (selection never validated after a re-solve), and the throw also skips the status update ("Solving ... 95%" frozen). Reporter's causes are right; the stall is fully fixed by G01, the try/finally is the hardening.
- Members: E05 E12
- Severity: crash/blocker
- Files: js/ui.js (tick, zoneOverlay, selection reconcile after refreshPanels)
- Fix sketch: wrap per-view draws in try/catch that reports once and always reaches schedule() (`try { ... } finally { schedule-if-needed }`); drop/clear `ui.sel` entries whose id no longer exists when a new report lands.
- Size: M
- Regression: editing/p6_trace_stall.js (after G01, inject a throw to prove the loop survives), editing/p17_select.js, editing/p17b_after.js
- CONFLICT: yes (ui.js)

### G26 Stop / timeout / crash / error bookkeeping lies about the kept design
- Root cause: js/ui.js ui.stopSolve (line 325) and the tick() reject handler (~515) both `store.dirty.delete('A')` for aborted solves, so stale() is false, status reads "up to date" and the Rebuild marker is off while the shown design was solved for the old painting (with Spec preset load there is no previous design at all). For non-abort errors the handler sets `store.reports.A = { error, warnings: [], placed: 0 }` replacing the kept design's report. Reporters are right. This is also the second half of G08.
- Members: F07 F10
- Severity: wrong result
- Files: js/ui.js (stopSolve, reject handler)
- Fix sketch: leave dirty A set on stop/timeout/crash/error (design stays marked out of date, status "out of date, press Rebuild"); keep the previous report and put the error in the notice only.
- Size: S-M
- Regression: lifecycle/p10_stop_dirty.js, lifecycle/p11_timeout.js, lifecycle/p15b_errors.js, lifecycle/p21_spec_trace.js, editing/p3c_undo_stop.js
- CONFLICT: yes (ui.js)

### G27 Scene/solver changes do not cancel the running worker solve
- Root cause: js/ui.js: tick()'s non-worker branch (~line 499-525) calls C.regenerateA directly without stopWorkerSolve() (only ui.generateA calls it), so choosing a built-in solver mid-solve leaves the worker running, its preview drawn over the new design. When that stale solve ends, `if (!rep) { ui.pendingA = performance.now(); ... }` sets pendingA with dirty A already cleared, so it is never consumed and later setting changes auto-solve with the switch off. ui.loadScene (ui.js:122) swaps the store without stopWorkerSolve()/dropWatch(), so a preset loaded mid-solve keeps the old scene's solve and preview (also Reset/Open/Restore snapshot, untested). Reporters correct.
- Members: F03 F04 F06
- Severity: broken UI
- Files: js/ui.js (tick non-worker branch, loadScene, the `!rep` handler)
- Fix sketch: one `cancelSolve(reason)` helper called from every entry that supersedes a solve (tick sync branch, loadScene, solver dropdown); in the `!rep` handler only set pendingA when dirty A is set. Depends on G06 (version) to be meaningful.
- Size: M
- Regression: lifecycle/p5_battery.js (builtin, presetStamps), p6_pending_leak.js, p9_preset_mid.js
- CONFLICT: yes (ui.js)

### G28 Rebuild while bundled solvers are loading switches the scene to Spoke
- Root cause: js/ui.js:52 generateA uses RF.Solvers.current(), which falls back to DEFAULT_ID 'spoke' while loading; only boot() and store.commit check SolverHost.loading(). applySolve (controller.js:63) then persists the fallback as scene.solve. Reporter is right.
- Members: F11
- Severity: wrong result
- Files: js/ui.js (generateA)
- Fix sketch: if SolverHost.loading() and the wanted solver is not yet registered, queue the rebuild (set the same `waiting` state as boot) or disable the button until loaded.
- Size: S
- Regression: lifecycle/p17_boot_rebuild.js, lifecycle/p17b.js
- CONFLICT: yes (ui.js)

### G29 Preview overlay and footer ignore the current mode and the Watch switch
- Root cause: js/ui.js watchShown() (line ~423) does not check the mode, so a Paint solve's preview and Stop button persist in Stamp/Profile; previewStatsOn() (line 380) checks ui.previewStats but not ui.watchOn, while onPreview only traces when watchOn, so the footer freezes on the last candidate. Reporters right.
- Members: F12 F13
- Severity: cosmetic
- Files: js/ui.js (watchShown, previewStatsOn)
- Fix sketch: gate both on `isPaint(mode)` and `ui.watchOn`; clear the footer preview state when Watch toggles.
- Size: S
- Regression: lifecycle/p18_modeC_mid.js, lifecycle/p20_watch_toggle.js, lifecycle/p20b.js
- CONFLICT: yes (ui.js)

### G30 Refine button not refreshed when a solve starts
- Root cause: js/ui.js tick() ~line 561 refreshes btn-refine only on `justDone || ui._refineN !== run.ctx.N`; showStop() does not.
- Members: F08
- Severity: broken UI
- Files: js/ui.js (showStop, or the tick refresh)
- Fix sketch: refresh the button inside showStop()/markStale() (the same place stale state is recomputed).
- Size: S
- Regression: lifecycle/p13_refine.js
- CONFLICT: yes (ui.js)

### G31 Envelope face drag can pass through the opposite face
- Root cause: js/ui.js:861-864 the guard `lo + 1e-3 * (hi - lo + 1)` uses the current width, so each pointermove shrinks it geometrically; setEnvelopeHalf floors at 1e-6 only. Reporter right.
- Members: E07
- Severity: wrong result
- Files: js/ui.js (dragHandle), optionally controller.js setEnvelopeHalf minimum
- Fix sketch: compute the limit from the drag-start width (not the live one) and floor at a real minimum (e.g. the source size + clearance).
- Size: S
- Regression: editing/p11_handles.js
- CONFLICT: yes (ui.js)

### G32 Paint is committed on pointerdown, before the gesture is known
- Root cause: js/ui.js:998 onPrimaryStart paints immediately and js/input.js:36 ends the primary stroke on a second finger, committing the dab; a double-click is two clicks, the first pointerdown/tap paints before dblclick fires its reset (double-click case, ui.js:1602 dblclick -> resetView). Reporters right.
- Members: L13 E16
- Severity: wrong result
- Files: js/input.js, js/ui.js (onPrimaryStart/onTap)
- Fix sketch: defer the first dab until the pointer moves a few px or the pointer is released as a tap; when a second pointer arrives before that, drop it ("gesture disambiguation"). For the double-click case either skip paint when the click is the first half of a dblclick (delay tap by dblclick interval) or restrict double-click reset to non-paint modes and keep the button (see also Needs Anya if you want to keep the tooltip text).
- Size: M
- Regression: layout/23-dblclick-paint.js, editing/p23_pinch_paint.js
- CONFLICT: yes (ui.js)

### G33 Paint strokes are not interpolated between pointer samples
- Root cause: js/ui.js:1011-1018 paintAt stamps one disc at the current pointer position; onPrimary passes only (x, y). Reporter right.
- Members: E01
- Severity: wrong result
- Files: js/ui.js (paintAt/onPrimary), js/controller.js (optional segment helper)
- Fix sketch: remember the previous point and stamp along the segment at <= half-brush spacing (line rasterisation / Bresenham walk), in one undo entry.
- Size: S-M
- Regression: editing/p2_stroke_gaps.js (2 and 8 move steps must now fill 68/68)
- CONFLICT: yes (ui.js)

### G34 Dividers: expand ends on drag (other split jumps) and off dividers stay keyboard-active
- Root cause: js/ui.js wireDividers: set() (line ~1539) sets `layout.expanded = null` without writing the expanded geometry back into the stored shares, so an untouched split jumps; the keydown handler (~1545) does not check the `off` class, and layoutGrid only toggles the class, never tabindex. Reporters right.
- Members: L06 L08
- Severity: broken UI
- Files: js/ui.js (wireDividers, layoutGrid)
- Fix sketch: before clearing `expanded`, convert the current pixel sizes into shares; set tabindex=-1 and aria-disabled on `.off` dividers and ignore keys.
- Size: S
- Regression: layout/12-dividers.js, layout/19-off-divider.js
- CONFLICT: yes (ui.js)

### G35 Layout chrome has no ARIA state
- Root cause: js/ui.js / index.html build the collapse buttons, phone pane tabs, view radios and separators without aria-expanded / aria-selected / role=radio+aria-checked / aria-valuenow.
- Members: L09
- Severity: cosmetic
- Files: js/ui.js, index.html
- Fix sketch: set the attributes where the `.on`/collapsed classes are toggled (one place per control); no new behaviour.
- Size: S-M
- Regression: layout/18-focus.js (attribute dump should stop printing nulls)
- CONFLICT: yes (ui.js, index.html)

### G36 Sidebar stays open as an overlay after narrowing the window
- Root cause: js/ui.js setSide (~line 1702) applies the narrow() default only at boot and on click; the resize handler (~1760) calls layoutGrid but never re-applies it. Reporter right.
- Members: L15
- Severity: broken UI
- Files: js/ui.js (resize handler)
- Fix sketch: on crossing the 1024 px breakpoint (track previous narrow state), close the sidebar once.
- Size: S
- Regression: layout/24-resize.js, layout/15-sidebar.js
- CONFLICT: yes (ui.js)

### G37 Optics view has no reset control
- Root cause: missing feature: Editor/Result have the crosshair button and double-click, Scene has "Reset view", Optics has neither (it only gets refit as a side effect of Scene's Reset view). Low risk, minor.
- Members: L14
- Severity: broken UI
- Files: js/ui.js, index.html (a button in the Optics head), css/app.css
- Fix sketch: add a "Reset view" button and dblclick handler calling refitSurfaces(). Whether Optics should have it is a product call too, but it is the same pattern as its neighbours.
- Size: S
- Regression: layout/22-resets.js
- CONFLICT: yes (ui.js, index.html)

### G38 Bad JSON in the autosave is discarded silently (and overwritten)
- Root cause: js/state.js:119-125 loadLocal swallows every exception and returns null, so boot() treats "unreadable" like "nothing saved"; the next autosave overwrites the only copy. Reporter right.
- Members: C02
- Severity: broken UI
- Files: js/state.js (loadLocal returns a reason / stores the raw text under a ".bad" key), js/ui.js boot (show one notice)
- Fix sketch: on parse/validate failure copy the raw string to `faceted-reflector-demo/scene/v1.bad` and post a notice. Pairs with G04 (same validate step throws).
- Size: S
- Regression: controls/probe3_corrupt.js ("not JSON" case)
- CONFLICT: yes (small, ui.js boot)

### G39 Rejected or clamped text stays in the field
- Root cause: js/panels.js:65 commitTyped returns without resetting field.value when the text is not finite and does not rewrite the clamped value; the arrow handler (line 70) takes v0 from the field text (`parseFloat('abc') || 0`) instead of the store; panels.js:282 (drive current) ignores v <= 0 with no re-render. In Spec inputs, js/spec-ui.js:246 render() skips the focused element (`document.activeElement === i`), and the change event fires while the input still has focus, so the clamped value is never written back. Reporters right; one pattern.
- Members: C11 C15 S14
- Severity: wrong result
- Files: js/panels.js (commitTyped, arrow handler, drive current), js/spec-ui.js (num()/rnum() change handlers)
- Fix sketch: "controlled input": after every change/Enter/blur write the effective value back (`field.value = format(store value)`); arrows step from the stored value, not the text.
- Size: S-M
- Regression: controls/probe11_edit_entry.js, controls/probe10_history.js, controls/probe12_emitters.js (drive), spec/p21-clamp.js
- CONFLICT: yes (panels.js)

### G40 Statistics print NaN / Infinity / over-100%
- Root cause: hot-zone NaN (reporter's guess incomplete): js/modes.js:237 builds the `row` handed to metrics WITHOUT `capturable` or `envelopeCeiling` (grep: capturable is read only at modes.js:113; the function capturable() at 327 is never stored into the row), so hotspot() always gets fluxPk = NaN and ofPossible = NaN; the "of the most this light could give it" hot-zone percentage has never produced a number for any scene. panels.js:427 pct() guards only null/undefined. Point source: luminance is infinite, panels.js:497 prints it. Profile over-100%: per-surface share divides by that surface's own incoming light (not located by the reporter; I did not locate it either, so this member is the weakest).
- Members: C05 C08 C09
- Severity: wrong result
- Files: js/modes.js (row at :237: add capturable and envelopeCeiling, or drop ofPossible), js/panels.js (pct/pct0/fmtCd non-finite guard -> "—"; hide ceiling row for point source)
- Fix sketch: one shared formatter that maps non-finite to "—" (the neighbouring f2() already does); clamp shares to [0,1]; decide whether to restore the 'possible peak' by wiring capturable into the row.
- Size: M
- Regression: controls/probe4_nan_baseline.js, controls/probe9_inf_text.js
- CONFLICT: yes (panels.js)

### G41 Footer verdict tooltip rounds the measuring distance
- Root cause: js/panels.js:533 `Math.round(s.G.distance / 1000) + ' m'` instead of fmtDist.
- Members: S11
- Severity: cosmetic
- Files: js/panels.js
- Fix sketch: reuse spec-ui's fmtDist.
- Size: S
- Regression: spec/p20-misc2.js
- CONFLICT: yes (panels.js)

### G42 Spec-mode footer "peak" comes from the target-plane grid
- Root cause: js/photometry.js:72 fixture() -> peakCd(): 99.5th percentile of target-grid cell energies / cell area x d^2; js/panels.js:560 shows it as "peak" in every mode including Spec, where the rest of the page uses the far-field peak. At 25 m the cells are tiny, so the percentile is a biased max-of-noise (596 vs 263 kcd far-field). Reporter right.
- Members: S17
- Severity: wrong result
- Files: js/panels.js (Spec branch of the footer), js/photometry.js (optional: bias note)
- Fix sketch: in Spec mode feed the footer from the far-field/beam-quality peak (ui.spec.G); keep the grid peak for Paint mode.
- Size: S
- Regression: spec/p25-peak.js
- CONFLICT: yes (panels.js)

## Needs Anya
- L04: Should Expand make the expanded map bigger even though it breaks "the two maps compare cell for cell" (shared cap in syncMapCap)?
- C14: Should an emitter preset open at its own default drive current and flux model, or keep the previous emitter's (possibly intended; the label quotes a different number)?
- S03: Should Road/Drive numbers (5 lx reach, beam quality, goals) come from the always-streamed far field instead of the grid at "Measure at"?
- S13: The IIHS 5 lx markers sit at 3.3 m lane edges while the drawn road is the R112 4.4 m (documented): draw the IIHS edges too, or relabel the markers?
- S16: During a trace, should the live report hold the first aim it finds (fast, but wrong if found at 13% of rays) or refresh once enough rays exist?
- S18: Ideal-beam goals and beam quality follow the Road's "Aim on the car"; change the wording to match, or measure at the judge's aim as the text says?
- E08: Is dragging the source outside the envelope allowed on purpose (no clamp, no warning)?
- E17: Should the brush "level" set the level it shows, or stay max-only (raise-only) with a tooltip saying so?
- M03: Should the first-load Optics turntable stop on its own (e.g. after N seconds or on idle) instead of redrawing every frame until you touch the view? (Measured cost: ~31% of one core while idle.)

## Not a bug / can't confirm
- (none). I found no finding I could call "not a bug" or "cannot confirm". The weakest member of a fix group is the Profile over-100% one in G40 (reproduced, root not located). The ones that may be intended are in Needs Anya.


## Fix batches
Ordered by severity, CONFLICT batches last. One agent per batch; a batch is a set of groups in related files with no function edited by two batches. Batches marked "after" share a file with an earlier batch (different functions): run them sequentially, not in parallel.

| Batch | Groups | Highest severity | Files | CONFLICT | Notes |
|---|---|---|---|---|---|
| B1 render crashes | G01 G02 G03 | crash/blocker | js/render2d.js (pickerImage, prepare2d, View2D.zoomAt), js/render.js (Camera.zoomAt) | no | G01 first; add the "draw every view in every mode" self-test here |
| B2 validation | G04 (state.js half only) G05 G06 G09 | crash/blocker | js/state.js, js/controller.js, js/photometry.js, js/source-presets.js | no | G04's ui.js assignment-order half goes to B8 |
| B3 history | G07 G08 | broken UI / wrong result | js/history.js, js/state.js (defaultScene only) | no | after B2 (state.js, different function). G08's Stop path needs G26 in B8 |
| B4 input/layout/css | G11 G12 G13 G14 | wrong result | js/input.js (up handler), js/layout.js, tests/layout.js, css/app.css | no | G11 edits input.js `up`; B9 edits the pointerdown branch of the same file: run B4 first |
| B5 spec | G15 G18 G17 G16 G19 G20 | wrong result | js/spec-ui.js, js/spec.js, js/road.js | no | G15 is a one-liner; do first |
| B6 memory/docs | G21 G22 (README only) | perf/memory | js/modes.js (geometry cache), README.md | no | G22's visible-notice follow-up goes in B7 |
| B7 solver host | G23 G24 | crash/blocker | js/solver-host.js (maybe js/solve-worker.js for request ids) | YES | first of the CONFLICT batches (crash). Re-run lifecycle p2/p15/p22 scripts |
| B8 ui.js solve lifecycle | G25 G26 G28 G27 G29 G30 (+ ui.js half of G04) | crash/blocker | js/ui.js (tick, stopSolve, generateA, loadScene, watchShown, previewStatsOn, showStop) | YES | G06 (B2) must land first so G27 can rely on the version token |
| B9 ui.js gestures | G32 G33 G31 | wrong result | js/ui.js (onPrimaryStart/onTap/paintAt, dragHandle), js/input.js | YES | after B4 and B8 (ui.js merge order) |
| B10 panels.js | G39 G40 G41 G42 G10 | wrong result | js/panels.js, js/modes.js (row at :237 only), js/controller.js (clearGroup), js/photometry.js | YES | G10 needs the "what does clear mean for A" answer from Anya first |
| B11 ui.js chrome | G34 G35 G36 G37 G38 | broken UI | js/ui.js (wireDividers, layoutGrid, setSide, resize, boot), index.html, js/state.js (loadLocal) | YES | G35 and G37 touch index.html (GPU branch); do last |

Dependencies worth keeping in mind: G06 before G27; G26 before G08's Stop behaviour is fully right; G01 makes G25's stall symptom disappear, so test G25 with an injected throw.

## Coverage check
```
INDEX tags: 88 unique 88
tags found in GROUPS.md: 88 unique 88
missing: []
duplicated: {}
unknown (not in INDEX): []
```

## Anya's decisions (2026-10-11)
- M03 turntable: stop auto-orbit 10 s after the page goes idle, and when the Optics pane is clicked into (selected/focused). Today it spins until the user changes the orbit by hand (click to select the pane, then click+drag), and a sidebar option restarts orbiting (not default). → B11
- S16 live aim: NO aiming during a trace. Hold the aim the trace started with until the trace finishes, then re-aim once. (Live re-aim mostly eats time.) → B5b
- S03: "Measure at" defaults to ∞; road / drive / IIHS / beam quality / goals all read the far field (it already applies the aim). Manual aim covers custom cases. → B5b
- S18: goals and beam quality measured at the judge's aim (as the label says). → B5b
- S13: don't draw extra lines; check the IIHS protocol PDF so the label is by the book (IIHS is US-only); relabel the IIHS 5 lx markers so they don't read as the drawn road edges. → B5b
- E08: source outside the envelope is a valid design; allow it, but warn. → B10 (feasibility notice) / B9 (drag)
- E17: brush mode option in the sidebar: RAISE (today's behaviour, controller.js:239 Math.max) stays the default; add SET and "the other one" (my reading: LOWER, i.e. only darken; confirm when built). → B9
- C14: LED presets open at their own default drive current / flux model. → B10
- L04: Expand may make the expanded map bigger than its partner. → B4b (layout.js syncMapCap)
- Open: G10 "clear" on the Mode A reflector group — what should it mean? (B10)
- (later, same day) Layout follow-ups → B4b (layout.js / css / spec-ui.js display only):
  - L-title: Editor and Result pane titles must sit on the same line (B4's subgrid moved Editor's ~6 px lower).
  - L-fidelity: try putting Result's "Fidelity" on the same row as Hits/Grid/Smooth when it fits; wrap only when it would overlap.
  - L-spec-compact: in Spec mode, a NON-expanded Result pane hides the extra Spec controls (road/drive/far-field toolbars) and is sized like Mode A; the controls show when the pane is expanded. An idle hint/tooltip on the non-expanded pane suggests expanding it for more options.
  - L04 (decided earlier): Expand may make the expanded map bigger than its partner.
- Spec auto-layout → B11 (ui.js setMode): entering Spec mode collapses the Editor pane and expands the Result pane (Anya always does this by hand). Leaving Spec restores the layout from before (confirmed).
- B5b leftovers → do (Anya: "inconsistent result sources are a royal pain to notice"), batch B12 "one source of truth":
  - with cut-off aim, the road/drive/IIHS numbers still shift with Measure at, because the judge finds the aim on the Measure-at grid: the aim used for road-side numbers must not depend on Measure at.
  - js/solvers.js tools.trace res.road (~lines 208-210, 253) builds the road grids at the Measure-at distance and feeds BeamQuality/IdealBeam with the Road aim: switch to far field (gridOpts(scene,0), wideOpts(scene,0)) and the judge's shift, so a solver's road numbers equal the UI's.
  - js/ui.js:362 preview-worker grids at the Measure-at distance (display only): align.
  - Add a consistency test: same trace → UI road numbers == tools.trace road numbers == preview numbers, at several Measure-at settings.
