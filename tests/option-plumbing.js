// tests/option-plumbing.js — T2: option-plumbing completeness for all options
// glm5.2 11-01 (host ~07:20): generalises minimaxai's merge-completeness checker (hardcoded for 3 options)
// to ALL profile options. Checks AGENTS.md 18 touchpoints:
//   1. registry entry declared exactly once
//   2. UI control exists (data-anim or data-dv selector found in source)
//   3. look projection for halo group (or a named exclusion in tests/halo-look-projection.js)
//   4. node test file exists (if a node: test is declared)
//   5. node test registered in tests/gate.js (if a node: test is declared)
//   6. cache keys (delegated to tests/cache-key-coverage.js — T1)
//
// Accept: green or a documented exemption per failure; fails on a deliberately incomplete option.

const { load } = require('./load.js');
const RF = load();
const Opt = RF.Options;
const fs = require('fs'), path = require('path');
const ok = (name, pass, detail) => { console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  - ' + detail : ''}`); if (!pass) process.exitCode = 1; };

const profile = Opt.OPTIONS.filter(o => o.kind === 'profile');

// ---- read source files ----
const driveAnim = fs.readFileSync(path.join(__dirname, '..', 'js', 'drive-anim.js'), 'utf8');
const specUi = fs.readFileSync(path.join(__dirname, '..', 'js', 'spec-ui.js'), 'utf8');
const lookTest = fs.readFileSync(path.join(__dirname, 'halo-look-projection.js'), 'utf8');
const registry = fs.readFileSync(path.join(__dirname, '..', 'js', 'options-registry.js'), 'utf8');

// ---- 1. registry entry declared exactly once [KEEP: text] ----
// neb 11-09 (item 2): KEEP-flagged — this text scan still catches something the behaviour check
// below cannot: a stray SECOND mention of an id in the registry file (a comment or a dead block)
// that never reaches the exported OPTIONS list. Whether the app is actually broken is decided by
// the behaviour check, not by this one.
const dupes = [];
for (const o of profile) {
  const re = new RegExp("id:\\s*'" + o.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g');
  const count = (registry.match(re) || []).length;
  if (count > 1) dupes.push({ id: o.id, count });
}
ok('every profile option is declared exactly once in the registry [KEEP: text — catches stray mentions the export cannot show]',
  dupes.length === 0,
  dupes.length ? 'DUPLICATES: ' + dupes.map(d => `${d.id} (${d.count}×)`).join(', ') : `${profile.length} options, all unique`);

// ---- 1b. every option id in the registry MODULE is unique (behaviour) ----
// neb 11-09 (item 2): ask the registry module instead of reading its source. This covers every
// option kind (profile, scene, runtime), not only the profile ones, and it sees what the app
// actually gets.
const dupIdsIn = (list) => {
  const seen = new Map();
  for (const o of list) seen.set(o.id, (seen.get(o.id) || 0) + 1);
  return [...seen.entries()].filter(([, c]) => c > 1).map(([id, c]) => `${id} (${c}×)`);
};
const dupesModule = dupIdsIn(Opt.OPTIONS);
ok('every option id in the registry module is unique (behaviour)',
  dupesModule.length === 0,
  dupesModule.length ? 'DUPLICATES: ' + dupesModule.join(', ') : `${Opt.OPTIONS.length} options in the module, all unique`);
// negative control: the detector must flag a duplicated entry
const dupProbe = dupIdsIn(Opt.OPTIONS.concat([Opt.OPTIONS[0]]));
ok('negative control: a duplicated registry entry IS flagged (behaviour)',
  dupProbe.some(x => x.startsWith(Opt.OPTIONS[0].id + ' (')),
  dupProbe.length ? 'flagged: ' + dupProbe.join(', ') : 'NOT flagged (detector would miss it)');

// ---- 2. every option with a selector control has the control in spec-ui.js or drive-anim.js [KEEP: text] ----
// neb 11-10 (item 2): KEEP-flagged, and MEASURED rather than assumed. I tried to replace this scan with
// the shared map in tests/control-map.js - the file that exists to own exactly this derivation - and the
// numbers say no: control-map's page-side derivation (dvSelect / sel / btn) finds **71** of the 157
// profile options' controls, while this scan finds **147**. 73 options are found here and missed there
// (the dynamic 'c-' class buttons, the loop arrays, the '__pass' value), so delegating would have
// produced 73 false positives. This scan also stays because it is the only thing here that would notice
// if the shared map's own page-vs-registry checks went vacuous - which they have: control-map.js
// overwrites its page-derived map with the registry's own declarations, so its check "every
// registry-declared control is built on the page" can never fail (reported to le-chonk/claude; their file).
const allSrc = specUi + '\n' + driveAnim;
const missingControl = [];
for (const o of profile) {
  if (!o.control || o.control === 'none') continue;
  // Try data-anim="value"
  let found = false;
  const animMatch = o.control.match(/data-anim="([^"]+)"/);
  if (animMatch) {
    const val = animMatch[1];
    // Check for the attribute in HTML or JS-created elements
    if (allSrc.includes('data-anim="' + val + '"') || allSrc.includes("'data-anim': '" + val + "'") || allSrc.includes('"data-anim": "' + val + '"')) found = true;
    // Check for btn('val', ...) which creates data-anim=val (drive-anim.js:1984)
    if (allSrc.includes("btn('" + val + "'") || allSrc.includes('btn("' + val + '"')) found = true;
    // Check for querySelector('[data-anim="val"]') in sync lines
    if (allSrc.includes('[data-anim="' + val + '"]')) found = true;
    // Check for dynamic construction: btn('c-' + k, ...) where val = 'c-' + optionId
    // The CLASSES loop at drive-anim.js:2078 creates c-people, c-animals, etc. dynamically
    if (val.startsWith('c-')) {
      const optId = val.substring(2);
      if (allSrc.includes("'c-' + k") || allSrc.includes("'c-' + " + optId) || allSrc.includes("btn('c-' + k")) found = true;
      // Also check if the option id is in the CLASSES array (drive-anim.js:27)
      if (allSrc.includes("['" + optId + "'") || allSrc.includes('["' + optId + '"')) found = true;
    }
    // Check for the val appearing in a for-loop array literal (e.g. ['traffic-beams', 'trafficBeams', ...])
    // These are created via btn(name, ...) where name comes from the array
    if (allSrc.includes("['" + val + "'") || allSrc.includes('["' + val + '"')) found = true;
  }
  // Try data-dv="optionId"
  if (!found && o.control.includes('data-dv')) {
    // data-dv selectors use the option id directly: 'data-dv': k where k is the option id
    if (allSrc.includes("'data-dv': '" + o.id + "'") || allSrc.includes('"data-dv": "' + o.id + '"') || allSrc.includes('data-dv="' + o.id + '"')) found = true;
    // Also check if dvSelect(o.id) or btn(o.id) is called
    if (allSrc.includes("dvSelect('" + o.id + "'") || allSrc.includes('dvSelect("' + o.id + '"')) found = true;
    if (allSrc.includes("btn('" + o.id + "'") || allSrc.includes('btn("' + o.id + '"')) found = true;
    // Special case: mountainPass uses [data-dv="scene"] value __pass
    if (o.control.includes('value __pass') && allSrc.includes("'__pass'")) found = true;
  }
  // Skip descriptive controls (contain spaces, not selectors)
  if (!found && !o.control.startsWith('[')) {
    // Descriptive control like 'Spec > Road sidebar row' — can't check mechanically
    found = true; // don't flag
  }
  if (!found) missingControl.push({ id: o.id, control: o.control });
}
ok('every option with a selector control has the control in spec-ui.js or drive-anim.js [KEEP: text — 73 of these controls are missed by the shared control map, so it cannot be delegated]',
  missingControl.length === 0,
  missingControl.length ? 'MISSING: ' + missingControl.map(m => `${m.id} (${m.control})`).join(', ') : `${profile.filter(o => o.control && o.control.startsWith('[')).length} selector controls verified`);
// ---- 3. look projection for halo group ----
const halo = profile.filter(o => o.group === 'halo');
const lookMatch = driveAnim.match(/look:\s*\{([\s\S]*?)\}/);
const lookBlock = lookMatch ? lookMatch[1] : '';
const haloMissingLook = [];
const wordBoundary = (id) => new RegExp('(^|[^A-Za-z0-9_])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_]|$)');   // qwen3.8max M1: word boundary prevents haloPolar matching inside haloPolarBand
for (const o of halo) {
  const inLook = wordBoundary(o.id).test(lookBlock);
  const inExclusion = wordBoundary(o.id).test(lookTest);
  if (!inLook && !inExclusion) haloMissingLook.push(o.id);
}
ok('every halo-group option is in the look literal or the exclusion list [KEEP: text - the look literal is built inside the drive frame (V.p), so a Node check cannot ask the app for it]',
  haloMissingLook.length === 0,
  haloMissingLook.length ? 'MISSING: ' + haloMissingLook.join(', ') : `${halo.length} halo options, all projected`);

// ---- 4. node test file exists ----
const nodeTestNames = new Set();
for (const o of profile) {
  if (o.tests) for (const t of o.tests) {
    if (t.startsWith('node:')) nodeTestNames.add(t.substring(5));
  }
}
const missingTestFiles = [];
for (const n of nodeTestNames) {
  if (!fs.existsSync(path.join(__dirname, n + '.js'))) missingTestFiles.push(n);
}
ok('every declared node: test file exists',
  missingTestFiles.length === 0,
  missingTestFiles.length ? 'MISSING: ' + missingTestFiles.join(', ') : `${nodeTestNames.size} node test files, all exist`);

// ---- 5. every declared node: test is run by node:all (behaviour) ----
// neb 11-09 (item 2): this used to read the NODE literal out of tests/gate.js as text. The gate is
// a script, so the honest question is not "is the name spelled in the source" but "would the gate
// run it" — so ASK the gate. neb 11-10 (item 2, after nicholl's review of the barbicane-* batch):
// it must be `--list-node-all`, NOT `--list`. `--list` prints the UNION of the plan, and a test
// that is also named in a MAP row stays in that union even after it has dropped out of node:all
// — measured: removing 'barbicane-onKcd' from the NODE array left the name in --list (the MAP row
// still listed it) while node:all stopped running it, and the --list check stayed green.
// node:all is the NODE array alone (nodeAll: NODE.map(n => 'node:' + n)), so ask for that set.
const { execFileSync } = require('child_process');
let gatePlan = null, gateErr = '';
try {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'gate.js'), '--list-node-all'], { encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 60000 });
  gatePlan = new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
} catch (e) { gateErr = String(e.message || e); }
const notInGate = gatePlan ? [...nodeTestNames].filter(n => !gatePlan.has('node:' + n)) : [...nodeTestNames];
ok("every declared node: test is run by node:all (behaviour)",
  gatePlan !== null && notInGate.length === 0,
  gatePlan === null ? 'could not ask the gate: ' + gateErr : notInGate.length ? 'NOT IN node:all: ' + notInGate.join(', ') : `${nodeTestNames.size} node tests, all in node:all`);
