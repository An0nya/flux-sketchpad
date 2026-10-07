#!/bin/sh
# run.sh <budget> <out-name> ['{"setting":value}'] [rays]   — v3 on a scene file through sqm-hl's run-on-scene harness; log, png and scene.json go to $P3_OUT (default tools/projector-v3/out)
# P3_SCENE = the scene file (default ~/Downloads/reflector-scene-4.json: her HB3 scene, not in the repo)
D=$(cd "$(dirname "$0")" && pwd); OUT=${P3_OUT:-$D/out}; SCENE=${P3_SCENE:-$HOME/Downloads/reflector-scene-4.json}; mkdir -p "$OUT"
cd "$D/../sqm-hl" && node run-on-scene.js projector-v3 --load "$D/../../solvers/projector-v3.js" --scene "$SCENE" --budget ${1:-150} --rays ${4:-4e6} --dir "$OUT" --out ${2:-v3} --settings "${3:-{\}}" > "$OUT/${2:-v3}.log" 2>&1
grep -E "^solve|note:|^verdict|^reach|^loose|ERROR|Error" "$OUT/${2:-v3}.log" | cut -c1-330
