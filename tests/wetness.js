// WT: road wetness 0..1 (look.wetness) replaces the wet boolean. Node, no browser: node tests/wetness.js — exits 1 on any failure.
// W = 0 must hash to the pre-change dry frame, W = 1 to the pre-change wet frames (legacy and GGX), and the mid values must be finite
// with the road luminance moving in the right direction. The pinned hashes are the clean-tree values captured before WT1 (same recipe as wet-ggx.js).
const crypto = require('crypto');
const PINNED = {
  dry: 'd4bb869b384f084321398012da741a58713102b64ff8974b3b50213ce880c344',          // wet off
  wetNoSheen: '4019ad56a363c8fd8844f47420c173c38e00c7afb36a09753e7ba9e525ad5e69',    // wet on, sheen off
  wetSheen: 'e651ae71b77d12cc562ebea86ae90460bb75f6ae3de9e68392cd3bb29cc928ed',      // wet + sheen, legacy lobe
  wetSheenGGX: '3971a4b6c2054c154ef8aefd8be98b29a0194a1f8a2117690b2ad1fc6629e4c9',   // wet + sheen, GGX
};
// One frame of the wet-ggx recipe. look.wetness, when given, overrides the legacy wet flag on the same look.
function frame(RF, look) {
  const { recipe } = require('./drive-polish.js'), A = RF.DriveAnim;
  const W = RF.Drive.wetnessOf(look), p = recipe(RF, 'road', { wet: W > 0, wetSheen: !!look.wetSheen, tileCache: false }, 96), world = A.tileWorld(p, 95, 2);
  if (look.wetness !== undefined) p.look.wetness = look.wetness;
  if (look.wetModel) p.look.wetModel = look.wetModel;
  const out = new Float32Array(p.w * p.h * 4); A.tileFrame(p, 95, 2, out, 2, null, null, world);
  return { hash: crypto.createHash('sha256').update(Buffer.from(out.buffer)).digest('hex'), finite: out.every(Number.isFinite) };
}
// Mean luminance over the asphalt pixels of a plain road seen by our own beam (no objects), with the sheen on or off.
function roadMean(RF, W, sheen) {
  const D = RF.Drive, lut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), asphalt = D.MAT_KEYS.indexOf('asphalt');
  const r = D.render({ w: 96, h: 54, hfov: 60, eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut, conv: 'A', lane: 3.5,
    look: { wetness: W, wetSheen: sheen, RL: 0.2, ambient: 0.05 }, ss: 1, scene: { objects: [], markings: [], verge: ['grass', 1.5, 'grass'] } });
  let s = 0, n = 0;
  for (let q = 0; q < 96 * 54; q++) if (r.mat[q] === asphalt) { s += (r.rgb[3 * q] + r.rgb[3 * q + 1] + r.rgb[3 * q + 2]) / 3; n++; }
  return { mean: n ? s / n : NaN, n, finite: r.rgb.every(Number.isFinite) };
}
function run(RF, ok) {
  const dry = frame(RF, { wetness: 0 }), wet = frame(RF, { wetness: 1 }), damp = frame(RF, { wetness: 0.4 });
  ok('WT wetness 0 is the pre-change dry frame, also with the legacy wet flag set to true',
    dry.hash === PINNED.dry && frame(RF, { wet: true, wetness: 0 }).hash === PINNED.dry, dry.hash.slice(0, 12));
  ok('WT wetness 1 is the pre-change wet frame (no sheen), and the legacy wet flag still reads as 1',
    wet.hash === PINNED.wetNoSheen && frame(RF, { wet: true }).hash === PINNED.wetNoSheen && frame(RF, { wetness: 1, wetSheen: false }).hash === PINNED.wetNoSheen, wet.hash.slice(0, 12));
  ok('WT wetness 1 with the sheen on is the pre-change legacy wet + sheen frame',
    frame(RF, { wetness: 1, wetSheen: true }).hash === PINNED.wetSheen);
  ok('WT wetness 1 with the sheen on and the GGX model is the pre-change GGX frame',
    frame(RF, { wetness: 1, wetSheen: true, wetModel: 'ggx' }).hash === PINNED.wetSheenGGX);
  ok('WT damp (0.4) is a different frame from dry and from wet', damp.hash !== dry.hash && damp.hash !== PINNED.wetNoSheen, damp.hash.slice(0, 12));
  const levels = [0, 0.1, 0.4, 0.7, 1];
  const off = levels.map((w) => roadMean(RF, w, false)), on = levels.map((w) => roadMean(RF, w, true));
  const sheenPart = on.map((o, i) => o.mean - off[i].mean);
  const fmt = (xs) => xs.map((x) => x.toFixed(5)).join(' ');
  ok('WT mid wetness values never NaN (frames and road luminance, sheen on and off)',
    levels.every((w) => frame(RF, { wetness: w, wetSheen: true }).finite) && off.every((o) => o.finite && Number.isFinite(o.mean)) && on.every((o) => o.finite && Number.isFinite(o.mean)));
  ok('WT road luminance under the own beam falls with wetness (sheen off: the diffuse rho drop wins)',
    off[0].mean > off[2].mean && off[2].mean > off[4].mean, 'W 0/0.1/0.4/0.7/1 mean=' + fmt(off.map((o) => o.mean)));
  ok('WT sheen part is zero when dry and grows with wetness', sheenPart[0] === 0 && sheenPart[2] > 0 && sheenPart[4] > sheenPart[2],
    'sheen part at W 0/0.1/0.4/0.7/1 = ' + fmt(sheenPart));
  ok('WT damp sits strictly between dry and wet (sheen on)', on[2].mean < on[0].mean && on[2].mean > on[4].mean,
    'on: dry ' + on[0].mean.toFixed(5) + ' damp ' + on[2].mean.toFixed(5) + ' wet ' + on[4].mean.toFixed(5));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all wetness checks passed'); process.exitCode = fails ? 1 : 0;
}
