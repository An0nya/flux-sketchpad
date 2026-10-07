#!/bin/sh
# the budget ladder (150, 50, 20 facets) on the scene at 8 M rays.  $1 = settings JSON overrides, $2 = tag; writes $P3_OUT/<tag>-<budget>.log and <tag>.DONE
D=$(cd "$(dirname "$0")" && pwd); OUT=${P3_OUT:-$D/out}; TAG=${2:-L}; mkdir -p "$OUT"
for B in 150 50 20; do "$D/run.sh" $B $TAG-$B "${1:-{\}}" 8e6 > "$OUT/$TAG-$B.summary" 2>&1; done
echo done > "$OUT/$TAG.DONE"
