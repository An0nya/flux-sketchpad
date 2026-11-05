# Test runner migration: tests/gate.js -> node --test + @playwright/test

Status: phase 1 started (adapters, 3 native ports, CI workflow). gate.js is unchanged in behaviour; it now also
`module.exports` its lists and `plan()` so the adapters select exactly what it selects.

## Run
    npm ci                                                     # @playwright/test 1.63.0 (+ playwright)
    node tests/runner/node-suites.js [--test-shard=1/2 ...]   # gate's node: entries under node --test
    npx playwright test --project=chromium --grep-invert @solo # page pool (adapter + native)
    npx playwright test --project=chromium --grep @solo --workers=1
    GATE_TOUCHED=main ... / GATE_ONLY=a,b ...                  # gate's --touched / --only, for both runners
No GPU: PW_GL=swiftshader (default off macOS) points each script's PLAYWRIGHT at tests/runner/pw-shim.js, which
rewrites every chromium launch to SwiftShader. PW_BROWSER=webkit (webkit project) runs the same scripts on WebKit.

## Files
- tests/runner/fail-lines.js  `--require` preload: counts gate's [FAIL]/✗/not ok lines, forces exit 1 (node --test only sees exit codes)
- tests/runner/node-suites.js wrapper: gate selection -> `node --test --require fail-lines.js <files>`
- tests/runner/select.js      GATE_ONLY / GATE_TOUCHED -> gate.plan()
- tests/runner/tags.js        @solo (PAGE_SOLO), @gpu (P1), @hash (15 pinned-hash tests), per-test env (P1_REAL_GPU)
- tests/runner/pw-env.js, pw-shim.js  which playwright module a script gets
- tests/pw/gate-adapter.spec.js  one test per gate page script: spawn, kill process group at timeout-60 s, log attached
- tests/pw/fixtures.js        shared fixtures for native specs (built-in per-worker browser, webServer, pageErrors, app, drive)
- tests/pw/native/*.spec.js   native ports; the adapter skips a script when native/<name>.spec.js exists
- playwright.config.js, .github/workflows/tests.yml

## gate.js feature -> standard equivalent
| gate.js | standard |
|---|---|
| pool --jobs N | `--test-concurrency=N` / Playwright `workers` (PW_WORKERS) |
| PAGE_SOLO after the pool | `@solo` tag, separate invocation `--grep @solo --workers=1` (project dependencies would skip solo when the pool fails) |
| retry alone, counted clean, printed LOAD-SENSITIVE | `retries` (1 on CI): pass-on-retry is reported **flaky**, exit 0 (add `--fail-on-flaky-tests` to make it red). Difference: retry is not alone; for that, `--last-failed --workers=1` |
| wall limit + kill process group | node: `--test-timeout` (kills the child; grandchildren not reaped). Playwright: test timeout; adapter kills the group itself; native tests own no processes |
| tests/gate-logs/*.log | node: reporter output / JUnit; Playwright: log attachment + trace in HTML report |
| MAP + --touched | GATE_TOUCHED (same MAP). Playwright `--only-changed` only follows the spec files' Node import graph; app js/ loaded by the browser is invisible to it, so it only helps for edits to native specs themselves |
| NODE/PAGE_PAR/PAGE_SOLO | still in gate.js (single source) until migrated; end state = discovery by glob + tags |
| KNOWN_FAILING | excluded by plan() (same); native: `test.fixme`/`test.fail` |
| freePort + serve.py | `webServer` on PW_PORT (default 8744) |
| JUnit/HTML, sharding | `--test-reporter=junit`, `--test-shard` (by file); Playwright `--shard`, blob + merge-reports |

## Plan
1. CI green baseline on SwiftShader: find which non-@hash tests fail there (never run in full yet), tag or fix. Register the Mac runner.
2. Swarm: port page tests to tests/pw/native/ following DW/SB1/SPEED0. Per port, in one commit: add the spec, verify on Mac
   (chromium + webkit), delete tests/regress/<name>.js, remove it from gate.js lists/MAP. Move page helpers that tests load
   with addScriptTag (UX2-drive-ux.js, drive-three-page.js, touge-page.js) to tests/pw/helpers/ first.
3. Node suites: convert ok() checks to node:test `test()` + assert, rename *.test.js; then fail-lines.js is unneeded.
4. Selection: drop --touched on CI (full sharded run); keep MAP only as a local dev loop if wanted.
5. Delete: tests/gate.js, tests/runner/{fail-lines,select,node-suites,pw-shim,pw-env}.js, tests/pw/gate-adapter.spec.js,
   the PLAYWRIGHT env convention in every script, tests/all.js's own runner logic (its syntax checks become a suite),
   `tests/gate-logs/` in .gitignore.

## Self-hosted Mac (real GPU)
Public repo: GitHub advises against self-hosted runners on public repos. The job never runs fork PRs; also set
Settings > Actions > "Require approval for all outside collaborators".
1. Settings > Actions > Runners > New self-hosted runner > macOS ARM64; follow its download/config steps, add label `gpu`
   (`self-hosted, macOS, ARM64` are automatic).
2. `./svc.sh install && ./svc.sh start` (LaunchAgent: needs the user logged in for Metal); keep the Mac awake.
3. Needs python3 on PATH. Settings > Secrets and variables > Actions > Variables: `MAC_GPU_RUNNER=true` enables the job.
