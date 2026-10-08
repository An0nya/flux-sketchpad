# projector v4 exploration — session handoff (2026-10-07 night → 10-08)

Mode: **exploring**. Everything below the "committed" list is scratch and uncommitted. Numbers are *observed* unless marked
*inference*. Read **§0 and §9 first** if you only have two minutes.

---

## 0. TL;DR

- Test bench: a **Ø90 × 200 mm cylinder**, HB3 filament (1300 lm, 5.1 mm, axial) 20 mm in from the rear end, FMVSS 108 LB2V, Ø85 lens.
  Anya's own saved scene for this was not available, so the filament offset is **my assumption**.
- **v3's auto mode does badly here** (15/8/3, 190 lm, 5.9 kcd) and its single-ellipsoid mode is under-tuned (it never tunes the ellipsoid
  path length). A **hand-placed single ellipsoid** (path = focus distance + 24 mm, Ø85 lens, f 54) gets 19/6/1, 411 lm, 36.4 kcd.
- The **split reflector** (top/bottom half-bowls with different path lengths) and then **four aimed quadrants** gave a wide, tunable
  hotspot and a wide elliptical blob. A **paraboloid strip** through the filament plane added a ±15° streak at ≥ 1 kcd.
- **The biggest losses are structural:** the shield absorbs ~33 % of the lamp (44 % of every group's light), and **18 % of the lamp
  never touches any optic** (the forward cone, 10–60° off axis, between the bowl rims and the lens).
- **Best all-round candidate so far:** f 84, quadrants +16 with the upper pair aimed 6L/6R, shield on, plus the 8.7 mm paraboloid strip extended to the rim depth (**B2**):
  17–19 pass / 4–5 fail / 2–5 unsure (2–4 M rays), ~422 lm, ~27.7 kcd, IIHS right reach 87 m and a marginal left reach (33.5 m at 4 M rays, right at the 5 lx threshold at 15 m).
  Its remaining fails are the shield-induced zero-light minima (4U 8L/R, 2U 4L) and the 0.5U 1R–3R ceiling.
- Two app fixes were made and committed (viewer mesh, Spec re-aim). Nothing is pushed.
- **Compliance numbers from 200 k-ray runs are optimistic** (zero-light rows read "unsure", at ≥ 2 M rays they are fails). Quote compliance only
  from ≥ 2 M rays.

---

## 1. What was asked (in order)

1. Reopen v4: a **branching solver** that starts from a plain ellipsoid + a lens filling the diameter, tunes that, then **fractures the
   reflector into facets one at a time** (post-first-gen halogen/HID style split reflectors; Liou used six circumferential zones).
   Also: facet budget as a **cap**, not a target (v3 fills it exactly).
2. Try a **Ø90 × 200 cylinder with the filament at one end**; v3 "struggled to produce a complete shell". Hand-tune a fixed Ø85 lens +
   single ellipsoid (she saw "a small spot on center and not much spread").
3. A **single ellipsoid with two curvatures** (wider in y) — and later **two hemi-ellipsoids (top/bottom)**, tested separately and with/without the shield.
4. Fix the **viewer** (large curved surfaces drew as a "pringle"). Commit it. Commit **Haiku's two solvers** (clean benchmark + second attempt).
5. **Block Spec-mode re-aim while rays are tracing** (the slow-as-a-dog bug).
6. Widen the ≥ 10 kcd hotspot (≥ ±2°, preferably > ±3°); explain a V-shaped hotspot; get a **wide elliptical blob**.
7. **Four quadrants** of one plain ellipsoid, each aimed; tighten the lower pair; step paths down; lens focal-length sweeps; shield on/off;
   **IIHS left-edge 5 lx reach**; f 84 with the upper quadrants aimed outward; a **paraboloid strip**; "are we leaving envelope volume on the table?"

---

## 2. The test scene and the tools

- Base scene: `~/Downloads/reflector-scene-4.json` (HB3, FMVSS LB2V, source axis +x, target aim +x) with
  `envelope = {shape:'cylinder', axis:0, half:[100,45,45], center:[x_s − off + 100, y0, z0]}`, filament centre `off` = 20 mm from the rear end
  (`x_s = −46.0`; envelope x from −66 to +134), `groups.A.surfaces = []`. Saved copy: `v4-scratch/scenes/cyl20-base.json`.
  Generator: `v4-scratch/mkscene.py <out.json> [off=20] [dia=90] [len=200]`.
- **Lens:** flat-in conic (flat face toward the filament), n 1.59, **`aperture` is a RADIUS in mm** (Ø85 = 42.5), `focal` = f.
- **Harness** (all in `tools/projector-v3/v4-scratch/`, run from that directory):

| file | use |
|---|---|
| `solver/p3-band2.js` | the **patched copy of the generated `solvers/projector-v3.js`** with every experimental setting (below). **Not** in `dev/`; the repo solver is unchanged. |
| `run.sh <name> '<settings>' [rays]` | run a config, print one summary line, write `out/<name>.{log,png,scene.json}` (verified: reproduces B0 = 18/7/1, 464 lm, peak 29984, reach 96/0). |
| `hot.js <thrCd> <rays> scene…` | width/area of the ≥ thr hotspot (0.4° box-smoothed far field). |
| `leftreach2.js <rays> scene…` | lux at the **IIHS left-edge sensor** at 15–60 m, farthest ≥ 5 lx, official reach. |
| `qeach2.js <scene> '<aims json>' [UL,UR,…]` | each quadrant alone: where its peak lands vs its aim, half-max width. |
| `stripalone.js`, `bonly.js`, `tonly.js`, `vtest.js` | strip alone / bottom half alone / top half alone / bottom-half variants. |
| `fate2.js <scene> [n]`, `none.js <scene>` | **where the light goes**: first surface touched × final fate (uses `RF.Engine.retrace`); emission angles of untouched rays. |
| `meshview.js`, `meshdiag.js` | offline SVG render of the reflector meshes; mesh/rim diagnostics. |
| `timeaim.js` | times `RF.Spec.evaluate` full vs frozen. |
| `cors.py <port>` | static server with CORS so page JS in the app can `fetch` scene files (used to load scenes into the preview). |

- **Experimental settings in `p3-band2.js`** (all default to "off"/no change; `reflector:'ellipsoid'` is required):
  `lcExtra` (path offset above the focus distance, mm) · `gH` (horizontal/vertical vertex-radius ratio of a single reflector) ·
  `half` = `whole|top|bottom|both|quad` · `xT`,`xB` (per-half path offset) · `gT`,`gB` (per-half g) · `dT`,`dB` (per-half focus shift along the axis, + toward the lens) ·
  quadrants: `hUL,vUL,hUR,vUR,hLR,vLR,hLL,vLL` (aim in degrees, right/up positive), `xQ` (quadrant path offset), `xLow` (lower pair offset) ·
  strip: `band` (height mm), `bandP` (paraboloid focal length, default half the path offset), `bandTilt` (deg down).
  Other settings: `shield: auto|off`, `focal`, `aperture`.
- **Loading a scene into the preview (works):** `python3 v4-scratch/cors.py 8744 &`, then in page JS
  `RF.UI.loadScene(RF.State.deserialize(await (await fetch('http://127.0.0.1:8744/scenes/X.scene.json')).text()), 'note'); RF.UI.store.autoA = RF.UI.store.autoSet = false;`
  Do this only when `RF.UI.solving` is false (see gotchas).

---

## 3. Reference points on this scene

| design | pass/fail/unsure | lm in window | peak | notes |
|---|---|---|---|---|
| projector-v2 (app default, 1 M rays) | 15/7/– | 246 | 33.8 kcd | |
| v3 auto, 150 facets | 15/8/3 | 190 | 5.9 kcd | picked flat-in f 17 Ø23, **0 bypass facets** |
| **spec-hl-v2** (150 facets, no lens) | 25/0/1 | 630 | 21.1 kcd | ≥ 10 kcd blob 4.2° wide (area 9 deg²); IIHS left 22 m / right 61 m |
| **sqm-hl** (149 facets) | 18/5/3 | 1006 | 15.9 kcd | IIHS left 61 m / right 62.5 m |

---

## 4. Findings, in order, with the tested numbers

### 4.1 Single ellipsoid + Ø85 lens: **path length is the lever** (4 M rays)
Path offset x = ellipsoid path length − focus distance (vertex sits x/2 behind the filament; rear room is ~20 mm, so x ≲ 38).

| f | x | pass/fail/unsure | lm | peak |
|---|---|---|---|---|
| 54 | +8 / +16 / **+24** / +32 / +38 | 17/8/1 · 19/5/2 · **19/6/1** · 17/7/2 · 17/9/0 | 294 · 355 · **411** · 447 · 398 | 14.9k · 27.7k · **36.4k** · 36.2k · 27.3k |
| 33 | +8 / +16 / +24 / +32 / +38 | 18/7/1 · 17/5/4 · 18/4/4 · 17/7/2 · 17/8/1 | 254 · 350 · 410 · 459 · 400 | 12.8k · 23.8k · 29.2k · 36.3k · 26.5k |

f 42 was weaker (11–17 pass, 9–19 kcd) but also got a different lens k (−1.2), so f and lens shape were confounded. **Why v3 failed:** in single-ellipsoid mode the path
length is the generic base length `lay.Lb` (not tuned) → with Ø85/f 54 a needle ellipsoid (e = 0.91, rim radius 24 mm), 58 lm in the window, 13 fails = "a small spot".
**The old "single ellipsoid = rung to beat" in the v3 ladders was therefore under-tuned** (not re-checked).

### 4.2 Two curvatures on one reflector (`gH`, curvature ratio g)
- g < 1 was **invalid geometry** (the round clip was wider than the surface's own horizontal semi-axis → steep wings). Ignore those rows.
- g > 1, f 54, x +24 (disc rim): g 1.04 → 18/5/3, 405 lm, 22.9k · 1.08 → 18/5/3, 389, 15.3k · 1.12 → 19/6/1, 369, 9.6k · 1.16 → 20/6/0, 345, 7.0k ·
  1.2 → 19/6/1, 315, 5.3k · 1.25 → 19/7/0, 272, 4.2k · 1.5 → 14/10/2, 145, 2.1k · 2.0 → 13/11/2, 318, 1.7k. An elliptical rim (the surface's own equator) gave the same numbers
  (g 1.25: 19/7/0, 290 lm, 4.4k; g 1.16: 20/6/0, 363, 7.5k). **g is a straight trade of hotspot for width; useful range ≈ 1.0–1.15.**
- **The "V" hotspot** (bottom half selected): bottom half alone, no shield: g 1.10 → peak 9.5k, a **V**; g 1.00 → 23.9k, one round hotspot; filament along y or z with g 1.00 → still round (23.2k / 23.5k).
  So the V comes from g, **not** from the axial filament (my first guess, refuted). Mechanism (*inference*, untested): the vertical section stays in focus, the sides defocus by an azimuth-dependent amount.
- g 1.25 (top) + g 1.5 (bottom), bottom focus +5, no shield (H3): 16/8/2, 508 lm (vs 811), peak 5.7k, **no ≥ 10 kcd region**. Halves alone: top g 1.0 → 17.3k / g 1.25 → 4.0k; bottom g 1.0 → 18.1k / g 1.5 → 1.0k and only 155 lm in window.

### 4.3 Split reflector: top / bottom half-bowls (4 M rays)
- Halves alone land in the **same place** (shared focus): top-only 15/7/4, 211 lm, 15.3k · bottom-only 15/9/2, 213 lm, 15.3k (shield on). Halves only add; splitting helps only when they **differ**.
- Shield on/off, whole bowl +24: 411 lm with the shield vs **869 lm** without (the shield takes ~53 %); peak 36.4k vs 36.5k (the hotspot sits below the cut-off). With the shield the fails are the minima above the cut-off (0 cd);
  without it they are the maxima (10U–90U boundary 2223, 1.5U/1U/0.5U ceilings) plus cut-off gradient/inclination.
- **Asymmetric path lengths** (g 1, both halves): C top +16 / bottom +32 → **20/2/4, 391 lm, 32.5k**, ≥ 10 kcd hotspot **±4.1°** · D top +32 / bottom +16 → 17/5/4 · A both +24, bottom g 1.25 → 21/4/1, 420 lm, 20.1k, ±2.9° · B top g 1.25 → 20/6/0, 278 lm, 17.3k.
- **E1 (top +16, bottom +32 g 1.5): 25/1/0, 291 lm, 17.2k** (reproduced at 8 M) — **but its ≥ 10 kcd hotspot is only ±1.6°**; g 2.0 / 3.0 on the bottom stay ±1.6° (the wide half is too dim to reach 10 kcd: wide half alone peaks 1.65k; regular half alone 20.0k).
- **Hotspot width** (top +16 g 1.0; bottom as given; ≥ 10 kcd width at the peak row): bottom +24 g 1.10 (**G2**) → **±5.1°, 20/0/6, 432 lm, 22.8k** · g 1.05 → ±4.5°, 20/1/5 · +28 g 1.10 → ±4.5..4.9° · both +24 g 1.15 → ±3.7°, 21/4/1 ·
  bottom +32 g 1.15 → ±2.5° · top g 1.1 + bottom g 1.15 → the hotspot **collapses** (10.4k). Keep the top half at g 1.0.
- **G2 with the shield removed:** 16/5/5, **796 lm vs 432**, peak moves onto the horizon; new fails are all the ceilings above the cut-off (10U–90U 1563 vs 125, 1.5U 1R–R 12.7k vs 1.4k, 1U 1.5L–L 10.7k vs 700, 0.5U 1.5L–L 11.6k vs 1k, 0.5U 1R–3R 17.4k vs 2.7k), cut-off gradient 0.088 < 0.13.
- **Focus shift** (bottom half, g 1.0, no shield): +0 → bottom alone 17.2k, ±2.1° · **+5 mm → 18.1k, ±2.4°, the V is gone (round soft blob), whole design unchanged** · +15 → 10.5k, ±1.1°. Smooth defocus cannot make a wide **flat-topped** ellipse: it makes a peaked blob that dims as it widens.

### 4.4 Four aimed quadrants (`half:'quad'`)
Each quadrant = a quarter-disc `quad` patch of a plain ellipsoid of revolution (g 1.0), foci = filament and `P3.imgPoint(P, lay, h, v, 0)` for its aim. **"Pointing" = moving the second focus in the lens focal plane; the filament never moves** (same as pivoting the patch about the filament).

- Aims UL 3L 0.5D / LL 1L 0.5D / LR 1R 0 / UR 3R 0 (my reading of "V" = horizon), path +24, f 54: each quadrant lands within ~0.5° of its aim, ~8.3–9.5 kcd, ~220 lm, half-max width ~7°.
  No shield (Q1): 15/7/4, 857 lm, peak 25–28k, ≥ 10 kcd blob ±5.0° × 8.5° tall. **Shield on (Q2): 20/3/3, 423 lm, blob 9.6° wide × 5.2° tall** (the wide ellipse she wanted); fails: 1.5U 1R–3R & 0.5U 1R–3R get 0 cd, 2D 15L 841.
- **New aims** UL 4L 0 / LR 1L 0.5D / UR 4R 0.5U / LL 1R 0 (no shield, +24): landings UL (−3.9, 0.0), UR (4.1, 0.7), LR (−0.9, −0.5), LL (1.0, 0.0); upper ~7.4k, lower ~10.5k each.
- **"Longer path = tighter spot" was WRONG for these quadrants.** Lower pair alone, half-max width / peak by path offset: +12 → 5.3° / 9.1k (centroid pulled off) · **+16 → 4.0° / 11.0k (tightest, on aim)** · +20 → 4.9° / 10.8k · +24 → 6.1° / 10.5k · +30 → 7.0° / 11.0k · +36 → 9.7° / 6.9k and 1–1.5° mis-aimed.
- Whole design (area of the ≥ 10 kcd blob / peak / lm): all +24 → 64 deg² / 27.9k / 853 · **upper +24, lower +16 (Q3c) → 55.5 / 27.8k / 799** · **all +16 (Q5) → 49.2 / 25.7k / 753** · upper +16, lower +8 (Q4) → 39.6 / 18.7k / 707 (lower +8 loses its peak: 6.2–6.7k, centroids skewed up/outward).
  Upper quadrants at +16: UL 8.4k, width 5.9° (better than +24), UR 8.1k, lands ~0.8° inward / 0.5° low of its aim.

### 4.5 Lens focal length (all quadrants +16, aims as Q3, 200 k rays unless noted)
- **No shield**, f 34…74 (smoothed peak / ≥ 10 kcd area / lm): f34 27.0k/51/767 · f39 9.6k/none/606 · f44 15.5k/23/695 · f49 16.3k/35/673 · f54 25.7k/49/753 · f59 27.9k/53/789 · f64 27.9k/57/808 · **f69 31.7k/61/795 (highest peak)** · f74 29.2k/68/866.
  Longer f (≥ 59) is better on blob size and lumens **and the lens gets much thinner** (63 mm at f 34 → 26.5 mm at f 74). The weak f 39–49 rows also got a different lens k (−1.2/−0.8): confounded.
- **Shield on**, f 34…94 step 5: scores (200 k, **optimistic compliance**): f74/f79 17/1/8 · f84 16/1/9 · f44 15/2/9 · others 10–14 pass.
- **IIHS left-edge reach** (definition, `js/road.js` ~82–89): sensor 4.95 m left, 0.25 m up; needs ≥ 5 lx **at 15 m first** (≈ 1.2 kcd at ~18° L, 1.5° D), then holds out until the first drop below 5 lx.
  Left reach was 0 m for 12 of 13 lenses. At 4 M rays **f 44 = 28.5 m** (lux 5.1/5.6/5.8/5.0 at 15/20/25/30 m; right reach 68 m) is the only non-zero. f 74 (E15 4.6, near miss, right 83 m), f 84 (E15 3.1, but 8.6 / 7.9 lx at 40 / 60 m; right 101 m).
  References: spec-hl-v2 left 22 m, sqm-hl left 61 m.
- **f 84, upper quadrants aimed 1 / 1.5 / 2° further out** (UL 5L/5.5L/6L, UR 5R/5.5R/6R), shield on, 2 M rays: left lux at 15/20/25/30/40/60 m — none: 3.0/4.2/5.8/6.6/8.4/7.3 · +1° 3.4/3.9/5.7/7.5/9.0/7.6 · +1.5° 3.0/4.4/5.9/8.0/9.2/7.5 · **+2° 3.4/4.7/7.1/9.4/9.7/7.2**;
  official left reach still 0 (E15 < 5). **At 2 M rays the +2° design is 18/7/1, not the 16/1/9 that 200 k showed.** Fails: 4U 8L 0.0, 4U 8R 0.0, 2U 4L 0.0 (the shield blocks everything above the horizon), 0.5U 1R–3R 20.2k, 0.86D 3.5L 15.1k, 2D 15L/R 541/464.

### 4.6 Paraboloid strip (the horizontal band through the filament plane)
Band 8.7 mm tall (≈ 15 % of the bowl area) cut out of the four quadrants and rebuilt as one paraboloid (`curv [1/2p, 1/2p, 0, 0]`, p = 8 mm, LED at the focus, axis 0.5° down). The paraboloid collimates the light; **the lens turns lateral position into horizontal angle** (exit angle ≈ tilt − lateral/f), so a strip spanning ±37 mm fans out to about ±24° with no horizontal curvature tricks.

| | without strip (B0 = U-f84-out2.0) | with strip (B1) |
|---|---|---|
| pass/fail/unsure (2 M) | 18/7/1 | 18/4/4 |
| lm in window / peak | 464 / 30.0k | 419 / 26.8k |
| 2D 15L / 2D 15R (min 1000) | 541 / 464 | 975 / 851 |
| 0.86D 3.5L (max 12k) | 15.1k | 12.75k |
| 0.5U 1R–3R (max 2.7k) | 20.2k | 16.7k |
| left lux at 15/20/25/30/40/60 m | 3.4/4.7/7.1/9.4/9.7/7.2 | 4.2/5.5/6.2/7.8/7.8/5.9 |
| IIHS right reach | 96 m | 87.5 m |

Strip alone: peak 3.5 kcd at (1.8°, −0.3°); **≥ 1000 cd across ±15°** (v −4.0…+1.3°), ≥ 300 cd across ±25°; 119 lm in window. Cost: ~45 lm and ~3 kcd of peak from the main hotspot. 4U 8L/R and 2U 4L stay at 0 cd (shield).

**B2 = the same strip extended to the bowls' rim depth** (lateral ±26.5 mm instead of ±24; `solver/p3-band2.js`, scene `scenes/B2-strip-to-rim-depth.scene.json`). Found *after* I wrote the leak analysis, while checking this handoff:
2 M rays 17/4/5, 422 lm, peak 27.7k, IIHS reach R/L 87/56 m; **4 M rays: 19/5/2, left lux 5.1 / 5.6 / 6.4 / 6.4 / 4.7 / 1.4 lx at 15 / 20 / 25 / 30 / 40 / 60 m → official LEFT reach 33.5 m, right 87 m.**
B1 at 4 M: left lux 4.6 / 5.4 / 6.4 / 6.8 / 5.1 / 1.4, left reach 0 m, right 88 m. **B2's left reach sits right on the threshold (E at 15 m = 5.1 lx vs 5 lx needed; the 2 M run said 56 m, the 4 M run 33.5 m), so treat it as "just crosses", not a stable 33 m.**
Still, it is the first f 84 design in this session with a non-zero left reach (spec-hl-v2 22 m, sqm-hl 61 m), with right reach 87 m (spec-hl-v2 61, sqm-hl 62.5). Not yet loaded in the preview (B1 is).

### 4.7 Where the light goes (B1, 1300 lm emitted; `fate2.js`, 40 k sample rays, first surface touched)

| first surface touched | lm | lands on the 25 m target | absorbed by the shield | escapes |
|---|---|---|---|---|
| lower quadrants | 400 | 195 | 176 (44 %) | 29 |
| upper quadrants | 360 | 161 | 159 (44 %) | 40 |
| strip | 287 | 87 | 129 (45 %) | 67 (50 at 11–25° sideways, 15 beyond 25°) |
| **nothing at all** | **242 (18.6 %)** | – | – | 242 |

Engine ledger: reflected 370, absorbed 530 (shield-blocked 427), escaped 360, lens interface loss 38.
- The strip intercepts 22 % of the lamp (more than its 15 % area share) because the axial filament emits most strongly sideways (60–105°).
- **The untouched 230–242 lm are emitted at 10–60° from the +x axis** (20–40°: 88 of 88 lm; 40–50°: 66 of 75; 50–60°: 32 of 96), uniform in azimuth: the forward cone between the bowl rims and the lens (the lens catches only ≲ 15°). My first guess (an open slot where the band was removed) was **wrong**: extending the strip changed it 242 → 230 lm.
- **Geometry fact:** an ellipsoid's equator is always **D/2 ahead of the filament**, so the mouth half-angle is tan φ = b/(D/2), b = ½√(2Dx + x²). A bigger bowl opens the mouth wider and catches *less* forward light. Catching the 15–50° cone needs surface **beyond the equator** (the forward part of the ellipsoid up to F, grazing incidence). My tangent-plane `quad` patches cannot represent that (not a graph over the plane).
- **Shield loss vs blur** (back-of-envelope, *not tested*): loss ≈ the fraction of each image above the cut-off line; Gaussian blur σ with the aim 0.5° below the line: σ 4° → 45 % (matches the measured 44 %), 2° → 40 %, 1° → 31 %. Tighter focus helps slowly; **aiming lower** (or Liou's emitter-end placement) is the faster lever.

---

## 5. Code and repo state

**Committed (local `main`, NOT pushed):**
- `ec9b4b3` viewer: `RF.Geo.mesh` meshes big curved facets/quads (display only; `outline()` unchanged) · `70715f2` viewer: split long clip edges before meshing (fixed the flat "lids" on half-bowls).
- `262ed58` spec: `RF.Spec.evaluate(G, md, opts)` takes `{frozen:{base,reaim,note,cutV}}` or `{noBox:true}`; `SpecUI.update` holds the aim while a run is tracing and does one full judgement at the end.
  Measured: FMVSS LB2V, 2 M rays: full 476 ms vs frozen 4.0 ms with identical rows; in the app 8 progressive judgements of 3.8–5.4 ms + one full 491 ms. `node tests/headless.js` 24/24, `node tests/spec.js` all passed.
- `fbbe19c` `haiku55-spots` (clean benchmark) · `bca7b59` `haiku55-v2` (second attempt, index note "second attempt, not a clean benchmark").

**Uncommitted:** this file and `tools/projector-v3/v4-scratch/` (≈ 1.2 MB: scripts, the final patched solver `solver/p3-band2.js`, 7 key scenes). `out/` inside it is git-ignored. **The experimental settings are not in `dev/*.js`** — only in the patched copy. If v4 adopts them, port to `dev/main.js` / `dev/ellipsoid.js` and rebuild.

---

## 6. Ideas that did NOT work (so nobody repeats them)

- "Longer path = tighter spot": opposite for the lower quadrants beyond +16 (wider, dimmer, mis-aimed).
- g < 1 (invalid geometry) and g ≥ 1.25 on the top half (hotspot collapses); g as a way to a wide flat ellipse (it blurs).
- Axial-filament streaks as the cause of the V: refuted (filament orientation made no difference).
- A +5 mm focus shift as a widening tool: no effect on the whole design.
- "Open slot at the strip" as the leak: wrong (see 4.7).
- Reading compliance from 200 k rays: zero-light rows show as "unsure" and resolve as fails at ≥ 2 M.
- Lower quadrants at +8 (too short): peaks fall to ~6.5k, light skews up/outward.

## 7. Not done / next, roughly by value

1. **Facet ring for the forward cone** (15–60° off axis): v3's facet machinery (cells + `facetOf`) on top of the quadrants/strip. Estimated +100 lm reflected (~+55 lm in window) — *inference*.
2. **Light above the cut-off with the shield on:** 4U 8L / 4U 8R / 2U 4L get exactly 0 cd. Needs some light over the shield (a stepped/lowered shield edge or dedicated upward-aimed small facets). Also 0.5U 1R–3R is ~6× over its maximum.
3. **Left edge:** a quadrant (or strip tile) aimed far left (~12–15° L, ~1–1.5° D) would feed the near points the IIHS reach needs (E at 15 m is 3–4.2 lx; needs 5).
4. **Strip tuning:** height (area), tilt, paraboloid focal length `p`, radius limit; a taller strip for the last 2.5–15 % on 2D 15L/R.
5. **Shield loss:** aim images lower / emitter-end placement / tighter images — test the σ-vs-loss estimate in 4.7.
6. **Decide the v4 structure** (not agreed yet): stage 0 = scan path length, f and lens radius for the single ellipsoid, scored by the **engine judge** (the model cannot see astigmatism or the aims); stage 1 = fracture (halves → quadrants → strip/facets), one tweak at a time; budget = a **cap** with a coarse swept count.
7. Bigger path offsets *with* the strip ("further from the filament = smaller hotspots", Anya's idea) — only tested on the quadrants.
8. Separate lens shape from focal length (the sweep confounded `f` with lens k); re-run the f sweeps at ≥ 2 M rays for compliance.
9. Older backlog: cropped/rectangular lens; fully screenless Liou zones; LS430 supplementary reflector; periscope / Sun 2020 two-bounce + toric lens; Profile-mode upgrade (radial × angular facets on one shell). A separate session logged a **Liou screenless replication** request in the memory file (10-08) — not part of this session.
10. Push the five local commits (Anya has not asked); port the experimental settings into `dev/`; UI QA pass (blank canvas after pane collapse).

## 8. Gotchas found

- **Page reload in the preview:** the app restores the saved solver choice a few seconds later and runs `generateA()`, overwriting a scene loaded in that gap even with `autoA = false`. Wait for `ui.solving === false` and "up to date", **then** `loadScene` and set `store.autoA = store.autoSet = false` (session-only).
- An **undo** (history entry "Envelope resized") silently restored the scene's old solver id mid-run — check `RF.Solvers.current(scene)` and the "Saved with the scene: …" line before attributing numbers.
- The status-bar **Details notes can belong to the previous solver**; I once read v2's "stigmatic Ø88" note as v3's.
- A `quad` reflector needs **`front: 1`** when `n` points into the bowl and `curv` is the sag form (`front: -1` → every ray "backface", 1 lm). `RF.Engine.probeRay` shows it immediately.
- **My TSV rows were cut at 62 characters** ("surf 2" was "surf 29"): check the raw log before calling a design broken.
- 200 k rays: IIHS reach and left-edge lux swing a lot (f 79 right reach 95 vs 72.5 m between 200 k and 1 M). Judge reach at ≥ 1 M, compliance at ≥ 2 M.
- `leftreach2.js` prints the **wide-window** lm, not the narrow "lm in window" — do not compare the two.
- macOS has no `timeout`; the shell tool blocks a leading `sleep`; use an `until … do sleep` loop.

## 9. First steps for the next session

1. `cd tools/projector-v3/v4-scratch && sh run.sh t1 '"half":"quad","hUL":-6,"vUL":0,"hLR":-1,"vLR":-0.5,"hUR":6,"vUR":0.5,"hLL":1,"vLL":0,"shield":"auto","xQ":16,"xLow":16,"focal":84,"band":8.7,"bandP":8,"bandTilt":0.5' 2e6`
   — should print **B2** (the strip extended to the rim depth): 17/4/5, ~422 lm, peak ~27.7k, 30 surfaces, reach R/L ≈ 87/56 (verified 10-08). If it does, the bench works.
   **B1 (the design that was in the preview) was built with an earlier copy, `p3-band.js`, that is NOT included** — its scene is in `scenes/B1-f84-band8.7.scene.json`; B2 differs only in the strip's lateral limit (±26.5 vs ±24 mm).
   For the earlier no-strip design add `"band":0` (reproduces U-f84-out2.0 / B0: 18/7/1, 464 lm, 29984).
2. Ask Anya what she wants first (items 1–3 in §7 are the likely ones); confirm her real filament offset in the Ø90 × 200 scene.
3. Everything above is also in the Flux memory file (`project_flux_sketchpad.md`, blocks "2026-10-07 night — v4 REOPENED" and the fixed-bug block) with the same numbers.
