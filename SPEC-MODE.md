# Spec mode: regulation-style beam targets

Branch `spec-mode` (2026-10-04). Status: phase 1 is built and tested; R112 presets checked against Rev.4. Phases 2–4 are a plan.
This file covers what exists, what was checked against the regulation and what still isn't modelled, what comes next, which new optics and solvers
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
| Judge | `js/spec.js` (`RF.Spec.evaluate`) | Constraint kinds: points (min and/or max), polygon zones (min/max), **sums of points** (R112 points 1+2+3), **limits relative to another reading** (Zone I < 2 × measured 50R; HV ≥ 0.8 × Imax), the cut-off gradient scan (min **and max** sharpness), **cut-off linearity** (inflection points within 0.2°), and a global intensity cap. Each verdict is `pass` / `fail` / `unsure` at ±2σ. A zone's fail must also clear the extreme-value noise (√(2 ln n) σ). **Aiming as the lab does it**: by the cut-off (the inflection at 2.5° goes on 0.57° D, Annex 9 §3.1) or the maximum on HV (driving beam), then re-aimed within an asymmetric box (R112: 0.5° L / 0.75° R / ±0.25°), keeping the best. Shows a "×N more rays would settle it" hint. LHT mirrors H and the box. |
| Feasibility | `RF.Spec.feasibility` | No trace needed. Brightness-theorem ceiling per min-point: R·L·A⊥(envelope) plus the LED's own direct intensity. Flux lower bound for the min-zones. |
| Asking a solver | `RF.Spec.workingPaint` | Turns spec + painting into the relative target that the existing paint solvers accept: floor = mins, ceiling = maxes, shape = paint × paintCd × weight, converted to plane illuminance (E = I cos θ / r²). **No solver changes.** `RF.Solvers.paintOf(scene)` routes it to every solver in mode D. |
| Seed paint | `RF.Spec.seedPaint` | A plausible low-beam painting in H/V: flat cut-off at 0.57°D on the oncoming side, a 15° rise on the own side, a hot zone under the elbow, and a wide foreground. |
| UI | `js/spec-ui.js`, small hooks in `ui.js`, `panels.js`, `controller.js`, `index.html`, `css/app.css` | **Spec** tab (extends Paint: same brush, solver and budget). Sidebar: preset, traffic, **Measure at ∞ / 25 m / 10 m / target**, measurement settings (kernel, aim method, re-aim box, angle convention, bin), paint-as-secondary-goal settings, an editable constraint table, the report, and **Compare distances** (re-judges the same trace at several distances, no re-trace). Result → **Far field**: log-cd map by direction with the spec drawn on it, coloured by verdict; tap it to read cd ± σ. The Editor overlays the spec projected onto the plane, and a **Solver target** toggle shows what the solver is actually asked for. |
| Tests | `tests/spec.js` (in `tests/all.js`) | Isotropic source reads P/4π in all three conventions. Lambertian source reads (P/π)·cos θ. Conv-A bins tile 4π. hv∘dir = identity. Progressive = one-shot. Exit energy = target + target back + escaped. A screen at 10⁹ m = far field. A point source at the centre reads the same at any screen distance. Judge verdicts on synthetic fields (cut-off found at the right V, G exact, re-aim clears a glare point, LHT mirrors, unsure inside 2σ). Working target carves holes and lifts floors. Seed paint stays under the cut-off. Old scenes load with the default spec. |

How to try it: open the app, click **Spec**, then **Fit target to spec**, then **Seed low-beam
paint**, then **Rebuild**. Read the report, then switch **Measure at** between ∞ and 10 m.

### Your 10 m question, measured

Setup: the default scene's fixture (envelope 56 × 105 × 55 mm), the R112 class B preset, seeded
paint, built-in spoke solver, 100 facets, 1 M rays, kernel ±0.15° (wider than the regulation's
±0.075° photocell, to keep the noise down). The same trace, judged at different distances.

**As designed** (no aiming), which isolates the raw near-field error:

