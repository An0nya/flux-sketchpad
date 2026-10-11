# QA findings — area: controls (port 8802)
Header: HEAD = 2dc83f6 (matches). Playwright is not installed globally on this Mac (`npm root -g` has no playwright);
used /Users/anya/Projects/agent-qa/node_modules/playwright instead (see h.js). Chromium headless.

### A corrupt autosave bricks the app permanently (boot error on every reload, no way out in the UI)
- Severity: crash/blocker
- Repro: probe3_corrupt.js. Set localStorage['faceted-reflector-demo/scene/v1'] to any of these, then load index.html:
  `{"mode":"Z"}` · `{"modeB":{"stamps":null}}` · `{"lenses":{}}` · `{"envelope":{"half":null}}` · `{"groups":{"A":{"surfaces":[{"type":"facet"}]}}}`
- Observed: #boot-error shows "The app failed to start: Cannot read properties of undefined (reading '0')" (or
  "scene.modeB.stamps is not iterable" / "scene.lenses is not iterable" / "Cannot read properties of null (reading '0')").
  Reloading gives the same error every time: the bad key is never cleared, and the error text suggests nothing
  (it talks about file:// instead). Only fix is DevTools → clear localStorage.
- Expected: a scene that fails to load falls back to defaults (and keeps the bad copy aside / tells the user).
- Evidence: probe3_corrupt.out lines 5, 12-15 ("after2":"BOOT-ERROR" = still broken after a second reload).
- Reproduced: 5 of 5 payloads, each 2 of 2 loads.
- Suspected cause: state.js:98-115 deserialize() only merges defaults by key; it never validates types/enums
  (mode ∈ A-D, arrays are arrays, surfaces well-formed). loadLocal's try/catch (state.js:119) covers deserialize only;
  the crash happens later in ui.js boot() → loadScene/setMode (e.g. ui.js setMode `cap[m]` undefined for mode 'Z'),
  which safeBoot() catches only to print the message (ui.js ~1780). Confirmed for mode 'Z' by reading; others are guesses.

### Bad JSON in the autosave is discarded silently
- Severity: broken UI (data loss, quiet)
- Repro: probe3_corrupt.js case "not JSON": localStorage scene key = `{garbage`, load.
- Observed: app boots with the default scene, no notice; the next autosave (800 ms after any edit) overwrites the
  unreadable copy, so whatever was salvageable is gone. Same for JSON `null` / `42`.
- Expected: a notice ("could not restore your last scene") and the raw text kept aside.
- Reproduced: 3 of 3 payloads.
- Suspected cause: state.js:119-125 loadLocal returns null on any exception; boot() treats null as "nothing saved".

### Corrupt flux/solvers key throws an uncaught "saved is not iterable" on every load
- Severity: broken UI (see Suspected section for impact)
- Repro: probe3_corrupt.js case "flux/solvers junk": localStorage['flux/solvers'] = '{"a":1}', load.
- Observed: two PAGEERROR "TypeError: saved is not iterable" at boot; app otherwise boots.
- Expected: non-array value treated as empty.
- Reproduced: 1 of 1 (two errors per load).
- Suspected cause: solver-host.js:98 `JSON.parse(... || '[]')` — the try/catch only covers the parse; a valid
  non-array JSON passes and the later for-of throws.

### target.res = 0 in a saved scene throws IndexSizeError (createImageData) on every frame-draw
- Severity: broken UI
- Repro: probe3_corrupt.js case "target.res 0": scene key = `{"target":{"res":0}}`, load.
- Observed: PAGEERROR "IndexSizeError: Failed to execute 'createImageData' ... source width is zero" (repeated).
- Expected: res clamped to the control's 10–200 range on load (the UI control clamps, the loader doesn't).
- Reproduced: 1 of 1.

### Default scene shows "NaN%" in Details → Goal check (hot zone row)
- Severity: wrong result (display)
- Repro: probe4_nan_baseline.js — fresh browser, load index.html, wait for the boot solve (Auto) and the 500k-ray trace,
  open Details. No settings touched.
