# Image Tests (B1: tolerance comparison + FLIP)

Adds tolerance-based image comparison using FLIP (Andersson et al. 2020, "FLIP: A Difference Evaluator
for Alternating Images") next to the exact SHA-256 frame hashes. It does not replace them yet: the
pins in FG, SC, WT and SD are all still asserted, and the B1 check is an extra line in each test.

**Status: no reference images exist** (`tests/refs/` does not exist), so every B1 check currently reports
"no reference" and passes. Nothing here has caught a regression yet. The pins stay until the checklist
under "Before removing any hash pin" is done.

## Components

| File | Role |
|------|------|
| `tests/image/png.js` | Minimal PNG reader/writer (zlib, no npm). `decode(buf)` → `{w, h, data}`, `encode(w, h, rgba)` → `Buffer` |
| `tests/image/flip.js` | LDR-FLIP in plain JS (BSD-3-Clause port from NVlabs/flip). `flip(ref, test, {ppd})` → `{map, mean, p50, p95, p99, max}`. The header's claim of a known-answer check against NVIDIA's output is not backed by anything in the repo: the author checked it once by hand |
| `tests/image/compare.js` | Tolerance checking framework. `checkRef({test, name, png, cls, pin, mask, tol, ppd})` → `{pass, …}` |
| `tests/image/selftest.js` | Node self-test: 31 checks covering PNG round-trip, FLIP edge cases, known-bad control, masks. It has no known-answer check against NVIDIA's FLIP |
| `tests/image/viewer.html` | A/B viewer (028ab42): side-by-side, flicker and FLIP heatmap; loads from `tests/shots/imgdiff/` |

## Tolerance model

Each frame check passes when ALL of these hold vs the reference image for the current GPU class:

- **FLIP mean** ≤ `tol.flipMean` (default 0.001; the four converted tests override it to 0.005, a value nobody measured) — the average per-pixel perceptual difference
- **FLIP p99** ≤ `tol.flipP99` (default 0.1) — even the worst 1 % of pixels stay below this
- **Pixel fraction** ≤ `tol.pixelFrac` (default 0.002) — few pixels differ by the YIQ threshold
- **Pixel threshold** `tol.pixelThreshold` (default 0.1) — the YIQ-distance squared threshold

Defaults, and the 0.005 override, are *provisional* (not calibrated against run-to-run noise). They should be set between the
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

Checks one frame per test (see the table below) against its reference for the detected GPU class. `checkRef`
returns `pass: false, missing: true` when there is no reference; the four tests accept that as a pass
(`refCheck.pass || refCheck.missing`), so new GPU classes don't break them. Today that is every run.

### Strict mode (owner's GPU only)

```
IMG_STRICT=1 node tests/regress/FG-fog.js 8984
```

Makes `checkRef` fail unless the frame's SHA-256 equals the pin it was given. Only meaningful on the machine that recorded the pin. (The tests' own hash assertions run regardless of this flag.)

### Overriding GPU class

```
IMG_GPU_CLASS=chromium-apple-m4 node tests/regress/FG-fog.js 8984
```

Compare against another class's references (e.g. to check M4 references on a SwiftShader machine — the frame will differ, but the heatmap shows where).

### On failure

The failing frame, its reference and a FLIP heatmap are written to `tests/shots/imgdiff/<test>-<name>.<class>.{test,ref,flip}.png`.

## Known-bad control

A mandatory part of B1: `tests/image/selftest.js` section 10 proves that deliberately wrong references
FAIL tolerance. A solid-red frame vs a solid-blue frame fails. A single-pixel perturbation fails zero-tolerance
but passes lenient tolerance. This ships with the brief and is enforced in review. Both controls are far from the threshold; there is no near-threshold known-bad frame yet.

## Overlay masks

Page tests that screenshot the canvas element inside a small pane (`FG`, `SC`, `WT`, `SD`) get toolbar overlays
in the screenshot (slider, bars, panels). `overlayRects(page, canvasSelector)` detects them at runtime and
`checkRef`'s `mask` option copies those pixels from the reference into the test frame before comparison, so
FLIP's filters see no difference there and a UI-only change does not move the pin.

**Not wired up:** no converted test calls `overlayRects` or passes `mask`, so the four checks compare the whole
element screenshot, overlays included. The mask machinery is tested in `selftest.js` only.

## Converted tests (B1)

Each test checks exactly one frame, and it is the feature-off one. The feature-on frames (fog, scatter, wet) are not checked by B1.

| Test | Converted? | Reference name | Notes |
|------|------------|----------------|-------|
| FG-fog.js | ✓ | `FG-fog/clear` | clear-air frame, visibility off, GPU three |
| SC-beam-scatter.js | ✓ | `SC-beam-scatter/clear` | clear-air frame, same scene as FG |
| WT-wetness.js | ✓ | `WT-wetness/dry` | dry frame (wetness 0) |
| SD-scatter-table.js | ✓ | `SD-scatter-table/direct16` | direct-mode frame, 16 scatter steps |

## Before removing any hash pin

All four must be true first, or the pin is the only thing left catching renders:

1. **References recorded per GPU class** under `tests/refs/` (`REF_UPDATE=1`), for every class the test runs on.
2. **Run-to-run noise measured** per class (same build, repeated renders), and the tolerances set above it. 0.005 is a guess.
3. **A near-threshold known-bad control**: a frame that is wrong by about the smallest change worth catching must fail, and a clean re-render must pass. The current controls (solid red vs blue, one-pixel change at zero tolerance) say nothing about where the line sits.
4. **The feature-ON frames compared too** (fog levels, scatter on, wet/standing). One feature-off frame per test cannot see a break in the feature.

## Not yet done (B1 follow-up)

- **Reference images:** none recorded. Everything above rests on this.
- **Reference harness:** a high-sample CPU render (and `haloCrossingRefine 2048` on GPU) scored by FLIP per scene.
- **Calibrated tolerances:** measure run-to-run noise per GPU class and set `DEFAULT_TOL` between noise and signal.
- **Masks in use:** pass `overlayRects` output as `mask` in the four converted tests.
- **FLIP known-answer check** against NVIDIA's reference images, inside the repo.
- **Remaining test conversions:** the other ~170 page tests. FG/SC/WT/SD were the first four as specified in the brief.

The A/B viewer (`tests/image/viewer.html`, 028ab42) is done.
