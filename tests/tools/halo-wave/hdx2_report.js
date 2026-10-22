// HDX2 throwaway: stats + CSV + error maps for grid_adaptive.json / grid_ladder.json. Car-body mask: off-frame luminance >= 200.
// node hdx2_report.js <port> <hdx2Dir> <adaptiveOnDir> <outPrefix>
const fs = require('fs'), zlib = require('zlib');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const [port, DIR, ONDIR_A, PRE0] = [+process.argv[2], process.argv[3], process.argv[4], process.argv[5]];
const REF = process.env.REF || 'cpu256', PRE = PRE0 + '_' + REF;   // reference: cpu256 (converged), cpu (32 steps, jit 0.5), cpuJ (mean of 8 jitters, 32 steps)
function lumOf(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } if (type === 'IDAT') idat.push(data); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0; let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = (raw[src + x] + pr) & 255; } }
  const lum = new Float32Array(w * h); for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * out[i * bpp] + 0.7152 * out[i * bpp + 1] + 0.0722 * out[i * bpp + 2];
  return { w, h, lum };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quant = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const modes = { adaptive: JSON.parse(fs.readFileSync(DIR + '/grid_adaptive.json', 'utf8')), ladder: JSON.parse(fs.readFileSync(DIR + '/grid_ladder.json', 'utf8')) };
