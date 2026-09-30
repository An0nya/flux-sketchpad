#!/usr/bin/env node
// Heatmap PNGs for judging designs by eye (no npm: Node's zlib is the whole encoder).
//   node tools/heatmap-png.js out.png label1,label2,...  [--dir bench-out/modes/runs] [--numbers 0.91,0.55,...] [--cols 3] [--exposure 1.6]
// Reads the run dumps written by tools/mode-run.js.  One image: the painting on the left of the first row, then per design
//   [ what the design delivered | difference from the painting ].
// Colours: nothing relies on red vs green.  Delivered = cividis (blue → yellow).  Difference = blue (too dark) ↔ white ↔ orange (too bright).
// Both are drawn with the same display curve (square root, so a dim wash next to a hotspot stays visible) and the delivered light is
// scaled so its total ON THE PAINTED CELLS equals the paint's total: the picture answers "is it the right shape and the right relative
// levels", not "how bright".  Light that lands outside the paint therefore shows up as light in the dark cells of the difference panel.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// ------------------------------------------------------------------ PNG encoder (8-bit RGB, no interlace)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePNG(w, h, rgb) {                 // rgb: Uint8Array w*h*3
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ colour maps
const CIV = [[0, 32, 77], [49, 68, 107], [102, 105, 112], [149, 143, 120], [203, 186, 105], [255, 234, 70]];   // cividis, 6 stops
const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops, t) { t = Math.max(0, Math.min(1, t)); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i; return [0, 1, 2].map((k) => Math.round(lerp(stops[i][k], stops[i + 1][k], f))); }
const cividis = (t) => ramp(CIV, t);
const gray = (t) => { const g = Math.round(255 * Math.max(0, Math.min(1, t))); return [g, g, g]; };
const DIV = [[8, 48, 107], [66, 146, 198], [255, 255, 255], [253, 174, 97], [166, 54, 3]];   // dark blue · blue · white · orange · dark orange
const diverge = (d) => ramp(DIV, 0.5 + 0.5 * Math.max(-1, Math.min(1, d)));                   // d in [-1, 1]: −1 far too dark, +1 far too bright
const disp = (x) => Math.sqrt(Math.max(0, x));                                               // display curve

// ------------------------------------------------------------------ tiny 3x5 digit font for labels
const GLYPH = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', '.': '000000000000010', '-': '000000111000000', '%': '101001010100101', '#': '101111101111101', ' ': '000000000000000' };
function drawText(img, W, x0, y0, text, z, fg, bg) {
  let x = x0; for (const ch of String(text)) { const g = GLYPH[ch] || GLYPH[' ']; for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) for (let a = 0; a < z; a++) for (let b = 0; b < z; b++) { const px = x + c * z + a, py = y0 + r * z + b, o = (py * W + px) * 3, col = g[r * 3 + c] === '1' ? fg : bg; if (col) { img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; } } x += 4 * z; }
}

// ------------------------------------------------------------------ panels
function normalisedDelivered(run) {          // delivered light scaled so its sum on the painted cells equals the paint's sum
  const { paint, D } = run; let sp = 0, sd = 0; for (let k = 0; k < paint.length; k++) if (paint[k] > 0) { sp += paint[k]; sd += D[k]; }
  const k = sd > 0 ? sp / sd : 0; return Float64Array.from(D, (x) => x * k);
}
function fill(img, W, x0, y0, R, z, f) { for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const c = f(i, R - 1 - j); for (let a = 0; a < z; a++) for (let b = 0; b < z; b++) { const o = ((y0 + j * z + a) * W + x0 + i * z + b) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } } }   // row 0 of the data is the bottom (v up)
function montage(runs, opt) {
  opt = opt || {}; const R = runs[0].R, z = opt.zoom || Math.max(1, Math.round(220 / R)), P = R * z, gap = 8, cols = opt.cols || 3, pad = 4;
  const tiles = [{ paint: true }].concat(runs.map((r, n) => ({ run: r, n })));
  const tileW = 2 * P + gap, rows = Math.ceil(tiles.length / cols), W = cols * (tileW + gap) + gap, H = rows * (P + gap + 16) + gap;
  const img = new Uint8Array(W * H * 3).fill(40);
  const pmax = (Math.max(...runs[0].paint) || 1) * (opt.exposure || 1);   // exposure > 1 dims the display so a bright wash doesn't saturate
  tiles.forEach((t, idx) => {
    const cx = gap + (idx % cols) * (tileW + gap), cy = gap + Math.floor(idx / cols) * (P + gap + 16) + 12;
    if (t.paint) { fill(img, W, cx, cy, R, z, (i, j) => cividis(disp(runs[0].paint[j * R + i] / pmax))); drawText(img, W, cx, cy - 10, 'PAINT', 1, [255, 255, 255], null); return; }
    const r = t.run, dl = normalisedDelivered(r);
    fill(img, W, cx, cy, R, z, (i, j) => cividis(disp(dl[j * R + i] / pmax)));
    fill(img, W, cx + P + gap, cy, R, z, (i, j) => { const d = dl[j * R + i] - r.paint[j * R + i]; return diverge(Math.sign(d) * Math.sqrt(Math.abs(d) / (0.5 * pmax / (opt.exposure || 1)))); });
    drawText(img, W, cx, cy - 10, '#' + (t.n + 1) + (opt.numbers ? ' ' + opt.numbers[t.n] : ''), 1, [255, 255, 255], null);
  });
  return { W, H, png: encodePNG(W, H, img) };
}
function loadRun(label, dir) { return JSON.parse(fs.readFileSync(path.join(dir, label + '.json'), 'utf8')); }
module.exports = { encodePNG, montage, normalisedDelivered, loadRun, cividis, diverge, gray };

if (require.main === module) {
  const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : a[i + 1]; };
  const dir = path.resolve(opt('dir', path.join(__dirname, '..', 'bench-out/modes/runs'))), out = a[0], labels = a[1].split(',');
  const runs = labels.map((l) => loadRun(l, dir)), m = montage(runs, { cols: +opt('cols', 3), exposure: +opt('exposure', 1), numbers: opt('numbers', null) ? opt('numbers').split(',') : null });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, m.png); console.log(out + ' ' + m.W + 'x' + m.H + '  paint, then: ' + labels.map((l, i) => '#' + (i + 1) + '=' + l).join('  '));
}
