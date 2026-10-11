# QA findings — area: layout (port 8801)
HEAD: 2dc83f6 (verified). Driver: headless Chromium via Playwright. NOTE: `npm root -g` has no playwright on this Mac
(the BRIEF's require line throws MODULE_NOT_FOUND); used /Users/anya/Projects/agent-qa/node_modules/playwright read-only.
Scripts: $QA/layout/*.js, shared helpers in lib.js. Screenshots: $QA/layout/shots/.

### Editor header mode tabs (Paint/Stamp/Profile/Spec) are clipped at 1280 and 768 widths; Spec unreachable there
- Severity: broken UI
- Repro: node 01-baseline.js (fresh context, default layout) at 1280x720 and 768x1024
- Observed: the `.modes.seg` nav in the Editor pane head doesn't wrap; it runs past the pane's right edge and is clipped by `.pane{overflow:hidden}`.
  1280: Spec button sticks out 20 px (shows "Spe"); 768: Profile is cut and Spec is fully outside (75 px past). At 768 the sidebar
  (the other copy of the mode tabs) is hidden by default, so Spec mode can't be reached without opening the sidebar.
  Expected: tabs wrap / shrink like the Result view buttons (#heat-display has flex-wrap:wrap; .modes.seg has none).
- Evidence: shots/base-1280.png, shots/base-768.png; overflow probe: "editor: D Spec r20" (1280), "editor: D Spec r75", "C Profile r17" (768)
- Reproduced: 2 of 2 viewports (deterministic)
- Suspected cause (guess): css/app.css `.seg { display:inline-flex }` with no flex-wrap for `.pane-head .modes`; the `#heat-display { flex-wrap: wrap }` fix (~line 457) was only applied to Result.

### [KNOWN, still present + root cause] Editor/Result map goes blank after collapse→reopen — only if it was zoomed/panned first
- Severity: broken UI
- Repro: node 06-zoom-collapse.js — wheel-zoom the Editor (or Result) map, collapse that pane, reopen it.
  Without a prior zoom/pan, collapse→reopen draws fine (02-collapse.js: all 4 panes and 4 combos restore with identical pixel coverage).
- Observed: after reopen the canvas is fully blank (non-background pixel fraction 0 vs 0.80 before). View state: `s: NaN, ox: NaN, oy: NaN, fitS: 2.556, zoomed: true`.
  Reset zoom (⌖) restores it (0.7998). Same for Result (heat-canvas).
- Evidence: shots/zc-editor-2reopened.png, shots/zc-result-2reopened.png; 06 output: collapsed `{"s":null,"fitS":0,"w":0,"h":0,"zoomed":true}`
- Reproduced: 2 of 2 (Editor, Result)
- Suspected cause (confirmed by the numbers above): render2d.js prepare2d (~line 37) runs while the canvas is 0×0; because `view.zoomed`, it calls
  `refitKeep` (~line 27): `fit()` at w=h=0 sets `fitS = 0`, then `this.s = this.fitS * f` = 0 and the stored centre comes from `toContent` dividing by s=0.
  On reopen `f = s/fitS = 0/0 = NaN` → NaN offsets forever. Fix direction: skip prepare/draw (or refitKeep) when box.w or box.h is 0.

### Phone: zooming the Editor map, switching to another tab and back leaves the Editor map blank (same NaN view as above)
- Severity: broken UI
- Repro: node 07-phone-tabs.js (375x812, isMobile+touch): pinch-zoom the Editor map (CDP two-finger touch), tap the Result tab, tap Editor tab.
- Observed: Editor canvas fully blank (nonbg 0 vs 0.70 zoomed); `RF.UI.vLeft.s` = NaN. On a phone every tab switch hides the other panes
  (display:none → 0×0 canvas), so ANY zoom/pan on a map followed by a tab switch triggers it — much easier to hit than the desktop collapse path.
- Evidence: shots/phone-1pinched.png (map visible), shots/phone-3editor-back.png (blank square, chrome intact)
- Reproduced: 1 of 1 (deterministic mechanism; same as the collapse finding)
- Suspected cause: same as above — render2d.js refitKeep at 0×0 (`vLeft.s` went 11.6 → 0 while hidden → NaN on return).

### Expanding the Editor (or Result) pane makes its map SMALLER at 1500x950
- Severity: broken UI
- Repro: node 11-expand-mapsize.js — default layout, click ⤢ on Editor (then on Result).
- Observed (on-screen map square, `RF.UI.vLeft.fitSq` / `vHeat.fitSq`): normal 256 px → Editor expanded 231 px (Editor canvas box grew 276x298 → 420x368,
  but the map is capped to the partner's size). Same for Result expanded: 256 → 231. At 1280x720 expand does grow it, but only 123 → 144 px
  while the expanded canvas box is 335x160.
  Expected: Expand gives the expanded map more pixels. The shared-size cap (syncMapCap, "so the two maps compare cell for cell") means expanding one pane
  shrinks the other pane AND, through the cap, the expanded one too.
- Evidence: shots/expsize-1500-editor.png, shots/exp-editor.png (Editor pane is wide, its square is the same as the narrow Result's)
- Reproduced: 2 of 2 (editor, result) at 1500; deterministic
- Suspected cause: ui.js syncMapCap (~line 1513) sets one cap = min of BOTH canvases' boxes, applied by View2D.fit (render2d.js ~line 17) regardless of `layout.expanded`.

### Divider limits let the Editor/Result maps shrink to nothing (0 px or a 22 px thumbnail)
- Severity: broken UI
- Repro: node 12-dividers.js (mouse drags) and node 14-min-sizes.js (same states set directly), 1500x950.
  (a) drag the horizontal maps|Optics divider all the way up → rowSplit 0.1, pair row = MIN_H 140 px.
  (b) drag the Scene|right divider all the way right → right column = MIN 180 px, the pair stacks.
- Observed: (a) both map canvases are 276x0 (fitSq 0) — the maps disappear entirely; the Result colour bar is clipped 26 px below the pane edge,
  Editor's Erase/Invert row is cut off. (b) maps drawn at 22 px (canvases 157x29 / 157x25); Optics canvas squeezed under its own wrapped head tools.
  Expected: the minimum pane sizes (layout.js K.MIN 180 / K.MIN_H 140) should leave a usable map; ~140 px is less than the map chrome alone
  (head + caption + toolrow ≈ 100–200 px; layout.js itself uses CHROME: 100).
- Evidence: shots/div-row-up.png, shots/min-row.png, shots/div-main-right.png
- Reproduced: 2 of 2 runs each (mouse drag and direct state)
- Suspected cause: js/layout.js K.MIN_H/K.MIN don't account for map-pane chrome; ui.js set() clamps shares to 0.1–0.9 only.

### Dragging any divider while a pane is expanded makes the OTHER split jump (Scene column jumps ~234 px)
- Severity: cosmetic
- Repro: node 12-dividers.js — expand Optics (⤢), then drag the maps|Optics divider up 30 px.
- Observed: row follows the pointer (309 → 280 px) but the expand is cleared, so the Scene|right columns snap from the expanded 444|725 back to the
  stored 678|491 — a pane you didn't touch jumps 234 px under the pointer drag.
  Expected: when an expand ends because of a drag, keep the other splits where they visibly were (write the expanded sizes back into the shares).
- Evidence: 12-dividers.js output lines "expanded optics" vs "drag while expanded"
- Reproduced: 1 of 1
- Suspected cause: ui.js wireDividers set() (~line 1539) sets `layout.expanded = null` without converting the expanded geometry to stored shares.

### During a solve the footer grows 45 px and every pane shrinks (maps resize/refit twice per solve); header buttons shift too
- Severity: broken UI (layout jump while solving; distinct from the known "sidebar jumps")
- Repro: node 17-solve-jumps.js 1500 — default scene (Auto solver, Watch solve + Live numbers on by default), click Rebuild; rAF-sampled rects of key elements.
- Observed (1500x950, solve 7–8 s): when the PREVIEW tile appears in the footer (#min-row.pv), the footer goes 49 → 94 px tall, "Details" wraps from the
  right end to a new line at the left (x 1108 → 24), and the workspace loses 45 px: scene canvas 778 → 733 tall, Editor/Result canvases 298 → 272
  (maps redraw at a smaller square), Optics 297 → 278. All of it snaps back when the solve ends. Header: Rebuild grows 76 → 97 px (spinner) so
  Undo/Redo/status shift 21 px left; status text widens 83 → 510 px.
  Expected: fixed-height footer (it already floats notices/drawer "instead of growing it") and reserved spinner space.
- Evidence: shots/solve-1500-during.png (two-line footer, Details on its own line), shots/solve-1500-after.png; rect log in the script output
- Reproduced: 2 of 2 solves
- Suspected cause: css/app.css `.foot { flex-wrap: wrap }` + the extra `.pv-tag` tile (max-width 160px) in #min-row pushes `.foot-mid`/Details onto a second row;
  `body.solving #btn-generate-top::before` adds 16 px to the button.

### Disabled ("off") dividers stay in the Tab order and still change the layout from the keyboard
- Severity: broken UI (minor)
- Repro: node 19-off-divider.js — collapse Editor (pair divider gets class `off`), Tab/focus the Editor|Result divider, press ArrowRight ×10, reopen Editor.
- Observed: the off divider is focusable (tabIndex 0, shows the focus bar), arrow keys silently move the hidden pairSplit 0.5 → 0.7 with no visible effect,
  and when Editor is reopened the pair comes back as 418|180 instead of 299|299. Also seen in the Tab walk (18-focus.js): `div:pairSplit` is a stop right
  after the collapsed Editor.
  Expected: off dividers get tabindex=-1 (or ignore keys), like they already ignore pointer events (`.divider.off { pointer-events:none }`).
- Evidence: 19-off-divider.js output `{"pairSplit":0.7,"reopened":{"cols":"418px 10px 180px"}}`
- Reproduced: 1 of 1 (deterministic)
- Suspected cause: ui.js layoutGrid (~line 1503) toggles only the `off` class; wireDividers keydown (~line 1545) doesn't check it.

### Layout chrome exposes no state to assistive tech (collapse, pane tabs, view radios, separators)
- Severity: cosmetic (a11y)
- Repro: node 18-focus.js (dumps attributes)
- Observed: collapse buttons have no aria-expanded; phone pane tabs (#pane-tabs) have no aria-selected/aria-pressed/aria-current (state is only the `.on` class);
  #heat-display is role=radiogroup but its buttons have no role=radio / aria-checked; focusable role=separator dividers have no aria-valuenow (required for
  a focusable separator). Keyboard focus otherwise works: Tab reaches every chrome control, :focus-visible is on, Esc closes Details and returns focus to the button.
- Evidence: 18-focus.js JSON line (all null)
- Reproduced: 1 of 1

### Stamp mode (B): Editor direction picker never draws — ReferenceError `clearZero is not defined` on every draw
- Severity: crash/blocker (for Stamp mode's Editor pane)
- Repro: node 20-modes.js — or in any context: `RF.UI.setMode('B')`. Same at 1500, 1280, 768 and 375 (on phone, open the Editor tab).
- Observed: uncaught `ReferenceError: clearZero is not defined` (pageerror, 2–3 per mode switch); the Editor canvas stays blank (non-bg pixel fraction 0
  at every viewport) — only the caption and the legend text show; the polar picker, its rings and the stamp markers are missing.
  The rest of the page keeps working (Result, Scene, Optics draw).
- Evidence: shots/mode-1500-B.png (empty Editor pane), 20-modes.out (errors list per viewport)
- Reproduced: 4 of 4 viewports
- Cause (confirmed by reading the code): js/render2d.js:128, inside pickerImage(): `img.data[o + 3] = clearZero && !(v > 0) ? 0 : 255;` — `clearZero` and `v`
  only exist in gridCanvas() (line 55/65); this line looks pasted from line 65. `git log -S` points at 91de232 ("Inspector: show a selection as if it were alone").
  In HEAD (not a local edit). Expected the old `255` (or `rr > 1 ? 0 : 255`).

### Spec mode at 1280x720: Result view shrinks to a 38–54 px strip; Drive/Road toolbars overflow it and the pane
- Severity: broken UI
- Repro: node 21-spec-small.js (1280x720, default layout, sidebar open) — setMode('D'), then setDisplay grid / drive / road / ff.
- Observed: the Spec footer is 137 px (two rows of tiles + binding line), so the Result canvas is 218x54 (grid/ff), 218x38 (drive), 218x22 (road);
  Editor map 219x69. Drive tools span y 261–355, i.e. they cover the whole 38 px canvas and run 10 px past the Result pane's bottom edge (clipped:
  "signs / oncoming / preceding" buttons cut off). The view is unusable without collapsing panes or hiding the sidebar.
- Evidence: shots/disp-1280-drive.png, shots/mode-1280-D.png; 21-spec-small.js output (footerH 137, heatCanvas [740,257,958,295], tools [744,261,954,355], pane bottom 345)
- Reproduced: 1 of 1 run, every display
- Suspected cause: Spec footer content (#min-row wraps to 2+ lines) + the Result head's wrapped view buttons (4 rows at this width) + absolute-positioned tool rows
  that assume a large canvas (css/app.css .drive-tools / .road-tools ~lines 205–212).

### Spec far-field toggles run past the Result pane (1280) and off the viewport (768)
- Severity: broken UI
- Repro: node 21-spec-small.js / 20-modes.js — Spec mode, Result → Far field, at 1280x720 and 768x1024.
- Observed: `.ff-tools` row (beam · log · isocd · spec · aim · road) is a no-wrap flex row: right edge 979 px vs pane right 969 (1280); at 768 it ends at x=822
  with the viewport 768 wide — "aim" and "road" are off-screen / clipped by the pane and can't be clicked. The aim readout text also overprints the plot labels (shots/disp-768-ff.png).
- Evidence: shots/disp-768-ff.png; overflow probe "toggle aim [749..782]", "toggle road [784..822]" (vw 768)
- Reproduced: 2 of 2 viewports
- Suspected cause (guess): css/app.css `.ff-tools { display:flex }` without flex-wrap/right:4px (drive-tools and road-tools have both).

### "Reset zoom (or double-click)" on the Paint map also paints — the double-click adds a brush dab + an undo step
- Severity: broken UI (unintended edit to the design input)
- Repro: node 23-dblclick-paint.js — Paint mode, Editor active, wheel-zoom the map, double-click inside the painted grid (the ⌖ tooltip advertises double-click).
- Observed: zoom resets as advertised, but modeA.paint goes 1064 → 1072 painted cells (sum 593.2 → 601.2) and history past 1 → 2: the first click of the
  double-click is a paint stroke. With auto-solve on paint this also marks the design stale / re-solves.
  Expected: double-click to reset should not paint (or the ⌖ button should be the only reset in paint mode).
- Evidence: script output; shots/dblclick-paint.png
- Reproduced: 1 of 1 (deterministic: pointerdown paints before dblclick fires)
- Suspected cause: ui.js:1602 `left-canvas dblclick → resetView('left')` layered on top of wireLeft's onPrimaryStart/paintAt (~line 999).

### Optics has no zoom/view reset of its own; double-click does nothing there
- Severity: broken UI (minor)
- Repro: node 22-resets.js — orbit + wheel-zoom the Optics view (camS.scale 3.36 → 11.14, userMoved true), double-click it: unchanged.
- Observed: Editor/Result have ⌖ + double-click, Scene has "Reset view"; Optics has neither. The only ways back are the SCENE pane's "Reset view" (which,
  undocumented, also refits Optics: scale back to 3.355) or toggling Envelope. With Scene collapsed (desktop) or on a phone's Optics tab, that button isn't on screen.
- Evidence: 22-resets.js output ("optics has reset control? false", dblclick leaves scale 11.137)
- Reproduced: 1 of 1

### Narrowing the window (or rotating a tablet) to ≤1024 px leaves the sidebar open as an overlay covering the panes
- Severity: broken UI (minor) / inconsistent state
- Repro: node 24-resize.js — load at 1500x950 (sidebar docked, open), then setViewportSize to 1280 → 900 → 700 → 375.
- Observed: at 900, 700 and 375 the sidebar is an open 300 px overlay (body has no `side-hidden`) on top of the Result pane, the Details button and
  most of the phone's single pane. A fresh load at the same widths starts with it closed (15-sidebar.js: `boot hidden:true` at 1024/768/375). It only
  closes after a press outside it.
  Expected: entering overlay mode closes the sidebar (same as a fresh narrow load), or at least never overlays on resize.
- Evidence: shots/resize-900.png, shots/resize-375.png (phone view almost entirely covered)
- Reproduced: 1 of 1 sequence, 3 widths
- Suspected cause: ui.js setSide (~line 1702) runs only at boot and on click; the window 'resize' handler (~line 1760) calls layoutGrid but never re-applies the narrow() default.

### 1280x720: expanding Optics shrinks both maps to ~20 px thumbnails, and the selection chip then covers the whole Result map
- Severity: broken UI (cosmetic-adjacent)
- Repro: node 26-inspector.js (1280x720) — select a facet (RF.UI.select({kind:'facet', id})), click ⤢ on Optics.
- Observed: the pair row drops to its minimum; Editor and Result maps are drawn at ~20–25 px; the Result "Facet F24 → zone 5 …" chip (162 px wide,
  top-left of the canvas) sits on top of the entire Result map. Inspector panel itself lays out fine (260 px, no overflow) and Esc clears it cleanly.
  Also at 1280x720 the idle Paint-mode footer is two lines (Details wraps under the tiles), costing ~40 px of map height before anything is expanded.
- Evidence: shots/insp-1280.png, shots/base-1280.png
- Reproduced: 1 of 1
- Suspected cause: same as the divider-minimum finding (layout.js MIN_H vs map chrome); chip is absolutely positioned regardless of canvas size.

### Editor and Result maps are the same size but not aligned (Result square sits 24–36 px lower)
- Severity: cosmetic
- Repro: default load at 1500x950 (01-baseline.js / 17-solve-jumps.js rects).
- Observed: Paint mode: left-canvas top y=161, heat-canvas top y=185 (squares 256 px both); Spec mode: 177 vs 213. The Result head's view buttons wrap to
  their own 1–2 lines ("Fidelity" alone on line 2 even at 1500) while the Editor's mode tabs fit on one, so the "identical chrome under both maps" design
  doesn't hold above the maps and the two squares can't be compared side by side at the same height.
- Evidence: shots/base-1500.png
- Reproduced: 2 of 2 modes

## Known items — status in this run
- Collapse→reopen blank map: STILL PRESENT, but only after a zoom/pan (root cause above). Plain collapse→reopen of all 4 panes and 4 combos drew correctly.
- Sidebar jumps while solving: NOT reproduced at 1500 (rAF rect sampling of .side-top and the sidebar solver select showed no movement during an Auto solve);
  only the sidebar Rebuild button widens 134 → 155 px (spinner). The footer/workspace jump above is a different, reproduced jump.
- Label overlap: still present in the Spec Editor overlay at 375 and 768 (labels overprint each other and the overlay runs past the map square: shots/mode-375-D-editor.png, shots/disp-768-ff.png).
- 120 s limit / SPEC-MODE.md / Safari memory: out of layout scope, not checked.

## Checked, no bug found
- No horizontal page scroll at any tested width (scrollWidth == viewport at 1500/1280/1024/900/768/700/375).
- No console errors in any layout test except the Stamp-mode clearZero ReferenceError.
- prefers-color-scheme light vs dark: app is dark-only (`color-scheme: dark`, no media query); light emulation renders pixel-identical canvases and no layout change.
- 3D cameras (Scene, Optics) survive collapse→reopen after orbit+zoom (scale kept, nonbg identical).
- Divider double-click reset, arrow-key nudge (2 % steps) and localStorage persistence across reload all work.
- Tooltips: every visible chrome control has a title, aria-label or label (25-tooltips.js, Paint + Spec).
- Details drawer bounded and scrollable at all four widths; Esc closes it and returns focus to the button.
- Preset confirm bar: single bar, fits the sidebar at 1500 and 375, Cancel clears it.

## Suspected (not reproduced)
- The "up to date" progress strip appeared open in several full-page screenshots taken seconds after boot/clicks, but direct polling of its `open` class
  (03, 05, 09, 13, 16 scripts) never caught it open outside a real job. Probably a screenshot-timing artifact; not filed.
