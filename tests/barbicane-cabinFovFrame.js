// barbicane (11-05) — cabinFovFrame option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (cabin overlay lane, no headless behaviour seam); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'cabinFovFrame');
ok('registry: exists, type bool, group view [module]', !!o && o.type === 'bool' && o.group === 'view');
ok('registry: default false [module]', o && o.default === false);
ok('registry: control [data-anim="cabinFovFrame"] [module]', o && o.control === '[data-anim="cabinFovFrame"]');
// KEEP: text [cabin overlay lane, no headless behaviour seam]
ok('drive-anim: referenced [KEEP: text — cabin overlay lane, no headless behaviour seam]', /(^|[^a-zA-Z_])cabinFovFrame(?![a-zA-Z_])/.test(anim));
ok('gate: NODE registers this test [gate --list-node-all]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:barbicane-cabinFovFrame');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
