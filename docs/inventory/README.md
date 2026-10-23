# docs/inventory

Inventory of the drive view (written 2026-10-22, base main f52ed8a; the option registry landed on feat/option-registry the same day). Start with HAZARDS.md. The option list now lives in `js/options-registry.js`; OPTIONS.md and GROUPS.md are partly generated from it.

| file | what |
|---|---|
| OPTIONS.md | every option: declaration, control, URL params, migrations, readers, gating, tests |
| OBJECTS.md | every scene object type, every path that builds it, and the divergences between paths |
| TOUGE.md | every mountain-pass branch, the road-frame interface, sampler budget, known gaps |
| RENDER.md | passes, programs, sampler/uniform counts, cache keys, frame-budget machinery |
| COVERAGE.md | option x test matrix, curated gate vs MAP, pedestrian-dependent pins |
| HAZARDS.md | 15 ranked cross-cutting hazards with evidence and the seam that would remove each |
| GROUPS.md | proposal for grouping the drive controls (top layer, advanced, duplicates, presets), plus a generated listing from the registry |
| DESIGN.md | the registry design; steps 1, 3 (as data), 6 (defaults only) and 11 (OPTIONS.md columns) are built, see its Status block |
| scripts/ | Node-only helpers that produced the counts (read js/ and tests/, change nothing): `reach.mjs`, `uniforms.mjs` (shader samplers and uniform rows), `options-scan.js` (option readers and tests), `gen-options-docs.js` (regenerates the registry columns of OPTIONS.md and the GROUPS.md listing from js/options-registry.js; `--check` reports a stale file) |

Labels used throughout: OBSERVED = read at the cited file:line or computed by a command; INFERRED = deduced, not run. No browser test was run.
