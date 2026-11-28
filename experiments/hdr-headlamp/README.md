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

The defaults (σ 0.06°, gain 40) were tuned against these two checks, so the second row shows the model
*can* meet them (core ≤ 1° at ~1 lx, growth well under 2× for 20× E), not that it reads right. That is 2 of
the parking-lot handoff's 5 checks. Spike length was judged by eye only; target contrast, adapt-mode
exposure and the second halo were not measured. The first row reproduces the handoff's diagnosis.

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

## Anya's first on-phone session (2026-11-27)

OBSERVED by Anya, iPhone, Safari:
- HDR works and makes a visible difference.
- The "HDR peak" slider brightens from 1× to 1.5× and then looks flat for the rest of its range. INFERRED:
  the screen's headroom at that moment was about 1.5×, and iOS clips values above it rather than rolling
  them off. Headroom changes with screen brightness and ambient light.
- These settings matched her perceived glare well (oncoming low beam, about 1 lx at the eye):

```json
{"dist":24.48,"cd":601.1,"color":"LED 5700K","lat":3.5,"spacing":1.4,"lens":0.06,"hfov":60,"own":0.3,
 "target":true,"tdist":50,"sim":"960","expo":"fixed","ev":2,"canvasMode":"extended",
 "curve":"ACES + HDR shoulder","peak":16,"knee":1.2,"veilMode":"perceptual","veilStr":0.25,"veilCap":1,
 "veilFloor":1.05,"bloom":false,"bloomStr":0.07,"core":true,"coreSigma":0.16,"spike":true,"spikeCount":49,
 "spikeLen":2.8,"spikeLenJit":0.6,"spikeWidth":3.12,"spikeGain":282.5,"spikeTaper":3.4,"spikeBase":0.18,
 "spikeSeed":7,"spikeRot":0}
```

Her requests and ideas (not built yet):
- A softer skirt where the core meets the veil ("some blur would sell it").
- The core should grow with intensity. Her theory is "with intensity, not distance". She isn't sure about
  distance; see the discussion in the session that followed.
- Performance unknown; she will try an older phone.

## Round 2 (2026-11-27, after the first phone session)

Added: Moffat core (`(1 + (θ/α)²)^-β`, energy kept), headroom strip, "Re-request HDR" (also automatic on
returning to the page), an animated oncoming car (approach, pass, respawn after a gap), a deer target,
fps / GPU-time readout, the drive's beams (generic low and high, baked the way `drive.js` bakes them,
plus the five tables in `samples/beams/sqm-samples.json`), oncoming intensity sampled from a beam table
at the eye's angle (as the drive's `Headlamp.cd` does), and the "Anya 11-27" preset (knee 0.55).

OBSERVED by Anya on the iPhone: toggling extended off and on raised the usable HDR peak above 2×; leaving
the page and coming back dropped it to about 1.5×, where the peak slider acts like a switch. INFERRED:
iOS grants headroom when the layer enters HDR and doesn't revisit it, so re-configuring asks again.

OBSERVED on the Mac (headless Chromium, Metal, 960×540, Current preset with bloom, car animating):
about 90 fps uncapped, GPU ≤ 3.6 ms per frame (submit to done, an upper bound). Not a phone number.

Low beams and the deer: at 60 m the deer's body is above the cutoff of a low beam (about +0.3° from a
0.65 m lamp), so with the generic low it gets about 370 cd, about 0.1 lx: it is genuinely nearly
invisible, legs aside. That is the beam, not the veil. Use a high beam or a closer target to test veiling.

## Phone session 2 (2026-11-27)

OBSERVED by Anya:
- Moffat core plus starburst, with the Stiles–Holladay veil OFF, reads right. About 0.5 lx toward the eye
  already veils hard, and a deer next to the starburst disappears completely.
- Performance with her settings (no bloom, no veil, Moffat + starburst, 960×540, animating):
  new iPhone 120.9 fps, GPU ≤ 1.9 ms; old iPhone 60.1 fps, GPU ≤ 6.6 ms (submit-to-done upper bounds).
- "Drive at me" reported not working; symptom not yet pinned down.

Her settings (d2s-transverse table for both cars, HID colour):
```json
{"speed":30,"spawn":240,"gap":4.2,"dist":24.48,"oncSrc":"from beam table","oncBeam":"7-inch-round-rearfiring d2s-transverse",
 "oncScale":1,"color":"HID 4300K","lat":3.5,"spacing":1.4,"lens":0.06,"ownBeam":"7-inch-round-rearfiring d2s-transverse","own":1,
 "target":"deer","tdist":50,"tlat":1.15,"trho":0.15,"hfov":60,"sim":"960","expo":"fixed","ev":2,"canvasMode":"extended",
 "curve":"ACES + HDR shoulder","peak":16,"knee":0.55,"veilMode":"off","bloom":false,"core":true,"coreShape":"moffat",
 "coreAlpha":0.0102,"coreBeta":1.65,"spike":true,"spikeCount":74,"spikeLen":4.25,"spikeLenJit":0.74,"spikeWidth":4.47,
 "spikeGain":106.4,"spikeTaper":3.4,"spikeBase":0.18,"spikeSeed":7,"spikeRot":0}
```