const csv = ['mode,D,col_px,row_px,sEnd_m,gpu,cpu,ratio,log_ratio'];
const stats = { adaptive: [], ladder: [] };
const panels = {};
for (const mode of Object.keys(modes)) {
  panels[mode] = [];
  for (const run of modes[mode].runs) {
    const off = lumOf(fs.readFileSync(DIR + '/off_D' + Math.round(run.D) + '.png'));
    const D = run.D;
    const kept = [];
    for (const p of run.pts) {
      const i = p.r * off.w + p.c; if (off.lum[i] >= 200) continue;          // car body / lamp housing
      const cref = p[REF]; const q = { ...p, cpu: cref };
      if (!(cref > 0) || !(p.gpu > 0)) { kept.push({ ...q, ratio: null, lr: null }); continue; }
      kept.push({ ...q, ratio: p.gpu / cref, lr: Math.log(p.gpu / cref) });
    }
    const ok = kept.filter((k) => k.lr !== null);
    const med = quant(ok.map((k) => k.ratio), 0.5);
    const p95 = quant(ok.map((k) => Math.abs(k.lr)), 0.95);
    const zeroGpu = kept.filter((k) => k.gpu === 0 && k.cpu > 0).length, zeroCpu = kept.filter((k) => k.cpu === 0).length;
    const conv32 = run.pts.filter((k) => k.cpu256 > 0 && k.cpu > 0).map((k) => Math.abs(Math.log(k.cpu / k.cpu256))), convJ = run.pts.filter((k) => k.cpu256 > 0 && k.cpuJ > 0).map((k) => Math.abs(Math.log(k.cpuJ / k.cpu256)));
    const gmean = Math.exp(ok.reduce((a, k) => a + k.lr, 0) / ok.length);
    const row = { ref: REF, mode, D: +D.toFixed(1), geo_mean_gpu_over_ref: +gmean.toFixed(3), conv_32step_p95_abs_log: +quant(conv32, 0.95).toFixed(3), conv_jit8_p95_abs_log: +quant(convJ, 0.95).toFixed(3), edges: run.edges.map((x) => +x.toFixed(2)), n_grid: run.pts.length, n_masked: run.pts.length - kept.length, n_valid: ok.length, median_ratio: +med.toFixed(3), p95_abs_log_ratio: +p95.toFixed(3), n_gpu_zero: zeroGpu, n_cpu_zero: zeroCpu };
    stats[mode].push(row);
    for (const k of kept) csv.push([mode, D.toFixed(2), k.c - Math.round(run.lampCol), k.r, k.sEnd, k.gpu.toExponential(4), k.cpu.toExponential(4), k.ratio === null ? 'na' : k.ratio.toFixed(4), k.lr === null ? 'na' : k.lr.toFixed(4)].join(','));
    panels[mode].push({ D, lampRow: run.lampRow, lampCol: run.lampCol, eye: run.eye, hfov: run.hfov, h: run.h, w: run.w, edges: run.edges, pts: kept });
  }
}
fs.writeFileSync(PRE + '_points.csv', csv.join('\n') + '\n');
fs.writeFileSync(PRE + '_stats.json', JSON.stringify(stats, null, 1));
for (const m of Object.keys(stats)) for (const r of stats[m]) console.log(JSON.stringify(r));
// error maps: one PNG per mode, five panels (D 80,60,50,40,30), cells 8 px x 6 px drawn at 12 px; colour = log(gpu/cpu) on a blue-white-orange scale
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.setContent('<html><body style="margin:0"><canvas id=c></canvas></body></html>');
    for (const mode of Object.keys(panels)) {
      const url = await page.evaluate(([panels, mode]) => {
        const cw = 21 * 12, chh = 22 * 12, gap = 26, c = document.getElementById('c');
        c.width = panels.length * (cw + gap) + 20; c.height = chh + 90; const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.font = '13px sans-serif';
        const col = (v) => { const t = Math.max(-1, Math.min(1, v / 2.5)); const a = Math.abs(t); // 0 white; negative (GPU too dark) blue; positive (GPU too bright) orange
          return t < 0 ? [255 - 200 * a, 255 - 120 * a, 255] : [255, 255 - 110 * a, 255 - 230 * a]; };
        panels.forEach((P, k) => {
          const ox = 10 + k * (cw + gap), oy = 30;
          x.fillStyle = '#000'; x.fillText('D = ' + P.D.toFixed(0) + ' m (' + mode + ')', ox, 18);
          x.fillStyle = '#ddd'; x.fillRect(ox, oy, cw, chh);
          for (const p of P.pts) { if (p.gpu <= 0 || p.cpu <= 0) continue; const lr = Math.log(p.gpu / p.cpu); const cx = (p.c - Math.round(P.lampCol) + 80) / 8, cy = (p.r - Math.ceil(P.lampRow) - 1) / 6;
            const [R, G, B] = col(lr); x.fillStyle = `rgb(${R},${G},${B})`; x.fillRect(ox + cx * 12, oy + cy * 12, 12, 12); }
          // bin edges of this scheme as ground distances -> rows (thin lines); eye height P.eye[2], ray ratio h/w
          const tanH = Math.tan(P.hfov * Math.PI / 360), ratio = P.h / P.w, HB = 268;
          for (const G of P.edges) { const s = -P.eye[2] / (G * tanH * ratio); const row = (1 - s) / 2 * HB - 0.5; const yy = oy + (row - Math.ceil(P.lampRow) - 1) / 6 * 12 + 6;
            if (yy < oy || yy > oy + chh) continue; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 1; x.beginPath(); x.moveTo(ox, yy); x.lineTo(ox + cw, yy); x.stroke(); x.fillStyle = '#000'; x.fillText(G.toFixed(0) + 'm', ox + cw - 28, yy - 2); }
        });
        x.fillStyle = '#000'; x.fillText('x: column offset -80..+80 px (left to right). y: rows from the lamp row (top) to the bottom of the frame. Black lines: this scheme\'s bin edges as ground distance (m).', 10, c.height - 42);
        x.fillText('colour: log(GPU/CPU), saturating at +-2.5 (x12). blue = GPU darker than the CPU reference, orange = GPU brighter, white = agree. Grey = masked (car body) or no value.', 10, c.height - 22);
        return c.toDataURL('image/png');
      }, [panels[mode], mode]);
      fs.writeFileSync(PRE + '_errormap_' + mode + '.png', Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log('maps written');
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
