# projector-liou — the screenless branch of projector-v3 (started 2026-10-08, Opus, Anya away)

Mode: **exploring**. Numbers are observed unless marked *inference*. Compliance only from ≥ 2 M rays.

## Goal (Anya, 10-08)
Replicate the IDEA of Liou 2009 (a halogen projector whose low beam has a usable cut-off with NO shield): a faceted ellipsoidal bowl + a
Ø~90 flat-in lens in a ~Ø90 × 200 mm package (bowl Ø90 ± 30, wider envelope OK if it pays). Wins, in order: compliance with no shield
(a small clean-up shield is acceptable; target < 20 % absorbed vs ~40 % now) → IIHS reach ~80 m right / ~60 m left (left: the 15 m point may
be under 5 lx if the shoulder is painted > 5 lx somewhere) → her subjective beam preferences (memory file). Should generalise to an
up-firing LED (the LED design = a radial section of the halogen one). Lens: free, but justify leaving the standard projector lens; toric out of scope.
Separate solver; not registered in `solvers/index.json` until she says so.

## Paper facts (Liou 2009, Proc. IMechE D 223:1549) — see the memory file block 2026-10-08
ECE R112 (old 25 m lux table), H1 bulb, no dimensions, simulation only. One SMOOTH reflector, 6 circumferential zones; the first focus moves
along the filament (upper zones: front end; lower zones: front → rear), so every filament image lands under the cut-off.

