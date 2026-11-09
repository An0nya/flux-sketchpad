// A tiny script for the runner's own check (tests/runner-selftest.js): it prints one line, optionally a [FAIL] line,
// so the fail-lines preload can be exercised without inventing a real failing suite.
//   node tests/runner/fixtures/print.js fail   -> prints a [FAIL] line (the gate counts it as a failure)
//   node tests/runner/fixtures/print.js ok     -> prints a clean line
if (process.argv[2] === 'fail') console.log('[FAIL] fixture: a deliberate failure line');
else console.log('[ok] fixture: a clean line');
