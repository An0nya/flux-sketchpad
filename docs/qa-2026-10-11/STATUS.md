# QA sweep and fix batches — status (2026-10-11)

Handoff for the next session. The process: 6 QA agents found 88 bugs (tags in `INDEX.md`, details in
`<area>/findings.md`, repro scripts beside them). One agent grouped them by root cause into 42 groups and
11 fix batches (`GROUPS.md`, which also holds Anya's product decisions at the end). Sonnet fix agents take
one batch each in its own worktree, under the contract in `FIX-BRIEF.md`. Each bug gets a test that fails
before the fix. Opus reviews the diffs and merges into `main` one batch at a time. Each batch's report is in
`fixes/B*.md`.

## Merged into main (pushed)
| Batch | What | Groups |
|---|---|---|
| B1 | render crashes: Stamp picker `clearZero`, blank map after zoom+collapse, zoom limits | G01–G03 |
| B2 | version counter (stale results), scene validation on load, input bounds, Measured emitter | G04 (state.js half), G05, G06, G09 |
| B3 | undo history: intent excludes solver-written fields; undo keeps the reflector until the re-solve | G07, G08 (Stop half → B8) |
| B4 | layout: preview refines after paint, pane minimums, wrapping, no jump during solves | G11–G14 |
| B5 | Spec: footer refresh, Measure at "target" follows the target, road cut-off in every aim mode, wording | G15–G20, G02b |
| B5b | Anya's Spec decisions: no live aim during traces, Measure at ∞ default, road/goals from far field at the judge's aim, IIHS labels (checked vs IIHS protocol v3, 2018) | D-S03/S13/S16/S18 |
| B6 | geometry cache bounded (LRU 8), README corrected (file:// is partial) | G21, G22 |
| B7 | solver host: request-id map (`rid`), single-flight rebuild, crash recovery, corrupt solver list, file:// notice | G22b, G23, G24 |
| B8 | ui.js solve lifecycle: Stop/timeout/crash keep 'out of date', scene/solver change cancels the solve, frame errors isolated, atomic loadScene | G04 (ui half), G25–G30 |
| B10 | stats/panels: Mode A clear (option B), field write-back, no NaN/Infinity, far-field footer peak, outside-envelope warning, LED presets at own defaults | G10, G39–G42, D-E08, D-C14 |
| B9 | gestures: no paint on pinch/double-click, interpolated strokes, envelope min thickness; brush mode raise (default) / set / lower | G31–G33, D-E17 |
| B4b | titles aligned, Fidelity on the mode row, compact Spec Result pane (toolbars only when expanded, hint), | L-title, L-fidelity, L-spec-compact |
| B11 | dividers, ARIA, sidebar on narrow, Optics reset, autosave backup, turntable stops (idle 10 s / click), Spec auto-layout, Expand enlarges its map | G34–G38, D-M03, D-spec-layout, L04 |
| B12 | one source of truth: road/IIHS/quality/goals read ∞ at its own aim whatever Measure at is; tools.trace uses the same Road.analyse; consistency test (UI == tools.trace at ∞/25 m/10 m/target); fallback flagged (notice + res.road.source); Spec inputs write back; mode switch autosaves; Spec Result reopens expanded | T1, T2, T4–T7 (T3 not needed: preview has no road numbers) |
| — | GPU trace branch (`claude/webgpu-webgl-traces-9bi0ul`), opt-in, benched on the M4: ~30–40× one CPU core | — |
| — | ideal-goals-port branch (solvers/ + tools/) | — |

Checks on main after the last merge: `node tests/all.js` all passed; `node tests/regress-node.js` 0 fail;
all 19 `tests/regress/*.js` browser tests 0 fail (runner: `run-all.sh <dir> <port>`; browser tests need
`PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright`, as Playwright isn't installed globally).

## Not merged yet
- Nothing: all 13 batches merged. Pushed main is green: all.js, regress-node 104, 51 browser regress files.
- Open product calls: (1) hide or keep the Far field/Road/Drive view buttons on the compact Spec pane (hidden now); (2) 1280×720 + sidebar: Spec Result map 61 px, the rest is the 2-row Spec footer; (3) single paint click lands 400 ms late (tells click from double-click reset) vs. double-click reset only outside Paint; (4) Drive canvas may overflow its pane on the right (unchecked, may predate B4b).

## Lessons
- 6 parallel Opus QA agents hit the usage cap together; Sonnet with a precise brief does fix work well.
- Agents must never `git stash` (shared across worktrees; one pop applied another batch's stash).
- Memory checks need `--expose-gc` (regress-node.js now re-runs itself with it).
- Playwright headless_shell gives SwiftShader, not the Apple GPU: use `channel: 'chromium'` + `--enable-unsafe-webgpu`.
