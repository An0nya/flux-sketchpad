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
