// barbicane (11-05) — onKcd option test.
// 11-10 nicholl (item-2 conversion): registry text-reads → module lookups; gate registration → the gate's
// own --list plan; "drive-anim: referenced" → source-lane behaviour (src.traffic.onKcd carries through
// RF.DriveAnim.source). No behaviour-no-side leg left unconverted; KEEP: none needed.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const RF = globalThis.RF;

const o = Opt.OPTIONS.find((x) => x.id === 'onKcd');
ok('registry: exists, type number, group traffic [module]', !!o && o.type === 'number' && o.group === 'traffic');
ok('registry: default 30 [module]', o && o.default === 30);
ok('registry: control \"Spec > Road sidebar row\" [module]', o && o.control === 'Spec > Road sidebar row');
ok('wiring: source() carries onKcd into the traffic state (explicit 250, default 30) [behaviour]', (() => {
  const def = RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7 });
  const set = RF.DriveAnim.source('road', 3.5, false, {}, { seed: 7, onKcd: 250 });
  return def.traffic.onKcd === 30 && set.traffic.onKcd === 250;
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-onKcd');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
