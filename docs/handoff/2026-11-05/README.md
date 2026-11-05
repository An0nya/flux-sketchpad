# Handoff: review-fix work list, 2026-11-05

Branch `claude/exciting-brown-9x0vlq`. This directory is handoff material only. Delete it before merging to main.

## Landed (each fix has an executed check that fails before and passes after)
- C11 0142865: the halo polar tables use the first moment under moment2, and the wet-bounce mirror is in every table (`moment2Wb` re-pinned; CC sweep covers moment 3)
- C12 39a978b: tableKey carries surfKOf while wetBounce is on
- C13 d08f6b4: roadSurfaces/roadSurface added to the drive-anim frame key and to groundKey
- B5 3d639e7: the traffic density gate reads the car's tile (tests/endless-traffic-density.js, in the gate)
- B6 f3ca8f6: mirrorCars puts multilane followers in the right lane
- B7 8adb4f6: tileWorld verge edges come from mlLanes when multilane (tests/multilane-verge.js, in the gate). The base scene's place() objects (delineator posts, scene deer) still use the two-lane geometry.

## A1: not landed (`A1-endless-memo.patch`, test `endless-chain.js` → tests/)
- What it does: memoises endlessTile (FIFO 4096, key = seed|k|preset|customKey) and chains the switchback/no-loop rules on the ADJUSTED k-1/k-2, with an order-independent chain reset at k<=0 and every 256 tiles. It also bounds endlessElevCache to 16 entries.
- Results: switchbacks three-same-sign runs go from 3344 to 0, the result does not depend on query order, and a warm call is under 1 us.
- Breaks: about 5% of tiles change shape, which fails le-chonk-presets (switchbacks: "hairpin-heavy ... alternation intact") and le-chonk-cabin (drift yaw at endlessTile(7,7)). It is still open whether those pins should move or the change should.
- Item 19 is the likely root cause: the tight-S rule `abs(p1.curvature) >= 1/250` matches every curve kind and flattens all S-bends. Fix 19 together with A1 before deciding on the re-pins.
- Apply: `git apply docs/handoff/2026-11-05/A1-endless-memo.patch && cp docs/handoff/2026-11-05/endless-chain.js tests/`

## Not started
A2 (feature table), A3 (cache lampsOf per world.objects, carry st/emit), B4, B8-B10, C14-C18, 19.

## Also noted
- A background run showed regress-node G21 (geometry cache 0.4 → 5.0 MB). It is unverified: the run overlapped a stash.
- The final full node gate was not run. The only page tests run were BG-wetbounce-compile and CC-halo-variant-compile, both green (SwiftShader shim).
