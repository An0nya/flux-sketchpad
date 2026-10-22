// HALO-WAVE-diag throwaway: draws (in a headless page canvas) (1) front-vs-D plot from the front2 CSVs and (2) three overlays
// (on-frame at D=60,45,35 with predicted bin edges as thin lines). node plots.js <port> <haloDir>
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991), H = process.argv[3];
const ana = JSON.parse(fs.readFileSync(H + '/theory/analysis_theory.json', 'utf8'));
const meta = {}; for (const r of ana) if (r.meta) meta[r.D] = { eye: r.eye, hfov: r.meta.hfov, dEu: r.meta.dEu, h: r.meta.h, w: r.meta.w };
function table(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const out = {};
  for (const r of rows) { const D = +r[0], off = +r[3], half = r[7] === 'na' ? null : +r[7]; (out[D] = out[D] || []).push({ off, half }); }
  const res = {};
  for (const D of Object.keys(out)) { const v = out[D].filter((x) => [-30, -15, 15, 30].includes(x.off) && x.half !== null).map((x) => x.half).sort((a, b) => a - b); res[D] = v.length ? v[v.length >> 1] : null; }
  return res;
}
const th = table(H + '/theory/front2_theory.csv'), la = table(H + '/ladder/front2_ladder.csv');
const Ds = Object.keys(th).map(Number).sort((a, b) => b - a);
const series = { theory: th, ladder: la };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 1000 } })).newPage();
    await page.setContent('<html><body style="margin:0;background:#fff"><canvas id=c width=900 height=640></canvas></body></html>');
    const plot = await page.evaluate(([Ds, series]) => {
      const c = document.getElementById('c'), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const L = 70, B = 580, R = 870, T = 40, X = (d) => L + (d - 25) / (105 - 25) * (R - L), Y = (m) => B - m / 90 * (B - T);
      x.strokeStyle = '#999'; x.fillStyle = '#000'; x.font = '14px sans-serif'; x.lineWidth = 1;
      for (let m = 0; m <= 90; m += 10) { x.beginPath(); x.moveTo(L, Y(m)); x.lineTo(R, Y(m)); x.stroke(); x.fillText(m + ' m', 20, Y(m) + 5); }
      for (let d = 30; d <= 100; d += 10) { x.fillText(d + ' m', X(d) - 12, B + 20); }
      x.fillText('car (lamp) distance D, m', L + 280, B + 42); x.save(); x.translate(18, 300); x.rotate(-Math.PI / 2); x.fillText('front (ground distance, m)', 0, 0); x.restore();
      // theory lines: 0.45D, 0.7D (the prediction), fixed ladder 34 m
      const line = (f, color, dash) => { x.setLineDash(dash); x.strokeStyle = color; x.beginPath(); x.moveTo(X(25), Y(f(25))); x.lineTo(X(105), Y(f(105))); x.stroke(); x.setLineDash([]); };
      line((d) => 0.7 * d, '#0072B2', [6, 4]); line((d) => 0.45 * d, '#E69F00', [2, 4]); line(() => 34, '#555', [10, 5]);
      x.fillStyle = '#0072B2'; x.fillText('0.7D (prediction)', X(70), Y(0.7 * 70) - 8); x.fillStyle = '#B07000'; x.fillText('0.45D (first edge)', X(72), Y(0.45 * 72) + 16); x.fillStyle = '#555'; x.fillText('fixed 34 m edge', X(90), Y(34) - 8);
      const pts = (tab, color, fill) => { x.fillStyle = color; for (const D of Ds) { const v = tab[D]; if (v === null || v === undefined) continue; x.beginPath(); x.arc(X(D), Y(v), 5, 0, 7); if (fill) x.fill(); else { x.strokeStyle = color; x.stroke(); } } };
      pts(series.theory, '#000', true); pts(series.ladder, '#CC79A7', false);
      x.fillStyle = '#000'; x.fillText('black dots: forced by haloEdgesFor (as coded). pink rings: forced fixed ladder', L, 24);
      x.fillText('headless SwiftShader, 476x268 buffer, median of half-plateau front over offsets -30..+30 px', L, 600);
      return c.toDataURL('image/png');
    }, [Ds, series]);
    fs.writeFileSync(H + '/front_vs_D.png', Buffer.from(plot.split(',')[1], 'base64'));
    for (const D of [60, 45, 35]) {
      const img = fs.readFileSync(H + '/theory/on_D' + D + '.png').toString('base64');
      const m = meta[D]; const lines = [0.45, 0.7, 0.85, 1.0, 1.6].map((f) => ({ f, c: ['#E69F00', '#0072B2', '#009E73', '#FFFFFF', '#CC79A7'][[0.45, 0.7, 0.85, 1.0, 1.6].indexOf(f)] })).concat([{ f: 'ladder34', c: '#888' }]);
      const url = await page.evaluate(async ([img, D, eye, tanH, ratioHW, dEu, lines]) => {
        const im = new Image(); im.src = 'data:image/png;base64,' + img; await im.decode();
        const S = 2, c = document.createElement('canvas'); c.width = im.width * S; c.height = im.height * S; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, c.width, c.height);
        const HB = 268, rowOf = (G) => { const s = -eye[2] / (G * tanH * ratioHW); return ((1 - s) / 2 * HB - 0.5 + 0.5) * S; };
        x.font = '13px sans-serif';
        for (const L of lines) {
          const G = L.f === 'ladder34' ? 34 : L.f * dEu, y = rowOf(G);
          x.strokeStyle = L.c; x.lineWidth = 1; x.setLineDash(L.f === 'ladder34' ? [6, 4] : []); x.beginPath(); x.moveTo(0, y); x.lineTo(c.width, y); x.stroke(); x.setLineDash([]);
          x.fillStyle = L.c; x.fillText((L.f === 'ladder34' ? 'fixed 34 m' : L.f + 'D = ' + G.toFixed(1) + ' m'), 6, y - 3);
        }
        x.fillStyle = '#fff'; x.fillText('car D=' + D + ' m (headless). Lines: predicted edges; grey dashed: fixed 34 m', 6, 16);
        return c.toDataURL('image/png');
      }, [img, D, m.eye, Math.tan(m.hfov * Math.PI / 360), m.h / m.w, m.dEu, lines]);
      fs.writeFileSync(H + '/overlay_D' + D + '.png', Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log('plots written');
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
