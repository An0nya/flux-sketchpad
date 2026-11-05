// barbicane (11-05, cyrus assignment) — option-coverage: node-level coverage check for options with no named test.
// Reports every option whose tests:[] is empty, categorised by kind, and checks that each profile option
// has at least one consumer in the js/ source files (outside the registry).
// PASSes when zero profile options are unreferenced; FAILs with specifics otherwise.
// The uncovered-count output is informational (does not fail the gate) — it helps prioritise what to test next.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));

// --- collect all js/ source text (exclude the registry itself and tests/)
const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
let allSource = '';
const fileContents = {};
for (const f of jsFiles) {
  const content = fs.readFileSync(path.join(jsDir, f), 'utf8');
  fileContents[f] = content;
  if (f !== 'options-registry.js') allSource += content + '\n';
}

// --- helpers
const consumerPatterns = (id) => [
  new RegExp("'" + id + "'"),        // string literal 'optionId'
  new RegExp('"' + id + '"'),        // string literal "optionId"
  new RegExp('\\bo\\.' + id + '\\b'),  // o.optionId
  new RegExp('\\blook\\.' + id + '\\b'), // look.optionId
  new RegExp('\\bI\\.' + id + '\\b'),   // I.optionId
  new RegExp('\\bV\\.p\\.' + id + '\\b'), // V.p.optionId
  new RegExp('\\b' + id + '\\s*[=:,]'),  // optionId = or : or ,
];

// --- 1. List all options with no named test
const untested = Opt.OPTIONS.filter(o => !o.tests || !o.tests.length);
const byKind = {};
for (const o of untested) {
  byKind[o.kind] = (byKind[o.kind] || 0) + 1;
}
console.log('--- Coverage report ---');
console.log('Total options:', Opt.OPTIONS.length);
console.log('Options with no named test:', untested.length, '(' + Object.entries(byKind).map(([k, v]) => k + ': ' + v).join(', ') + ')');

// List them by kind
for (const kind of ['profile', 'extra', 'derived', 'session', 'game']) {
  const opts = untested.filter(o => o.kind === kind);
  if (opts.length) {
    console.log('\n' + kind + ' (' + opts.length + '):');
    for (const o of opts) {
      console.log('  ' + o.id + (o.group ? ' — group: ' + o.group : ''));
    }
  }
}

// --- 2. For every profile option with no test, verify it has a consumer
let deadCount = 0;
const deadOptions = [];
for (const o of Opt.OPTIONS.filter(o => o.kind === 'profile')) {
  // Look for the option id in the source (string literal or property access pattern)
  let found = false;
  for (const [fname, content] of Object.entries(fileContents)) {
    if (fname === 'options-registry.js') continue;
    for (const pat of consumerPatterns(o.id)) {
      if (pat.test(content)) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) {
    deadCount++;
    deadOptions.push(o.id);
  }
}
ok('profile options with at least one consumer in js/ (outside registry): ' + (Opt.OPTIONS.filter(o => o.kind === 'profile').length - deadCount) + ' of ' + Opt.OPTIONS.filter(o => o.kind === 'profile').length,
    deadCount === 0, deadCount ? 'DEAD (no consumer in js/): ' + deadOptions.join(', ') : undefined);

// --- 3. Verify that options WITH tests have valid test names
// Build a set of known test file basenames and valid gate entries
const testsDir = path.join(ROOT, 'tests');
const regressDir = path.join(ROOT, 'tests/regress');
const knownFiles = new Set();
if (fs.existsSync(testsDir)) {
  fs.readdirSync(testsDir).filter(f => f.endsWith('.js')).forEach(f => knownFiles.add(path.basename(f, '.js')));
}
if (fs.existsSync(regressDir)) {
  fs.readdirSync(regressDir).filter(f => f.endsWith('.js')).forEach(f => knownFiles.add(path.basename(f, '.js')));
}

// Read gate.js for known group/node names
const gateSrc = fs.existsSync(path.join(ROOT, 'tests/gate.js')) ? fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8') : '';
const knownGateNames = new Set();
const nodeMatch = gateSrc.match(/const NODE\s*=\s*\[([\s\S]*?)\];/);
if (nodeMatch) {
  const names = nodeMatch[1].match(/'([^']+)'/g);
  if (names) names.forEach(s => knownGateNames.add(s.slice(1, -1)));
}
// Also collect PAGE_SOLO names
const pageMatch = gateSrc.match(/const PAGE_SOLO\s*=\s*new Set\(\[([\s\S]*?)\]\);/);
if (pageMatch) {
  const names = pageMatch[1].match(/'([^']+)'/g);
  if (names) names.forEach(s => knownGateNames.add(s.slice(1, -1)));
}

let badTestRefs = 0;
const badRefs = [];
for (const o of Opt.OPTIONS) {
  for (const t of (o.tests || [])) {
    // Skip group refs like 'node:all', 'node:some-group', 'page:some-group'
    if (t.startsWith('node:') || t.startsWith('page:')) {
      // Check the group/base name exists in gate
      const baseName = t.includes(':') ? t.split(':')[1] : t;
      if (!knownGateNames.has(baseName) && !knownFiles.has(baseName) && baseName !== 'all') {
        badTestRefs++;
        badRefs.push(o.id + ' -> ' + t);
      }
      continue;
    }
    // Bare name: must be a known test file or gate entry
    if (!knownFiles.has(t) && !knownGateNames.has(t)) {
      badTestRefs++;
      badRefs.push(o.id + ' -> ' + t);
    }
  }
}
ok('test names resolve to known files or gate entries: ' + (badRefs.length === 0 ? 'all ok' : badRefs.length + ' unresolved'),
    badRefs.length === 0, badRefs.length ? badRefs.join(', ') : undefined);

// --- 4. Summary
const testedCount = Opt.OPTIONS.length - untested.length;
console.log('\n--- Summary ---');
console.log('Options with at least one named test:', testedCount, 'of', Opt.OPTIONS.length);
console.log('Untested options:', untested.length);
console.log('Dead (unreferenced) profile options:', deadCount);
if (deadCount) console.log('  DEAD:', deadOptions.join(', '));
console.log('Bad test references:', badRefs.length);
if (badRefs.length) console.log('  BAD:', badRefs.join(', '));

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);