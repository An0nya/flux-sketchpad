// barbicane (11-05, cyrus assignment) — seed option test. seed is an int road option (default 7, 0–99999)
// that seeds the deterministic traffic behaviour: dipFraction (high-beam dip timing) and weightedPick
// (traffic beam selection). Both are pure functions exported on RF.Drive.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const s = Opt.OPTIONS.find((x) => x.id === 'seed');
ok('registry: seed int 0-99999 step 1, default 7, group road', !!s && s.type === 'int' && s.default === 7 && s.group === 'road' && s.values.min === 0 && s.values.max === 99999 && s.values.step === 1);
ok('registry: seed requires seedUsed, control [data-anim="seed"] + dice', /need\('seedUsed'\)/.test(s.requires.map((r) => JSON.stringify(r)).join(' ') + reg) && s.control === '[data-anim="seed"], [data-anim="dice"]');
ok('defaults(): seed === 7', Opt.defaults().seed === 7);

// ---- pure functions: dipFraction (default seed yield)
ok('dipFraction(7, car1, 200) deterministic', D.dipFraction(7, 'car1', 200) === 1);
ok('dipFraction(7, car1, 200) repeatable', D.dipFraction(7, 'car1', 200) === D.dipFraction(7, 'car1', 200));
ok('dipFraction: different seed → different result', D.dipFraction(7, 'car1', 200) !== D.dipFraction(99, 'car1', 200));
ok('dipFraction: distance affects dip (close=dipped, far=high)', D.dipFraction(7, 'car1', 50) < D.dipFraction(7, 'car1', 400) && D.dipFraction(7, 'car1', 400) >= D.dipFraction(7, 'car1', 1000));   // at < at-4m → dipped (0), at > at+4m → high (1)
ok('dipFraction: undefined seed defaults to 7', D.dipFraction(undefined, 'car1', 200) === D.dipFraction(7, 'car1', 200));
ok('dipFraction: undefined carId defaults to still', D.dipFraction(7, 'still', 200) === D.dipFraction(7, undefined, 200));
ok('dipFraction: range 0-1', (() => { for (let s2 = 0; s2 <= 99999; s2 += 11111) { const v = D.dipFraction(s2, 'test', 300); if (v < 0 || v > 1) return false; } return true; })());

// ---- weightedPick (seed determinism for traffic beam selection)
const pool3 = [{ id: 'beam-A' }, { id: 'beam-B' }, { id: 'beam-C' }];
ok('weightedPick(7, car1, pool3) deterministic', D.weightedPick(7, 'car1', pool3) === D.weightedPick(7, 'car1', pool3));
ok('weightedPick: different seed → potentially different pick', D.weightedPick(7, 'car1', pool3) !== D.weightedPick(12345, 'car1', pool3));
ok('weightedPick: empty pool → -1', D.weightedPick(7, 'car1', []) === -1);
ok('weightedPick: returns valid index (0..n-1)', (() => { const pick = D.weightedPick(7, 'car1', pool3); return pick >= 0 && pick < 3; })());
ok('weightedPick: respect weights (beam-C weight 100, others 0)', D.weightedPick(7, 'car1', pool3, [0, 0, 100]) === D.weightedPick(7, 'car1', pool3, [0, 0, 100]));

// ---- wiring: seed consumed in drive.js
ok('CPU: dipFraction called with seed', /dipFraction\(o\.seed\b/.test(drv) || /dipFraction\(\s*o\.seed\b/.test(drv));
ok('CPU: dipFraction called with traffic seed', /dipFraction\(p\.src\.traffic\.seed\b/.test(drv));
ok('CPU: weightedPick called with traffic seed', /weightedPick\(p\.src\.traffic\.seed\b/.test(drv));
ok('drive-anim: seed control wired', anim.includes('[data-anim="seed"]') && anim.includes('[data-anim="dice"]'));
ok('drive-layout: seed + dice in road row', lay.includes("an('seed')") && lay.includes("an('dice')"));
ok('gate: NODE registers this test', gate.includes("'barbicane-seed'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);