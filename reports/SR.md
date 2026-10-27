# SR: scatter range (look.scatterRange)

Branch feat/scatter-range, base 9a6ec44 ("step 0 ok" line written first, per FEATURE-CONTRACT rule 1).

## What it does
New option `scatterRange` (metres), default 120, clamped to 10..400, in the advanced halo group under the
oncoming in-scatter culling. It is the far limit of every air-scatter integral and table lookup. 120 (or absent, or junk)
is byte-identical to the old fixed value: the table bytes (BJ2), the 12-bin table (SD) and the halo frames are unchanged.

Slider: a linear range slider in drive-anim.js (`data-anim="scatter-range"`), appended to the advanced halo group next to
the cull threshold. Hidden with no visibility, like the threshold.

## Every place changed, and why
CPU (js/drive.js)
- `scatRangeOf(look)` (new, exported as RF.Drive.scatRangeOf) and `SCAT_RANGE` {min 10, max 400}. One helper, so every reader agrees.
- `inScatter`: `s1 = min(sEnd, scatRangeOf(o.look))` (was `SCAT.S_MAX`).
- `trafficHalo`: `cap = min(sEnd, scatRangeOf(p.look))`.
- `tableEdge(k, S = SCAT.S_MAX)`: the 12 edges of the table follow S. `scatterTableBins` passes the look's S.
- `scatterTableAt(bins, d, gain, S = SCAT.S_MAX)`: the clamp uses S. Default keeps every existing caller.
- `SCAT.S_MAX` stays 120 (the default; tests read it). It is not mutated per look.

GPU, JS
- js/drive-three-halo.js:
  - `haloEdgesOf(n, R = HALO_RANGE)`: edge k = 0.5*(2R)^((k+1)/n), last edge R. At R=120, 2R is exactly 240.
  - `haloStepOf(n, R)`: the 0.22836 shortcut only at 24 bins AND 120 m; otherwise ln(2R)/n.
  - `HALO_RANGE`, `setHaloRange(R)` (recomputes HALO_EDGES, which the cull also reads), `scatRangeGpu(look)`.
  - build(): `setHaloRange` when the range changes, next to `setHaloBins`. The table's edges, its uniform `haloE`, its knot step `haloH`
    and the cull's `edges` all come from HALO_EDGES, so they move together.
  - the padding fill of `haloE` uses HALO_RANGE (padding slots are never read; kept for consistency).
- js/drive-three.js:286: `set('scatSMax', scatRangeGpu(look))` (was `D.SCAT.S_MAX`). haloState() also returns `edges` (test hook).
- js/drive-three-shaders.js (the existing uniform `scatSMax`, which was already a uniform):
  - :78 and :107 `min(d,120.0)` become `min(d,scatSMax)` (haloScatterScr, haloPolarT). This is the lookup clamp; it also covers the sky (drive-touge-three.js haloScatter(1e20)).
  - :333 and :388 `0.5*pow(240.0, k/11)` become `0.5*pow(2.0*scatSMax, k/11)` (the 12-bin table, tableCBanks and the table mode loop).
    Shader text changes; the output does not (see pins).
  - No new uniform was needed. Everything is a uniform, so the slider never recompiles a shader.
- js/options-registry.js: entry `scatterRange` (kind profile, number, default 120, where halo-advanced).
  docs/inventory/OPTIONS.md and GROUPS.md regenerated with gen-options-docs.js.
- tests/options-registry.js: FROZEN_OLD_DV_DEF gains `scatterRange: 120` (the test's rule for a new option; the old literal is the
  frozen reference). Key count note updated.
- js/spec-ui.js: the cache keys for the drive view (:1090) and the ground (:1157) include o.scatterRange, so a slider change redraws.
- js/drive-anim.js: look object gets `scatterRange` (:1167); slider + sync (see above).

Test hook (test only, same pattern as SL_CULL_SHRINK): `globalThis.SL_SR_GPU_CONTROL`, read by scatRangeGpu. Unset = no effect.

## The 120s I left alone, and why
- js/drive-three-lampcone.js:51 `LAMP_CONE_SMAX = 300`: the street-lamp glare cone's far limit. Not the scatter range. Left.
- js/drive.js:569 `return 120 + 750 * ...` in Headlamp.generic: a candela constant of the lamp model. Not scatter. Left.
- js/drive-touge-three.js:67 and :69: comments only; the sky code is unchanged and now saturates at the range through the uniform.
- js/drive-three-halo.js:5 (a comment naming the old [60,120] m bin); js/drive-three-shaders.js:40, :41, :45, :322 and drive-three-halo.js:23 (comments
  describing the default). Left as descriptions of the default.
