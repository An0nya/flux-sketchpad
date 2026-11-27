# HDR headlamp spike

A standalone WebGPU page. It asks one question: can real HDR output plus a perceptual glare model replace the
drive view's "cinematic" glare? It does not touch the drive view. No three.js, no dependencies.

Run: serve the repo root over HTTP (WebGPU needs a secure context: https or localhost) and open
`experiments/hdr-headlamp/`. On the phone, use the githack URL for the `hdr-spike` branch.

## The four presets (a 2×2)

| | SDR | HDR |
|---|---|---|
| **Current recipe**: physical veil, 1° floor, bloom pyramid | the drive today | does HDR alone fix it? |
| **Perceptual**: core PSF, starburst, soft-capped veil | does the model alone fix it? | the candidate |

Presets only set switches. Every setting is independent, so any combination works. Settings persist in
the browser (localStorage). "Copy settings" puts them on the clipboard as JSON to paste back to Claude.

## What each piece is

- **Scene**: night road lit by our own low beams (a rough shape, tuning only), a grey target (reflectance
  0.15), and an oncoming pair whose lamps are small Gaussians carrying E = I / r² lux at the eye. Units
  match the drive: cd/m², lux, EV with 10 cd/m² at white for EV 0.
- **Veil**: Stiles–Holladay 10·E/θ², the drive's own term. `physical` adds it as luminance (the drive
  today). `perceptual` draws cap·v/(1+v), so it reads as haze and never reaches white. In adapt mode the
  white point always uses the full veil with a 1° floor, as the drive does.
- **Bloom**: a WGSL port of the drive's `FS_BRIGHT` (brightCap(L·k − 1), soft cap 64) and the 4-band
  Gaussian pyramid (`GLARE_BANDS`, `GLARE_WEIGHT`, `glareSigma`). Ported by reading the GLSL; not
  checked frame-for-frame against a drive render.
- **Core PSF**: a fixed-angle Gaussian spread of the lamp (energy kept).
- **Starburst**: one seeded spoke pattern shared by all lamps, brightness ∝ E, hard length limit
  (`(1 − θ/len)^taper`), so spikes never get longer with intensity. Spokes are averaged over at least one
  pixel of arc so thin spokes near the lamp don't drop out between samples.
- **HDR output**: canvas `rgba16float` with `toneMapping: { mode: 'extended' | 'standard' }`, and
  `dynamic-range-limit: no-limit` on the canvas. The "HDR shoulder" curve is ACES below the knee, then a
  slope-matched roll toward `peak` × paper white. No API reports the screen's real headroom, so `peak` is a
  guess you tune. Values written are extended-sRGB encoded (1.0 = paper white). INFERRED from three.js
  r180, which encodes its `ExtendedSRGBColorSpace` output the same way; not confirmed on a device.

## Measured on the Mac (Chromium in the Claude app, non-HDR display), 2026-11-27

OBSERVED with the Measure button: equivalent diameter of the region at ≥ 0.95 white around the left lamp,
oncoming pair at 32 m, EV +2, fixed exposure. Defaults: core σ 0.06°, spike gain 40.

| | ~1 lx (1000 cd) | ~19 lx (20000 cd) | growth |
|---|---|---|---|
| Current · SDR | 3.76° (pair merged) | 15.23° | ×4.1 |
| Perceptual · SDR | 0.74° | 1.08° | ×1.46 |

The second row meets the parking-lot handoff's checks (core ≤ 1° at ~1 lx, growth well under 2× for
20× E). The first row reproduces its diagnosis (the blob grows with intensity).

## Not verified

- Whether HDR actually displays on the iPhone. Only checked: `getConfiguration()` reports `extended` after
  configure (Mac Chromium, which is not an HDR screen here, so it proves nothing about the display).
- Whether iOS clips or rolls off values above the real headroom.
- The bloom port against a real drive frame.
- Spike look: defaults are placeholders until tuned outdoors.
- Performance on the phone. The page renders on demand, not continuously.

## Phase 0 findings (2026-11-27), for Phase 2

- The drive display path is a hand-rolled WebGL2 compositor in `js/drive-anim.js` (`FS_BRIGHT`,
  `FS_BLUR`, `FS_FINAL`, ~l.1335–1462 at `c3ff75a`). three.js r180 (WebGL build only, `vendor/three/`)
  renders into that compositor's textures through `groundGPU`; it has no final pass of its own.
- `FS_FINAL`'s `aces()` caps at 1.0. `FS_BRIGHT` feeds glare from how far a pixel is over white, so past
  white every extra candela goes to the halo, not the core.
- three r180's `WebGPURenderer` supports extended output (`outputType: HalfFloatType` plus
  `ExtendedSRGBColorSpace` from `examples/jsm/math/ColorSpaces.js`). It does not run GLSL
  `ShaderMaterial` (no entry in `StandardNodeLibrary`), and the drive has 21 of them, so it doesn't help
  without rewriting every drive shader.
- Phase 2 options: (a) full port to WGSL/TSL, weeks; (b) keep WebGL2 and hand each float frame to a
  WebGPU presenter canvas through the CPU, about a day, cost per frame unmeasured; (c) wait for HDR
  WebGL canvases in Safari. Anya chose (b) as acceptable for a prototype.
- The CPU still path (`drive.js tonemap`) is a fallback; Phase 2 may skip it (Anya, 2026-11-27).
