#!/bin/sh
# run.sh <name> '<settings fragment>' [rays] — run projector-liou on a scene, print one summary line; out/<name>.{log,png,scene.json}
#   env: SCENE (default scenes/her-fmvss.json), BUDGET (facets, default 150). Quote compliance only from >= 2e6 rays.
D=$(cd "$(dirname "$0")" && pwd); mkdir -p "$D/out"; N=$1; R=${3:-2e5}; SC=${SCENE:-$D/scenes/her-fmvss.json}; case "$SC" in /*) ;; *) SC="$PWD/$SC";; esac
cd "$D/../sqm-hl" && node run-on-scene.js projector-liou --load "$D/../../solvers/projector-liou.js" --scene "$SC" --budget ${BUDGET:-150} --rays "$R" --dir "$D/out" --out "$N" --settings "{\"verbose\":true${2:+,$2}}" > "$D/out/$N.log" 2>&1
python3 - "$D/out/$N.log" "$N" <<'PY'
import re,sys,json
t=open(sys.argv[1]).read(); m=re.search(r'^verdict \w+ n (\{.*?\}) score ([\d.]+) lm-in-window (\d+)',t,re.M); pk=re.findall(r'peak (\d+)',t); sv=re.search(r'^solve .*?(\d+) surfaces',t,re.M); rc=re.search(r'^reach (\S+) m',t,re.M)
if m:
    n=json.loads(m.group(1)); print("%-22s pass/fail/unsure %d/%d/%d  lm-in-window %s  peak %s  surfaces %s  reach R/L %s"%(sys.argv[2],n['pass'],n['fail'],n['unsure'],m.group(3),pk[-1] if pk else '?',sv.group(1) if sv else '?',rc.group(1) if rc else '?'))
else: print(sys.argv[2],'NO VERDICT:',t[-600:])
PY
