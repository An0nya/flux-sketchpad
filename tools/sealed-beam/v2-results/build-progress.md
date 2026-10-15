step 0 ok

Mode: Exploring. Builder only; no browser runs or commits. Scope: this worktree and briefs (explicit scope overrides shared-memory reads).

Implementation plan (before edits):
1. Preserve old H4 filament behavior; add explicitly assumed sealed-beam presets and H4 assembly presets, with R37 citations and assumptions.
2. New standalone solver sealed-beam-v2. Fixed world focus and design-source offsets are independent of the actual source pose. Feature-specific UI/CLI source controls update existing source fields; fixed adjustments keep reflector/lens surfaces unchanged and only relocate bulb assembly parts. No solver API or scene-format changes.
3. Measure v1 fixed-optics placement reproduction and bare v2 reflectors via flux CLI before lens retuning.
4. Lens pseudocode: partition a convex aperture into variable-width columns and independent-height rows; sample a curved sag across each flute; clip each planar strip against the convex aperture; match projected edges; add oriented convex triangles wherever neighboring heights differ (split where they cross); close perimeter to the outer face.
5. Tune candidates at the starting incumbent aim, then run the full aim procedure once on the final candidate. Record LB2M and LB2V independently; add Node and unrun page regression checks; regenerate api.json; run contract Node suites.

Steps 1–3 observations:
- Added distinct assumed transverse sealed-beam presets and H4 assembly presets. Existing h4-low/high source definitions unchanged. Existing v1 example optics unchanged; only preset metadata corrected. v1 solver untouched.
- Primary-source search: UNECE Rev.7 PDF returned HTTP 403. Retrieved UN R37 text via EUR-Lex indexed H4/1–4 and inspected the actual shield/filament drawings in the Australian government R37 reproduction (URLs and complete dimension/assumption ledger in docs/sealed-beam-v2.md).
- R37 e=28.5 is NOT the low-filament centre: the sheet explanation locates its beginning. Derived nominal low centre 30.75, driving centre 24.05 relative to the reference plane. Driving-axis height -0.8, passing +0.6 relative to shield HH; assuming driving filament at reflector focus therefore gives low offset (+6.7, 0, +1.4).
- Exact CLI reproduction at 2M rays, saved v1 optics unchanged: origin axial 14/7/1 LB2M; (+1,-0.5,+0.5) 19/3/0; left control (+1,+0.5,+0.5) 14/7/1. Raw rows confirm the same three remaining fails: 4U 8L, 1.5U 1R to R, 0.5U 1R–3R.
- Coordinate correction to review language: saved reflector vertex [-25,-1.5,-2.5], f=25, so its true focus is [0,-1.5,-2.5]. The origin comparison reproduces the review but is not literally at focus. A separate geometric ray-path check uses the true focus.
- Bare comparisons completed for 7/5.75, low/high, assumed filament/H4 assembly/H4 filament-only, using flux.js solve/trace. Raw results and exact argv: tools/sealed-beam/v2-results/. Summary table will follow.

Step 4 checks so far:
- Inspected actual single-ray events: down from H4 low hits cup8 and absorbs; up hits glass_inner (air to glass) then glass_outer (glass to air) and escapes; axial-forward goes through the glass end and is absorbed by tip_front.
- Convexity checked on every compiled lens polygon; oblique-line crossing check finds no holes, and exercises risers. First check used an arbitrary >10 riser-hit threshold and got 8 (with zero holes); replaced the arbitrary threshold with any actual riser coverage and increased the sample from 160 to 1000 lines. This was a coverage assertion error, not a lens failure.
- SB2 headless checks: 17 passed, 0 failed (full output retained in test log for final report). Browser tests written, not run.

Step 5 correction in progress:
- Rebuilding a tuned high-beam example changed its optical surfaces. Raw diff identifies spillR = 0.9 (an explicit tuned value) being substituted to 1.05 by v1's inherited "equal to low default => use high default" rule. Removing this heuristic in v2 only; high defaults will be explicit scene-generator settings, and saved examples will be checked against CLI Rebuild. V1 is preserved.

## Final measurements (CPU engine, v25.8.1; CLI pilot + guided refinement to 2,000,000 rays)

