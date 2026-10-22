// HDX4 image helper (throwaway). Side-by-side crop of two captures' halo-ON frames at 3x zoom, plus their difference x10.
// node hdx4_crops.js <captureA> <captureB> <frame> <out.png> [half-size in display px, default 60] [frame of B]
// The crop is centred on frame 0's lamp of capture A (scaled to the display). Both captures must have the same display size.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const [dA, dB, FR, OUTP] = [process.argv[2], process.argv[3], +(process.argv[4] || 0), process.argv[5]];
const FRB = process.argv[7] !== undefined ? +process.argv[7] : FR;   // frame of capture B (default: the same frame; set it to compare consecutive frames of one capture)
const HALF = +(process.argv[6] || 60), Z = 3;
function decodePNG(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } if (type === 'IDAT') idat.push(data); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0; let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[dst + x] = (raw[src + x] + pr) & 255; } }
  return { w, h, bpp, out };
}
function encodePNG(w, h, rgb) {   // rgb: Uint8Array w*h*3
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + i] = v; }); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
function crc32(b) { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const metaA = JSON.parse(fs.readFileSync(path.join(dA, 'meta.json'), 'utf8'));
const imgA = decodePNG(fs.readFileSync(path.join(dA, 'on_' + FR + '.png'))), imgB = decodePNG(fs.readFileSync(path.join(dB, 'on_' + FRB + '.png')));
const SC = imgA.w / metaA.frames[0].W;
const cx = Math.round(metaA.frames[0].col * SC), cy = Math.round(metaA.frames[0].row * SC);
const x0 = Math.max(0, cx - HALF), y0 = Math.max(0, cy - HALF), cw = Math.min(imgA.w - 1, cx + HALF) - x0 + 1, ch = Math.min(imgA.h - 1, cy + HALF) - y0 + 1;
const lum = (img, x, y) => { const o = (y * img.w + x) * img.bpp; return 0.2126 * img.out[o] + 0.7152 * img.out[o + 1] + 0.0722 * img.out[o + 2]; };
const OW = cw * Z, OH = ch * Z, ow = OW * 3 + 6 * 2, oh = OH;   // three panels: A, B, diff x10 (panel width OW), 3 px gutters
const W3 = OW * 3 + 4, H3 = OH, rgb = new Uint8Array(W3 * H3 * 3).fill(128);
const put = (px, x, y, r, g, b) => { const o = (y * W3 + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b; };
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const sx = x0 + Math.floor(x / Z), sy = y0 + Math.floor(y / Z);
  const oa = (sy * imgA.w + sx) * imgA.bpp, ob = (sy * imgB.w + sx) * imgB.bpp;
  put(0, x, y, imgA.out[oa], imgA.out[oa + 1], imgA.out[oa + 2]);
  put(0, x + OW + 2, y, imgB.out[ob], imgB.out[ob + 1], imgB.out[ob + 2]);
  const dd = Math.max(-128, Math.min(127, (lum(imgA, sx, sy) - lum(imgB, sx, sy)) * 10)), v = 128 + dd;   // luminance difference x10, grey 128 = no change
  put(0, x + 2 * (OW + 2), y, v, v, v);
}
fs.writeFileSync(OUTP, encodePNG(W3, H3, rgb));
console.log('wrote', OUTP, 'crop', cw, 'x', ch, 'display px at 3x');
