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
if (!files.length) { console.log('node-suites: nothing selected'); process.exit(0); }
const args = ['--test', '--require', './tests/runner/fail-lines.js'];
if (!given('--test-timeout')) args.push('--test-timeout=600000');
if (!given('--test-concurrency')) args.push('--test-concurrency=3');
if (!given('--test-reporter')) args.push('--test-reporter=spec');
const r = spawnSync(process.execPath, [...args, ...pass, ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
