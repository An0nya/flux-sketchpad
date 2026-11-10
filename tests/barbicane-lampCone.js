// barbicane (11-05) — lampCone option test. enum ['auto','off','on'], default 'auto'.
// 11-10 nicholl (item-2 conversion): registry text-greps -> module reads; wiring -> KEEP (own-lamp render lane, no headless behaviour seam; also covers the conservative default); gate -> gate --list.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'lampCone');
ok('registry: exists, type enum, group street-lamps [module]', !!o && o.type === 'enum' && o.group === 'street-lamps');
ok('registry: default auto [module]', o && o.default === 'auto');
ok('registry: cost per-frame-gpu [module]', o && o.cost === 'per-frame-gpu');
// KEEP: text [own-lamp render lane, no headless behaviour seam]
ok('drive-anim: in V.p projection [KEEP: text — own-lamp render lane]', /(^|[^a-zA-Z_])lampCone(?![a-zA-Z_])/.test(anim) && anim.includes('lampCone: D.lampConeOn'));
// KEEP: text [render-lane conservative fallback]
ok('drive-anim: in conservative default [KEEP: text — own-lamp render lane]', anim.includes("lampCone: 'off'"));
ok('gate: NODE registers this test [gate --list]', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list'], { encoding: 'utf8' });
  return out.includes('node:barbicane-lampCone');
})());

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
