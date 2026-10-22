// HDX7 halo levels (headless): node tests/halo-levels.js — exits 1 on failure.
// Checks the preset bundles and the derived level (RF.Drive.haloLevelOf, the airLevelOf pattern), and the texture arithmetic the halo relies on:
// N bins side by side must fit maxTextureSize (the polar table is HALO_POL_TH 512 angles per bin).
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const names = ['low', 'medium', 'high'];
ok('HDX7 presets exist for low, medium and high', names.every((n) => !!D.HALO_LEVELS_B[n]), names.join(','));
ok('HDX7 haloLevelOf: trafficHalo 0 is off', D.haloLevelOf({ trafficHalo: 0, haloBins: 4 }) === 'off' && D.haloLevelOf({}) === 'off');
for (const n of names) ok('HDX7 haloLevelOf: the ' + n + ' bundle reads back as ' + n, D.haloLevelOf(D.haloLevelBundle(n)) === n, JSON.stringify(D.haloLevelBundle(n)));
// the bundle with values as strings (what a select writes back) reads as the same level
ok('HDX7 haloLevelOf: string-valued options still match (select round trip)', D.haloLevelOf(Object.assign({}, D.haloLevelBundle('high'), { haloBins: '24', haloGain: '1', haloPolarLamps: '2' })) === 'high');
// one setting off the level is custom
ok('HDX7 haloLevelOf: low with 8 bins is custom', D.haloLevelOf(Object.assign({}, D.haloLevelBundle('low'), { haloBins: 8 })) === 'custom');
ok('HDX7 haloLevelOf: low with the divisor on auto is custom', D.haloLevelOf(Object.assign({}, D.haloLevelBundle('low'), { haloDiv: 0 })) === 'custom');
// a look that sets no halo keys beyond trafficHalo uses the defaults (24 bins, auto divisor, polar off, gain 1)
ok('HDX7 haloLevelOf: trafficHalo 16 with no other keys is custom (defaults are not any preset)', D.haloLevelOf({ trafficHalo: 16 }) === 'custom');
for (const n of names) { const b = D.haloLevelBundle(n); ok('HDX7 preset ' + n + ' bins in 4..32', b.haloBins >= 4 && b.haloBins <= 32, 'bins ' + b.haloBins); }
for (let N = 4; N <= 32; N++) if (512 * N > 16384) { ok('HDX7 polar width fits maxTextureSize at N=' + N, false, 512 * N); }
ok('HDX7 polar width 512 x 32 = 16384 fits the 16384 texture limit', 512 * 32 <= 16384, String(512 * 32));
// the bundle is a copy: mutating it does not change the preset
const bcopy = D.haloLevelBundle('low'); bcopy.haloBins = 99; ok('HDX7 haloLevelBundle returns a copy', D.HALO_LEVELS_B.low.haloBins === 4);
console.log(fails ? fails + ' FAILED' : 'all halo-level checks passed'); process.exit(fails ? 1 : 0);
