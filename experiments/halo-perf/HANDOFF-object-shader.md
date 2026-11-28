# Handoff: make the drive's object pass cheaper (2026-11-28)

Branch `halo-perf` (An0nya/flux-sketchpad), worktree `~/Projects/flux-hdr-spike`. Written by Claude at the end of the halo-perf
session, for whoever picks this up next (a session or a swarm seat). The look must not change. The goal is frame time on Anya's
old iPhone. Labels: **OBSERVED** = measured or read in the code; **INFERRED** = reasoning, not tested.

## Why this, why now

Anya wants the drive at a steady 20 fps (50 ms) on her old iPhone (856×482 sim) with the oncoming beam scatter on. The halo-perf
session built a per-stage GPU readout and measured both phones (numbers in `NOTES.md`, same folder). With a full scene the old
phone spends a large share of the frame drawing objects. A swarm that wasn't fed this data didn't find the cause, so the evidence
and the code path are spelled out below.

## The measuring tools (use these, don't build new ones)

- **GPU stages** (option `gpuStages`, Timings tab, needs Debug timings): every 8th frame is timed per stage: crest map, halo (prep,
  shadow maps, screen, polar, uniforms), scene, cones, **objects**, compose, glare, final.
- **Time this frame** (button next to it): plays 80 real frames from the current pose (the real per-frame cost, mean/p95), then
  renders the pose 80 times with every stage timed. The per-stage times are inflated by the forced waits (1.1× on the Mac,
  1.25–2.4× on the phones), so **read them as shares of the real frame**, not as milliseconds.
- To compare phones or settings, load the same state file (Performance > Debug > Load state) on each and tap the button.
- **`V.three.objectWork(p, ss)`** (`js/drive-three.js:491`, existing): renders the objects in mask mode 3 and returns
  `proxyPixels` (pixels whose proxy ran the shader), `hits` (pixels that hit an object) and trace `steps`.
  **Caveat (found 11-28):** the `maskMode 3` work output exists only in the SDF-model branch (`kind==4`, l.38), so it counts
  detailed models only and returns 0/0 for ellipsoids, boxes, cylinders, cards and trees. To measure the miss ratio for all
  objects it needs a `maskMode==3` output added at each kind's hit/miss point (a small shader change, debug-only).
- Tests to keep green: `tests/regress/GST-gpu-stages.js` (17 checks), `tests/regress/BJ2-halo-table-pin.js` (pins), plus the
  object/model page tests listed in `tests/gate.js` MAP for `js/drive-three-objects.js`.

## What was measured (OBSERVED, Anya's phones, 2026-11-27/28)

| scene | old phone objects | old phone frame | new phone objects |
|---|---|---|---|
| full objects (first reading, pass pose) | 16.7 ms of 54.5 (synced) | 17.2 fps | 2.6 ms of 17.2 |
| objects off, foliage density min | 2.8–7 ms | ~48–56 ms real | 0.5–1.1 ms |
| 640×360, SS1 → SS2 | 2.8 → 6.0 ms | | 0.6 → 1.1 ms |

- On the old phone objects are 6× slower than on the new one, against ~3× for crest and compose. Scene (road/terrain) is the
  other weak stage (5–7×). Both are fragment-heavy lit shaders.
- Scene and objects stay expensive with traffic beams off, so the cost is not mainly the traffic-lamp loop.

## How objects are drawn (OBSERVED in code)

`js/drive-three-objects.js`:
- **Proxies are screen-space rectangles.** Each instance carries `aBounds` and the vertex shader draws a quad covering that
  rectangle (`objectVertex`, l.8–14). There is no 3D hull.
- **Every pixel ray-traces the shape** in the fragment shader (`objectFragment`, l.15–118): ellipsoid, oriented box with slabs,
  cylinder, capped cylinder, plane cards, discs, and SDF models (`kind==4` via `modelTrace`, `drive-three-models.js`).
  Misses `discard`.
- **Every pixel writes `gl_FragDepth`** (l.99) and depth-tests against it (`depthTest/depthWrite`, `LessDepth`, l.192).
- **Every hit pixel then runs the full lit shading:** `shade(p,n,v,id)` (the ground shader's lighting: own lamps, traffic beams,
  shadow maps), emission, fog, **`inScatter` (own air beam) and `haloScatter` (oncoming halo lookup)** (l.113–118).
- On the mountain pass the text goes through `passShader`, which adds a manual test against the scene depth
  (`if(t/5000.0>texture2D(passDepth,...)) discard`, l.158 swap list).
