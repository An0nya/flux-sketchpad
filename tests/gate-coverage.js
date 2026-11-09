// GATE COVERAGE (neb, 11-09): the suites the gate selects must still cover the suites that depend on the gate.
//   node tests/gate-coverage.js
// Layer B (HARD): every suite in tests/runner/protected-suites.txt must be in the gate's RESOLVED set - the set a full gate
//   actually runs. The protected list names the gate's own infrastructure, which no option registry declares, so nothing else
//   would notice its loss. That is the 37ab class: 'runner-selftest' was dropped from NODE and the gate stayed green.
// Layer A (REPORTED, not failed): every node suite the option registry DECLARES must be in the resolved set too. It is only
//   reported because the swarm's real pattern includes SPLIT patches - the registry entry lands in one commit and the gate's
//   NODE entry in a later one (frenchie's own 0ed3/37ab pair did exactly that) - and in that state a declared suite that no
//   gate set selects yet is legitimate, not a defect. Failing there would refuse a legitimate patch, and any lander regression
//   would turn the check into a false refusal. So this is a loud, counted report, and the lander-side assert (claude's spec)
//   stays the hard check. (The lander used to replace the patch's tests/gate.js with swarm's; claude's 08:06Z fix made it run
//   the patch's own gate.js, so the split-patch case is the reason that survives.)
// The basis is the RESOLVED set, never the NODE literal: the MAP contributes suites the literal does not name
//   (drive-controls2, scenario-node, minigame, minigame-2, game-curves), so a literal parse would false-incident on all five.
// This suite never requires tests/gate.js: requiring the gate RUNS the gate (its main is not guarded). It asks the gate
//   through its CLI (--list), exactly as tests/runner/select.js does for the runner.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { selected, nodeSuites } = require('./runner/select.js');
let fails = 0, passes = 0;
const ok = (m, c, d) => { if (c) { passes++; console.log('[PASS] ' + m + (d ? ' — ' + d : '')); } else { fails++; console.log('[FAIL] ' + m + (d ? ' — ' + d : '')); } };
const resolved = new Set(nodeSuites(selected({})));
// Layer B: the protected list
const protectedFile = path.join(__dirname, 'runner', 'protected-suites.txt');
const protectedText = fs.existsSync(protectedFile) ? fs.readFileSync(protectedFile, 'utf8') : '';
const protectedSuites = protectedText.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
ok('the protected list exists and is not empty', protectedSuites.length > 0, protectedSuites.length + ' suites');
const missingProtected = protectedSuites.filter((s) => !resolved.has(s));
ok('every protected suite is selected by the gate', missingProtected.length === 0, missingProtected.join(' ') || (protectedSuites.length + ' protected, all selected'));
const missingFiles = protectedSuites.filter((s) => !fs.existsSync(path.join(root, 'tests', s + '.js')));
ok('every protected suite has its file on disk', missingFiles.length === 0, missingFiles.join(' '));
// Layer A: the registry-declared suites - reported, not failed (see the header)
const Opt = require(path.join(root, 'js', 'options-registry.js'));
const declared = new Map();
for (const e of Opt.OPTIONS) for (const t of e.tests || []) if (t.startsWith('node:')) {
  const s = t.slice(5);
  if (!declared.has(s)) declared.set(s, []);
  if (!declared.get(s).includes(e.id)) declared.get(s).push(e.id);
}
ok('the option registry declares node suites', declared.size > 50, declared.size + ' declared');
const missingDeclared = [...declared].filter(([s]) => !resolved.has(s));
if (missingDeclared.length) console.log('[REPORT] registry-declared node suites that no gate set selects: ' + missingDeclared.length + ' of ' + declared.size + ' — ' + missingDeclared.map(([s, ids]) => s + ' (' + ids.join(',') + ')').join(', '));
else console.log('[REPORT] registry-declared node suites: all ' + declared.size + ' of ' + declared.size + ' are selected by the gate');
console.log(fails ? `\n${fails} of ${passes + fails} FAILED` : `\nall ${passes} gate-coverage checks passed`);
process.exit(fails ? 1 : 0);
