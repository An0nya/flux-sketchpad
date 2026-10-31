// frenchie / backlog §3-P: registry + behaviour test for `qualityGovernor` (the feature-shed quality governor).
// Node: node tests/frenchie-quality-governor.js — exits 1 on any failure. Scope: frenchie/S3P-SCOPE.md.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
load();
const A = globalThis.RF.DriveAnim;
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const reg = fs.readFileSync(path.join(ROOT, 'js', 'options-registry.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
const e = Opt.OPTIONS.find((x) => x.id === 'qualityGovernor');

// 1. registry: declared once, profile enum, default off, control, group, tests entry
ok('registry: qualityGovernor declared once, profile enum [off,on], default "off"', Opt.OPTIONS.filter((x) => x.id === 'qualityGovernor').length === 1 && !!e && e.kind === 'profile' && e.type === 'enum' && JSON.stringify(e.values) === '["off","on"]' && e.default === 'off');
ok('registry: control, group performance, tests entry', !!e && e.control === '[data-anim="quality-governor"]' && e.group === 'performance' && JSON.stringify(e.tests) === '["node:frenchie-quality-governor"]');
ok('registry: default is in DV_DEF (RF.Options.defaults)', Opt.defaults().qualityGovernor === 'off');

// 2. the shed state machine (exported on RF.DriveAnim next to resolutionStep)
ok('shedStep/shedState/shedPatch exported on RF.DriveAnim', typeof A.shedStep === 'function' && typeof A.shedState === 'function' && typeof A.shedPatch === 'function');
ok('off or pinned returns the zero state (OFF = no shed, byte-identical path)', JSON.stringify(A.shedStep(A.shedState(), 50, { enabled: false, target: 33 })) === JSON.stringify(A.shedState()) && JSON.stringify(A.shedStep(A.shedState(), 50, { enabled: true, pinned: true, target: 33 })) === JSON.stringify(A.shedState()));
ok('non-positive/NaN ms leaves the state unchanged', (() => { const s = A.shedStep(A.shedState(), 40, { enabled: true, target: 33 }); const s2 = A.shedStep(s, 0, { enabled: true, target: 33 }); return s2.index === s.index && s2.average === s.average; })());
ok('sustained hot frames step the level down monotonically, clamped at SHED_LEVELS.length', (() => { let s = A.shedState(); const seen = []; for (let i = 0; i < 400; i++) { s = A.shedStep(s, 50, { enabled: true, target: 33 }); if (!seen.length || seen[seen.length - 1] !== s.index) seen.push(s.index); } return seen.every((v, i) => i === 0 || v >= seen[i - 1]) && s.index === 7 && seen.length === 8; })());
ok('sustained fast frames step back up to 0', (() => { let s = A.shedState(); for (let i = 0; i < 400; i++) s = A.shedStep(s, 50, { enabled: true, target: 33 }); for (let i = 0; i < 600; i++) s = A.shedStep(s, 10, { enabled: true, target: 33 }); return s.index === 0; })());
ok('shedPatch is cumulative and clamped (level 2 adds supersampling 2->1)', (() => { const p2 = A.shedPatch(2), p9 = A.shedPatch(99); return p2.haloNearSub === 1 && p2.samples === '1' && !('shadowRes' in p2) && p9.shadowRes === '512x256' && JSON.stringify(A.shedPatch(0)) === '{}'; })());
ok('shed list never touches haloJitter (banding mitigation) or scene/table-rebuild options', (() => { const keys = Object.keys(A.shedPatch(99)); return !keys.includes('haloJitter') && !['leafyFoliage', 'detailedModels', 'haloDiv', 'scatterRes'].some((k) => keys.includes(k)); })());

// 3. wiring: overlay applied at the top of prepare(), stepped in recordFrame, gated on the option value
ok('prepare() applies the shed overlay gated on qualityGovernor==="on" and restores the base (OFF = no-op)', anim.includes("if (V.shedBase) Object.assign(o, V.shedBase);") && anim.includes("if (o.qualityGovernor === 'on' && V.shedLevel > 0)") && anim.includes("else V.shedBase = null;"));
ok('recordFrame steps the governor with the same clock as dynamic resolution', /V\.shed = shedStep\(V\.shed, Math\.max\(elapsed, cadenceMs\), \{ enabled: o\.qualityGovernor === 'on'/.test(anim));
ok('frame()/frameMT re-prepare on a mid-play level change (shedPrepare next to resolutionPrepare)', (anim.match(/resolutionPrepare\(\); shedPrepare\(\);/g) || []).length === 2 && anim.includes('if (V.shedLevel !== V.shedApplied)'));
ok('shedPrepare is defined next to resolutionPrepare', /function shedPrepare\(\) \{   \/\/ 3-P/.test(anim));
ok('look projection carries qualityGovernor', anim.includes("qualityGovernor: o.qualityGovernor === 'on'"));
ok('drive bar has the [data-anim="quality-governor"] select with a change -> setDV', /data-anim': 'quality-governor'/.test(anim) && /qg\.addEventListener\('change', \(\) => setDV\(ui, 'qualityGovernor', qg\.value\)\)/.test(anim));
ok('labels() syncs the select', anim.includes("[data-anim=\"quality-governor\"]').value = o.qualityGovernor === 'on' ? 'on' : 'off'"));
ok('both spec-ui picture-cache keys carry o.qualityGovernor', (ui.match(/o\.qualityGovernor[,)\]]/g) || []).length === 2, (ui.match(/o\.qualityGovernor[,)\]]/g) || []).length);
ok('drive-layout Resolution pane lists the control', lay.includes("an('quality-governor')"));

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