- Supersampling draws objects at `ss`× resolution in each axis (`drive-three.js` ~l.471).
- Leafy foliage (`leafyFragment`, l.122–137) adds a leaf pattern that discards most of each tree's pixels.
- Draw order is by bucket index (`renderOrder = items[0].index`, l.244), not by depth.
- Mask modes already exist: `maskMode 2` writes `(id, coord, p.z, order)` per pixel; `maskMode 3` writes trace work.

## Why that is expensive (INFERRED, standard GPU behaviour; confirm with measurements)

1. **Writing `gl_FragDepth` and using `discard` switch off early depth rejection**, and on Apple GPUs the hidden-surface removal
   too. The GPU can't know a pixel is hidden until the shader has run, so every covered pixel of every overlapping object runs
   the whole shader, lighting included, even if a nearer object later wins.
2. **Screen rectangles waste work on misses.** A long guardrail or a diagonal post covers a rectangle that is mostly empty.
   Every miss pixel still runs the trace before it discards. `objectWork()` measures exactly this ratio.
3. **The expensive part runs per object fragment, not per screen pixel:** `shade()` loops over the lights and shadow maps,
   and `inScatter`/`haloScatter` are added again for objects. With overdraw that multiplies.
4. **Supersampling multiplies all of it** (SS2 roughly doubled the objects stage on both phones).

## Candidate fixes, in the order I'd try them

Each one is an option, default OFF, byte-identical when off (`docs/STANDARDS.md` §1.1; registry entry; GST/BJ2 still pass).

1. **Measure first (no code change).** Run `objectWork()` and the GPU stages on (a) Anya's full-objects pass save
   (`save-full.json`, `save-low.json` in this folder) and (b) the lean `flux-state-straight-0m` save. Record proxyPixels/hits,
   objects ms, and objects with `leafyFoliage`, `detailedModels` and SS each toggled. That tells you which of 2–5 is worth it.
2. **Shade once per pixel: a visibility pre-pass (the big one).** Pass A runs the cheap trace only, mask-mode style: no `shade()`,
   no scatter. It writes depth plus what shading needs (id, hit point or t, normal) into a small G-buffer (`maskMode 2` is
   most of the way there). Pass B is one full-screen pass that runs `shade()` + emission + fog + scatter **once per covered
   pixel**. That turns "cost × overdraw" into "cost × pixels". Pattern names: deferred shading / visibility buffer.
   Cheaper variant if a G-buffer is too much: run pass A for depth only, then in the normal pass compare the traced `t` with
   pass A's depth and `discard` *before* `shade()`. That still traces twice, but shades once.
   Watch: emissive lamp lenses and glow flags (`flags.y`) blend differently; the mountain-pass `passDepth` test; supersampling;
   the shadow-map variant (`mapText`) must stay as it is.
3. **Tighter proxies.** Replace screen rectangles for long, thin or diagonal kinds (guardrail boxes `kind 1`, posts `kind 2/7`)
   with tighter screen polygons or split long boxes into segments. `objectWork()` before/after shows the miss ratio falling.
4. **Front-to-back order within buckets.** It only helps once pixels can be rejected early (after 2), so do it after.
5. **Don't supersample objects on weak devices**, or supersample only their edges. A quality trade, so it's Anya's call.
6. **Per-object light lists.** Cull traffic lamps per object on the CPU so `shade()` loops over fewer lights
   (the Forward+/clustered pattern). Mind the uniform budget (H12 in `docs/inventory/HAZARDS.md`).

## Constraints and gotchas

- `docs/STANDARDS.md` §1 and §2 apply: opt-in option, registry entry, `tests/gate.js` MAP, real GPU for page tests
  (`--use-gl=angle --enable-unsafe-swiftshader` = Metal on the Mac), sampler budget ≤ 16, uniform rows ≤ 1024.
- Serve page tests with `python3 tests/serve.py <port>` (pins the test defaults). A plain static server hangs the helpers.
- The halo object has a method called `probe`; don't reuse common names on shared objects (this session lost an hour to it).
- Phone readings: a hot new phone varies 18–27 ms for identical work. Cool it, or take best-of-several. The old phone repeats well.
- Anya tests on the phones through a githack link pinned to a pushed commit. Ask before pushing.

## Open questions for Anya

- The target scene: which objects must stay on for "the look" on the old phone (trees? detailed models? guardrails?).
- Is turning supersampling down on the old phone acceptable, or must SS stay?
- Should option 2 be built first as a measurement spike (no visual change expected), or straight as the shipped path?
