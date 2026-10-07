#!/bin/sh
# table.sh tag...  — one row per run log in $P3_OUT: tag | pass/fail/unsure + window lm | peak | reach | solve time
D=$(cd "$(dirname "$0")" && pwd); OUT=${P3_OUT:-$D/out}
for t in "$@"; do f=$OUT/$t.log; [ -f $f ] || continue
  v=$(grep -E '^verdict' $f | sed -E 's/.*"pass":([0-9]+),"fail":([0-9]+),"unsure":([0-9]+).*lm-in-window ([0-9]+).*/\1\/\2\/\3 \4 lm/'); pk=$(grep -E '^png' $f | sed 's/.*peak //'); r=$(grep -E '^reach' $f | sed 's/reach //'); sv=$(grep -E '^solve' $f | cut -d, -f1)
  printf "%-12s %-22s peak %-6s reach %-10s %s\n" "$t" "$v" "$pk" "$r" "$sv"
done
