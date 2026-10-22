# DESIGN: an option registry (proposal only, nothing here is built)

Generated 2026-10-22 on branch docs/inventory (base main f52ed8a). A proposal for the owner to accept, change or reject. It rests on the facts in OPTIONS.md, HAZARDS.md and RENDER.md; the hazard numbers (H1..H15) point there.

## 1. The problem in one paragraph
An option today is spread over about six places that must agree by hand: a default in `DV_DEF` (js/spec-ui.js:840), a control built in `driveTools` or `bars` (spec-ui.js:920-974, drive-anim.js:1577-1721), a visibility/disabled rule in a sync loop (spec-ui.js:1012-1051, drive-anim.js:1845-1892), a migration inside `dvOpts()` (spec-ui.js:890), readers scattered over 5-10 files, and tests. Nothing says what an option needs or what it costs, so silent no-ops (H4, H6), frozen defaults (H2), leaks (H1, H11) and untested options (H10) are found by accident. The registry is the one declared list those places are generated from or checked against.

## 2. Registry entry schema

One plain data file (`js/options-registry.js`, loaded before spec-ui.js, no dependencies). Each entry:

```js
{ id: 'trafficHalo',                  // the stored key, unchanged
  type: 'enum',                       // bool | enum | int | number | text | list | derived
  values: [0, 4, 8, 16],              // enum values, or {min,max,step} for numbers
  default: 0,
  label: 'traffic halo',
  control: { kind: 'select', group: 'air', hostFile: 'spec-ui', order: 34, aria: 'Traffic halo' },
  query: 'trafficHalo',               // ?trafficHalo=8 sets it for this load only (generic param, replaces ad hoc ?halobins)
  scope: 'profile',                   // profile (saved) | session (not saved: V.high) | game (overlay, dropped on exit)
  since: 3,                           // registry schema version in which the key appeared
  migration: [{ from: 'scatterNearFade', run: 'on/off -> range' }],   // ordered, versioned, tested against saved fixtures
  requires: [ { opt: 'visibility', not: null, why: 'needs air (fog)' },
              { opt: 'trafficBeams', eq: true, why: 'the halo is lit by traffic beams' } ],
  unavailableOn: [ 'mountainPass' ],  // road types where it does nothing (until the road frame supports it)
  conflicts: [],
  cost: 'per-frame-gpu',              // free | per-frame-gpu | table-rebuild | ground-rebuild | scene-regenerate | recompile
  budget: { samplers: 3, uniformRows: 0, shaderVariant: 'always' },   // what it adds to the shader limits (RENDER.md section 3)
  owner: ['js/drive-three-halo.js', 'js/drive-three-shaders.js'],     // files that implement it (drives the gate MAP and "changed file -> tests")
  tests: ['SL-traffic-halo', 'HDX7-halo-levels'],                      // test ids; a gate check fails if empty
  bundle: null }                      // for derived entries: the options it writes (airLevel, haloQuality)
```

Derived entries (`airLevel`, `haloQuality`) list `bundle: { low: {...}, medium: {...} }` and a `derive(o)` so "custom" is computed by the registry, not by two hand-written functions (drive.js:898-931). Session and game state (`V.high`, `gameOptions`) are `scope: 'session' | 'game'` entries, so they are listed and have a defined layer (H1).

## 3. How dependencies are declared and shown

- `requires` / `unavailableOn` / `conflicts` are data. One pure function `reasons(registry, options, context)` returns, per option, the list of unmet rules (`[{why:'needs traffic beams on'}]`), where `context` = `{ road: 'flat'|'pass', renderer: 'gpu'|'cpu' }`.
- UI: a control with unmet rules is disabled (not hidden) and its title is set to `greyed because: needs traffic beams on`. Today some controls are hidden (visibility), some disabled (table mode) and most silent (OPTIONS.md "locked behind" table); the registry makes this one behaviour. Stored values are never changed by a rule (that is how it works today: values stay stored and the renderer ignores them).
- Renderer: the same `reasons()` is used to compute the *effective* options once per frame (`effective = options minus unmet`), so `haloN` (drive.js:819), `supported()` (drive-anim.js:1048), the mt gate (drive-anim.js:1264) and the pass checks stop re-deriving the same rules.
- Tests: `reasons()` is pure, so Node tests can enumerate every option x every context and assert that nothing both renders and is greyed.

## 4. What is generated from the registry, and what is only checked

