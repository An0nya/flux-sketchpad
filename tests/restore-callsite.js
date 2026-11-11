// Wires the CALL SITE, not just the function, to the gameOptions restore invariant pin
// (tests/restore-options.js pins the contract; this pins that the app actually calls it
// on exit of an in-game session). Mirrors what an (M3) mutation deleting the call at the
// end-exit inside toggleGame() would otherwise slip past tests/restore-options.js.
// Node-only; no DOM, no GL, no browser.
const path = require('path'), fs = require('fs');
const { ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(String(detail)).slice(0, 140) : '')); if (!cond) fails++; };
const t = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');

// 1. count actual CALL sites (definition is excepted). The exact call text.
const CALLSITE = 'restoreOptions(info().o, st.gameSaved.options)';
const occurrences = [];
for (let i = t.indexOf(CALLSITE); i !== -1; i = t.indexOf(CALLSITE, i + 1)) occurrences.push(i);
ok('restoreOptions is called exactly once', occurrences.length === 1, occurrences.length);

// 2. the call is INSIDE the game-exit branch of toggleGame (after `st.gameMode` check)
if (occurrences.length) {
  const callAt = occurrences[0];
  const fn = t.indexOf('function toggleGame(ui) {');
  const branchAt = fn >= 0 ? t.indexOf('if (st.gameMode) {', fn) : -1;
  const exitDot = fn >= 0 ? t.indexOf('st.gameMode = false;', branchAt) : -1;
  ok('the exit call sits inside the st.gameMode branch', branchAt >= 0 && callAt > branchAt && callAt < exitDot, { callAt, branchAt, exitDot });
}

// 3. the exit branch also clears ui.dvBase after the call (so the saved-profile path returns to the normal base too)
const idx = occurrences.length ? t.indexOf(CALLSITE) : -1;
const tail = idx >= 0 ? t.slice(idx, idx + 120) : '';
ok('ui.dvBase = null follows the restore call', tail.indexOf('ui.dvBase = null') !== -1, tail.slice(0, 120));

// 4. Entry still snapshots via Object.assign (the other half. pair must be intact)
const entry = t.indexOf('{ options: Object.assign({}, info().o)');
ok('the entry snapshot (Object.assign into gameSaved) still exists', entry >= 0);

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
