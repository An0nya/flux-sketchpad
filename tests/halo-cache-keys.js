// Halo-family cache-key detector (10-31, answering qwen's REVIEW-trafficMarkers.md §20.1): every registry option in
// the halo family must appear in the groundKey expression (js/spec-ui.js), which feeds BOTH picture-cache keys
// (the drive-anim picture key and the adaptation-cache key). A new halo option missing there would serve a stale
// cached still when toggled alone — per-option tests cannot notice that. Allow-list only legitimately table-only ids.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const entries = Array.isArray(Opt) ? Opt : (Opt.entries || Object.values(Opt.OPTIONS || Opt.options || Opt));
const family = entries.filter((e) => e.group === 'halo').map((e) => e.id);
const spec = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
const m = spec.match(/groundKey:\s*JSON\.stringify\((\[[\s\S]*?\])\),\s*toolbar/);
ok('groundKey expression found in spec-ui.js', !!m);
const expr = m ? m[1] : '';
// legitimately table-only (read at halo-table build time, not part of the cached-still key): none today — every
// halo-family option is in groundKey, which is what the two picture-cache keys embed.
const derived = new Set(entries.filter((e) => e.kind === 'derived').map((e) => e.id));   // derived ids are never stored; they write bundles of stored options that ARE keyed
const ALLOW = [...derived];
const animSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const km = animSrc.match(/const key = JSON\.stringify\((\[[\s\S]*?\])\),\s*tkey/);
const picKey = km ? km[1] : '';
const missing = family.filter((id) => !new RegExp('o\\.' + id + '\\b').test(expr) && !(id === 'trafficSubTick' && /\bSUBTICK\b/.test(picKey)) && !ALLOW.includes(id));
ok(`all ${family.length} halo-family options are in groundKey (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
ok('qwen 20.1 regression: haloMoment and haloWidthStep are in groundKey', /o\.haloMoment\b/.test(expr) && /o\.haloWidthStep\b/.test(expr));
ok('conditional refine pair (haloCrossingRefine/haloRefineNeighbour) carried in groundKey', /o\.haloCrossingRefine/.test(expr) && /o\.haloRefineNeighbour/.test(expr));
// the two picture-cache keys embed groundKey: drive-anim picture key + adaptation key
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('drive-anim picture key embeds I.groundKey', /const key = JSON\.stringify\(\[I\.groundKey/.test(anim));
ok('drive-anim adaptation-cache key embeds I.groundKey', /I\.groundKey \+ '\|'/.test(anim));
console.log(fail === 0 ? `\nall ${pass} halo-cache-keys checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