- Observed: Goal check row "124 kcd · NaN%" labelled "hot zone: mean intensity · of the most this light could give it".
  Also appears after tgt.dist 1e6 / tgt.size 1 / env.hx 1e-6 changes (probe2b_a.out, probe2 output).
- Expected: a percentage, or "—" when it can't be computed (the neighbouring f2() helper already maps non-finite to "—").
- Evidence: nan-baseline.png; probe4 output `{"tag":"B","text":"124 kcd · NaN%"}`.
- Reproduced: 3 of 3 loads (probe2 baseline, probe2b baseline, probe4).
- Suspected cause: modes.js:118 returns ofPossible = NaN when `possible` is not > 0 (row.capturable missing/0 →
  fluxPk = NaN); panels.js:427 `pct()` only guards null/undefined, not NaN. Why capturable is missing for the
  default scene: not investigated.

### Large target distance freezes the tab (main thread stuck in paint-fidelity blur)
- Severity: crash/blocker (tab unresponsive)
- Repro: probe2b.js / probe5_hangstack.js — in Mode A, type 1e10 into Target distance (mm) (any value ≳1e9; same via
  `RF.UI.setControl('tgt.dist', 1e10)`). The field accepts it: the control has min 1 and no max.
- Observed: page.evaluate never returns (> 60 s); 1e8 already takes 18.6 s. CDP pause, 3 of 3 samples:
  `pass @ photometry.js:185 ← boxBlur :190 ← fidelity :206 ← renderStats ui.js:599 ← tick ui.js:560`.
  Reloading recovers only because autosave (800 ms debounce) had not fired yet (probe6: nothing saved, 2nd load fine);
  edits made in the same 800 ms window before the freeze are lost.
- Expected: a max on the control, and/or boxBlur cost independent of kernel width.
- Evidence: probe2b_dist.out (1e8 18.6 s, 1e10 HANG, 1e12 HANG), probe5_tgtdist.out (stacks).
- Reproduced: 4 of 4 (1e10 ×2, 1e12 ×2).
- Suspected cause (confirmed by stack, fix is a guess): photometry.js:184 inner loop runs q from floor(a0) to
  ceil(b0) — the full kernel width w — and only `continue`s when q is off-grid; w (achievableKernel cells) scales with
  distance, so cost is O(R²·w). Clamping q to [0, R) bounds it.

