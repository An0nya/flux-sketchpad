#!/usr/bin/env node
// Run the gate's Node suites under the standard runner: node --test, one file = one test, unchanged scripts.
//   node tests/runner/node-suites.js [node --test flags...]
// Selection: GATE_ONLY / GATE_TOUCHED (see select.js); default = every node: entry of the full gate.
// Everything else is passed to node --test, e.g.
//   --test-shard=2/4                                   sharding (by file)
//   --test-concurrency=3                               worker count (gate.js --jobs)
//   --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-reports/node.xml
// Defaults added when not given: --test-timeout=600000 (gate.js --wall), --test-concurrency=3, spec reporter to stdout.
const { spawnSync } = require('child_process'), path = require('path');
const { selected, nodeSuites, nodeFile, exists, root } = require('./select.js');
const pass = process.argv.slice(2), given = (f) => pass.some((a) => a === f || a.startsWith(f + '='));
const files = nodeSuites(selected()).map(nodeFile).filter((f) => exists(f)).map((f) => path.relative(root, f));
// An empty selection is NOT a green run: it is the gate's "could not run" case (tests/gate.js refuses an empty plan),
// so say so loudly and fail. A silent exit 0 here would be a vacuous pass — the runner would report success without
// having run a single test.
if (!files.length) { const which = process.env.GATE_ONLY ? 'GATE_ONLY=' + process.env.GATE_ONLY : (process.env.GATE_TOUCHED ? 'GATE_TOUCHED=' + process.env.GATE_TOUCHED : 'the full gate'); console.error('[FAIL] node-suites: NOTHING SELECTED (' + which + ') — an empty selection is a vacuous pass, not a green run'); process.exit(1); }
const args = ['--test', '--require', './tests/runner/fail-lines.js'];
if (!given('--test-timeout')) args.push('--test-timeout=600000');
if (!given('--test-concurrency')) args.push('--test-concurrency=3');
if (!given('--test-reporter')) args.push('--test-reporter=spec');
const r = spawnSync(process.execPath, [...args, ...pass, ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
