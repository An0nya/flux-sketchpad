// barbicane (11-05, cyrus assignment) — trafficHalo option test. trafficHalo is an enum halo option
// (values [0, 4, 8, 16], default 0) that adds single-scattered oncoming headlamp light along the eye ray.
// haloN(o) decides how many lamps to include; trafficHalo() is the scatter integrator.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

// ---- registry
const t = Opt.OPTIONS.find((x) => x.id === 'trafficHalo');
ok('registry: trafficHalo enum [0, 4, 8, 16], default 0, group halo', !!t && t.type === 'enum' && JSON.stringify(t.values) === JSON.stringify([0, 4, 8, 16]) && t.default === 0 && t.group === 'halo');
ok('registry: trafficHalo label "oncoming headlamp scatter"', t && t.label === 'oncoming headlamp scatter');
ok('registry: trafficHalo control [data-dv="trafficHalo"]', t && t.control === '[data-dv="trafficHalo"]');
ok('registry: trafficHalo owners drive.js + spec-ui + drive-anim', t && t.owner && t.owner.length === 3 && t.owner.includes('js/drive.js') && t.owner.includes('js/spec-ui.js') && t.owner.includes('js/drive-anim.js'));
ok('registry: trafficHalo cost per-frame-gpu', t && t.cost === 'per-frame-gpu');
ok('defaults(): trafficHalo === 0', Opt.defaults().trafficHalo === 0);

// ---- RULES
const haloOn = Opt.RULES.haloOn;
ok('RULES: haloOn exists', !!haloOn);
ok('RULES: haloOn requires trafficHalo > 0', haloOn && haloOn.cond && haloOn.cond.opt === 'trafficHalo' && haloOn.cond.gt === 0);

// ---- requires
ok('requires: air + trafficBeamsOn', t && t.requires && t.requires.length === 2);

// ---- haloN(o) function
ok('haloN exported', typeof D.haloN === 'function');
// OFF: trafficHalo=0 → 0
ok('haloN: trafficHalo=0 → 0', D.haloN({}) === 0);
// No traffic beams → 0
ok('haloN: no trafficBeams → 0', D.haloN({ look: { trafficHalo: 4, visibility: 200 } }) === 0);
// No visibility (sigma=0) → 0
ok('haloN: no visibility → 0', D.haloN({ look: { trafficHalo: 4 }, trafficBeams: true }) === 0);
// trafficHalo=4 + beams + visibility → 4
ok('haloN: trafficHalo=4 → 4 lamps', D.haloN({ look: { trafficHalo: 4, visibility: 200 }, trafficBeams: true }) === 4);
// trafficHalo=8 → 8
ok('haloN: trafficHalo=8 → 8 lamps', D.haloN({ look: { trafficHalo: 8, visibility: 200 }, trafficBeams: true }) === 8);
// trafficHalo=16 → 16
ok('haloN: trafficHalo=16 → 16 lamps', D.haloN({ look: { trafficHalo: 16, visibility: 200 }, trafficBeams: true }) === 16);
// haloCars override: 8 + haloCars=2 → 4 (2 cars × 2 lamps)
ok('haloN: haloCars=2 caps at 4 lamps', D.haloN({ look: { trafficHalo: 8, haloCars: 2, visibility: 200 }, trafficBeams: true }) === 4);
// haloCars=10 → 20 capped to 16
ok('haloN: haloCars=10 caps at 16 lamps', D.haloN({ look: { trafficHalo: 16, haloCars: 10, visibility: 200 }, trafficBeams: true }) === 16);
// trafficHalo=4 (old value) still works
ok('haloN: trafficHalo=4 (old 4) works', D.haloN({ look: { trafficHalo: 4, visibility: 200 }, trafficBeams: true }) === 4);
// trafficHalo=8 (old value) still works
ok('haloN: trafficHalo=8 (old 8) works', D.haloN({ look: { trafficHalo: 8, visibility: 200 }, trafficBeams: true }) === 8);

// ---- wiring: CPU (drive.js)
ok('CPU: addScatter calls trafficHalo', drv.includes('h = haloK ? trafficHalo(') || drv.includes('trafficHalo([dx, dy, dz]'));
ok('CPU: trafficHalo function defined', drv.includes('function trafficHalo('));
ok('CPU: haloN called with sigma + beams check', drv.includes('sigmaOf(look) > 0 && n > 0'));
ok('CPU: trafficHalo exported on RF.Drive', drv.includes('trafficHalo') && drv.includes('haloN'));

// ---- wiring: UI
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
ok('drive-layout: dv trafficHalo in oncoming row', lay.includes("dv('trafficHalo')"));

// ---- gate
ok('gate: NODE registers this test', gate.includes("'barbicane-trafficHalo'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);