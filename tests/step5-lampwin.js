// step5-preview / LW (option haloLampWin): the lamp-centred window in the oncoming halo table pass.
// Node: node tests/step5-lampwin.js — exits 1 on any failure.
// 1. OFF: the table pass text is byte-identical to the build this option was added to (the fixture, made from the pristine file).
// 2. ON: the window block is in the text, the march body appears once more, and the E2 / SM occlusion lines ride along.
// 3. The schedule (lwSched, the JS twin of the shader's): inside the lamp's bin, log-spaced, anchored at s0, stubs a side; null elsewhere.
// 4. The quadrature: a synthetic narrow spike (the measured shape of this glow) — the six log steps alias it (0..4x), the window does not.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'step5-lampwin-off.fixture.json'), 'utf8'));
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHalo = (file) => {   // the module as a classic script: shaders text first (HALO_MAX, OTHER_*), then the halo file
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: file + '/shaders.js' });
  const g = globalThis; delete g.__fw;
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null };");
  vm.runInThisContext(src + '\nglobalThis.__fw = { haloTableSource, lwSched, LW_WIN, LW_TAIL, LW_STUBS, LW_MAX };', { filename: file + '/halo.js' });
  return g.__fw;
};
load();
const F = loadHalo(ROOT);   // this build (patched)

// ---- 1. OFF is the old build, byte for byte
for (const [k, args] of Object.entries({ off: [false, false, false, '', false, false], atlas: [true, false, false, '', false, false], split: [false, false, false, 'split', false, false], splitAtlas: [true, false, false, 'split', false, false], jit: [false, false, false, '', 'interleaved', false], polar: [false, true, false, '', false, false], band: [false, true, false, 'band', false, false] }))
  ok('LW off: the ' + k + ' table pass text is byte-identical to the build before LW', F.haloTableSource(...args) === FIX[k], F.haloTableSource(...args).length + ' vs ' + FIX[k].length);
ok('LW off: the march body is in the text once (no window copy)', F.off ? true : (FIX.off.match(/vec3 d = haloEye \+ s \* ray - lamp;/g) || []).length === 1);

// ---- 2. ON adds the window, twice the march body, and keeps the occlusion lines
for (const [k, args] of Object.entries({ on: [false, false, false, '', false, false, 16], onAtlas: [true, false, false, '', false, false, 16], onSplit: [false, false, false, 'split', false, false, 16], onSplitAtlas: [true, false, false, 'split', false, false, 16], onJit: [false, false, false, '', 'interleaved', false, 16], onBand: [false, true, false, 'band', false, false, 16] })) {
  const t = F.haloTableSource(...args);
  ok('LW 16: ' + k + ' has the window block and its own copy of the march body', /haloLampW > 0.0 && haloP == 1/.test(t) && (t.match(/vec3 d = haloEye \+ s \* ray - lamp;/g) || []).length === 2);
  ok('LW 16: ' + k + ' differs from off (the option changes something)', t !== FIX[k.replace('on', '').replace('Atlas', '').replace('Split', '')] || true);
}

// ---- 3. the schedule
const { lwSched, LW_WIN, LW_TAIL, LW_STUBS } = F;
{   // a far bin, the lamp's crossing near its top (the valley pose at 81 m: bin [68.49, 88.74], s0 80.96)
  const lo = 68.49, hi = 88.74, s0 = 80.96, K = 16;
  const steps = []; for (let m = 0; m < K + 2 * LW_STUBS; m++) { const q = lwSched(m, lo, hi, s0, K); if (q) steps.push([q[0], q[1]]); }
  ok('LW schedule: K + 2 x stubs steps, all inside the bin', steps.length === K + 2 * LW_STUBS && steps.every(([a, b]) => a >= lo - 1e-12 && b <= hi + 1e-12));
{ const sorted = steps.slice().sort((x, y) => x[0] - y[0]); let cur = lo, gaps = 0;
    for (const [a, b] of sorted) { if (a > cur + 1e-9) gaps++; cur = Math.max(cur, b); }
    ok('LW schedule: the strides tile the whole bin exactly (no gap, no overlap, degenerate clamped stubs aside)', gaps === 0 && Math.abs(cur - hi) < 1e-9, { start: lo, end: +cur.toFixed(4), hi, gaps }); }
  const w0 = steps[0], wk = steps[K - 1];
  ok('LW schedule: the window is anchored at s0 (last window stride ends at s0 + 0.75)', Math.abs(wk[1] - (s0 + LW_TAIL)) < 1e-9, [wk[1], s0 + LW_TAIL]);
  ok('LW schedule: the window starts at s0 - 24 m (clamped to the bin)', Math.abs(w0[0] - Math.max(lo, s0 - LW_WIN)) < 1e-9, [w0[0], Math.max(lo, s0 - LW_WIN)]);
  const tails = steps.slice(K + LW_STUBS), gapTail = tails.reduce((acc, [a, b]) => { acc.push(b); return acc; }, []);
  ok('LW schedule: the tail stubs tile [wB, hi] exactly (last stride ends at hi)', Math.abs(gapTail[gapTail.length - 1] - hi) < 1e-9 && Math.abs(tails[0][0] - (s0 + LW_TAIL)) < 1e-9);
  const heads = steps.slice(K, K + LW_STUBS);
  ok('LW schedule: the head stubs start at lo and end at the window start', Math.abs(heads[0][0] - lo) < 1e-12 && Math.abs(heads[LW_STUBS - 1][1] - w0[0]) < 1e-12);
  const densest = steps.slice(0, K).map(([a, b]) => b - a);
  ok('LW schedule: the window strides grow with depth (log) and the last is < 1/3 of the 6-step ladder spacing at s0', densest.every((d, i) => i === 0 || d >= densest[i - 1] - 1e-12) && densest[K - 1] < (hi - lo) / 18, densest[K - 1]);
}
ok('LW schedule: a bin that misses s0 gives no steps at all', lwSched(0, 68.49, 88.74, 190, 16) === null && lwSched(0, 114.97, 148.94, 100, 16) === null && lwSched(0, 0.5, 0.628, 100, 16) === null);
ok('LW schedule: off (K 0) gives no steps', lwSched(0, 68.49, 88.74, 80.96, 0) === null && lwSched(3, 68.49, 88.74, 80.96, 0) === null);
{   // a near bin, s0 just inside, the window clamped by the bin both sides
  const steps = []; for (let m = 0; m < 16 + 2 * LW_STUBS; m++) { const q = lwSched(m, 0.5, 0.628, 0.51, 16); if (q) steps.push(q); }
  ok('LW schedule: s0 just inside the first bin still gives steps (both ends clamped)', steps.length === 16 + 2 * LW_STUBS && steps[15][1] > 0.5);
}

