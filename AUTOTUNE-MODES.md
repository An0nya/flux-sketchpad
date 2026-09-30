# Autotuner modes, phase 1: how each mode should be judged

Status: **exploring** (proposal, not a recorded result). Branch `autotune-modes-p1`, from `solver-lab` at 3b22999. No tuner is built.

Everything below is one of three things, and I say which: **observation** (in a table or image I produced), **inference** (my reading of an observation), **guess**. Every number comes from `bench-out/modes/` (`runs.jsonl`, the `tables/*.txt` files, the images). That folder is gitignored; the scripts that make it are committed (list at the bottom). Speed statements are all *untested speed claims*: I ran no timing benchmark and the machine was shared.

## What I ran

- **Corpus (observation).** 16 scenes × 29 designs, each traced with 1M rays on seed 90210 (the one the solvers never see): 462 ok, 2 failed (`paint-solver` (nemotron-b) returned "no facets" on `anya-lowbeam-212` and `-1001`). The 29 designs: 19 Fill & fix variants (3 Priority × 2 Facet shapes at fast, 3 at normal, 10 single advanced knobs on balanced/fast), 8 other bundled solvers at defaults (dish-fit, opus-mosaic, bowl-image, finite-image, patch-array, sqm, nemotron paint-solver, bunny paint-mosaic), and 2 deliberately bad ones (a random 25% and 60% of a good design's facets). **Wrong-scene control (observation):** `tools/mode-wrong-scene.js` scores a design's light map against a different painting on the same optics (10 pairs, `tables/wrong-scene.txt`). All 10 are vetoed and score 0.00–0.14 (own-scene scores 0.50–0.83), e.g. a wash scored as a cutoff (glare 1.32), a hotspot design scored on a disc paint (fill level ×7.8), `p-text`'s light scored on `p-hello`'s paint (recall 32%). Easy negatives, but it shows the gates aren't vacuous.
- **Budget ladder (observation).** 8 scenes × 10 budgets (4…150) × 2 priorities = 160 traced runs, for the fewest-facets mode.
- **Repeatability (observation).** 21 designs re-traced on seeds 7 and 11.
- **Scenes.** Cutoff: `p-halfplane`, `held-low-beam`, `anya-lowbeam-212`, `anya-lowbeam-1001`. Hotspot: `p-hotwash`, `sparse-hot-16`, `default`, `anya-beamshot-400`. Text: `p-text`, `p-hello`, `held-ring`, `sparse-ring-24`. Photo: `p-gradient`, `p-photo`. Uniformity: `p-wash`, `p-disc`. I added `p-disc` and `p-photo` to `tools/bench-scenes.js` (existing names untouched). **`p-photo` is synthetic** (a smooth face-like picture, tones 0.08–1), not a real photo; I found no image in the repo.
- Not run: the `*-auto` solvers (I read `dish-fit-auto` only), and 5 bundled solvers (flux-corrected, flux-painter, flux-explorer, cap-paint, nemotron-a).
- **Scene facts worth knowing (observation).** `default` paints a hot ellipse on a wider wash, so it is a hotspot scene, not a uniformity scene. `held-low-beam` is a lit band with a brighter inset, not a low beam; only `p-halfplane` and the two `anya-lowbeam` scenes have a real cutoff edge. `sparse-spot-16` is single-level, so a hotspot/fill split does not exist there. The `anya-beamshot-400` paint contains faint label-like marks near its top corners; I did not look into them.
- **How to read the images.** `bench-out/modes/img/<mode>__<scene>__<kind>.png`: first tile is the paint, then per design two panels: what it delivered (cividis, blue→yellow) and difference from the paint (blue = too dark, white = right, orange = too bright or light in a dark cell). Both use a square-root display curve, and the delivered light is scaled so its total on painted cells equals the paint's. The square root makes faint haze look stronger than it is. Kinds: `best` (rank 1–3), `mid`, `worst`, `vetoed` (the best raw scores that a guardrail rejected). The number on a tile is `rank score%`. No red-vs-green anywhere.
- **Eyes.** "By eye" means *my* eye reading the PNG. Anya's may differ.

## The metrics, in short

Common inputs: `paint` P (R×R), `D` = the light each paint cell received as a share of the LED's emission (from the trace), `kern` = the smallest LED image in cells (`RF.Photometry.achievableKernel`). "Deep interior" = painted cells at least `kern/2+1` cells inside the edge. Code: `tools/mode-scores.js` (pure functions on a run dump).

Every threshold is a **proposal** picked while looking at these images. None is calibrated on other viewers.

### 1. Cutoff

**Target in plain words.** Below the line it is lit; above it, it is dark; the change happens as abruptly as the LED image allows, and at the line I painted.

**Metric.**
```
expo     = ΣD / ΣP over the deep interior              (light per unit of paint)
level(k) = expo × P at the cell (dark cells: P at the nearest painted cell)
ESF      = mean of D/level in 0.5-cell bins of signed distance, over edge cells whose dark side is ABOVE (lit below)
width    = (distance where ESF = 0.9) − (distance where ESF = 0.1)         cells
sharp    = 0.8·kern / max(width, 0.8·kern)                                  1 = as sharp as the optics allow
offset   = distance of the 50% crossing from the painted line               cells, + = light creeps into the dark
grad     = max drop of log10(ESF, floored 1%) between bins one cell apart   (ECE R112 style "gradient", from memory)
glare    = 99th percentile of 5×5-cell block means, over dark cells above lit paint and ≥ kern/2+2 from it, ÷ typical lit cell
litHoles = share of deep-interior cells with D < 0.5·expo·P
score    = sharp × (1 − litHoles) × (1 − min(1, glare/0.1))
```
**Guardrails (veto).** glare ≤ 0.05 · |offset| ≤ 1 cell · litHoles ≤ 5%. **Also needed (inference):** a light objective as tie-break, see below.

**Evidence (observation unless marked).** Tables `tables/cutoff__*.txt`.
- `p-halfplane`: rank 1 `ff-sharp-fast` (fidelity 95, sharp 0.89, glare 0.007) → `img/cutoff__p-halfplane__best.png`: clean edge, faint speckle above. Verdict: **agrees**. Rank 23 `sqm` has the best raw score (0.876, sharp 0.94) but is vetoed for litHoles 6%: → `…__vetoed.png` shows its lit half as a patchwork of dark gaps. **Agrees.**
- `held-low-beam`: best = `dish-fit`, `bowl-image`, `opus-mosaic` (crisp rectangles); worst = `ff-light-fast` (glare 0.161), `ff-shell0`, `nemotron-b` (haze glowing far above and below; smile-shaped speckle) → `…held-low-beam__best.png`, `…__worst.png`. **Agrees.**
- **Disagreement with fidelity:** `ff-sharp-normal` has the *highest* fidelity on `held-low-beam` (96) and is vetoed for glare 0.08. → `…__cmp_sharpnormal.png` shows a visible haze shoulder above and left of the band. I think the veto is right, and fidelity is blind to it (see general metrics). The square-root display exaggerates that haze.
- `anya-lowbeam-1001` (a real low beam): best = `opus-mosaic`, `finite-image`, `ff-util12`; worst = `bad-keep25`, `bunny-mosaic` (a visible grid), `sqm` (a bright box in the middle of the beam shape) → `…1001__best.png`, `…__worst.png`. **Agrees.** Note `bad-keep25` (a random quarter of the facets) scores sharp 0.94: its *edge* is fine and it is vetoed only by litHoles 13%. Without that guardrail it would rank 5th.
- `bad-keep60` passes with a good edge (rank 14 of 28) while delivering 53% instead of 80% on paint: **the edge score cannot see missing light**, so the tuner needs a light objective (inference).
- I fixed two of my own bugs after looking at the images: the first `litHoles` compared cells to one median level and so flagged the dim outer band of a real low beam as "holes" (it vetoed good designs); the ESF level is now per painted level. Not viewed: `anya-lowbeam-212` images.

**Cost (untested speed claim).** Needs D from a trace (1M rays; a metric pass is a few million grid operations, tens of ms in JS). Glare and litHoles are the guards `pred` can't see: on `p-halfplane` the model's own predicted field scores `ff-bal-fast` 0.59 and the trace 0.39 (`tables/pred.txt`), i.e. the prediction is cleaner than reality. So: rank on `pred`, confirm finalists on a trace.

**Tuner sketch.** Candidates: Priority {sharp, balanced} × `gapWeight` {1, 2, 4} × shell `sharp` {auto, 4}: 12 fast-quality solves. Observation across 4 scenes: `gapWeight 4` passed the gates on 4/4 (best mean rank, 5.0 of 29), `gapWeight 0` on 2/4 (mean rank 23), the `light` variants on 2–3/4. Score the 12 on `pred` (edge sharpness, offset, holes), trace the best 3, keep the best that passes glare. Objective after the gates: sharp, then `onPaint`.

### 2. Hotspot

**Target in plain words.** The brightest possible centre, with the wide fill still there at about the level I painted: a bright core in a real beam, not a spike in a hole.

**Metric.**
```
hot     = painted cells ≥ 75% of the paint's max;  fill = other painted cells ≥ kern/2+1 inside the edge
hotCd   = mean D over hot × (power·dist²/cellArea)                                   cd
possible= min(capturable × R × (pmax/ΣP) × power·dist²/cellArea , envelope ceiling)   Anya's definition of possible peak
score   = hotCd / possible
fillRel = (median D fill / median D hot) ÷ (median P fill / pmax)
fillCover = share of fill cells with D ≥ 0.5 × (P/pmax) × median D hot
```
Mean over the hot zone rather than the 99.5th-percentile cell (bench's `peakCd`): a single hot cell or ray noise can't win it, and a peak in the wrong place scores low. **Guardrails.** fillRel in [0.6, 1.6] · fillCover ≥ 85% · spill ≤ 25% (if the paint has no fill zone, only spill applies).

**Evidence.** `tables/hotspot__*.txt`.
- `anya-beamshot-400`: raw best is `sqm` (0.775 of possible) with fillRel 0.02 and fill coverage 41%; → `img/hotspot__anya-beamshot-400__sqm_vs_light.png` shows it as a single bright box, no beam. Vetoed. **Agrees** (this is the exact "win by throwing the fill away" case). Rank 1 `ff-light-normal` (0.651): hot core plus fill plus faint vertical streaks (spill 9%).
- `sparse-hot-16`: raw rank 2 `sqm` (0.410) vetoed for fillRel 0.25, coverage 45% → `…sparse-hot-16__vetoed.png`: a hot centre plus a ring of disconnected patches. **Agrees.** Best (`ff-light-fast` 0.421, spill 17%) → `…__best.png`: a hot core in a fill, with pale vertical streaks outside the paint. I would call 17% spill visible but tolerable; whether it is acceptable is Anya's call.
- `p-hotwash`: vetoed `ff-shell0` (fillRel 1.75) and rank 1 `ff-useall` (0.589) → `…p-hotwash__vetoed.png`, `…__best.png`: the vetoed ones have a dimmer core that barely stands out from the fill. **Agrees.**
- **Finding (observation, 4 scenes):** Priority `sharp`, the setting with the highest fidelity, reaches about half the peak of `light` (e.g. `default`: `ff-sharp-fast` 0.296 vs `ff-light-fast` 0.585 of possible; fidelity 93 vs 92). Mean rank across the 4 scenes: `ff-light-fast` 3.0, `ff-sharp-fast` 16.0. So a hotspot tuner has real headroom that fidelity can't see.
- Weakness (observation): the top five designs of a scene span only 0.02–0.08 in score (`default` 0.585–0.607, `anya-beamshot-400` 0.573–0.651). I can't tell those apart by eye either. The metric separates the 0.3 group from the 0.6 group, not 0.58 from 0.60.

**Cost.** Trace for the final check. `pred` reproduces the order of the three designs on 3 of 4 scenes (the swap on `sparse-hot-16` is between traced 0.40 and 0.36); its field correlation with the trace is 0.89–0.99 (`tables/pred.txt`). So hotspot can be searched on `pred` almost entirely (untested speed claim: ~1.4 s per fast solve, from the brief's baseline).

**Tuner sketch.** Priority {balanced, light} × `util` {0.9, 1.2} × `useAll` {off, on} × `dim` {0, 0.5}: ≤ 16 fast solves ranked on `pred`; trace the top 2 for spill and coverage.

### 3. Text / line art

**Target in plain words.** Every stroke is lit end to end, the gaps and counters stay clearly darker, and nothing glows elsewhere. Brightness levels don't matter.

**Metric.**
```
T       = paint blurred by kern   (what perfect optics could show)
thr     = 0.5 × p90 of D on painted cells
recall  = share of cells with T ≥ 0.5·max(T) that have D ≥ thr
leak    = share of unpainted cells (within 6 cells of the paint) with T ≤ 0.25·max(T) that have D ≥ thr
F1      = 2·recall·(1−leak)/(recall+1−leak)
farGlare= p99 of 5×5 block means ≥ 6 cells from any paint, ÷ p90 stroke level
holes   = on D blurred 2 cells and cut at half its p90: holes still open ÷ holes in the paint (loops, counters, rings)
score   = F1 × (1 − min(1, farGlare/0.3)) × (0.5 + 0.5·min(1, holes))         (holes term only if the paint has holes)
```
**Guardrails.** recall ≥ 0.6 · leak ≤ 0.2 · farGlare ≤ 0.15. Stroke brightness (`onPaint`) is the secondary objective, since legibility is level-free.

**Evidence.**
- `p-text`: worst by score = `nemotron-b`, `ff-useall`, `ff-light-normal` → `img/text__p-text__worst.png`, `…__vetoed.png`: `ff-light-normal` is a yellow smear over the letters (farGlare 1.96). **Disagreement with fidelity:** `ff-light-normal` has fidelity **71%**, above `ff-sharp-fast` (69%) and `ff-bal-fast` (69%), which are legible. The same happens on `p-hello`, `held-ring`, `sparse-ring-24`: all four `light`/`useAll` variants (`ff-light-fast`, `ff-light-normal`, `ff-light-round-fast`, `ff-useall`) fail the gates on all four text scenes, mostly by far glare (`tables/text__*.txt`). Fidelity only counts dark cells within a few cells of the strokes, so a smear beyond that band isn't counted (`js/photometry.js`, `near2`).
- `p-hello` (3-cell strokes, near the optical limit): the first version scored `ff-sharp-fast` 0.98 (`…p-hello__best.png`: three clean tall bars and a smear for "e", "o"), which I don't read as legible. So I tightened it (judge against the achievable image, count preserved loops). Now rank 1 is `bowl-image`, then `ff-gap4`, `patch-array`; `ff-sharp-fast` 4th → `…p-hello__holes.png`: `bowl-image` and `ff-gap4` show letter shapes. **Caution:** I tuned this on the same scene I judged it on. Out of sample: `held-ring` (best/worst → `…held-ring__best.png`, `…__worst.png`, ring with dark centre vs ring with a bright filled centre and far haze) **agrees**. Not viewed: `sparse-ring-24` images.
- Even the best `p-hello` designs are not clearly legible to me (**observation**). The metric ranks them; it does not say "good enough".
- Topology counts (lit components vs paint components) fluctuate by ±2 on good designs, so I kept only the loop/hole part and use it as a multiplier, not a gate.

**Cost.** Trace needed for farGlare (the model's field doesn't show far stray light: `pred` gets the order of the three designs right on `p-text` and `sparse-ring-24` but not `p-hello` or `held-ring`, and predicts farGlare too clean). Untested speed claim: same as cutoff.

**Tuner sketch.** Priority {sharp, balanced} (not light) × shapes {two, round} × `gapWeight` {1, 4} × `feature` {1, 3}: 12 fast solves; **trace the top 3** because the gate needs the far field.

### 4. Photo / lithophane

**Target in plain words.** Brighter where the picture is brighter, in about the right proportion (judged as eyes judge ratios), fine features (eyes, mouth) present, no tile or blotch texture, and the frame stays dark.

**Metric.** On the painted interior in 4×4-cell blocks (so ray noise isn't read as tone error):
```
rho          = Spearman(D, T)                                   T = paint blurred by kern
lightnessErr = mean | cbrt(D·k/Tmax) − cbrt(T/Tmax) |            k = exposure match; cube root ≈ CIE L*
detail       = corr( highpass(D blurred 2 cells), highpass(T) )   high-pass = minus an 8-cell blur
score        = 0.5·rho·(1 − min(1, 2·lightnessErr)) + 0.5·max(0, detail)
```
**Guardrails.** rho ≥ 0.85 · spill ≤ 15%.

**Evidence.**
- `p-photo`: `…p-photo__worst.png`: `bad-keep25` (blotches), `bunny-mosaic` (visible tile patchwork), `nemotron-b` (noise). **Agrees.** `…photo__p-photo__detailcheck.png`: the top design (`ff-light-normal`, detail 0.40) shows eyes and mouth; `ff-sharp-fast` (rank 25, detail 0.01) shows a vertical band and no eyes. **Agrees**, and `rho` alone could not separate these (0.98 vs 0.96). I added `detail` for exactly this reason after looking at the first version, whose top three all looked alike.
- **Weak spots (observation).** The metric has little resolution among decent designs: on `p-photo` the top 14 of 29 span 0.58–0.68 in score, and rho is 0.93–0.98 for the top 24. It is very tolerant of smooth designs. `dish-fit` shows visible overlapping tile texture (`detailcheck.png`, right-most) yet ranks 18th of 29; I don't trust the ordering in the middle. **Unclear.** `p-gradient` is too easy to say anything (all top designs rho 0.99), and I didn't view its images.
- Synthetic picture only; a real lithophane image (edges, faces, texture) is untested.

**Cost.** Trace. `pred` agrees with the trace on the order on `p-photo`, and swaps a near-tie on `p-gradient` (0.48/0.48/0.49). So photo can be searched on `pred` (untested speed claim).

**Tuner sketch.** Small: Priority {balanced, light} × `dim` {0, 0.5} × quality {fast, normal}: 8 solves, `pred`; trace the top 2 and check the gate.

### 5. Uniformity

**Target in plain words.** An even wash: no dark patches, no bright patches, no tilt.

**Metric.** Wash interior (≥ `kern/2+2` cells from the edge) in 4×4-cell blocks:
```
cv      = std / mean of block values;  noiseCV = 1/√(rays per 16 cells) = 1/√(16·D·rays)
excess  = √max(0, cv² − noiseCV²)                               shot noise removed
score   = 1/(1 + 10·excess)
also reported: min/mean, p10/mean, and tiltShare (how much of the variance a plane explains)
```
**Guardrails.** p10/mean ≥ 0.7 · spill ≤ 15% · **a light floor** (below).

**Evidence.**
- `p-wash` (display dimmed so a wash doesn't saturate): `…uniformity__p-wash__best.png` (cv 0.086, a faint gradient), `…__mid.png` (cv 0.12–0.14, visible mottled patches), `…__worst.png` (blobs, tiles). **Agrees.** I viewed `worst` before I dimmed the display; it is unmistakable.
- **Disagreement (guardrail needed).** On `p-disc` the top scorer is `bowl-image` (0.662) with **13%** of the LED's light on the paint; `ff-bal-normal` is 0.660 with 62%. A uniformity tuner without a light floor would happily choose the light-starved design (**observation**; images not viewed). Proposal: require `onPaint ≥ 0.5 × best onPaint seen in this tuner run` (or `usefulOfIdeal` ≥ some floor).
- Trace noise is a real limit: `p-wash` has about 60 rays per cell at 1M rays (0.6 × 1M / 10,000 cells; **inference from the on-paint share**), so per-cell ±13% noise; the 4×4 blocks and the noise subtraction are needed.

**Cost.** Trace (1M rays; for a full-target wash noise scales as 1/√rays: untested). `pred` orders the three designs the same on both scenes (field correlation on `p-wash` is ~0.03–0.09 only because the real variation is tiny next to noise). Untested speed claim.

**Tuner sketch.** Priority {balanced, light} × shapes {two, round} × shell `sharp` {auto, 0, 2}: 12 solves on `pred`; trace the top 2; objective = uniformity score subject to the light floor. Observation: the sharp priority ranks low for uniformity (mean rank 22 of 29), balanced/normal top (2.5).

### 6. Fewest facets

**Target in plain words.** The smallest number of facets that still looks as good as the design with all of them.

**Metric.** Count `placed` facets (the solver often places fewer than the budget: 21 of 32 on `p-hello`), not the budget. Quality Q = the scene's own mode score (above) and its gates. Reference Q* = 90% of the best Q reached across the ladder (the design with the full budget). N* = the smallest placed count with gates passed and Q ≥ Q*, **confirmed** by also passing at the next rung up.

**Evidence.** `tables/budgets.txt`, images `img/budgets__<scene>.png` (budgets 8, 16, 32, 64, 150).
- The mode score is **not monotone in the budget** (observation). `sparse-ring-24`, balanced: 0.23 · 0.17 · 0.00 · 0.36 · 0.18 · 0.42 · 0.82 · 0.62 · 0.72 · 0.89 at budgets 4…150; `p-hello` balanced scores 0.00 at budgets 12, 16 and 24 (vetoed by gap leak or far glare), 0.06 at 32, then 0.41–0.43 from 48 on. `…budgets__sparse-ring-24.png`: 16 facets is a "C", 32 a ring with gaps, 64 a good ring with a stray block above it, 150 a good ring. The stray block explains the dip at 64. **Agrees** with the score.
- Fidelity is smooth in the budget on the same runs (40→81 on the ring), which is why it can't be the quality measure here: it doesn't see these defects.
- "First budget reaching 90% of best" vs "stable" (all larger budgets also reach it) disagree on 11 of 16 scene×priority ladders (stable is `—`, meaning never, or a much larger budget). A bisection on the budget would land on chance. The two-rung confirmation is a partial fix (guess).
- Facets needed by mode score vs fidelity differ a lot in places: `p-photo` needs 150 by score (detail) vs 48 by fidelity; `sparse-bar-16` balanced needs 8 by score vs 32 by fidelity.
- `sparse-spot-16` has a one-level paint, so the hotspot score isn't meaningful there; I ran it but its scored ladder isn't evidence.

**Cost.** One solve per rung; a rung ladder [8, 12, 16, 24, 32, 48, 64, 100] is 8 solves, rank on `pred`, trace only the rung chosen and its neighbour. Untested speed claim.

### 7. Max light

**Target in plain words.** As much of the LED's light as possible lands on the paint at about the painted proportions.

**Metric.** `usefulOfIdeal = Σ min(D_k, 1.25·capt·R·P_k/ΣP) / (capt·R)`: light on a painted cell counts only up to 1.25× what a perfect spread would put there. Light in gaps counts nothing. `capt` = capturable share of the LED's light, `R` = reflectivity (both in the bench rows).

**Evidence.**
- **Raw on-paint share is gameable (observation).** `anya-lowbeam-1001`: `sqm` has **88%** of the light on the paint, the highest in the scene, but fidelity 25 → `img/light__anya-lowbeam-1001__sqm_vs_ff.png`: a bright box in the middle of the beam shape. `anya-beamshot-400`: `sqm` 81% on paint, fidelity 30 (same image family, `hotspot__…sqm_vs_light.png`). **Agrees** that these should lose.
- Useful-light drops `sqm` on 1001 from 88% to 46% credit, but that is still generous for a wrong shape. Across all 462 runs `useful / onPaint` is ≥ 0.86 everywhere except that one case (0.52, `sqm` on 1001). **So it adds little; the guardrail carries the mode.**
- Guardrail candidates: fidelity ≥ 0.7 (a placeholder, used in the tables) vetoes `sqm` on 1001 but keeps `sqm` on `default` (fidelity 79, a smooth dish, 61% on paint, rank 1). That looks right by eye (**not viewed**). A better rule (inference): use the **gates of whichever mode the paint belongs to** (cutoff gates for a low beam, hotspot gates for a beam-shot), and give "max light" as the objective *after* them. Sliced W1 is an alternative shape check but has the problems below.

**Cost.** `onPaint` is on `pred` for free (`pred` on-paint differs from the trace by 0–11 points across the 48 designs in `tables/pred.txt`; the 11 is `ff-sharp-fast` on `p-hello`, 20 traced vs 9 predicted, and 7 on the beamshot). Gates need a trace.

**Tuner sketch.** Priority `light` × `useAll` {on, off} × `util` {0.9, 1.2, 1.5} × shapes {two, round}: 12 solves ranked on `pred` `onPaint`, top 3 traced and gated by the mode's gates. Observation: among the Fill & fix variants, `ff-util12` and the `light` ones have the highest on-paint share on most scenes (65–84%); `sqm` is often above them.

## Guardrail summary

| Mode | objective | vetoes (proposals) |
|---|---|---|
| Cutoff | edge sharpness, then light | glare ≤ 0.05 · edge offset ≤ 1 cell · lit holes ≤ 5% |
| Hotspot | mean hot-zone cd ÷ possible | fill level 0.6–1.6× · fill coverage ≥ 85% · spill ≤ 25% |
| Text | F1 × far-glare × loops | recall ≥ 0.6 · leak ≤ 0.2 · far glare ≤ 0.15 |
| Photo | rank + tone + detail | rank corr ≥ 0.85 · spill ≤ 15% |
| Uniformity | 1/(1 + 10 · noise-free CV) | p10/mean ≥ 0.7 · spill ≤ 15% · a light floor |
| Fewest facets | placed facets | the scene's mode gates + Q ≥ 90% of best, confirmed next rung |
| Max light | useful light share | the paint's own mode gates |

## Speed and search-size budget (all untested speed claims)

- Baselines to inherit (from the brief): Fill & fix fast median ~1.4 s, normal ~7–9 s (max ~20 s). Target ~5 s single solve, ~60 s a tuner run.
- A tuner of **≤ 12 fast solves + ≤ 3 traces**: ~12 × 1.4 s ≈ 17 s of solving plus 3 traces (a 1M-ray trace plus scoring is, I expect, around a second; a 250k-ray trace would roughly quarter that but doubles the noise). That fits 60 s with room to spare on a scene like `default`; large scenes (400 facets, res 200) are unmeasured.
- Metric evaluation on a 100×100 grid is a few million simple operations; on 200×200 the brute-force distance transform is the largest part (~17M). None of it needs the tracer; only D does. Estimate: tens of milliseconds to ~0.3 s per metric call. **Untested.**
- `pred` (debug field) needs `S.debug`, which bench's settings sanitizer strips; `tools/mode-run.js` sets it after sanitizing. In the tuner, use `out.debug.F / power`.
- Which metrics can run on `pred`/`debug.F` alone: photo, uniformity, hotspot, on-paint light (pred order matched the trace in most cases); need a trace for the final call: cutoff glare, text far glare, spill-type gates. Field correlation pred↔trace is 0.89–0.99 per design; the exceptions are 0.73 (`sparse-ring-24`, one design) and `p-wash` (0.03–0.09, because the real variation is tiny next to ray noise).
- Trace noise on the scores is small: across seeds 90210/7/11 on 21 designs the largest spread of a mode score is 0.026 (cutoff), text 0.022, photo 0.019, uniformity 0.007, hotspot 0.003 (`tables/seeds.txt`), against design-to-design gaps of 0.2–0.5. Gates did not flip on any of the 21 (none of them were chosen to sit on a threshold).

## General metric proposals

1. **Count the far field.** Fidelity's dark-cell test only looks a few cells around the paint (`GAP_PAD` + kernel). Observation: it gave 71% to an unreadable smear and 96% to a design with visible haze above its cutoff. Add the **block-averaged far-stray-light term** used here (p99 of 5×5 block means beyond the gap band, ÷ typical lit level). Block averaging is needed because a single stray ray in a cell is worth 1/(rays per cell) of the lit level, which would otherwise set the floor of the reading.
2. **Judge against the achievable image, not the raw paint.** Blur the paint by the smallest LED image and demand "lit where that is lit, dark where that is dark". Fidelity already does this for painted cells; it did not for gaps beyond a fixed band.
3. **Per-cell relative levels** (a cell needs ≥ 50% of *its own* painted level), not a single median level, whenever the paint has more than one level. My first cutoff `litHoles` vetoed good designs of a real low beam for exactly this reason.
4. **Sliced Wasserstein-1** (mean distance, in cells, the light must move to become the paint; 8 projection angles) as a smooth "where did the light go" shape check. Observation: its rank correlation with my text score across the 4 text scenes is 0.63–0.90 (`tables/text__*.txt`), on the cutoff scenes −0.03…0.69, and on hotspot −0.19…0.38. It compares shapes after normalising both to unit light, so it **ignores lost light** (`bowl-image` has the best W1 on `anya-beamshot-400`, 0.1 cells vs ≥ 0.7 for the Fill & fix designs, with 13% of the light), and the flood-normalised version is undefined when the paint is nearly the whole target. Use it as a supplement, not a gate.
5. **Noise-aware thresholds.** Any per-cell threshold at 1M rays is judging ray noise on big paints (about 60 rays/cell on a full wash). `fidelity` already carries a `noiseCeiling`; the mode metrics use blocks (uniformity, photo, glare) or blurs (text topology) for the same reason.
6. **±25%.** I did not test replacing it, and the failures I found were not caused by the ±25% band itself but by what it leaves out (items 1–3). I would keep it for the fidelity headline and add the far-field and per-cell-level checks, rather than change the tolerance.

## Disagreements between metric and eye (the short list)

1. Text `p-hello`: first version rated `ff-sharp-fast` 0.98 while I read it as "hll" plus a smear. Fixed by the achievable-target rule and the loop count. Tuned on the scene it was judged on; `held-ring` agrees out of sample.
2. Photo: `dish-fit`'s visible tile texture ranks 18th of 29, above several fuzzier designs. Unclear which order a viewer would prefer.
3. Photo: the top 14 designs span 0.58–0.68 on `p-photo` (rho 0.93–0.98 for the top 24); the metric has little resolution there.
4. Hotspot: the top five designs of a scene span 0.02–0.08 and I can't tell them apart by eye either.
5. Cutoff: an edge score alone would rank `bad-keep25` 5th on `anya-lowbeam-1001`, and `bad-keep60` mid-table with 2/3 of the light: vetoes and a light objective are load-bearing.
6. Uniformity: `bowl-image` wins `p-disc` with 13% of the light (guardrail proposed, images not viewed).
7. Max light: on-paint share ranks `sqm` first on `anya-lowbeam-1001` (88%) though its output is a box.

## Not verified / limits

- Images I did not view: `cutoff__anya-lowbeam-212`, `hotspot__default`, `text__sparse-ring-24`, `photo__p-gradient`, `uniformity__p-disc`, `light__` besides `anya-lowbeam-1001`. Their table rows are in `tables/`. Verdicts for those scenes are from numbers only.
- Thresholds were set by looking at these 16 scenes; there is no held-out scene set here (the agent-qa held scenes `held-ring`, `held-low-beam` are in the corpus, not held out).
- One trace seed for the survey; repeatability checked on 21 designs only.
- The photo scene is synthetic. No real lithophane image was tried.
- Two Fill & fix settings coincide in some scenes (`ff-feat1` = `ff-bal-fast`; `ff-gap4`/`ff-gap0`/`ff-feat1` = `ff-bal-fast` on the full wash, where there are no gaps), so the 19 variants are not 19 independent points.
- `sqm` returns `NaN` for cutoff glare on `anya-lowbeam-1001` (nothing lit in the interior); the gate treats NaN as a veto.

## Open questions for Anya

1. **Cutoff:** is "no more than 5% of a typical lit cell, in the brightest 5×5 patch above the line" close to what you'd call *almost no light above*? And how many cells of edge misplacement can you live with (I used 1)?
2. **Hotspot:** is the hot zone "≥ 75% of the paint's max" right for your beam-shots, and is streaky spill up to 25% acceptable (the best `sparse-hot-16` design has 17%)?
3. **Text:** `p-hello` (3-cell strokes) is at the optical limit and no design draws it well. Should the tuner aim for it anyway, or should text mode assume thicker strokes?
4. **Photo:** can you give me a real image (or say which of your scenes is the lithophane case)? My scene is synthetic. Do you want tile texture penalised harder than I do?
5. **Fewest facets:** is "90% of the best quality the full budget reaches" the right bar, or do you have an absolute quality in mind?
6. **Max light:** "acceptable quality" = the gates of the paint's own kind (my proposal), or one neutral bar for everything?
7. **Scope:** should the tuner range across solvers (dish-fit topped text and some cutoff scenes, `sqm` topped light on some), or stay inside Fill & fix?
8. **Trace budget:** are ≤ 3 traces (about 1M rays each) per tuner run acceptable, given the ~60 s target?

## Files

Committed: `AUTOTUNE-MODES.md`, `tools/mode-scores.js` (metrics), `tools/mode-run.js` (run a plan of designs, save grids), `tools/mode-plans.js` (the plans I ran), `tools/mode-analyze.js` (ranked tables + montages), `tools/mode-budgets.js`, `tools/mode-pred.js`, `tools/mode-seeds.js`, `tools/mode-wrong-scene.js`, `tools/heatmap-png.js` (PNG encoder + montage), `tools/bench-scenes.js` (+`p-disc`, `p-photo`).
Not committed (gitignored `bench-out/modes/`): `runs/` (dumps), `runs.jsonl`, `tables/`, `img/`, `plans/`, and `bench-out/modes-seed7`, `-seed11`.
Reproduce: `node tools/mode-plans.js survey bench-out/modes/plans/survey.json && node tools/mode-run.js bench-out/modes/plans/survey.json --jobs 4`, then `node tools/mode-analyze.js <cutoff|hotspot|text|photo|uniformity|light> <scene> --montage`.