| Measured at | 75R (≥ 10.1k) | 50L (≤ 13.2k) | Zone III max (≤ 625) | Cut-off found at |
|---|---|---|---|---|
| ∞ (goniometer) | 33.9k | 16.9k | 3.3k | V −0.10° |
| 50 m | 35.4k | 18.9k | 4.6k | −0.05° |
| 25 m (the regulation's distance, §6.1.2) | 35.5k | 20.4k | 6.0k | +0.05° |
| **10 m** | 36.7k | **25.5k (+51%)** | **11.9k (×3.6)** | **+0.20°** |
| 5 m | 36.9k | 29.4k | 18.0k | +0.40° |

**Aimed by the cut-off at each distance** (what the lab does, so the vertical part of the
error gets absorbed into the aim): 75R falls from 16.9k at ∞ to 13.3k at 25 m and 11.4k at
10 m, a third lower. The re-aim moves the hot zone down along with the cut-off.

At 10 m, this fixture's near field lifts the measured cut-off by about 0.3° and inflates
everything just above it. That matches the parallax estimate (aperture ÷ distance ≈ 0.3–0.6°).
The 0.57° offsets between test points are the same order, so a 10 m target plane is not a
goniometric measurement for a lamp this size. Even the regulation's own 25 m differs visibly
from ∞ here. Use **Compare distances** on your own scenes. Your current low beam is a
different fixture, so these numbers don't transfer to it.

Side finding for phase 2: the seed paint puts the cut-off at 0.57° D, but the solved design's
cut-off lands near 0.1° D. The paint solvers blur the edge upward by about half a degree. The
lab's aim then pulls the whole beam down to compensate, which costs 75R about half its value
(33.9k as designed → 16.9k aimed, at ∞). Edge anchoring is aimed squarely at this.

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

## Checked against UN R112 Rev.4

The R112 presets are transcribed from **E/ECE/324/Rev.2/Add.111/Rev.4** (18 September 2023;
text up to Supplement 1 to the 02 series), which you supplied. Every row carries its paragraph
reference (hover a row in the constraint table). `tests/spec.js` pins the values. Presets:
class B passing, class A passing, class B driving, class A driving.

What the document settled:
- **Coordinates:** Annex 3 Figure A uses a vertical polar axis, h = longitudinal planes around
  it, v = latitude. That is this app's convention `A`. Answered.
- **Measurement (§6.1.2):** 25 m, photocell within a 65 mm square, so the kernel is
  ±0.0745°. The preset's "Measure at" defaults to 25 m.
- **Aiming:** visual or instrumental aim by the cut-off, with the horizontal part at 0.57° D
  (§6.2.2.1; Annex 9 §3.1 for the inflection method). The preset aims by the cut-off. Re-aim
  limits (§6.2.2.3): 0.5° left / 0.75° right / ±0.25° vertical for RHT, mirrored for LHT.
- **Cut-off (Annex 9 §2):** vertical scan at 2.5° in 0.05° steps, G = log E(β) − log
  E(β + 0.1°), 0.13 ≤ G ≤ 0.40 (the maximum is measured at 25 m only). Linearity: the
  inflection points at 1.5°, 2.5° and 3.5° within 0.2°.

Where the from-memory version (the first commit on this branch) was **wrong**:

| Row | From memory | R112 Rev.4 |
|---|---|---|
| Zone III polygon | ended at (1.5R, 1U), (0, 0.57U), (3.43L, 0.57U) | 8L1U · 8L4U · 8R4U · 8R2U · 6R1.5U · **1.5R1.5U · V-V/H-H · 4L/H-H**, so it reaches down to the horizon |
| BR (1.0U, 2.5R) ≤ 1,750 | missing | present |
| Zone I (1.72D–4D, 9L–9R) | missing | < 2 × measured 50R (class B); ≤ 17,600 (class A) |
| Points 1–8 (overhead signs) | missing | 1+2+3 ≥ 190, 4+5+6 ≥ 375, 7 ≥ 65, 8 ≥ 125 |
| Max sharpness | missing | G ≤ 0.40 |
| Re-aim tolerance | symmetric, off | 0.5° L / 0.75° R / ±0.25° |
| Kernel | ±0.15° | ±0.0745° (65 mm at 25 m) |

Saved scenes that still carry the from-memory preset (`verified: false`) get the regulation
rows when they load.

Still **not** modelled:
- The horizontal instrumental aim (Annex 9 §3.2, "0.2 D line" or "3 line" method). The horizontal
  position is taken as designed, then the re-aim box applies.
- The visual elbow/shoulder placement rules (§6.2.2.2) and "only one cut-off visible" (Annex 9 §2.1).
- Footnote ***: 50L ≤ 18,500 cd for LED modules with an electronic light-source control gear.
  It's noted on the row; edit the max if it applies.
- Bend lighting, adjustable-reflector mounting positions (§6.4), a combined passing + driving lamp's
  shared alignment (§6.3.1), and Annex 4 (stability).
- The goniometer measures on a sphere at 25 m, while this app's finite-distance mode uses a flat
  screen at 25 m (Annex 3 shows the screen). Negligible near the axis; it grows toward ±45°.
- **R149** (supersedes R112 for new approvals; §5.12 lets an R112 lamp meet R149 instead) and
  **FMVSS 108 / SAE J1383**: not in yet.

**Noise at regulation resolution.** One ray in a ±0.0745° square at 1 M rays and 1,000 lm is
about 220 cd. The small minimums (point 7 ≥ 65 cd, the 1+2+3 sum ≥ 190) and the 350 cd glare
cap can't be decided below roughly 5–10 M rays. The report says "unsure" and how many more rays
it needs, or you can widen the kernel (less faithful).

### Emitters, and how far the current solvers get (2026-10-04, later)

Light source → **Emitter** presets (`js/source-presets.js`):
- **Sketch LED:** the default, 1 × 1 mm at 1,000 lm, ≈ 318 cd/mm².
- **Luminus SFT-40-W 3000 K 95 CRI** (datasheet PDS-003302 Rev 01): a 1.97 × 1.97 mm
  flat-window die, Lambertian (120° FWHM), with a **4 A absolute maximum**. There are two flux
  models. *Datasheet* uses the bin D9 minimum at Tj 85 °C (861 lm at 4 A). Past 4 A it follows
  koef3's curve shape, scaled to match at 4 A; that part is an estimate, and the panel warns
  above 4 A and 13 W rather than clamping. *koef3* uses one sample's chart (fan-cooled copper board, 25 °C solder point, driven
  to 14.8 A) and is flagged above 4 A. Vf, watts and lm/W are shown for both.