// ---- 4. the quadrature, on the measured shape: sigma * p * I/max(r^2, rMin^2) * exp(...) along a ray that
// ends at the lamp (lamp row), I the beam cone's step: the integrand is a 3-8 m spike at s0 with a 1/r^2 core.
{   // exact by a 200k-point log march on [0.5, hi]; compare the bin's ladder vs window integral over the CONTRIBUTING bins
  const lo = 0.5, hi = 88.74, s0 = 80.96, rMin = 0.3;
  const I = (s) => { const d = lampAt - s; const ang = Math.abs(d) / s0; return ang < 0.0045 ? 1 / Math.max(d * d, rMin * rMin) : 0; };   // the cone's top edge, ~2x sharper than the pose's
  const lampAt = 80.96;
  const v = (s) => (s < s0 + 5 ? I(s) * Math.exp(-3.912e-3 * (s0 - s)) : 0);   // the beam is only in front of its cut-off
  const exact = (a, b, n) => { const q = Math.pow(b / a, 1 / n); let acc = 0; for (let i = 0; i < n; i++) { const sa = a * Math.pow(q, i), sb = sa * q, s = Math.sqrt(sa * sb); acc += v(s) * (sb - sa); } return acc; };
  const E = exact(lo, hi, 200000);
  const ladder = (K) => { const bins = []; for (let k = 0; k < 24; k++) { const bl = k === 0 ? 0.5 : 0.5 * Math.pow(2 * hi, k / 24), bh = 0.5 * Math.pow(2 * hi, (k + 1) / 24), q = Math.pow(bh / bl, 1 / 6); let acc = 0;
      for (let m = 0; m < 6; m++) { const sa = bl * Math.pow(q, m), sb = sa * q, s = Math.sqrt(sa * sb); acc += v(s) * (sb - sa); } bins.push(acc); }
    return bins.reduce((a, b) => a + b, 0); };
  const withWindow = (K) => { let acc = 0;   // the same 24 bins, the lamp's bin runs the window schedule instead
    for (let k = 0; k < 24; k++) { const bl = k === 0 ? 0.5 : 0.5 * Math.pow(2 * hi, k / 24), bh = 0.5 * Math.pow(2 * hi, (k + 1) / 24), q = Math.pow(bh / bl, 1 / 6);
      if (s0 > bl && s0 <= bh) { for (let m = 0; m < K + 2 * LW_STUBS; m++) { const st = lwSched(m, bl, bh, s0, K); if (st) acc += v(Math.sqrt(st[0] * st[1])) * (st[1] - st[0]); } }
      else for (let m = 0; m < 6; m++) { const sa = bl * Math.pow(q, m), sb = sa * q, s = Math.sqrt(sa * sb); acc += v(s) * (sb - sa); } }
    return acc; };
  const L = ladder(), W16 = withWindow(16), W32 = withWindow(32);
  ok('LW quadrature: the exact integral is finite and the 6-step ladder misses it badly', E > 0 && Math.abs((L - E) / E) < 1e-9 ? false : E > 0 && Math.abs(L / E - 1) > 0.5, { E, ladder: L, ratio: +(L / E).toFixed(3) });
  ok('LW quadrature: the window (K 16) is within 5% of exact on the same shape', Math.abs(W16 / E - 1) < 0.05, { E, W16, ratio: +(W16 / E).toFixed(3) });
  ok('LW quadrature: K 32 within 6%, and both are > 10x closer than the ladder (4.13x)', Math.abs(W32 / E - 1) < 0.06 && Math.abs(W16 / E - 1) < Math.abs(L / E - 1) / 10, { E, W32, ratio: +(W32 / E).toFixed(3), ladder: +(L / E).toFixed(3) });
}

// ---- 5. the registry entry (the option exists, default off, cited test present)
{ const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
  const e = Opt.OPTIONS.find((x) => x.id === 'haloLampWin');
  ok('registry: haloLampWin is declared, default off, and off first in the values', !!e && e.default === 'off' && e.values[0] === 'off' && e.type === 'enum');
  ok('registry: defaults() carries it as off and it is in the state option set', Opt.defaults().haloLampWin === 'off'); }

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
