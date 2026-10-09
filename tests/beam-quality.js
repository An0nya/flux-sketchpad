// Beam-quality report (headless): node tests/beam-quality.js — exits 1 on failure.
// Oracles are synthetic beams with closed-form answers: a Gaussian's level-f contour sits at σ·√(2 ln 1/f) from its centre.
const { load } = require('./load.js'); const RF = load(); const Q = RF.BeamQuality;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const gauss = (cd, h0, v0, sh, sv) => (h, v) => cd * Math.exp(-(((h - h0) / sh) ** 2) / 2 - (((v - v0) / sv) ** 2) / 2);
const sum = (...fs) => (h, v) => fs.reduce((s, f) => s + f(h, v), 0);
const halfW = (s, f) => s * Math.sqrt(2 * Math.log(1 / f));
const BEAMS = {
  // one smooth hotspot: widths and heights at 1/3, 1/4, 1/5 follow the closed form; one lobe; no foreground, no stray
  hotspot: gauss(40000, 1.5, -1.5, 4, 0.8),
  // two equal peaks 8.75° apart with a deep valley: two lobes (v3's round-filament beam)
  twoLobes: sum(gauss(40000, 1.5, -2, 1.5, 1.5), gauss(40000, -7.25, -4.5, 1.5, 1.5)),
  // the same two peaks overlapping so the dip is < 20 %: one lobe
  shallowDip: sum(gauss(40000, 1.5, -2, 2.5, 1.5), gauss(36000, -2.5, -2, 2.5, 1.5)),
  // a hotspot plus a hot foreground spot at 6° D, 40 % of the peak
  hotForeground: sum(gauss(40000, 1.5, -1.5, 4, 0.8), gauss(16000, -2, -6, 1, 1)),
  // the brightest thing is a side lobe at 13° L (SQM, ECE): stray > 1, the peak stays in the centre box
  sideLobe: sum(gauss(30000, 1.5, -1.5, 3, 0.8), gauss(38000, -13, -4, 2, 1)),
  // the hotspot with a ±40 % ripple every 2° across: blotchy
  rippled: (h, v) => gauss(40000, 1.5, -1.5, 4, 0.8)(h, v) * (1 + 0.4 * Math.sin(2 * Math.PI * h / 2)),
  // a flat, hard-edged plateau ±15° (control for the dropouts)
  plateau: (h, v) => (Math.abs(h) <= 15 && v <= -1 && v >= -4 ? 30000 : 0),
  // a flat plateau ±15° with a 0.75° dark stripe at 6° L: bridged, full width, some holes
  smallDropout: (h, v) => (Math.abs(h) <= 15 && v <= -1 && v >= -4 && !(h > -6.375 && h < -5.625) ? 30000 : 0),
  // the same plateau with a 3° dark stripe: not bridged, the core stops at the stripe
  bigDropout: (h, v) => (Math.abs(h) <= 15 && v <= -1 && v >= -4 && !(h > -7.5 && h < -4.5) ? 30000 : 0),
};
const R = {}; for (const k in BEAMS) R[k] = Q.measure(BEAMS[k]);
const step = Q.DEF.dh, vstep = Q.DEF.dv;

// 1. hotspot: closed-form widths/heights (± one grid step), peak position, one lobe, quiet foreground/stray
{ const r = R.hotspot; let good = true; const d = [];
  for (const [key, f] of [['1/3', 1 / 3], ['1/4', 1 / 4], ['1/5', 1 / 5]]) {
    const w = 2 * halfW(4, f), h = 2 * halfW(0.8, f), c = r.core[key]; d.push(key + ' ' + c.width + '×' + c.height + ' (want ' + w.toFixed(2) + '×' + h.toFixed(2) + ')');
    if (Math.abs(c.width - w) > step + 1e-9 || Math.abs(c.height - h) > vstep + 1e-9) good = false; }
  ok('Gaussian hotspot: core size = closed form at 1/3, 1/4, 1/5', good, d.join('; '));
  ok('Gaussian hotspot: peak at 1.5R 1.5D, one lobe', r.peak.h === 1.5 && r.peak.v === -1.5 && r.lobes.length === 1, JSON.stringify(r.peak) + ', lobes ' + r.lobes.length);
  ok('Gaussian hotspot: no foreground, no stray', r.foreground.peakRatio < 0.01 && r.stray.ratio < 0.01, 'fg ' + r.foreground.peakRatio + ', stray ' + r.stray.ratio); }
// 1b. roughness: a smooth hotspot reads near 0, the same hotspot with a 2° ripple reads high
ok('smooth hotspot → roughness < 0.05', R.hotspot.roughness < 0.05, 'roughness ' + R.hotspot.roughness);
ok('2° ±40 % ripple → roughness > 0.2', R.rippled.roughness > 0.2, 'roughness ' + R.rippled.roughness);
ok('a bridged dropout adds roughness to a flat plateau', R.smallDropout.roughness > R.plateau.roughness + 0.01, 'plateau ' + R.plateau.roughness + ' (its hard edges), with a 0.75° dropout ' + R.smallDropout.roughness);
// 2. lobes
ok('two separated peaks → 2 lobes', R.twoLobes.lobes.length === 2, JSON.stringify(R.twoLobes.lobes));
ok('two peaks with a < 20 % dip → 1 lobe', R.shallowDip.lobes.length === 1, JSON.stringify(R.shallowDip.lobes));
// 3. foreground
ok('hot spot at 6D → foreground ≈ 0.4 of peak', Math.abs(R.hotForeground.foreground.peakRatio - 0.4) < 0.02, JSON.stringify(R.hotForeground.foreground));
// 4. stray side lobe
ok('side lobe brighter than the centre → stray > 1, peak stays central', R.sideLobe.stray.ratio > 1 && Math.abs(R.sideLobe.peak.h) <= 5, 'stray ' + JSON.stringify(R.sideLobe.stray) + ', peak ' + JSON.stringify(R.sideLobe.peak));
// 5. dropouts
{ const a = R.smallDropout.core['1/4'], b = R.bigDropout.core['1/4'];
  ok('0.75° dropout is bridged: full 30° width, holes > 0', Math.abs(a.width - 30.25) <= step && R.smallDropout.holes > 0, 'width ' + a.width + ', holes ' + R.smallDropout.holes);
  ok('3° dropout is not bridged: core ends at the stripe', b.h[0] > -5 && R.bigDropout.holes === 0, 'extent ' + b.h.join('…') + ', holes ' + R.bigDropout.holes); }
// 6. aim: reading the same beam through Road.beamOf with the judge's shift moves everything by that shift
{ const shifted = (h, v) => BEAMS.hotspot(h, v + 1);   // beam 1° lower on the road: what was at v now shows at v − 1
  const r = Q.measure(shifted); ok('aimed 1° lower → peak and core 1° lower, same size', r.peak.v === -2.5 && r.core['1/4'].height === R.hotspot.core['1/4'].height, 'peak ' + r.peak.v + ', height ' + r.core['1/4'].height); }
// 7. negative control: a beam dark in the centre box reports empty, not a made-up peak
{ const r = Q.measure(gauss(40000, -20, -2, 1, 1)); ok('nothing in the centre box → empty report', r.empty === true, JSON.stringify(r).slice(0, 80)); }

if (require.main === module) { console.log(fails ? fails + ' FAILED' : 'all passed'); process.exitCode = fails ? 1 : 0; }
module.exports = { BEAMS, R };
