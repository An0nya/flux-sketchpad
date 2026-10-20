// Duv checks (js/cct.js): a manual green/magenta offset off the Planckian locus, per source.
// Run: node tests/duv.js   (exit 1 if any check fails)
// The baseline is main's cct.js at the pre-DU commit a3e3011, read from git, so "duv 0 is byte-identical" is checked against
// the old code, not against the new code with duv 0.
const { execFileSync } = require('child_process'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load');
const RF = load();
const C = RF.CCT, SP = RF.SourcePresets;
let fails = 0, n = 0;
const ok = (name, pass, detail) => { n++; if (!pass) fails++; console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : '')); };
const f = (a) => '[' + a.map((v) => v.toFixed(5)).join(', ') + ']';
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const uv = (x, y) => { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d]; };

// The pre-DU cct.js, run in its own sandbox so it cannot touch the new RF.
const baseSrc = execFileSync('git', ['show', 'a3e3011:js/cct.js'], { cwd: ROOT, encoding: 'utf8' });
const base = { RF: {} };
vm.runInNewContext(baseSrc, base, { filename: 'cct.js@a3e3011' });
const B = base.RF.CCT;

const SWEEP = [0, NaN, 1000, 1667, 1900, 2222, 2223, 3999, 4000, 4001, 5928, 6500, 10000, 25000, 30000];
const KS = [];
for (let K = 1500; K <= 26000; K += 37) KS.push(K);
for (const K of SWEEP) KS.push(K);

// 1. duv 0, unset, null and NaN all give main's exact numbers, for every K in the sweep.
{
  let bad = [];
  for (const K of KS) {
    const want = B.cctToRGB(K);
    for (const d of [undefined, 0, -0, NaN, null, Infinity]) {
      const got = C.cctToRGB(K, d);
      if (!(got[0] === want[0] && got[1] === want[1] && got[2] === want[2])) bad.push(K + '/' + d);
    }
  }
  ok('duv 0 / unset / NaN / null: byte-identical to main for ' + KS.length + ' K values', bad.length === 0, bad.slice(0, 5).join(' '));
}

// 2. lampRGB with sources that carry no duv: byte-identical to main's lampRGB.
{
  const mixes = [
    [{ cct: 3000, power: 800 }, { cct: 6500, power: 200 }],
    [{ cct: 5928 }, { power: 500 }],
    [{ power: 300 }],
    [{ cct: 4000, power: 1 }, { cct: 4000, power: 1 }],
  ];
  const bad = mixes.filter((m) => { const a = C.lampRGB(m), b = B.lampRGB(m); return !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]); });
  ok('lampRGB with no duv: byte-identical to main for ' + mixes.length + ' source mixes', bad.length === 0, JSON.stringify(bad));
}

// 3. Sign: + duv raises green (g/r and g/b), - duv lowers it, at the YLX CCT and at 6500 K.
{
  for (const K of [5928, 6500]) {
    const z = C.cctToRGB(K), p = C.cctToRGB(K, 0.0189), m = C.cctToRGB(K, -0.0189);
    const gr = (c) => c[1] / c[0], gb = (c) => c[1] / c[2];
    ok('+0.0189 at ' + K + ' K raises g/r and g/b over duv 0', gr(p) > gr(z) && gb(p) > gb(z), 'g/r ' + gr(z).toFixed(4) + ' -> ' + gr(p).toFixed(4) + ', g/b ' + gb(z).toFixed(4) + ' -> ' + gb(p).toFixed(4));
    ok('-0.0189 at ' + K + ' K lowers g/r and g/b under duv 0 (pinker)', gr(m) < gr(z) && gb(m) < gb(z), 'g/r ' + gr(m).toFixed(4) + ', g/b ' + gb(m).toFixed(4));
    console.log('    ' + K + ' K: duv -0.0189 ' + f(m) + ' | duv 0 ' + f(z) + ' | duv +0.0189 ' + f(p));
  }
}

// 4. Magnitude, checked independently: take the rgb cctToRGB gives for 6500 K, duv +0.0189, convert it back to CIE xy with the
// forward sRGB (D65) matrix, and compare with the chromaticity the geometry asked for (C.shiftedXy). Luminance is 1, so Y = 1.
{
  const toXy = (c) => { const X = 0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2], Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], Z = 0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]; return [X / (X + Y + Z), Y / (X + Y + Z)]; };
  const p = C.cctToRGB(6500, 0.0189), [xr, yr] = toXy(p), [xw, yw] = C.shiftedXy(6500, 0.0189);
  ok('6500 K, duv +0.0189: the rgb round-trips to the shifted chromaticity (1e-3)', Math.abs(xr - xw) < 1e-3 && Math.abs(yr - yw) < 1e-3, 'rgb xy=(' + xr.toFixed(4) + ', ' + yr.toFixed(4) + ') target=(' + xw.toFixed(4) + ', ' + yw.toFixed(4) + ')');
  ok('6500 K, duv +0.0189: the shift is large enough to see (y up by more than 0.02)', yw - C.xyOf(6500)[1] > 0.02, 'dy=' + (yw - C.xyOf(6500)[1]).toFixed(4));
  console.log('    6500 K duv +0.0189 rgb ' + f(p) + ' (for scale: duv 0.0189 is a large tint, the owner\'s "very green")');
}

