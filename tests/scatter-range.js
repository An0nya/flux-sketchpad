// SR: the scatter range (look.scatterRange, metres; default 120 = the old fixed value). Node: node tests/scatter-range.js; exits 1 on any failure.
// CPU side only: the range setting, the 12-bin table and the direct in-scatter reach past 120 m at 300 and clamp there, the default (120, or absent) is byte-identical,
// and the traffic halo's edges (drive-three-halo.js haloEdgesOf / haloStepOf) end at the range with the same log ratio.
// The GPU side is tests/regress/SR-scatter-range.js (page: GPU edges and lookup vs these CPU numbers at 300, and the control that keeps the GPU at 120).
const { pathToFileURL } = require('url'), path = require('path');
const { load, ROOT } = require('./load.js');
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
(async () => {
  const RF = load(); const D = RF.Drive;
  // 1. scatRangeOf: absent, 120 and junk are 120; 300 is 300; the range is clamped to 10..400
  const R = (v) => D.scatRangeOf({ scatterRange: v });
  ok('SR range: absent, invalid or 120 read as 120 (the old S_MAX)', D.scatRangeOf({}) === 120 && D.scatRangeOf(undefined) === 120 && R('x') === 120 && R(120) === 120 && R('120') === 120 && D.SCAT.S_MAX === 120);
  ok('SR range: 300 stays 300, 1000 clamps to 400, 2 clamps to 10', R(300) === 300 && R(1000) === 400 && R(2) === 10, [R(300), R(1000), R(2)]);
  // 2. the 12-bin table: the default look and an explicit 120 give the same bins, byte for byte
  const lamps = [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false));
  const base = { eye: D.eyeFor(), lamps, lut, conv: 'A', lampRGB: [1, 1, 1] };
  const dir = (() => { const r = [1, 0.02, -0.12], L = Math.hypot(...r); return r.map((x) => x / L); })();
  const b120 = D.scatterTableBins(Object.assign({}, base, { look: { visibility: 200, scatterNearFade: 'off' } }), dir, 0.5, 48);
  const b120x = D.scatterTableBins(Object.assign({}, base, { look: { visibility: 200, scatterNearFade: 'off', scatterRange: 120 } }), dir, 0.5, 48);
  ok('SR default: scatterRange 120 gives the same table bins as absent (byte for byte)', Array.from(b120).every((v, k) => Object.is(v, b120x[k])) && b120.length === 12);
  const b300 = D.scatterTableBins(Object.assign({}, base, { look: { visibility: 200, scatterNearFade: 'off', scatterRange: 300 } }), dir, 0.5, 48);
  const far120 = Array.from(b120).reduce((a, b) => a + b, 0), far300 = Array.from(b300).reduce((a, b) => a + b, 0);
  ok('SR table: at 300 the bins past 120 m carry light (the total grows)', far300 > far120 && b300[11] > 0, { total120: far120, total300: far300 });
  // 3. the cumulative lookup: clamped at the range, so beyond it the value is flat; at 120 nothing changes
  const v300 = D.scatterTableAt(b300, 300, 1, 300), vBig = D.scatterTableAt(b300, 500, 1, 300);
  ok('SR lookup: flat beyond the range (value at 300 equals value at 500 with S = 300)', v300 > 0 && v300 === vBig, { v300, vBig });
  ok('SR lookup: the 120 default lookup equals the explicit S = 120 lookup', D.scatterTableAt(b120, 80) === D.scatterTableAt(b120, 80, 1, 120) && D.scatterTableAt(b120, 500) === D.scatterTableAt(b120, 120));
  // 4. direct in-scatter: the reach follows the range
  const dir1 = [1, 0, 0], o = (r) => Object.assign({}, base, { look: { visibility: 200, scatter: 16, scatterRange: r } });
  const s120 = D.inScatter(o(120), dir1, 400, 0.5, 64), s300 = D.inScatter(o(300), dir1, 400, 0.5, 64), s120b = D.inScatter(o(undefined), dir1, 400, 0.5, 64);
  ok('SR direct: default equals scatterRange 120 (byte for byte)', s120[0] === s120b[0] && s120[1] === s120b[1] && s120[2] === s120b[2], s120);
  ok('SR direct: 300 integrates past 120 m (more in-scatter than 120)', s300[0] > s120[0] && s120[0] > 0, { s120: s120[0], s300: s300[0] });
  // 5. control: bins built at 120 read at 300 must not equal bins built at 300 (the comparison can see a wrong range)
  const diff = Array.from(b120).some((v, k) => Math.abs(v - b300[k]) > 1e-12);
  ok('SR control: a 120 table is not the 300 table (the comparison can see the wrong range)', diff);
  // 6. traffic halo edges (drive-three-halo.js): needs the module; checked as text if the import fails
  let edges = null;
  try {
    const H = await import(pathToFileURL(path.join(ROOT, 'js', 'drive-three-halo.js')).href);
    const legacy = [0, ...Array.from({ length: 24 }, (_, k) => 0.5 * Math.pow(240, (k + 1) / 24))]; legacy[24] = 120;
    const e120 = H.haloEdgesOf(24, 120), e300 = H.haloEdgesOf(24, 300);
    ok('SR halo edges: range 120 equals the old ladder exactly (24 bins)', e120.length === 25 && e120.every((v, k) => Object.is(v, legacy[k])), e120.slice(-2));
    ok('SR halo edges: range 300 ends at 300 and keeps the log ratio (ln(600)/24 step)', e300[24] === 300 && Math.abs(Math.log(e300[2] / e300[1]) - Math.log(600) / 24) < 1e-12, { last: e300[24], step: Math.log(e300[2] / e300[1]) });
    ok('SR halo step: 0.22836 at 24 bins and 120 m (as before), ln(600)/24 at 300 m', H.haloStepOf(24, 120) === 0.22836 && Math.abs(H.haloStepOf(24, 300) - Math.log(600) / 24) < 1e-12);
    edges = true;
  } catch (e) { ok('SR halo edges module imports in Node (else checked on the page only)', false, String(e && e.message || e).slice(0, 200)); }
  const fails = checks.filter((c) => !c).length;
  console.log(fails ? fails + ' FAILED' : 'all scatter-range checks passed (halo edges module ' + (edges ? 'checked' : 'not checked') + ')');
  process.exitCode = fails ? 1 : 0;
})();