- js/drive-three-halo.js:249 `fill(120)` was changed to `fill(HALO_RANGE)` (see above), so that one is no longer a literal.
- js/spec-ui.js:959 and :963: UI text. Near-eye sampling says "26-120 m" and the debug counts label the 12 slices "0-0.5 ... 71-120 m".
  These describe the default range only; at another range the bin labels are wrong. NOT fixed (decision for Anya: label the range or leave it).
- road.js:107 `far = 120` (road sensor), ideal-beam.js:108, render2d/ui colours and the touge sim (drive-touge.js) numbers: unrelated.
- tests/* and tools/*: the existing 120 uses in tests are defaults and remain valid (tests/scatter-table.js reads D.SCAT.S_MAX).

## Decisions for Anya
- Slider minimum 10 m, maximum 400 m, linear, step 5. The 10 m floor is my choice (the bin ladder breaks down below the 0.5 m first edge).
- Changing the range keeps haloBins fixed (24), so the near bins coarsen as the range grows (the edges are log-spaced over a wider span). This is the brief's rule.
- The NE quality presets (scatterQuality) and the 12-slice debug counts are per bin index; their targets shift with the range. Not changed.

## Pins
Default (120) pins, run on this branch (page tests, each a foreground or background run, see the list):
- BJ2-halo-table-pin: 6/6 PASS (table bins and cum hashes, frames, flat road and touge). Table bytes identical to the pins.
- SD-scatter-table: all 25 PASS (table mode frames, the 12-bin table through the shader change).
- SCULL-scatter-cull: all PASS (exact equals off byte for byte at 4 poses + perlamp and merged; control with shrink PASS; fast <= exact cells).
- SC-beam-scatter: first half PASS in my own run (clear frame = OLD_CLEAR baseline 23802573b0df..., air beam button and frames). My run's
  second half did not complete (I killed a stuck process). The --touched run of the whole file passed: exit 0, 272 s.
- Node: options-registry (after the frozen update), options-docs, scatter-table, scatter-table-pace, scatter-fade-gain, scatter-cull, scatter-range: all exit 0.

## --touched gate (run once, as asked)
Gate line, first run: `65 tests, 4 not clean, 975s`
NOT CLEAN on that run: node:beam-atlas (1/4), node:options-registry (1/1), node:all (1/5), TOUGE-AIR (1/2, solo re-run also 1/2).
Everything else in the run passed, including BJ2-halo-table-pin, SD-scatter-table, SCULL-scatter-cull, SC-beam-scatter (272 s), SP-polar-auto, SR-scatter-range, scatter-range, P1-drive-three, SE-table-pacing, FG-fog, regress-node (276 s).

What was done about the four, each with the cause and a re-check (no second --touched run):
- options-registry: my FROZEN_OLD_DV_DEF key-count assertion still said 94; it is now 95 (the new scatterRange key). Cause: the test's rule for a new option. Now passes (32/32).
- beam-atlas: four shader-text pins (the two stripped-halo pins and the two full-text pins). Cause: the 120.0 / 240.0 literals in the lookup and the table became the scatSMax uniform, so the text changed. Re-pinned with the same convention the file uses (SR re-pin lines in the test). Frames are the proof: BJ2, SD and SCULL passed on the frames above, and TOUGE-AIR checks (3) and (4) below. Now exit 0.
- TOUGE-AIR: check (1), the flat table shader text pins (plain / lit / lit+atlas), same cause. Re-pinned. Every frame check in that file (flat air off / direct / table, pass air off / direct, pass table, blend, off-after-on) passed in the first run and the re-run, so the frames did not move. Now 14 PASS, exit 0.
- node:all: its failures were the beam-atlas and options-registry checks above. Re-run: `node tests/all.js` exit 0.
- No frame pin moved. Shader-text pins DID move, all from one cause: the 120.0 / 240.0 literals became the scatSMax uniform (legitimate: the value is 120 at the default).
  Re-pinned with the files' own convention: tests/beam-atlas.js (4 hashes) and tests/regress/TOUGE-AIR.js (TEXT_PINS, 3 hashes). Frames: BJ2, SD, SCULL, SC-beam-scatter and TOUGE-AIR checks (3) and (4) equal main or the pins.
  The 2 stripped-halo beam-atlas pins are re-pinned without a check that the new text is main's text plus the old addition. That is weaker than the file's normal proof; I did not add the normalisation.

## New tests
- tests/scatter-range.js (Node, 12 checks, exit 0): range reads; 120 = absent for the 12-bin table and direct in-scatter (byte for byte);
  300 table carries more light and clamps at 300; halo edges (haloEdgesOf / haloStepOf, importing the module in Node) equal the old ladder at 120 and end at 300 at 300 with ln(600)/24.
  Control: a 120 table is not the 300 table.
- tests/regress/SR-scatter-range.js (page, exit 0):
  - PARITY at 300: the GPU's bin edges (haloState().edges) equal the CPU haloEdgesOf(24, 300) exactly (24 edges, last 300).
  - at 300 the far tile carries light (73 non-zero texels in the last bin, car 250 m out, 2 lamps drawn).
  - 120 gives the old ladder (last 120); 250 gives last 250.
  - CONTROL: with SL_SR_GPU_CONTROL=120 and the CPU at 300, the parity fails (GPU last 120, CPU 300). The check passes only when it fails.
  - Limit: the parity compares the EDGES and the presence of light in the far tile, not the magnitude of the far bins. The lookup and table
    integrand are the same code as at 120 (only the range input changes), but I did not measure a GPU-vs-CPU magnitude agreement at 300. NOT measured.

## Measurements
Method: tests/tools/sc/measure.js (SL_HALO_TQ GPU timer, EXT_disjoint_timer_query_webgl2), 846 x 476 canvas, halo bins 24, scatterCull exact,
trafficLightRange 400, Apple M4 (ANGLE Metal Renderer, from the tool's info line, a real GPU, not SwiftShader). 36 samples per row (warm-up skipped).
The "table" column is the halo table pass (SL_HALO_TQ); "whole" is the whole 3D render (one query around T.render).

| pose (oncoming car) | range | table ms median (min..max) | whole render ms median | cells drawn / full |
|---|---|---|---|---|
| car 250 m, pass d1350 | 120 | 1.61 (1.16..3.84) | 5.28 | 1210944 / 1210944 |
| car 250 m, pass d1350 | 250 | 1.59 (1.57..4.68) | 5.31 | 1210944 / 1210944 |
| car 250 m, pass d1350 | 400 | 1.54 (1.50..4.34) | 5.20 | 1160488 / 1210944 |
| crest, car 96 m, d140 | 120 | 1.67 (1.24..3.85) | 4.58 | 1210944 / 1210944 |
| crest, car 96 m, d140 | 400 | 1.52 (1.41..4.14) | 4.37 | 958664 / 1210944 |

Observation (not a claim): the table cost is flat across ranges at this scale. The slice count stays 24, so the number of draws does
not change; the range only moves the edges. Differences of 0.1 ms are inside the min..max spread of single runs. The cull trims some
cells at 400 (the far slices of the lit beam). Not run: the 10-m-to-400-m ms sweep, multiple repeats, other bin counts.

Shots (overnight-shots/SR/, all from the GPU view, 846 x 476):
- range120_car250.png, range250_car250.png, range300_car250.png (page test, same car and options), range120_restored.png, control_gpu120_cpu300.png.
- range400_car250_measure.png (measure.js run; the same pose and option set).
- crest120/crest_96m_24bins_exact.png and crest400/crest_96m_24bins_exact.png.
- NOT DONE: a 250 m shot on a straight (the pass pose is used, not a straight road), the sky shot (not done), a crest shot at 250 m.
  The measure tool writes the same file name for each run, so the car250 shots at 120 and 250 were overwritten by later runs; the page-test PNGs cover them.

## Not verified
- SC-beam second half (P1 parity with the beam on): not verified in my run (see Pins). It is in the gate.
- Magnitude parity GPU vs CPU at 300: not measured (edges and presence only).
- Sky shot and a straight-road car at 250 m: not made.
- The range's effect on the image (is 250 m haze visible): an observation from the shots only; not judged by Anya.
- Cell counts at 400 falling below full at the crest pose: observation, not explained.
