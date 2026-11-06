// barbicane (11-05, cyrus assignment) — ambient option test. ambient is an enum exposure option
// (values [0, 0.2, 5], default 0) that adds sky ambient light (lx) to diffuse surfaces and the sky veil.
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
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const a = Opt.OPTIONS.find((x) => x.id === 'ambient');
ok('registry: ambient enum [0, 0.2, 5], default 0, group exposure', !!a && a.type === 'enum' && JSON.stringify(a.values) === JSON.stringify([0, 0.2, 5]) && a.default === 0 && a.group === 'exposure');
ok('registry: ambient label "ambient light (lx)"', a && a.label === 'ambient light (lx)');
ok('registry: ambient control [data-anim="ambient"]', a && a.control === '[data-anim="ambient"]');
ok('registry: ambient owners drive-anim + spec-ui', a && a.owner && a.owner.length === 2 && a.owner.includes('js/drive-anim.js') && a.owner.includes('js/spec-ui.js'));
ok('defaults(): ambient === 0', Opt.defaults().ambient === 0);

// ---- wiring: CPU (drive.js)
ok('CPU: look.ambient default in render()', drv.includes('ambient: 0'));
ok('CPU: amb = look.ambient > 0 ? look.ambient : 0', drv.includes('amb = look.ambient > 0 ? look.ambient : 0'));
ok('CPU: skyL = amb * 0.012', drv.includes('skyL = amb * 0.012'));
ok('CPU: diffuse surface uses ambient (lx*0.5/PI)', drv.includes('p.look && p.look.ambient || 0'));

// ---- wiring: GPU (drive-three.js)
ok('GPU: ambient uniform set from look.ambient || 0', three.includes("set('ambient', look.ambient || 0)"));

// ---- wiring: UI (drive-anim.js + drive-layout.js)
ok('drive-anim: ambient select wired', anim.includes('[data-anim="ambient"]'));
ok('drive-anim: ambient change handler', anim.includes("setDV(ui, 'ambient', +ambient.value)"));
ok('drive-layout: ambient in lighting row', lay.includes("an('ambient')"));
ok('gate: NODE registers this test', gate.includes("'barbicane-ambient'") && gate.includes("'node:barbicane-ambient'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);