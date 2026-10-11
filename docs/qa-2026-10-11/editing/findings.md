# QA findings — area: editing (port 8805)
HEAD: 2dc83f6 (verified). Driver: headless Chromium via Playwright from /Users/anya/Projects/agent-qa/node_modules/playwright
(`npm root -g` has no playwright on this Mac, so the BRIEF's require line fails; I borrowed agent-qa's copy read-only).
Harness: lib.js (open/boot, drag via page.mouse, preset loader).

### Fast paint strokes leave dotted gaps (no interpolation between pointer samples)
- Severity: wrong result (the painted intent is not what the user drew)
- Repro: p2_stroke_gaps.js — Mode A, brush size 3, level 1; one horizontal mouse drag across 60% of the Editor canvas,
  delivered as 40 / 8 / 2 pointermove events (page.mouse.move steps).
- Observed: row 49 of the paint grid over a 68-cell span: 40 moves → 68/68 filled; 8 moves → 28/68
  (`###.....###.....###...`); 2 moves → 10/68 (only the end blobs + one middle). A real flick of the mouse
  delivers ~8-15 events per stroke, so quick strokes paint a dotted line. Visible in shots/p1.png ("+ + + +" stroke).
- Expected: a continuous stroke (brush stamped along the segment between consecutive samples).
- Reproduced: 3 of 3 (each step count once, deterministic).
- Suspected cause: js/ui.js:1011-1018 paintAt() stamps a single disc at the current pointer position; onPrimary
  (ui.js ~995) passes only (x, y), never the previous point. Confirmed by reading; fix would be to walk last→current.

### Undo/Redo in Paint mode deletes the current reflector; Stop then leaves an empty scene that claims "previous design is kept"
- Severity: wrong result (design silently lost; footer/notice contradict the scene)
- Repro: p3c_undo_stop.js — default scene, Mode A, Auto solver. Paint one stroke (mouse drag), wait for the solve.
  Click Undo; as soon as the re-solve starts, click Stop.
- Observed: before Undo groups.A has 91 surfaces. Immediately after Undo groups.A has 0 surfaces for the whole re-solve
  (a normal paint stroke keeps the old 91 during its solve — p3b_paint_solve.js). After Stop: 0 surfaces, dirty A = false
  (not even marked stale), notice reads "Solve stopped (...). The previous design is kept.", footer shows
  "0.4% fidelity | 99.1% spill | ... | 91 / 100 facets" — a trace of an empty scene labelled with the old facet count.
  Redo also starts from 0 surfaces. With Watch off (or before the first preview arrives) the 3D/Optics views show
  "No optical surfaces yet" during every undo-triggered solve (p3_undo_solve.js: nA=0 from the first poll).
- Expected: undo keeps the last applied design visible until the new one is verified (like a paint edit does), and
  Stop keeps it.
- Evidence: shots/p3c_undo_stop.png, shots/p3b_undo_during.png; console clean.
- Reproduced: 3 of 3 (p3, p3b, p3c runs all showed nA=0 after undo).
- Suspected cause (guess): js/ui.js:77-93 restoreIntent → RF.History.apply restores intent only and the solved A
  geometry is dropped (comment at ui.js:84 "history holds intent, not solved geometry"); the stop path then "keeps"
  the now-empty group and clears dirty A.

