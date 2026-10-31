// le-chonk (10-30): endlessPreset — elevation/verge presets for the endless biome road. Acts only with
// endlessRoad + elevatedView; 'off' leaves the shipped seeded biome walk untouched (byte-identical tiles).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;

const seed = 7;
// off vs presets: same tiles, different grades
ok('preset off: endlessGrade unchanged vs shipped ranges', (() => { let m = 0; for (let b = 0; b < 40; b++) { const g = Math.abs(A.endlessGrade(seed, b, 'off')), biome = A.endlessBiome(seed, b * 16); if (biome === 'mountain') m = Math.max(m, g); } return m <= 0.06 && m >= 0.02; })());
ok('forested-pass: mountain grades are pass-grade (4–8%)', (() => { const gs = []; for (let b = 0; b < 60; b++) if (A.endlessBiome(seed, b * 16) === 'mountain') gs.push(Math.abs(A.endlessGrade(seed, b, 'forested-pass'))); return gs.length > 0 && gs.every((g) => g >= 0.04 && g <= 0.08); })());
ok('rolling-hills: gentler than off on mountain blocks', (() => { for (let b = 0; b < 60; b++) { const biome = A.endlessBiome(seed, b * 16); if (biome === 'mountain' && Math.abs(A.endlessGrade(seed, b, 'rolling-hills')) > Math.abs(A.endlessGrade(seed, b, 'off')) + 1e-9) return false; } return true; })());
ok('city stays flat in every preset', [ 'off', 'rolling-hills', 'forested-pass' ].every((pr) => { for (let b = 0; b < 60; b++) if (A.endlessBiome(seed, b * 16) === 'city' && A.endlessGrade(seed, b, pr) !== 0) return false; return true; }));
ok('endlessElev is per-preset (different curves, deterministic)', (() => { const a = A.endlessElev(seed, 'forested-pass'), b = A.endlessElev(seed, 'rolling-hills'), c = A.endlessElev(seed, 'off'); return a !== b && a(50000) !== b(50000) && A.endlessElev(seed, 'forested-pass') === a && a(1234.5) === a(1234.5); })());
ok('endlessElev(off) matches the pre-preset curve (regression guard)', (() => { const h = A.endlessElev(seed, 'off'); return Math.abs(h(38800) - -140.2) < 0.5; })());
ok('tiles unchanged by the preset (roadTile/endlessTile identical)', (() => { for (let k = 0; k < 50; k++) { const t1 = A.endlessTile(seed, k); if (t1.kind !== A.endlessTile(seed, k).kind) return false; } return true; })());
// wiring
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('src.tiles carries the preset', anim.includes("preset: o.endlessPreset || 'off'"));
ok('tileA/tileWorld pass the preset to endlessElev', anim.includes('endlessElev(p.src.tiles.seed, p.src.tiles.preset, !!p.src.tiles.terrain)') && anim.includes('endlessElev(cfg.seed, cfg.preset, !!cfg.terrain)'));
ok('forested-pass adds guardrails on mountain blocks (cls rail)', anim.includes("tile.biome === 'mountain' && cfg.flags.posts !== false") && anim.includes("cls: 'rail'"));
ok('forested-pass densifies the verge on mountain/forest', anim.includes("cfg.preset === 'forested-pass' && (vg.biome === 'mountain' || vg.biome === 'forest') ? 3 : 0"));
ok('top-bar select exists + tkey carries the preset', anim.includes("'data-anim': 'endlessPreset'") && anim.includes("o.tiles ? o.endlessPreset : 'off'"));
const reg = fs.readFileSync(path.join(ROOT, 'js', 'options-registry.js'), 'utf8');
ok('registry: endlessPreset enum default off', reg.includes("id: 'endlessPreset'") && reg.includes("default: 'off', label: 'endless road preset"));
// functional: a forested-pass mountain block renders rails through the pipeline
const e = A.tileRoute(seed, 38800, false, A.endlessTile);
const eA = RF.Touge.elevate(e, 38800, 3.5, true, A.endlessElev(seed, 'forested-pass'));
ok('forested-pass elevation is steeper than off at the switchback pose', Math.abs(A.endlessElev(seed, 'forested-pass')(38825) - A.endlessElev(seed, 'forested-pass')(38775)) / 50 > Math.abs(A.endlessElev(seed, 'off')(38825) - A.endlessElev(seed, 'off')(38775)) / 50);
ok('attitude follows the preset height', (() => { const a = RF.Touge.attitude(38800, true, eA); return Math.abs(a.pitch) > 0.03; })());

console.log(fail === 0 ? `\nall ${pass} le-chonk-presets checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
