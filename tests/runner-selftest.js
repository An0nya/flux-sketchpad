// The standard runner checks ITSELF (B2): the selection must be exactly the gate's, a run must report pass/fail, and an
// empty selection must fail loudly instead of passing vacuously. Browser-free, a few seconds.
//   node tests/runner-selftest.js
// It must NOT require tests/gate.js: requiring the gate RUNS the gate (its main is not guarded) and the lander stages a
// patch with swarm's gate.js - a runner that required it would start a nested gate inside the lander's gate.
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { selected, gateListRaw, nodeSuites } = require('./runner/select.js');
const { PAGE_SOLO } = require('./runner/tags.js');
let fails = 0, passes = 0;
const ok = (m, c, d) => { if (c) { passes++; console.log('[PASS] ' + m + (d !== undefined && d !== null && d !== '' ? ' — ' + d : '')); } else { fails++; console.log('[FAIL] ' + m + (d !== undefined && d !== null && d !== '' ? ' — ' + d : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// run a child with the given env; NODE_TEST_CONTEXT must NOT leak in (node --test marks its children, and a nested
// runner that thinks it is a test child misbehaves)
const run = (args, env) => {
  const e = Object.assign({}, process.env, env || {}); delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: e });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 1. the selection is exactly the gate's --list output, name for name
const raw = gateListRaw({}), full = selected({});
const rawNames = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('dark page tests'));
ok('the runner selects exactly the names the gate lists', same(full, rawNames), full.length + ' names');
ok('the full selection has node suites and page tests', nodeSuites(full).length > 50 && full.some((n) => !n.startsWith('node:')), nodeSuites(full).length + ' node suites, ' + (full.length - nodeSuites(full).length) + ' page tests');
ok('the selection has no junk lines (the gate\'s dark-page notice is not a test)', !full.some((n) => n.includes(' ')), 'first: ' + full[0]);
// 2. --only and --touched mean what they mean in the gate
const only = selected({ GATE_ONLY: 'node:options-registry' });
ok('GATE_ONLY selects exactly that one', same(only, ['node:options-registry']), JSON.stringify(only));
const exists = (n) => n.startsWith('node:') ? fs.existsSync(path.join(root, 'tests', n.slice(5) + '.js')) : fs.existsSync(path.join(root, 'tests', 'regress', n + '.js'));
const touched = selected({ GATE_TOUCHED: 'HEAD~1' });
ok('every selected test exists on disk (node suites and page tests alike)', full.every(exists) && touched.every(exists), full.length + ' names, ' + touched.length + ' touched');
// 3. a run reports pass and fail
const r1 = run(['tests/runner/node-suites.js'], { GATE_ONLY: 'node:options-registry' });
ok('the runner runs the selected suite and reports it', r1.code === 0 && /\bpass 1\b/.test(r1.out) && /\bfail 0\b/.test(r1.out), 'exit ' + r1.code + ' · ' + (r1.out.match(/[ℹ✔✖] (pass|fail) \d+/g) || []).join(' '));
// 4. an empty selection is a LOUD failure, not a vacuous pass (the gate refuses an empty plan: "the gate could not run")
const r2 = run(['tests/runner/node-suites.js'], { GATE_ONLY: 'node:no-such-suite' });
ok('an empty selection fails loudly instead of passing vacuously', r2.code !== 0 && /NOTHING SELECTED/.test(r2.out), 'exit ' + r2.code + ' · ' + (r2.out.match(/NOTHING SELECTED.*/) || [''])[0].slice(0, 90));
// 5. the fail-lines preload: the gate's [FAIL] convention must make the runner fail (node --test only sees the exit code)
const f = run(['--require', './tests/runner/fail-lines.js', 'tests/runner/fixtures/print.js', 'fail'], {});
ok('a [FAIL] line makes the runner fail (the gate counts those lines)', f.code !== 0, 'exit ' + f.code);
const g = run(['--require', './tests/runner/fail-lines.js', 'tests/runner/fixtures/print.js', 'ok'], {});
ok('a clean run stays green under the same preload', g.code === 0, 'exit ' + g.code);
// 6. the runner reads the gate's solo list from its source (it must not require the gate)
ok('the solo page list was read from tests/gate.js', PAGE_SOLO.length > 0 && PAGE_SOLO.includes('P1-drive-three'), PAGE_SOLO.join(' '));
// 7. the runner's paths resolve from __dirname, never from /workspace
const runnerFiles = fs.readdirSync(path.join(root, 'tests', 'runner')).filter((f) => f.endsWith('.js')).map((f) => path.join('tests', 'runner', f)).concat(['tests/runner-selftest.js']);
const absolute = runnerFiles.filter((f) => /['"`]\/workspace\//.test(fs.readFileSync(path.join(root, f), 'utf8')));
ok('no runner file hard-codes /workspace', absolute.length === 0, absolute.join(' '));
console.log(fails ? `\n${fails} of ${passes + fails} FAILED` : `\nall ${passes} runner checks passed`);
process.exit(fails ? 1 : 0);