- **Luminus SFT-40-W cool white** (WxS/WxE datasheet PDS-003134 Rev 05): the same 1.97 mm die,
  5000/5700/6500 K at CRI ~70, rated **8 A / 29 W**. Flux comes from each bin's minimum at
  Tj 85 °C (N4, N5, P3); 2,272 lm at 8 A for 6500 K bin N5.
- **Luminus SFT-25R-WG CRI > 90** (PDS-003551 Rev 03): a round flat-window emitter, Ø 1.70 mm,
  ≈ Lambertian, rated **5 A / 18 W**. Bins D9, F1, F3, F5; 1,021 lm at 5 A for 3000 K F1
  (~143 cd/mm²).
- **Sketch LED vs real parts:** 318 cd/mm², against 71 (SFT-40 3000 K at 4 A), 143–179
  (SFT-25R at 5 A) and 186–210 (SFT-40 cool white at 8 A). Spec mode's report now says so
  whenever the sketch or a custom emitter is in use, because absolute cd depend on it.
- **koef3-measured Osram LEDs** (CSLPM1.TG, CSLNM1.TG, Black Flat HWQP, OSTAR LE UW Q8WP).
  Flux and Vf are read off his comparison chart (25 °C solder point, fan-cooled), and
  luminance comes from his cd/mm² tables. No die sizes are given, so the die is a square of
  the **effective area Φ / (π L)**: 2.04, 1.5, 1.3 and 2.07 mm². That holds within a few %
  across current, which supports the readings.
- **More koef3 LEDs** (from his FFL505A, Nichia 519A / 519A-V1 and SFT-70 comparison charts):
  FFL505A 3500 K rosy, Yinding 5050 6500 K 95 CRI, Nichia 519A sm503 (domed and dedomed),
  519A-V1 sm573 (domed), Samsung LH351D 5700 K 90 CRI (domed, ≈ 10.5 mm² effective), and SFT-70 3000 K 95 CRI / SFT-70-X 6500 K 70 CRI (6 V). For domed parts
  the effective area is the dome's head-on apparent size (519A domed ≈ 9 mm², dedomed ≈ 4.6),
  which a flat Lambertian disc only approximates off-axis.