INFERRED (Claude, by hand from the shader): with α = 0.0102° the Moffat width is set almost entirely by the
lens's angular size and the anti-aliasing pixel term (a² = α² + 2·(lens²/4 + pixel²)), giving a ≈ 0.11° at
24.5 m and 960 px. So this tuning depends on render width and distance. Against Stiles–Holladay (10·E/θ²)
the β = 1.65 tail is about 4× stronger at 1° and about 5× weaker at 10°, crossing near 3–4°: stronger
near the lamp, less wide-angle contrast loss.

## Phone session 3: β sweep (2026-11-27)

OBSERVED by Anya (24.5 m d2s-transverse car, deer at 50 m, Moffat, no Stiles–Holladay veil):
α 0.1°, β 1.5 looks right. Deer veiling by β: 1.6 barely interferes, 1.4 veils it significantly,
1.2 leaves only the legs barely visible. Works without HDR too; SDR may want a slightly stronger veil.

INFERRED (Claude, by hand): the deer sits about 5–8° from the lamps. At 5.5° the Moffat tail
(L/E, cd/m² per lux) is about 0.14 for β 1.65 / α 0.0102°, 0.47 for β 1.5 / α 0.1°, 0.77 for β 1.4,
against Stiles–Holladay 10/θ² = 0.33. So the CIE amplitude at the deer's angle falls between β 1.65 and
1.5, close to where Anya's eye landed. Values include the lens and pixel floor in a, so they move with
render width until that is decoupled.

Open question (Anya): about 200–290 cd toward the eye at 24.5 m from the d2s-transverse design, at
roughly 6.5° left and 1.3° up in that lamp's beam. Possible stray light between regulation test points.

## Round 3 (2026-11-27)

