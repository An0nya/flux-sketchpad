// barbicane (11-05) — trafficLogic option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; gate -> gate --list; 'drive-anim:
// referenced' -> source-lane behaviour (src.traffic.logic carries through RF.DriveAnim.source).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'trafficLogic');
ok('registry: exists, type bool, group traffic [module]', !!o && o.type === 'bool' && o.group === 'traffic');
ok('registry: default false [module]', o && o.default === false);
ok('registry: control [data-anim="traffic-logic"] [module]', o && o.control === '[data-anim="traffic-logic"]');
ok('wiring: source() carries trafficLogic into traffic state (default false, on true) [behaviour]', (() => {
  return A.source('road', 3.5, false, {}, { seed: 7 }).traffic.logic === false
    && A.source('road', 3.5, false, {}, { seed: 7, trafficLogic: true }).traffic.logic === true
    && A.source('road', 3.5, false, {}, { seed: 7, trafficLogic: false }).traffic.logic === false;
})());
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-trafficLogic');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
