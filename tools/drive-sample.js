// Render the Drive view headlessly from a saved scene and write PNGs: node tools/drive-sample.js scene.json outdir [--rays N] [--w 640]
// Traces the scene's far field (the same streams the app judges), builds the beam lookup the way spec-ui's roadModel does, renders
// each scene × road shape, and tone-maps with auto and fixed exposure. For looking at the raw picture, not for the app.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { load } = require('../tests/load.js'); const RF = load(); const D = RF.Drive;
const args = process.argv.slice(2), file = args[0], out = args[1] || '.', opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : d; };
const KH = opt('kh', 0.2), KV = opt('kv', 0.2), N = opt('rays', 1000000), W = opt('w', 640), H = Math.round(W * 9 / 16);
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)) >>> 0, 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sc = RF.State.deserialize(fs.readFileSync(file, 'utf8')), md = sc.modeD;
const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc), RF.Spec.wideOpts(sc)];
const c = RF.Engine.newCtx(P, N, 0); const t0 = Date.now(); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true;
const G = RF.FarField.build(c, P.ffStreams[0]), Gw = RF.FarField.build(c, P.ffStreams[1]), ev = RF.Spec.evaluate(G, md);
console.log('traced ' + N + ' rays in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s; preset ' + md.preset + '; aim shift ' + JSON.stringify(ev.shift));
const road = RF.Road.resolve(md.road, md.preset), sh = RF.Road.aimShift(road, ev), mir = md.traffic === 'LHT' ? -1 : 1, conv = G.conv || md.conv || 'A';
const I = (h, v) => { const Hh = mir * h + sh[0], V = v + sh[1], g = Hh >= G.h0 && Hh <= G.h1 && V >= G.v0 && V <= G.v1 ? G : Gw; if (!g) return 0; const r = g === G ? RF.FarField.intensityAt(g, Hh, V, KH, KV) : RF.FarField.intensityAt(g, Hh, V, Math.max(0.2, g.step)); return r.cd > 0 ? r.cd : 0; };
const t1 = Date.now(), lut = D.lutFrom(I); console.log('lookup ' + ((Date.now() - t1) / 1000).toFixed(2) + ' s');
const lamps = RF.Road.lamps(road), lane = RF.Road.laneWidth(road, md.preset, true), us = !/^ece/.test(md.preset);
fs.mkdirSync(out, { recursive: true });
for (const [name, shapes] of [['road', ['straight', '150R']], ['forest', ['straight']], ['city', ['straight']]]) for (const shape of shapes) for (const wet of [false]) {
  const m = /^(\d+)([RL])$/.exec(shape), A = m ? RF.Road.arc(+m[1], m[2] === 'R' ? 'right' : 'left') : null;
  const scene = D.buildScene(name, { Lw: lane, A, us });
  const t2 = Date.now(), res = D.render({ w: W, h: H, hfov: 60, eye: [-2, 0.37, 1.2], lamps, lut, conv, arc: A, lane, scene, look: { wet, RL: 0.2, ambient: 0 } });
  let mx = 0, lit = 0; for (let q = 0; q < W * H; q++) { const y = D.lumaOf(res.rgb[3 * q], res.rgb[3 * q + 1], res.rgb[3 * q + 2]); if (y > mx) mx = y; if (y > 1e-3) lit++; }
  console.log(name + ' ' + shape + (wet ? ' wet' : '') + ': ' + scene.objects.length + ' objects, rendered in ' + ((Date.now() - t2) / 1000).toFixed(1) + ' s, peak ' + mx.toFixed(0) + ' cd/m², lit pixels ' + (100 * lit / (W * H)).toFixed(0) + ' %');
  for (const [tag, o] of [['auto', { mode: 'auto' }], ['fixed', { mode: 'fixed', ev: 0 }], ['fixedp3', { mode: 'fixed', ev: 3 }]]) {
    const tm = D.tonemap(res, Object.assign({ glare: true }, o)); fs.writeFileSync(path.join(out, name + '-' + shape + (wet ? '-wet' : '') + '-' + tag + '.png'), png(W, H, tm.px));
  }
}
