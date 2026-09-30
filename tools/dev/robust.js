// robustness + determinism of the SQM solver: budgets, min distance, repeat runs.  node tools/dev/robust.js
const path = require('path'), fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const RF = require(path.join(ROOT, 'tests/load.js')).load();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers/lab-sqm.js'), 'utf8'));
const scenes = require(path.join(ROOT, 'tools/bench-scenes.js')).all(RF), S = RF.Solvers, def = S.get('sqm');
const hash = (o) => crypto.createHash('md5').update(JSON.stringify(o.surfaces)).digest('hex').slice(0, 10);
function run(name, budget, over) {
  const sc = scenes[name](); if (budget) sc.modeA.budget = budget; sc.mode = 'A'; sc.solve = { id: 'sqm' };
  const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, over || {}));
  const t0 = Date.now(), out = def.solve(S.inputOf(sc), settings, {}), ms = Date.now() - t0, v = S.verify(sc, out);
  return { out, ms, v, nSurf: out.surfaces.length, budget: sc.modeA.budget };
}
let bad = 0;
for (const b of [1, 2, 3, 5, 10, 30]) { const r = run('default', b); const ok = r.nSurf <= b && !r.v.errors.length && !r.v.violations.envelope.length && !r.v.violations.keepOut.length; if (!ok) bad++; console.log('default budget', b, '→', r.nSurf, 'facets', ok ? 'ok' : 'FAIL', r.v.errors.join(';'), r.ms + 'ms'); }
for (const md of [5, 10, 15]) { const r = run('default', 0, { minDistance: md }); const ok = !r.v.errors.length && !r.v.violations.envelope.length && !r.v.violations.keepOut.length && r.nSurf <= r.budget; if (!ok) bad++; console.log('default minDistance', md, '→', r.nSurf, 'facets', ok ? 'ok' : 'FAIL', 'keepOut violations', r.v.violations.keepOut.length, r.ms + 'ms'); }
for (const nm of ['p-wash', 'anya-lowbeam-212']) { const a = run(nm, 0), b = run(nm, 0); const same = hash(a.out) === hash(b.out); if (!same) bad++; console.log(nm, 'repeat run identical:', same, hash(a.out), hash(b.out)); }
console.log(bad ? 'FAILURES: ' + bad : 'all robust');
