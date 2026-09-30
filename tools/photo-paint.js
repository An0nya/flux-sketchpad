#!/usr/bin/env node
// Turn a photo into a paint map exactly as the app's "From image…" import does (js/ui.js imageToPaint): the whole image
// fitted into the res×res target (letterboxed in black), linear-light luminance, normalised to its max, cells under 0.02
// dropped.  Levels default to the app's (black 0, curve 1).  macOS only: `sips` does the resize and decodes jpg/png/jp2.
//   node tools/photo-paint.js <image> <name> [--res 100] [--black 0] [--gamma 1]   → bench-out/photos/<name>-<res>.json
// The output stays in bench-out/ (gitignored): the photos are private; bench-scenes.js picks up whatever is there.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : +a[i + 1]; };
const [img, name] = a, res = opt('res', 100), black = opt('black', 0), gamma = opt('gamma', 1);
if (!img || !name) { console.error('usage: photo-paint.js <image> <name> [--res 100] [--black 0] [--gamma 1]'); process.exit(1); }
const tmp = path.join(os.tmpdir(), 'photo-paint-' + process.pid + '.bmp');
execFileSync('sips', ['-s', 'format', 'bmp', '-Z', String(res), '--padToHeightWidth', String(res), String(res), '--padColor', '000000', img, '--out', tmp], { stdio: 'ignore' });
const b = fs.readFileSync(tmp); fs.unlinkSync(tmp);
// BMP: pixel data offset at 10, width 18, height 22 (positive = rows stored bottom-up), bits per pixel 28
const off = b.readUInt32LE(10), W = b.readInt32LE(18), H0 = b.readInt32LE(22), H = Math.abs(H0), bpp = b.readUInt16LE(28);
if (W !== res || H !== res || (bpp !== 24 && bpp !== 32)) throw new Error('unexpected BMP ' + W + '×' + H + ' at ' + bpp + ' bpp');
const stride = Math.ceil(W * bpp / 8 / 4) * 4, lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const Y = new Float64Array(res * res); let mx = 0;
for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
  const o = off + r * stride + x * bpp / 8, v = 0.2126 * lin(b[o + 2]) + 0.7152 * lin(b[o + 1]) + 0.0722 * lin(b[o]);   // BGR(A)
  const rowFromBottom = H0 > 0 ? r : H - 1 - r;                   // paint row 0 = bottom, as in the app
  Y[rowFromBottom * res + x] = v; if (v > mx) mx = v;
}
const paint = Array.from(Y, (y) => { const n = mx > 0 ? y / mx : 0, v = n <= black ? 0 : Math.pow((n - black) / (1 - black), gamma); return v < 0.02 ? 0 : +v.toFixed(3); });
const dir = path.join(__dirname, '..', 'bench-out', 'photos'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, name + '-' + res + '.json');
fs.writeFileSync(out, JSON.stringify({ name, source: path.basename(img), res, black, gamma, paint }));
const lit = paint.filter((v) => v > 0).length;
console.log(out + ': ' + lit + ' of ' + res * res + ' cells lit, mean level ' + (paint.reduce((s, v) => s + v, 0) / Math.max(1, lit)).toFixed(2));
