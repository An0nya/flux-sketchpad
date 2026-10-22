// HALO-WAVE-diag throwaway: decode saved PNGs in node (zlib, 8-bit RGB/RGBA), halo delta = on - off per column,
// rows -> ground distance with the renderer's ray (pitch 0, eye z = height, road z = 0). Front per column.
// node front2.js <dir> <analysis.json> <out.csv>
const fs = require('fs'), zlib = require('zlib');
const [dir, anaPath, csvOut] = process.argv.slice(2);
function decode(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0;
      let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = (raw[src + x] + pr) & 255;
    }
  }
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * out[i * bpp] + 0.7152 * out[i * bpp + 1] + 0.0722 * out[i * bpp + 2];
  return { w, h, lum };
}
const A = JSON.parse(fs.readFileSync(anaPath, 'utf8'));
const CSV = ['D,dEu,dFw,offset_px,lampRow,steep_G,steep_slope,half_G,plateau_delta,n_sat_rows'];
const summary = [];
for (const r of A) {
  if (!r.prof) continue;
  const ON = decode(fs.readFileSync(dir + '/on_D' + r.D + '.png')), OFF = decode(fs.readFileSync(dir + '/off_D' + r.D + '.png'));
  const eye = r.eye, tanH = Math.tan(r.meta.hfov * Math.PI / 360), ratio = r.meta.h / r.meta.w, HB = 268, WB = 476;
  const L = r.meta.lamp0, dx = L[0] - eye[0];
  const sx = -(L[1] - eye[1]) / (dx * tanH), sy = (L[2] - eye[2]) / (dx * tanH * ratio);
  const lampCol = (sx + 1) / 2 * WB - 0.5, lampRow = (1 - sy) / 2 * HB - 0.5;
  const g = (row) => { const s = 1 - 2 * (row + 0.5) / HB; return s < 0 ? eye[2] / (-s * tanH * ratio) : Infinity; };
  const D = r.meta.dFw, row0 = Math.ceil(lampRow) + 1, yMax = HB - 3;
  const per = [];
  for (const off of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
    const cx = Math.round(lampCol + off), dlt = new Float32Array(HB), ok = new Uint8Array(HB);
    let nsat = 0;
    for (let y = row0; y <= yMax; y++) {
      const i = y * ON.w + cx; dlt[y] = ON.lum[i] - OFF.lum[i];
      ok[y] = (ON.lum[i] < 250 && OFF.lum[i] < 240) ? 1 : 0; if (!ok[y]) nsat++;
    }
    // steepest drop toward the camera (delta falls as the row grows), searched over g in [0.2D, D-2]
    let best = null;
    for (let y = row0 + 2; y <= yMax - 2; y++) {
      if (!ok[y - 2] || !ok[y + 2]) continue;
      const gy = g(y); if (gy > D - 2 || gy < 0.2 * D) continue;
      const slope = (dlt[y + 2] - dlt[y - 2]) / 4;
      if (!best || slope < best.slope) best = { gy, slope };
    }
    // half-plateau front: plateau = median delta over g in [0.4D, 0.8D]; front = the g where delta first falls below half the plateau, scanning toward the camera
    const pl = []; for (let y = row0; y <= yMax; y++) if (ok[y] && g(y) >= 0.4 * D && g(y) <= 0.8 * D) pl.push(dlt[y]);
    pl.sort((a, b) => a - b); const plateau = pl.length ? pl[pl.length >> 1] : null;
    let half = null;
    if (plateau !== null && plateau > 0) { let y0 = row0; while (y0 < yMax && g(y0) > 0.4 * D) y0++; for (let y = y0; y <= yMax; y++) { if (ok[y] && dlt[y] < 0.5 * plateau) { half = g(y); break; } } }
    CSV.push([r.D, r.meta.dEu.toFixed(2), D.toFixed(2), off, lampRow.toFixed(1), best ? best.gy.toFixed(2) : 'na', best ? best.slope.toFixed(1) : 'na', half === null ? 'na' : half.toFixed(2), plateau === null ? 'na' : plateau.toFixed(1), nsat].join(','));
    per.push({ off, steep: best && +best.gy.toFixed(1), half: half && +half.toFixed(1), plateau });
  }
  summary.push({ D: r.D, dEu: +r.meta.dEu.toFixed(2), lampRow: +lampRow.toFixed(1), per });
}
fs.writeFileSync(csvOut, CSV.join('\n') + '\n');
const med=(a)=>{const v=a.filter(x=>x!==null&&x!==undefined).sort((x,y)=>x-y);return v.length?v[v.length>>1]:null;};
for (const s of summary) console.log(JSON.stringify({ D: s.D, dEu: s.dEu, half_by_offset_m: s.per.map((x) => x.half), half_median: med(s.per.filter(x=>[-30,-15,15,30].includes(x.off)).map(x=>x.half)), steep_median_side: med(s.per.filter(x=>x.off!==0).map(x=>x.steep)), plateau_centre: s.per.find(x=>x.off===0).plateau }));
