// WG: physically based wet-road sheen (anisotropic GGX) behind look.wetModel. Node, no browser.
// The legacy frame hashes were captured on main 7baad43 before any wet-model code existed: legacy output must stay byte-identical with the sheen off.
const crypto = require('crypto');
const LEGACY = {
  dry: 'd4bb869b384f084321398012da741a58713102b64ff8974b3b50213ce880c344',          // wet off
  wetNoSheen: '4019ad56a363c8fd8844f47420c173c38e00c7afb36a09753e7ba9e525ad5e69',    // wet on, sheen off
  // wet + sheen (legacy lobe). SB2 changed this one on purpose: the painted lines take the wet sheen now (drive.js SHEEN_IDS), so the sheen-on road frame moved.
  // The sheen-off frames (dry, wetNoSheen) are unchanged, which is the byte-identity the stage must keep. The previous value, before SB2: d1ef4f28...58291.
  wetSheen: 'e651ae71b77d12cc562ebea86ae90460bb75f6ae3de9e68392cd3bb29cc928ed',
};
function frameHash(RF, opts) {
  const { recipe } = require('./drive-polish.js'), A = RF.DriveAnim;
  const p = recipe(RF, 'road', { wet: !!opts.wet, wetSheen: !!opts.wetSheen, tileCache: false }, 96), world = A.tileWorld(p, 95, 2);
  if (opts.model) p.look.wetModel = opts.model;
  const out = new Float32Array(p.w * p.h * 4); A.tileFrame(p, 95, 2, out, 2, null, null, world);
  return crypto.createHash('sha256').update(Buffer.from(out.buffer)).digest('hex');
}
function run(RF, ok) {
  const D = RF.Drive;
  ok('WG legacy frames unchanged: dry, wet, wet + sheen hash to the pre-change bytes',
    frameHash(RF, {}) === LEGACY.dry && frameHash(RF, { wet: true }) === LEGACY.wetNoSheen && frameHash(RF, { wet: true, wetSheen: true }) === LEGACY.wetSheen);
  // GGX sanity: a real BRDF, finite, zero below the road plane, directional albedo <= 1
  const fin = [[0.1, 0.2, 1, 0.1, 0.2, 1.2], [-3, 1, 0.5, 2, 0.1, 0.4]].every(([a, b, c, d, e, f]) => Number.isFinite(D.wetGGX(a, b, c, d, e, f)));
  const sheenFrame = (model) => frameHash(RF, { wet: true, wetSheen: true, model });
  ok('WG wetModel legacy is the default and matches the pinned legacy frame', sheenFrame('legacy') === LEGACY.wetSheen && sheenFrame(undefined) === LEGACY.wetSheen);
  ok('WG wetModel ggx changes the wet+sheen frame (positive control: the option is wired)', sheenFrame('ggx') !== LEGACY.wetSheen && sheenFrame('ggx') === sheenFrame('ggx'));
  ok('WG wetGGX is finite for ordinary geometry', fin);
  ok('WG wetGGX is zero for light below the road or eye below the road', D.wetGGX(10, 0, -0.5, 0, 0, 1) === 0 && D.wetGGX(10, 0, 0.5, 0, 0, -1) === 0);
  const albedo = (thetaV) => {
    const v = [Math.sin(thetaV), 0, Math.cos(thetaV)], N = 200; let s = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < 2 * N; j++) {
      const th = (i + 0.5) / N * Math.PI / 2, ph = (j + 0.5) / (2 * N) * 2 * Math.PI;
      s += D.wetGGX(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th), v[0], v[1], v[2]) * Math.sin(th) * (Math.PI / 2 / N) * (2 * Math.PI / (2 * N));
    }
    return s;
  };
  const a45 = albedo(Math.PI / 4), a80 = albedo(80 * Math.PI / 180);
  ok('WG directional albedo of the GGX term is energy-sane (0 < A <= 1)', a45 > 0 && a45 <= 1 && a80 > 0 && a80 <= 1, 'A(45deg)=' + a45.toFixed(4) + ' A(80deg)=' + a80.toFixed(4));
  ok('WG roughness tunables are named and anisotropic (along > across)', D.WET_GGX.alongAlpha > D.WET_GGX.acrossAlpha && D.WET_GGX.F0 === 0.02);
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all wet-ggx checks passed'); process.exitCode = fails ? 1 : 0; }
