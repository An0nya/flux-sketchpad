Add curve editing to Profile mode: drag segment bodies to move them, endpoints to extend them, and midpoint handles to bend them. Add splitting, straightening, and snapping controls, with a toggle for the existing point editor.

Curves are stored alongside the flattened profile consumed by the engine; old saved scenes retain their existing point profiles.

Validation: `node tests/all.js` passed on the original feature branch and on a combined checkout containing all four features. All 18 Profile browser assertions passed on both checkouts, using real pointer actions for creation, movement, extension, bending, snapping, splitting, straightening, undo/redo, and the older point editor. Old scenes build byte-identical surfaces after loading. A separate browser run confirmed that a newly drawn bent curve survives autosave and reload unchanged, with no page/console errors.

The complete combined regression sweep passed: 53 browser test scripts and 156 Node regression assertions, plus `tests/all.js`. Current main was merged into this branch, retaining all feature regression tests. The Profile block was moved below the existing sealed-beam block so this PR and the Drive PR can merge in either order without conflicting. Their merge-tree check succeeds.

Readiness: no functional blockers observed; ready to merge based on Chromium testing on the Mac. Safari/iPhone were not tested. Splitting a bent segment approximates its shape by fitting two symmetric arcs; it is not an exact curve subdivision.

Screenshots, raw outputs, and the review record are saved locally in `docs/pr-review-2026-10-14/`. Merged after approval and pushed to main through 1a9aee1; the published tree exactly matches the reviewed combined merge tree. A fresh Node regression run passed all 156 assertions. GitHub Pages successfully built that commit; live index.html and both feature scripts match local main by SHA-256. Both features are deployed. Anya will check iOS Safari.
