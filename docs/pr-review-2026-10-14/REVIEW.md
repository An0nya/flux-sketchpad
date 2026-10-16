# Flux feature PR review — 2026-10-14

Exploring mode. These are direct checks of the delivered branches, not a guarantee across every browser or device.

## Published

- [PR #1](https://github.com/An0nya/flux-sketchpad/pull/1): GPU default and device ray limits. Merged.
- [PR #2](https://github.com/An0nya/flux-sketchpad/pull/2): sealed-beam fluted-lens solver and H4 examples. Merged.
- `main` was pushed at `d3853321a3f6263fc713d745d526f722523fb6fe`.
- GitHub Pages reports a successful build of that commit. The live `js/gpu-trace.js` and `solvers/sealed-beam-v1.js` match local main by SHA-256.
- Live site: <https://an0nya.github.io/flux-sketchpad/>.

## Remaining features — merged after approval

- [PR #3](https://github.com/An0nya/flux-sketchpad/pull/3): Drive animation, head `e30bb67`. Merged after Anya approved deployment.
- [PR #4](https://github.com/An0nya/flux-sketchpad/pull/4): Profile curve editor, head `5f345a3`. Merged after Anya approved deployment.
- Both branches were updated with current main. Their only merge conflict was in `tests/regress-node.js`; all feature test blocks were retained. Profile tests were moved below the existing sealed-beam block so the two open PRs can merge in either order without colliding.
- `git merge-tree --write-tree feat/drive-anim feat/profile-mode` succeeded, producing tree `03eca2337210d77756c02e2acfd494bd9f0cad8c`.

## Observed behavior

Drive animation: 57 dedicated browser assertions passed, both on its original branch and on a combined checkout containing all four features. Frames and distance advance; pause stops both; 30/90 km/h controls produced approximately those speeds. Hidden tabs, collapsed panes, and other displays stop the loop. Scenery toggles, large view, Escape/close, resizing, 2x display scaling, US markings, and rendered-pixel comparisons passed. No page errors were reported. Animation is opt-in and currently supports the open-road scene; forest and city remain still views.

Profile editor: 18 dedicated browser assertions passed on its original branch and on the combined checkout. Real pointer events created, moved, extended, and bent curves; split, straighten, axis snapping, undo/redo, and the older point editor worked. Loading an old saved profile built byte-identical surfaces. A separate screenshot run created a three-node bent curve, built 12 surfaces from 13 flattened points, and preserved the same curve and points after a page reload. No page or console errors were observed in that run.

## Validation

- `node tests/all.js`: passed on main, each original open feature branch, and the combined checkout.
- `node tests/regress-node.js`: passed on main, each open branch updated with main, and the combined checkout (156 assertions).
- F1 GPU browser checks: six passed. F3 sealed-beam browser checks: ten passed.
- Full combined browser regression sweep: completed successfully. All 53 test scripts passed, with 553 browser assertions and zero failures. `G23-boot.js` is a shared helper rather than a test; its empty output was checked against the source and excluded from those counts. Results are in `summary.json` and `final-counts.json`, complete output per script in the `.log` files.
- Browser testing used Chromium, with `channel: 'chromium'` for Drive animation. Safari/iPhone were not tested; no WebKit test runtime is installed.
- The temporary combined checkout was `/private/tmp/flux-pr-readiness-20261014`, commit `9d339f4`. Its application files matched the successful merge tree of the final two PR heads; the only difference was ordering of regression test blocks. The clean temporary checkout and the four review-only servers were removed/stopped after completion; the original branch worktrees and all saved evidence remain.

## Screenshots and evidence

- `drive-animation-pane.png` and `drive-animation-large.png`.
- `profile-curve-editor.png` and `profile-curve-editor-large.png`.
- `screenshot-evidence.json`: actual frame/distance counters, curve data, and before/after reload comparison.
- `flux-f2-review.log`: original-branch feature checks and performance observations. The performance figures were collected while other test work was active and should not be treated as isolated benchmarks.
- `flux-f4-review.log`: original-branch pointer checks and compatibility output.

## Review-process corrections

The first screenshot harness cleared localStorage with an init script, which also ran on reload and erased the data it was supposed to verify. The reload check initially failed for that reason. Removed that init script, repeated the screenshot run, and compared the raw expected and restored curve/point data; they matched. This was a harness failure, not an observed product failure. It cost one repeated screenshot run.

The full regression sweep began sequentially, then resumed with three independent browsers after 23 completed checks. Only the prior review runner and its own browser processes were stopped. Completed outputs were retained; the interrupted check was rerun. Details are in `runner-resume.json`.

## Verdict

Both features were judged functional enough to merge and deploy based on the tested Mac/Chromium paths. No functional blockers were observed. Their test-only merge conflicts were resolved. Anya then approved merging and publishing both, and will check them in iOS Safari. Profile splitting fits two symmetric arcs, so it approximates rather than exactly preserves the curve.

## Deployment after approval

Merged both features locally and pushed `main` at `1a9aee1ae41f96da38b8d5036197610eaee502ef`. Its tree is exactly `03eca2337210d77756c02e2acfd494bd9f0cad8c`, the previously checked combined merge tree. GitHub marks PRs #3 and #4 merged. A fresh `node tests/regress-node.js` run passed all 156 assertions; output is saved in `deploy-final-node.log`. GitHub Pages successfully built that commit. The live `index.html`, `js/drive-anim.js`, and `js/profile.js` match local main by SHA-256. Both features are now deployed at <https://an0nya.github.io/flux-sketchpad/>.

## Reproduce

### Live inspection entry points checked after deployment

The deployed `js/ui.js` and `js/engine.js` match local main by SHA-256. The page exposes `window.RF`. In a browser console, `RF.UI.store.scene` reads the current scene/settings/geometry, `RF.UI.store.reports` reads solver/build verification reports, `RF.UI.run.P` reads the prepared simulation model, and `RF.UI.run.ctx` reads the current run's grids, hits, counts, and energy bookkeeping. Once a run exists, `RF.Engine.stats(RF.UI.run.ctx)` computes summary metrics. `RF.GpuTrace.info()`/`error()` and `RF.DriveAnim.stats()` expose additional diagnostics. These are exposed browser objects, not a separately documented stable inspection API; `SOLVER_API.md` documents the custom-solver interface.

There is no HTTP API for reading another browser's current scene. The application fetches static images/solver files and stores its scene in browser localStorage; inspecting a fresh tab reads that tab's state, not Anya's iPhone session.

Run `python3 tests/serve.py <port>` from the checkout being tested, then set `PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright` for the browser scripts.

```
node tests/all.js
node tests/regress-node.js
PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright F2_REAL_GPU=1 node tests/regress/F2-drive-anim.js 8836 --perf
PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/F4-curve-editor.js 8836
```

The saved `flux-pr-review.cjs` and `flux-pr-screenshots.cjs` are one-off review scripts with explicit temporary-checkout and output paths, not project infrastructure.
