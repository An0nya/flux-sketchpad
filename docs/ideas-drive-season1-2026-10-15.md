# Drive view ideas: glare, intersections, minigame (brainstorm, 2026-10-15)

Anya's brainstorm with GPT, saved as an idea bank. **Not a plan, nothing approved.** Claude's checks are inline (⚠️).

## 1. Glare as a veil, not a bloom
- Oncoming headlamps add a veiling luminance over the whole view; it cuts contrast so effective reach drops.
- Cheap model: `L_veil = k · E_eye / θ²` added to the frame, then auto-expose down. (This is the Stiles–Holladay
  form; the usual constant is k ≈ 10 with θ in degrees, E in lux, L in cd/m².)
- ⚠️ What exists: `js/drive.js` tone map has a "cheap veiling-glare bloom" (box blurs of each pixel's own brightness,
  strength off/low/high). That is glare FROM bright things in the view, not glare from an oncoming lamp INTO the driver's
  eye. `js/road.js` `iihs()` already computes glare TOWARD an oncoming driver (glareMax, 5–10 m, 1.1 m eye, limit 10 lx).
- The pitch: spill above 0.5U costs your OWN visibility once oncoming traffic exists; deer stay visible until a truck
  washes them out.

## 2. Intersections
- 4-way = straight tile with N/E/S/W openings; T = through road plus one side. Stop lines + crosswalks as markings;
  reuse the posts/signs spawner for corners.
- Collisions off for now (people/deer ghost); invisible walls only at curb + centre island.
- Must tile seamlessly with straight and 250R bends; wet/dry, speed, grain, random all keep working.
- ⚠️ D2 note: the existing intersection scene stays still in the animation (≈20 patterned markings + a cross street);
  a tile system is the route to animating it.

## 3. Minigame: "reach > uniformity"
- Fixed speed per run, random tiles; every 10–20 s a hazard spawns off-road outside the beam, 80–180 m ahead
  (deer 90 %, person 10 % near crosswalks). Press-and-hold to brake.
- Measure t_reaction from the first LIT PIXEL of the hazard to the press; stopping distance = v·t + v²/(2 μ g),
  μ 0.8 dry / 0.4 wet.
- ⚠️ GPT's worked numbers were wrong. Correct, at 1.0 s reaction: **75 km/h dry = 20.8 m + 27.7 m = 48.5 m**;
  **130 km/h wet = 36.1 m + 166.2 m = 202 m**. (GPT had 6 + 28 and 18 + 135.) The conclusion stands and is stronger:
  at 130 wet you need ~200 m of seeing distance, beyond a typical low beam.
- Pitch: a solver that trades far-field uniformity for throw scores better here than on the wall view.
- Later: high beam, auto high beam, ADB; a non-compliant lamp (Spec verdict fail) caps the score or is flagged.
- ⚠️ GPT's specific numbers ("Opus-mosaic 150,000 rays ×1.67", "low 106 m, high 250 m, ADB 220 m", "13 / 3×107") came from
  screenshots or were invented; don't reuse them without measuring with `tools/flux.js`.