- **LMP W5050SQ3 3000 K 70 CRI** (koef3's chart and table): a round die of 2.3 mm² (Ø 1.71 mm,
  per Anya). It reaches 1,568 lm and 199 cd/mm² at 8.6 A. His luminance implies ≈ 2.47 mm²
  effective (+7 %), the same direction as the SFT-40 (+10 %): his cd/mm² reads a little under
  flux ÷ (π × die area). Both models are offered: effective area, or the 2.3 mm² die.
- **SFT-40 3000 K, koef3's own luminance** (15.2 / 49.9 / 127.6 cd/mm²) gives an effective area
  of ≈ 4.27 mm², about 10 % more than the 1.97 mm die square. His sample measured about 10 %
  less bright per mm² than the datasheet geometry implies. The "koef3" flux model now uses that
  area; the "datasheet" model keeps the 1.97 mm die.
- **Measured LED:** paste rows of A, lm and cd/mm² (any koef3 test), pick a square or round
  die, and the effective area follows the drive current.
- **HB3/9005:** UN R37 sheets HB3/1–4. An axial 5.1 mm opaque coil, 1,860 lm at 13.2 V or
  1,300 at 12 V. The filament diameter of 1.4 mm is **assumed**, because the sheets don't
  give it.

R112 class B, default fixture, seeded paint, spoke solver, 1.5–2 M rays, kernel ±0.15°, aimed
by the cut-off. **None of them passes:**

| Emitter | Luminance | Verdict | What fails |
|---|---|---|---|
| Sketch LED | 318 cd/mm² | 10 pass / 5 fail / 4 unsure | Zone IV, Zone I (> 2 × 50R), 25L-side spread, sign points, G too sharp / not linear |
| SFT-40 @ 4 A, datasheet (861 lm) | 71 cd/mm² | 8 / 7 / 4 | 75R / 50R right at 10.1k (unsure), Zone IV dark, Zone I, cut-off found 0.6° *above* H, so the aim drops everything |
| Osram OSTAR LE UW Q8WP @ 9.6 A, koef3 (1,607 lm) | 245 cd/mm² | 10 / 5 / 4 | Strongest real emitter tested: 75R 20.0k, 50R 24.0k, 25L 10.2k; the same Zone IV / Zone I failures |
| Osram CSLPM1.TG @ 8.6 A, koef3 (1,500 lm) | 232 cd/mm² | 10 / 5 / 4 | close behind (75R 19.9k, 50R 25.6k) |
| Osram Black Flat HWQP @ 5.4 A, koef3 (937 lm) | 225 cd/mm² | 9 / 5 / 5 | the smallest die (1.3 mm²) gives the lowest solved cut-off (0.1°) but too little light for 25L |
| SFT-25R 3000 K (bin F1) @ 5 A, rated (1,021 lm) | 143 cd/mm² | 11 / 5 / 3 | Best score so far; the smaller round die puts the solved cut-off at 0.3° (vs 0.6° for the 2 mm dies). Still Zone IV dark, Zone I > 2 × 50R |
| SFT-25R top bin F5 @ 5 A (1,279 lm) | 179 cd/mm² | 11 / 5 / 3 | same, more light (75R 16.2k, 50R 20.7k) |
| SFT-40 cool white (6500 K, bin N5) @ 8 A, rated (2,272 lm) | 186 cd/mm² | 10 / 4 / 5 | Strongest so far (75R 17.6k, 50R 22.9k, peak 79k); still Zone IV dark, Zone I > 2 × 50R, the same cut-off placement |
| SFT-40 @ 6 A, koef3, over the rating (1,170 lm) | 93 cd/mm² | 10 / 6 / 3 | same pattern |
| SFT-40 @ 10 A, koef3, over the rating (1,555 lm) | 124 cd/mm² | 10 / 6 / 3 | same pattern, more light |
| HB3 (1,860 lm) | 23 cd/mm² | 5 / 8 / 6 | No usable cut-off (inflection found at 3.9°). An axial filament in this up-facing half-envelope throws half its light away. It needs a reflector that wraps the bulb. |

Retuning the seed painting (hot zone tighter under the cut-off, weaker foreground, a faint
glow above the cut-off for the sign points) didn't converge. The solved cut-off is blurred,
so any light above it moves the measured inflection up (to 1.2–1.6°). That is phase 2's
problem (edge anchoring), not a painting problem.

