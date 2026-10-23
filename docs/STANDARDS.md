# Build standards for the drive view

Read this before changing anything. It is short on purpose. Rules marked (why) come from a real failure; the evidence is in `docs/inventory/HAZARDS.md` or the named report. If you find a rule missing, add it here in the same commit as the work that taught you.

Last reviewed: 2026-10-22 (after the clothing / lamp-halo / lamp-distribution night).

## 1. Building a feature

1. **New features are opt-in options, default OFF, and OFF must be byte-identical to main.** Prove it with a frame hash or an object-list comparison against main, not by eye. A deliberate default change (owner decision) is the only exception; say so in the commit.
2. **Every option is declared once, in the registry, with what it depends on.** Add one entry to `js/options-registry.js` (id, type, values, default, label, control selector, group, cost, owner, tests) and, if it needs or is ignored by another option, a `requires` / `ignoredWhen` / `conflicts` rule naming where the code enforces it (reuse a rule from `RULES` or add one). `DV_DEF` is generated from the registry: never write a literal. Then run `node docs/inventory/scripts/gen-options-docs.js` and commit the regenerated OPTIONS.md and GROUPS.md; `tests/options-registry.js` and `tests/options-docs.js` fail otherwise. To change an existing default, follow "Changing a default" at the top of the registry file (a `defaultHistory` entry and a `DEFAULTS_VERSION` bump) so saved profiles that still hold the old default pick up the new one. Do not add a control that stays enabled when the option cannot work (the pass keeps halo and air-beam controls enabled while it skips them). (why: HAZARDS H2, H4, H6, H14; the registry is the one traceable path)
3. **One resolution point per object type.** Callers pass identity and role (id, kind request), never appearance. The decision about colour, clothing, lamp class, etc. happens once inside the builder. `person()` in `js/drive-scenes.js` is the model. Before adding an appearance option, list every path that builds that type (`docs/inventory/OBJECTS.md`) and route them through the builder. (why: clothing needed five paths; the junction crosser still hard-codes `dark`)
4. **Every object has two bodies: the primitive objects and the detailed (SDF) model.** A visual feature must exist in both, or the report must say which is missing. (why: the tape strips were drawn only on the primitive body and never showed with detailed models on)
5. **Do not add new `touge` / `p.touge` / `mountainPass` branches.** If the pass needs different behaviour, add a parameter the common code reads (road frame, lift), and list the branch in `docs/inventory/TOUGE.md`. (why: three spellings of "is it the pass"; features that were never ported)
6. **GPU and CPU renderers both stay valid.** Either implement the feature on the CPU reference (`js/drive.js`) or make the CPU path ignore the option with a one-line notice. Never break either.
7. **Shader budget.** A feature that adds a texture sampler or uniform array states the count in its report (`docs/inventory/scripts/` has the counters). Hard limits to design against: 16 texture samplers per program, 1024 fragment uniform vectors (many phones report fewer: pack floats four to a `vec4`). (why: lamp road table hit the uniform cap; the pass object program is over the sampler cap)
8. **Anything that changes a rendered frame feeds the cache key that guards it** (skey, tableKey, gkey; see `docs/inventory/RENDER.md`). Add an off-after-on test (section 2). (why: state-leak bugs)
9. **Never mutate the saved options object for temporary state.** Session or game overrides live in an overlay and are dropped, not undone key by key. (why: the minigame leaves `wetness` behind and can persist its settings)

## 2. Tests (what "done" means)

1. **Register the test in `tests/gate.js` MAP for every file you touch.** An unmapped file makes `--touched` fall back to the full gate. If your feature is outside the curated gate, say so.
2. **Minimum test shape for an option:** (a) OFF equals main; (b) ON changes only the expected pixels or objects; (c) OFF after ON equals the first OFF; (d) pin `samples: '1'` (supersampling auto adapts to frame time and breaks equality); (e) set the options the test needs explicitly, do not rely on defaults (a test profile is short, and short profiles are never migrated; a whole-object profile saved by an older build moves its old defaults to the current ones, see the registry).
3. **Use the real GPU** (`--use-gl=angle --enable-unsafe-swiftshader` = Apple Metal). Plain launch is SwiftShader and says nothing about the owner's machine.
4. **Re-baselining a pin needs a proven cause:** show the old hash is reproduced with the cause switched off (people off, `forceCpuStill`, lamp option off), write the cause next to the pin and in the commit message. Never loosen a check to make it pass. Never re-baseline a failure you cannot explain; stop and report.
5. **Claiming a failure is pre-existing needs a check on main** (or a bisect), not an assumption.
6. **Run the touched gate alone** before merge. BA5, SD, SE, FG-fog, SC-beam-scatter are load sensitive: nothing else may be running. The full gate once per merge checkpoint.
7. **A branch's own `--only` subset is not enough.** The orchestrator's integrated gate has found real bugs the agent's subset missed (uniform limit, shader pins, people-count pins).

## 3. Evidence and reporting

1. Label every claim OBSERVED (you ran or read it) or INFERRED. Numbers are measured or marked as assumptions; never fill a gap with a plausible value.
2. **Screenshots are part of the deliverable**: real GPU, canvas about 912x513 or 940x529, main versus branch, same pose, saved under `.claude/briefs/reports/overnight-shots/<JOB>/` and listed in the report with one line on what to look at. Look at them yourself before reporting.
3. The report states what was **not** tested. "Not verified" is a normal, useful section.
4. Physical constants (lumens, candela, retroreflectance) come with a source and a label (verified / snippet / inference / tuning). Tuning values are the owner's to judge by eye.

## 4. Process

1. One worktree and branch per job, under `.claude/worktrees/`. Never edit main or another job's worktree. Commit on your branch only; the orchestrator merges and pushes.
2. Haiku is the default builder. A Sonnet agent needs the owner's approval each time. Stop at a second failure and report; do not retry blind.
3. Own ports per job, kill servers by PID (never `pkill`), no bare `git stash`, no `--full` from an agent.
4. Agents do not guess flags or settings that fail quietly; check them in the source.

## 5. Keeping this current (the docs duty)

1. **When you touch an option, an object builder, a shader or a test, update its row in `docs/inventory/` in the same commit.** Cleaning up what you touch, not everything, is the policy.
2. Re-run the inventory scripts in `docs/inventory/scripts/` when you change shader text (`uniforms.mjs`, `reach.mjs`) or the option list (`gen-options-docs.js`); commit the output if it is tracked.
3. New standing rule or new landmine: add it to this file or `docs/inventory/HAZARDS.md`. The orchestrator re-reads this file at the start of every session and after every compaction.
4. The orchestrator keeps a one-line pointer to this file and to `docs/inventory/README.md` in the project memory so it survives compaction.
