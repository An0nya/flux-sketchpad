// Minimal PNG reader/writer for the image tests (Node's zlib is the whole codec; no npm).
// decode(buf) -> { w, h, data: Uint8Array RGBA }   (8-bit gray, gray+alpha, RGB, RGBA, palette; 16-bit is reduced to 8; no interlace)
// encode(w, h, rgba) -> Buffer (8-bit RGBA)
'use strict';
const zlib = require('zlib');
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function decode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('png: not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, pal = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') pal = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('png: interlaced PNGs are not supported');
  if (depth !== 8 && depth !== 16 && !(ctype === 3 && depth <= 8)) throw new Error('png: bit depth ' + depth + ' not supported for colour type ' + ctype);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; if (!ch) throw new Error('png: colour type ' + ctype);
  const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil(w * ch * depth / 8), raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
    prev = row;
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, sample = (k) => depth === 16 ? px[y * stride + (x * ch + k) * 2] : px[y * stride + x * ch + k];
    if (ctype === 3) {
      const bitpos = x * depth, byte = px[y * stride + (bitpos >> 3)], idx = depth === 8 ? byte : (byte >> (8 - depth - (bitpos & 7))) & ((1 << depth) - 1);
      out[o] = pal[idx * 3]; out[o + 1] = pal[idx * 3 + 1]; out[o + 2] = pal[idx * 3 + 2]; out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (ch <= 2) { const g = sample(0); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = ch === 2 ? sample(1) : 255; }
    else { out[o] = sample(0); out[o + 1] = sample(1); out[o + 2] = sample(2); out[o + 3] = ch === 4 ? sample(3) : 255; }
  }
  return { w, h, data: out };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; }
function encode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { decode, encode };
