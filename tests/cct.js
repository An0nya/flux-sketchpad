// CCT checks (js/cct.js): the Planckian formula, preset defaults, the lamp tint, and the unset-is-white rule.
// Run: node tests/cct.js   (exit 1 if any check fails)
const { load } = require('./load');
const RF = load();
const C = RF.CCT, SP = RF.SourcePresets;
let fails = 0, n = 0;
const ok = (name, pass, detail) => { n++; if (!pass) fails++; console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : '')); };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const f = (a) => '[' + a.map((v) => v.toFixed(5)).join(', ') + ']';

// 1. Positive control: the xy fit at 2856 K should match CIE Illuminant A (0.4476, 0.4074).  Checks the transcribed coefficients.
{ const [x, y] = C.xyOf(2856); ok('xy at 2856 K within 0.003 of CIE Illuminant A (0.4476, 0.4074) [positive control]', Math.abs(x - 0.4476) < 0.003 && Math.abs(y - 0.4074) < 0.003, 'xy=(' + x.toFixed(5) + ', ' + y.toFixed(5) + ')'); }

// 2. 6504 K should be near white.  EXPECTED TO FAIL as specified: Kim et al. 2002's blackbody locus at 6504 K is off the sRGB white by ~4 % in red.
{ const c = C.cctToRGB(6504), dev = Math.max(...c.map((v) => Math.abs(v - 1))); ok('cctToRGB(6504) within 3 % of [1,1,1]', dev <= 0.03, f(c) + ' max dev ' + (100 * dev).toFixed(2) + ' %'); }

// 3. 3200 K: warm (R > G > B) and luminance exactly 1.
{ const c = C.cctToRGB(3200); ok('cctToRGB(3200): R > G > B', c[0] > c[1] && c[1] > c[2], f(c)); ok('cctToRGB(3200): Rec.709 luminance 1 ± 1e-6', Math.abs(lum(c) - 1) < 1e-6, 'L=' + lum(c).toFixed(9)); }

// 4. Luminance 1 at every K in range; B/R monotonic increasing over 2000–10000 K.
{ let worst = 0, mono = true, prev = -Infinity;
  for (let K = 2000; K <= 10000; K += 50) { const c = C.cctToRGB(K); worst = Math.max(worst, Math.abs(lum(c) - 1)); const r = c[2] / c[0]; if (r < prev) mono = false; prev = r; }
  ok('luminance 1 ± 1e-6 across 2000–10000 K', worst < 1e-6, 'max |L-1|=' + worst.toExponential(2));
  ok('B/R increases monotonically with K over 2000–10000 K', mono); }

// 5. Preset parse: stated single K values. Ranges are skipped.  Halogen and HID get the assumed defaults.
{ const named = Object.entries(SP.PRESETS).filter(([, p]) => !p.halogen && !p.hid).map(([id, p]) => [id, C.presetCct(p), p.label]).filter(([, k]) => k !== undefined);
  ok('at least 5 named LED presets get a stated K', named.length >= 5, 'count=' + named.length);
  for (const [id, k, label] of named.slice(0, 6)) console.log('    ' + id + ' → ' + k + ' K   (' + label.slice(0, 70) + ')');
  const halo = Object.values(SP.PRESETS).filter((p) => p.halogen).every((p) => C.presetCct(p) === 3200);
  const hid = Object.values(SP.PRESETS).filter((p) => p.hid).every((p) => C.presetCct(p) === 4200);
  ok('halogen presets default to 3200 K (assumed)', halo);
  ok('HID presets default to 4200 K (assumed)', hid);
  ok('range label "5000 - 6500 K" is not a single value', C.presetCct({ label: 'Cree CLP6B (5000 - 6500 K, low-power)' }) === undefined);
  ok('coloured LED "PC Amber 1500K class" gets no CCT', C.presetCct({ label: 'Cree XLamp XP-E2 Q4 Y2 PC Amber 1500K class, domed' }) === undefined);
}

// 6. Unset is white: a scene with no cct gives lampRGB exactly [1,1,1]; a tinted source does not.
{ const sc = RF.State.testScene(); const srcs = [sc.source].concat(sc.emitters || []);
  ok('testScene source has no cct', sc.source.cct === undefined);
  const w = C.lampRGB(srcs);
  ok('scene with no cct gives lampRGB exactly [1,1,1]', w[0] === 1 && w[1] === 1 && w[2] === 1, f(w));
  ok('lampRGB of non-finite / zero cct is white', C.lampRGB([{ cct: 0 }, { cct: NaN }]).every((v, i) => v === [1, 1, 1][i]));
  const t = C.lampRGB([Object.assign({}, sc.source, { cct: 3000 })]);
  ok('a 3000 K source tints the lamp (R > B)', t[0] > t[2], f(t));
  const mix = C.lampRGB([Object.assign({}, sc.source, { cct: 3000, power: 1000 }), { power: 1000 }]);
  ok('mix with an untinted emitter of equal flux is halfway to white', Math.abs(mix[0] - (C.cctToRGB(3000)[0] + 1) / 2) < 1e-12, f(mix));
  ok('mixed tint keeps luminance 1', Math.abs(lum(mix) - 1) < 1e-9, 'L=' + lum(mix).toFixed(9));
}

console.log('\nCCT checks: ' + (n - fails) + ' passed, ' + fails + ' failed, of ' + n);
process.exit(fails ? 1 : 0);