Numbers below are observations from the CLI, not compliance claims. One scene seed; no independent-seed replication. Counts are pass/fail/unsure. H4 source power is pre-assembly (not calibrated assembled-bulb output). Raw source setup, exact commands, per-row candela/SD/limits and aim notes are retained under tools/sealed-beam/v2-results/.

### Bare reflector (no cover, no separate lamp direct-light cap)

H4 assembly rows retain its internal cup/tip/glass; filament-only controls strip all three. Both use the explicit H4 mounting (+6.7 forward, +1.4 up for low); assumed sealed beam uses (+1.5 left,+2.5 up), as documented.

| case | lm in window | peak cd | LB2M | LB2V | UB2 |
|---|---:|---:|---|---|---|
| 7-low-sealed | 685 | 69800 | 7/13/2 | 9/13/4 | — |
| 7-low-h4 | 311 | 6746 | 12/10/0 | 12/13/1 | — |
| 7-low-h4-filament-only | 659 | 11309 | 12/10/0 | 14/11/1 | — |
| 7-high-sealed | 1094 | 392517 | — | — | 10/10/0 |
| 7-high-h4 | 721 | 315960 | — | — | 9/11/0 |
| 7-high-h4-filament-only | 1160 | 399013 | — | — | 9/11/0 |
| 5.75-low-sealed | 693 | 47934 | 7/13/2 | 7/11/8 | — |
| 5.75-low-h4 | 279 | 4758 | 10/12/0 | 10/15/1 | — |
| 5.75-low-h4-filament-only | 622 | 7971 | 12/10/0 | 12/12/2 | — |
| 5.75-high-sealed | 1105 | 267455 | — | — | 11/9/0 |
| 5.75-high-h4 | 731 | 215081 | — | — | 9/11/0 |
| 5.75-high-h4-filament-only | 1167 | 267224 | — | — | 8/12/0 |

### Cover comparisons and retuning

Each final candidate was tuned with 150 seeded candidates, 100,000 rays per trace, tuneAim=frozen, tuneSeconds=0; low target LB2M, high target UB2. Initial aim once, every candidate at that fixed aim, full procedure once for final verdict. LB2V is a separate fresh-aim assessment of the SAME optics, not an LB2M result relabelled. Pattern values are explicit when saved; all eight examples reproduce their surfaces exactly through flux.js solve.

| case | lm in window | peak cd | LB2M | LB2V | UB2 |
|---|---:|---:|---|---|---|
| 7-low-sealed-plain | 545 | 62748 | 6/16/0 | 9/16/1 | — |
| 7-low-sealed-fluted | 493 | 24466 | 13/8/1 | 10/15/1 | — |
| 7-low-sealed-tuned | 537 | 35274 | 16/5/1 | 14/10/2 | — |
| 7-low-h4-plain | 286 | 6130 | 12/10/0 | 12/13/1 | — |
| 7-low-h4-fluted | 291 | 17288 | 9/12/1 | 11/12/3 | — |
| 7-low-h4-tuned | 296 | 22676 | 15/6/1 | 14/11/1 | — |
| 7-high-sealed-plain | 892 | 332279 | — | — | 10/10/0 |
| 7-high-sealed-fluted | 891 | 78554 | — | — | 12/8/0 |
| 7-high-sealed-tuned | 852 | 56919 | — | — | 20/0/0 |
| 7-high-h4-plain | 634 | 267096 | — | — | 9/11/0 |
| 7-high-h4-fluted | 632 | 41778 | — | — | 10/9/1 |
| 7-high-h4-tuned | 598 | 25764 | — | — | 19/1/0 |
| 5.75-low-sealed-plain | 533 | 41686 | 5/17/0 | 9/16/1 | — |
| 5.75-low-sealed-fluted | 478 | 23941 | 13/7/2 | 11/12/3 | — |
| 5.75-low-sealed-tuned | 520 | 26705 | 18/3/1 | 13/9/4 | — |
| 5.75-low-h4-plain | 251 | 4287 | 10/12/0 | 9/14/3 | — |
| 5.75-low-h4-fluted | 274 | 15496 | 11/10/1 | 14/9/3 | — |
| 5.75-low-h4-tuned | 277 | 17235 | 16/5/1 | 14/9/3 | — |
| 5.75-high-sealed-plain | 868 | 223462 | — | — | 11/9/0 |
| 5.75-high-sealed-fluted | 864 | 49520 | — | — | 14/6/0 |
| 5.75-high-sealed-tuned | 799 | 50123 | — | — | 20/0/0 |
| 5.75-high-h4-plain | 644 | 182616 | — | — | 9/11/0 |
| 5.75-high-h4-fluted | 642 | 33701 | — | — | 10/10/0 |
| 5.75-high-h4-tuned | 644 | 63404 | — | — | 20/0/0 |