### Stamp mode: direction picker (Editor pane) is blank — ReferenceError: clearZero is not defined
- Severity: broken UI (Mode B's second picker unusable)
- Repro: probe8_modeB.js — fresh load, click the Stamp tab.
- Observed: PAGEERROR "ReferenceError: clearZero is not defined"; Editor pane shows only its caption, no polar map
  (modeB-picker.png). Also fires on every preset chain that passes through Stamp mode (probe7.out).
- Expected: the polar direction map.
- Reproduced: 4 of 4 (probe8 + 3 preset chains).
- Suspected cause (confirmed by reading): render2d.js:128 in pickerImage() uses `clearZero && !(v > 0)` — both names
  exist only in gridCanvas() (line 55/65); a copy-paste of line 65. Present in HEAD (last touched b62f069).

### Point source: brightness ceiling reads "Infinity Mcd" and "0% · —"
- Severity: wrong result (display)
- Repro: probe9_inf_text.js — Mode A, Source type = Point (setControl('src.kind','point')), let the trace finish, Details.
- Observed: "0% · — of the brightness ceiling: this design (Infinity Mcd) · any design in this envelope (Infinity Mcd)".
- Expected: the ceiling row hidden or "n/a for a point source" (a point source has no area, so luminance is ∞).
- Evidence: inf-point-source.png, probe9.out.
- Reproduced: 2 of 2 (probe2b sweep, probe9).

### Profile mode, focal length 0.01 mm (the control's own minimum): occlusion "126.3% blocked", "worst C21 Infinity%"
- Severity: wrong result (display)
- Repro: probe9_inf_text.js — Mode C (default parabola preset), set Focal length to 0.01 (min of C.f), trace, Details.
- Observed: "126.3% · 6.2% occlusion: blocked (... worst C21 Infinity%, C25 211%)". A blocked share over 100% and a
  per-surface Infinity%.
- Expected: shares within 0–100%, non-finite shown as "—".
- Evidence: inf-profile-f001.png, probe9.out.
- Reproduced: 2 of 2.
- Suspected cause: not located (per-surface share divides by that surface's own incoming light, which can be ~0). Guess.

### Number controls have no upper bound where physics needs one; extreme values are stored and shown verbatim
- Severity: broken UI
- Repro: probe1_typed.js — type into the text fields (change event, the UI's own path). Values below are what got stored.
- Observed: no max on Target distance (1e300 accepted; ≥1e9 freezes the tab, see above), Target width, envelope
  half-sizes/centre, source position/width/height/radius/length, Dome radius (1e9 mm dome accepted), Power (1e300 →
  stats print "Infinity rays/cell" and "6.4e+295 Mcd"), Roll (±1e9 °), Min facet distance, Profile f/rim/depth/a1/length.
  Profile rim 1e300 writes Infinity into scene.modeC.profile (saved as null in JSON). Seed 1e300 silently becomes 0
  (`Math.round(v) | 0`), seed 3e9 wraps to a negative. Power typed as 0 or negative is stored as 1e-9 but displayed "0".
- Expected: sane ranges per control (e.g. distance ≤ 1e6 mm), integer-safe seed.
- Evidence: probe1_typed.json (every control × 12 values), probe2b_sweep.out.
- Reproduced: deterministic, 1 run of the full table.
- Suspected cause: controller.js CONTROLS rows use `num(...)` defaults min −∞ / max +∞; panels.js:61 clamp only applies
  finite bounds.

### Rejected text stays in a number field; the next arrow key then jumps the value from 0
- Severity: wrong result (silent value change)
- Repro: probe10_history.js, probe11_edit_entry.js — Facet budget field: type `abc` + Enter (or clear it + Tab), then ArrowUp.
- Observed: the store keeps 101 but the field keeps showing "abc" (or blank); the slider still shows 101. ArrowUp then reads
  parseFloat('abc')||0 = 0 and commits 1 (clamped min). In probe10, 5×ArrowUp after a blank field turned 200 into 5,
  recorded as undo entry "Facet budget 200 → 5". A clean field + ArrowUp gives 101 → 102 as expected.
- Expected: invalid input reverts the field to the stored value on change/blur; arrows step from the stored value.
- Evidence: probe11.out ("after abc: store 101 field abc" / "ArrowUp after abc: store 1"), probe10.out.
- Reproduced: 2 of 2.
- Suspected cause: panels.js:65 commitTyped returns without resetting field.value when !isFinite; panels.js:70 arrow handler
  takes v0 from the field text, not c.get(store).

### Undo is enabled right after load: the boot solve records an "Edit" entry
- Severity: broken UI
- Repro: probe11_edit_entry.js / probe10 — fresh load, wait for the boot solve, look at the Undo button.
- Observed: Undo enabled with label "Edit"; the entry's only change is `.solve: undefined → {id:"auto",...}` and
  `.solverSettings: undefined → {}`. Clicking Undo starts a new solve (RF.UI.solving true) and changes nothing visible.
- Expected: nothing to undo on a fresh load (solver metadata written by a solve is derived, not intent).
- Reproduced: 2 of 2 loads.
- Suspected cause: history.js:318 intent() keeps scene.solve (written by applySolve, controller.js applySolve `sc.solve = r.meta`)
  and solverSettings; the first post-solve autosave checkpoints it against the pre-solve base set in ui.js boot().

### Halogen bulb → "Measured" emitter leaves an impossible planar + cylinder source with the bulb's lumens and voltage
- Severity: wrong result
- Repro: probe13_halogen_measured.js — Emitter select: pick HB4 (halogen), then pick the measured/custom emitter
  (value "measured") before pasting any rows.
- Observed: source = {kind:"planar", shape:"cylinder", power:1095, volts:13.2, emission:"surface"}; the Shape select shows
  "cylinder", an option the control's own optionFilter hides for planar sources. The trace runs with it (no error).
  The 1095 lm is the HB4's 13.2 V flux, not anything the user entered.
- Expected: switching to a planar emitter resets shape to rect/disc; volts deleted; power not inherited from a bulb.
- Evidence: probe13.out, halogen-to-measured.png; also seen in the probe12 sweep ("hb4 → measured shape: cylinder").
- Reproduced: 2 of 2.
- Suspected cause (read, confirmed by the observed state): source-presets.js apply(): `if (p.custom && !src.shape)` only
  sets a shape when none exists, and `if (!m) return p;` (measured before any rows) returns before the
  `else delete src.volts` line, so the halogen's shape/volts/power survive.

### Emitter presets are order-dependent: drive current and flux model carry over from the previous emitter
- Severity: wrong result (possibly by design; flagging because the preset label quotes a different number)
- Repro: probe13 / probe12 — pick Kyocera LaserLight SMD1000 (2.5 A), then Luminus SFT-70 3000 K.
- Observed: SFT-70 lands at 2.5 A → 1118 lm, die 2.6525 mm; picked after the default emitter it lands at 6 A → 2030 lm,
  die 2.6052 mm. Similarly the flux model name carries if the new part has one with the same key: picking SFT-40 3000 K
  after a koef3-measured part gives fluxModel "koef3", w 2.0674, effArea 4.274; after the generic LED it gives
  "datasheet", w 1.97. 231 of ~730 sampled preset pairs differed from the same preset applied after the default
  (most of them via driveA; the halogen ones only via unused w/h/length, harmless).
- Expected: either each preset opens at its own default drive, or the carried-over current is stated in the UI.
- Evidence: probe12.out (LEAK lines), probe13.out.
- Reproduced: deterministic across the sweep.
- Suspected cause: source-presets.js apply() `src.driveA > 0 ? Math.min(m.maxA, src.driveA) : default` and
  `p.drive.models[src.fluxModel] ? src.fluxModel : p.drive.model`.

### Drive current field keeps rejected values (0, −1) on screen
- Severity: cosmetic
- Repro: probe12_emitters.js — Nichia 519A domed, Drive current field: type 0 (or −1) + Enter.
- Observed: store keeps 5 A / 1265 lm, field shows "0" / "-1".
- Reproduced: 2 of 2. Cause: panels.js:282 ignores v ≤ 0 without re-rendering.

### Shrinking the dome radius leaves the dome centre outside its own range (z > r)
- Severity: wrong result
- Repro: probe14_dome.js — Dome radius 3, Dome centre above die 2.85 (max allowed = 0.95 r), then Dome radius 0.5.
- Observed: dome {r:0.5, z:2.85, n:1.53}: the centre sits 5.7 radii above the die, which the Dome centre control
  itself would clamp to ±0.475. Traced (50k rays, design unchanged) it gives 0.1% on paint / 90.6% spill, vs 7.5% / 26.5%
  for the legal z = 0.475 and 18.8% / 10.4% for z = 0 (probe14b). Also no check that the dome covers the die
  (r 0.5 over a 2 × 2 mm die is accepted).
- Expected: changing r re-clamps z (and arguably r ≥ die half-diagonal).
- Evidence: probe14.out.
- Reproduced: 2 of 2.
- Suspected cause: controller.js src.domeR setter merges `{ r: v }` without re-clamping z; only the src.domeZ setter clamps.

### "Open from disk" with a bad scene file says "Could not load" but half-loads it, autosaves it, and bricks the next reload
- Severity: crash/blocker
- Repro: probe15_io.js, probe15b_upload_brick.js — Open from disk → files/modeZ.json (`{"mode":"Z"}`); touch any control;
  reload. Also files/lensesobj.json (`{"lenses":{}}`).
- Observed: modeZ: notice "Could not load modeZ.json: Cannot read properties of undefined (reading '0')", yet
  RF.UI.store.scene.mode is "Z", no mode tab is selected, and the next edit autosaves mode "Z" to localStorage; reload →
  boot error (same brick as the corrupt-autosave finding). lensesobj: notice "Could not load…", but the store keeps the
  broken scene and every later control edit throws "scene.lenses is not iterable" (PAGEERROR) until Reset.
  Also `[1,2]` loads as "Loaded array.json" (an array silently becomes the default scene).
- Expected: a failed load leaves the previous scene in place.
- Evidence: probe15.out, probe15b.out, upload-modeZ-reload.png.
- Reproduced: modeZ 2 of 2, lensesobj 1 of 1.
- Suspected cause: panels.js:680-686 upload(): deserialize succeeds (no validation), then ui.loadScene() (ui.js:122)
  assigns ui.store = createStore(scene) as its first line, so when a later step throws, the catch only posts a notice and
  the broken store stays live.
- Note: Save to disk → Open from disk round-trips the intent exactly (probe15: equal keys, budget/dome/aim restored). Works.

### Opening the Spec tab writes a default into the scene intent (modeD.road), outside any undo entry
- Severity: cosmetic
- Repro: probe16b.js — fresh load, click Stamp, Profile, Spec, Paint tabs.
- Observed: intent gains `.modeD.road: undefined → {v:2, lane:"auto", ...}`; no undo entry is made, so the next real
  edit's entry carries it along. All 24 tab orders change intent the same way (probe16.out); mode always ends correct.
- Expected: lazily created defaults live in defaults(), not written on view.
- Reproduced: 24 of 24 orders.

## Other checks run, no bug found
- Scene presets: 3 orders × 12 presets (forward, reverse, shuffled, starting from an edited Spec-mode scene): every preset
  matches the same preset on a fresh page except modeD item ids (a global counter) and the far-field view only opening on
  the first Spec visit per session (by design per ui.js setMode). No setting leaks. (probe7.out, probe7b.out)
- Undo/redo of typed values, preset loads (incl. mode restore), snapshot restore, Ctrl+Z / Ctrl+Shift+Z on body,
  arrow-key coalescing (5 presses → 1 entry): correct (probe10.out, probe16.out).
- Paint stroke undo and Profile preset undo: restored exactly in my simple cases (paint sum 593.2 → 638.2 → 593.2;
  profile 0 pts → 2 → 0). The other agent's Paint/Profile undo bugs were NOT reproduced by these cases (not re-investigated).
- URL/hash state: none exists (no location.hash / search / pushState in js/ or index.html).
- Save to disk → Open from disk: exact intent round trip.
- Snapshot Save → edit → Restore (two-step confirm): restored, labelled "Restore snapshot" in undo.
- Corrupt UI-pref keys (flux/layout, flux/ffView, flux/patterns, flux/rayPaths, flux/solverChoice, flux/autoSolve): app boots.
- Mode D (Spec) with power 1e-9, distance 1, envelope 1e-6: no NaN/Infinity text.

## Suspected (not reproduced)
- `parseFloat` leniency: "5abc" commits 5 and "3.7" commits 4 to integer controls silently (seen in probe1, judged
  intended rounding, not filed).
- Corrupt flux/solvers key ("saved is not iterable"): may also block RF.SolverHost.restore()'s .then, so a saved solver
  choice would not be honoured on that load. Did not verify the solve/choice effect.
- tgt.size = 1 mm and other tiny-target values may hit the same boxBlur slowdown as large distance (kernel in cells grows);
  tgt.size 1 completed fast in my run, so unconfirmed.
