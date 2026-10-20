// SF2: near-eye fade range (look.scatterNearFadeRange) and scatter gain (look.scatterGain), CPU twin and helpers.
// Node: node tests/scatter-fade-gain.js — exits 1 on any failure. The GPU side (uniforms, cache key, slider) is checked on the page by tests/regress/SF-silhouette-fade.js.
const fs = require('fs'), path = require('path');
const { load } = require('./load.js');
const pace = require('../js/table-pace.js');
const jitters = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];
function run(RF, ok) {
  const D = RF.Drive;
  const base = { eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lampRGB: [1, 1, 1] };
  const dir = (() => { const r = [1, 0.02, -0.15], L = Math.hypot(...r); return r.map((x) => x / L); })();
  const bins = (look) => jitters.map((j) => D.scatterTableBins(Object.assign({}, base, { look: Object.assign({ visibility: 200 }, look) }), dir, j, 48));
  const avgAt = (bs, d, gain) => bs.reduce((a, b) => a + D.scatterTableAt(b, d, gain), 0) / bs.length;

  // 1. range names and back-compat with saved options
  ok('SF2 range: no option resolves to medium (the old default)', pace.fadeRangeName({}) === 'medium');
  ok("SF2 range: saved scatterNearFade 'on' is medium, 'off' is off", pace.fadeRangeName({ scatterNearFade: 'on' }) === 'medium' && pace.fadeRangeName({ scatterNearFade: 'off' }) === 'off');
  ok('SF2 range: scatterNearFadeRange wins over the saved on/off', pace.fadeRangeName({ scatterNearFade: 'off', scatterNearFadeRange: 'long' }) === 'long');
  ok('SF2 range: an unknown range name falls back to the saved on/off', pace.fadeRangeName({ scatterNearFade: 'off', scatterNearFadeRange: 'huge' }) === 'off');
  ok('SF2 range: short 0.5-3 m, medium 1-10 m, long 2-20 m, off has no pair', JSON.stringify(pace.fadeRangeOf({ scatterNearFadeRange: 'short' })) === '[0.5,3]' && JSON.stringify(pace.fadeRangeOf({ scatterNearFadeRange: 'medium' })) === '[1,10]' && JSON.stringify(pace.fadeRangeOf({ scatterNearFadeRange: 'long' })) === '[2,20]' && pace.fadeRangeOf({ scatterNearFadeRange: 'off' }) === null);

  // 2. the CPU twin copies match the helper constants (classic script cannot import the module)
  const twinSrc = fs.readFileSync(path.join(__dirname, '../js/drive.js'), 'utf8');
  ok('SF2 twin: drive.js range copies match js/table-pace.js', ['short: [0.5, 3]', 'medium: [1.0, 10.0]', 'long: [2.0, 20.0]'].every((t) => twinSrc.includes(t)));

  // 3. short removes less near-eye scatter than long (removed share at 20 m, vs the fade off table)
  const off = bins({ scatterNearFadeRange: 'off' }), sh = bins({ scatterNearFadeRange: 'short' }), lo = bins({ scatterNearFadeRange: 'long' });
  const ref = avgAt(off, 20), removed = (bs) => 1 - avgAt(bs, 20) / ref;
  ok('SF2 fade: short removes less than long at 20 m', removed(sh) < removed(lo), 'short ' + (100 * removed(sh)).toFixed(1) + ' %, long ' + (100 * removed(lo)).toFixed(1) + ' %');
  ok('SF2 fade: every fade range removes some near-eye scatter (short and long both below the fade-off table at 20 m)', removed(sh) > 0 && removed(lo) > 0);

  // 4. default (medium) is the SE3 table, exactly: saved 'on', an explicit 'medium', and no option at all give the same bins
  const bOn = bins({ scatterNearFade: 'on' }), bMed = bins({ scatterNearFadeRange: 'medium' }), bNone = bins({});
  ok('SF2 default: medium equals the saved on bin for bin (exact)', JSON.stringify(bOn) === JSON.stringify(bMed) && JSON.stringify(bMed) === JSON.stringify(bNone));

  // 5. gain: lookup only, default 1, doubles at 2
  ok('SF2 gain: default and unset give 1', pace.scatterGainOf({}) === 1 && pace.scatterGainOf({ scatterGain: 1 }) === 1);
  ok('SF2 gain: clamped to 0.25 to 4, bad values give 1', pace.scatterGainOf({ scatterGain: 9 }) === 4 && pace.scatterGainOf({ scatterGain: 0.01 }) === 0.25 && pace.scatterGainOf({ scatterGain: NaN }) === 1 && pace.scatterGainOf({ scatterGain: -2 }) === 1);
  const g2 = [4, 12, 25, 60, 100].every((d) => Math.abs(avgAt(bMed, d, 2) - 2 * avgAt(bMed, d)) < 1e-12);
  ok('SF2 gain: gain 2 doubles the lookup at 4, 12, 25, 60, 100 m', g2);
  const g1 = [4, 25, 100].every((d) => avgAt(bMed, d, 1) === avgAt(bMed, d));
  ok('SF2 gain: gain 1 is the plain lookup', g1);
  ok('SF2 gain: gain does not enter the table (bins identical with scatterGain 3)', JSON.stringify(bins({ scatterNearFadeRange: 'medium', scatterGain: 3 })) === JSON.stringify(bMed));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scatter-fade-gain checks passed'); process.exitCode = fails ? 1 : 0;
}
