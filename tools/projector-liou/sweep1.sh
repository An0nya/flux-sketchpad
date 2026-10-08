#!/bin/sh
# edge pass + cleanup shield sweep (10-08): shield off vs cleanup at leak 1/10/25 %, FMVSS and R112 B, f 54, path +24, 2 M rays
cd "$(dirname "$0")"; B='"focal":54,"pathScan":"24"'
for sc in fmvss r112b; do
  export SCENE=scenes/her-$sc.json
  ./run.sh s1_${sc}_off "$B" 2e6 & ./run.sh s1_${sc}_c01 "$B,\"shield\":\"cleanup\",\"leak\":0.01" 2e6 & ./run.sh s1_${sc}_c10 "$B,\"shield\":\"cleanup\",\"leak\":0.1" 2e6 & ./run.sh s1_${sc}_c25 "$B,\"shield\":\"cleanup\",\"leak\":0.25" 2e6 & wait
done
for f in out/s1_*.scene.json; do n=$(basename $f .scene.json); a=$(node ../projector-v3/diag-energy.js $f 2e6 2>/dev/null | awk '/^absorbed/{print $2}'); echo "$n absorbed $a lm"; done
