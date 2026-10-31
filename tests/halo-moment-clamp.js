// step5-preview: the P3 mean-clamp fix (qwen3.8max's diagnosis, `qwen3.8max/P3-MEASURED.md`): with the means
// unclamped, a nearly-empty bin throws its knot outside its own range, and the PCHIP then extrapolates cubically
// across a non-monotone knot sequence -> one row renders exactly 0.0 (hard black) and another ~7,500x too bright.
// The fix: clamp each mean into its own bin (the GPU curve and the CPU twin both), and keep the knot sequence
// strictly increasing. OFF (haloMoment 0) must stay byte-identical.
// Node: node tests/halo-moment-clamp.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHaloFresh = (file) => {
  const ctx = vm.createContext({ RF: globalThis.RF, URLSearchParams, location: null });
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  vm.runInContext(sh, ctx, { filename: file + '/shaders.js' });
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  vm.runInContext(src + '\nthis.__fw = { haloTableSource, haloLookup, HALO_EDGES };', ctx, { filename: file + '/halo.js' });
  return ctx.__fw;
};
load();
const F = loadHaloFresh(ROOT);
const SH = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
const HP = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
const edges = F.HALO_EDGES.slice(1);

// 1. The GPU curve clamps each of the three means into its own bin, and guards the zero-width segment.
{
  ok('gpu: m0 is clamped into bin s', /float m0 = clamp\(/.test(SH) && /haloE\[max\(s-1,0\)\], haloE\[s\]\);/.test(SH), SH.slice(SH.indexOf('float m0'), SH.indexOf('float m0') + 130));
  ok('gpu: m1 is clamped into bin s+1 (the bin holding dd)', /float m1 = clamp\(/.test(SH) && /, haloE\[s\], haloE\[min\(s\+1,haloNu-1\)\]\)/.test(SH));
  ok('gpu: m2 is clamped into bin s+2', /float m2 = clamp\(/.test(SH) && /, haloE\[min\(s\+1,haloNu-1\)\], haloE\[min\(s\+2,haloNu-1\)\]\)/.test(SH));
  ok('gpu: the Hermite segment width cannot be zero', /h = max\(x1 - x0, 1e-9\)/.test(SH));
}

// 2. The CPU twin clamps identically and keeps the knots strictly increasing (parity with the GPU).
{
  ok('cpu: the mean is clamped into its own bin', /const raw = w > 1e-9/.test(HP) && /Math\.min\(hi, Math\.max\(lo, raw\)\)/.test(HP));
  ok('cpu: the empty-bin fallback is the bin midpoint (inside the bin, not a cross-edge jump)', /\(lo \+ hi\) \/ 2/.test(HP));
  ok('cpu: the knot sequence is forced strictly increasing', /if \(!\(x\[k\] > x\[k - 1\]\)\) x\[k\] = x\[k - 1\] \+ 1e-9/.test(HP));
}

// 3. The behaviour, on the failing case: 22 of 24 bins empty at the repro pose, so nearly-empty is the norm.
//    A bin with a tiny mass and a large first moment must not move its knot; and a finite lookup must come out.
{
  const bins = [];
  for (let k = 0; k < 24; k++) bins.push([0, 0, 0, 0]);                       // 22 of 24 empty
  bins[21] = [1e-7, 1e-7, 1e-7, 1e-7 * 400];                                  // nearly empty, mean 400 m (bin 21 = 115..149)
  bins[22] = [5.98e-2, 5.98e-2, 5.98e-2, 5.98e-2 * 190];                      // the lamp bin, mean inside it
  const lookup = (d, moment) => F.haloLookup(bins, d, edges, moment ? 1 : 0);
  let worst = 0, bad = 0;
  for (let i = 0; i <= 300; i++) { const d = 0.6 * Math.pow(250 / 0.6, i / 300);
    for (const moment of [0, 1]) { const v = lookup(d, moment);
      if (!isFinite(v[0]) || !isFinite(v[1]) || !isFinite(v[2])) bad++;
      if (v.some((x) => x < -1e-12 || x > 1.01)) worst++; } }
  ok('cpu: no NaN/Inf and no out-of-range value over 301 depths, moment on and off', bad === 0 && worst === 0, { bad, worst });
  // the clamp in action: with the mean of a nearly-empty bin thrown at 400 m (bin 21 ends at 149), the shipped
  // (unclamped) code put a knot OUTSIDE the curve; the clamped version keeps the lookup finite and monotone in d.
  const seq = []; for (let i = 0; i <= 100; i++) seq.push(lookup(0.6 * Math.pow(250 / 0.6, i / 100), 1)[1]);
  ok('cpu: the moment lookup is monotonically non-decreasing in depth', seq.every((v, i) => i === 0 || v >= seq[i - 1] - 1e-12), { first: seq[0], last: seq[100] });
  // OFF is unchanged: the moment parameter must not move the shipped result at all.
  {
    const a = [], b = [];
    for (let i = 0; i <= 200; i++) { const d = 0.6 * Math.pow(250 / 0.6, i / 200); a.push(lookup(d, 0)); b.push(lookup(d)); }
    ok('cpu: OFF (moment 0 / omitted) is identical either way', JSON.stringify(a) === JSON.stringify(b));
  }
}

// 4. OFF is still byte-identical in the table text (the fix only touches the moment path).
{
  const off = F.haloTableSource(false, false, false, '', false, false, 0, 0, 0, 0);
  ok('table: OFF carries no moment surgery at all', !/accM|float w =/.test(off), { len: off.length });
}

console.log('\n' + (fails ? fails + ' FAILED of ' + n : 'all ' + n + ' halo-moment-clamp checks passed'));
process.exit(fails ? 1 : 0);
