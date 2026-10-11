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
| — | GPU trace branch (`claude/webgpu-webgl-traces-9bi0ul`), opt-in, benched on the M4: ~30–40× one CPU core | — |
| — | ideal-goals-port branch (solvers/ + tools/) | — |

Checks on main after the last merge: `node tests/all.js` all passed; `node tests/regress-node.js` 0 fail;
all 19 `tests/regress/*.js` browser tests 0 fail (runner: `run-all.sh <dir> <port>`; browser tests need
`PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright`, as Playwright isn't installed globally).

## Not merged yet
- **B7 solver host** (G23 request-id map, worker crash recovery, G24 corrupt solver list, G22b file:// notice):
  an agent was running on branch `fix/b7-solver-host` (worktree `.claude/worktrees/b7`, base 661c94f) when
  this was written. Check `fixes/B7.md` and the branch before relaunching anything.
- **B8** ui.js solve lifecycle (G25–G30, G04's ui.js half, G08's Stop half: keep dirty A when the
  interrupted solve's result was never applied). Worktree `.claude/worktrees/b8` created at 8d2a2cd; maybe not started.
- **B10** panels.js (G39–G42, G10 "clear" = Anya's option B: remove the reflector AND turn auto-solve off
  for that group; E08 warn on source outside the envelope; C14 LED presets open at their own defaults).
  Worktree `.claude/worktrees/b10` created at 8d2a2cd; maybe not started.
- **B9** ui.js gestures (G31–G33) + brush mode option (raise = default, set, lower). After B8.
- **B11** ui.js chrome (G34–G38) + Optics turntable stops 10 s after idle and when the pane is clicked into
  + Spec auto-layout (entering Spec collapses Editor, expands Result; leaving restores). After B8.
- **B4b** layout follow-ups: Editor/Result titles on one line; Fidelity on the Result mode row when it fits;
  compact Spec Result pane (extra toolbars only when expanded, idle hint to expand); Expand may enlarge its map.
- **B12** one source of truth: road numbers independent of Measure at under cut-off aim; `tools.trace`
  road numbers from the far field at the judge's aim; preview numbers aligned; a consistency test.
- Known remainder: at 1280×720 with the sidebar open, Spec leaves the Result map 0 px tall (B4b's compact
  pane should fix it).

## Lessons
- 6 parallel Opus QA agents hit the usage cap together; Sonnet with a precise brief does fix work well.
- Agents must never `git stash` (shared across worktrees; one pop applied another batch's stash).
- Memory checks need `--expose-gc` (regress-node.js now re-runs itself with it).
- Playwright headless_shell gives SwiftShader, not the Apple GPU: use `channel: 'chromium'` + `--enable-unsafe-webgpu`.
