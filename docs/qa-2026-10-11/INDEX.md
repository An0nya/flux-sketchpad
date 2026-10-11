# Finding index (tags assigned by script; cite tags, never retype titles)
L01  [layout] Editor header mode tabs (Paint/Stamp/Profile/Spec) are clipped at 1280 and 768 widths; Spec unreachable there
L02  [layout] [KNOWN, still present + root cause] Editor/Result map goes blank after collapse→reopen — only if it was zoomed/panned first
L03  [layout] Phone: zooming the Editor map, switching to another tab and back leaves the Editor map blank (same NaN view as above)
L04  [layout] Expanding the Editor (or Result) pane makes its map SMALLER at 1500x950
L05  [layout] Divider limits let the Editor/Result maps shrink to nothing (0 px or a 22 px thumbnail)
L06  [layout] Dragging any divider while a pane is expanded makes the OTHER split jump (Scene column jumps ~234 px)
L07  [layout] During a solve the footer grows 45 px and every pane shrinks (maps resize/refit twice per solve); header buttons shift too
L08  [layout] Disabled ("off") dividers stay in the Tab order and still change the layout from the keyboard
L09  [layout] Layout chrome exposes no state to assistive tech (collapse, pane tabs, view radios, separators)
L10  [layout] Stamp mode (B): Editor direction picker never draws — ReferenceError `clearZero is not defined` on every draw
L11  [layout] Spec mode at 1280x720: Result view shrinks to a 38–54 px strip; Drive/Road toolbars overflow it and the pane
L12  [layout] Spec far-field toggles run past the Result pane (1280) and off the viewport (768)
L13  [layout] "Reset zoom (or double-click)" on the Paint map also paints — the double-click adds a brush dab + an undo step
L14  [layout] Optics has no zoom/view reset of its own; double-click does nothing there
L15  [layout] Narrowing the window (or rotating a tablet) to ≤1024 px leaves the sidebar open as an overlay covering the panes
L16  [layout] 1280x720: expanding Optics shrinks both maps to ~20 px thumbnails, and the selection chip then covers the whole Result map
L17  [layout] Editor and Result maps are the same size but not aligned (Result square sits 24–36 px lower)
C01  [controls] A corrupt autosave bricks the app permanently (boot error on every reload, no way out in the UI)
C02  [controls] Bad JSON in the autosave is discarded silently
C03  [controls] Corrupt flux/solvers key throws an uncaught "saved is not iterable" on every load
C04  [controls] target.res = 0 in a saved scene throws IndexSizeError (createImageData) on every frame-draw
C05  [controls] Default scene shows "NaN%" in Details → Goal check (hot zone row)
C06  [controls] Large target distance freezes the tab (main thread stuck in paint-fidelity blur)
C07  [controls] Stamp mode: direction picker (Editor pane) is blank — ReferenceError: clearZero is not defined
C08  [controls] Point source: brightness ceiling reads "Infinity Mcd" and "0% · —"
C09  [controls] Profile mode, focal length 0.01 mm (the control's own minimum): occlusion "126.3% blocked", "worst C21 Infinity%"
C10  [controls] Number controls have no upper bound where physics needs one; extreme values are stored and shown verbatim
C11  [controls] Rejected text stays in a number field; the next arrow key then jumps the value from 0
C12  [controls] Undo is enabled right after load: the boot solve records an "Edit" entry
C13  [controls] Halogen bulb → "Measured" emitter leaves an impossible planar + cylinder source with the bulb's lumens and voltage
C14  [controls] Emitter presets are order-dependent: drive current and flux model carry over from the previous emitter
C15  [controls] Drive current field keeps rejected values (0, −1) on screen
C16  [controls] Shrinking the dome radius leaves the dome centre outside its own range (z > r)
C17  [controls] "Open from disk" with a bad scene file says "Could not load" but half-loads it, autosaves it, and bricks the next reload
C18  [controls] Opening the Spec tab writes a default into the scene intent (modeD.road), outside any undo entry
F01  [lifecycle] Requesting a solve while the solver worker is being rebuilt hangs every worker solve until page reload
F02  [lifecycle] A solve's result is applied as "up to date" after you changed a setting mid-solve (store.version never increments)
F03  [lifecycle] Switching to a built-in solver mid-solve does not stop the running worker solve (UI says "Solving" another solver, preview overlays the new design)
F04  [lifecycle] A superseded worker solve leaves ui.pendingA set, so the next settings change auto-solves even with "Auto-solve on settings" off
F05  [lifecycle] Mode B direction picker throws `ReferenceError: clearZero is not defined`; the exception kills the render loop, so a trace stalls mid-way
F06  [lifecycle] Loading a preset (or any ui.loadScene) mid-solve keeps the old scene's solve running and overlays its preview on the new scene
F07  [lifecycle] After Stop (or timeout / crash) the kept old design is reported "up to date" although the painting changed
F08  [lifecycle] Refine button stays enabled during a solve and silently does nothing when clicked
F09  [lifecycle] After a solver worker crash, every later worker solve fails with "solver X is not loaded in the worker" (until page reload); the crashed worker is leaked
F10  [lifecycle] A solver error replaces the report of the kept design: report says 0 placed while the old design (100 surfaces) is still shown
F11  [lifecycle] Pressing Rebuild while the bundled solvers are still loading silently switches the scene's solver to the built-in Spoke
F12  [lifecycle] Switching to Stamp/Profile mode mid-solve keeps the Paint solve's status, Stop button and (in Stamp) its PREVIEW overlay
F13  [lifecycle] Turning Watch off mid-solve hides the badges but leaves the footer frozen on an old candidate's PREVIEW numbers
F14  [lifecycle] Loading a solver file while a solve runs: the load fails and the running solve hangs forever (the time budget can't stop it)
S01  [spec] Footer tiles (pass/fail counts, 5 lx reach, goals, beam core) go stale after any judge-only change (Aim, Manual aim, Measure at, Kernel...)
S02  [spec] Hover card shows absurd "headroom" factors for a max-limit read as 0 cd (e.g. "×674710416402.15 headroom")
S03  [spec] Road numbers (5 lx reach, Road view, Drive view, beam quality, goals) change with "Measure at", a report-reading setting
S04  [spec] An aim line above the horizon is labelled "° D" in the report and on the far field
S05  [spec] Drive-view settings in the sidebar render the Drive picture twice and rebuild the whole road model
S06  [spec] Measure at "target" is a one-time snapshot: move the target and the report keeps reading at the old distance, with no button lit
S07  [spec] Drive view "+" / "−" exposure buttons say "One stop brighter/darker" but move half a stop
S08  [spec] Manual aim: report says "no re-aim helps" although the re-aim box is never searched in Manual
S09  [spec] Judge note prints the cut-off position without U / D ("inflection at 0.91° put on 0.4° D")
S10  [spec] Road "Aim on the car: Manual inclination" silently assumes the cut-off is at 0° whenever the judge did not aim by the cut-off
S11  [spec] Footer verdict tooltip rounds the measuring distance: "Measured at 18 m" while report and caption say 18.3 m (FMVSS)
S12  [spec] Ideal beam: "Hotspot centre H" input has min = 0, so the left side (negative H) is marked invalid / unreachable by the spinner
S13  [spec] Road view: the IIHS "R/L edge 5 lx" markers sit off the drawn road edges whenever the lane width is not 3.3 m
S14  [spec] Out-of-range values typed into Spec inputs stay displayed; the judge silently uses the clamped value
S15  [spec] Live report: "(held while the trace runs)" is appended again on every live re-judgement
S16  [spec] Live report holds an aim found on the first few % of rays for the whole trace; with this beam the whole live verdict is judged at the wrong aim
S17  [spec] Spec-mode footer "peak" comes from the target-plane grid, not the far field, and can read 2.3× the far-field peak (195 % of the brightness ceiling)
S18  [spec] Ideal-beam goals and beam quality say "measured at the judged aim" but follow the Road's "Aim on the car" instead
E01  [editing] Fast paint strokes leave dotted gaps (no interpolation between pointer samples)
E02  [editing] Undo/Redo in Paint mode deletes the current reflector; Stop then leaves an empty scene that claims "previous design is kept"
E03  [editing] Stamp mode: direction picker never draws — ReferenceError `clearZero is not defined` every frame
E04  [editing] Stamps can be dragged off the target (no clamp on move); tap-to-place refuses the same spot
E05  [editing] Knock-on of the picker crash: in Stamp mode the trace stalls part-way and never finishes
E06  [editing] Undo gets stuck after one step in Profile mode (each Undo pushes a fresh "Edit" entry and undoes it again)
E07  [editing] Envelope face can be dragged through the opposite face; envelope collapses to ~zero thickness
E08  [editing] Source can be dragged out of the envelope (no clamp, no warning in the drag)
E09  [editing] Target-distance handle drags the target to 0.000001 mm, through the reflector; the limits panel says "No design issues"
E10  [editing] "clear" on the Mode A reflector group can't be undone and doesn't stick; footer keeps the old facet count
E11  [editing] No zoom limits in the 3D views: after a long zoom-out a 6 px handle drag throws the source 1e39 mm away
E12  [editing] Selected facet that disappears after a re-solve: TypeError in zoneOverlay, status frozen at "Solving … 95%"
E13  [editing] After a paint stroke, the Result and every footer stat stay a 1,500-ray preview forever (never refines to the full trace)
E14  [editing] Lens "Distance from source": clearing the field stores NaN; the field then shows 20 and the lens silently drops out
E15  [editing] Lens fields are unclamped: Fresnel "Rings N" freezes the page / overflows the stack; Index n = 0 builds NaN geometry
E16  [editing] Two-finger pinch-zoom in the Paint editor leaves a paint dab (and an undo entry) where the first finger landed
E17  [editing] Brush "level" can only raise paint: painting level 0.3 over level 1 changes nothing (possibly intended)
M01  [memory] Mode B direction picker throws ReferenceError and never draws (Editor pane blank in Stamp mode)
M02  [memory] README claims "never uses fetch, XHR, workers" and "No server needed"; the code uses all three, and file:// silently loses 35 of 37 solvers
M03  [memory] Idle page never goes idle: the first-load Optics turntable redraws every frame until the user drags the Optics view
M04  [memory] RF.Modes.geometry caches every distinct painting forever (unbounded Map)
