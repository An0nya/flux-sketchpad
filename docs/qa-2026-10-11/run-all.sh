#!/bin/zsh
# full check of a checkout: all.js + regress-node + every browser regress script. usage: run-all.sh <dir> <port>
cd $1 || exit 2
export PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright
echo "== all.js"; node tests/all.js 2>&1 | tail -2
echo "== regress-node"; node tests/regress-node.js > /tmp/rn.$$ 2>&1; echo "exit $? pass $(grep -c PASS /tmp/rn.$$) fail $(grep -c FAIL /tmp/rn.$$)"; grep FAIL /tmp/rn.$$
python3 tests/serve.py $2 >/dev/null 2>&1 & srv=$!; sleep 1
for t in tests/regress/*.js; do node $t $2 > /tmp/rt.$$ 2>&1; e=$?; echo "== $t exit $e pass $(grep -c '\[PASS\]' /tmp/rt.$$) fail $(grep -c '\[FAIL\]' /tmp/rt.$$)"; grep '\[FAIL\]' /tmp/rt.$$ | head -3; done
kill $srv; rm -f /tmp/rn.$$ /tmp/rt.$$