## 4. Fun scoring (scorecard only)
- Damage ≈ ½ m v² × overlap fraction → repair-cost bands (clipped crate … totalled).
- Person hit = run lost.
- "Every oncoming car is a cop": each time your beam puts > 1 lx in an oncoming driver's eye, that's a flash;
  $150 each, $500 if the lamp is non-compliant. End card: "Flashed 7 cops, $1050". (Reuse road.js's glare-toward-oncoming.)
- GPT's legal commentary (negligence, contributory negligence) is flavour text, not something to encode.

## 5. Minimal extras
- Street lamps: point lights every 50 m with a Type III-like distribution; sodium 2000 K vs LED 4000 K; adds ambient so
  the low beam looks less heroic.
- Traffic lights: emissive quad with a red/yellow/green state machine; beam lights the housing; red spawns pedestrians.

## Relation to the approved drive plan (10-14)
Stage 4 traffic → §1 glare veil and §4 flash-counting need oncoming cars first. Stage 5 tiles → §2. Stage 6 realism →
§1, §5. §3/§4 (the game) is new: a mode on top of the drive view, after 4–5.

## 6. Follow-up: liability scorecard (Anya + GPT, 10-15)
Speed is automatic; the player controls only reaction and hold-to-brake. The key quantity is `collision_speed` (speed
still carried when the boxes overlap).
- **Recklessness** (can't be mitigated away; total capped at 100): non-compliant lamp (Spec verdict fail) +40 · high beam
  in town or with oncoming/preceding present +30 · collision_speed ≈ 1 pt per km/h (0–10 → 0–10 … 60+ → 60+).
- **Mitigating** (a percentage reduction, capped at 50 %, never erases recklessness): pedestrian without high-viz, unlit,
  at night −15 · jaywalking (mid-block / against the light) −20 · both −25 max (as written; note 15 + 20 = 35 elsewhere
  in the text, pick one).
- **Liability** = recklessness × (1 − mitigating %).
- *MG decision (2026-10-15):* the game uses **35 %** when both mitigations apply (15 + 20, matching the 5 km/h worked example), still capped at 50 %; the "−25 max" wording is not used.
- **Outcomes:** liability < 20 and collision_speed < 10 and compliant → repair cost (~$2k) · 20–60 → ticket + civil
  (~$5k + points) · > 60, or > 30 km/h in a crosswalk, or non-compliant and > 30 km/h → jail-risk game-over screen.
- Person hit at any speed = run lost (conscience cost 100); the money is flavour.
- Cops: every oncoming driver flashed on high beam = +$150 even without a crash → players learn to dip (what ADB
  automates later).
- ⚠️ Arithmetic check: GPT says 60 km/h dry is "~35 m even with perfect reaction". Braking alone (μ 0.8) is **17.7 m**;
  35 m is with a 1.0 s reaction (16.7 m + 17.7 m = 34.4 m). The worked examples: 60 km/h crosswalk + non-compliant =
  40 + 0 + 60 = 100 → jail-risk ✓; 5 km/h compliant jaywalker = 5 × (1 − 0.35) = 3.25 → repair cost ✓ (uses 35 %).

## 7. Anya's playtest notes (2026-10-15 afternoon, live site, phone + desktop)
- Glare works great. Minigame "wild, quite cool"; at 60 km/h trivial even wet with her lamp (physics: 60 dry stops in ~34 m at 1 s; her lamp sees > 100 m).
- BUG: traffic logic ON with no preceding car → our car crawls.
- iOS: holding the brake button starts text selection → CSS user-select:none, -webkit-touch-callout:none, touch-action on the button + game panel, preventDefault on touchstart.
- After braking for a deer we accelerate and plough through it: deer should walk/bound off the road first (logged, not urgent).
- Drive panel has become a monster: hide/move controls to the sidebar with sensible defaults.
- Random-tile animation is considerably slower than the static road (D4: tiles trace the full frame every frame, no cached ground; ~4–5× frame time).
- Ideas: lamps dip/pitch with braking/acceleration (beam shifts down/up); better car models ("less snowman build") if render overhead stays small; other traffic lighting the road/environment (not done today: their lamps are visible emitters + wet reflections only; cost ≈ one beam lookup per lit ground pixel per nearby car, using D5's generic-headlamp asset).
- Glare question: her lamp vs generic toward an oncoming eye at 0.5U 1–5R (Claude, flux trace 2 M rays, unaimed far field of reflector-scene_2.json): hers 7.3/9.3/8.9/7.8/5.9 kcd at 1/2/3/4/5R vs generic 0.29/0.36/0.61/1.4/3.2 kcd. So in the far field hers is HIGHER there (consistent with her Spec fail "0.5U 1R–3R ×2.98 over"); her observation of LESS glare on left curves likely comes from (a) the drive view using the AIMED far field (LB2V re-aims the cut-off to 0.4D) or (b) Play mode forcing oncoming = generic for everyone (MG2 fix). Needs a check.

## 8. Backlog from Anya's playtest + Muse brainstorm (2026-10-15 late)
Not approved for building; logged.
- **Deer eyeshine too apparent / too consistent.** Today every deer's two 13 mm retroreflecting eye discs face the road's
  approach, so eyeshine is always on. Ideas: (a) dim/resize (13 mm is in the range of a dilated deer pupil, so size may be
  fine and it's the consistency that reads wrong; check the retroreflection coefficient and its angular falloff);
  (b) behaviour: grazing deer have head down (no eyeshine), become alert as the car approaches, raise and turn the head
  toward the lights (eyeshine appears, often then freeze: "deer in the headlights"), then bolt. Eyeshine becomes an
  early cue that depends on deer state, which is good gameplay. Needs the M2 articulated head.
- **Lamp pitch and dive** (beam dips under braking, lifts under acceleration): in P2, building now.
- **Elevation: inclines, sags, crests (a touge).** Crests hide hazards and the beam (a low beam aimed at the road runs out
  of road over a crest; this is the classic crest-vertical-curve sight-distance problem); sags pull the beam's hit point
  closer. Touge also wants hairpins (~20–30 m radius, today's tiles stop at 250R/150R), guardrails, cliff/drop edges,
  camber/banking. GPU-only: the CPU tracer assumes flat ground (normal z = 1) throughout, so the fallback would stay flat.
  Infrastructure-level change to the tile system + camera + placement: walk Anya through a design first.
- (Riddick's "shine job" eyes noted; no ticket.)
- **Beamshot-to-target conversion floors uplight to zero** (Anya 10-16): her escape-hatch scene was solved with the
  mosaic solver against a LUMA false-colour beamshot whose lowest band is pure black, so above-cut-off light was 0 in
  the target and the solver matched it (oncoming cars carrying that lamp look switched off). Idea: in the image→target
  conversion, treat the bottom band as "≤ X cd, unknown" (a floor value or a don't-care-below-X weight) instead of 0, so
  converted designs keep realistic scatter/uplight and don't automatically fail the above-horizon minimums.
- **Colour temperature for every source** (Anya 10-16 wishlist): street lamps already have CCT; LED presets carry
  measured CCTs; halogen (~3,000–3,200 K) and HID (~4,000–4,300 K) get documented assumptions. Simplify: one CCT per
  source (ignore drive-current shift for now), carried through to the beam pattern and Drive view colour.
  **Chromatic aberration** as a later item: projector lenses separate colour at the cut-off (the blue/purple fringe on
  real projectors); needs wavelength-dependent refraction (dispersion / Abbe number) in the tracer: a few spectral
  bands, not full spectra.
- **Touge follow-up** (Anya): curvature-based speed advice in traffic logic + the camera car (slow before curves,
  accelerate out) so the pass isn't a rollercoaster. AFS after that.
- **Try Haiku on scoped builds** (Anya): small, well-specified jobs to test capability; compare against Codex output.
- **High-speed cornering lamps as an AFS substitute** (Anya, 2026-10-18; backlogged, not ruled out): her research found no blanket speed restriction on cornering lamps (FMVSS 108 has no cornering provision, verified; UNECE R48/R119 text still unread, so the activation rules there are unverified). Idea: two flat-cutoff lamps (e.g. R113/fog-style) plus a controller fed by yaw/steering sensors could do much of what AFS does with swivel motors. Needs: lamp activation that works above 40 km/h and on gentle bends (today strength is zero above 40 km/h and below |κ| 0.008, so the default 150/250 m tile curves never trigger it, js/drive-anim.js lightingStep), a beam pattern suited to the job, and the walleyed-mounting variant (saved design at a set yaw). Pairs with the AFS follow-up item above.
- **Remove the 'intersection' drive scene** (Anya, 2026-10-18): open road, forest, city and mountain pass are the set. Stored `scene:'intersection'` must fall back to road. Queue after AM (tiles default) lands, since it touches the same scene mapping (js/drive-anim.js ANIM_SCENES, :27). Follow-up, bigger: denser intersection tiles in the city scene. Tests that cover the intersection scene (regress-node worker-vs-page parity across road/forest/city/intersection, tests/drive.js scene build loop) need updating.
- **Multilane highway scene** (Anya, 2026-10-18; queued, harder): several lanes in our direction with more same-direction cars, a median or divider separating oncoming traffic, higher speeds. The build currently assumes one lane each way (traffic is generated per lane with a single oncoming lane; `lane`/`laneDrive` in the road model). Things it would touch (my inference from earlier audits, not checked against code for this item): speed slider max is 130 km/h (js/drive-anim.js:1330) and posted limits top out at 80 (js/drive-anim.js:95-99); preceding-car and AHB lane tests use |y| <= 1.5 lanes; traffic cars use one 300 m gap per lane; the median is also what makes this scene useful for glare, since a barrier or glare screen occludes oncoming lamps (the occlusion helper already treats scenery as occluders); lane-change behaviour for passing traffic is new work. Pairs with 'denser city intersections' and the intersection-scene removal as scene-set cleanup.
- **Layered resolution: decisions** (Anya, 2026-10-18, from .claude/briefs/reports/LAYERED-RES.md): keep the road merged with its lane markings in the ground layer (separating them is too invasive); only the asphalt grain needs the low resolution. Trees and foliage stay in the OBJECT pass at object resolution, not a separate low-res layer, because they overlap oncoming cars, lights, reflections, deer and the road on curves and the object layer has no depth to merge against. So the plan is: GPU objects (lamps, signs, posts, deer, people, cars, trees, foliage) at canvas resolution (slice 1), ground + markings at sim resolution, grain lower, sky later behind a gate. The CPU path is legacy for the owner: keep it as a 'compatibility mode', do not invest in it for resolution work. Open question for her: should GPU become the default renderer (DV_DEF gpuRenderer is false today; there is already a failure fallback, V.gpuFailure)?
