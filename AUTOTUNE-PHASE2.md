# Autotune phase 2: Auto (v1: auto-detect + quick effort)

Status: exploring. This is the **v1 commit** (classifier + quick effort + the evaluation of it); the goal tuners (effort "search", Fewest facets) come next and this file will be rewritten around them.
All numbers below are from `tools/mode-run.js` runs (1M rays, trace seed 90210, machine quiet, `--jobs 4`), fidelity = v2 (`js/photometry.js` with the far-field term).

## What was built
- `js/modes.js` (`RF.Modes`): the phase-1 metrics moved into the app's solver environment (`js/solver-env.js`, `tests/load.js`), plus `classify`, `context`, `runFromTrace`, `evaluate`, `rank`, `recommend`. `tools/mode-scores.js` re-exports it. `tests/modes.js` is in `tests/all.js`.
- `solvers/lab-auto.js` (id `auto`, registered in `solvers/index.json`). Settings: Goal, Quality (0-100), Edge tolerance (cells), Effort, minDistance. The PREFERRED_ID and the UI are untouched.

## The classifier (25 ms on a 100x100 paint map)
Features: brightness levels (of 20 bins, those holding at least 2% of painted cells), share of the target painted, stroke width (twice the distance-to-edge along the ridge of the painted shapes) against the LED image (`achievableKernel`), how far the brightest level stands above the median, the share of painted cells within 25% of the peak, and a straight top edge (share of painted columns whose top lies within a row of the most common top row, with nothing painted above it). A short decision list, in this order:
1. **text**: strokes at most max(4 x LED image, 8) and at most 10 cells, less than 25% painted, 3 levels or fewer, no level standing out.
2. **cutoff**: straight top edge on at least 50% of the painted width, paint spanning over 75% of the target, room above it, 8 levels or fewer.
3. **photo**: 6 or more levels and either 50% or more of the target painted or no bright core (peak under 3x the median).
4. **hotspot**: peak at least 2x the median, at most 35% of painted cells near the peak, 2 or more levels.
5. **wash**: 2 levels or fewer. 6. otherwise **general**.
It writes its reasoning in `notes` ("Auto: ...").

## Quick picks (what "quick" runs) and why
photo: dish-fit. hotspot, cutoff: Fill & fix, Priority "most light". text, wash, general: Fill & fix defaults. **The picks were made after looking at these same scenes** (see the table), so treat the table as in-sample.

## Quick effort against Fill & fix at defaults, and against the best single reference design
"best single" = whichever of {Fill & fix defaults, Fill & fix balanced/round/fast, Fill & fix "light", Fill & fix "sharp", dish-fit, opus-mosaic} `RF.Modes.rank` puts first for the detected kind. Solve s is the solver's own time; (trace s) is the 1M-ray trace the bench adds.

