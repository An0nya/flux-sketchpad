# Drive view on three.js: plan (approved by Anya 2026-10-15)

## Why
The animated drive view ray-traces every object on the CPU per pixel per frame (js/drive.js + js/drive-worker.js; WebGL only
composites/tone-maps/blooms). City + wet + glare + reflections + random items + traffic logic = 3–5 fps (Anya, desktop).
Game engines solve this by rasterizing on the GPU and shading in a shader. The 2026-09 "no frameworks" choice predates
this; Anya: "the drive view in particular is in desperate need". three.js = the middle-ground engine (Babylon heavier).

## Decisions
- three.js for the DRIVE VIEW ONLY. The optics engine (reflection/refraction/trace) is untouched and stays the
  reference.
- Dependency: a pinned three.js release, vendored as one ES-module file under `vendor/three/` (no build step, no CDN
  dependency at runtime; Pages serves it). Default choice by Claude; Anya may switch to a pinned CDN importmap.
- The photometry is OURS: beam far-field LUT, retroreflection, materials, Stiles–Holladay veil, glare bloom levels are
  ported once to GLSL (three.js ShaderMaterial / onBeforeCompile) and validated against the CPU renderer with a
  pixel-parity test on still frames (same discipline as GPU.md's trace validation).
- Behind a setting ("GPU drive renderer"), CPU path kept as fallback and as the parity reference.
- Builder: Codex (GPT-6.1 Sol) first. If it can't, Astra after a reset. Sonnet tests in batches.

## Phases
**P0: measure first (Codex, small)**
- FPS counter + per-frame time breakdown (object trace, ground, workers, GL passes, glare, wet sheen, traffic logic,
  minigame detector) in the drive bar (toggle).
- Dynamic resolution: lower the trace/render scale when the frame time exceeds a target, restore when there's headroom.
- Profile Anya's heavy scene. Her words: "a city scape with wet road, glare, road reflections, random items, and traffic
  logic - it turns into a slideshow at like 3-5fps". The specific levels in the P0 brief (sheen on, glare "rain", items
  dense, oncoming + preceding) are Claude's guesses at those settings, not her recorded config. Write the breakdown into
  the report: this decides P1's priorities.

**P1: three.js renderer (Codex, big)**
- Scene from the existing drive-scenes object lists: InstancedMesh for repeated items (posts, studs, trees, signs),
  frustum culling, LOD (impostors for distant foliage).
- Lighting shader: our beam LUT as a float texture, lamp positions, the aimed far field (UX1: the drive view uses the
  AIMED far field: keep that), materials incl. retroreflective signs/eyeshine, other cars' lamps (symmetric / generic
  headlamp from D5), street lamps (D4), veil (D5).
- Ground: shader on a road mesh following the tile geometry (D4), markings as textures or SDF.
- Wet road: three.js `Reflector` (planar) or SSR, whichever matches D5's sheen look at lower cost.
- Glare/bloom: keep OUR tuned bloom passes (D5) rather than three's bloom, unless parity is equal.
- Minigame (MG/MG2) detector must work on the new renderer (hazard-only render via a layer mask).
- Acceptance: parity vs the CPU renderer within stated thresholds per material class; the heavy scene ≥ 30 fps in
  the desktop popout; mobile measured; CPU fallback works.

**P2: lighting extras**: retroreflective signs (and other bright lit surfaces) as wet-sheen sources: today only lamps
(car head/tail lamps, street lamps, our beam) are, in js/drive.js reflectionSources(); a lit sign is roughly 10x dimmer than
an oncoming lamp but visibly mirrors in real wet roads (Anya 10-15; estimate, not measured); tiled/clustered light culling if many lamps; other traffic lighting the road; lamp pitch on
braking/acceleration (pitch ≈ k·a).

**P3: models**: less "snowman" cars, deer/people (articulated, walking), foliage, cheap on the GPU now.

## Status
- 2026-10-15: plan approved. In flight before it: batched Sonnet review of UX1 (drive panel More, crawl fix, iOS
  brake, deer leave road, aimed-glare label) + DP part 1 (opt-in ground cache). P0 is next after that review.
