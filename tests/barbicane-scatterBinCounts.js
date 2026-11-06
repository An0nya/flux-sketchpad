// barbicane (11-05) — scatterBinCounts option test. text, default '', group air.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const drive3 = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

const o = Opt.OPTIONS.find((x) => x.id === 'scatterBinCounts');
ok('registry: exists, type text, group air', !!o && o.type === 'text' && o.group === 'air');
ok('registry: default empty', o && o.default === '');
ok('registry: control [data-dv="scatterBinCounts"]', o && o.control === '[data-dv="scatterBinCounts"]');
ok('drive-anim: in look projection', anim.includes('scatterBinCounts: o.scatterBinCounts'));
ok('drive-three: cache key', drive3.includes('look.scatterBinCounts'));
ok('gate: NODE registers this test', gate.includes("'barbicane-scatterBinCounts'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);