// OHQ oncoming headlamp scatter levels (headless): node tests/halo-levels.js — exits 1 on failure. (Was HDX7 halo levels low/medium/ultra.)
// Checks the preset bundles and the derived level (RF.Drive.haloLevelOf, the airLevelOf pattern), the car count and range keys (haloN, haloRangeOf),
// and the texture arithmetic the scatter table relies on: N bins side by side must fit maxTextureSize (the polar table is HALO_POL_TH 512 angles per bin).
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive, Opt = RF.Options;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const names = ['low', 'medium', 'high', 'xhigh', 'max'];
ok('OHQ presets exist for low, medium, high, xhigh and max', names.every((n) => !!D.HALO_LEVELS_B[n]) && Object.keys(D.HALO_LEVELS_B).join() === names.join(), Object.keys(D.HALO_LEVELS_B).join(','));
// a level is matched over the registry defaults (what the live options object holds), so each bundle on top of them reads back as itself
const def = Opt.defaults();
for (const n of names) ok('OHQ haloLevelOf: defaults + the ' + n + ' bundle reads back as ' + n, D.haloLevelOf(Object.assign({}, def, D.haloLevelBundle(n))) === n);
for (const n of names) ok('OHQ haloLevelOf: the bare ' + n + ' bundle reads back as ' + n + ' (missing keys take the registry defaults)', D.haloLevelOf(D.haloLevelBundle(n)) === n);
ok('OHQ the registry defaults are the medium level (owner 10-29)', D.haloLevelOf(def) === 'medium');
ok('OHQ the scatter on/off is not part of the level (trafficHalo 0 and 16 read the same)', D.haloLevelOf(Object.assign({}, def, { trafficHalo: 0 })) === 'medium' && D.haloLevelOf(Object.assign({}, def, { trafficHalo: 16 })) === 'medium');
for (const n of names) { const b = D.haloLevelBundle(n); ok('OHQ preset ' + n + ' never sets trafficHalo or haloGain', !('trafficHalo' in b) && !('haloGain' in b)); }
// every bundle value is one of its option's registry values, with the same type (a '160' string where the select stores a number would read 'custom')
for (const n of names) {
  const b = D.haloLevelBundle(n), bad = Object.keys(b).filter((k) => { const e = Opt.OPTIONS.find((x) => x.id === k); if (!e) return true; const v = e.values; return Array.isArray(v) ? !v.some((x) => x === b[k]) : !(typeof b[k] === 'number' && b[k] >= v.min && b[k] <= v.max); });
  ok('OHQ preset ' + n + ': every key is a registry option and every value one of its values (same type)', bad.length === 0, bad.join(','));
}
// the select round trip: values as strings read as the same level
const sv = Object.fromEntries(Object.entries(D.haloLevelBundle('high')).map(([k, v]) => [k, String(v)]));
ok('OHQ haloLevelOf: string-valued options still match (select round trip)', D.haloLevelOf(Object.assign({}, def, sv)) === 'high');
// the range row is its own knob: moving it keeps the level; any other key off the level is custom
ok('OHQ haloLevelOf: high with a 160 m range row is still high', D.haloLevelOf(Object.assign({}, def, D.haloLevelBundle('high'), { trafficRange: 160, trafficLightRange: '160', haloRange: 160 })) === 'high');
ok('OHQ haloLevelOf: low with 8 bins is custom', D.haloLevelOf(Object.assign({}, def, D.haloLevelBundle('low'), { haloBins: 8 })) === 'custom');
ok('OHQ haloLevelOf: medium with 8 cars is custom', D.haloLevelOf(Object.assign({}, def, D.haloLevelBundle('medium'), { haloCars: 8 })) === 'custom');
ok('OHQ cars ladder low..max = 2, 4, 8, 8, 8 (owner option b)', names.map((n) => D.HALO_LEVELS_B[n].haloCars).join() === '2,4,8,8,8');
for (const n of names) { const b = D.haloLevelBundle(n); ok('OHQ preset ' + n + ' bins in 4..32', b.haloBins >= 4 && b.haloBins <= 32, 'bins ' + b.haloBins); }
// haloN: lamps = 2 x cars, capped at 16 lamps and by an old numeric trafficHalo; absent haloCars = the old behaviour
const fog = { trafficBeams: true, look: { visibility: 60, trafficHalo: 16 } }, withLook = (x) => Object.assign({}, fog, { look: Object.assign({}, fog.look, x) });
ok('OHC haloN: 2 cars = 4 lamps, 4 = 8, 8 = 16', D.haloN(withLook({ haloCars: 2 })) === 4 && D.haloN(withLook({ haloCars: 4 })) === 8 && D.haloN(withLook({ haloCars: 8 })) === 16);
ok('OHC haloN: no haloCars = trafficHalo alone (old looks: 16 lamps, 8 lamps)', D.haloN(withLook({})) === 16 && D.haloN(withLook({ trafficHalo: 8 })) === 8);
ok('OHC haloN: an old trafficHalo 4 still caps 8 cars at 4 lamps', D.haloN(withLook({ trafficHalo: 4, haloCars: 8 })) === 4);
ok('OHC haloN: scatter off, traffic beams off or clear air = 0', D.haloN(withLook({ trafficHalo: 0, haloCars: 8 })) === 0 && D.haloN({ trafficBeams: false, look: { visibility: 60, trafficHalo: 16, haloCars: 8 } }) === 0 && D.haloN(withLook({ visibility: null, haloCars: 8 })) === 0);
// haloRangeOf: its own key, 0 or absent follows scatterRange; scatRangeOf (our own beam) never reads haloRange
ok('OHR haloRangeOf: 250 is 250, 0 and absent follow scatterRange', D.haloRangeOf({ haloRange: 250, scatterRange: 120 }) === 250 && D.haloRangeOf({ haloRange: 0, scatterRange: 400 }) === 400 && D.haloRangeOf({ scatterRange: 160 }) === 160 && D.haloRangeOf({}) === D.SCAT.S_MAX);
ok('OHR haloRangeOf clamps to 50..400; scatRangeOf ignores haloRange', D.haloRangeOf({ haloRange: 800 }) === 400 && D.haloRangeOf({ haloRange: 10 }) === 50 && D.scatRangeOf({ haloRange: 400, scatterRange: 120 }) === 120);
for (let N = 4; N <= 32; N++) if (512 * N > 16384) { ok('HDX7 polar width fits maxTextureSize at N=' + N, false, 512 * N); }
ok('HDX7 polar width 512 x 32 = 16384 fits the 16384 texture limit', 512 * 32 <= 16384, String(512 * 32));
// the bundle is a copy: mutating it does not change the preset
const bcopy = D.haloLevelBundle('low'); bcopy.haloBins = 99; ok('OHQ haloLevelBundle returns a copy', D.HALO_LEVELS_B.low.haloBins === 6);
console.log(fails ? fails + ' FAILED' : 'all halo-level checks passed'); process.exit(fails ? 1 : 0);
