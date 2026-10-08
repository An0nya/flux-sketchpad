#!/bin/sh
# run.sh <name> '<settings fragment>' [rays]   — run the (scratch) projector-v3 variant on the Ø90x200 cylinder scene and print one summary line.
#   settings fragment = JSON members without braces, e.g.  '"half":"quad","xQ":16,"xLow":16,"focal":84,"shield":"auto","band":8.7,"bandP":8,"bandTilt":0.5'
#   env: SCENE (default scenes/cyl20-base.json), RAYS (default 2e5; use >= 2e6 for any number you quote, compliance needs it)
#   writes out/<name>.log, out/<name>.png (far field) and out/<name>.scene.json (open it in the app). Run from this directory.
D=$(cd "$(dirname "$0")" && pwd); mkdir -p "$D/out"; N=$1; R=${3:-${RAYS:-2e5}}; SC=${SCENE:-$D/scenes/cyl20-base.json}
cd "$D/../../sqm-hl" && node run-on-scene.js projector-v3 --load "$D/solver/p3-band2.js" --scene "$SC" --budget 150 --rays "$R" --dir "$D/out" --out "$N" --settings "{\"reflector\":\"ellipsoid\",\"aperture\":42.5,\"focal\":54,\"lcExtra\":24,$2}" > "$D/out/$N.log" 2>&1
python3 - "$D/out/$N.log" "$N" <<'PY'
import re,sys,json
t=open(sys.argv[1]).read(); m=re.search(r'^verdict \w+ n (\{.*?\}) score ([\d.]+) lm-in-window (\d+)',t,re.M); pk=re.findall(r'peak (\d+)',t); sv=re.search(r'^solve .*?(\d+) surfaces',t,re.M); rc=re.search(r'^reach (\S+) m',t,re.M)
if m:
    n=json.loads(m.group(1)); print("%-26s pass/fail/unsure %d/%d/%d  lm-in-window %s  peak %s  surfaces %s  reach R/L %s"%(sys.argv[2],n['pass'],n['fail'],n['unsure'],m.group(3),pk[-1] if pk else '?',sv.group(1) if sv else '?',rc.group(1) if rc else '?'))
else: print(sys.argv[2],'NO VERDICT:',(re.search(r'note:.*',t) or [''])[0][:160])
PY
