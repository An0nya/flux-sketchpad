// le-chonk (11-09, B11 A3): lampsOf caches per objects array (WeakMap); cached entries keep live emit/st via src getters.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
const lc = fs.readFileSync(path.join(ROOT, 'js/drive-three-lampcone.js'), 'utf8');
ok('lampsOf has a WeakMap cache keyed on the objects array', /const lampsCache = new WeakMap\(\)/.test(lc) && /lampsCache\.get\(objects\)/.test(lc) && /lampsCache\.set\(objects, out\)/.test(lc));
// functional: extract the cache + lampsOf source and run it standalone
const i = lc.indexOf('const lampsCache = new WeakMap();');
const j = lc.indexOf('const D = globalThis.RF.Drive;', i);
const src = lc.slice(i, j).replace(/^export /gm, '');
const lampsOf = new Function(src + '\nreturn lampsOf;')();
const objs = [
  { cls: 'street-lamp', mat: 'lamp-head', x: 1, y: 2, z: 3, emit: [1, 2, 3], street: 'III' },
  { cls: 'signal', k: 'disc', x: 5, y: 0, z: 4, emit: true, nx: 0, ny: 1 },
  { cls: 'signal', k: 'disc', x: 9, y: 0, z: 4, emit: false, nx: 1, ny: 0 },   // unlit: skipped, as before
];
const a = lampsOf(objs), b = lampsOf(objs);
ok('same array back on a repeat call (cache hit)', a === b && a.length === 2, { same: a === b, len: a.length });
ok('street dedup by x,y kept', a.filter((L) => L.kind === 'street').length === 1);
const sig = a.find((L) => L.kind === 'signal');
ok('signal entry present with live emit getter', !!sig && sig.emit === true);
objs[1].emit = false;
ok('emit reads live after a signal flip (getter on src)', sig.emit === false);
objs[1].nx = 0.5;
ok('st reads live too', JSON.stringify(sig.st) === '[0.5,1]', sig.st);
ok('a fresh array builds a fresh list', lampsOf([{ cls: 'x' }]).length === 0 && lampsOf([{ cls: 'x' }]) !== lampsOf([{ cls: 'x' }]));
ok('null/undefined objects still returns []', lampsOf(null).length === 0 && lampsOf(undefined).length === 0);
console.log(`\n${pass + fail} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
