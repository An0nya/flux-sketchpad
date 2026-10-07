#!/bin/sh
# 150-facet variants on the scene at 8 M rays: single ellipsoid, bypass reaching the equator band, sealed.  Results in $P3_OUT (V-*.log), then V.DONE
D=$(cd "$(dirname "$0")" && pwd); OUT=${P3_OUT:-$D/out}; mkdir -p "$OUT"
"$D/run.sh" 150 V-ell '{"reflector":"ellipsoid"}' 8e6 > /dev/null 2>&1
"$D/run.sh" 150 V-reach100 '{"bypassReach":100}' 8e6 > /dev/null 2>&1
"$D/run.sh" 150 V-sealed '{"bypass":"off"}' 8e6 > /dev/null 2>&1
echo done > "$OUT/V.DONE"
