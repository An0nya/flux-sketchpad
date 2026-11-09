// Labels the Playwright adapter puts on the gate's page tests (Playwright tags; select with --grep / --grep-invert).
//   @solo  gate.js PAGE_SOLO: real-GPU or timing-sensitive, run with --workers=1 in a separate invocation (the gate runs them alone after the pool)
//   @gpu   needs a real GPU; meaningless on SwiftShader (gate.js sets P1_REAL_GPU=1 for P1)
//   @hash  compares a frame hash pinned on the owner's Mac GPU. SwiftShader rasterises differently, so these fail on CI by
//          construction until the tolerance comparison (another branch) lands; CI runs them in a non-blocking job meanwhile.
//          Found by: grep -lE "['\"][0-9a-f]{16,64}['\"]" tests/regress/*.js (a pinned hex digest literal) - re-run when that changes.
// PAGE_SOLO is read from tests/gate.js's SOURCE, not by requiring it: requiring the gate runs the gate (its main is not
// guarded) and the lander stages a patch with swarm's gate.js. If the gate's list changes, this parse follows it - the
// runner's own check (tests/runner-selftest.js) fails loudly if the parse finds nothing.
const fs = require('fs'), path = require('path');
const gateSrc = fs.readFileSync(path.join(__dirname, '..', 'gate.js'), 'utf8');
const solo = /const PAGE_SOLO = \[([^\]]*)\]/.exec(gateSrc);
const PAGE_SOLO = solo ? [...solo[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (!PAGE_SOLO.length) console.error('[warn] tests/runner/tags.js: PAGE_SOLO not found in tests/gate.js - the solo page tests would run in the parallel pool');
const HASH_PINNED = ['BJ1-shadow-cache', 'BJ2-halo-table-pin', 'CD-lampcone-depth', 'E2-crest-occlusion', 'E2-pass-lamp-cone', 'FG-fog', 'HB-high-dip-gpu', 'NE-near-eye', 'SC-beam-scatter', 'SD-scatter-table', 'TOUGE-AIR-RIBBON', 'TOUGE-AIR', 'TOUGE-HALO-TILT', 'TOUGE-SKY-VEIL', 'WT-wetness'];
const GPU_ONLY = ['P1-drive-three'];
const ENV = { 'P1-drive-three': { P1_REAL_GPU: '1' } };   // the per-test environment gate.js runOne() sets
function tagsFor(name) {
  const t = [];
  if (PAGE_SOLO.includes(name)) t.push('@solo');
  if (GPU_ONLY.includes(name)) t.push('@gpu');
  if (HASH_PINNED.includes(name)) t.push('@hash');
  return t;
}
module.exports = { PAGE_SOLO, HASH_PINNED, GPU_ONLY, ENV, tagsFor };
