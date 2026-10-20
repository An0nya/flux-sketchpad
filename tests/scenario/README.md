# Scenario harness

A scenario is a small JSON file that sets up one drive-view situation (road, wetness, air, traffic, a beam). The runner sets it up, steps the view by frame count, and writes a PNG, a frame hash, and mean luminance for each named frame. An agent can read the numbers back instead of clicking through the UI.

## Run it

Node only (CPU render, no browser, no GPU):

    node tests/scenario/run.js tests/scenario/examples            # a dir, or one file
    node tests/scenario/run.js tests/scenario/examples/road-wet.json

Browser (the real page, with the GPU drive renderer; needs the server and Playwright):

    python3 tests/serve.py 8994 &            # note the PID: echo $! > pidfile
    PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/scenario/run.js tests/scenario/examples 8994
    kill $(cat pidfile)                      # stop the server by PID, never pkill

Output goes to `tests/scenario/out/` (gitignored): `<name>.json` plus `<name>-<capture>.png` for each capture. The JSON records the mode (`node` or `browser`), the options, and per capture: `hash` (sha256 of the PNG), `luma` (mean of (R+G+B)/3 over the whole frame, 0 to 255), `regions` (the same mean over each named region), `dist` and `t`. Browser output also has `counters` (renderer, GPU failure, the air-beam table counters `SD_SCATTER`, the page errors), `rerunSame` (the same pass run again in the same session gave identical hashes), and `ready`.

Node mode and browser mode are not interchangeable. Node uses a generic headlamp and no design, so its numbers differ from the page's. Compare Node with Node, and browser with browser.

Check a scenario without rendering: `node tests/scenario/run.js --check <file.json | dir>` (exit 0 when valid, otherwise the list of problems).

## Write a scenario

Copy one of the five in `examples/`. Fields:

| field | meaning |
|---|---|
| `name` | required, lowercase letters, digits and dashes. Names the output files. |
| `scene` | `road` (default), `forest` or `city`. The mountain pass is `road` plus `options.mountainPass: true`. |
| `seed` | scenery seed, 0 to 99999 (default 7). |
| `dist` | metres along the route at frame 0 (default 0). `pos` is accepted as an alias; give one. |
| `speed` | km/h, 0 to 130 (default 50). Frame f is at `dist + speed/3.6 * f/30` metres. |
| `options` | any option key from the table below. Values must match the default's type. |
| `beams` | optional, browser only. Names of beam library entries (a library id like `builtin:...`, or a label). Node mode refuses them. |
| `frames` | how many frames to step through, 1 to 600 (default 1). Time advances 1/30 s per frame. |
| `capture` | `[{ "name": "start", "frame": 0 }, ...]`, or bare frame numbers. Default: the last frame, named `last`. |
| `regions` | optional extra regions `{ "name": [x0, y0, x1, y1] }`, fractions of the frame from the top left. |

Default regions: `sky` (top 30 %), `road` (bottom 35 %), `ahead` (centre box), `left` and `right` (the verges beside the centre).

Unknown fields, unknown option keys, wrong types, enum values outside the list, and frames outside the run are all rejected with the field's name in the message, before anything renders.

### Option keys

Run `node tests/scenario/run.js --keys` for the full list with defaults (71 keys). The ones most scenarios use:

- Road: `wet` (bool), `wetness` (0 to 1, overrides `wet`), `wetSheen` (bool)
- Air: `visibility` (null = clear, or 3000, 1000, 200, 60 metres), `scatter` (0 off; 4, 8, 16 direct; 16, 32, 64 in table mode), `scatterMode` (`direct` or `table`), `scatterRes` (`half` or `full`), `scatterBlur` (`off`, `mid`, `strong`), `scatterCache` (`on` or `off`), `scatterCycle` (0 or 8)
- Light: `ambient` (0 = dark), `streetLamps` (`sodium`), `RL` (road paint, mcd/m²/lx)
- Traffic: `oncoming`, `preceding`, `trafficLogic`, `trafficDensity`
- Other: `mountainPass`, `tiles` (browser only; Node mode always uses the tile pipeline), `gpuRenderer`, `fov`

Scene-level keys (`scene`, `seed`, `speed`, `playing`) go at the top level, not under `options`.

### Example

    {
      "name": "road-wet-fog",
      "scene": "road",
      "seed": 7,
      "dist": 25,
      "speed": 50,
      "options": { "wet": true, "wetSheen": true, "visibility": 200, "scatter": 16 },
      "frames": 30,
      "capture": [{ "name": "start", "frame": 0 }, { "name": "end", "frame": 29 }]
    }

## Compare two builds

    node tests/scenario/compare.js <dirA> <dirB> [--tol 0.02]

For each scenario and capture in both dirs it prints whether the hash changed, the luminance before and after, and each region's relative change. A row is `BEYOND` when luminance or any region moved more than the tolerance (default 2 %), or when a scenario or capture exists on one side only. Exit code 0 means every row is within tolerance; 1 means some row is beyond it. A hash change with luminance inside the tolerance is reported as `ok`, with `CHANGED` in its row.

To compare two builds: run the harness on each build (a `git archive` of the other commit into a temp dir works, with its own server on its own port), copy each `tests/scenario/out` into its own dir, then compare the two dirs.

## Notes

- Frames are stepped by count, never by the clock, so a rerun gives the same hashes. The browser run is checked for that in the same session (`rerunSame`). Frames per second are not recorded: they come from the wall clock and would make hashes and counters differ between runs.
- The browser run hides the drive toolbar and readouts while it takes each capture, so the PNG is the scene alone.
- Browser captures step through every frame up to the last capture, because the traffic logic keeps state between frames.
- The Node tone map (x/(1+x), gamma 2.2) is only for its PNG. Luminance is measured on that PNG, the same way the browser output is measured.

## Files

- `schema.js`: the validator. Reads the option keys from `js/spec-ui.js` (`DV_DEF`, one line) and the `setDV(ui, '...')` keys from `js/`. It reads the source text because `spec-ui.js` needs the DOM.
- `run.js`: the CLI, the Node renderer, the PNG writer, output.
- `browser.js`: the browser runner (Playwright).
- `compare.js`: the diff of two output dirs.
- `examples/`: five scenarios: road dry, road wet, forest fog 200 with an air beam, city night, mountain pass.
- Tests: `tests/scenario-node.js` (Node), `tests/regress/SH-scenario.js` (page).
