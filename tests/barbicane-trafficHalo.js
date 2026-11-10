// barbicane (11-05, cyrus assignment) — trafficHalo option test. trafficHalo is an enum halo option
// (values [0, 4, 8, 16], default 0) that adds single-scattered oncoming headlamp light along the eye ray.
// haloN(o) decides how many lamps to include; trafficHalo() is the scatter integrator.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; RULES reads -> module reads (they already were);
// wiring -> KEEP (CPU halo lane + drive-layout UI lane); gate -> gate --list. haloN behaviour checks are unchanged.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');

// ---- registry (module)
const t = Opt.OPTIONS.find((x) => x.id === 'trafficHalo');
ok('registry: trafficHalo enum [0, 4, 8, 16], default 0, group halo [module]', !!t && t.type === 'enum' && JSON.stringify(t.values) === JSON.stringify([0, 4, 8, 16]) && t.default === 0 && t.group === 'halo');
ok('registry: trafficHalo label "oncoming headlamp scatter" [module]', t && t.label === 'oncoming headlamp scatter');
ok('registry: trafficHalo control [data-dv="trafficHalo"] [module]', t && t.control === '[data-dv="trafficHalo"]');
ok('registry: trafficHalo owners drive.js + spec-ui + drive-anim [module]', t && t.owner && t.owner.length === 3 && t.owner.includes('js/drive.js') && t.owner.includes('js/spec-ui.js') && t.owner.includes('js/drive-anim.js'));
ok('registry: trafficHalo cost per-frame-gpu [module]', t && t.cost === 'per-frame-gpu');
ok('defaults(): trafficHalo === 0 [behaviour]', Opt.defaults().trafficHalo === 0);

// ---- RULES (module)
const haloOn = Opt.RULES.haloOn;
ok('RULES: haloOn exists [module]', !!haloOn);
ok('RULES: haloOn requires trafficHalo > 0 [module]', haloOn && haloOn.cond && haloOn.cond.opt === 'trafficHalo' && haloOn.cond.gt === 0);

// ---- requires (module)
ok('requires: air + trafficBeamsOn [module]', t && t.requires && t.requires.length === 2);

// ---- haloN(o) function — behaviour (unchanged)
const haloNAssert = (cond, name) => ok(name, cond);
ok('haloN exported', typeof D.haloN === 'function');
ok('haloN: trafficHalo=0 → 0', D.haloN({}) === 0);
ok('haloN: no trafficBeams → 0', D.haloN({ look: { trafficHalo: 4, visibility: 200 } }) === 0);
ok('haloN: no visibility → 0', D.haloN({ look: { trafficHalo: 4 }, trafficBeams: true }) === 0);
ok('haloN: trafficHalo=4 → 4 lamps', D.haloN({ look: { trafficHalo: 4, visibility: 200 }, trafficBeams: true }) === 4);
ok('haloN: trafficHalo=8 → 8 lamps', D.haloN({ look: { trafficHalo: 8, visibility: 200 }, trafficBeams: true }) === 8);
ok('haloN: trafficHalo=16 → 16 lamps', D.haloN({ look: { trafficHalo: 16, visibility: 200 }, trafficBeams: true }) === 16);
ok('haloN: haloCars=2 caps at 4 lamps', D.haloN({ look: { trafficHalo: 8, haloCars: 2, visibility: 200 }, trafficBeams: true }) === 4);
ok('haloN: haloCars=10 caps at 16 lamps', D.haloN({ look: { trafficHalo: 16, haloCars: 10, visibility: 200 }, trafficBeams: true }) === 16);
ok('haloN: trafficHalo=4 (old 4) still works', D.haloN({ look: { trafficHalo: 4, visibility: 200 }, trafficBeams: true }) === 4);
ok('haloN: trafficHalo=8 (old 8) still works', D.haloN({ look: { trafficHalo: 8, visibility: 200 }, trafficBeams: true }) === 8);
void haloNAssert;
// ---- wiring: CPU (drive.js) — KEEP with named reason
ok('CPU: addScatter calls trafficHalo [KEEP: text — CPU halo lane]', drv.includes('h = haloK ? trafficHalo(') || drv.includes('trafficHalo([dx, dy, dz]'));
ok('CPU: trafficHalo function defined [KEEP: text — CPU halo lane]', drv.includes('function trafficHalo('));
ok('CPU: haloN called with sigma + beams check [KEEP: text — CPU halo lane]', drv.includes('sigmaOf(look) > 0 && n > 0'));
ok('CPU: trafficHalo exported on RF.Drive [KEEP: text — CPU halo lane]', drv.includes('trafficHalo') && drv.includes('haloN'));

// ---- gate
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-trafficHalo');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
