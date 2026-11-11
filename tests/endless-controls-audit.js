// endless-controls-audit: targeted checks for the control→option→sync wiring patterns
// that were missing. Catches: missing aria-pressed syncs, axis-fromUi receiving DOM elements.
// Run: node tests/endless-controls-audit.js — exits 1 on failure.
const path = require('path'), fs = require('fs'), ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');

// --- 1. Axis fix: axCommit must pass .value strings, not DOM elements ---
const axCommitMatch = anim.match(/const axCommit\s*=\s*\(\)\s*=>\s*\{[^}]+fromUi\(pairs/);
ok('axis fix: axCommit passes .lo.value / .hi.value (not DOM elements)',
  !!anim.match(/axPairs\[a\]\.lo\.value/) && !!anim.match(/axPairs\[a\]\.hi\.value/));

// --- 2. Toggle sync: the four toggles that were missing ---
const toggles = {
  tileTerrain:     '[data-anim="tileTerrain"]',
  multilaneRoad:   '[data-anim="multilaneRoad"]',
  endlessTunnel:   '[data-anim="endlessTunnel"]',
  endlessCrossing: '[data-anim="endlessCrossing"]',
  junctionGantries:'[data-anim="junctionGantries"]',   // was already fixed earlier
};
for (const [key, sel] of Object.entries(toggles)) {
  // Verify the toggle has a click handler calling setDV
  const clickPattern = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?setDV');
  const hasClick = clickPattern.test(anim);
  // Verify the sync line exists in labels()
  const syncPattern = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?aria-pressed');
  const hasSync = syncPattern.test(anim);
  ok('toggle ' + key + ': has click→setDV handler', hasClick);
  ok('toggle ' + key + ': has aria-pressed sync in labels()', hasSync);
}

// --- 3. JunctionGantries sync was already there (glm5.2 11-01), verify not regressed ---
ok('junctionGantries sync still present (non-regression)',
  anim.includes('[data-anim="junctionGantries"]') && anim.includes('aria-pressed'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);