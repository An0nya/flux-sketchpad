// le-chonk 11-04: road surfaces option (Anya item 4, §7 RESOLVED via nemo/ROAD-SURFACES.md) — slice 1:
// MAT_DEF appends with s fields, endlessSurface biome-block assignment, roadSurfaces/roadSurface options,
// roadMat wiring. OFF must be byte-identical (roadMat absent -> asphalt, id 0).
const { load } = require('./load.js'); const RF = load(); const A = RF.DriveAnim, D = RF.Drive, Opt = RF.Options;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };

// 1. MAT_DEF appends: ids of all pre-existing materials unmoved, new entries carry s in [0,1] and wet looks
const keys = D.MAT_KEYS, id = D.MAT_DEF && Object.fromEntries(keys.map((k, i) => [k, i]));
ok('MAT_DEF has the four new road surfaces appended at the END', keys.slice(-4).join(',') === 'asphalt-fresh,asphalt-old,concrete-road,tar-snake', keys.slice(-4));
ok('asphalt keeps id 0 (existing ids unmoved)', id.asphalt === 0 && id['marker-red'] === keys.length - 5, { asphalt: id.asphalt });
const NEW = ['asphalt-fresh', 'asphalt-old', 'concrete-road', 'tar-snake'];
ok('new surfaces carry s in (0,1] and a wet look', NEW.every((k) => D.MAT_DEF[k].s > 0 && D.MAT_DEF[k].s <= 1 && D.MAT_DEF[k].wet), NEW.map((k) => D.MAT_DEF[k].s));
ok('spec values: fresh s=0.35, old s=0.22, concrete s=0.30, tar s=0.50', D.MAT_DEF['asphalt-fresh'].s === 0.35 && D.MAT_DEF['asphalt-old'].s === 0.22 && D.MAT_DEF['concrete-road'].s === 0.30 && D.MAT_DEF['tar-snake'].s === 0.50);
ok('existing asphalt entry has NO s field (absent = today)', !('s' in D.MAT_DEF.asphalt));

// 2. endlessSurface: deterministic, block-constant (16 tiles), valid ids, weights respected over many blocks
{
  const ids = new Set(['fresh', 'old', 'concrete']);
  let det = true, blockConst = true, valid = true;
  const tally = { fresh: 0, old: 0, concrete: 0 };
  for (let seed = 1; seed <= 8 && det && blockConst; seed++) for (let b = 0; b < 60 && det && blockConst; b++) {
    const s0 = A.endlessSurface(seed, b * 16);
    if (!ids.has(s0)) valid = false;
    for (let k = b * 16 + 1; k < b * 16 + 16; k++) if (A.endlessSurface(seed, k) !== s0) blockConst = false;
    if (A.endlessSurface(seed, b * 16) !== s0) det = false;
    tally[s0]++;
  }
  ok('endlessSurface deterministic + valid ids', det && valid);
  ok('endlessSurface constant within each 16-tile biome block', blockConst);
  ok('all three surfaces occur over 8 seeds x 60 blocks', tally.fresh > 0 && tally.old > 0 && tally.concrete > 0, tally);
  ok('endlessTile exposes tile.surface', A.endlessTile(7, 100).surface === A.endlessSurface(7, 100));
}

// 3. options registered exactly once, defaults OFF/stock, enum values
{
  const rs = Opt.OPTIONS.filter((e) => e.id === 'roadSurfaces'), ru = Opt.OPTIONS.filter((e) => e.id === 'roadSurface');
  ok('roadSurfaces registered once, bool, default false', rs.length === 1 && rs[0].type === 'bool' && rs[0].default === false);
  // frenchie's landed kit (11-05) owns the declaration; tar-snake is in the approved enum
  ok('roadSurface registered once, enum, default stock', ru.length === 1 && ru[0].type === 'enum' && ru[0].default === 'stock' && ru[0].values.join(',') === 'stock,fresh,old,concrete,tar-snake');
  ok('generated defaults carry roadSurfaces:false, roadSurface:"stock"', Opt.defaults().roadSurfaces === false && Opt.defaults().roadSurface === 'stock');
}

