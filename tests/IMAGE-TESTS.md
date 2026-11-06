# Image Tests (B1: tolerance comparison + FLIP)

Replaces exact SHA-256 frame hashes with tolerance-based image comparison using FLIP
(Andersson et al. 2020, "FLIP: A Difference Evaluator for Alternating Images").

## Components

| File | Role |
|------|------|
| `tests/image/png.js` | Minimal PNG reader/writer (zlib, no npm). `decode(buf)` → `{w, h, data}`, `encode(w, h, rgba)` → `Buffer` |
| `tests/image/flip.js` | LDR-FLIP in plain JS (BSD-3-Clause port from NVlabs/flip). `flip(ref, test, {ppd})` → `{map, mean, p50, p95, p99, max}` |
| `tests/image/compare.js` | Tolerance checking framework. `checkRef({test, name, png, cls, pin, mask, tol, ppd})` → `{pass, …}` |
| `tests/image/selftest.js` | Node self-test: 31 checks covering PNG round-trip, FLIP edge cases, known-bad control, masks |

## Tolerance model

Each frame check passes when ALL of these hold vs the reference image for the current GPU class:

- **FLIP mean** ≤ `tol.flipMean` (default 0.001) — the average per-pixel perceptual difference
- **FLIP p99** ≤ `tol.flipP99` (default 0.1) — even the worst 1 % of pixels stay below this
- **Pixel fraction** ≤ `tol.pixelFrac` (default 0.002) — few pixels differ by the YIQ threshold
- **Pixel threshold** `tol.pixelThreshold` (default 0.1) — the YIQ-distance squared threshold

Defaults are *provisional* (not calibrated against run-to-run noise). They should be set between the
noise floor (two identical renders should pass) and the smallest real change worth catching.

## References

References live under `tests/refs/<test>/<name>.<gpuClass>.png`. One reference per renderer/GPU class
because SwiftShader and an Apple M4 draw differently — both are equally valid pictures of the same scene.

GPU classes use the WebGL renderer string classified by `classify()` in `compare.js`:
`chromium-swiftshader`, `chromium-apple-m4`, `webkit-apple`, etc.

## Usage

### Recording references

```
REF_UPDATE=1 node tests/regress/FG-fog.js 8984
```

Records the current frame as the reference for the current GPU class. `REF_UPDATE=FG-fog,SC-beam-scatter`
limits to specific tests.

### Checking against references

```
node tests/regress/FG-fog.js 8984
```

Checks every captured frame against its reference for the detected GPU class. Passes if within tolerance,
or if no reference exists yet (`missing` → pass, so new GPU classes don't break the test).

### Strict mode (owner's GPU only)

```
IMG_STRICT=1 node tests/regress/FG-fog.js 8984
```

Also requires the exact SHA-256 pin to match. Only meaningful on the machine that recorded the pin.

### Overriding GPU class

```
IMG_GPU_CLASS=chromium-apple-m4 node tests/regress/FG-fog.js 8984
```

Compare against another class's references (e.g. to check M4 references on a SwiftShader machine — the frame will differ, but the heatmap shows where).

### On failure

The failing frame, its reference and a FLIP heatmap are written to `tests/shots/imgdiff/<test>-<name>.<class>.{test,ref,flip}.png`.

## Known-bad control

A mandatory part of B1: `tests/image/selftest.js` checks 10–11 prove that deliberately wrong references
FAIL tolerance. A solid-red frame vs a solid-blue frame fails. A single-pixel perturbation fails zero-tolerance
but passes lenient tolerance. This ships with the brief and is enforced in review.

## Overlay masks

Page tests that screenshot the canvas element inside a small pane (`FG`, `SC`, `WT`, `SD`) get toolbar overlays
in the screenshot (slider, bars, panels). `overlayRects(page, canvasSelector)` detects them at runtime and
`checkRef`'s `mask` option copies those pixels from the reference into the test frame before comparison, so
FLIP's filters see no difference there and a UI-only change does not move the pin.

## Converted tests (B1)

| Test | Converted? | Reference name | Notes |
|------|------------|----------------|-------|
| FG-fog.js | ✓ | `FG-fog/clear` | clear-air frame, visibility off, GPU three |
| SC-beam-scatter.js | ✓ | `SC-beam-scatter/clear` | clear-air frame, same scene as FG |
| WT-wetness.js | ✓ | `WT-wetness/dry` | dry frame (wetness 0) |
| SD-scatter-table.js | ✓ | `SD-scatter-table/direct16` | direct-mode frame, 16 scatter steps |

## Not yet done (B1 follow-up)

- **Reference harness:** a high-sample CPU render (and `haloCrossingRefine 2048` on GPU) scored by FLIP per scene.
- **A/B viewer page:** side-by-side, flicker, FLIP heatmap HTML page for judging by eye.
- **Calibrated tolerances:** measure run-to-run noise per GPU class and set `DEFAULT_TOL` between noise and signal.
- **Remaining test conversions:** the other ~170 page tests. FG/SC/WT/SD were the first four as specified in the brief.