// 5. Luminance stays exactly 1 across the K sweep, at several duv values, including the clamp limits.
{
  let worst = 0;
  for (const K of KS.filter((k) => Number.isFinite(k) && k > 0)) for (const d of [-0.05, -0.0189, 0.0189, 0.05]) worst = Math.max(worst, Math.abs(lum(C.cctToRGB(K, d)) - 1));
  ok('Rec.709 luminance 1 within 1e-12 for every K and duv in {-0.05, -0.0189, +0.0189, +0.05}', worst < 1e-12, 'worst ' + worst.toExponential(2));
}

// 6. Bounds: duv is clamped to +-0.05, so anything past it gives the same colour as the limit.
{
  const a = C.cctToRGB(6500, 0.5), b = C.cctToRGB(6500, 0.05), c = C.cctToRGB(6500, -0.5), d = C.cctToRGB(6500, -0.05);
  ok('duv 0.5 is clamped to 0.05', a[0] === b[0] && a[1] === b[1] && a[2] === b[2], f(a) + ' vs ' + f(b));
  ok('duv -0.5 is clamped to -0.05', c[0] === d[0] && c[1] === d[1] && c[2] === d[2], f(c) + ' vs ' + f(d));
}

// 7. Geometry, exact: the shift is a unit normal to the locus, length duv in CIE 1960 (u,v), pointing +v. Checked at the fit's
// band seams (2222 K, 4000 K), both ends of the range (where K is clamped before the finite difference), and 6500 K.
{
  const bad = [];
  for (const K of [1667, 2222, 4000, 6500, 25000]) {
    const d = 0.02;
    const [x0, y0] = C.xyOf(K), [u0, v0] = uv(x0, y0);
    const [xs, ys] = C.shiftedXy(K, d), [u1, v1] = uv(xs, ys);
    const len = Math.hypot(u1 - u0, v1 - v0);
    // tangent: the +-1 % chord of the locus (K clamped first), the definition the shift is built on
    const Kc = Math.min(25000, Math.max(1667, K)), Ka = Math.max(1667, Kc * 0.99), Kb = Math.min(25000, Kc * 1.01);
    const [ua, va] = uv(...C.xyOf(Ka)), [ub, vb] = uv(...C.xyOf(Kb));
    const tu = ub - ua, tv = vb - va, tl = Math.hypot(tu, tv);
    const dot = ((u1 - u0) * tu + (v1 - v0) * tv) / (len * tl);
    if (Math.abs(len - d) > 1e-9) bad.push(K + ' len ' + len.toFixed(9));
    if (Math.abs(dot) > 1e-3) bad.push(K + ' not perpendicular (cos ' + dot.toExponential(2) + ')');
    if (!(v1 > v0)) bad.push(K + ' not +v');
  }
  ok('shift is a unit normal to the locus, length duv in uv, pointing +v, at 1667, 2222, 4000, 6500, 25000 K', bad.length === 0, bad.join('; '));
}

// 8. Non-finite and out-of-range inputs never produce NaN.
{
  const bad = [];
  for (const K of [1667, 6500, 25000]) for (const d of [NaN, Infinity, -Infinity, 1e9, -1e9]) { const c = C.cctToRGB(K, d); if (!c.every(Number.isFinite)) bad.push(K + '/' + d); }
  ok('duv NaN, +-Infinity, +-1e9: finite output', bad.length === 0, bad.join(' '));
}

// 9. The YLX N3535B preset: its CCT resolves to 5928 K and it carries duv 0.0189; no other preset carries duv.
{
  const ylx = SP.PRESETS['k3-221071'];
  ok('YLX N3535B: cct 5928 K from the table', C.presetCct(ylx, 'k3-221071') === 5928, 'cct=' + C.presetCct(ylx, 'k3-221071'));
  ok('YLX N3535B: presetDuv 0.0189', C.presetDuv('k3-221071') === 0.0189, String(C.presetDuv('k3-221071')));
  const others = Object.keys(SP.PRESETS).filter((id) => id !== 'k3-221071' && C.presetDuv(id) !== undefined);
  ok('no other preset has a duv', others.length === 0, others.join(' '));
}

// 10. A source with duv but no cct stays white: duv is an offset from a CCT's locus, so it needs one.
{
  const c = C.lampRGB([{ power: 100, duv: 0.02 }]);
  ok('duv without cct: lampRGB stays [1,1,1]', c[0] === 1 && c[1] === 1 && c[2] === 1, f(c));
}

// 11. lampRGB passes each source's duv through: a mix with a tinted source differs from the same mix without duv.
{
  const withD = C.lampRGB([{ cct: 5928, duv: 0.0189, power: 1000 }]), without = C.lampRGB([{ cct: 5928, power: 1000 }]);
  ok('lampRGB: a 5928 K source with duv 0.0189 differs from the same source without duv', withD[1] / withD[0] > without[1] / without[0], f(withD) + ' vs ' + f(without));
  ok('lampRGB: the duv tint keeps luminance 1', Math.abs(lum(withD) - 1) < 1e-12, 'L=' + lum(withD));
  console.log('    5928 K: without duv ' + f(without) + ' | with duv 0.0189 ' + f(withD));
}

console.log('\nDuv checks: ' + (n - fails) + ' passed, ' + fails + ' failed, of ' + n);
process.exit(fails ? 1 : 0);
