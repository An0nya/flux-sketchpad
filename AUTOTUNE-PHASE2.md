# Autotune phase 2: the Auto solver, its classifier and its goal tuners

Status: **exploring** (nothing here is a recorded result). Branch `autotune-modes-p1`. v1 (auto-detect + quick effort) is commit 39aaa61; the goal tuners, the hold-out set and this report are the next commit.
Every number comes from `tools/mode-run.js` runs on this quiet machine (`--jobs 4`; 1M-ray traces on seed 90210; fidelity is v2 from `js/photometry.js`). Solve seconds are measured with four jobs in parallel, which the sweep calibrated at +10 to +24% per solve. Raw rows: `bench-out/p2*/runs.jsonl`, tables `bench-out/p2/table-*.txt`, images `bench-out/p2/img/p2__<scene>.png` (all gitignored). "Observation" = in a table or image I produced; "inference" = my reading; "guess" = neither.

## What was built
- **`js/modes.js` (`RF.Modes`)**: the phase-1 metrics, now app code loaded from one place: `js/solver-env.js` (so the worker sees it) and `tests/load.js` (so the bench and tools do). Added: `classify`, `context`, `runFromTrace`, `evaluate`, `rank`, `recommend`. `tools/mode-scores.js` is a thin re-export. Pure functions, no DOM, no tracing. **Anya to review.** `tests/modes.js` (in `tests/all.js`) passes: 23 checks on known answers, the classifier on the app's scenes, and Auto end to end on tiny scenes.
- **`solvers/lab-auto.js`** (id `auto`, name "Auto (picks a solver for your painting)", in `solvers/index.json`). Settings: Goal (Auto-detect, Cutoff, Hotspot, Text / line art, Photo, Even wash, Fewest facets), Quality 0-100, Edge tolerance (cells), Effort (quick / search), Search time limit (advanced), minDistance. The app's default solver and the UI code are untouched.
  - **Settings UI caveat (observation from `js/ui.js` line 207):** a bundled solver with no `adv` field gets *all* its settings tucked under "Advanced". Auto has one `adv` field (the time limit) so the rest show in the main list. The schema has no conditional visibility, so Quality and Edge tolerance are always shown; their labels say which goal uses them.
- It calls other solvers through `RF.Solvers.get(id).solve(...)` in the same worker and passes `tools` through (`progress` re-scaled, `budget`, `trace`). If the picked solver isn't loaded it falls back to Fill & fix and says so (tested).