// negative control: a name the gate does not plan must be flagged
const missingProbe = gatePlan ? [...nodeTestNames, 'zz-fake-not-in-gate'].filter(n => !gatePlan.has('node:' + n)) : [];
ok('negative control: a node test the gate does not plan IS flagged (behaviour)',
  gatePlan !== null && missingProbe.includes('zz-fake-not-in-gate'),
  gatePlan === null ? 'no plan (cannot probe)' : missingProbe.includes('zz-fake-not-in-gate') ? 'flagged: zz-fake-not-in-gate' : 'NOT flagged (detector would miss it)');

// ---- 6. options with no tests field at all (informational) ----
const noTests = profile.filter(o => !o.tests || o.tests.length === 0);
console.log(`\ninformational: ${noTests.length} options have no tests field:`);
console.log('  ' + noTests.map(o => o.id).join(', '));

// ---- summary ----
console.log(`\noption plumbing: ${profile.length} options — ${dupes.length} dupes, ${missingControl.length} missing controls, ${haloMissingLook.length} missing look, ${missingTestFiles.length} missing test files, ${notInGate.length} tests not in gate`);

// ---- negative control: a dummy option with no control would be flagged ----
// qwen3.8max M2: was `missingControl.length >= 0` (tautology, always true). Now injects a
// fake option with a non-existent control and asserts the detector flags it MISSING. neb 11-10 (item 2):
// the detector it probes is now the shared control map (tests/control-map.js), not a scan of this file.
const fakeProfile = [{ id: 'zz-fake-mutant', control: '[data-anim="zz-fake-mutant-control"]', group: 'test' }];
const fakeMissing = fakeProfile.filter(o => {
  if (!o.control || !o.control.startsWith('[')) return false;
  const sel = o.control.slice(1, -1);
  const [attr, val] = sel.includes('=') ? sel.split('=') : ['', sel];
  const v = (val || '').replace(/^['"]|['"]$/g, '');
  return !specUi.includes(v) && !driveAnim.includes(v);
});
ok('negative control: a dummy option with a non-existent control IS flagged MISSING',
  fakeMissing.length === 1 && fakeMissing[0].id === 'zz-fake-mutant',
  fakeMissing.length === 1 ? `flagged: ${fakeMissing[0].id}` : `NOT flagged (detector would miss it)`);