Remaining failures in the tuned 7-inch designs (raw row values, not a causal claim):
- 7-low-sealed, fmvss-lb2m: 4U 8R: 29 < 64 cd; 2U 4L: 0 < 135 cd; 1.5U 1R–3R: 21 < 200 cd; 0.5D 1.5L to L: 5506 > 3000 cd; 4D 4R: 17237 > 12500 cd.
- 7-high-sealed, fmvss-ub2: none in this run.
- 7-low-h4, fmvss-lb2m: 1.5U 1R to R: 7799 > 1400 cd; 1U 1.5L to L: 11281 > 700 cd; 0.5U 1.5L to L: 14631 > 1000 cd; 0.5U 1R–3R: 14910 > 2700 cd; 0.5D 1.5L to L: 18754 > 3000 cd; 2D 15L: 605 < 850 cd.
- 7-high-h4, fmvss-ub2: H V: 22013 < 40000 cd.

Interpretation: retuning improves the default complete-flute pattern, but low beam still fails both sets of limits. The new assembly results do not inherit the incomplete-filament placement score. Sampled curvature, assumed cup/glass geometry and uncalibrated assembly flux limit physical accuracy. No claim of a better overall low beam than v1 is made.

V1 preservation check: working-tree blob and HEAD blob identical (3810ff96a858e11b598f3b778d686745663f742e).

## Validation output

No browsers were launched. Added --node-only to tests/flux-cli.js so the Node checks can run without contradicting the contract's no-browser rule; its normal shot/page checks remain for the tester. All commands exited 0. Full stdout is retained in tools/sealed-beam/v2-results/validation/.

```text
node tests/all.js: all passed
node tests/regress-node.js: 251 [PASS], 0 [FAIL] (counted actual log lines)
node tests/drive.js: all drive checks passed (46 [PASS], 0 [FAIL])
node tests/flux-cli.js --node-only: 8 [PASS], 0 [FAIL]
[SKIP] shot / page: --node-only (builder contract forbids browser execution)
SB2: 20 passed, 0 failed
```

Actual all.js gate summaries (syntax checks omitted here; included in full log):

```text
✓ checks (tests/headless.js)  — 24 passed, 0 failed, 0 skipped — 6.5 s total, node v25.8.1
✓ undo/redo (tests/history.js)  — [PASS] new edit after undo clears redo
✓ metrics (tests/metrics.js)  — [PASS] uniform sim 70² → paint 30²: conserved, no holes  — min/max 1.000000
✓ layout (tests/layout.js)  — [PASS] all 338 layouts fill the space; collapsed panes stay reachable; expand dominates and restores
✓ attribution (tests/attribution.js)  — [INFO] 200000 rays: recording off 117 ms, on 124 ms
✓ photometry (tests/photometry.js)  — [PASS] fidelity: noise ceiling falls when rays are scarce  — ceiling 1.000 → 0.131 at 0.6 rays/cell
✓ two-curvature facet (tests/facet2.js)  — [PASS] JSON round trip compiles byte-identically (a collimated axis included)
✓ solvers (tests/solvers.js)  — [PASS] register rejects a malformed settings schema
✓ modes + auto (tests/modes.js)  — all passed
✓ spec mode + far field (tests/spec.js)  — all passed
✓ multi-part optics + multi-emitter (tests/optics-parts.js)  — all passed
✓ watching a solve: worker previews (tests/preview.js)  — all preview checks passed
✓ road model + IIHS metrics (tests/road.js)  — all road checks passed
✓ beam quality report (tests/beam-quality.js)  — all passed
✓ ideal-beam goals (tests/ideal-beam.js)  — all passed
✓ driver's-eye view (tests/drive.js)  — all drive checks passed
all passed
```

Actual SB2 stdout:

```text
[PASS] SB2 old H4 preset remains axial; assumed sealed-beam preset is transverse
[PASS] SB2 both sizes, beams, sources and all three lenses verify inside envelope/clearance/budget — []
[PASS] SB2 fixed source controls move the bulb, preserve every reflector/lens surface and do not request a solve
[PASS] SB2 source pose settings and serialized source agree after source controls
[PASS] SB2 solver source-offset setting uses the same fixed-source path
[PASS] SB2 follow mode keeps the v1 rebuild-on-source-edit behavior reachable
[PASS] SB2 H4 lower ray hits the internal cup; axial forward ray hits the opaque tip — {"down":[["sb2_bulb_cup8","absorb"]],"tip":[["sb2_bulb_glass_front_inner","refract"],["sb2_bulb_glass_front_outer","refract"],["sb2_bulb_tip_front","absorb"]]}
[PASS] SB2 upper ray enters the glass at the inner wall and exits its outer wall — [["sb2_bulb_glass_inner","refract",true],["sb2_bulb_glass_outer","refract",false],["","escape",null]]
[PASS] SB2 switching H4 low/high moves the active filament inside the same mounted cup, tip and glass
[PASS] SB2 H4 cup / tip / glass toggles can restore a bare filament
[PASS] SB2 bare paraboloid sends rays from its true focus parallel to +x at four reflector points
[PASS] SB2 within-flute normals vary; variable-width non-square regions allocate area — sampled curved profile
[PASS] SB2 every lens clip is convex, including connecting faces — all compiled polygon edge turns checked
[PASS] SB2 parallel rays across one curved flute actually leave in different directions — [["refract","refract","target"],["refract","refract","target"],["refract","refract","target"],["refract","refract","target"]]
[PASS] SB2 closed curved lens has even entry/exit crossings along oblique lines that hit risers — {"holes":0,"tested":797,"riserHits":79}
[PASS] SB2 incomplete planar/unconnected approximation stays selectable
[PASS] SB2 every candidate, including winners, uses starting incumbent aim; final verdict alone re-aims — [null,{"base":[0.2,-0.4],"reaim":[0,0],"note":"test held aim"},{"base":[0.2,-0.4],"reaim":[0,0],"note":"test held aim"},{"base":[0.2,-0.4],"reaim":[0,0],"note":"test held aim"},{"base":[0.2,-0.4],"reaim":[0,0],"note":"test held aim"},null]
[PASS] SB2 traceAsync uses the same frozen-aim rule and awaits its final verdict
[PASS] SB2 saved tuned examples rebuild to identical surfaces (including explicit high-beam values) — all v2 examples
[PASS] SB2 fixed saved-v1 placement regression: axial origin 14/7/1; right shift 18–19/3/0–1; left control 14/7/1 — {"origin":[14,7,1],"right":[19,3,0],"left":[14,7,1]}
SB2: 20 passed, 0 failed
```

Actual CLI stdout:

```text
[PASS] list solvers: bundled solvers load, none errored  — {"n":38}
[PASS] list spec-presets has fmvss-lb2m
[PASS] scene summary reads mode + surfaces  — {"mode":"D","A":{"enabled":true,"count":252}}
[PASS] trace: spec verdict rows add up, peak > 0  — {"pass":20,"peak":72851}
[PASS] re-solving the example reproduces its far field (same lm in window at the same rays)  — {"before":884,"after":884}
[PASS] an unknown --set fails loudly instead of being dropped
[PASS] heatmap writes a PNG of the reported size  — {"w":600,"h":300}
[PASS] api.json is current (else: node tools/flux.js manifest --out api.json)  — {"onDisk":40,"now":40}
[SKIP] shot / page: --node-only (builder contract forbids browser execution)
```

The added direct flute-ray assertion initially expected an escape event, but all four rays correctly ended at the scene target after two refractions. Read the actual events and changed the assertion to inspect the last refracted direction, irrespective of target/escape termination. Final check confirms four distinct outgoing directions. No feature geometry changed for this assertion correction.

Final review correction (in progress; the earlier lens table is superseded until this rerun finishes):
- V1's golden-index scatter used JS `% 1`, which is negative for negative indices. It could produce values below -1 despite the documented [-1,1) range, silently exceeding selected spread. V2 now uses the fractional part x-floor(x). V1 is unchanged.
- Added a physical parameter-bound regression over main-zone targets at negative flute row indices. Rerunning all eight v2 lens/tuner cases via the CLI with the corrected scatter and explicit high-beam defaults. Bare reflector / placement results do not use this code and remain valid.
