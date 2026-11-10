// barbicane (11-05) — res option test.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; gate -> gate --list; 'drive-anim: referenced'
// kept [KEEP: the res constraint lives in the render pipeline; no headless behaviour seam].
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'res');
ok('registry: exists, type int, group road [module]', !!o && o.type === 'int' && o.group === 'road');
ok('registry: default 640 [module]', o && o.default === 640);
ok('registry: control none [module]', o && o.control === 'none');
// KEEP: text [render-pipeline wiring — no headless behaviour seam]
ok('drive-anim: referenced [KEEP: text — res constrains the internal render cell, unobservable headlessly]', anim.includes('res'));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-res');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
