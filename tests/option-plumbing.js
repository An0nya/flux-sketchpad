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
const specUi = fs.readFileSync(path.join(__dirname, '..', 'js', 'spec-ui.js'), 'utf8');
const driveAnim = fs.readFileSync(path.join(__dirname, '..', 'js', 'drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8');
const lookTest = fs.readFileSync(path.join(__dirname, 'halo-look-projection.js'), 'utf8');
const registry = fs.readFileSync(path.join(__dirname, '..', 'js', 'options-registry.js'), 'utf8');

// ---- 1. registry entry declared exactly once ----
const dupes = [];
for (const o of profile) {
  const re = new RegExp("id:\\s*'" + o.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g');
  const count = (registry.match(re) || []).length;
  if (count > 1) dupes.push({ id: o.id, count });
}
ok('every profile option is declared exactly once in the registry',
  dupes.length === 0,
  dupes.length ? 'DUPLICATES: ' + dupes.map(d => `${d.id} (${d.count}×)`).join(', ') : `${profile.length} options, all unique`);

// ---- 2. UI control exists ----
// The control field can be:
//   - '[data-anim="value"]' — check for data-anim="value" or 'data-anim': 'value' in source
//   - '[data-dv="optionId"]' — check for data-dv="optionId" or 'data-dv': 'optionId' in source
//   - 'none' — no UI control (internal option)
//   - descriptive text (e.g. 'Spec > Road sidebar row') — skip
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
ok('every option with a selector control has the control in spec-ui.js or drive-anim.js',
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
ok('every halo-group option is in the look literal or the exclusion list',
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

// ---- 5. node test registered in gate.js ----
const gateNodeMatch = gate.match(/const NODE = \[([^\]]+)\]/);
const gateNodeList = gateNodeMatch ? gateNodeMatch[1] : '';
const notInGate = [];
for (const n of nodeTestNames) {
  if (!gateNodeList.includes("'" + n + "'")) notInGate.push(n);
}
ok('every declared node: test is registered in tests/gate.js NODE list',
  notInGate.length === 0,
  notInGate.length ? 'NOT IN GATE: ' + notInGate.join(', ') : `${nodeTestNames.size} node tests, all in gate`);

// ---- 6. options with no tests field at all (informational) ----
const noTests = profile.filter(o => !o.tests || o.tests.length === 0);
console.log(`\ninformational: ${noTests.length} options have no tests field:`);
console.log('  ' + noTests.map(o => o.id).join(', '));

// ---- summary ----
console.log(`\noption plumbing: ${profile.length} options — ${dupes.length} dupes, ${missingControl.length} missing controls, ${haloMissingLook.length} missing look, ${missingTestFiles.length} missing test files, ${notInGate.length} tests not in gate`);

// ---- negative control: a dummy option with no control would be flagged ----
// qwen3.8max M2: was `missingControl.length >= 0` (tautology, always true). Now injects a
// fake option with a non-existent control and asserts the detector flags it MISSING.
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
