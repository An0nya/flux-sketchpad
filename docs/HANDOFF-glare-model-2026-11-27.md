# Handoff: glare model + HDR output in the drive (2026-11-27)

Branch `glare-model` (pushed), off the lander `vm-agents-2026-10-30` @ `c3ff75a`. Worktree:
`~/Projects/flux-sketchpad/.claude/worktrees/glare-model`. Latest: `0cd77ac`. Not merged; the lander and main are untouched.
Try it: `https://rawcdn.githack.com/An0nya/flux-sketchpad/0cd77ac/index.html` → Lighting › Glare › Glare model.

Background and the spike it ports: branch `hdr-spike`, `experiments/hdr-headlamp/README.md` (ends with the spike handoff and the
probe results) and `experiments/hdr-probe/` (latest `33cf34b`).

## Status

| Step | What | State |
|---|---|---|
| 1 | Plan | done (in chat, 11-27) |
| 2 | Glare model in `FS_FINAL_GM` + registry + controls + tests | done, `5b7e50f`, `025f4d1` (tail gain) |
| 3 | Phone cost | done: new phone about +2 ms a frame with a model on; old phone no visible cost (bound by compose) |
| 4 | Can a WebGL canvas show HDR on iOS? | no (Safari 27.0.1 and 27.2, both iPhones): needs a WebGPU presenter |
| 5 | HDR presenter (`hdrOut`) | done, `50000f2`; readback the default `0cd77ac`. Anya: "hdr worked" on the phone |

## What it is

- **Registry** (`js/options-registry.js`): `glareModel` (current | perceptual | cie146 | custom; unset = current) and the knobs of one
  table, `GLARE_PARAMS` (gm* veil, tail, starburst, bloom, adapt time constants; hdr* output). All `extra` (no DV_DEF change), all
  gated by rule `glareModelOn`. Presets in `GLARE_MODELS`; a preset writes its bundle, moving a model knob makes it `custom`
  (the hdr* knobs keep the preset). Controls are generated from the table in `drive-anim.js` (Glare tab, `.drive-gm`).
- **Rendering** (`js/drive-anim.js`): with a model on and glare on, the final pass is `FS_FINAL_GM` (compiled on first use);
  `FS_FINAL` is untouched. Per source: veil (Stiles–Holladay or CIE 146 general with age/pigment; drawn as light, as haze
  `cap·v/(1+v)`, or not at all), Moffat scatter **tail only** (the rendered lamp pixels stay the core), fixed-size starburst from
  a 4096×1 RG32F spoke table. Bloom only with `gmBloom`. Adapt exposure uses the model's veil formula and its own time constants.
- **HDR** (`hdrOut`): `FS_FINAL_GM` writes the spike's ACES + HDR shoulder (knee 0.55, peak 16) to an RGBA16F target;
  `FS_HDR_ENC` hands it to a WebGPU canvas (`.drive-hdr`, rgba16float, toneMapping extended) over the hidden WebGL canvas.
  `readback` (default): RGBM → pixel-pack buffer + fence, fetched a frame later, never waited on. `copy`: low/high halves
  through the opaque canvas with copyExternalImageToTexture. iOS headroom quirk: re-configure on visibilitychange/pageshow,
  and on every off→on of `hdrOut`.
- **Helpers** (`js/drive.js`): `veilPsi`, `veilModelAt`, `spokeTable`, `glareModelGPU`, `adaptStep(…, taus)`.

## Anya's decisions (11-27)

1. Tail only first (it covers the veiling glare well).
2. The glare level stays the master switch; the eye terms do not scale with it (tune the levels later, keep the parameters).
3. Reduced motion: tail and starburst off.
4. Adapt exposure uses the CIE formula when the model selects it; realistic recovery time considered (see open items).
5. Default stays `current`.
6. Hand-off: whatever is fastest → readback (probe D below).
7. Later: she tunes by hand, locks presets, hides the knobs.

## Evidence (OBSERVED unless marked)

- Off = the lander, bytes (`tests/regress/GM-glare-model.js`, Apple M4, `--use-gl=angle`, samples 1); `current` = unset;
  a model set up as the drive reproduces it within 1 code value (2 of 476k pixels); off after on = off; glare off stays off;
  reduced motion = tail and starburst off. 13/13.
- HDR round trip (`tests/regress/GM2-hdr-presenter.js`, WebGPU + ANGLE Metal): the shown frame read back from the WebGPU canvas
  matches the WebGL display frame: readback max 0.0021 below white (1 code value 0.0039), 0.26 % above; copy 0.0024 / 0.4 %;
  peak reaches 16×. 7/7.
- `tests/glare-model.js` (Node): registry, presets, veil formulas vs hand values, spoke table, adapt constants. 21/21.
- Touched gate: GM, GM2 and the registry/controls audits pass. Not clean, all identical on the lander: `t3-ui-jsdom` and
  `all` (jsdom not installed in worktrees, so the jsdom UI checks did not run), `B4b-layout` (4 checks; pulled in by the css edit).
- Phones (Anya): perceptual is **overcooked** in the drive (far too strong); cie146 about right for brightness; starbursts work but
  too big. HDR works. Old phone with HDR: readback about 20 ms mean vs copy about 58 ms (different scenes, one reading each; the fps
  counter shows nonsense like 143 fps with readback: read the ms figures).
- Probe D, iPhone Safari 27: opaque canvas copy byte-exact; alpha canvas copy off by up to 4/255; copies are snapshots; canvas copy
  4.20 ms CPU each (blocking); pixel-pack readback 0.30 + 0.97 ms CPU.

## Not verified

- The no-WebGL2 fallback and the spec-ui CPU still ignoring the model (no seam to drop WebGL2 headless).
- HDR cost with HDR off vs readback in the same scene on the old phone (asked, not yet measured).
- Why the fps counter reads above the refresh rate with readback.
- Whether the perceptual tune's 6° blob for a 0.7 lx car matches the spike's measured core in the drive's scene (inferred from the spike's 6.0°).

## Open items

1. **Tuning (Anya):** perceptual down with `gmTailGain` (added for this) and spoke length; then lock presets and hide the knobs
   (the registry table makes hiding a one-line change per knob, or one flag on the section).
2. **Realistic glare recovery:** today a fixed 3 s time constant (`gmAdaptUp`). Sources found: Spain 2019 national study, about 27 s
   mean full recovery after 10 s of glare (25 s at 36–45, 38 s over 65, weak age correlation); RoSPA quote 1 s at 15 → 9 s at 65
   (study not verified). A dose- and/or age-scaled recovery is a modelling choice Anya has not made yet.
3. **Merge:** review `glare-model` for the lander. The commits explain each change; `tests/options-registry.js` gained a
   generator-aware branch (control ids built from `GLARE_PARAMS` cannot be found by its text scan) — owner to accept.
4. **halo-perf collision (Anya: the other session sorts it out):** another session switched `~/Projects/flux-hdr-spike` to `halo-perf`
   at 20:45; three of this session's `commit -a` calls landed there (`c1dd149`, `95ac135`, `cfdf895`), and `c1dd149` swept that
   session's uncommitted `drive-anim.js` / `drive-three-halo.js` / `drive-three.js` edits. Nothing pushed, nothing lost. Suggested
   fix there: `git reset --soft f669596` on halo-perf (keeps all changes uncommitted); the probe and README files it then holds
   already live on `hdr-spike` and can be dropped. This session's work was re-landed on `hdr-spike` from a separate worktree.
5. Scratch worktrees to remove when done (session scratchpad): `wt-lander` (detached `c3ff75a`), `wt-spike` (`hdr-spike-fix`).
