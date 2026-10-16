Add an opt-in animated Drive view for the open-road scene. It moves scenery and road markings over a cached ground image, adds pause/speed/scenery controls, and provides a larger view. The still renderer remains the default.

Validation: `node tests/all.js` passed on the original feature branch and on a combined checkout containing all four features. All 57 Drive browser assertions passed on both checkouts: frames/distance, pause, speed, hidden/collapsed view lifecycle, scenery controls, large view, resize, 2x display scaling, US markings, rendered-pixel comparisons, and no page errors.

The complete combined regression sweep passed: 53 browser test scripts and 156 Node regression assertions, plus `tests/all.js`. Current main was merged into this branch; its test-only conflict was resolved by retaining both feature test blocks. A merge-tree check of this PR with the Profile PR also succeeds.

Readiness: no functional blockers observed; ready to merge based on Chromium testing on the Mac. Animation currently supports the open-road scene; other scenes remain still. Safari/iPhone were not tested.

Screenshots, raw outputs, and the review record are saved locally in `docs/pr-review-2026-10-14/`. Merged after approval and pushed to main through 1a9aee1; the published tree exactly matches the reviewed combined merge tree. A fresh Node regression run passed all 156 assertions. GitHub Pages successfully built that commit; live index.html and both feature scripts match local main by SHA-256. Both features are deployed. Anya will check iOS Safari.
