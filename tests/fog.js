// FG1: fog (look.visibility, metres) on the CPU trace. Node, no browser: node tests/fog.js — exits 1 on any failure.
// Visibility off (Infinity, null, 0 or absent) must hash to the pre-fog frames. Fog itself is checked against the exact
// Koschmieder model: per pixel, fog/clear = exp(-sigma (r_lamp + t)) with one lamp and ambient 0 (airlight zero), sigma = 3.912 / V.
const crypto = require('crypto'), path = require('path');
// Pre-fog frames captured on main cbcb340 (scratch capture, same recipes as below). Absent visibility must reproduce them.
const PINNED = {
  tiles_dry: 'd4bb869b384f084321398012da741a58713102b64ff8974b3b50213ce880c344',
  tiles_wet_sheen_ggx: '308bd16d23d47c195c8bb871f5336a9ce03189ba6b6c9fdd3658eae75f74f7fa',
  tiles_cache_on_wet_sheen: '6c220c38275205ed92dfdad47997082b904bf703cd732a3e058e274b16dc3103',
  render_pointlights_dry: '4884754b720aead0d17a45d5ce7e8b1f84e354e41a6c60d734e4e0343c3c10f2',
  render_pointlights_wet_sheen: '130dcf25f12a64cfa44ac5d40566aca41fb1e29afeddbe8f6812ab83126f11f1',
  render_pointlights_ambient0: '6dd0370fce0390002b1fd24f5dd1529a70dca7f7200d80103069da1d8e84f6c0',
  render_objects_layer_pointlights: 'e187b63d2d0abcad533f5b54f3f44368429297ca2b8bab8d3ed7cc40f28170d6',
};
const H = (buf) => crypto.createHash('sha256').update(Buffer.from(buf.buffer)).digest('hex');
const SIG = (V) => 3.912 / V;
function tilesHash(RF, opts, look) {
  const { recipe } = require('./drive-polish.js'), A = RF.DriveAnim;
  const p = recipe(RF, 'road', Object.assign({ tileCache: false }, opts), 96);
  Object.assign(p.look, look || {});
  const world = A.tileWorld(p, 95, 2), buf = new Float32Array(p.w * p.h * 4);
  A.tileFrame(p, 95, 2, buf, 2, null, null, world);
  return H(buf);
}
function scene(RF) {
  const D = RF.Drive;
  return {
    w: 96, h: 54, hfov: 60, eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lane: 3.5, ss: 1,
    scene: { objects: [], markings: [], verge: ['grass', 1.5, 'grass'] },
  };
}
const dirOf = (w, h, hfov, x, y) => {
  const tanH = Math.tan(hfov * Math.PI / 360), tanV = tanH * h / w, u = (x + 0.5) / w * 2 - 1, v = 1 - (y + 0.5) / h * 2;
  const dx = 1, dy = -u * tanH, dz = v * tanV, il = 1 / Math.hypot(dx, dy, dz);
  return [dx * il, dy * il, dz * il];
};
function render(RF, base, look, visibility) {
  const D = RF.Drive, o = Object.assign({}, base, { look: Object.assign({ RL: 0.2, ambient: 0 }, look) });
  if (visibility !== undefined) o.look.visibility = visibility;
  return D.render(o);
}
function run(RF, ok) {
  const D = RF.Drive, base = scene(RF);
  // 1. off is byte-identical to the pre-fog frames (scene shapes: tiles with and without the ground cache, wet, sheen, street lights)
  const off = [
    ['tiles_dry', tilesHash(RF, {}, {})],
    ['tiles_wet_sheen_ggx', tilesHash(RF, {}, { wet: true, wetSheen: true, wetModel: 'ggx' })],
    ['tiles_cache_on_wet_sheen', tilesHash(RF, { tileCache: true }, { wet: true, wetSheen: true })],
  ];
  ok('FG off (no visibility) frames equal the pre-fog pinned hashes', off.every(([k, h]) => h === PINNED[k]), off.map(([k, h]) => k + '=' + h.slice(0, 10)).join(' '));
  const light = { x: 6, y: 0, z: 7, cd: 900, rgb: [1, 1, 1] }, withLight = Object.assign({}, base, { pointLights: [light] });
  const litHash = (look) => H(render(RF, withLight, look, undefined).rgb);
  ok('FG off: street-light frames (dry, wet sheen, ambient 0) equal the pre-fog pinned hashes',
    litHash({ ambient: 0.05 }) === PINNED.render_pointlights_dry && litHash({ ambient: 0.05, wet: true, wetSheen: true }) === PINNED.render_pointlights_wet_sheen && litHash({ ambient: 0 }) === PINNED.render_pointlights_ambient0);
  ok('FG off: layer objects with street lights equals the pre-fog pinned hash', H(D.render(Object.assign({}, withLight, { layer: 'objects', scene: { objects: [], markings: [] }, look: { RL: 0.2, ambient: 0.05 } })).rgb) === PINNED.render_objects_layer_pointlights);
  ok('FG off: visibility Infinity, null, 0 and absent all give the same frame',
    [Infinity, null, 0, undefined].every((v) => H(render(RF, base, {}, v).rgb) === H(render(RF, base, {}, undefined).rgb)));
  ok('FG sigmaOf: off values are 0; V gives 3.912 / V', D.sigmaOf({}) === 0 && D.sigmaOf({ visibility: Infinity }) === 0 && D.sigmaOf({ visibility: null }) === 0 && D.sigmaOf({ visibility: 0 }) === 0 &&
    Math.abs(D.sigmaOf({ visibility: 60 }) - SIG(60)) < 1e-15, 'sigma(60)=' + D.sigmaOf({ visibility: 60 }));
  // 2. exact Koschmieder on one lamp, ambient 0: fog/clear = exp(-sigma (r + t)) for every asphalt pixel that the lamp lights
  const one = Object.assign({}, base, { lamps: [[0, -0.7, 0.65]] }), asph = D.MAT_KEYS.indexOf('asphalt');
  const clear = render(RF, one, {}, undefined), fog = render(RF, one, {}, 60), eye = base.eye, sg = SIG(60);
  let worst = 0, n = 0, lit = 0;
  for (let q = 0; q < base.w * base.h; q++) {
    if (clear.mat[q] !== asph || !(clear.depth[q] < 5000)) continue;
    const t = clear.depth[q], d = dirOf(base.w, base.h, base.hfov, q % base.w, Math.floor(q / base.w));
    const P = [eye[0] + t * d[0], eye[1] + t * d[1], eye[2] + t * d[2]], r = Math.hypot(P[0] + 0, P[1] + 0.7, P[2] - 0.65);
    const c = clear.rgb[3 * q] + clear.rgb[3 * q + 1] + clear.rgb[3 * q + 2];
    if (!(c > 1e-6)) continue; lit++;
    const f = fog.rgb[3 * q] + fog.rgb[3 * q + 1] + fog.rgb[3 * q + 2], want = Math.exp(-sg * (r + t));
    worst = Math.max(worst, Math.abs(f / c - want) / want); n++;
  }
  ok('FG exact attenuation: fog/clear = exp(-sigma (r_lamp + t_eye)) at V=60 on lit asphalt (ambient 0)', n > 10 && worst < 1e-4, 'pixels=' + n + ' of ' + lit + ' lit, worst rel err=' + worst.toExponential(2));
  // a road point nearest 100 m, seen at V=60 (384x216 for a deeper frame): fog/clear = exp(-sigma (r + t)); the depth reached is printed
  const hi = Object.assign({}, one, { w: 384, h: 216 }), hc = render(RF, hi, {}, undefined), hf = render(RF, hi, {}, 60);
  let best = -1, bestD = Infinity;
  for (let q = 0; q < 384 * 216; q++) if (hc.mat[q] === asph && hc.rgb[3 * q] > 0 && Math.abs(hc.depth[q] - 100) < bestD) { bestD = Math.abs(hc.depth[q] - 100); best = q; }
  let at100 = NaN, want100 = NaN;
  if (best >= 0) {
    const t = hc.depth[best], d = dirOf(384, 216, 60, best % 384, Math.floor(best / 384)), P = [eye[0] + t * d[0], eye[1] + t * d[1], eye[2] + t * d[2]];
    const r = Math.hypot(P[0], P[1] + 0.7, P[2] - 0.65);
    at100 = (hf.rgb[3 * best] + hf.rgb[3 * best + 1] + hf.rgb[3 * best + 2]) / (hc.rgb[3 * best] + hc.rgb[3 * best + 1] + hc.rgb[3 * best + 2]);
    want100 = Math.exp(-sg * (r + t));
  }
  ok('FG far road point at V=60 dims by exp(-sigma (r + t)) from the lamp and the eye geometry',
    Math.abs(at100 - want100) / want100 < 1e-4, 'depth ' + bestD.toFixed(2) + ' m, ratio ' + at100.toExponential(3) + ' want ' + want100.toExponential(3));
  // 3. monotone: under fog the ratio fog/clear never increases with depth (two lamps, ambient 0; depth bands of 10 m)
  const f2 = render(RF, base, {}, 200), c2 = render(RF, base, {}, undefined), bins = new Map();
  for (let q = 0; q < base.w * base.h; q++) {
    if (c2.mat[q] !== asph || !(c2.depth[q] < 5000) || !(c2.rgb[3 * q] > 1e-9)) continue;
    const b = Math.floor(c2.depth[q] / 10), f = (f2.rgb[3 * q] + f2.rgb[3 * q + 1] + f2.rgb[3 * q + 2]) / (c2.rgb[3 * q] + c2.rgb[3 * q + 1] + c2.rgb[3 * q + 2]);
    if (!bins.has(b)) bins.set(b, []); bins.get(b).push(f);
  }
  const keys = [...bins.keys()].sort((a, b) => a - b).filter((k) => bins.get(k).length >= 3);
  const means = keys.map((k) => bins.get(k).reduce((a, b) => a + b, 0) / bins.get(k).length);
  const mono = means.every((m, i) => i === 0 || m <= means[i - 1] * (1 + 1e-6));
  ok('FG monotone: fog/clear ratio never rises with depth (V=200, 10 m bands)', keys.length >= 3 && mono, 'bands=' + keys.length + ' ratios=' + means.slice(0, 6).map((m) => m.toFixed(4)).join(' '));
  // 4. no NaN anywhere, every preset (metres) and the presets are ordered: denser fog, darker strip (ambient 0, fog only darkens)
  const presets = [Infinity, 3000, 1000, 200, 60];
  const strip = presets.map((V) => render(RF, base, {}, V));
  const finite = strip.every((r) => r.rgb.every(Number.isFinite));
  const meanStrip = (r) => { let s = 0, n = 0; for (let q = 0; q < base.w * base.h; q++) if (r.mat[q] === asph && r.depth[q] > 40 && r.depth[q] < 5000) { s += r.rgb[3 * q] + r.rgb[3 * q + 1] + r.rgb[3 * q + 2]; n++; } return s / (n || 1); };
  const means2 = strip.map(meanStrip);
  ok('FG no NaN or Infinity in any preset frame', finite);
  ok('FG presets ordered: denser fog gives a darker far strip (off > haze > mist > fog > dense)', means2.every((m, i) => i === 0 || m < means2[i - 1]),
    'means ' + means2.map((m) => m.toExponential(3)).join(' '));
  // 5. airlight limit: far ground under dense fog approaches the sky value at its direction (ambient > 0 so airlight is non-zero)
  const far = render(RF, base, { ambient: 0.05 }, 60);
  let airWorst = 0, airN = 0;
  for (let q = 0; q < base.w * base.h; q++) {
    if (far.mat[q] !== asph || !(far.depth[q] > 150 && far.depth[q] < 5000)) continue;
    const d = dirOf(base.w, base.h, base.hfov, q % base.w, Math.floor(q / base.w)), skyL = 0.05 * 0.012;
    const A = skyL * (1 + 0.8 * Math.max(0, 1 - Math.abs(d[2]) * 8)), got = far.rgb[3 * q];
    airWorst = Math.max(airWorst, Math.abs(got - A) / A); airN++;
  }
  ok('FG airlight limit: far ground under V=60 equals the sky value at its direction (T < 1e-3 beyond 150 m)', airN > 0 && airWorst < 1e-3, 'pixels=' + airN + ' worst rel=' + airWorst.toExponential(2));
  ok('FG finite under fog with street lights and wet sheen', render(RF, withLight, { wet: true, wetSheen: true, ambient: 0.05 }, 200).rgb.every(Number.isFinite));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all fog checks passed'); process.exitCode = fails ? 1 : 0;
}