| artefact | today | with the registry |
|---|---|---|
| `DV_DEF` | hand literal, spec-ui.js:840 | `RF.Options.defaults()`; first step proves it deep-equals the old literal |
| controls | hand-built in two files | simple controls (bool, enum, number) generated from `control`; special ones (beam library, seed+dice) stay hand-written but still register their id |
| enabled/hidden rules | two sync loops | `reasons()` |
| rescue URLs | ui.js:36-43 (?reset, ?safe) plus ?halobins | one generic loader: `?reset`, `?safe` and `?<id>=<value>` for any registered option, validated against `values` |
| migrations | one long line in `dvOpts()` | ordered list in the registry, run once at load, each covered by a saved-profile fixture (tests/drive-controls-fixtures/ already holds one) |
| persistence | whole object (H2) | only keys that differ from the default are stored; the profile is `{v: schemaVersion, set: {...}}`; old whole-object profiles are read as before |
| OPTIONS.md (this inventory) | scripts + hand metadata | table rendered from the registry; readers/tests columns still come from the scan script |
| gate MAP and "options with no gate test" | hand regex list (tests/gate.js) | `owner` generates the file->tests rules; a check lists options whose `tests` is empty or not in the curated list |
| cache keys | hand-listed in 8+ places | the registry's `cost` class selects the key family; a Node test fails when an option with `scene-regenerate` is read by `prepare()` but absent from `tkey` |
| shader limits | none | `budget` is summed by variant; a Node test (the existing script) fails over 16 samplers / 1024 uniform rows |

## 5. Incremental order (each step keeps the gate green and every frame identical)

1. **Registry as data, no consumers.** Add `js/options-registry.js` with the 87 DV_DEF ids plus the 8 undeclared ones (OPTIONS.md) and their defaults/types/values. Add a Node test: registry defaults deep-equal `DV_DEF` and the id set equals the DV_DEF keys plus the declared extras. Nothing reads the registry yet. (Needs a MAP entry for the new file: the gate falls back to the full gate for unmapped js files, tests/gate.js MAP.)
2. **Budget check as a Node test.** Turn docs/inventory/scripts/reach.mjs into `tests/shader-budget.js` that asserts today's counts as a ratchet (no variant may add samplers or rows). Read-only; passes today; protects H3 and H12 immediately and independently of step 1.
3. **`requires`/`unavailableOn` data + `reasons()` as a pure function**, no UI use. A Node test prints the list of options that are currently "on and silently inert" for the default profile and for the pass (this is the H4/H6 report, as a test).
4. **UI reads `reasons()` for the controls that are already disabled or hidden today** (wetSheen, wetModel, scatter* table options, tileCache, streetLamps, cline, safeGap, seed, density). Behaviour must be identical, so the existing UI tests (UX2, DC, CD) are the check; frames are unchanged because only attributes move.
5. **Add the missing reasons** (halo needs traffic beams, halo/air on the pass, lampClass without lamps): tooltips and `disabled` only; pixels unchanged.
6. **Migrations into the registry** with the saved-profile fixtures; the test loads each fixture and checks the effective options equal what `dvOpts()` produces today.
7. **Layered store**: profile / session / game overlays (H1). `sync()` stops mutating the saved object; `gameOptions` become an overlay. A new test enters a game and leaves it and compares the options object before and after; MG2 has a recorded "exit-restore" failure (reports/TR-touge-r2.md) whose cause was not checked here and may be related.
8. **Persist diffs only** (H2), reading old profiles unchanged. Frames identical for any given effective options.
9. **Generic `?id=value` parameters**, retire `?halobins`.
10. **Derive cache keys from `cost` classes**, one key family at a time (`tkey` first, then `groundKey`), each proven by byte-identical frames on a fixed option sweep (the sweep exists in WT/SC/SD tests).
11. **Generate OPTIONS.md and the gate MAP** from the registry.

**First safe step: step 1 plus step 2 together**, because neither changes runtime behaviour, neither needs a browser, and step 2 immediately guards against a second sampler/uniform crash (H3, H12). Step 3 is the second.

## 6. Prior art that applies (one paragraph)

Feature-flag systems with prerequisites (LaunchDarkly "prerequisites", Unleash constraints) and software-product-line *feature models* (requires/excludes between features, FODA) are the closest model for `requires`/`conflicts`. Schema-driven UIs (JSON Schema forms) and graphics debug panels (dat.GUI, lil-gui, Tweakpane bind a control to a typed property) are the model for generating simple controls from `type`/`values`. Game engines handle the shader side with declared *shader keywords/variants* and variant budgets (Unity `multi_compile`/`shader_feature` with variant stripping, Unreal static switches), which is what `budget` plus the Node check imitates. An Entity-Component-System is not justified by this evidence: the objects are few classes built from options and a road frame, not thousands of entities composed at run time, and the pain is declaration and resolution, not per-entity iteration; no framework is recommended. Everything above is plain data plus pure functions in the existing classic-script style (`RF.*` globals), so no build step is introduced.

## 7. Risks and non-goals
- Not a rewrite of the renderers or of the kit. The scene resolver and road frame (TOUGE.md section 4) are separate later steps; the registry only makes their requirements declarable.
- Generating controls changes DOM structure; tests that select by `[data-dv]` / `[data-anim]` (CD-controls-dedupe, UX2, DC) must keep the same attributes. Keep ids and selectors; generate only the attributes.
- Persisting diffs only changes what is in localStorage; keep a read path for whole-object profiles for at least one release, and keep `?reset` clearing both.
- Steps 4-5 touch every control: do them one control family at a time.
