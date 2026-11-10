// barbicane (11-05) — cline option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; gate -> gate --list; 'drive-anim:
// referenced' -> laneMarkings behaviour (D.laneMarkings: broken=true -> single dashed yellow, broken=false ->
// double solid yellow). cline reaches the app only through this one line, with us=true required.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;

const o = Opt.OPTIONS.find((x) => x.id === 'cline');
ok('registry: exists, type enum, group road [module]', !!o && o.type === 'enum' && o.group === 'road');
ok('registry: default solid [module]', o && o.default === 'solid');
ok('registry: control [data-anim="cline"] [module]', o && o.control === '[data-anim="cline"]');
ok('lane markings: broken -> single dashed yellow, solid -> double solid yellow [behaviour]', (() => {
  const solid = D.laneMarkings(3.5, { us: true, broken: false }).filter((m) => m.mat === 'yellow-paint');
  const broken = D.laneMarkings(3.5, { us: true, broken: true }).filter((m) => m.mat === 'yellow-paint');
  const off = D.laneMarkings(3.5, { us: false, broken: true }).filter((m) => m.mat === 'yellow-paint');
  return solid.length === 2 && broken.length === 1 && !!broken[0].pat && off.length === 0;
})());
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-cline');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