### With the app's Auto solver, at 8 M rays (2026-10-04, evening)

The R112 table above used the spoke solver. Here the app's default Auto solver is used: the
same fixture and seeded painting, solved in the browser, with the geometry re-traced at
8 M rays in Node. Every real LED passes nearly all of the **main photometry** (75R, 50R, 50L,
25L/R and Zones I, III, IV): 8/8 for the SFT-40s, SFT-25R, Q8WP, CSLPM1 and HWQP; 7/8 with one
row undecided for the W5050SQ3 (Zone IV) and the LH351D (Zone III). **All of them still fail
R112**, and for the same two reasons:
1. **No light above the cut-off for the overhead-sign points.** Points 7–8 read 0 cd. The seed
   painting has nothing above the cut-off, so the solver puts nothing there.
2. **The cut-off is too sharp:** G ≈ 0.7–1.6 against the 0.40 maximum (often still undecided
   at 8 M rays).
Best: SFT-40 cool white @ 8 A and CSLPM1 @ 8.6 A (1 fail: point 8). The HB3 doesn't produce a
beam in this half-envelope. Sheets: `emitters-1.png`, `emitters-2.png` (not committed).

**Re-aim fix found doing this.** The re-aim search ranked aims by the *worst* margin, so a row
no aim can fix (a sign point with zero light) dragged the beam 0.5° and dropped the SFT-40's
75R from 21.6k to 8.4k. It now ranks by fewest sure fails, then fewest undecided rows, then
the smallest move. A move that changes no verdict isn't taken, as a lab would do it.

### Solvers compared (2026-10-04, night; superseded below)

*Judged at 4 M plain rays with the old cut-off aim. Several "75R 0" cells were the aim locking onto a dim edge. See "Settings × distance" (10-05) for the re-run.*

Six solvers × three LEDs × two fixtures. Each design was solved headless, re-traced at 4 M rays,
and judged against R112 class B (25 m, lab-style aim). Cells give **sure fails** and 75R in kcd.
No design *passes*: every "0 fails" still has 4–6 undecided rows, mostly the sign points with
no light and the maximum sharpness, which became fails at 8 M rays in the run above.

**Default fixture** (half-envelope, LED on the back wall facing up):

| Solver | SFT-40 CW @ 8 A | Q8WP @ 9.6 A | W5050SQ3 @ 8.6 A |
|---|---|---|---|
| spoke | 2 (Zone IV, linearity) · 16k | 2 · 25k | 1 (Zone IV) · 21k |
| Fill & fix | 5 · 0.7k (beam misplaced) | 5 · 0.4k | 5 · 0.6k |
| SQM v0.3 | 6 · 0 | 6 · 0 | **0** · 30k |
| Opus mosaic | **0** · 62k | **0** · 25k | 1 (G too sharp) · 60k |
| dish-fit (= Auto's pick here) | **0** · 25k | **0** · 40k | **0** · 16k |

**7" sealed beam** (Ø 168 × 75 mm bucket, LED at the front firing back, Ø 30 mm mount
shadow; the depth is a guess):