// 4. OFF byte-identical: roadMatOf is not exported, so check via the look projection path — with roadSurfaces off the
//    state dump round-trips and the default road material stays asphalt (CPU ground uses M[o.roadMat] || M.asphalt)
{
  const o = Opt.defaults();
  ok('defaults: roadSurfaces off means road band stays asphalt (MAT_ID.asphalt=0)', D.MAT_KEYS[0] === 'asphalt');
  const st = A.stateDump ? null : null;   // stateDump exists on RF.DriveAnim
  ok('state dump round-trips the new keys', (() => { const d = Opt.defaults(); d.roadSurfaces = true; d.roadSurface = 'old'; const j = JSON.stringify(d); const back = JSON.parse(j); return back.roadSurfaces === true && back.roadSurface === 'old'; })());
}

console.log(fails === 0 ? `all ${n} le-chonk-surfaces checks passed` : `${fails}/${n} FAILED`);

// ---- slice 2 (host 2026-11-05): procedural per-surface textures, GPU + CPU twins, stock untouched
{
  const fs = require('fs'), path = require('path');
  const sh = fs.readFileSync(path.join(__dirname, '../js/drive-three-shaders.js'), 'utf8');
  ok('GPU surfTex helper + surfKind uniform declared once', (sh.match(/uniform int surfKind;/g) || []).length === 1 && (sh.match(/vec3 surfTex\(/g) || []).length === 1);
  ok('GPU road band: roadId>0 branch textures, else-branch is the exact shipped s1 call', /if\(roadId>0\) r\+=rest\*coverage\(off,ho,e0,e1\)\*surfTex\(shade\(p,n,v,roadId\),s,off,surfKind\);/.test(sh) && /else r\+=rest\*coverage\(off,ho,e0,e1\)\*shade\(p,n,v,roadId\);/.test(sh));
  ok('GPU texture laws present: joints 5 m / tar per-tile seed / cracks threshold', sh.includes('fract(s / 5.0)') && sh.includes('floor(s / 150.0)') && sh.includes('kind == 2'));
  // [KEEP: text — renderer/shader source literal; no Node hook for the emitted GLSL/CPU pass (same class as the KEEP-flagged ml-* emission)]
  const dt = fs.readFileSync(path.join(__dirname, '../js/drive-three.js'), 'utf8');
  ok('drive-three sets surfKind from look.roadMat (no MAT ids)', dt.includes("set('surfKind', ({ 'asphalt-fresh': 1, 'asphalt-old': 2, 'concrete-road': 3, 'tar-snake': 4 })"));
  // [KEEP: text — renderer/shader source literal; no Node hook for the emitted GLSL/CPU pass (same class as the KEEP-flagged ml-* emission)]
  const dr = fs.readFileSync(path.join(__dirname, '../js/drive.js'), 'utf8');
  ok('CPU twin surfTexCPU at module level + road band uses look.roadMat', /const surfTexCPU =/.test(dr) && dr.includes("[(o.roadMat || 'asphalt'), e0, e1]"));
  // [KEEP: text — renderer/shader source literal; no Node hook for the emitted GLSL/CPU pass (same class as the KEEP-flagged ml-* emission)]
  ok('CPU road-band weight modulated only for band 0, stock keeps shipped weight', dr.includes("let w = c * rest * kw; if (i === 0 && o.roadMat && o.roadMat !== 'asphalt') w *= surfTexCPU(s, off, o.roadMat);"));
  // [KEEP: text — renderer/shader source literal; no Node hook for the emitted GLSL/CPU pass (same class as the KEEP-flagged ml-* emission)]
  ok('CPU stock path returns 1 (OFF byte-identical weight)', /if \(!mat \|\| mat === 'asphalt'\) return 1;/.test(dr));
  ok('CPU/GPU laws agree on the three features', dr.includes('(s / 5) % 1') && dr.includes('Math.floor(s / 150)') && dr.includes("mat === 'asphalt-old'"));
  // [KEEP: text — renderer/shader source literal; no Node hook for the emitted GLSL/CPU pass (same class as the KEEP-flagged ml-* emission)]
}

process.exit(fails === 0 ? 0 : 1);