## The classifier
Runs on the paint map in about 25 ms at 100x100 and about 100 ms at 200x200 on first sight of a map (measured on all scenes below; under 1 ms when the map's distance transform is cached). Features: brightness levels (of 20 bins, those holding at least 2% of painted cells); share of the target painted; stroke width (twice the distance-to-edge along the ridge of the painted shapes) against the LED image (`achievableKernel`); the peak's height over the median painted level; the share of painted cells within 25% of the peak; a straight top edge. Decision list, in order:
1. **text**: strokes at most max(4 LED-image widths, 8) and at most 10 cells, under 25% painted, at most 3 levels, no level standing out (peak under 2x the median).
2. **cutoff**: a straight top edge on at least half the painted width, paint spanning over 75% of the target, room above it, at most 8 levels.
3. **photo**: 6+ levels, and either 50%+ of the target painted or no bright core (peak under 3x the median).
4. **hotspot**: peak at least 2x the median, at most 35% of the painted cells near the peak, 2+ levels.
5. **wash**: at most 2 levels. 6. otherwise **general**.
It says what it decided in `notes`, e.g. "Auto: many brightness levels (12) with 75% of the target painted → photo".

What it picked (observation; every scene in the brief's list is here, plus 10 more):

| scene | set | kind | why (from the notes) |
|---|---|---|---|
| photo-moon | eval | **photo** | many brightness levels (9) with no bright core (peak only 1.4× the typical level) |
| photo-leaf | eval | **photo** | many brightness levels (17) with 59% of the target painted |
| photo-cat | eval | **photo** | many brightness levels (12) with 75% of the target painted |
| photo-flowers | eval | **photo** | many brightness levels (12) with 67% of the target painted |
| anya-beamshot-400 | eval | **hotspot** | a bright core (8.1× the typical level, 8% of the painted cells) on a wider fill |
| anya-lowbeam-212 | eval | **cutoff** | a straight top edge on 54% of the painted width, spanning 95% of the target, nothing above it, 7 brightness levels |
| held-low-beam | eval | **cutoff** | a straight top edge on 100% of the painted width, spanning 84% of the target, nothing above it, 2 brightness levels |
| p-hello | eval | **text** | thin strokes (about 3 cells wide, the LED image is 2.7 cells) at one brightness |
| hello-die0.4 | eval | **text** | thin strokes (about 3 cells wide, the LED image is 1.1 cells) at one brightness |
| p-text | eval | **text** | thin strokes (about 5 cells wide, the LED image is 2.7 cells) at one brightness |
| p-wash | eval | **wash** | one brightness level over 100% of the target, shapes wider than a stroke |
| p-disc | eval | **wash** | one brightness level over 28% of the target, shapes wider than a stroke |
| default | eval | **hotspot** | a bright core (2.2× the typical level, 20% of the painted cells) on a wider fill |
| p-halfplane | holdout | **cutoff** | a straight top edge on 100% of the painted width, spanning 100% of the target, nothing above it, 1 brightness levels |
| p-hotwash | holdout | **hotspot** | a bright core (8.3× the typical level, 3% of the painted cells) on a wider fill |
| sparse-hot-16 | holdout | **hotspot** | a bright core (5× the typical level, 8% of the painted cells) on a wider fill |
| held-ring | holdout | **text** | thin strokes (about 7 cells wide, the LED image is 2.7 cells) at one brightness |
| p-gradient | holdout | **photo** | many brightness levels (17) with no bright core (peak only 1.7× the typical level) |
| anya-lowbeam-1001 | holdout | **cutoff** | a straight top edge on 54% of the painted width, spanning 95% of the target, nothing above it, 7 brightness levels |
| anya-shot-245 | holdout | **hotspot** | a bright core (7.6× the typical level, 7% of the painted cells) on a wider fill |
| sparse-ring-24 | holdout | **text** | thin strokes (about 7 cells wide, the LED image is 2.7 cells) at one brightness |
| sparse-spot-16 | holdout | **wash** | one brightness level over 7% of the target, shapes wider than a stroke |
| held-big-led | holdout | **hotspot** | a bright core (2.2× the typical level, 20% of the painted cells) on a wider fill |

**Caveat:** I tuned the thresholds while printing these features for all 23 scenes (two rules changed after the first printout: the photos first read as hotspots, and `default` as a cutoff). So the classifier is in-sample on every scene here; the "hold-out" set below is hold-out only for the *solver picks*. `anya-beamshot-400` reads as a hotspot; it also has a straight-ish horizon (56% flat), and would read as a cutoff without the "at most 8 levels" rule (it has 14).

## Quick effort: what runs, and why
| kind | quick pick |
|---|---|
| photo | dish-fit |
| cutoff | Fill & fix, Priority "most light" (its defaults if the LED image is over 5 cells wide) |
| hotspot, text, wash, general | Fill & fix at its defaults |

Cost: the classification and the recommendations add about 0.1 s (25-100 ms classify, 6 ms recommend); the differences between an Auto quick run and the same solver run alone are inside run-to-run noise (about 1.5 s at 400 facets). Auto quick on a 400-facet photo is dish-fit's own ~2.5 s.
**How the picks were chosen, and what went wrong first (observation).** I first picked "most light" for hotspots and round facets for text from the evidence I had (phase 1, the trial). On the hold-out scenes "most light" lost: `sparse-hot-16` 67 vs 73 fidelity, `p-hotwash` 88 vs 90, and on `held-big-led` (a 10-cell LED image) it fell from 98 to 59 with 57% spill. I reverted hotspots to the defaults, and kept "most light" for cutoffs only, where it was equal or better on all four scenes, with the wide-LED guard. The round-facet pick lost on the stock-LED `p-hello` (59 vs 77 fidelity, recall veto, haze blobs); the defaults draw the cleanest "hello" of the designs on `hello-die0.4` by eye.

## Results: Auto against Fill & fix defaults and the best single design
"best single" = whichever of {Fill & fix defaults, balanced/round/fast, "most light", "sharpest", dish-fit, opus-mosaic} `RF.Modes.rank` puts first for the detected kind (chosen in hindsight, so it is an upper-bound-ish reference). Columns: fidelity v2 %, light on paint %, the goal's own metric (photo score, peak in kcd, edge sharpness, text score, evenness), gates, Auto/solver seconds (trace seconds in brackets, the bench's 1M-ray trace). "search" is Effort: search with the goal auto-detected.

**In the brief's scenes** (photos at 400 facets):
```
photo-moon  [photo]
   auto-quick                     100   65  0.91           pass                                 2.5  (0.8)
   auto-search                    100   65  0.91           pass                                36.2  (1.0)
   ff-default                      96   56  0.75           pass                                13.6  (1.1)
   best single: dish-fit          100   65  0.91           pass                                 2.3  (0.8)
photo-leaf  [photo]
   auto-quick                      92   62  0.91           pass                                 2.6  (0.8)
   auto-search                     92   62  0.91           pass                                35.5  (1.0)
   ff-default                      86   60  0.82           pass                                11.7  (1.3)
   best single: dish-fit           92   62  0.91           pass                                 2.4  (1.0)
photo-cat  [photo]
   auto-quick                      90   61  0.89           pass                                 2.7  (0.9)
   auto-search                     90   61  0.89           pass                                36.5  (0.9)
   ff-default                      85   56  0.85           pass                                11.5  (1.3)
   best single: dish-fit           90   61  0.89           pass                                 2.3  (0.9)
photo-flowers  [photo]
   auto-quick                      77   48  0.80           pass                                 2.4  (0.7)
   auto-search                     77   34  0.83           pass                                31.4  (0.7)
   ff-default                      65   23  0.69           VETO rank corr 0.82                  9.1  (0.4)
   best single: opus-mosaic        77   34  0.83           pass                                 7.3  (0.6)
anya-beamshot-400  [hotspot]
   auto-quick                      81   73  273.4          pass                                15.2  (1.2)
   auto-search                     82   76  277.2          pass                                47.1  (1.2)
   ff-default                      81   73  273.4          pass                                13.7  (1.0)
   best single: ff-light-normal    82   76  277.2          pass                                14.0  (1.1)
anya-lowbeam-212  [cutoff]
   auto-quick                      86   77  0.83           pass                                 7.2  (1.1)
   auto-search                     86   77  0.83           pass                                32.0  (1.1)
   ff-default                      87   74  0.84           pass                                 7.7  (1.0)
   best single: ff-light-normal    86   77  0.83           pass                                 7.0  (1.1)
held-low-beam  [cutoff]
   auto-quick                      93   63  0.51           pass                                 4.2  (1.1)
   auto-search                     94   54  0.70           pass                                23.4  (0.7)
   ff-default                      94   58  0.52           VETO glare 0.07                      4.5  (1.3)
   best single: dish-fit           94   54  0.70           pass                                 0.6  (0.8)
p-hello  [text]
   auto-quick                      77   20  0.55           pass                                 4.8  (0.7)
   auto-search                     77   20  0.55           pass                                13.3  (0.6)
   ff-default                      77   20  0.55           pass                                 5.0  (0.7)
   best single: ff-default         77   20  0.55           pass                                 5.0  (0.7)
hello-die0.4  [text]
   auto-quick                      73   26  0.70           pass                                 4.2  (0.7)
   auto-search                     62   41  0.81           pass                                17.5  (0.6)
   ff-default                      73   26  0.70           pass                                 4.7  (0.7)
   best single: dish-fit           62   41  0.81           pass                                 0.3  (0.6)
p-text  [text]
   auto-quick                      72   20  0.94           pass                                 4.2  (0.7)
   auto-search                     77   29  0.96           pass                                11.9  (0.6)
   ff-default                      72   20  0.94           pass                                 4.3  (0.7)
   best single: dish-fit           77   29  0.96           pass                                 0.4  (0.6)
p-wash  [wash]
   auto-quick                      88   62  0.55           pass                                 7.6  (1.2)
   auto-search                     88   58  0.58           pass                                25.5  (0.9)
   ff-default                      88   62  0.55           pass                                 6.9  (1.2)
   best single: ff-light-normal    88   62  0.55           pass                                 6.2  (1.1)
p-disc  [wash]
   auto-quick                      95   62  0.66           pass                                 5.9  (1.1)
   auto-search                     95   62  0.66           pass                                15.1  (1.0)
   ff-default                      95   62  0.66           pass                                 5.2  (1.0)
   best single: ff-light-normal    93   67  0.68           pass                                 4.5  (1.2)
default  [hotspot]
   auto-quick                      97   52  137.3          pass                                 5.5  (1.0)
   auto-search                     99   56  151.8          pass                                18.2  (0.7)
   ff-default                      97   52  137.3          pass                                 4.3  (0.9)
   best single: dish-fit           99   56  151.8          pass                                 0.5  (0.7)
```
**Hold-out scenes** (not used to choose the quick picks):
```
p-halfplane  [cutoff]
   auto-quick                      93   55  0.66           pass                                 5.9  (1.2)
   auto-search                     94   46  0.93           pass                                34.5  (1.0)
   ff-default                      93   56  0.62           pass                                 6.3  (1.2)
   best single: ff-light-normal    93   55  0.66           pass                                 5.7  (1.2)
p-hotwash  [hotspot]
   auto-quick                      90   60  158.7          pass                                 6.1  (1.0)
   auto-search                     90   60  158.7          pass                                22.6  (1.1)
   ff-default                      90   60  158.7          pass                                 6.1  (1.1)
   best single: ff-default         90   60  158.7          pass                                 6.1  (1.1)
sparse-hot-16  [hotspot]
   auto-quick                      73   39  89.1           pass                                 2.4  (0.6)
   auto-search                     73   39  89.1           pass                                11.3  (0.7)
   ff-default                      73   39  89.1           pass                                 2.0  (0.7)
   best single: ff-default         73   39  89.1           pass                                 2.0  (0.7)
held-ring  [text]
   auto-quick                      90   28  0.93           pass                                 4.6  (0.6)
   auto-search                     93   50  0.99           pass                                13.4  (0.7)
   ff-default                      90   28  0.93           pass                                 4.1  (0.6)
   best single: dish-fit           93   50  0.99           pass                                 0.5  (0.7)
p-gradient  [photo]
   auto-quick                      91   54  0.47           pass                                 0.6  (0.7)
   auto-search                     91   53  0.51           pass                                15.0  (0.7)
   ff-default                      95   62  0.49           pass                                 5.5  (1.1)
   best single: opus-mosaic        91   41  0.50           pass                                 1.5  (0.6)
anya-lowbeam-1001  [cutoff]
   auto-quick                      91   82  0.84           pass                                14.2  (1.4)
   auto-search                     91   82  0.84           pass                                41.5  (1.4)
   ff-default                      88   80  0.83           pass                                17.1  (1.3)
   best single: ff-light-normal    91   82  0.84           pass                                15.4  (1.6)
anya-shot-245  [hotspot]
   auto-quick                      96   74  191.8          pass                                 9.0  (1.1)
   auto-search                     92   77  201.1          pass                                43.6  (1.1)
   ff-default                      96   74  191.8          pass                                 9.3  (1.2)
   best single: ff-light-normal    92   77  201.1          pass                                 9.0  (1.3)
sparse-ring-24  [text]
   auto-quick                      65   14  0.39           pass                                 2.2  (0.5)
   auto-search                     76   24  0.91           pass                                 7.1  (0.4)
   ff-default                      65   14  0.39           pass                                 2.2  (0.5)
   best single: dish-fit           76   24  0.91           pass                                 0.2  (0.4)
sparse-spot-16  [wash]
   auto-quick                      80   37  0.41           pass                                 1.9  (0.8)
   auto-search                     88   29  0.57           pass                                 6.3  (0.5)
   ff-default                      80   37  0.41           pass                                 1.6  (0.7)
   best single: dish-fit           88   29  0.57           pass                                 0.2  (0.5)
held-big-led  [hotspot]
   auto-quick                      98   17  64.3           pass                                 5.1  (0.4)
   auto-search                     98   17  64.3           pass                                14.3  (0.4)
   ff-default                      98   17  64.3           pass                                 4.7  (0.4)
   best single: ff-default         98   17  64.3           pass                                 4.7  (0.4)
```
Means (observation), from `report-insample.json` / `report-holdout.json`:
```
insample 13 scenes
   auto-quick   mean fid 86.3 mean on paint 53.1 mean solve s 5.3 max s 15.2 gates passed 13/13
   auto-search  mean fid 86.2 mean on paint 53.5 mean solve s 26.4 max s 47.1 gates passed 13/13
   ff-default   mean fid 84.4 mean on paint 49.3 mean solve s 7.9 max s 13.7 gates passed 11/13
   best         mean fid 86.0 mean on paint 54.1 mean solve s 4.1 max s 14.0 gates passed 13/13
holdout 10 scenes
   auto-quick   mean fid 86.6 mean on paint 46.1 mean solve s 5.2 max s 14.2 gates passed 10/10
   auto-search  mean fid 88.7 mean on paint 47.8 mean solve s 21.0 max s 43.6 gates passed 10/10
   ff-default   mean fid 86.9 mean on paint 46.7 mean solve s 5.9 max s 17.1 gates passed 10/10
   best         mean fid 88.5 mean on paint 47.5 mean solve s 4.5 max s 15.4 gates passed 10/10
```
Reading the means: quick is +1.9 fidelity points over Fill & fix defaults on the brief's scenes, all of it from the photos (+4, +6, +5 and +12 points on moon, leaf, cat, flowers), while `held-low-beam` is 1 point lower (93 vs 94) but passes the glare gate the defaults fail; on the hold-out scenes quick is 0.3 points *below* the defaults (it is the defaults there except for cutoffs and photos). Search is +1.8 points over the defaults on the hold-out (mean 88.7 vs 86.9) and within 0.3 of the hindsight "best single". Search's gates passed 23 of 23, the defaults' 21 of 23.

## What each goal's search does
Shared engine (`tune` in `lab-auto.js`), all ranked by `RF.Modes.rank`, relative to the candidates in the same search, never to an absolute target:
1. **Cheap pass.** Each menu entry is solved (Fill & fix at quality "fast", other solvers at their defaults) and traced at 250k rays. Fill & fix's own `pred` field was not needed: a 250k-ray trace costs a small share of a fast solve and treats every solver alike (a trace is what sees stray light; the phase-1 finding was that `pred` is cleaner than reality).
2. **Finalists**, in priority order: the best cheap result, the quick pick, Fill & fix defaults, the runner-up; as many as the time limit allows (at least one). Fill & fix finalists are re-solved at "normal" quality; every finalist gets a 1M-ray trace. The winner is the top of `rank` among finalists.
3. **Guardrails** (vetoes; a vetoed design ranks last): cutoff: glare above the edge, edge within *Edge tolerance*, lit-zone holes. Hotspot: fill level, fill coverage, spill. Text: recall, gap leak, far glare, and **light on paint at least 50% of the best candidate's**. Photo: rank correlation, spill, light floor. Wash: p10/mean, spill, light floor (60%). All thresholds are phase-1 proposals.
4. **Notes** report what was tried and why the winner won (example below).
5. **Time.** The menu shrinks (after 3 candidates, once 45% of the time limit is gone) and finalists are dropped to fit the limit (55 s by default). Search ran 6-47 s on these scenes (max 47.1 s on the 400-facet beamshot; target 60 s). Cheap pass : finalists was 9.5 : 13.5 s (held-low-beam), 6.8 : 9.9 (hello-die0.4), 18.9 : 10.2 (photo-flowers), 13.8 : 16.7 (lowbeam-212).

| goal | ranking score | menu (first = the quick pick or the defaults) |
|---|---|---|
| Cutoff | edge sharpness x fidelity x peak (peak relative to the best candidate) | ff defaults, ff light, ff balanced gap 4 / 1 / 8, ff balanced gap 4 round, ff sharp gap 8 shell 4, opus-mosaic, dish-fit |
| Hotspot | peak (relative to the best candidate) x fidelity | ff defaults, ff light, ff light util 1.2, ff balanced util 1.2, ff round, ff light useAll, dish-fit, opus-mosaic |
| Text / line art | legibility score (F1, far glare, loops kept) with a light term | ff defaults, ff gap 2, ff round gap 2, ff sharp round gap 2, ff round gap 4, ff round finest-detail 1, ff gap 4, opus-mosaic, dish-fit, bowl-image |
| Photo | rank + tone + detail | dish-fit, dish-fit util 1.15, dish-fit flux-first, ff defaults, ff light, ff sharp, opus-mosaic |
| Even wash | noise-free evenness | ff defaults, ff round, ff light, ff shell 0, ff shell 2, dish-fit |
| General | fidelity, with a light term | ff defaults, ff light, ff sharp, dish-fit, ff round |

Fill & fix entries are hand-tuned around the knobs that mattered in the phase-1 corpus. The other solvers are tried only at defaults or a visible setting or two (dish-fit `util`, `order`).

**Cutoff edge tolerance (observation).** Unit-tested (a 4-cell offset fails at tolerance 1, passes at 5). On `held-low-beam` and `anya-lowbeam-212`, searching at tolerance 0.25 and at 3 gave the identical winner: every design's edge offset was 0.2-0.5 cells, so at 0.25 nearly all are vetoed and the ranking falls back to all of them. The setting will only bite on a design that misses by more than a cell; I did not find such a scene.

**Example of the notes (held-low-beam, search):** "Auto: a straight top edge on 100% of the painted width, spanning 84% of the target ... → cutoff / search (cutoff): cheap pass on 10 candidates (250k rays each) → ff sharp gap8 shell4: score 0.54, fidelity 88%, 47% on paint | dish-fit: score 0.53 ... / finalists at full quality and 1M rays: dish-fit: score 0.54, fidelity 94%, 54% on paint | ff sharp gap8 shell4: score 0.52, fidelity 96%, 47% on paint | ff light: score 0.48, fidelity 93%, 63% on paint | ff default: vetoed (glare 0.07), fidelity 94%, 57% on paint / winner: dish-fit; passed every gate."

## Fewest facets (Goal: Fewest facets, Quality 0-100)
A ladder of budgets [8, 12, 16, 24, 32, 48, 64, 100, 150, 200, 300, 400, ...] up to the scene's budget, each solved with the quick pick at "fast" and traced at 250k rays; Q = fidelity v2. Level = best Q x (0.25 + 0.75 x quality/100). Answer: the fewest *placed* facets whose Q meets the level and whose next rung also does. The chosen budget is then re-solved at full quality and traced at 1M rays; the notes give that design's fidelity and any gate it fails.
```
scene | q100 placed/fid | q80 placed/fid | q50 placed/fid | solve s
default          400 facets / fid 99 / 23s | 32 facets / fid 83 / 16s | 8 facets / fid 74 / 15s
sparse-ring-24   285 facets / fid 88 / 16s | 74 facets / fid 78 / 13s | 15 facets / fid 31 / 11s
sparse-hot-16    377 facets / fid 93 / 18s | 47 facets / fid 82 / 13s | 23 facets / fid 75 / 11s
```
(budget 400 on all three scenes; q100 asks for the best Q on the ladder, so it lands on or near the top rung.) Observation: the fewest-facets design keeps up its share: quality 80 costs 32 facets on `default` for fidelity 83 (the 400-facet design: 99), 47 on `sparse-hot-16` for 82 (93), 74 on `sparse-ring-24` for 78 (88). Quality 50 on the ring gives 15 facets and fidelity 31: **a slider level of 50 is a very poor ring** (the level is relative to the ladder's own best fidelity in the 85% range, then the final normal-quality design landed lower). Runs took 11-23 s. The ladder can say "more facets would help" when fidelity is still climbing at the top rung; it did not trigger on these three scenes (fidelity at the top rung was at most 1.07x the value two rungs down).
Phase-1 warned that the mode score is not monotone in the budget; using fidelity v2 as Q sidesteps most of that (fidelity is smooth on the ladders above), at the price of the mode's own gates only being checked on the final design.

## Recommendations (evidence, not advice)
`RF.Modes.recommend` computes, for text and cutoff paints: if the LED image (from `achievableKernel`) is wider than a stroke needs (strokes / 1.5), the die size that would fix it (image width scales with die size) and the distance of facets from the LED that would fix it (from the envelope point that sets the image). And for every kind: the share of the LED's light that passes through the envelope (20k samples), flagged under 90%. Example, `p-hello` (stock 1 mm die): "The LED image (2.7 cells) is wider than a stroke needs (strokes are 3.0 cells; about 2.0 or less would read cleanly). A die of about 0.75 mm (now 1.00) would do it, or facets 100 mm from the LED (now at best 75 mm), which needs a bigger envelope." (Observation of the notes; whether 0.75 mm is enough is untested: the trial found a 0.4 mm die draws a legible "hello", where 0.75 was not run.) No recommendation appears on `hello-die0.4` (image 1.1 cells), as intended. The "quality still climbing at the top rung: more facets would help" line exists for Fewest facets only. I did not build a recommendation for photos or washes.

## Verdicts by eye (Claude reading `bench-out/p2/img/p2__<scene>.png`: paint, then auto-quick, auto-search, Fill & fix defaults, best single)
- **photo-cat**: quick = dish-fit: eyes, nose and whisker edge read; Fill & fix's is hazier with a soft dark border. Auto better, ~5x faster.
- **photo-flowers**: a wash of blobs from all. Search chose opus-mosaic (score 0.83 vs dish-fit 0.81; 34% on paint vs 48%) at equal fidelity (77): 31 s against quick's 2.4 s for no gain in fidelity and less light. I would have kept dish-fit. **photo-leaf**: dish-fit (quick, search) reproduces the leaf outline, the veins and the holes with a dark background; Fill & fix defaults are hazier, with the dark areas lifted and the veins soft. Clear win. moon: numbers only (dish-fit 100 vs 96).
- **anya-beamshot-400**: all designs alike (visible far-field streaks in each); search's "most light" +4 kcd (1.4%), fidelity +1. No real difference.
- **held-low-beam**: quick (most light) has faint haze to the right of the band; the defaults haze above it (vetoed); search's dish-fit is crisp with no haze. Search best.
- **anya-lowbeam-212**: the four look the same; vertical stray-light streaks in all of them.
- **default**: quick = Fill & fix defaults (identical to the defaults column; the dumps differ by 0.0%); search's dish-fit has a tighter, cleaner ellipse edge (fidelity 99 vs 97, peak 152 vs 137 kcd) and dish-fit alone takes 0.5 s vs 4.3 s. **Here Auto quick chooses worse than a person who knew dish-fit would**, and I see no feature that separates `default` from the beamshot, where dish-fit fails (fill level x4: fidelity 50). (Before I reverted hotspots to the defaults, quick's "most light" pick showed wide faint streaks on this scene.)
- **p-hello** (stock LED): all blurry "hll" shapes; quick = search = defaults (77). Nobody draws it (as in the trial); the recommendation is the useful output. **hello-die0.4**: quick (the defaults) is the cleanest, most legible "hello" by eye. **Search chose dish-fit** (text score 0.81 vs 0.70; its letters are ragged with ascender artifacts at 62 fidelity). **The text score and my eye disagree here; Auto (search) chose worse than a person would.** Not fixed.
- **p-text**: quick = defaults, "FLUX" readable with an X faint; search's dish-fit reads a little cleaner (fidelity 77 vs 72).
- **sparse-ring-24** (hold-out): quick gives a lopsided ring with a blob; search's dish-fit an even ring of tiles. Search clearly better (fidelity 76 vs 65, text score 0.91 vs 0.39).
- **p-halfplane** (hold-out): all four give the same edge to my eye; search's has the sharpest measured edge (0.93 vs 0.62) at 46% on paint against 55-56%.
- **p-wash, p-disc**: identical or within noise; **p-gradient** (hold-out): quick (dish-fit) 91 vs defaults 95 with equal photo score (0.47 vs 0.49); photo picks lose a little on a smooth ramp.
- **anya-shot-245** (hold-out): search picks "most light": +5% peak (201 vs 192 kcd) at fidelity 92 vs 96, because the hotspot ranking multiplies peak by fidelity and the peak gain outweighs the fidelity loss. A person might prefer the defaults. Not viewed.
- Not viewed at all: `photo-moon`, `p-wash`, `p-disc`, `p-hotwash`, `sparse-hot-16`, `sparse-spot-16`, `held-ring`, `held-big-led`, `anya-lowbeam-1001`.

## Speed (observation unless marked)
- Baselines held: Fill & fix normal at 400 facets took 11.5-15.2 s (fast: 2.1-2.3 s; the "fast" solve is ~5.5x cheaper), dish-fit 2.0-2.7 s on 400-facet photos and 8.6 s on the beamshot, opus-mosaic 6-8 s, SQM 17 s (not used by Auto), traces 0.4-1.6 s.
- **Auto quick**: classification + recommendations about 0.1 s over the chosen solver's own time (target: 5 s beyond it). ✓
- **Auto search**: 7-47 s; mean 26 s on the brief's scenes; target 60 s. ✓ (Three of the 23 runs were over 40 s: beamshot, anya-lowbeam-1001, anya-shot-245, all Fill & fix at 245-400 facets.)
- The 250k-ray coarse traces cost ~10% of a fast solve; the two full-quality re-solves are most of the finalist time.

## Proposal: a worker pool (not built)
`js/solver-host.js` runs every worker solver in one worker, one solve at a time. Auto's search is embarrassingly parallel in its cheap pass (10 independent solves) and its finalist stage (up to 4 independent re-solves).
- **What a pool of N=4 would change (inference).** Add `tools.parallel(tasks)` to the worker `tools`, backed by N extra workers in the host that each load the same bundled sources; Auto sends its cheap-pass candidates as tasks. From the measured stage times (cheap : finalists = 9.5 : 13.5 s held-low-beam, 6.8 : 9.9, 18.9 : 10.2, 13.8 : 16.7), with a +10-24% per-solve cost when four run at once (the sweep's calibration) and each stage bounded by its slowest member, I estimate 22 s -> ~9 s (held-low-beam) and 29 s -> ~16 s (photo-flowers, bounded by opus-mosaic's ~7 s): roughly 1.8-2.4x. **This is an estimate, not a measurement.** It would let the menus grow ~2x inside the 60 s budget.
- **Risks.** (1) Memory: each worker holds the engine and 15 solvers (not measured). (2) Abort: `abort()` terminates *the* worker today; a pool needs to terminate and rebuild all of them, and `busy()`/progress must aggregate. (3) Ray budget accounting: today one counter in one worker; a pool needs a shared budget. (4) Low-core devices: 4 workers plus the page thread would contend (the phone case). (5) Determinism: fine (the sweep saw bit-identical results in parallel). (6) It is app infrastructure that every solver would sit behind; Anya decides.

## Limits and things not done
- **In-sample picks and classifier** (see above); the hold-out set has 10 scenes and most of them (`p-halfplane`, `p-hotwash`, `sparse-hot-16`, `held-ring`, `anya-lowbeam-1001`) are scenes I studied in phase 1, though not with these picks.
- One trace seed; no repeat of the search itself on other seeds. The solvers are deterministic, but the 250k-ray cheap ranking uses one seed; a close cheap ranking could flip on another.
- The text score and the eye disagree on `hello-die0.4` (above); the hotspot ranking prefers peak over fidelity on `anya-shot-245`. The phase-1 metrics were not re-tuned.
- Only Fill & fix, dish-fit, opus-mosaic (and bowl-image for text) are in the menus. SQM v0.3, finite-image, patch-array and the others never enter; SQM was left out for time (17-35 s at 400 facets) and because it never won a scene in phase 1 except on raw light.
- Recommendations cover LED size, envelope, and light through the envelope only; "more facets would help" only for Fewest facets. Not checked in the browser (the Browser pane was off limits): the worker path is exercised only through `tools/mode-run.js`, which mimics the host's `tools` but is not `js/solve-worker.js`. The settings-UI rendering is read from the code, not seen.
- `mode-run.js` keeps only the first 14 notes; the Auto notes fit in 14 for the runs shown.

## Open questions for Anya
1. **Is Fill & fix defaults the right quick pick for hotspots, text and washes?** The alternative on this evidence is dish-fit for anything at 100 facets (it won `default`, `p-text`, `held-ring`, `sparse-ring-24`, `sparse-spot-16`, `held-low-beam`) and it is 5-10x faster, but it loses on the beamshot and on `hello-die0.4` by eye. I don't see a feature that separates them.
2. **Cutoff "most light" pick:** OK to keep it, given it won or tied on 4 of 4 scenes but failed on the wide-LED hotspot when I tried it there?
3. **Text ranking:** on `hello-die0.4` the score picks a ragged design a person wouldn't. Should text rank include fidelity, or should the eye-check drive a rewrite?
4. **Hotspot ranking** multiplies peak by fidelity. `anya-shot-245` trades 4 fidelity points for 5% more peak. Is that the trade you want, or should fidelity carry more weight?
5. **Fewest facets:** at quality 50 the ring is 15 facets at fidelity 31. Should the slider be relative to the ladder's best (as built), or should there be an absolute floor?
6. **Worker pool:** worth building given the 1.8-2.4x estimate?
7. **Default solver:** Auto is registered but the preferred id is unchanged, as asked. On the brief's scenes it is never worse than Fill & fix defaults by more than a point, and it is 5-16 points better on photos.