```
## photo-moon  → detected: photo (many brightness levels (9) with no bright core (peak only 1.4× the typical level) → photo)
   design                         fid  onP  photo score    gates                             solve s  (trace s)
   auto-quick                     100   65  0.91           pass                                 2.4  (0.8)
   ff-default                      96   56  0.75           pass                                13.6  (1.1)
   best single: dish-fit          100   65  0.91           pass                                 2.3  (0.8)
## photo-leaf  → detected: photo (many brightness levels (17) with 59% of the target painted → photo)
   design                         fid  onP  photo score    gates                             solve s  (trace s)
   auto-quick                      92   62  0.91           pass                                 2.5  (0.9)
   ff-default                      86   60  0.82           pass                                11.7  (1.3)
   best single: dish-fit           92   62  0.91           pass                                 2.4  (1.0)
## photo-cat  → detected: photo (many brightness levels (12) with 75% of the target painted → photo)
   design                         fid  onP  photo score    gates                             solve s  (trace s)
   auto-quick                      90   61  0.89           pass                                 2.6  (0.9)
   ff-default                      85   56  0.85           pass                                11.5  (1.3)
   best single: dish-fit           90   61  0.89           pass                                 2.3  (0.9)
## photo-flowers  → detected: photo (many brightness levels (12) with 67% of the target painted → photo)
   design                         fid  onP  photo score    gates                             solve s  (trace s)
   auto-quick                      77   48  0.80           pass                                 2.3  (0.7)
   ff-default                      65   23  0.69           VETO rank corr 0.82                  9.1  (0.4)
   best single: opus-mosaic        77   34  0.83           pass                                 7.3  (0.6)
## anya-beamshot-400  → detected: hotspot (a bright core (8.1× the typical level, 8% of the painted cells) on a wider fill → hotspot)
   design                         fid  onP  peak kcd       gates                             solve s  (trace s)
   auto-quick                      82   76  277.2          pass                                14.0  (1.1)
   ff-default                      81   73  273.4          pass                                13.7  (1.0)
   best single: ff-light-normal    82   76  277.2          pass                                14.0  (1.1)
## anya-lowbeam-212  → detected: cutoff (a straight top edge on 54% of the painted width, spanning 95% of the target, nothing above it, 7 brightness levels → cutoff)
   design                         fid  onP  edge sharpness gates                             solve s  (trace s)
   auto-quick                      86   77  0.83           pass                                 7.1  (1.1)
   ff-default                      87   74  0.84           pass                                 7.7  (1.0)
   best single: ff-light-normal    86   77  0.83           pass                                 7.0  (1.1)
## held-low-beam  → detected: cutoff (a straight top edge on 100% of the painted width, spanning 84% of the target, nothing above it, 2 brightness levels → cutoff)
   design                         fid  onP  edge sharpness gates                             solve s  (trace s)
   auto-quick                      93   63  0.51           pass                                 4.1  (1.1)
   ff-default                      94   58  0.52           VETO glare 0.07                      4.5  (1.3)
   best single: dish-fit           94   54  0.70           pass                                 0.6  (0.8)
## p-hello  → detected: text (thin strokes (about 3 cells wide, the LED image is 2.7 cells) at one brightness → text / line art)
   design                         fid  onP  text score     gates                             solve s  (trace s)
   auto-quick                      77   20  0.55           pass                                 4.7  (0.6)
   ff-default                      77   20  0.55           pass                                 5.0  (0.7)
   best single: ff-default         77   20  0.55           pass                                 5.0  (0.7)
## hello-die0.4  → detected: text (thin strokes (about 3 cells wide, the LED image is 1.1 cells) at one brightness → text / line art)
   design                         fid  onP  text score     gates                             solve s  (trace s)
   auto-quick                      73   26  0.70           pass                                 4.1  (0.7)
   ff-default                      73   26  0.70           pass                                 4.7  (0.7)
   best single: dish-fit           62   41  0.81           pass                                 0.3  (0.6)
## p-text  → detected: text (thin strokes (about 5 cells wide, the LED image is 2.7 cells) at one brightness → text / line art)
   design                         fid  onP  text score     gates                             solve s  (trace s)
   auto-quick                      72   20  0.94           pass                                 4.0  (0.7)
   ff-default                      72   20  0.94           pass                                 4.3  (0.7)
   best single: dish-fit           77   29  0.96           pass                                 0.4  (0.6)
## p-wash  → detected: wash (one brightness level over 100% of the target, shapes wider than a stroke → even wash)
   design                         fid  onP  evenness       gates                             solve s  (trace s)
   auto-quick                      88   62  0.55           pass                                 6.8  (1.0)
   ff-default                      88   62  0.55           pass                                 6.9  (1.2)
   best single: ff-light-normal    88   62  0.55           pass                                 6.2  (1.1)
## p-disc  → detected: wash (one brightness level over 28% of the target, shapes wider than a stroke → even wash)
   design                         fid  onP  evenness       gates                             solve s  (trace s)
   auto-quick                      95   62  0.66           pass                                 5.2  (1.0)
   ff-default                      95   62  0.66           pass                                 5.2  (1.0)
   best single: ff-light-normal    93   67  0.68           pass                                 4.5  (1.2)
## default  → detected: hotspot (a bright core (2.2× the typical level, 20% of the painted cells) on a wider fill → hotspot)
   design                         fid  onP  peak kcd       gates                             solve s  (trace s)
   auto-quick                      96   55  144.6          pass                                 3.9  (1.1)
   ff-default                      97   52  137.3          pass                                 4.3  (0.9)
   best single: dish-fit           99   56  151.8          pass                                 0.5  (0.7)
```
Images: `bench-out/p2/img/p2__<scene>.png` (gitignored): paint, then auto-quick, Fill & fix defaults, best single.

## Verdicts so far (eye; Claude reading the PNG)
- Photos: Auto = dish-fit, 5-16 fidelity points and ~5x faster than Fill & fix defaults on moon, leaf, cat, flowers. Cat: eyes and nose read in Auto's, Fill & fix's is hazier with a soft dark border. Flowers: a wash of blobs in both; opus-mosaic is crisper (fidelity equal, 77).
- Beam shot, wash, cutoff (212): Auto is the same as, or within a point of, Fill & fix defaults. Held-low-beam: defaults are vetoed by glare (0.07), Auto passes (0.04).
- Text: Auto equals the defaults (the round-facet pick I first tried was worse on the stock-LED "hello": 59 fidelity, haze blobs, recall veto; it was replaced). **Metric-vs-eye disagreement:** on `hello-die0.4` the text score ranks dish-fit (0.81) above Fill & fix defaults (0.70), but by eye the defaults draw the cleanest, most legible "hello" of the three.
- `default` and `p-text`: dish-fit beats Auto's pick (152 vs 145 kcd at fidelity 99 vs 96; text score 0.96 vs 0.94).
