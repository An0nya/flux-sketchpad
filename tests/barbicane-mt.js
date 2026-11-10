// barbicane (11-05, cyrus assignment) — mt option test. mt is a bool performance option
// (default true) that enables Web Worker threading for the CPU renderer.
// mt() in drive-anim.js needs Workers (browser only), so the frame-lane wiring checks stay KEEP.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; 'mt() wiring checks' KEEP
// with measured reason (Workers + V.info render lane, no headless behaviour seam); CLASSES wiring becomes
// a module check; gate -> gate --list. OWN: barbicane (11-05, cyrus assignment).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const A = RF.DriveAnim;

// ---- registry (module)
const m = Opt.OPTIONS.find((x) => x.id === 'mt');
ok('registry: mt bool, default true, group performance [module]', !!m && m.type === 'bool' && m.default === true && m.group === 'performance');
ok('registry: mt label "threads" [module]', m && m.label === 'threads');
ok('registry: mt control [data-anim="c-mt"] [module]', m && m.control === '[data-anim="c-mt"]');
ok('registry: mt owner drive-anim.js [module]', m && m.owner && m.owner.length === 1 && m.owner[0] === 'js/drive-anim.js');
ok('registry: mt cost worker [module]', m && m.cost === 'worker');
ok('registry: mt requires cpuRenderer [module]', m && m.requires && m.requires.length === 1);
ok('registry: mt conflicts mtBlockers [module]', m && m.conflicts && m.conflicts.length === 1);
ok('defaults(): mt === true [behaviour]', Opt.defaults().mt === true);

// ---- wiring: mt() function in drive-anim.js — KEEP per the mt() function header note (Workers + V.info lane)
ok('drive-anim: mt() function exists [KEEP: text — Worker path, no headless seam]', anim.includes('function mt()'));
ok('drive-anim: mt() checks o.mt !== false [KEEP: text — Worker path]', anim.includes('o.mt !== false'));
ok('drive-anim: mt() checks typeof Worker [KEEP: text — Worker path]', anim.includes("typeof Worker !== 'undefined'"));
ok('drive-anim: mt() checks !V.three [KEEP: text — render lane]', anim.includes('!V.three'));
ok('drive-anim: mt() checks !Wk.failed [KEEP: text — render lane]', anim.includes('!Wk.failed'));
// behaviour: the CLASSES registry exposes the threads switch to the UI
ok('behaviour: CLASSES carries [\'mt\', \'threads\'] [behaviour]', (() => { return Array.isArray(A.CLASSES) && A.CLASSES.some((e) => Array.isArray(e) && e[0] === 'mt' && e[1] === 'threads'); })());
// UI control wiring — KEEP (DOM query lane)
ok('drive-anim: mt control queried [data-anim="c-mt"] [KEEP: text — DOM lane]', anim.includes('[data-anim="c-mt"]'));

// ---- gate
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-mt');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