### Stamp mode: direction picker never draws — ReferenceError `clearZero is not defined` every frame
- Severity: crash/blocker (Mode B's whole left editor is dead: no picker, no direction marks, manual aim impossible)
- Repro: p5_picker.js — load preset "Three stamped tiles (Mode B)" (confirm), wait. Or any switch to Stamp mode.
- Observed: Editor pane is blank under "Direction from the source" (shots/p5_picker.png). pageerror
  `ReferenceError: clearZero is not defined at pickerImage (js/render2d.js:128:152) at drawPicker (render2d.js:136)
  at drawLeft (ui.js:759) at tick (ui.js:563)` — 14 times in ~1 s, stops in Mode C, resumes in B.
  RF.UI.pickMarks.length = 0, so a drag on the picker hits no mark and every stamp stays dirMode 'auto'.
- Expected: the intensity disc with rings and one draggable mark per stamp.
- Reproduced: 3 of 3 (p4, p5, and every later Mode B run).
- Suspected cause (confirmed by reading): js/render2d.js:128 — pickerImage's pixel loop ends with
  `img.data[o + 3] = clearZero && !(v > 0) ? 0 : 255;`, a line copied from gridCanvas (render2d.js:65) where
  `clearZero` and `v` are parameters/locals; neither exists in pickerImage. Committed at HEAD (file clean in git status).
  Knock-on: because tick() throws in drawLeft, anything after line 563 in that frame is skipped in Mode B (not traced further).

### Stamps can be dragged off the target (no clamp on move); tap-to-place refuses the same spot
- Severity: wrong result
- Repro: p4_stamps.js — preset "Three stamped tiles", tap the Result map at 15%/15% to add st4 (u=-189, v=201;
  target half-size 250 mm), then mouse-drag st4 from its screen position to 150 px left / 60 px above the canvas and release there.
- Observed: st4 ends at u=-563.7, v=404.7 — more than 2x the target half-width, off the map; the stamp keeps solving
  (groups.B still 4 surfaces) for a tile nobody can see or grab back by tapping (it's outside the drawn map).
- Expected: clamp u,v to ±half like onTap does (ui.js:939-940 rejects taps outside the target), or delete on drop-outside.
- Reproduced: 1 of 1 run (deterministic code path).
- Suspected cause: js/ui.js:917 onDrag → C.actions.moveStamp (controller.js:273) writes u,v with no bounds.

### Knock-on of the picker crash: in Stamp mode the trace stalls part-way and never finishes
- Severity: broken UI (Result and stats frozen at a partial trace; status stuck at "tracing 12%")
- Repro: p6_trace_stall.js — preset "Three stamped tiles"; set sim.rays = 2,000,000 and request a run
  (`RF.UI.store.scene.sim.rays = 2e6; RF.UI.needCompile = true; RF.UI.requestRun(false)` — I set the field directly,
  not through the sidebar control). Poll RF.UI.run.ctx once a second.
- Observed: Mode B: next = 257,024 / 2,000,000, status "tracing 12%", unchanged for 5 s. Same request in Mode C:
  finishes to 2,000,000 within 2 s.
- Expected: the trace runs to completion in every mode.
- Reproduced: 1 of 1 (mechanism below is deterministic).
- Suspected cause (from reading ui.js:563-564): tick() calls drawLeft() which throws (clearZero, above); the throw skips
  `ui.sceneDirty = false` and the trailing `schedule()` that keeps the trace stepping, so the trace only advances when
  some other event happens to call schedule(). Fixing render2d.js:128 should fix this too; a try/finally around the
  draw calls would stop any future draw error from freezing the trace.

### Undo gets stuck after one step in Profile mode (each Undo pushes a fresh "Edit" entry and undoes it again)
- Severity: broken UI (edits can't be undone past the last one; Undo button looks like it works: toast "Undid: Edit")
- Repro: p9_profile_taps.js — preset "Parabolic reflector (Mode C)", confirm, wait. Tap the Editor (profile) 8 times
  in empty space (8 points added, 8 "Profile edit" entries). Click Undo 9 times.
- Observed: first Undo removes one point (57→56) and toasts "Undid: Profile edit". Every later Undo toasts
  "Undid: Edit" and changes nothing: point count stays 56, past stack length stays 10, top label "Edit".
  p9d_undo_diff.js caught the spurious push: stack `histCheckpoint ← ui.autosave ← regenerateAAsync.then (ui.js:512)`,
  and the only intent difference between the restored snapshot and the live scene is
  `.solve: undefined -> {"id":"auto","version":"0.1","settings":{...},"seed":1}`.
- Expected: each Undo steps back one profile edit until the preset load.
- Reproduced: 2 of 2 (p8: three Undos removed one point; p9: nine Undos removed one point).
- Suspected cause (confirmed by instrumenting): restoreIntent (ui.js:77-93) commits with forceA, which starts an
  Auto (worker) solve even in Mode C; when it resolves, the solver writes `scene.solve` (absent from the parabola
  preset and from 8 of 9 presets I checked — only "deepbox" has it), autosave checkpoints that as a change and pushes the
  restored snapshot (without `solve`) as "Edit". Next Undo restores it, the solve writes `solve` again → loop.
  Either `solve` metadata written by a solve should be excluded from History.intent, or presets should carry it.

  - Second symptom of the same stall (p12_modeB_pending.js): preset "Three stamped tiles", change target distance
    (`setTargetDistance(store, 2100); ui.afterChange()`). Status line reads "design changed — regenerating when you
    pause…" with pendingA set and dirty A, and stays that way for 8 s+ and after mouse moves; no solve ever starts
    (the arm→start handoff needs a second tick that the throw never schedules). Same edit on the parabola preset settles.
    Reproduced 2 of 2 (p10 hung 120 s on this preset, p12).
  - Undo-loop (previous finding) also confirmed on preset "CPC collimator" (p10_undo_presets.js output: after one real
    undo, every Undo toasts "Undid: Edit" and target distance stays 2100).

### Envelope face can be dragged through the opposite face; envelope collapses to ~zero thickness
- Severity: wrong result (degenerate envelope accepted silently)
- Repro: p11_handles.js — default scene, Optics pane (Setup on), mouse-drag the "envelope x+" handle past the
  "envelope x−" handle (to 3x the distance beyond it) and release.
- Observed: envelope half-x goes 27.95 → < 0.005 mm (centre x -32 → -60). One undo restores it. No notice.
- Expected: a minimum size (or stop at the source / keep-out), and some feedback.
- Reproduced: 1 of 1.
- Suspected cause: js/ui.js:861-864 — the guard `lo + 1e-3 * (hi - lo + 1)` uses the CURRENT width, so successive
  pointermoves shrink it geometrically toward ~1e-3 mm; setEnvelopeHalf floors at 1e-6.

### Source can be dragged out of the envelope (no clamp, no warning in the drag)
- Severity: wrong result (suspected — the app may allow this on purpose; flagging because the brief asks)
- Repro: p11_handles.js — Optics pane, drag the amber "source" handle 150 px past the canvas's right edge, release outside.
- Observed: source pos [-36.6,-3.5,13.6] → [21.4,-130.9,97.6]; envelope unchanged (half-y 52.6, so y=-130.9 is
  ~2.4x outside). Undo restores it ("Undid: Source moved"). No console errors.
- Expected (unclear spec): either clamp to the envelope or show that the source is outside.
- Reproduced: 1 of 1.
- Suspected cause: controller.js:329 moveSource has no bounds; ui.js:855 dragHandle moves by screen delta unbounded.

### Target-distance handle drags the target to 0.000001 mm, through the reflector; the limits panel says "No design issues"
- Severity: wrong result
- Repro: p13c_target_zero.js — default scene, auto-solve off, Scene pane → Setup on, drag the blue "target distance"
  handle 250 px toward the source handle, repeat (11 drags).
- Observed: distance 2000 → 1810 → … → 97.2 → 0.000001 (the 1e-6 floor). Target plane now sits at the source, cutting
  through the reflector and inside the envelope (shots/p13c_target_zero.png). Footer: 8.8% fidelity, peak 460 cd;
  limits strip: "✓ No design issues · closest limit: Facet budget & occlusion". No notice, no console error.
- Expected: a floor at the envelope / keep-out (target in front of the optic) or a design issue raised.
- Reproduced: 2 of 2 (8-drag run reached 478 mm; 16-drag run reached 1e-6).
- Suspected cause: controller.js:331 setTargetDistance floors at 1e-6 only.
- Related (cosmetic/broken UI): with the default 51 mm lens the handle does NOT follow the cursor — each 250 px drag
  moved the handle ~5 px on screen while the distance fell ~190 mm (p13c log: handle [400,284]→[397,288]…).
  Guess: ui.js:851-857 `along()` converts screen px with the camera's ortho scale, ignoring perspective depth.
  In lens = ∞ (ortho) the target handle is off-canvas at (1768,-1493) and can't be grabbed at all (p13b_track.js).

### "clear" on the Mode A reflector group can't be undone and doesn't stick; footer keeps the old facet count
- Severity: wrong result / broken UI
- Repro: p14_groups.js — default scene, sidebar → Scene contents → "Mode A reflector — 93 surfaces" → clear → clear?
  (two clicks). Then nudge the source 0.5 mm (moveSource + afterChange, same path as a handle drag).
- Observed: after clear: groups.A 0 surfaces, dirty A false, no history entry (top of past stays "Edit", so Undo would
  revert the edit BEFORE the clear instead). Footer: "0.4% fidelity … 93 / 100 facets" (stale count vs 0 surfaces).
  After the unrelated source nudge the auto-solve rebuilds the whole reflector (92 surfaces) without asking.
  Unchecking the group's include box is likewise undone by any mode-tab switch (B→A re-enabled it, ui.js:136) and the
  footer kept "93 / 100 facets" while the group was off.
- Expected: clear is either undoable or confirmed as permanent and stays cleared (e.g. also clears or disables the
  auto-solve for that group); the facet tile follows the surfaces actually in the scene.
- Reproduced: 1 of 1 (deterministic code path).
- Suspected cause: controller.js:317-323 clearGroup('A') empties derived surfaces only (History.intent excludes
  derived surfaces, history.js:24) and leaves paint, so the next invalidate('A') re-solves it.

### No zoom limits in the 3D views: after a long zoom-out a 6 px handle drag throws the source 1e39 mm away
- Severity: wrong result (edge case; recoverable with Undo)
- Repro: p16_zoom.js — default scene, Optics pane, mouse over the centre, 150 wheel events of deltaY 400, then drag the
  source handle 6 px. (p16b_zoom30.js: 30 ordinary deltaY-100 notches.)
- Observed: camS.scale 2.7e-39 px/mm, yet the source/axis handles still draw at normal size at the same screen spot,
  so they stay grabbable; a 6 px drag moved the source to [3.2e37, -1.9e39, -1.0e39]. Footer 0.0% everything,
  "✓ No design issues" (shots/p16_zoom.png). With 30 ordinary notches (scale 0.037) the same 6 px drag moved the
  source ~155 mm, out of the envelope — expected arithmetic, but nothing tells the user the handle is that coarse.
- Expected: clamp zoom to a sane range (e.g. relative to the fitted scale); limits panel should flag a source
  outside the envelope / non-finite scene.
- Reproduced: 2 of 2.
- Suspected cause: js/render.js:130-134 Camera.zoomAt and js/render2d.js:25 View2D.zoomAt have no clamp.

### Selected facet that disappears after a re-solve: TypeError in zoneOverlay, status frozen at "Solving … 95%"
- Severity: crash/blocker (render loop throws; status bar lies until the user happens to clear the selection)
- Repro: p17_select.js / p17b_after.js — default scene. Optics pane: tap the last facet (F12, zone 92). Then set
  Facet budget = 10 (`RF.UI.setControl('A.budget', 10)`, same path as the sidebar field) and Rebuild (generateA).
- Observed: new design has 9 facets (F0…F8-ish; F12 gone) but ui.sel still {facet, ["F12"]} and the selection chip
  still reads "Facet F12 → zone 92 · 7% shadowed (F18)". One pageerror:
  `TypeError: Cannot read properties of undefined (reading 'cells') at ui.js:1187 (zoneOverlay) ← drawHeat (ui.js:718)
  ← tick (ui.js:527)`. Afterwards the status line stays "Solving · Auto … final · done · 95% · 2.3 s" for 6 s+ with
  solving=false and Stop hidden. Pressing Esc (clear selection) → status "up to date".
- Expected: a selection whose facet no longer exists is dropped (or shown as gone); the status line says done.
- Reproduced: 2 of 2.
- Suspected cause: ui.js:1187 `rep.intent[z].cells` with a zone index (92) from the old selection that the new
  report doesn't have (selInfo cache / zones not validated against rep.intent). As with the picker crash, tick()
  has no guard, so the throw skips the rest of the frame (status update at ui.js:545-551).

### After a paint stroke, the Result and every footer stat stay a 1,500-ray preview forever (never refines to the full trace)
- Severity: wrong result (headline numbers — fidelity, on paint, spill, peak — computed from 1,500 rays instead of 500,000)
- Repro: p19_preview_stuck.js — default scene, Mode A, one mouse paint stroke in the Editor, wait for the auto-solve
  to finish, then watch RF.UI.run for 6 s.
- Observed: boot run N = 500,000. After stroke + solve: run.preview = true, N = 1,500, done; status "preview";
  footer rays tile "1,500 rays 4 ms"; unchanged for 6 s+. (Also visible in p1/p3b logs: "1,500 | rays 2 ms" with
  fidelity 30.8% that jumps to ~80% once a full trace happens, e.g. after Undo.) Only an unrelated action that calls
  requestRun(false) (undo, a handle drag) brings the full trace back.
- Expected: the stroke's preview is replaced by the full trace once the stroke ends / the solve lands.
- Reproduced: 4 of 4 runs that ended on a paint stroke (p1, p3b, p18 status "preview", p19).
- Suspected cause (from reading): input.js:68-71 calls onPrimaryEnd BEFORE end(); so ui.js:997 onPrimaryEnd →
  ui.afterChange → requestRun(ui.interacting) runs while ui.interacting is still true → previewRun = true. interact(false)
  (ui.js:817-826) only calls requestRun(false) when ui.movedSomething, which painting never sets; the solve's .then
  (ui.js:513) sets needCompile but leaves previewRun true.

  - Same mechanism on taps (p19b_tap_preview.js): Profile mode, tap to add a point → run stays preview, N = 1,500,
    status "preview" 3 s later. A point DRAG is fine (N = 500,000, "up to date") because drags set movedSomething.
    Stamp taps go through the same onTap→afterChange path (not separately measured because of the Mode B crash).

### Lens "Distance from source": clearing the field stores NaN; the field then shows 20 and the lens silently drops out
- Severity: wrong result (UI shows a value the scene doesn't have; persisted to autosave)
- Repro: p21_lens_d_nan.js — default scene, sidebar Problem → Lenses → Plano-convex → Add lens; untick
  "Place at focus (auto)"; clear the "Distance from source" field and Tab out.
- Observed: lens params.d = NaN (serialises as null); the lens's surfaces have z0/z1 = NaN (seg0
  `{"kind":"line","z0":null,"r0":0,"z1":null,"r1":15}`), lens report `"d":null`; the re-rendered field reads "20"
  (fallback `L.params.d || 20`); footer identical to the no-lens design (lens not traced). Autosave
  (localStorage faceted-reflector-demo/scene/v1) now holds `"d":null`. No notice, no console error.
- Expected: ignore a non-finite entry like the other lens fields do (panels.js:358 checks isFinite), and never
  display a value different from the stored one.
- Reproduced: 1 of 1 (deterministic).
- Suspected cause (confirmed by reading): js/panels.js:366 `ui.updateLens(L.id, 'd', parseFloat(d.value))` has no
  isFinite guard; panels.js:365 shows `L.params.d || 20`.

### Lens fields are unclamped: Fresnel "Rings N" freezes the page / overflows the stack; Index n = 0 builds NaN geometry
- Severity: crash/blocker (rings) · wrong result (ior)
- Repro: p22_fresnel_rings.js — add a Fresnel lens in the sidebar, type Rings N = 5000, Tab; then 1000000, Tab.
  p20_lens_params.js fuzzes every lens field with 0 / -10 / 1e6 and reports surfaces containing NaN/Infinity.
- Observed: rings 5000 → 10,001 surfaces, main thread blocked ~7 s. rings 1e6 → page blocked ~26 s, then
  `RangeError: Maximum call stack size exceeded at Object.buildAll (lenses.js:160:68) ← store.commit (controller.js:32)`;
  params.rings = 1,000,000 is stored and shown in the field while groups.L still has the 10,001 surfaces from before,
  and dirty L stays set (state desync). Index n = 0 gives NaN in the built surfaces for plano-convex (3/3),
  biconvex (3/3), TIR (50/67), Fresnel (23/25); biconvex f = 0 and TIR max side angle 0 also give NaN surfaces.
  No notice for any of these; NaN surfaces are silently not traced.
- Expected: clamp like the Mode C controls do (C.ior is clamped to 1..4 in controller.js; C.n to 1..400).
- Reproduced: rings 1 of 1 each value; NaN cases 1 of 1 each in the fuzz run.
- Suspected cause: js/panels.js:358 only rounds rings and checks isFinite; controller.js updateLens writes raw values.

### Two-finger pinch-zoom in the Paint editor leaves a paint dab (and an undo entry) where the first finger landed
- Severity: wrong result (touch/iPad users get stray paint every time they zoom)
- Repro: p23_pinch_paint.js — Chromium with hasTouch; Mode A, auto-solve off, paint cleared. CDP
  Input.dispatchTouchEvent: finger 0 down at the canvas centre, finger 1 down 40 ms later 40 px away, spread both
  60 px over 10 moves, lift both.
- Observed: zoom works (vLeft.s 2.56 → 10.22) but 8 paint cells are set (a brush-size-3 disc at finger 0) and the
  history grows 2 → 3 with a "Paint" entry.
- Expected: a gesture that becomes a pinch paints nothing (defer the first dab until the pointer moves / a short
  delay, or roll it back when the second finger arrives).
- Reproduced: 2 of 2.
- Suspected cause: js/input.js:31 calls onPrimaryStart on the first pointerdown → ui.js:998 paintAt immediately;
  input.js:36 then calls onPrimaryEnd(true) on the second finger, which commits it (ui.js:1000 afterChange).

### Brush "level" can only raise paint: painting level 0.3 over level 1 changes nothing (possibly intended)
- Severity: wrong result (if unintended) — flagging because nothing in the UI says the brush is max-only
- Repro: p24_brush_patterns.js — Mode A, paint a stroke at level 1 (176 cells = 1), set the Editor's level slider to
  0.3, paint the same stroke again.
- Observed: still {1: 176}; no cell takes 0.3. Lowering a region needs Erase first, then repaint.
- Expected (unclear): the brush sets the level it shows, or the tooltip says "raises to at least".
- Reproduced: 1 of 1 (deterministic).
- Cause (confirmed by reading): controller.js:229 `nv = … Math.max(sc.modeA.paint[k], b.strength)`.
- Ctrl-held erase works (176 → 82 after half a stroke).

