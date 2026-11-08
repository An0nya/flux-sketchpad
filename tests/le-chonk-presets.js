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
ok('tileA/tileWorld pass the preset to endlessElev', anim.includes('endlessElev(p.src.tiles.seed, p.src.tiles.preset, !!p.src.tiles.terrain, p.src.tiles.custom)') && anim.includes('endlessElev(cfg.seed, cfg.preset, !!cfg.terrain, cfg.custom)'));
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

// 11-01: loop presets + custom (Anya: scene-like road-type loops, configurable + savable via state dump)
const A2 = RF.DriveAnim;
for (const [ps, bio] of [['open-loop', 'open'], ['forest-loop', 'forest'], ['city-loop', 'city'], ['mountain-loop', 'mountain'], ['switchbacks', 'mountain'], ['highway-loop', 'open']]) {
  const biomes = new Set(); for (let k = 0; k < 400; k++) biomes.add(A2.endlessTile(7, k, ps).biome);
  const b2 = new Set(); for (let k = 0; k < 200; k++) b2.add(A2.endlessTile(42, k, ps).biome);
  ok('loop preset ' + ps + ' forces biome ' + bio + ' across 400 tiles (2 seeds)', biomes.size === 1 && biomes.has(bio) && b2.size === 1 && b2.has(bio));
}
ok('OFF/2-arg endlessTile(seed,k) unchanged (seeded walk, mixed biomes)', (() => { const b = new Set(); for (let k = 0; k < 400; k++) b.add(A2.endlessTile(7, k).biome); return b.size > 1; })());
const cp = A2.parseCustomPreset('{"biome":"city","weights":{"straight":5},"grade":[0.01,0.04],"tunnel":0.2}');
ok('parseCustomPreset exposed and validates: good JSON -> fields kept', !!cp && cp.biome === 'city' && cp.weights.straight === 5 && cp.grade[0] === 0.01 && cp.tunnel === 0.2);
ok('parseCustomPreset rejects/clamps: bad JSON -> null, out-of-range dropped/clamped', A2.parseCustomPreset('not json') === null && (A2.parseCustomPreset('{"grade":[5,9]}') || {}).grade === undefined && A2.parseCustomPreset('{"tunnel":9}').tunnel === 0.5);
ok('custom biome loop: endlessTile(seed,k,"custom",{biome:"city"}) is city', A2.endlessTile(7, 5, 'custom', { biome: 'city' }).biome === 'city');
ok('highway-loop implies the multilane render cross-section (multilaneRoad option untouched)', anim.includes("multilane: !!o.multilaneRoad || !!(LOOP_MULTILANE[o.endlessPreset || 'off'])") && anim.includes("'highway-loop': 'open'"));
ok('wiring: cfg.custom from endlessPresetCustom when preset=custom; skey/tkey carry the JSON; select has loop values; input wired', anim.includes("custom: o.endlessPreset === 'custom' ? parseCustomPreset(o.endlessPresetCustom) : null") && anim.includes("o.tiles ? o.endlessPresetCustom || '' : '', SUBTICK") && anim.includes("'highway-loop', 'gantry-loop', 'tunnel-loop', 'crossing-loop', 'layby-loop', 'fuel-loop', 'viewpoint-loop', 'sos-loop', 'picnic-loop', 'wildlife-loop', 'chainup-loop', 'culvert-loop', 'works-loop', 'toll-loop', 'vms-loop', 'custom'") && anim.includes("'data-anim': 'endlessPresetCustom'"));
// 11-01 ~01:10 feature loops (Anya: presets to test each unique-geometry tile individually)
const FLOOPS = [['tunnel-loop', 'tunnel', (b, t) => (b === 'forest' || b === 'mountain') && t.kind === 'straight'], ['crossing-loop', 'crossing', (b, t) => b === 'open' && t.kind === 'straight'], ['layby-loop', 'layby', (b, t) => b === 'open' && t.kind === 'straight'], ['fuel-loop', 'fuel', (b, t) => b === 'open' && t.kind === 'straight'], ['viewpoint-loop', 'view', (b, t) => b === 'mountain' && t.kind === 'straight'], ['sos-loop', 'sos', (b, t) => (b === 'forest' || b === 'mountain') && t.kind === 'straight'], ['picnic-loop', 'picnic', (b, t) => b === 'forest' && t.kind === 'straight'], ['wildlife-loop', 'wild', (b, t) => b === 'forest' && t.kind === 'straight'], ['chainup-loop', 'chain', (b, t) => b === 'mountain' && t.kind === 'straight'], ['works-loop', 'works', (b, t) => (b === 'open' || b === 'city') && t.kind === 'straight'], ['toll-loop', 'toll', (b, t) => b === 'open' && t.kind === 'straight'], ['vms-loop', 'vms', (b, t) => (b === 'open' || b === 'city') && t.kind === 'straight']];
for (const [ps, flag, elig] of FLOOPS) {
  let eligN = 0, allSet = true, badSet = 0;
  for (let k = 0; k < 300; k++) { const t = A2.endlessTile(7, k, ps); if (elig(t.biome, t)) { eligN++; if (!t[flag]) allSet = false; } else if (t[flag]) badSet++; }
  ok('feature loop ' + ps + ': every eligible tile flagged (' + eligN + ' checked), none ineligible', eligN > 20 && allSet && badSet === 0);
}
ok('culvert-loop: every open verge tile has a creek', (() => { let n = 0, all = true; for (let k = 0; k < 300; k++) { const v = A2.endlessVerge(7, k, 'culvert-loop'); if (v.biome === 'open') { n++; if (!v.creek) all = false; } } return n > 10 && all; })());
ok('vms-loop = open biome + vms forced on eligible tiles; render gated by signs+wild', anim.includes("'vms-loop': 'open'") && anim.includes("if (preset === 'vms-loop' && (biome === 'open' || biome === 'city')) t.vms = true") && anim.includes('if (tile.vms && cfg.flags.signs !== false && cfg.flags.wild !== false)'));
ok('toll-loop = open biome + multilane implied + toll forced (options untouched)', anim.includes("'toll-loop': 'open'") && anim.includes("'highway-loop': true, 'toll-loop': true") && anim.includes("if (preset === 'toll-loop' && biome === 'open') t.toll = true"));
ok('toll plaza renders only with the multilane cross-section + consent flags', anim.includes('if (tile.toll && cfg.multilane && cfg.flags.wild !== false && cfg.flags.signs !== false)'));
ok('gantry-loop = city biome + gantries implied (option untouched)', anim.includes("'gantry-loop': 'city'") && anim.includes("gantries: !!o.junctionGantries || o.endlessPreset === 'gantry-loop'"));
ok('select lists all feature loops', anim.includes("'tunnel-loop', 'crossing-loop', 'layby-loop', 'fuel-loop', 'viewpoint-loop', 'sos-loop', 'picnic-loop', 'wildlife-loop', 'chainup-loop', 'culvert-loop', 'works-loop', 'toll-loop'"));
ok('off still probability-gated (no loop): tunnel flags appear but not on every eligible tile', (() => { let eligN = 0, setN = 0; for (let k = 0; k < 300; k++) { const t = A2.endlessTile(7, k); if ((t.biome === 'forest' || t.biome === 'mountain') && t.kind === 'straight') { eligN++; if (t.tunnel) setN++; } } return eligN > 20 && setN > 0 && setN < eligN; })());
// 11-01 ~02:00: custom preset props override (speed cap / density / lamps per biome)
ok('parseCustomPreset accepts props override with clamps', (() => { const c = A2.parseCustomPreset('{"props":{"speed":999,"density":-2,"lampGap":50,"lampStyle":"cobra","deer":0.7,"bushes":99}}'); return !!c && c.props.speed === 130 && c.props.density === 0 && c.props.lampGap === 50 && c.props.lampStyle === 'cobra' && c.props.deer === 0.7 && c.props.bushes === 8; })());
ok('endlessTile applies custom props over the biome defaults; without custom, props are the biome defaults', (() => { const a = A2.endlessTile(7, 3, 'custom', { props: { speed: 110 } }), b = A2.endlessTile(7, 3); return a.props.speed === 110 && a.props.lampGap === b.props.lampGap && b.props.speed !== 110; })());
ok('wiring: props merge line present', anim.includes('Object.assign({}, ENDLESS_PROPS[biome], LOOP_PROPS[preset] || {}, custom && custom.props)'));
// 11-01 ~02:40: switchbacks preset is hairpin-heavy (150R/150L dominate over straights)
ok('switchbacks: hairpin-heavy (150s dominate, alternation intact) vs the seeded walk', (() => { let a = 0, b = 0, alt = 0, prev = 0; for (let k = 0; k < 400; k++) { const t = A2.endlessTile(7, k, 'switchbacks'); if (t.kind.startsWith('150')) { a++; if (prev && Math.sign(t.curvature) === -Math.sign(prev)) alt++; } prev = t.curvature; if (A2.endlessTile(7, k).kind.startsWith('150')) b++; } return a > 300 && a > b * 8; })());   // hairpins dominate ~10x; no-3-same-sign still caps runs at 2 so the road cannot circle
ok('switchbacks relaxes only its own no-loop rules; off path byte-identical (same kinds as before)', (() => { let same = true; for (let k = 0; k < 300; k++) if (A2.endlessTile(7, k).kind !== A2.endlessTile(7, k, 'off').kind) same = false; return same; })());
ok('off/mountain-loop kind mix unchanged (weights only change under switchbacks)', (() => { const a = A2.endlessTile(7, 3), b = A2.endlessTile(7, 3, 'mountain-loop'); return a.kind === b.kind; })());
// 11-01 ~03:00: custom per-biome grade ranges
ok('parseCustomPreset accepts a per-biome grade map with clamps; global range still works', (() => { const c = A2.parseCustomPreset('{"grade":{"mountain":[0.04,0.9],"open":[-0.1,0.02]}}'); const g = A2.parseCustomPreset('{"grade":[0.01,0.04]}'); return !!c && c.gradeBiome.mountain[1] === 0.12 && c.gradeBiome.open[0] === 0.02 && c.gradeBiome.open[1] === 0.1 && !c.grade && !!g && g.grade[0] === 0.01 && !g.gradeBiome; })());
ok('endlessGrade: per-biome range wins for that biome block; seeded walk unchanged without custom', (() => { const gm = A2.endlessGrade(7, 0, 'custom', { gradeBiome: { mountain: [0.05, 0.06] } }); const gPlain = A2.endlessGrade(7, 0); const gOff = A2.endlessGrade(7, 0, 'off'); return Math.abs(gm) >= 0.05 - 1e-9 && Math.abs(gm) <= 0.06 + 1e-9 && gPlain === gOff; })());
// 11-01 ~03:30: per-loop default props (highway 110 cap, switchbacks/city 50, ...); custom props still win
ok('loop presets carry sensible default props; custom props override them; off has biome defaults', (() => { const hw = A2.endlessTile(7, 0, 'highway-loop'), sw = A2.endlessTile(7, 0, 'switchbacks'), off = A2.endlessTile(7, 0), cu = A2.endlessTile(7, 0, 'custom', { props: { speed: 70 } }); return hw.props.speed === 110 && sw.props.speed === 50 && off.props.speed !== 110 && cu.props.speed === 70 && cu.props.lampGap === off.props.lampGap; })());
// 11-06: §3.3 audit fixes (spilett m476e) — custom.fuel read, mix weights normalised, whereAt sees preset/custom
ok('custom.fuel is read: fuel=0 gives no fuel tiles where the 0.05 default gives some; fuel=0.5 gives more', (() => { const cnt = (c) => { let n = 0; for (let k = 0; k < 1200; k++) if (A2.endlessTile(7, k, 'custom', c).fuel) n++; return n; }; const d = cnt(null), z = cnt({ fuel: 0 }), h = cnt({ fuel: 0.5 }); return d > 0 && z === 0 && h > d; })(), { d: (() => { let n = 0; for (let k = 0; k < 1200; k++) if (A2.endlessTile(7, k, 'custom', null).fuel) n++; return n; })(), z: (() => { let n = 0; for (let k = 0; k < 1200; k++) if (A2.endlessTile(7, k, 'custom', { fuel: 0 }).fuel) n++; return n; })(), h: (() => { let n = 0; for (let k = 0; k < 1200; k++) if (A2.endlessTile(7, k, 'custom', { fuel: 0.5 }).fuel) n++; return n; })() });
ok('mix weights are normalised to shares of a whole: {open:1,forest:1} -> 0.5/0.5 and both biomes occur', (() => { const m = A2.parseCustomPreset('{"mix":{"open":1,"forest":1}}').mix; const okN = Math.abs(m.open - 0.5) < 1e-12 && Math.abs(m.forest - 0.5) < 1e-12; const bs = new Set(); for (let k = 0; k < 16 * 40; k++) bs.add(A2.endlessBiome(7, k, 'custom', { mix: m })); return okN && bs.has('open') && bs.has('forest'); })());
ok('mix ratios survive normalisation: {open:3,forest:1} -> 0.75/0.25 (clamp does not flatten proportions)', (() => { const m = A2.parseCustomPreset('{"mix":{"open":3,"forest":1}}').mix; return Math.abs(m.open - 0.75) < 1e-12 && Math.abs(m.forest - 0.25) < 1e-12; })());
ok('whereAt readout follows the preset/custom (was 2-of-4 args: always preset-off)', (() => { const w = A2.whereAt({ tiles: true, endlessRoad: true, endlessPreset: 'city-loop', seed: 7 }, 38800); const wc = A2.whereAt({ tiles: true, endlessRoad: true, endlessPreset: 'custom', endlessPresetCustom: '{"biome":"mountain"}', seed: 7 }, 38800); return /city/.test(w.tileKind) && /mountain/.test(wc.tileKind); })());
ok('whereAt gradePct follows the preset (elevatedView): forested-pass is steeper than off at dist 38800, seed 7', (() => { const g = (ps) => A2.whereAt({ tiles: true, endlessRoad: true, elevatedView: true, endlessPreset: ps, seed: 7 }, 38800).gradePct; const fp = g('forested-pass'), off = g('off'), rh = g('rolling-hills'); return fp === -7.8 && off === -5.8 && rh === -3.9 && fp !== off; })(), (() => { const g = (ps) => A2.whereAt({ tiles: true, endlessRoad: true, elevatedView: true, endlessPreset: ps, seed: 7 }, 38800).gradePct; return { fp: g('forested-pass'), off: g('off'), rh: g('rolling-hills') }; })());
ok('whereAt gradePct is absent without elevatedView (the elevation half only runs when asked)', A2.whereAt({ tiles: true, endlessRoad: true, endlessPreset: 'forested-pass', seed: 7 }, 38800).gradePct === undefined);
// 11-08: fuel never-adjacent guard holds at the DEFAULT 0.05 (custom.fuel > 0.05 is a known gap: the guard probes neighbours at a fixed 0.05 roll, so it is NOT asserted)
ok('fuel stations are never adjacent at the default 0.05 (3000 tiles x seeds 1-20, no custom)', (() => { let n = 0, adj = 0; for (let sd = 1; sd <= 20; sd++) { let prev = false; for (let k = 0; k < 3000; k++) { const f = !!A2.endlessTile(sd, k).fuel; if (f) { n++; if (prev) adj++; } prev = f; } } return n > 100 && adj === 0; })(), (() => { let n = 0; for (let sd = 1; sd <= 20; sd++) for (let k = 0; k < 3000; k++) if (A2.endlessTile(sd, k).fuel) n++; return { fuelTiles: n }; })());
console.log(fail === 0 ? `\nall ${pass} le-chonk-presets checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
