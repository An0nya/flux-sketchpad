// barbicane (11-05) — reflectiveClothing option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> source-lane behaviour (src.tiles.pedMode); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const A = RF.DriveAnim;

const o = Opt.OPTIONS.find((x) => x.id === 'reflectiveClothing');
ok('registry: exists, type enum, group scenery [module]', !!o && o.type === 'enum' && o.group === 'scenery');
ok('registry: default mix [module]', o && o.default === 'mix');
ok('registry: control [data-anim="reflective-clothing"] [module]', o && o.control === '[data-anim="reflective-clothing"]');
ok('wiring: source() carries reflectiveClothing into src.tiles.pedMode', (() => {
  return A.source('road', 3.5, false, {}, { seed: 7, tiles: true, reflectiveClothing: 'hivis' }).tiles.pedMode === 'hivis'
    && A.source('road', 3.5, false, {}, { seed: 7, tiles: true, reflectiveClothing: 'dark' }).tiles.pedMode === 'dark';
})());
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-reflectiveClothing');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
