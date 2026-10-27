step 0 ok (base e4fe61e, branch feat/scatter-cull)

# SC + SP: oncoming in-scatter culling, lamp-centred table auto mode

Worktree .claude/worktrees/sc, branch feat/scatter-cull, base e4fe61e. Builder: Sonnet 5.5, job 1 of the wrapper (SC + SP; SR and SM are not here).
Labels: OBSERVED = measured or read in this session; INFERRED = reasoning, not tested.
Paths: the contract says reports and shots live outside the worktree; the task said reports/SC.md and overnight-shots/SC/ inside it. I followed the task.
Where the briefs sit: .claude/briefs/ is untracked, so it is not in the worktree; I read the briefs from the main checkout (read only) and wrote nothing there.

## SC: what was built

Option `scatterCull` = off | exact | fast (registry, default **exact**), plus `scatterCullEps` (fast-mode threshold, log slider, default 0.05).

- js/drive-three-halo-cull.js (new, pure maths, loads in Node): `beamExtent` (the non-zero texel box of a beam's LUT, as angles), `coneClip` (planes bounding the directions a beam can light, for conventions A, B and S), `ballClip`, `fastRadius`, and `litBound(view, clips)`, the one function that turns a list of clips into `{ k0, k1, rect }`. The clips are data: SM adds one more entry (the distance at which the beam meets the ground, from the CPU ribbon) without touching the rest. No GPU readback anywhere.
- js/drive-three-halo.js: per lamp, `litBound` runs on the CPU; the table pass draws one mesh of quads (one quad per depth slice in [k0, k1], each covering only the table cells in the rectangle) instead of the full-screen quad. The shader text, the steps, the sub-passes, the prefix pass and the lookup are unchanged. Polar tables: same slice range, full angular extent of the tile (SP changes that).
- UI: a select "in-scatter culling" in the advanced halo group (spec-ui.js), a log slider for the fast threshold in the same group (drive-anim.js, next to the air beam gain slider; disabled/hidden unless fast). Both are in the cache keys and in the look that drive-anim.js builds. Kept out of the halo-quality bundle on purpose (it would make every level read "custom").
- Tests: tests/scatter-cull.js (Node; brute force), tests/regress/SCULL-scatter-cull.js (page; real table bytes), both registered in tests/gate.js (NODE, PAGE_PAR, and the MAP row of drive-three-halo.js, which now also matches drive-three-halo-cull.js). Tools: tests/tools/sc/measure.js (GPU ms), tests/tools/sc/fastdiff.js (table and frame differences, shots).
- Docs: OPTIONS.md and GROUPS.md regenerated, RENDER.md step 4a, frozen defaults in tests/options-registry.js (91 -> 93 keys).

### Design choices (with the why)
1. **The bound is a convex polytope in the car frame, clipped by planes, not a sample of directions.** OBSERVED first attempt dropped the cap faces while clipping and lost every vertex where three cuts meet (the cone's apex): the Node test caught it (169 of 240 random lamps came back empty). INFERRED lesson: a conservative bound has to be a proof, so the test is brute force over about 1.3 million lit (cell, distance) samples, not a few poses.
2. **Exact = the shader's own non-zero rule.** A sample is non-zero only if texel base or base+1 is in the non-zero box, so the angle span is the box widened by one texel (that is the "widen by one texel" in the brief, derived rather than guessed), plus a float margin, clamped to the LUT window (outside it otherIntensity returns 0). The beam's data is read from the texture the shader reads (`u.otherBeam`), once per atlas pack (cached per texel array), so it needs no change to drive-three.js.
3. **Planar relaxation for the angle that is an elevation.** In convention A, H is an azimuth (exact planes) and V an elevation: tan(V) * r_xy lies between tan(V) * x and tan(V) * x * m, m = 1 / min(cos H0, cos H1). Same for B with the axes swapped, S is exact. Every approximation only adds air.
4. **One rectangle for all slices of a lamp, one mesh of quads (not a scissor per tile).** One draw call per lamp per sub-pass instead of one per slice. A per-slice rectangle (smaller for near slices) is possible; not done, since exact saves little for oncoming cars anyway.
5. **The frustum is a clip too (screen table only)**, so the rectangle never leaves the table and the projection never meets the eye plane. Polar tables skip it (their rays reach past the screen) and use the slice range only.
6. **Slack**: every cone plane is moved out by 2 cm, the rectangle is padded by 1 cell (the brief asked for the pad: the lookup reads neighbours).
7. **fast** = exact plus a ball about the lamp. Radius = where sigma * (largest phase value) * (the beam's peak candela x lamp weight x tint) / max(r^2, rMin^2) * exp(-sigma r) falls under eps, per metre of ray, ignoring the eye-side attenuation (so it is a true upper bound of the integrand). The ball adds a bounding cube of planes and tightens the eye-distance interval.
8. **Default exact.** The brief said default exact if, and only if, step 2 proves it identical. Proof: the gate below, with every halo pin at exact, none moved (see "Pins"). It is a new option, so no defaultHistory entry.

## SC measurements (OBSERVED)
Renderer: **ANGLE (Apple, ANGLE Metal Renderer: Apple M4)**, the real GPU, headless Chromium via Playwright (`--use-gl=angle --enable-unsafe-swiftshader` as the repo's tests do; it reported Apple M4, not SwiftShader). Canvas 846x476, table 212x119 cells. EXT_disjoint_timer_query_webgl2 present. GPU ms = the SL_HALO_TQ timer query around the whole table build (screen + prefix + polar), median of 36 frames after warm-up, raw rows in tests/tools/sc (re-run with measure.js). Scene: mountain pass, visibility 300, 16 halo lamps allowed, 2 lamps from the placed car, lamp cone off, polar off, no AFS. Cars placed with the trafficCars override: near = oncoming 15 m at d 1350; dip = oncoming 100 m at d 1332; crest = oncoming 96 m at d 140 (E2's "just behind a crest"); preceding = tail car 40 m at d 1350. The "dip" and "crest" poses are the pass poses the existing tests call by those names; I did not verify the geometry beyond that.

Bins 24 (table 212x119 cells, 24 slices):

| pose | off ms | exact ms | fast 1e-2 ms | fast 1e-1 ms | fast 1 ms |
|---|---|---|---|---|---|
| near_15m | 3.87 | 3.65 | 3.69 | 3.68 | 3.69 |
| dip_100m | 1.71 | 1.72 | 1.87 | 0.88 | 0.48 |
| crest_96m | 1.67 | 1.72 | 1.69 | 0.95 | 0.54 |
| preceding_40m | 1.70 | 1.20 | 1.23 | 1.16 | 0.87 |

Cells drawn per frame (sum over the 2 lamps; full table = 605472 cells per lamp):

| pose | exact | fast 1e-2 | fast 1e-1 | fast 1 | slices k0-k1 exact (lamp 1) |
|---|---|---|---|---|---|
| near_15m | 782068 | 782068 | 782068 | 782068 | 0-14 |
| dip_100m | 1210944 | 1210944 | 454104 | 48015 | 0-23 |
| crest_96m | 1210944 | 1210944 | 504560 | 68040 | 0-23 |
| preceding_40m | 156880 | 156880 | 156880 | 70808 | 19-23 |

Bins 32 (table 212x119 cells, 32 slices):

| pose | off ms | exact ms | fast 1e-2 ms | fast 1e-1 ms | fast 1 ms |
|---|---|---|---|---|---|
| near_15m | 5.33 | 5.23 | 5.17 | 5.32 | 5.04 |
| dip_100m | 2.41 | 2.48 | 2.48 | 1.27 | 0.83 |
| crest_96m | 2.43 | 2.64 | 2.52 | 1.39 | 0.84 |
| preceding_40m | 2.40 | 1.75 | 1.71 | 1.70 | 1.21 |

Cells drawn per frame (sum over the 2 lamps; full table = 807296 cells per lamp):

| pose | exact | fast 1e-2 | fast 1e-1 | fast 1 | slices k0-k1 exact (lamp 1) |
|---|---|---|---|---|---|
| near_15m | 1034348 | 1034348 | 1034348 | 1034348 | 0-19 |
| dip_100m | 1564136 | 1564136 | 504560 | 48015 | 0-30 |
| crest_96m | 1564136 | 1564136 | 605472 | 68040 | 0-30 |
| preceding_40m | 188256 | 188256 | 188256 | 70808 | 26-31 |
Observations on those numbers:
- OBSERVED: exact is byte for byte identical to off at all four poses (table bin and cum hashes and the frame; see tests) and draws fewer cells only where the beam leaves part of the table dark: 65% of the full table for the near car, 100% for the two cars whose cone contains the eye, **13% for the preceding car** (its beam points away, so only the 5 far slices and 80 rows are lit).
- OBSERVED: cells drawn is a poor proxy for cost. The near car draws 35% fewer cells with exact but the table pass is only 6% faster (3.87 -> 3.65 ms); the preceding car draws 87% fewer and is 29% faster (1.70 -> 1.20 ms). INFERRED reason: texels in dark air exit early in the shader (the BRIEF J test and `I <= 0`), so the cells exact removes were already cheap; the lit cells cost the time. The prefix pass (unchanged) is a fixed part of every number.
- OBSERVED: the brief's inference holds: for a car facing us the cone contains the eye, no near slice drops and the rectangle is the full table, so exact saves nothing at the dip and crest poses (within noise, +/-0.1 ms; the 2.48 vs 2.41 and 2.64 vs 2.43 at 32 bins are timer noise, the cell counts are identical to within 3%).
- OBSERVED: fast is where the saving is, and it is a cliff: the culling radius at eps 0.05 is 101 m, 0.1 is 81 m, 1 is 35 m. A car 96-100 m away loses nothing until the radius drops under its distance, then loses its whole far field at once.

## fast: table and frame differences (OBSERVED; 24 bins, 846x476; shots in overnight-shots/SC/)
Table = the cumulative table the lookup reads (half floats decoded). Frame = 8-bit canvas screenshot, per-pixel largest channel step.
| pose | eps | radius m | cells drawn / full | frame pixels changed | largest step | table max abs diff (rel to table max) | table mean abs diff |
|---|---|---|---|---|---|---|---|
| near_15m | 0.05 | 101 | 782068 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| near_15m | 0.1 | 81 | 782068 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| near_15m | 1 | 35 | 782068 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| dip_100m | 0.05 | 101 | 1210944 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| dip_100m | 0.1 | 81 | 454104 / 1210944 | 6874 | 1 | 0.0132 (0.0008) | 0.000256 |
| dip_100m | 1 | 35 | 48015 / 1210944 | 43697 | 41 | 3.2500 (0.1926) | 0.018356 |
| crest_96m | 0.05 | 101 | 1210944 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| crest_96m | 0.1 | 81 | 504560 / 1210944 | 402462 | 162 | 1.2227 (0.0180) | 0.217420 |
| crest_96m | 1 | 35 | 68040 / 1210944 | 402545 | 241 | 16.6250 (0.2454) | 0.302678 |
| preceding_40m | 0.05 | 101 | 156880 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| preceding_40m | 0.1 | 81 | 156880 / 1210944 | 0 | 0 | 0.0000 (0.0000) | 0.000000 |
| preceding_40m | 1 | 35 | 70808 / 1210944 | 450 | 1 | 0.2383 (0.0070) | 0.000019 |

- OBSERVED (shots crest_96m_24bins_off.png vs ..._fast-0.1.png): at eps 0.1 the crest pose loses the whole faint haze pedestal (frame mean step 49 levels). The car is 96 m out and the radius is 81 m, so all the air near the eye is gone. The table's own max moved only 1.8%: the bright core is intact, the dim wide haze is what fast removes, and with this exposure that haze is most of the frame. Whether the owner calls that wrong is her call.
- **Suggested starting eps for the slider: 0.05** (the default I set). It is the largest of the values I tried at which all four poses have zero changed pixels (radius 101 m, so it culls nothing at the 96-100 m poses; it is a safe floor, not a saving there). 0.1 saves 48% of the table time at the dip pose with at most a 1-level step in 6874 pixels, and wrecks the crest pose, so the useful value depends on the car's distance and the visibility (the radius scales with sigma). INFERRED, not tested: the threshold would be better as a fraction of the lamp's own light toward the eye than as a global number; left for the owner to look at, as the brief says.
- eps units: sigma x phase x candela / r^2 per metre of ray, at visibility 300 m (sigma = 3.912 / 300). At other visibilities the same eps gives a different radius. Not measured at other visibilities.

## Pins
- OBSERVED: with `scatterCull` default **exact**, `node tests/gate.js --touched` (59 tests; includes BJ2-halo-table-pin, E2-crest-occlusion, TOUGE-HALO-TILT, SD-scatter-table, SC-beam-scatter, BT-traffic-beams, BA5, P1, SE, AC) ran 0 not clean. **No pin moved. No hash was changed anywhere.**
- OBSERVED, run separately because --touched does not map them to these files: `node tests/gate.js --only HB-high-dip-gpu,TOUGE-SKY-VEIL,TOUGE-ELEV-B,TOUGE-AIR,TOUGE-AIR-RIBBON,BJ1-shadow-cache` -> `6 tests, 0 not clean, 141s`.
- The final --touched line for the SC commit: `59 tests, 0 not clean, 580s` (run after the last code change; an earlier identical run before the eps default moved from 1e-3 to 0.05 gave `59 tests, 0 not clean, 593s`).
- New check inside it: SCULL-scatter-cull proves off == exact at 4 poses on the raw table bytes, with polar tables on (perlamp, merged), and off after exact == first off.

## Not verified (SC)
- Phones / Safari: no phone or Safari run. The change adds no sampler and no shader text; the culled draw is a plain indexed mesh.
- CPU renderer: the option is GPU only (registry: need gpu); the CPU path ignores it and is untouched.
- Visibility other than 300 m, bins other than 24 and 32, divisors other than the auto rule, AFS, high-dip traffic (HB-high-dip-gpu is run by --only, see below), more than 2 lamps in the table.
- The conservative bound was proven by brute force on random lamps (1.32 million lit samples, 0 outside), not by an algebraic proof. The control (rect shrunk by 2 cells) fails on 308,899 samples, so the check can see a wrong cull.
- The saving on the tight poses was not checked on the owner's machine; headless numbers only.

---

# SP: lamp-centred table auto mode

## SP: what was built
`haloPolar` gains **auto** (new default). New option `haloPolarBand` (64x16 | 128x32 | 512x64, default 128x32) so the owner can judge the table size by eye (brief: "owner judges").
- Distance rule: the merged table (one table between the nearest car's two lamps) while the nearest lamp is more than 12 m from the eye; share = smoothstep(8, 12, d) in between; no table inside 8 m. `AUTO_NEAR_M` and `AUTO_FAR_M` in drive-three-halo.js.
- Band, not disc: the table covers only the angles about the beam's top edge (derivation below), at the chosen size. Texel angle = centre - half width + (x + 0.5)/nT x 2 half width. The screen table carries every other angle.
- No double counting: the lamps of the band table are drawn in BOTH tables. The polar table holds the lamp's whole integral over its band; the lookup weights it with `share x (1 - smoothstep(hw - fade, hw, |angle - centre|))` and returns 0 outside the band. The screen table is drawn with a new 'split' shader variant that scales each cell by `1 - share x (the same edge weight at the cell centre's angle about the table centre)`. The two weights add to 1, so the lamp is counted once. The split variant also **skips the 24-step march** for cells where the screen share is under 1e-4 (inside the band): measured, this took the auto 128x32 cost at 20 m from +1.04 ms to +0.67 ms over off.
- New shader variants ('band' for the polar pass, 'split' for the screen pass) are built on first use (the E2 pattern), so off / merged / perlamp compile the same table text as before. The lookup (drive-three-shaders.js haloPolarT) gained one branch behind `haloBandOn` and a multiply by 1.0 for the old modes, plus one uniform line; drive-three.js declares the two uniforms.
- Polar targets are now sized per mode (512x64 for off / merged / perlamp, the band size for auto); a size change rebuilds them.
- SP.3 (lookup fetches), OBSERVED by reading the code: the polar lookup already reads the prefix-summed table: `haloCurve` takes 4 knots and each knot is 4 `texelFetch` = 16 fetches per fragment per table, not 96 (the F2.3.1 running totals are in; B10/REVIEW-C did it). Nothing to change; outside the band the lookup now returns before any fetch.

### The band: what I chose (derived per frame, not a constant)
- For each lamp the beam's top edge = per sampled H column, the highest LUT row at 5% of the peak or more (`beamExtent.top`, 12 columns). Those directions go through the beam's convention (A, B or S), the lamp's own basis (tilt and roll included), out to 5, 15, 40 and 100 m, are projected to the screen, and their angles about the table centre are covered by the smallest arc. Padded by 0.2 rad (11.5 deg) each side; **at least 45 deg each side (90 deg total, the owner's estimate)**; over 150 deg each side it becomes the whole circle. Edge fade 0.35 rad (20 deg).
- OBSERVED values for the placed oncoming car (centre angle in screen degrees, y up, atan2 convention; half width): 40 m: -102 deg, 75.7 deg (a 128 deg arc, so 151 deg total); 20 m: -153 deg, 45 deg (arc 37, floored at 90 deg total); 14 m: -164 deg, 45; 12 m: -166 deg, 45; 10 m: -168 deg, 45; 8 m: -169 deg, 45. So close in it sits at about 165-170 deg below the horizontal to the left and is the 90 deg floor; at 40 m it opens to 151 deg. The owner's "roughly 120-180 deg about the lamp's projection" matches where the centre sits (about 150-170 deg) at 14-20 m.
- INFERRED: the floor decides the width at close range. The measured arc (7-37 deg) is the spread of the sampled top-edge directions of one beam, which is narrow; the owner's 90 deg is wider on purpose (the edge fade needs room). Nothing here tests whether 90 deg is the right width; she judges from the shots.

## SP measurements (OBSERVED)
Same machine, canvas, counting and caveats as the SC measurements (Apple M4 via ANGLE Metal, 846x476, 24 bins, 2 lamps, exact culling on). Table-pass GPU ms (screen + prefix + polar), median of 36 frames; the whole 3D render call GPU ms in brackets (one timer query around V.three.render, so it includes every lookup).
| mode | 40 m | 20 m | 12 m | 10 m | 8 m | 5 m |
|---|---|---|---|---|---|---|
| off | 4.65 (8.58) | 3.92 (7.69) | 3.48 (7.02) | 3.28 (7.06) | 3.02 (6.86) | 2.38 (6.08) |
| merged | 6.54 (11.22) | 5.77 (9.92) | 5.06 (9.53) | 4.83 (9.29) | 4.62 (9.10) | 4.07 (8.79) |
| perlamp | 6.93 (11.90) | 6.03 (11.10) | 5.45 (10.49) | 5.22 (10.28) | 4.98 (10.22) | 4.69 (9.68) |
| auto512 | 10.45 (14.36) | 9.11 (12.31) | 8.19 (11.78) | 7.94 (11.38) | 7.43 (10.97) | 2.40 (5.84) |
| auto128 | 5.22 (8.82) | 4.59 (8.21) | 4.12 (7.63) | 4.11 (7.56) | 3.78 (7.62) | 2.44 (5.99) |
| auto64 | 4.59 (8.46) | 4.03 (7.90) | 3.69 (7.38) | 3.65 (7.23) | 3.37 (7.01) | 2.40 (5.92) |

Draw passes per frame (d40..d5): off 8,8,8,8,8,8; merged 8,8,8,8,8,8; perlamp 8,8,8,8,8,8; auto512 16,16,16,16,16,8; auto128 16,16,16,16,16,8; auto64 16,16,16,16,16,8
- OBSERVED (differences from the table, off as the base): auto 128x32 costs +0.57 to +0.83 ms (12-25%) at 40-8 m and nothing at 5 m (no table, byte-identical frame; 2.44 vs 2.38 ms is noise). Merged (the whole circle at 512x64, the old mode) costs +1.6 to +1.9 ms, per-lamp +1.9 to +2.3 ms. Auto 64x16 costs -0.1 to +0.4 ms. Auto 512x64 costs +4.4 to +5.8 ms: the same table as merged, but the lamps are also drawn in the screen table.
- OBSERVED: whole-render GPU ms follows the table ms (auto 128x32 at 20 m: 8.21 vs off 7.69), so the changed lookup costs no measurable frame time beyond the table. Not measured: whole-render ms at other resolutions or on a phone.
- OBSERVED: merged is cheaper than per-lamp here (5.77 vs 6.03 ms at 20 m, the owner's statement holds, by a small margin); "usable on a phone" is not tested. The unavoidable cost of the band is that the lamps are drawn twice (16 draws, not 8); the 'split' early-out recovers part of it. Drawing the screen share only outside the band (an SC rectangle for the screen draw) is not done.

## SP: band sizes tried (shots in overnight-shots/SC/, 20 m, SP_crop20.png = the five variants magnified 3x, SP_size_*.png = the full frames)
- 512x64 (the whole-circle table's size, band only): clean top edge.
- 128x32: visibly the same edge; a slightly blocky left-lamp core. Mean frame step vs 512x64: 0.120 levels (a few pixels near the lamp differ by up to 159).
- 64x16: the top edge is still sharp but the left lamp core shows a bright rectangle (the coarse radial rows near the lamp). Mean step vs 512x64: 0.486, max 163.
- auto 128x32 vs the whole-circle merged frame: mean step 0.258, max 221 (a few pixels). The merged whole-circle table shows radial spokes above the beam (aliasing; the owner saw it); auto does not, because outside the band the screen table carries the lamp.
- Frame difference auto vs off (SP_diff_off_auto128.png, red = auto darker, blue = auto brighter, x6): confined to the beams' upper edges and a small patch by the lamps. The edge is sharper than the screen table's 4-pixel cells can draw it; that is the table's purpose. A dark sliver between the two beams, just above the beam edge, is the sharper edge, not a seam: I checked it is outside the band's weight (the same pixels equal off).
- Not judged: which size to ship. I set 128x32 as the default only because it is the middle option.

## SP: gates and pins
- `node tests/regress/SP-polar-auto.js`: 12 checks, all pass: a band table at 40, 20, 14 m (share 1, 128x32, both lamps in it); in the fade at 10 m; at 5 m no table and the frame is **byte-identical to haloPolar off**; fade sweep 13 -> 7 m in 0.25 m steps: the frame-to-frame step of auto (max 1.68 levels) equals off's (1.68) (WEAK evidence: the polar table changes little of the frame, so this cannot see a small pop; the share itself is continuous by construction: smoothstep, values printed in the test); all three sizes build; off / merged / perlamp keep their whole-circle tables and report no band.
- **off / merged / perlamp unchanged (OBSERVED, A/B):** I extracted the SC commit 0ccd43f (`git archive`, no checkout) and ran the same script on both trees: frames, bin table bytes and cum table bytes at 5 distances (40, 20, 12, 10, 5 m) x 3 modes = 15 configurations, **0 differ**.
- Pins that moved, with causes. **Frame pins: none moved.** The shader-text pins moved because the lookup text changed on purpose:
  - tests/beam-atlas.js (4 pins) 192c9a834eaf7fc5 -> 2177a7e74aabf37f, f70552a64e52fb08 -> 23c1a51e463ee6c6, 70491566a8ab3a88 -> 56448753b8be54b3, 788980098647e046 -> 83f7105c60878209; tests/regress/TOUGE-AIR.js (3 text pins) 282a872bc9a49a3a -> 2b3417497e504fc2, e9f5d7be75a10e76 -> dcaa54d3b4c40589, c82b6cb939f2683d -> 00cbfbad6582de64. Cause: the band branch in haloPolarT and one uniform line in drive-three-shaders.js. Proof (OBSERVED): I reversed exactly that edit in memory (string inverse) and the same hashing code gives all seven OLD pins back; with the edit it gives the new ones. The script is in the session scratchpad, the result is written next to each pin.
- Tests that relied on the default now get `auto`: BJ2-halo-table-pin, TOUGE-HALO-TILT (two setOpts), E2-crest-occlusion, BJ1-shadow-cache and TOUGE-SKY-VEIL now set `haloPolar: 'off'` explicitly (STANDARDS 2.2e). Their frame and table pins are unchanged and hold with off (the default-auto runs moved them: 5 + 2 + 2 + 1 + 2 failures; the off runs pass with the old hashes). The orchestrator's --full may find more tests that ride on the default; the ones in the touched gate and the other halo / pass tests I ran by hand are done. This is a pin of the old behaviour, not a re-baseline.
- Default change: haloPolar 'off' -> 'auto' with a defaultHistory entry and DEFAULTS_VERSION 3. A saved whole-object profile from before this at 'off' moves to 'auto'; one at merged / perlamp keeps its choice (tests/options-migration.js has a check for both). The halo quality presets (low / medium / ultra) set haloPolar explicitly (off / merged / perlamp) and are unchanged.

## Decisions for Anya
1. **Default haloPolar is now auto** (the brief). Saved profiles at the old default 'off' follow it to auto. A profile where she deliberately chose 'off' before this build is indistinguishable and moves too (the registry's standard behaviour).
2. **Auto table size default 128x32** (middle of the three she asked me to compare); `haloPolarBand` is the control. Hidden unless haloPolar is auto.
3. **Band floor 90 deg total, fade 20 deg, padding 11.5 deg**: my choices around her "about 90 deg".
4. **fast culling default eps 0.05** (SC): a zero-change floor, not a saving, at the 96-100 m poses; 0.1 is where the saving starts and where the crest pose changes a lot.
5. **Exact is the default** (the brief's conditional, met).

## Not verified (SP)
- Judging the look: the sizes, the 90 deg floor and the 12 / 8 m fade are for the owner's eyes; I looked at the 20 m crops only (and the other distances' frames exist in overnight-shots/SC/SP_auto_*.png; I did not study them one by one).
- The fade at 12 -> 8 m by eye in motion (only frames and a frame-difference sweep).
- Hairpin, crest and dip poses with auto (the SC poses were run for culling only); per-lamp-table car banked on a hairpin (roll) with a band; two cars (the table is for the nearest car only, as before).
- High-dip traffic (HB-high-dip-gpu is in the --only run below). Phones, Safari, and the CPU renderer (the option is GPU only).
- The edge-weight partition near the table centre: the two lamps are about 25 px from the centre at 20 m and the screen share is sampled at 4-pixel cells, so the sum of the two shares is only approximately 1 within about one cell-angle of the band edge. I saw no seam in the shots (the dark sliver is the sharper edge, above). A radial ramp near the centre was tried and changed nothing visible, so it is not in.
- Table build cost at other bin counts (32) and visibility values for auto (SC rows have 32 bins; SP rows are 24 only).

## Test results (OBSERVED, pasted)
- SC commit, `node tests/gate.js --touched`: `59 tests, 0 not clean, 580s`. Extra, `--only HB-high-dip-gpu,TOUGE-SKY-VEIL,TOUGE-ELEV-B,TOUGE-AIR,TOUGE-AIR-RIBBON,BJ1-shadow-cache`: `6 tests, 0 not clean, 141s`.
- SP commit, `node tests/gate.js --touched`: `65 tests, 0 not clean, 881s`. Extra, `--only HB-high-dip-gpu,TOUGE-AIR-RIBBON,TOUGE-ELEV-B,...`: HB-high-dip-gpu, TOUGE-AIR-RIBBON `exit 0`; BJ1-shadow-cache and TOUGE-SKY-VEIL `exit 0` after their `haloPolar: 'off'` line; LCM1-lamp-cone, CD-lampcone-depth, E2-pass-lamp-cone `3 tests, 0 not clean, 58s`.
- I did not run `--full` (the orchestrator does).
