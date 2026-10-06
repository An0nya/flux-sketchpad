/* ffpng.js — far-field picture (log cd, cividis: no red/green) with the spec's points/zones/cut-off line drawn on top.
 *   renderFF(RF, G, md, { h:[-12,12], v:[-6,5], ppd: 40, k: 0.1, lo: 10 }) → PNG Buffer
 * Markers: point / zone verdict from `ev.rows` if given: pass = white ring, fail = orange X, unsure = white diamond.        */
const zlib = require('zlib');
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CIV = [[0, 32, 77], [49, 68, 107], [102, 105, 112], [149, 143, 120], [203, 186, 105], [255, 234, 70]];
const ramp = (st, t) => { t = Math.max(0, Math.min(1, t)); const x = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i; return [0, 1, 2].map((k) => Math.round(st[i][k] + (st[i + 1][k] - st[i][k]) * f)); };
const GLYPH = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', '.': '000000000000010', '-': '000000111000000', k: '101101110101101', ' ': '000000000000000' };

function renderFF(RF, G, md, o) {
  o = Object.assign({ h: [-12, 12], v: [-6, 5], ppd: 40, k: 0.1, lo: 10, ev: null, hi: null, label: '' }, o || {});
  const ppd = o.ppd, W = Math.round((o.h[1] - o.h[0]) * ppd), H = Math.round((o.v[1] - o.v[0]) * ppd), PAD = 28, WW = W, HH = H + PAD;
  const img = new Uint8Array(WW * HH * 3).fill(18);
  const cd = new Float64Array(W * H); let pk = 0;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const h = o.h[0] + (px + 0.5) / ppd, v = o.v[1] - (py + 0.5) / ppd, r = RF.FarField.intensityAt(G, h, v, o.k);
    const x = r.cd > 0 ? r.cd : 0; cd[py * W + px] = x; if (x > pk) pk = x;
  }
  const hi = o.hi || pk, lo = o.lo, L = (x) => (Math.log10(Math.max(x, 1e-9)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { const x = cd[py * W + px], c = x > lo ? ramp(CIV, L(x)) : [10, 14, 30], q = (py * WW + px) * 3; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; }
  const shf = o.ev && o.ev.shift ? o.ev.shift : [0, 0];
  const X0 = (h) => Math.round((h - o.h[0]) * ppd), Y0 = (v) => Math.round((o.v[1] - v) * ppd), X = (h) => X0(h + shf[0]), Y = (v) => Y0(v + shf[1]);
  const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) { const q = (y * WW + x) * 3; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; } };
  const line = (x0, y0, x1, y1, c, dash) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) { if (dash && (i >> 2) % 2) continue; put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); } };
  // isocandela contours of a few spec levels (thin, dark-on-light blend): 625, 2500, 10100
  const GRAY = [150, 150, 150];
  line(X0(0), 0, X0(0), H - 1, GRAY, true); line(0, Y0(0), W - 1, Y0(0), GRAY, true);
  const text = (x0, y0, s, c, z) => { z = z || 2; let x = x0; for (const ch of String(s)) { const g = GLYPH[ch] || GLYPH[' ']; for (let r = 0; r < 5; r++) for (let cc = 0; cc < 3; cc++) if (g[r * 3 + cc] === '1') for (let a = 0; a < z; a++) for (let b = 0; b < z; b++) { const px = x + cc * z + a, py = y0 + r * z + b; if (px >= 0 && px < WW && py >= 0 && py < HH) { const q = (py * WW + px) * 3; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; } } x += 4 * z; } };
  const OR = [255, 140, 0], WH = [255, 255, 255];
  const ev = o.ev, verdictOf = (name) => { if (!ev) return null; const rs = ev.rows.filter((r) => r.name === name); if (rs.some((r) => r.verdict === 'fail')) return 'fail'; if (rs.some((r) => r.verdict === 'unsure')) return 'unsure'; return rs.length ? 'pass' : null; };
  const sh = ev && ev.shift ? ev.shift : [0, 0];
  for (const it of (md.items || [])) {
    if (it.on === false) continue;
    const vd = verdictOf(it.name), col = vd === 'fail' ? OR : WH;
    if (it.kind === 'point') {
      const x = X(it.h), y = Y(it.v);
      if (vd === 'fail') { for (let d = -5; d <= 5; d++) { put(x + d, y + d, OR); put(x + d, y - d, OR); put(x + d + 1, y + d, OR); put(x + d + 1, y - d, OR); } }
      else if (vd === 'unsure') { for (let d = -5; d <= 5; d++) { put(x + d, y + (5 - Math.abs(d)), WH); put(x + d, y - (5 - Math.abs(d)), WH); } }
      else { for (let a = 0; a < 360; a += 6) put(Math.round(x + 5 * Math.cos(a * Math.PI / 180)), Math.round(y + 5 * Math.sin(a * Math.PI / 180)), WH); }
    } else if (it.kind === 'zone') { const p = it.poly; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), col, true); } }
    else if (it.kind === 'sum') for (const p of it.pts) { const x = X(p[0]), y = Y(p[1]); for (let d = -4; d <= 4; d++) { put(x + d, y, col); put(x, y + d, col); } }
    else if (it.kind === 'gradient' || it.kind === 'linearity') for (const h of (it.hs || [it.h])) { line(X(h), Y(it.v0), X(h), Y(it.v1), [120, 180, 255], true); }
  }
  // colour bar + labels
  const by = H + 6; for (let x = 0; x < W; x++) { const t = x / (W - 1), c = ramp(CIV, t); for (let y = 0; y < 8; y++) { const q = ((by + y) * WW + x) * 3; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; } }
  for (const lv of [10, 100, 625, 2500, 10100, 30000, 100000]) { if (lv < lo || lv > hi) continue; const x = Math.round(L(lv) * (W - 1)); for (let y = 0; y < 14; y++) put2(x, by + y); }
  function put2(x, y) { if (x >= 0 && x < WW && y >= 0 && y < HH) { const q = (y * WW + x) * 3; img[q] = 255; img[q + 1] = 255; img[q + 2] = 255; } }
  text(4, H + 14, o.label + ' pk ' + Math.round(pk), [220, 220, 220], 1);
  return { png: encodePNG(WW, HH, img), peak: pk };
}
module.exports = { renderFF, encodePNG };