- **CIE 146 general glare equation** as a veil formula, with age and eye-pigment sliders:
  Ψ(θ) = 10/θ³ + (5/θ² + 0.1p/θ)·[1 + (A/62.5)⁴] + 2.5·10⁻³·p, θ in degrees, valid 0.1° to 100°,
  L_eq = Ψ·E (cd/m² per lux). Source: Bará & Bao-Varela (2023), Eq. 2, citing CIE 146:2002
  (https://arxiv.org/abs/2212.09103). Not checked against the CIE report itself.
  Correction: in chat Claude said from memory that the full CIE function is a sum of Moffat-shaped terms.
  It is not; it is the power-law sum above. A Moffat tail with β = 1.5 does fall as θ⁻³, the same as the
  first CIE term.
- **Moffat decoupled:** the tail is now set by α alone, (β−1)/π · α^(2β−2) · (a² + θ²)^−β with
  a² = α² + lens/pixel floor; the energy the floor takes from the core goes into a Gaussian of the floor's
  width. OBSERVED: saturated size 6.01° at 960 px vs 6.00° at 640 px with the same settings.
  The old α 0.1 / β 1.5 tune corresponds to α ≈ 0.15° now (preset "Anya Moffat").
- **SDR veil boost:** multiplies the veil and the Moffat tail only when the HDR shoulder or extended canvas
  is off. A display compensation: energy is not kept in SDR on purpose.
- **Measure** now also reports target contrast (no ratio: with a near-black background the glare-off contrast
  is huge and any ratio looks like nothing is left), glare on vs off, same frame and exposure. Glare light at
  the target G = mean(on − off) over the body; C = (T − B)/(B + G) from the glare-off frame. Values are
  display values after the tone curve.

OBSERVED (headless Chromium, Metal, 960 px, car frozen at 24.7 m, E 0.36 lx on the left lamp, deer at 50 m):

| | glare light at deer | deer contrast with glare | without |
|---|---|---|---|
| Anya Moffat (α 0.15, β 1.5, no veil) | 0.124 | 4.3% | 2847% |
| + CIE 146 veil preset (β 3 core, CIE veil, age 35, p 0.5) | 0.055 | 9.6% | 2847% |

The CIE puts about 0.44× as much glare light on the deer as her Moffat tune, matching the hand estimate
at 5.5° (0.25 vs 0.47 per lux). Background behind the deer at mid-body height is distant road, almost black.

## Shader limits by API (2026-11-27)

OBSERVED, from the readout:

| | WebGL2 textures/shader | WebGL2 uniform vec4s | WebGPU textures/stage | WebGPU samplers | WebGPU storage buffers | WebGPU uniform buffer |
|---|---|---|---|---|---|---|
| Mac M4, Chromium (Metal) | 16 | 1024 (UBO 16 KB × 16) | 48 | 16 | 10 × 4 GiB | 64 KiB |
| Anya's iPhones (both: the 60 Hz and the 120 Hz one), Safari | 16 | 1024 (UBO 16 KB × 16) | 44 | 22 | 44 × 1 GiB | 1 GiB |

These are adapter maxima: a WebGPU device gets the spec defaults (16 textures, 16 samplers, 8 storage
buffers, 64 KiB uniform buffer) unless it asks for more with requiredLimits.
The drive's recorded walls (docs/inventory HAZARDS H3, H12; commit 5f9d514) are the WebGL2 numbers.

Anya: the scatter beam is where the drive's fps drops sharply (observation, not profiled).

## Handoff (2026-11-27, end of the spike session)

**Where things are.** Branch `hdr-spike` on An0nya/flux-sketchpad (off `vm-agents-2026-10-30` @ `c3ff75a`),
worktree `~/Projects/flux-hdr-spike`, page `experiments/hdr-headlamp/`. Open it from a githack link pinned to
a commit (`rawcdn.githack.com/An0nya/flux-sketchpad/<sha>/experiments/hdr-headlamp/index.html`); the
branch URL caches. Nothing touched `vm-agents-2026-10-30` or main.

**What the spike settled** (details in the sections above):
- HDR on iPhone Safari works through WebGPU `extended`. Headroom changes with the moment: about 1.5× in
  daylight, more after re-requesting HDR; the page re-requests it whenever it becomes visible again.
- The glare that reads right to Anya: Moffat core (β ≈ 1.5) plus a fixed-length starburst, no
  bloom. Works in SDR too; HDR adds the "this is bright" cue. Presets "Anya Moffat" and "Anya 11-27".
- At the deer's angle (~5.5°) her tune puts about 2× the glare light the CIE 146 general equation predicts.
  Both curves can be compared in the page's "CIE 146 veil" preset and in the Measure readout.
- Cost on the phones: 1.8–2.1 ms (new) and 6.6–7.4 ms (old) GPU per frame for the whole spike scene,
  2 lamps. The drive loops up to 32 sources: not measured with traffic.
- On her iPhones, WebGL2 caps a shader at 16 textures and 1024 uniform vec4s (the walls the drive hit);
  WebGPU offers up to 44 textures, 22 samplers and 44 storage buffers.

**Decided by Anya:** port into the drive on the existing WebGL path, with HDR as an optional display layer;
skip the CPU still path for the new glare (it ignores the option with a notice); the parking-lot calibration
waits for another night; WebGPU for the drive is investigated later, separately.

**Next, in order (each needs her go):**
1. Phase 2 walkthrough in pseudocode, before any edit. Shape so far: one `glareModel` object holding her
   design paths as presets (simple halo, current recipe, perceptual, perceptual + HDR, CIE 146); the terms
   go into `drive-anim.js` `FS_FINAL`'s existing source loop (up to 32 sources, direction / E / rgb
   already there); opt-in, default off, byte-identical when off (STANDARDS §1.1); a registry entry and the
   Glare sub-tab; gate tests and shader-budget counts; a new branch, not the swarm's lander branch.
   Known wrinkle: the drive's lamp pixels are already in its HDR buffer, so a Moffat added in `FS_FINAL`
   counts some core light twice (harmless, the core saturates).
2. HDR presenter: move the drive's final frame into a WebGPU canvas. Options, none measured: synchronous
   readPixels; async readback with a fence; copyExternalImageToTexture from an RGBM-packed 8-bit WebGL
   canvas. Decide by ms per frame on the old phone with the drive running.
3. Later, its own spike: port only the scatter-beam table build to a WebGPU compute shader with storage
   buffers, check it matches WebGL, time both on both phones, then push the bank count past WebGL's limit.
   Profile the drive on the phone first to confirm the scatter pass is where the time goes.

**Open threads:** the d2s-transverse design sends 270–290 cd toward an oncoming driver at about 6.5° left,
1.3° up, with a cliff to 0 cd about 3.6° away (possible stray light between regulation test points; check in
spec mode). Spike numbers in this README are by hand or headless unless marked OBSERVED by Anya.

## HDR probe results (2026-11-27, `experiments/hdr-probe/`, OBSERVED)

Both iPhones, Safari 27.0.1 (old) and 27.2 (new): `(dynamic-range: high)` true, CSS `dynamic-range-limit` supported,
WebGPU `toneMapping: extended` configures. WebGL2 has no `drawingBufferStorage` and no tone-mapping hook
(`drawingBufferToneMapping` / `configureHighDynamicRange` absent), so a WebGL canvas cannot show HDR on iOS.
The drive's HDR therefore needs a WebGPU presenter fed from the WebGL frame (copyExternalImageToTexture with RGBM, or readPixels).
Mac headless Chromium 151, for contrast: `drawingBufferStorage(RGBA16F)` applies only after `EXT_color_buffer_float` is enabled; no tone-mapping hook either.
