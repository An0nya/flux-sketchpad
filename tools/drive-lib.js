// Shared by tools/drive-sample.js and tools/drive-compare.js: a PNG writer, the beam lookup (as spec-ui's roadModel builds it),
// and "render every scene for a traced scene".
const fs = require('fs'), path = require('path'), zlib = require('zlib');
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)) >>> 0, 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// trace a scene's far field (fine + wide streams) with N plain rays and judge it
function traceScene(RF, sc, N) {
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc), RF.Spec.wideOpts(sc)];
  const c = RF.Engine.newCtx(P, N, 0); RF.Engine.traceRange(c, 0, N); c.next = N; c.done = true;
  const G = RF.FarField.build(c, P.ffStreams[0]), Gw = RF.FarField.build(c, P.ffStreams[1]);
  return { G, Gw, ev: RF.Spec.evaluate(G, sc.modeD) };
}
function lookupOf(RF, sc, tr, kh, kv) {
  const md = sc.modeD, { G, Gw, ev } = tr, road = RF.Road.resolve(md.road, md.preset), sh = RF.Road.aimShift(road, ev), mir = md.traffic === 'LHT' ? -1 : 1;
  const I = (h, v) => { const Hh = mir * h + sh[0], V = v + sh[1], g = Hh >= G.h0 && Hh <= G.h1 && V >= G.v0 && V <= G.v1 ? G : Gw; if (!g) return 0; const r = g === G ? RF.FarField.intensityAt(g, Hh, V, kh, kv) : RF.FarField.intensityAt(g, Hh, V, Math.max(0.2, 2 * g.step)); return r.cd > 0 ? r.cd : 0; };
  return { lut: RF.Drive.lutFrom(I), road, conv: G.conv || md.conv || 'A', lamps: RF.Road.lamps(road), lane: RF.Road.laneWidth(road, md.preset, true), us: !/^ece/.test(md.preset) };
}
// render each (scene, shape) and write <prefix>-<scene>-<shape>-<exposure>.png; returns a line per picture
function renderSet(RF, sc, tr, outPrefix, o) {
  o = o || {}; const D = RF.Drive, W = o.w || 640, H = Math.round(W * 9 / 16), L = lookupOf(RF, sc, tr, o.kh || 0.5, o.kv || 0.15), lines = [];
  for (const [name, shape, extra] of o.list || [['road', 'straight'], ['forest', 'straight'], ['city', 'straight']]) {
    const m = /^(\d+)([RL])$/.exec(shape), A = m ? RF.Road.arc(+m[1], m[2] === 'R' ? 'right' : 'left') : null;
    const scene = D.buildScene(name, { Lw: L.lane, A, us: L.us }, extra);
    const res = D.render({ w: W, h: H, hfov: 60, eye: [-2, 0.37, 1.2], lamps: L.lamps, lut: L.lut, conv: L.conv, arc: A, lane: L.lane, scene, look: Object.assign({ wet: false, RL: 0.2, ambient: 0 }, o.look) });
    for (const [tag, ex] of (o.exposures || [['fixed', { mode: 'fixed', ev: 1 }]])) {
      const f = outPrefix + '-' + name + '-' + shape + '-' + tag + '.png', tm = D.tonemap(res, Object.assign({ glare: o.glare === undefined ? 0.3 : o.glare }, ex)); fs.writeFileSync(f, png(W, H, tm.px)); lines.push(f);
    }
  }
  return lines;
}
// tile equal-sized RGBA pictures into one sheet (cols across), a 4 px gap between them
function sheet(imgs, cols) {
  const w = imgs[0].w, h = imgs[0].h, rows = Math.ceil(imgs.length / cols), g = 4, W = cols * w + (cols - 1) * g, H = rows * h + (rows - 1) * g, px = new Uint8ClampedArray(W * H * 4).fill(0);
  for (let q = 0; q < W * H; q++) px[4 * q + 3] = 255;
  imgs.forEach((im, i) => { const ox = (i % cols) * (w + g), oy = Math.floor(i / cols) * (h + g); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = 4 * (y * w + x), b = 4 * ((oy + y) * W + ox + x); px[b] = im.px[a]; px[b + 1] = im.px[a + 1]; px[b + 2] = im.px[a + 2]; } });
  return { w: W, h: H, px };
}
// one rendered + tone-mapped picture (the pixels, not a file)
function picture(RF, L, name, shape, extra, o) {
  o = o || {}; const D = RF.Drive, W = o.w || 640, H = Math.round(W * 9 / 16), m = /^(\d+)([RL])$/.exec(shape || 'straight'), A = m ? RF.Road.arc(+m[1], m[2] === 'R' ? 'right' : 'left') : null;
  const scene = D.buildScene(name, { Lw: L.lane, A, us: L.us }, extra), res = D.render({ w: W, h: H, hfov: 60, eye: [-2, 0.37, 1.2], lamps: L.lamps, lut: L.lut, conv: L.conv, arc: A, lane: L.lane, scene, look: Object.assign({ wet: false, RL: 0.2, ambient: 0 }, o.look) });
  const tm = D.tonemap(res, Object.assign({ mode: 'fixed', ev: 1, glare: 0.3 }, o.tone)); return { w: W, h: H, px: tm.px, res, scene };
}
module.exports = { png, traceScene, lookupOf, renderSet, sheet, picture };
