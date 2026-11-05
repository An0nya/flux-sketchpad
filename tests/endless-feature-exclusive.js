// endlessTile: the seeded straight-tile features works / toll / vms are mutually exclusive (each block's '!t.<feature>' check must read
// a field already decided in the same call; vms used to be decided before toll and works, so it read undefined and could coincide).
// Pure node, no GPU. Also run on a custom preset that raises all three rates so overlaps would be common if the order regressed.
const path = require('path');
const { load } = require('./load.js');
const A = load(path.join(__dirname, '..')).DriveAnim;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const custom = A.parseCustomPreset ? A.parseCustomPreset(JSON.stringify({ works: 0.5, toll: 0.5, vms: 0.5 })) : null;
for (const [label, preset, cus] of [['default walk', 'off', null], ['custom works/toll/vms 0.5', 'custom', custom]]) {
  if (preset === 'custom' && !cus) { ok('parseCustomPreset is exported for the custom sweep', false); continue; }
  let both = [], seen = { works: 0, toll: 0, vms: 0 };
  for (let seed = 1; seed <= 60; seed++) for (let k = 0; k < 400; k++) {
    const t = A.endlessTile(seed, k, preset, cus), on = ['works', 'toll', 'vms'].filter((f) => t[f]);
    on.forEach((f) => seen[f]++);
    if (on.length > 1 && both.length < 5) both.push({ seed, k, on });
  }
  ok(label + ': works, toll and vms never share a tile', both.length === 0, both);
  ok(label + ': each feature still occurs', seen.works > 0 && seen.vms > 0 && (preset === 'custom' ? seen.toll > 0 : true), seen);
}
console.log(fail ? fail + ' FAILED' : 'all ' + pass + ' endless feature-exclusivity checks passed');
process.exit(fail ? 1 : 0);