| Solver | SFT-40 CW @ 8 A | Q8WP @ 9.6 A | W5050SQ3 @ 8.6 A |
|---|---|---|---|
| spoke | 1 · 11k | 6 · 0 | 6 · 0 |
| Fill & fix | **0** · 33k (peak 142k) | **0** · 31k (= Auto's pick) | 7 · 0.1k |
| SQM v0.3 | 3 · 2k | 1 · 13k | 2 · 13k |
| Opus mosaic | 1 (linearity) · **111k, peak 168k** | 1 (points 4–6) · 61k | 2 · 40k |
| dish-fit | 3 · 18k | 4 · 0 | 4 · 69k |

- **dish-fit** is the steadiest in the default fixture, and it's what Auto picks there. In the bucket it falls apart.
- **Opus mosaic** makes the hottest beams (75R up to 111k, peak 168k in the bucket). Its cut-off
  is sometimes too sharp or not straight.
- **Fill & fix** collapses in the default fixture, in the app as well as headless. Its shell search
  predicts 49 % fidelity, places only 50 facets, and the beam misses the test points. In the
  bucket it is one of the best.
- **SQM** is throw-sensitive at a 10 m target, as noted on 09-30. Re-test at 25–50 m.
- The rear-firing LED in a 7" bucket clearly has the optical headroom: peaks of 75–168 kcd.
  The thermal side (28 W on a front-mounted LED) is out of scope.

### Ray budget (built 2026-10-05)

1. **The far field streams.** In Spec mode the trace bins every exit leg as it happens into four
   grids: the report's distance, ∞, 25 m, and 10 m (plus the target distance). Nothing is stored
   per ray, so memory stays flat: ~4 MB per grid at R112's 0.05° bins. The per-run ray cap went
   from 1 M to 20 M. Changing the window, bin or angle convention re-traces once by itself.
   `FarField.build` still accepts stored exit rays (tests, scripts).
2. **Refine** (Simulation section, and next to the "unsure" note in the report) keeps tracing a
   finished run up to ×2 the rays, up to 50 M. `Engine.extend` rescales everything already
   accumulated to the smaller per-ray energy, then traces rays N … 2N − 1. A run extended this way
   matches a from-scratch run of 2N rays to rounding (tests/spec.js).
3. **Guided emission (Spec mode's Refine).** The trace learns which emission directions (32 × 32
   equal-probability bins of the LED's direction uniforms) land where in the window, on a coarse
   0.5° grid. Refine then draws its new rays from q(bin) = 0.3/1024 + 0.7 × (bin's mean
   1/max(I, 5e-4·peak)), weighted 1/(1024·q), so each estimate stays unbiased and no weight
   exceeds 3.3. Dim places get more rays, the hot spot fewer.
   - Measured on a dish-fit design (2 M pilot + guided to 4 M vs plain 4 M, ±0.25° kernel):
     effective rays at (−6°, 3°U) 193 vs 4; at (0, 4U) 25 vs 4; at (−4, 2U) 21 vs 4; at 75R
     5,400 vs 7,300. Over the window's sub-1 %-of-peak spots, the median gain is ×3.2
     (quartiles ×1.8–×18).
   - It exposed an aim bug: the cut-off finder took the steepest log step anywhere in the scan,
     and a dim glow's top edge (80 → 1 cd) is steeper in log terms than the real cut-off. Now
     only steps whose bright side holds ≥ 2 % of the scan line's maximum count.
   - The empty-kernel noise floor uses the lightest guided ray's energy.
   - What it doesn't fix: R112's own photocell (±0.0745°) is ~7 µsr. Even 50 M guided rays put
     only tens of rays into a 125 cd point. The verdicts for the sign points stay statistical.

### Dome model (built 2026-10-05)

`src.dome = { r, n, z }` on a planar die: each ray leaves the die into the silicone and refracts
out through the sphere. It reflects back on TIR, or on the Fresnel share (drawn per ray,
unpolarised). Light returning to the base is re-emitted diffusely from where it lands (the
phosphor and white package recycle it). `power` stays the measured domed flux. The dome is
analytic, not a surface, so it costs nothing in the BVH.

Solvers plan with `RF.Source.apparent(src)`, the paraxial image of the die through the dome
(× n for a die at the centre; a centre above the die gives a bigger image and a narrower beam).
Traces use the real dome.

- **Check against koef3's 519A pair.** The dedomed sample's die (4.4–4.7 mm² effective) under
  an n = 1.41 hemisphere predicts the domed sample's measured apparent area to +0–10 % (0.7–7.6 A).
- **Traced near-axis image width:** 2.73 mm for a 2 mm die under an r = 2.5 mm dome. Paraxial
  says 2.82.
- **Assumptions:** the 519A dome radius (2.0 mm) is assumed. A die whose half-diagonal exceeds
  r/n gets TIR at its corners, and that is traced.

### Default emitter (2026-10-05)

The default source is now a 2 × 2 mm Lambertian die at 150 cd/mm² (1,885 lm), preset
`generic`. A warm sibling, `generic-warm`, is the same die at 100 cd/mm² (1,257 lm). The old
1 mm², 318 cd/mm² sketch LED stays as a preset.

### Spoke at long throws (fixed 2026-10-05)

The built-in solver's smallest curve radius was 0.2 % of the throw. At a 25 m target that is
50 mm: nothing fit the default envelope, and spoke placed 0 facets. It is now capped at a
quarter of the envelope's reach.

### Settings × distance, re-judged (2026-10-05)

Generic 150 cd/mm² LED, seeded paint, R112 class B. Each design traced at 8 M rays (2 M + guided
Refine) with the fixed aim. Cells give **sure fails**/unsure · 75R.

| Solver · setting | default 10 m | default 25 m | 7" 10 m | 7" 25 m |
|---|---|---|---|---|
| spoke | **5**/3 · 16k | **4**/4 · 13k | **5**/3 · 16k | **5**/3 · 23k |
| ff balanced | **6**/3 · 0.8k | **0**/2 · 16k | **1**/2 · 35k | **0**/3 · 71k |
| ff sharp | **4**/5 · 2.2k | **2**/4 · 10k | **6**/6 · 1.1k | **7**/4 · 0.7k |
| ff light | **7**/1 · 5.4k | **7**/2 · 2.5k | **0**/2 · 39k | **0**/2 · 32k |
| sqm fast | **9**/4 · 0 | **9**/4 · 0.1k | **6**/0 · 78k | **12**/1 · 0 |
| sqm normal | **4**/3 · 41k | **8**/4 · 0 | **11**/2 · 0 | **6**/0 · 72k |
| sqm fast lw1 | **9**/3 · 0 | **4**/2 · 22k | **6**/0 · 78k | **12**/1 · 0 |
| mosaic | **0**/5 · 60k | **0**/3 · 40k | **3**/2 · 53k | **3**/2 · 78k |
| mosaic auto | **0**/3 · 29k | **0**/3 · 40k | **2**/2 · 72k | **3**/2 · 109k |
| dish-fit | **3**/2 · 42k | **3**/2 · 24k | **5**/4 · 15k | **4**/2 · 13k |
| dish auto faithful | **4**/2 · 48k | **3**/2 · 47k | **6**/0 · 60k | **5**/0 · 67k |
| dish auto throw | **3**/2 · 31k | **3**/2 · 42k | **5**/4 · 15k | **4**/4 · 69k |
| dish auto efficient | **3**/2 · 31k | **3**/5 · 66k | **5**/4 · 15k | **4**/5 · 36k |
| auto, goal cutoff, search | **1**/3 · 26k | **3**/2 · 24k | **1**/2 · 35k | **0**/2 · 32k |
| auto, goal hotspot, search | **0**/5 · 60k | **0**/3 · 40k | **1**/2 · 35k | **0**/3 · 71k |

- **Settings matter as much as the solver, and they don't transfer.** Fill & fix "sharp"
  collapses everywhere. "Light" is the best choice in the bucket and the worst in the box.
  SQM's quality and light-weight settings flip a design between 0 and 12 fails; its "75R 0"
  cells are beams aimed off the test points.
- **No goal is cut-off-aware in R112's sense.** dish-fit's faithful / throw / efficient move
  75R by 2× but leave the same failures: sign points dark and G > 0.40, too sharp. Auto's
  *hotspot* goal does better than its *cutoff* goal here: it lands on mosaic or Fill & fix.
- **10 m vs 25 m:** parallax is real (0.1–0.2°), but solver chaos is bigger. Small input
  changes (even a paint rounded to 5 decimals instead of 4) reshuffle Fill & fix and SQM
  designs.
- **Mosaic and Fill & fix (balanced) reach 0 sure fails;** the unsure rows are mostly the
  sign points and the G maximum. **Nothing passes outright.**

### Glow above the cut-off (`seedGlow`, 2026-10-05)

A seeded dim glow (150 cd, notched at B50L) up to 4.5° U, at 16 M rays:

| Fixture · solver | Without glow | With glow 150 |
|---|---|---|
| default · dish-fit | Points 4–6, 7, 8, G | B50L, Zone III |
| default · mosaic auto | Zone III | B50L, Zone III |
| default · Auto cut-off | Points 4–6, 7, 8, G | B50L, Zone III |
| 7" · Fill & fix light | G | Points 1–3, 4–6, 8, G |
| 7" · Auto cut-off | G | Point 8, G |

The window the regulation leaves is narrow: points 4–8 need 65–125 cd, B50L ≤ 350, Zone III
≤ 625, and B50L sits 0.8° from Point 8. The glow lights the points but over-delivers next to
them. Paint solvers can't hold a dim region between a floor and a ceiling 2.8× apart. That is
what the phase-2 constrained flux fit is for. `seedGlow` stays off by default (opt-in in the
seed).

### Warm LEDs: luminance vs aperture (2026-10-05)

A 2 × 2 mm die at 100 / 150 / 200 cd/mm² (flux = π L A). The default box scaled about the LED.
Best of dish-fit / mosaic auto / Auto cut-off, 8 M rays, judged at R112 class B:

| Envelope (aperture × depth) | 100 cd/mm² (1,257 lm) | 150 (1,885 lm) | 200 (2,513 lm) |
|---|---|---|---|
| 53 × 27 × 28 | **3** fail · 75R 7k · peak 24k | **1** fail · 75R 9k · peak 35k | **1** fail · 75R 13k · peak 47k |
| 74 × 38 × 39 | **0** fail · 75R 17k · peak 38k | **0** fail · 75R 23k · peak 57k | **0** fail · 75R 32k · peak 81k |
| 105 × 55 × 56 | **0** fail · 75R 41k · peak 59k | **0** fail · 75R 40k · peak 89k | **1** fail · 75R 48k · peak 119k |

- **Peak scales with L** at every size, as R·L·A says.
- **The solvers reach only ~15–20 % of the brightness-theorem ceiling.** At 53 × 27 that
  ceiling is 133k cd at 100 cd/mm², and the best design peaks at 24k.
- **At 74 × 38 every luminance meets the photometry;** the margin on 75R (min 10.1k) goes
  1.7× → 2.3× → 3.2×. A 100 cd/mm² warm die therefore needs roughly 1.4× the linear aperture
  of a 200 cd/mm² one for the same margin.

### Dome vs flat vs dedomed (2026-10-05)

25 m, 8 M rays. Generic: bare 2 × 2 mm die at 150 cd/mm² (1,885 lm) vs the same die under an
r = 2 mm, n = 1.41 dome with +20 % flux (2,262 lm, ~90 cd/mm² apparent) vs its flat equivalent
(2.82 mm square, 2,262 lm). 519A: koef3's dedomed and domed samples at 5 A; the domed one as
an effective flat and as die + dome. Peak / light in the spec window, best solver:

| | default box: peak · window lm | 7" bucket: peak · window lm |
|---|---|---|
| bare 150 | 89k · 818–985 | 153k · 1,066–1,247 |
| die + dome | 68k · 924–1,093 | 167k · 1,162–1,516 |
| flat equivalent | 68k · 842–1,109 | 162k · 1,189–1,518 |
| 519A dedomed (1,020 lm) | 41k · 396–528 | 74k · 481–670 |
| 519A domed, flat effective (1,265 lm) | 39k · 462–640 | 104k · 669–812 |
| 519A domed, die + dome | 34k · 456–671 | 76k · 641–838 |

- **In a small optic the dome costs peak:** ~20 % here, despite +20 % flux, because luminance
  drops ~2×. It adds light to the spread.
- **In a big optic it costs nothing** at the peak, and the extra flux shows up in the window.
- **The flat equivalent tracks the real dome within solver noise** (±10–15 %). A real dome is
  cheap, so the preset offers it, but a flat effective area is not misleading.

### Before dedicated spec solvers: what's still missing

1. **`input.spec` + angle-space targets.** Solvers still aim at points on a flat plane. The
   25 m target is a workaround for parallax (0.23° at 10 m for a facet 40 mm off-axis, 0.09° at
   25 m). It is not a fix: the cell grid is still uniform in plane mm, not degrees. A dedicated
   solver should read the items in (H, V) and aim directions.
2. **A spec bench in the repo.** `compare3.js` (solver × settings × fixture, 2 M + guided
   judging) should become `tests/bench-spec.js`, with fixed fixtures. Every future solver gets
   scored against the same table.
3. **Fixture library with real dimensions.** Default box, the 7" bucket (true depth and
   focal length needed), a modern slim reflector (~120 × 35), and a projector module envelope.
4. **A more robust cut-off aim.** A design with a bright stray streak at 4–5° U can still
   capture the aim (SQM in the 7" bucket). The lab's eye ignores that. Candidates: restrict the
   aim scan to near the expected line, or take the edge with the largest absolute drop.
5. **FMVSS 108 preset.** Needs the full table rows and the VOL/VOR aim rules.
6. **Edge-aware facet orientation** (parked). Phase 2's edge anchoring depends on it.

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
