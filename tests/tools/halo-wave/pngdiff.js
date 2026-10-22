// HALO-WAVE-diag throwaway: pixel diff of two saved PNGs (8-bit RGB/RGBA). node pngdiff.js a.png b.png
const fs = require('fs'), zlib = require('zlib');
function decode(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } if (type === 'IDAT') idat.push(data); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0; let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = (raw[src + x] + pr) & 255; } }
  return { w, h, bpp, out };
}
const A = decode(fs.readFileSync(process.argv[2])), B = decode(fs.readFileSync(process.argv[3]));
if (A.w !== B.w || A.h !== B.h) { console.log('size differs', A.w, A.h, B.w, B.h); process.exit(0); }
let sum = 0, max = 0, n = 0, changed = 0; const N = A.w * A.h;
for (let i = 0; i < N; i++) { let d = 0; for (let c = 0; c < 3; c++) d += Math.abs(A.out[i * A.bpp + c] - B.out[i * B.bpp + c]); d /= 3; sum += d; if (d > max) max = d; if (d > 0) changed++; n++; }
console.log(`${process.argv[2].split('/').pop()} vs ${process.argv[3].split('/').pop()}: mean abs (RGB) ${(sum / n).toFixed(4)}, max ${max.toFixed(1)}, pixels changed ${changed} of ${N}`);
