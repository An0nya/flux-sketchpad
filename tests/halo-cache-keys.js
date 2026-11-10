// tests/halo-cache-keys.js — B3: declaration-based halo-cache-key checks
// Reads the recipe declarations (cacheDefs) and verifies that every halo-family
// option appears in both stillFrame and ground recipes.
// Absorbed from the old source-code-parsing version — now reads the metadata.

const { load } = require('./load.js');
const RF = load();
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };

const cacheDefs = RF.Options.cacheDefs;
if (!cacheDefs) { console.log('[FAIL] RF.Options.cacheDefs not found — is cache-keys.js loaded?'); process.exit(1); }

// Get halo-family profile option ids from registry (derived/extra options are compound controls, not in cache keys)
const haloOpts = RF.Options.OPTIONS.filter(o => o.group === 'halo' && o.kind === 'profile').map(o => o.id);
// Exempt: options read from V.p.look each frame, not from a cached resource
const HALO_EXEMPT = { trafficSubTick: 'read from V.p.look each frame (trafficSubTick: o.trafficSubTick === on)' };
const haloCheck = haloOpts.filter(id => !HALO_EXEMPT[id]);
ok(haloOpts.length + ' halo-family profile options, ' + Object.keys(HALO_EXEMPT).length + ' exempt from cache keys', true);
ok(haloOpts.length + ' halo-family options in registry', haloOpts.length > 0, 'group=halo: ' + haloOpts.join(', '));

// Get option ids from stillFrame and ground recipes
const optionMap = RF.Options.cacheOptionMap ? RF.Options.cacheOptionMap() : {};
const stillOpts = new Set(optionMap.stillFrame || []);
const groundOpts = new Set(optionMap.ground || []);

// Check each halo option is in both recipes
const missingStill = haloCheck.filter(id => !stillOpts.has(id));
const missingGround = haloCheck.filter(id => !groundOpts.has(id));

ok(`all ${haloCheck.length} halo options in stillFrame recipe (missing: ${missingStill.join(', ') || 'none'})`,
  missingStill.length === 0);
ok(`all ${haloCheck.length} halo options in ground recipe (missing: ${missingGround.join(', ') || 'none'})`,
  missingGround.length === 0);

// Specific checks
const stillHas = (id) => stillOpts.has(id);
ok('frenchie wetBounce: wetBounce in both stillFrame and ground recipes', stillHas('wetBounce') && new Set(groundOpts).has('wetBounce'));
ok('qwen 20.1 regression: haloMoment and haloWidthStep in both recipes', stillHas('haloMoment') && stillHas('haloWidthStep') && new Set(groundOpts).has('haloMoment') && new Set(groundOpts).has('haloWidthStep'));
ok('conditional refine pair in both recipes', stillHas('haloCrossingRefine') && stillHas('haloRefineNeighbour') && new Set(groundOpts).has('haloCrossingRefine') && new Set(groundOpts).has('haloRefineNeighbour'));

console.log(fail === 0 ? `\nall ${pass} halo-cache-keys checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);