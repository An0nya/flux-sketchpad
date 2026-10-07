#!/bin/sh
# v3 on the built-in fixtures (R112 B, 100 facets, 4 M rays); logs in $P3_OUT/fx
D=$(cd "$(dirname "$0")" && pwd); OUT=${P3_OUT:-$D/out}/fx; mkdir -p "$OUT"
cd "$D/../sqm-hl"
for F in box led-back slim module sealed7; do
  node run-on-scene.js projector-v3 --load "$D/../../solvers/projector-v3.js" --scene $F --preset ece-r112-b --budget 100 --rays 4e6 --dir "$OUT" --out fx-$F > "$OUT/$F.log" 2>&1
done
echo done > "$OUT/DONE"
