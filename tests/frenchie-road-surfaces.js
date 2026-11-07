// frenchie (11-04, Anya item 4; nemo/ROAD-SURFACES.md §7 RESOLVED 22:23Z) — road-surfaces PHYSICS option.
// roadSurfaces (bool, OFF) + roadSurface (enum, 'stock'): OFF = byte-identical. ON + non-stock: s drives
// k(s)=0.4+0.6s on the c(W)=W^2 wetBounce weight (CPU + 3 GPU sites) and the dryStreaks floor d0*s (d0=0.10).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const sh = fs.readFileSync(path.join(ROOT, 'js/drive-three-shaders.js'), 'utf8');
const halo = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const spec = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const rs = Opt.OPTIONS.find((x) => x.id === 'roadSurfaces'), rsu = Opt.OPTIONS.find((x) => x.id === 'roadSurface');
ok('registry: roadSurfaces bool default false, surface group, control', !!rs && rs.type === 'bool' && rs.default === false && rs.group === 'surface' && rs.control === '[data-dv="roadSurfaces"]');
ok('registry: roadSurface enum stock default, values, requires roadSurfacesOn', !!rsu && rsu.type === 'enum' && rsu.default === 'stock' && JSON.stringify(rsu.values) === JSON.stringify(['stock', 'fresh', 'old', 'concrete', 'tar-snake']) && /need\('roadSurfacesOn'\)/.test(rsu.requires.map((r) => JSON.stringify(r)).join(' ') + reg));
ok('registry: RULES has roadSurfacesOn on roadSurfaces eq true', /roadSurfacesOn: \{ cond: \{ opt: 'roadSurfaces', eq: true \}/.test(reg));
ok('defaults(): roadSurfaces false, roadSurface stock', Opt.defaults().roadSurfaces === false && Opt.defaults().roadSurface === 'stock');
ok('registry: haloConeEqui is registered (membership, not last-entry — a last-entry pin breaks the next appender, claude review 11-08)', Opt.OPTIONS.some((x) => x.id === 'haloConeEqui'));

// ---- laws (executed)
ok('executed: surfSOf undefined when OFF or stock', D.surfSOf({}) === undefined && D.surfSOf({ roadSurfaces: true, roadSurface: 'stock' }) === undefined && D.surfSOf({ roadSurface: 'fresh' }) === undefined);
ok('executed: surfSOf returns the spec s values', D.surfSOf({ roadSurfaces: true, roadSurface: 'fresh' }) === 0.35 && D.surfSOf({ roadSurfaces: true, roadSurface: 'old' }) === 0.22 && D.surfSOf({ roadSurfaces: true, roadSurface: 'concrete' }) === 0.30 && D.surfSOf({ roadSurfaces: true, roadSurface: 'tar-snake' }) === 0.50);
ok('executed: k(s)=0.4+0.6s; k=1 (byte-identical) when OFF/stock', D.surfKOf({}) === 1 && D.surfKOf({ roadSurfaces: true, roadSurface: 'stock' }) === 1 && Math.abs(D.surfKOf({ roadSurfaces: true, roadSurface: 'fresh' }) - 0.61) < 1e-12 && D.surfKOf({ roadSurfaces: true, roadSurface: 'tar-snake' }) === 0.7);
ok('executed: dryStreakFloorOf 0.25 when OFF/stock, d0*s (0.10) when ON', D.dryStreakFloorOf({}) === 0.25 && D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'stock' }) === 0.25 && Math.abs(D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'fresh' }) - 0.035) < 1e-12 && Math.abs(D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'old' }) - 0.022) < 1e-12);
ok('executed: wetBounceW unchanged without a look (k=1) — W^2 law intact', Math.abs(D.wetBounceW(0, 1, 1) - 1) < 1e-12 && Math.abs(D.wetBounceW(0, 1, 0.4) - 0.16) < 1e-12 && D.wetBounceW(0, 1, 0) === 0);
ok('executed: wetBounceW applies k(s) with a look', Math.abs(D.wetBounceW(0, 1, 1, { roadSurfaces: true, roadSurface: 'tar-snake' }) - 0.7) < 1e-12 && Math.abs(D.wetBounceW(0, 1, 0.4, { roadSurfaces: true, roadSurface: 'old' }) - 0.16 * 0.532) < 1e-12);

// ---- wiring
ok('CPU: all five wetBounceW callers pass a look (4th arg; the 5th is the B6 CE branch, 11-06)', (drv.match(/wetBounceW\([^)]*,\s*(o\.look|p\.look|lk)\)/g) || []).length === 5);
ok('CPU: dryStreaks floor via dryStreakFloorOf', drv.includes('look.dryStreaks === true ? dryStreakFloorOf(look) : 0)'));
ok('CPU: helpers exported on RF.Drive', drv.includes('RF.Drive = { wetBounceW, surfSOf, surfKOf, dryStreakFloorOf,'));
ok('GPU: kSurf uniform default 1 and set from surfKOf(look)', three.includes('kSurf: 1,') && three.includes("set('kSurf', D.surfKOf(look))"));
ok('GPU: dryStreaks floor via D.dryStreakFloorOf', three.includes('look.dryStreaks === true ? D.dryStreakFloorOf(look) : 0)'));
ok('shaders: kSurf declared in both uniform declarations', (sh.match(/wetModel, wetness, kSurf/g) || []).length === 2);
ok('shaders: both ext-B mirror loops multiply by kSurf', (sh.match(/\*wetU\*wetU\*kSurf;/g) || []).length === 2);
ok('halo: table program declares kSurf beside wetU; ext A multiplies by it', halo.includes("'uniform float wetU, kSurf;") && halo.includes('* wetU * wetU * kSurf;'));
ok('halo: all three table uniform sets carry kSurf', (halo.match(/kSurf: \{ value: D\.surfKOf\(look\) \}/g) || []).length === 3);
ok('drive-anim look carries roadSurfaces + roadSurface (rule 18 projection)', anim.includes('roadSurfaces: o.roadSurfaces === true, roadSurface: o.roadSurface || \'stock\''));
ok('spec-ui: controls exist (btn + select) and sync (disabled without roadSurfaces)', spec.includes("btn('roadSurfaces'") && spec.includes("dvSelect('roadSurface'") && spec.includes("b.disabled = !o.roadSurfaces"));
ok('spec-ui: spec picture key carries both options', /JSON\.stringify\(\[rd\.laneDrive, o\.scene, RF\.Drive\.wetnessOf\(o\), o\.wetSheen, o\.wetModel, !!o\.roadSurfaces, o\.roadSurface/.test(spec));
ok('drive-layout row lists both controls', lay.includes("dv('roadSurfaces'), dv('roadSurface')"));
ok('gate: NODE + wet group + MAP entries select the new test', gate.includes("'frenchie-road-surfaces'") && gate.includes("'node:frenchie-road-surfaces'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
