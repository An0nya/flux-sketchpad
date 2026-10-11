# Spec-mode QA findings (area: spec, port 8804)
HEAD: 2dc83f6 (verified). Driven with headless Chromium via /Users/anya/Projects/agent-qa/node_modules/playwright
(the global `npm root -g` has no playwright on this Mac; the brief's require line fails). Scripts: this dir, p*.js.
Default boot scene: Mode A design, preset ece-r112-b (aim by cut-off, Measure at 25 m), 500k rays.

### Footer tiles (pass/fail counts, 5 lx reach, goals, beam core) go stale after any judge-only change (Aim, Manual aim, Measure at, Kernel...)
- Severity: wrong result
- Repro: p2-manual.js, p3-stale-footer.js, p4-stale-wait.js. Boot, setMode('D'), wait for the judged run; then set Measurement → Aim = Manual and Manual aim R = 1 (or click Measure at ∞).
- Observed: the sidebar report and RF.UI.spec.ev update at once (e.g. "5 pass · 4 fail · 10 unsure"), the far field redraws, but the footer still says "4✓ 3✗ 12?" and "60 / 0 m 5 lx reach R / L" while RF.SpecUI.roadModel(ui).iihs.right is now 0 (manual 1° R) / 127 (manual 1R 0.5 down) / 50 (Measure at ∞). Still stale after 10 s; it refreshes only when something else triggers renderStats (a drag on the 3D scene fixed it). The footer tooltip "Measured at 25 m" also stays after switching to ∞.
- Expected: footer follows the report it summarises.
- Evidence: p2 output: report "6 pass · 3 fail · 10 unsure", footer "4✓ 3✗ 12?", reach tile 60 vs model 127. p4: report 5/4/10, footer 4/3/12 at +0.5 s, +3.5 s, +13.5 s; correct after a scene drag.
- Reproduced: 3 of 3 (manual aim twice, Measure at once)
- Suspected cause (confirmed by reading): js/spec-ui.js:128 `changed(ui, false)` does update + render + redrawSpec but never calls ui.rerenderStats() (roadChanged at :566 does). Every evalOnly control (sel/num with evalOnly=true, the Measure-at buttons) goes through it.

### Hover card shows absurd "headroom" factors for a max-limit read as 0 cd (e.g. "×674710416402.15 headroom")
- Severity: cosmetic
- Repro: p5-consist.js (boot, Spec mode, ece-r112-b default; RF.SpecUI.showCard for B50L / BR). In the UI: hover B50L on the far field.
- Observed: B50L card: "? needs ≤ 350 cd, read 0 ± 550 cd | unsure: ... · ×674710416402.15 headroom". BR: "×1000.00 headroom". The row is UNSURE yet the card claims 10^11 headroom.
- Expected: no factor (or "no light read") when the reading is 0 / the verdict is unsure; at least a capped, readable number.
- Reproduced: 1 of 1 (deterministic, rendering of a computed margin)
- Suspected cause: js/spec-ui.js:233 rowText: for margin ≥ 0 it prints 10^|margin| with no cap and no check for value ≤ 0 or verdict unsure (the report table hides `off` when margin ≥ 0, so only the card and the footer "worst" tile show it).
- Note: the numbers themselves agree everywhere I checked: for all 11 R112 test points the report value, the spot readout at the drawn marker and the hover card match exactly, and the marker sits at item + ev.shift (p5 output).

### Road numbers (5 lx reach, Road view, Drive view, beam quality, goals) change with "Measure at", a report-reading setting
- Severity: wrong result (design question; flagging, not judging the physics)
- Repro: p3-stale-footer.js. Boot, Spec mode (ece-r112-b defaults to Measure at 25 m). Read RF.SpecUI.roadModel(RF.UI).iihs; click Measure at ∞; read again; click 10 m; read again. Same trace, no re-solve.
- Observed: IIHS right-edge reach 60 m (25 m screen) → 50 m (∞) → 60 m (10 m screen). The road model, Drive picture, beam-quality and ideal-beam goals are all built from ui.spec.G, the grid at the report's measuring distance (apparent intensity on a 10 m / 25 m screen), not from the far field.
- Expected: a road lit at 10–250 m is computed from intensity by direction (the ∞ grid, which is always streamed: SpecUI.streams includes distance 0), so the reach should not move when you only change where the lab's report reads.
- Reproduced: 1 of 1 run, 3 distances
- Suspected cause: js/spec-ui.js:640-648 roadModel uses s.G / s.Gw from update(), which are built with RF.Spec.gridOpts(sc) at md.distance (spec-ui.js:27,32). Its cache key (:641) also omits the distance, but s is rebuilt per distance so that part is fine.

### An aim line above the horizon is labelled "° D" in the report and on the far field
- Severity: cosmetic (wrong label; the judging uses the right value)
- Repro: p6-aimline.js. Spec mode, Measurement → Aim line (° D) = -0.5 (the input allows -2…3, i.e. up to 2° U). modeD.aimLine becomes +0.5 (0.5° up).
- Observed: report "aimed: cut-off inflection at 1.15° put on 0.5° D"; far-field aim label "aim: beam 0.70° R, 0.50° D · cut-off on 0.5° D". The line is drawn in the right place; the words say D.
- Expected: "0.5° U".
- Reproduced: 1 of 1 (deterministic string code)
- Cause (read): js/spec.js:448 `Math.abs(line) + '° D'`; js/spec-ui.js:488 same `Math.abs(m.aimLine) + '° D'`.

### Drive-view settings in the sidebar render the Drive picture twice and rebuild the whole road model
- Severity: perf/memory
- Repro: p7-storms.js (counts per action), p8-drive-double.js (1280 px, forest). Spec mode → Result → Drive; Spec → Road → "Drive view: marking reflectivity" = 150 (same for ambient light, oncoming/preceding distance, smoothing, size, FOV).
- Observed: RF.Drive.render runs 2× per change (p7: 2× at 640 px; p8: 2× = 1537 ms at 1280 px forest, the change handler blocks the main thread 2047 ms). The road model + beam quality + ideal-beam check are also rebuilt (RF.Road.model, BeamQuality.measure 11–77 ms) though nothing they depend on changed. Same rebuild for Road-view-only settings (scale top, sideways stretch, p7) and ideal-beam knobs while on Drive (1 extra drive render: the drive cache lives on the road model, so rebuilding the model throws the picture away).
- Expected: one render; picture-only settings do not rebuild the road model.
- Reproduced: 2 of 2 runs (p7 at 640, p8 at 1280)
- Suspected cause (read, not instrumented line by line): js/spec-ui.js:570 rnum calls set() = setDV/setRV, which calls ui.redrawSpec() (draws synchronously at ui.js:1590 when a run exists) → render #1; then roadChanged (:566) sets ui.spec.road = null, redraws again → road model rebuilt → drive cache (rd.drive) gone → render #2.

### Measure at "target" is a one-time snapshot: move the target and the report keeps reading at the old distance, with no button lit
- Severity: broken UI
- Repro: p11-misc.js. Spec mode, click Measure at → target (target at 2 m: report "Measured at 2 m screen", "target" lit). Then change the target distance to 5 m (scene.target.distance = 5000 + invalidate + afterChange, i.e. what dragging the blue target handle does via C.actions.setTargetDistance) and wait for the re-solve and judgement.
- Observed: modeD.distance stays 2000; caption "Far field · 2 m screen"; ui.spec.G.distance 2000; NONE of the four Measure-at buttons is lit. "Compare distances" then lists ∞ / 25 m / 10 m / 5 m: the 2 m the report actually uses is not among them.
- Expected: "target" follows the target (store a sentinel, e.g. -1, and resolve it in gridOpts), or the UI says the report is at a custom 2 m.
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:78 stores `ui.store.scene.target.distance` (a number) instead of a "target" marker; :248 highlights "target" only when the numbers still match.

### Drive view "+" / "−" exposure buttons say "One stop brighter/darker" but move half a stop
- Severity: cosmetic
- Repro: p11-misc.js. Result → Drive, click "+".
- Observed: EV 1.0 → 1.5; display white 5.0 → 3.5 cd/m² (√2, half a stop). Title "One stop brighter".
- Expected: title "Half a stop brighter", or step 1.
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:848/850 step ±0.5 with titles 'One stop darker' / 'One stop brighter'.

### Manual aim: report says "no re-aim helps" although the re-aim box is never searched in Manual
- Severity: cosmetic (misleading wording)
- Repro: p14-manual-note.js. R112 B preset (re-aim box 0.5 L / 0.75 R / ±0.25), Measurement → Aim = Manual (0, 0).
- Observed: "aimed: manual: beam as designed · no re-aim helps". Switching to "As designed" with the same box gives "then re-aimed (beam) 0.75° right, 0.25° down (before: 5 fail)", so the box WOULD have helped; Manual skips it on purpose (spec.js:464 skipBox when aimMode === 'manual', and the Aim help text says so).
- Expected: "re-aim box not used (manual aim)" or nothing.
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:192 appends ' · no re-aim helps' whenever m.aimBox is set and reaim is zero, without checking aimMode === 'manual'. The same text would show for any judgement made with opts.noBox (a live, partial run's first judgement) — not reproduced, inferred from the code.

### Judge note prints the cut-off position without U / D ("inflection at 0.91° put on 0.4° D")
- Severity: cosmetic
- Repro: p13-fmvss-aim.js (FMVSS LB2V), p1 (R112: "cut-off inflection at 1.13° put on 0.57° D").
- Observed: the found inflection is +0.91° (above the horizon) but is printed bare next to "0.4° D", so it reads as 0.91° D; the far-field label then says "aim: beam 1.31° D", which looks inconsistent with "0.91 → 0.4" until you know the 0.91 is UP. A negative one would print as "-1.20°".
- Expected: "0.91° U".
- Reproduced: 2 of 2 presets
- Cause (read): js/spec.js:448 `b.v.toFixed(2) + '°'`.

#### Update to "Footer tiles go stale" (mechanism pinned down)
- p16-stale-matrix.js: the footer refreshes only incidentally, from the run loop's tick (js/ui.js:560: renderStats when > TRACE_UI_MS = 1000 ms since the last one). A judge-only change made within 1 s of the previous footer render stays stale until something else ticks. First edit right after a run: STALE (renderStats×0); edits 3 s apart: OK.
- p17-stale-quick.js: the realistic case, typing Manual aim R then tabbing to Manual up (300 ms apart): STALE 4 of 4 trials, e.g. report "5✓ 3✗ 11?" vs footer "5✓ 4✗ 10?", 5 lx reach model 130 m vs tile 148 m, still wrong 5 s later.
- Fix direction: changed(ui, false) should call ui.rerenderStats() like roadChanged does.

### Road "Aim on the car: Manual inclination" silently assumes the cut-off is at 0° whenever the judge did not aim by the cut-off
- Severity: wrong result
- Repro: p15-road-manual.js. R112 B, Spec → Road → Aim on the car = Manual, Inclination = -1 %. Then Measurement → Aim = cutoff / design / peak / manual.
- Observed: cutoff: ev.aim.cutV 1.13 → road shift V = 1.70 (cut-off put at 0.57° D) → 5 lx reach 59.5 m. design / peak / manual: ev.aim.cutV is undefined → road shift V = 0.573 (as if the cut-off were at 0°), while this beam's cut-off is at +1.13° (above the horizon) → right reach 0, farthest 118.5 m. Nothing in the UI says the cut-off position was not known.
- Expected: per the row's help text, "the cut-off (where the judge found it) is set at this downward slope": find the cut-off (the scan aimOf already does) or say "no cut-off found: inclination applied to the design's horizon".
- Reproduced: 1 of 1 run, 3 of 3 non-cutoff modes
- Cause (read): js/road.js:143 `cutV = isFinite(ev.aim.cutV) ? ev.aim.cutV : 0`; cutV is only set by aimOf in 'cutoff' mode (spec.js:449).

### Footer verdict tooltip rounds the measuring distance: "Measured at 18 m" while report and caption say 18.3 m (FMVSS)
- Severity: cosmetic
- Repro: p20-misc2.js. Load preset FMVSS LB2V (distance 18 300 mm), hover the footer's pass/fail tile.
- Observed: tile title "Measured at 18 m."; report "Measured at 18.3 m screen"; caption "Far field · 18.3 m screen".
- Expected: same 18.3 m everywhere (reuse fmtDist).
- Reproduced: 1 of 1
- Cause (read): js/panels.js:533 `Math.round(s.G.distance / 1000) + ' m'`.

### Ideal beam: "Hotspot centre H" input has min = 0, so the left side (negative H) is marked invalid / unreachable by the spinner
- Severity: cosmetic
- Repro: p20-misc2.js. Spec → Ideal beam → Hotspot centre H (°, + = own side): input.min = "0"; set -1 → checkValidity() false.
- Observed: the label and handler allow negative (spec-ui.js:632 keeps v as typed for hotH), but the input's min 0 blocks the spinner below 0 and flags -1 invalid.
- Expected: no min (or a negative one) for hotH.
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:632 gives every numeric IDEAL row `min: 0`.

### Road view: the IIHS "R/L edge 5 lx" markers sit off the drawn road edges whenever the lane width is not 3.3 m
- Severity: cosmetic (documented in the Road section note, but it reads as an error on the picture)
- Repro: p9-road.js + screenshot p9-road-fit.png. ECE preset, lane width auto (R112 reference = 4.4 m).
- Observed: the drawn right edge is at y = −2.2 m and the left edge at 6.6 m; the 5 lx markers are drawn at the IIHS edges y = −1.65 and 4.95 m (spec-ui.js:789, IIHS.lane = 3.3), i.e. 0.55 m and 1.65 m off the lines, ×3.9 on screen with the "fit" stretch. The readout at the marker confirms 5.4 lx at 60 m, 1.6 m right of lane centre, so the number is right; only the lines and markers disagree.
- Expected: draw the IIHS edges as well (e.g. a faint 6.6 m road) or put the markers' meaning in the label ("IIHS edge").
- Reproduced: 1 of 1 (deterministic)

### Out-of-range values typed into Spec inputs stay displayed; the judge silently uses the clamped value
- Severity: broken UI
- Repro: p21-clamp.js. Spec → Measurement → Aim = Manual; click "Manual aim R", type 9, press Enter (or Tab).
- Observed: field shows "9" (after Enter, and still after Tab moves focus to the next field); modeD.aimManual.h = 5; report "manual: beam 5° R". The field never corrects itself until some later full re-render.
- Expected: the field snaps to 5 (or shows why).
- Reproduced: 2 of 2 (Enter, Tab)
- Cause (read): js/spec-ui.js:246 render() skips the element that has focus (`if (document.activeElement === i) continue`); the change event fires while the edited input is still focused, so the clamped value is never written back. Applies to every clamped field built by num() (kernel 0.05–5, aim line, aim scan, re-aim, bin, solve-at...) and rnum() (mounting height, inclination...).

### Live report: "(held while the trace runs)" is appended again on every live re-judgement
- Severity: cosmetic
- Repro: p24-live.js. Spec mode, judged run; then sim.rays = 4 000 000 and RF.UI.requestRun(false) (any re-trace: Rebuild, a ray-count change). Read the report's "Measured at…" line every 250 ms.
- Observed: 32 %: "judged as designed (held while the trace runs)"; 51 %: "… (held while the trace runs) (held while the trace runs)"; 88 %: four copies.
- Expected: one.
- Reproduced: 1 of 1 (deterministic: one copy per live judgement)
- Cause (read): js/spec.js:465 note = fz.note + ' (held while the trace runs)', and spec-ui.js:31 passes the previous LIVE judgement's note (already suffixed) as fz.note.

### Live report holds an aim found on the first few % of rays for the whole trace; with this beam the whole live verdict is judged at the wrong aim
- Severity: wrong result (transient: the finished run is re-judged correctly)
- Repro: p24-live.js (same run as above, R112 B, aim by cut-off).
- Observed: the first live judgement (13 %, ~0.5 M rays) found "no clear cut-off at 2.5°: judged as designed"; that aim is then frozen and every live judgement to 88 % says "judged as designed (held…)" with 5–6 pass / 6–9 fail. The finished run finds "cut-off inflection at 1.22° put on 0.57° D, re-aimed 0.75° right" and 7 pass / 5 fail / 7 unsure. The footer tile followed the live numbers (6✓ 9✗ 4? at 71–88 %).
- Expected: the held aim is refreshed once enough rays exist (or a "no cut-off found" live aim is not frozen), so a minute-long 4 M-ray trace does not show a verdict for an aim the lab would not use.
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:30-31: once a live judgement exists with the same key, every later live judgement uses `frozen` = that first aim; the first is made with noBox on whatever rays exist at that moment (13 % here).
- Also: the live lines end in "· no re-aim helps" though the box was never searched (noBox / frozen) — same wording issue as the Manual-aim finding; confirmed here, not only inferred.

### Spec-mode footer "peak" comes from the target-plane grid, not the far field, and can read 2.3× the far-field peak (195 % of the brightness ceiling)
- Severity: wrong result
- Repro: p25-peak.js. Spec mode, default scene (target 2 m, 500 mm, 5 mm cells): compare the footer "peak" tile with the max of the far-field map. Then move the target to 25 m (same 500 mm size; re-solve) and compare again.
- Observed: target 2 m: footer 156 kcd; far field max 143 k (kernel 0.15°) / 159 k (0.0745°); colour-bar top 137 k; beam-quality peak 138 k — roughly agree. Target 25 m: footer **596 kcd**, tooltip "±40 % (shot noise) … 195 % of this design's brightness ceiling"; far field max 263 k (0.15°) / 297 k (0.05°); colour bar 249 k; beam-quality peak 256 k.
- Expected: in Spec mode the footer peak is the far-field peak the rest of the page uses (or at least is not a value above the design's physical ceiling). A 99.5th-percentile of 0.011° cells at 25 m is a max-of-noise estimate, biased upward.
- Reproduced: 1 of 1 (two target distances)
- Cause (read): js/photometry.js:72 fixture() → peakCd(): 99.5th percentile of target-grid cell energies ÷ cell area × d²; js/panels.js:560 shows it as "peak" in every mode including D. Note: "Fit target to spec" would enlarge the plane and the cells; I did not test that path.

### Ideal-beam goals and beam quality say "measured at the judged aim" but follow the Road's "Aim on the car" instead
- Severity: wrong result (label vs computation mismatch; small effect here)
- Repro: p27-ideal-aim.js. Spec → Road → Aim on the car = Manual, Inclination −1.5 %. The judge's aim is unchanged (ev.shift [0.25, 1.65]).
- Observed: road shift becomes [0, 1.989]; hotspot-top goal "top 2.5° D" → "top 2.75° D"; beam-quality peak position (−1.25°, −3.125°) → (−1°, −3.5°); beam core 8° × 3.8° → 8° × 3.6°. The Ideal-beam section note still says "goals measured at the judged aim"; the beam-quality tooltip says "at this aim".
- Expected: either measure goals / quality at the judge's aim as stated, or change the wording to "at the aim on the car (Spec → Road)".
- Reproduced: 1 of 1
- Cause (read): js/spec-ui.js:643-650 roadModel builds I with RF.Road.aimShift(road, ev) (road aim) and feeds that same I to BeamQuality.measure and IdealBeam.check.

## Already known: status in Spec views
- Collapse + reopen Result pane: NOT reproduced in Spec views (far field / road / drive all redrawn, same lit-pixel count before and after; p22-collapse.js, headless Chromium, dpr 1). Not checked in Paint mode (out of scope).
- Label overlap: present. At 1500×950 the Road and Drive toolbars cover the top ~third of the Result pane; the Road view's "L edge 5 lx" marker and the curves summary sit under them (p9-road-fit.png, p10-drive-*.png). Far-field test-point labels overlap near HV (p6-manual.png).

## Suspected (not reproduced)
- fmtDist (spec-ui.js:14) prints "1.50 m screen" for 1500 mm and "1.00e+3 m screen" for 1 000 000 mm (toPrecision(3), regex strips only ".0+"). From reading; I did not drive a target to those distances.
- The 5 lx reach tile turns fail-coloured when only glare is over 10 lx (panels.js:541 adds v-fail on glareOver) with no visible word saying why (only the tooltip). Seen in code; the one run with glare 11.1 lx (FMVSS, p12) did not capture the tile class.
- Rows with unit 'log' (cut-off sharpness max) print "×1.65 over", a ratio of log-steps, while the headroom branch deliberately suppresses × factors for log/deg units (spec-ui.js:233). Inconsistent wording; may be intended.

## Checked and consistent (no finding)
- Report row value = spot readout at the drawn marker = hover card, all 11 R112 points (p5). Markers at item + ev.shift; cut-off aim line drawn at line + shift = found inflection + re-aim (p6).
- Manual aim: ev.shift = −(R, up) exactly; label, note and road shift agree (p2, p6).
- Preset ECE R112 B → FMVSS LB2V via the real Load preset control: aim mode / line / per-point re-aim / kernel / distance / mount height 0.65 / lane 3.6 / IIHS tooltip / far-field aim label / caption all follow after the re-solve (p12).
- Road view: stretch 1 / fit (×3.9) / ×2 / ×4: caption, px-per-metre ratio = k, tap readout at the R-edge marker = 5.4 lx at the stated distance, 4.5 lx 1 m past it (p9); bends 250/150 R/L same (p23).
- Drive: all 4 scenes × 5 road shapes render, captions right, no console errors; LHT flips the picture (p10, p18).
- No recompute on far-field zoom, toggles, hover, or road-outline toggles (p7). Bin change re-traces once and recovers (p19). Compare distances at 25 m equals the report at 25 m (p20).
