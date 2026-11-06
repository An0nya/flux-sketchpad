// barbicane (11-05, cyrus assignment) — mt option test. mt is a bool performance option
// (default true) that enables Web Worker threading for the CPU renderer.
// mt() in drive-anim.js needs Workers (browser only), so this test covers registry + wiring.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const m = Opt.OPTIONS.find((x) => x.id === 'mt');
ok('registry: mt bool, default true, group performance', !!m && m.type === 'bool' && m.default === true && m.group === 'performance');
ok('registry: mt label "threads"', m && m.label === 'threads');
ok('registry: mt control [data-anim="c-mt"]', m && m.control === '[data-anim="c-mt"]');
ok('registry: mt owner drive-anim.js', m && m.owner && m.owner.length === 1 && m.owner[0] === 'js/drive-anim.js');
ok('registry: mt cost worker', m && m.cost === 'worker');
ok('registry: mt requires cpuRenderer', m && m.requires && m.requires.length === 1);
ok('registry: mt conflicts mtBlockers', m && m.conflicts && m.conflicts.length === 1);
ok('defaults(): mt === true', Opt.defaults().mt === true);

// ---- wiring: mt() function in drive-anim.js
ok('drive-anim: mt() function exists', anim.includes('function mt()'));
ok('drive-anim: mt() checks V.info.o.mt !== false', anim.includes('o.mt !== false'));
ok('drive-anim: mt() checks typeof Worker', anim.includes("typeof Worker !== 'undefined'"));
ok('drive-anim: mt() checks !V.three', anim.includes('!V.three'));
ok('drive-anim: mt() checks !Wk.failed', anim.includes('!Wk.failed'));
ok('drive-anim: mt CLASSES entry "threads"', anim.includes("'mt', 'threads'"));

// ---- wiring: UI control
// mt control is auto-generated from registry; drive-anim.js queries it
ok('drive-anim: mt control queried [data-anim="c-mt"]', anim.includes('[data-anim="c-mt"]'));

// ---- gate
ok('gate: NODE registers this test', gate.includes("'barbicane-mt'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);