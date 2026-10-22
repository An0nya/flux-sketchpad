# docs/inventory

Read-only inventory of the drive view (2026-10-22, base main f52ed8a). Start with HAZARDS.md.

| file | what |
|---|---|
| OPTIONS.md | every option: declaration, control, URL params, migrations, readers, gating, tests |
| OBJECTS.md | every scene object type, every path that builds it, and the divergences between paths |
| TOUGE.md | every mountain-pass branch, the road-frame interface, sampler budget, known gaps |
| RENDER.md | passes, programs, sampler/uniform counts, cache keys, frame-budget machinery |
| COVERAGE.md | option x test matrix, curated gate vs MAP, pedestrian-dependent pins |
| HAZARDS.md | 15 ranked cross-cutting hazards with evidence and the seam that would remove each |
| DESIGN.md | proposal: option registry schema, dependency display, generation, incremental steps |
| scripts/ | Node-only helpers that produced the counts (read js/ and tests/, change nothing): `reach.mjs`, `uniforms.mjs` (shader samplers and uniform rows), `options-scan.js` (option readers and tests) |

Labels used throughout: OBSERVED = read at the cited file:line or computed by a command; INFERRED = deduced, not run. No browser test was run.