## What this branch changes (dev/ copied from projector-v3 at 262ed58)
- `shield` default **off**; `bypass` default off (no room beside a Ø88 lens in a Ø90 tube); `polishRounds` default 0 (v3's polish ignores the screenless rule).
- **Moving first focus**: every lens-path cell gets alternatives = the emitter centre + `along` points per side out to each end (`P3.emitterPoints`), always (v3: ends only, finalists only).
- **Screenless placement** (`main.js` `snap`, `greedy.js` `o.snap`): a footprint may sit only where ≤ `leak` (1 %) of its model light is above the cut-off line − `edgeMargin`; a spot that leaks slides DOWN (binary search) to the highest row that does not. The footprint and the emitter point are chosen together by the greedy.
- **Path length scan** (`pathScan`, default 16,24,32 mm beyond the focus distance): Sonnet's v4 bench found path length is the lever v3 never tuned.
- Lens: flat-in only by default, `fillLens` (aperture = the largest that fits), focal search 42–84.

## Harness
`./run.sh <name> '<settings fragment>' [rays]` (env SCENE, BUDGET) → `out/<name>.{log,png,scene.json}`. Scenes: `scenes/her-fmvss.json`
(her `reflector-scene-custom-profiles.json` = Sonnet's B2 bench: HB3 1300 lm 20 mm from the rear of a Ø90 × 200 cylinder, FMVSS LB2V) and
`scenes/her-r112b.json` (same, ECE R112 class B).
Reference on the same scene: Sonnet's B2 (shield + quadrants + strip) 17/4/5, 422 lm, peak 27.7k, reach 87/56 (2 M rays, re-run 10-08).

## Results
| run | rays | pass/fail/unsure | lm in window | peak | reach R/L | notes |
|---|---|---|---|---|---|---|
| smoke1 (f 54, +24) | 200 k | 15/1/10 | 384 | 26.6k | 65/0 | first screenless design. Minima above the cut-off now PASS (4U 8L/R, 2U 4L, 1.5U 1R–3R: the shield-induced fails of B2). Cut-off gradient 0.81 (≥ 0.13). Fail: 0.5U 1R–3R 7.4k > 2.7k; model sees it too (7.8k). 140 of 149 facets chose an off-centre focus point. |
| base2m (f 54, +24) | 2 M | 20/2/4 | 384 | 20.9k | 61/0 | fails 0.5U 1R–3R 4.8k (max 2.7k), 2D 15R 571 (min 1000). Already beats B2 on compliance, ~40 lm and ~7 kcd behind it. |
| leak0 / margin03 / along1 / f74 | 2 M | 15/3/8 · 19/2/5 · 18/3/5 · 13/9/4 | 360 · 391 · 395 · 281 | | | lowering every image 0.3° did NOT fix 0.5U 1R–3R → not per-facet leak. along1 (ends only) loses the hotspot (1.5D 2R fails). f 74 is bad here. |
| edge1 (+ screenless line-shift search) | 2 M | 22/2/2 | 380 | 22.5k | 62/0 | |
| refine1 (+ re-trace placed facets at their real aim, slide down) | 2 M | 17/1/8 | 358 | 21.3k | 56/0 | model light above the line 34 → 18 lm; 0.5U 1R–3R 2994 (unsure). |
| k_cb00 / k_cb01 / k_cb11 / k_cb11g5 (cap, holder; k −1.2 dropped) | 2 M | 17/1/8 · 15/2/9 · 17/4/5 · 18/3/5 | 358 · 394 · 339 · 360 | | | engine absorbed 94 · 137 · 247 · 210 lm. The cap costs ~100 lm and hurts; the holder is ~neutral. |

### Findings (10-08)
1. **Screenless works on this bench**: no shield, cut-off gradient 0.3–0.8 (≥ 0.13), and the FMVSS minima above the line that B2's shield zeroed (4U 8L/R, 2U 4L, 1.5U 1R–3R) PASS.
2. **The nominal-aim footprint lies for facets near the bowl vertex** (12–16 mm behind/around the filament, magnification ~8, images ~12° rms): placed at ≤ 1 % leak, they really leaked 26–36 %. Re-tracing at the real aim and sliding down (`refine`) fixes it.
3. **The FMVSS own-side rule is generous**: the cut-off line rises to +1° by ~1R but 0.5U 1R–3R is capped at 2700 cd; the line-shift search handles it (like v3's shield edge search).
4. **Direct light** (emitter → lens, no reflection) alone gives 10U–90U ≈ 134 cd (max 125): the shield used to stop it. A direct-light cap fixes that row but shadows ~100 lm of reflector light (the vertex region's rays pass the axis there). Unsolved; candidates: a smaller cap closer + accept, or tilt the vertex facets' light below the cap.
5. **Model vs engine disagree badly on the flat-in k −1.2 lens** (model 3 fails, engine 8–14); dropped from the search; the engine check now looks at the best three.
6. Rays that miss the lens: the model let them fly straight (passBy, 34–41 lm); the engine's lens edge absorbs part. With `barrel` the model absorbs them too.
| full_def (default lens search: picked f 64) | 2 M | 17/6/3 | 341 | 19.0k | 54/18 | wide right gone (2D 15R 66, 4D 20R 63). The model prefers f 64; the engine does not. Keep f 54 for now. |
| r112_f54 (R112 B, f 54, +24) | 2 M | 7/5/7 | 366 | 13.4k | 30/0 | NO HOTSPOT AT THE LINE: 75R 626 (≥ 10.1k), 50R 1.9k, Zone I 14.8k (≤ 3.9k), Zone III 2.2k (≤ 625). Far field = a broad low wash, brightest far down-left. |
| w120_byp / w120_nob (Ø120 envelope, lens Ø88) | 2 M | 16/4/6 both | 317 | 8.8k | 37/16 | identical: bypass found 0 eligible lm (directOk needs d·x ≤ 0.85 AND ≥ a+4 lateral at the envelope depth). The bigger bowl (rim to 82 mm) dimmed the hotspot. |
| edge1 at 4 M (judge-scene) | 4 M | 21/3/2 | 380 | 22.4k | | far field (out/edge1-4M.png): left cut-off clean and flat; the hotspot top BULGES above the line at 1–3R (0.5U 1R–3R 4.7k, inclination 1.1 at 4 M vs 0.15 at 2 M = noisy row). |

7. **R112 needs the bright part ON the line** (75R/50R sit at 0.57D, the line itself); FMVSS's hot points sit 0.2–1.1° below its line. The ≤ 1 % leak rule parks a big image's core degrees under the line. *Inference*: the edge must be made by the SHARPEST facets (small images, rim/far facets, end focus so the streak hangs down from a bright top) and the blurry near-vertex facets belong in the foreground. Liou: 75R 16.7 lx ≈ 10.5 kcd, hot spot 20 lx ≈ 12.5 kcd (a flat beam).
8. Wider envelope (Ø120) did not pay as built; the forward cone (219 lm escaping forward > 25°, `fate2`) is the biggest single loss and bypass did not engage.
9. Loss ledger (k_cb01, fate2, 1300 lm): facets → target 393 · emitted, touching nothing → forward > 25° 219, backward 141 · facet → absorbed by facets 152 (≈ 90 mirror loss + backs of other facets) · facet → forward 11–25° 120 · → misses the target plane < 11° 90 · lens holder 43.
| flatR (own-side line shift search to 2.0°) | 2 M | 15/2/9 | 394 | 15.9k | 57/15 | picked R 1.2. |
| flatR_scan (same + path scan 16/24/32) | 2 M | 18/2/6 | 452 | 16.6k | 53/0 | +60 lm from the path scan. |

**State at the 10-08 pause:** FMVSS on her bench sits at ~2 fails with no shield, steadily **1.5D 2R** (~11k, min 15k: hotspot too weak/wide) and
**2D 15R** (290–570, min 1000: no wide right light); the rest is near-threshold "unsure" (run-to-run spread ±2–3 passes at 2 M rays). Light: 360–450 lm in window
(B2 with shield 422). R112 B is far off (no hotspot on the line). Defaults now: shield off, cap off, barrel on, k ∈ {−0.5, −0.8}, f search 42–84 (but f 54 fixed is better), path scan 16/24/32.

## Next (by value, my read)
1. **Edge facets by sharpness**: assign the cut-off edge to the facets with the smallest image tops (rim/far facets, end focus with the streak hanging down), the near-vertex facets to the foreground. Needed for R112 (75R/50R on the line) and the FMVSS hotspot (1.5D 2R).
2. **Wide right (2D 15R, 4D 20R)**: the own-side line shift pushes right-hand light down/in; check where the ideal beam asks for 15–20R light and whether the lens field (f 54, ±15° → 14.5 mm off axis) loses it.
3. **Forward cone (219 lm)**: catch it — bypass ring needs a looser `directOk` (d·x ≤ 0.85 excludes 25–32°), or a forward facet ring that feeds the lens.
4. **Direct light → 10U–90U**: a cap that does not shadow the reflector (smaller, closer; or move vertex facets' rays off-axis).
5. Engine-in-the-loop for the final pick: the model and the engine disagree on wide rows (full_def).

## 10-08 round 2 (Anya: "would a slot shield avoid blocking necessary light while cutting the stray uplight?" + "trading a little shield loss for candela near the cutoff is worth exploring")
Answer given: a focal-plane shield is a FIELD STOP — the lens maps focal-plane position → far-field direction for every ray (direct light too), so any shape
(edge, slot, windows) is a far-field mask. The 40 % loss of a classic shield is images STRADDLING the line, which only placement fixes; screenless placement
+ a thin cleanup shield turns the leak tolerance into a loss-vs-candela-at-the-line knob. Production shields have sign-light slits/notches.
Built: **edge pass** (`edgeSharp` 1.5° rms, `edgeBand` 1.5°: sharpest facets first, scored on the band under the line, residual debited for all their light;
greedy `o.subMask`), **`shield: cleanup`** (screenless placement + a shield on the searched line), **sign-point windows** (`slitDeg` 0.6: square holes at the
focal-plane points of spec minima above the line; model + engine strips split around them).
Data: sharpest-alternative vertical rms of the 150 facets: p10 1.3°, p50 3.2°; lm ≤ 1° 39, 1–1.5° 48, 1.5–2° 73, 2–3° 119, 3–5° 198, > 5° 241 (of 719 through the lens).

| sweep 1 (2 M, f 54, +24, edge pass on, no windows yet) | pass/fail/unsure | lm | absorbed (engine) | peak | reach R |
|---|---|---|---|---|---|
| FMVSS off | 17/4/5 | 394 | 129 | 23.3k | 67 |
| FMVSS cleanup leak 1 / 10 / 25 % | 12/7/7 · 14/4/8 · 16/6/4 | 340 · 325 · 320 | 192 · 232 · 246 | 17–19k | 55–69 |
| R112 off | 6/7/6 | 366 | 120 | 19.4k | 14 |
| R112 cleanup 1 / 10 / 25 % | 11/3/5 · 7/4/8 · **11/1/7** | 310 · 309 · **360** | 186 · 237 · **184** | 17.4k | 55 |
R112 cleanup 25 %: 75R 8.9k (≥ 10.1k, unsure), Zone III 561 (≤ 625) pass; only hard fail Point 8 (sign point killed by the shield) → the windows.
FMVSS: the shield does not pay (loses light, kills 4U 8R); the edge pass lifted 1.5D 2R to 15.3k (pass). R112 judge cut-off finds vary run to run (inflection −0.57…+2.18°): R112 rows are noisy.

| sweep 2 (4 M rays, f 54, edge pass, windows slitDeg 0.6) | pass/fail/unsure | lm | absorbed | peak | reach R/L |
|---|---|---|---|---|---|
| **R112 cleanup leak 25 %** | **16/0/3** | 363 | 181 (off ≈ 120 → shield ≈ 60 lm ≈ 5 % of the lamp) | 16.2k | 63/0 |
| R112 same + path scan | identical (scan picked +24) | | | | |
| FMVSS cleanup 25 % | 17/3/6 | 316 | 254 | 19.0k | 63/0 |
| FMVSS off | 17/4/5 | 394 | 129 | 22.6k | 70/0 |
R112 unsure rows: Zone III 2817 ± 540 (≤ 625), Point 8 221 (≥ 125, fed through its window), cut-off sharpness 0.90 (R112 B wants 0.13–0.4: the edge is now TOO sharp).
Far field (`out/s2_r112_c25.png`): the windows show as square patches on the sign points; a bright band right under the line; on the own side (3–10R) the beam
top rides above Zone III's lower edge → the own-side line shift is too generous for R112. FMVSS: shield off stays best; its fails are the wide rows (2D 15L/R, 4D 20L/R) + 0.5U 1R–3R.
Next: R112 own-side line vs Zone III; shield defocus for sharpness ≤ 0.4; FMVSS wide rows; IIHS left reach (0 everywhere so far).

## 10-08 round 3 — efficiency (Anya: "surprised how much we're still losing; Liou's appeal was avoiding the shield loss")
`vbands.js <scene> [rays]` = lumens per vertical band from a ±80° engine far field (window vs outside).
| design (FMVSS) | forward ±80° | in window | below −10° | above +15° | untouched (fate2) |
|---|---|---|---|---|---|
| plain smooth ellipsoid, f 54, +24, NO shield (v4-scratch e0ns) | 1062 | **869** | — | 58 | reflector catches 1212 lm (93 %) |
| Sonnet B2 (shield) | 699 | 422 | 122 | 90 | — |
| liou s2_fm_off | 726 | 394 | 200 | 97 | 508 (231 backward, 225 forward > 25°) |
| liou overlap 1.15 / 1.3 | 677 / 643 | 390 / 404 | | | 299 / 279 |
| liou centre focus only (no steps) | 634 | 346 | | | 622 |
**The bottleneck is the faceted tiling, not the method**: the smooth bowl + lens passes 869 lm into the window; the faceted screenless design catches far less
of the lamp (≈ 790 vs 1212 lm), and closing the slits (overlap) does not raise window lumens (the caught light is lost elsewhere — not yet traced). Even with
no steps (centre focus) 622 lm is untouched → v3's cells/polygons cover much less of the sphere than the smooth cup (cell gating + `cellPoly` pulling vertices in).
Liou's surface is CONTINUOUS — that is probably the point. Next candidate: a continuous Liou surface (shared-vertex mesh of local-ellipsoid patches, the first focus varying smoothly along the filament with azimuth), not v3 cells.
Also: `solvers/index.json` now lists projector-liou (LOCAL, uncommitted; Anya asked to see it in the preview). Rebuild in the app reproduces s2_r112_c25 exactly (deterministic).

## ⭐ 10-08 round 4 — the lumen bug (inherited from projector-v3)
`coverage.js <scene>`: from the filament centre/ends, the share of emission directions that hit any facet. The faceted designs covered only **45–65 %** of
40–120° (plain bowl 100 %). Cause (instrumented, `P.polyStats` / `P.polyWhy`): `depthChoice` lets a cell sit on the ENVELOPE WALL (`rhos.push(rmax − 0.5)`)
instead of the base ellipsoid, and it usually wins (farther = smaller image); a wall cell's facet has no room, `cellPoly` pulls its corners in → median facet
kept **55 %** of its cell (1512 "outside envelope" rejections vs 46 other). Fix: `wallHug: false` (default here) → every cell on the base cup; kept area
p10 1.00; coverage ~100 % at 40–140°.
| run (2 M, f 54, +24) | pass/fail/unsure | lm in window | peak | reach R/L |
|---|---|---|---|---|
| FMVSS off (was 17/4/5 · 394) | **21/2/3** | **624** | 32.8k | 63/0 |
| FMVSS cleanup 25 % (was 17/3/6 · 316) | 20/1/5 | 552 | 23.3k | 69/36 |
| R112 cleanup 25 % (was 16/0/3 · 363 at 4 M) | 14/0/5 | **533** | 21.7k | 54/0 |
⚠️ projector-v3 (registered in the app) has the same wall-hugging rule: its lumens are probably capped by it too. Not changed there.

## 10-08 round 5 — R37 bulbs (Haiku agent + Anya's R037r7e.pdf drawings read by me)
Presets added to js/source-presets.js ("Halogen (UN R37)" group, generic 12 / 13.2 V switch): H1, H7, H9, H11, HIR2, HB4 (+ HB3 regrouped). All AXIAL (drawings).
Diameters: H7 1.3 / H9 1.4 / H11 1.4 = the sheets' objective d max.; HIR2 1.6 max.; H1, HB4 not on the sheet → 1.4 assumed. Obscuration copied onto
`source.obscuration` (H1 cap ε 45° ± 12°, H7/H11 black top γ3 30° min.; HB4 black top angle NOT read yet). Solver `cap: 'bulb'` (now default) = a Ø8.5 disc
on the emitter axis where that half-angle cone from the filament's front end meets it. Agent data: scratchpad filaments/r37_agent.json (2014 Supplement 42 text,
97 % of quoted cells verbatim in the downloaded source; orientation/diameters missing there — drawings are images).
| bulb @ 12 V (FMVSS, shield off, f 54, +24, 2 M) | source lm | pass/fail/unsure | lm in window (share) | peak | reach R | absorbed |
|---|---|---|---|---|---|---|
| HB3 (nowall) | 1300 | 21/2/3 | 624 (48 %) | 32.8k | 63 | — |
| H7 bare | 1100 | 18/2/6 | 591 (54 %) | 26.7k | 79 | 136 |
| H7 + black top | 1100 | 20/2/4 | 569 (52 %) | 25.8k | 75 | 186 (top ≈ 50 lm); 10U–90U no longer flagged |
| H1 + cap 45° | 1150 | 16/3/7 | 481 (42 %) | 18.1k | 61 | — (45° cap shadows reflector light; 10U still 292) |
| H7 + top, R112 cleanup 25 % | 1100 | 15/0/4 | 502 (46 %) | 26.7k | 63 | HB3 same: 14/0/5, 533 (41 %) |
Shorter filament → higher share in window and longer reach (Anya's guess holds). FMVSS steady fail: 0.5U 1R–3R (own-side light over the line).

## 10-08 round 6 — continuous mode (`surface: 'continuous'`, dev/continuous.js) — Anya: stepped = default, continuous = curiosity mode
1. Fit smooth fields (Fourier order `contM` 4 in azimuth × quadratic `contN` 2 rim→vertex, flux-weighted) to the stepped design's per-facet t (focus along the filament) and h.
2. v: `contV: 'snap'` (default, Liou's rule) = each mesh patch as HIGH as it can go without leaking (its own traced footprint), fitted from below; 'fit' = follow the stepped design (fails without a shield: the stepped v's scatter ~20° rms, big images deep, sharp ones at the line).
3. INTEGRATE the surface: least squares for log ρ at every mesh corner from the target normals (bisector of the directions to S0 and I): ∂ log ρ/∂s = −(n·τ)/(n·d); weak prior to the base cup's scale; 3 passes. The non-integrable part (curl) is reported as `normal mismatch` (≈ 2.5–3.6° rms).
⚠️ Smooth PARAMETERS alone did not make a smooth surface (steps p50 0.21 / max 2.4 mm, same as stepped): each patch was its own tilted ellipsoid on the base cup. Integration did (p50 0.08–0.11, max ~1.0 mm with a 6 × 24 mesh).
| FMVSS 2 M, f 54, +24 | pass/fail/unsure | lm | peak | steps p50/max |
|---|---|---|---|---|
| stepped off | 21/2/3 | 624 | 32.8k | 0.21 / 1.8 |
| continuous off (snap) | 16/6/4 | 530 | 24.3k | 0.11 / 1.2 |
| stepped cleanup 25 % | 20/1/5 | 552 | 23.3k | |
| continuous cleanup 25 % (snap) | 17/3/6 | 533 | 24.9k | 0.08 / 1.0 |
Cost of continuity: ~90 lm and a few rows without a shield (its ~3.5° normal mismatch spills light over the line: 10U–90U, 1U/0.5U 1.5L–L), ≈ nothing with the cleanup shield.

## LED / LEP agent data (10-08): scratchpad/leds/agent_json/*.json (+ *_report.md). Luminus 16, automotive 13 + catalog 26, Nichia/Samsung 13; Cree and LEP pending.
