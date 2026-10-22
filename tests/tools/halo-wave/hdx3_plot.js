// HDX3 bake-off plot: median approx/exact ratio per log-distance bin, D=50, three combinations. Writes an SVG (no browser).
const fs = require('fs');
const P = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), OUT = process.argv[3];
const series = [['adaptive6|a_today', 'today: adaptive 6 bins, bin0 linear', '#000'], ['adaptive6|d_pchip', 'adaptive 6 bins, PCHIP', '#E69F00'], ['geo24|d_pchip', 'geometric 24 bins, PCHIP (winner)', '#0072B2']];
const W = 760, Hh = 460, L = 70, R = 20, T = 30, B = 50;
const xs = (d) => L + (Math.log10(d) - Math.log10(0.5)) / (Math.log10(120) - Math.log10(0.5)) * (W - L - R);
const ys = (r) => T + (Hh - T - B) * (1 - (Math.log10(Math.min(Math.max(r, 0.05), 20)) - Math.log10(0.05)) / (Math.log10(20) - Math.log10(0.05)));
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" font-family="sans-serif" font-size="12"><rect width="100%" height="100%" fill="#fff"/>`;
for (const r of [0.1, 0.5, 1, 2, 5, 10]) svg += `<line x1="${L}" x2="${W - R}" y1="${ys(r)}" y2="${ys(r)}" stroke="#ddd"/><text x="8" y="${ys(r) + 4}">${r}</text>`;
for (const d of [1, 2, 5, 10, 20, 50, 100]) svg += `<text x="${xs(d) - 8}" y="${Hh - 30}">${d}</text>`;
svg += `<line x1="${xs(20)}" x2="${xs(20)}" y1="${T}" y2="${Hh - B}" stroke="#999" stroke-dasharray="3 3"/><text x="${xs(20) + 3}" y="${T + 12}">20 m</text>`;
svg += `<line x1="${xs(1)}" x2="${W - R}" y1="${ys(1)}" y2="${ys(1)}" stroke="#666"/>`;
svg += `<text x="${L}" y="${T - 10}">HDX3 bake-off, D = 50 m: approx / exact, median per log-distance bin (end distance d, m)</text>`;
let ly = T + 14;
series.forEach(([key, label, col], si) => {
  const rows = P[key].map((r) => [r.d, r.ratio]).filter(([d, r]) => d >= 0.5 && r > 0);
  const nb = 24, bins = Array.from({ length: nb }, () => []);
  for (const [d, r] of rows) { const k = Math.floor((Math.log10(d) - Math.log10(0.5)) / (Math.log10(120) - Math.log10(0.5)) * nb); if (k >= 0 && k < nb) bins[k].push(r); }
  const pts = [];
  bins.forEach((b, k) => { if (!b.length) return; b.sort((x, y) => x - y); const med = b[b.length >> 1], dc = Math.pow(10, Math.log10(0.5) + (k + 0.5) / nb * (Math.log10(120) - Math.log10(0.5))); pts.push([dc, med]); });
  svg += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.map(([d, r]) => xs(d) + ',' + ys(r)).join(' ')}"/>`;
  svg += `<line x1="${W - 330}" x2="${W - 300}" y1="${ly}" y2="${ly}" stroke="${col}" stroke-width="2"/><text x="${W - 294}" y="${ly + 4}">${label}</text>`;
  ly += 18;
});
svg += `<text x="${L}" y="${Hh - 10}">x: end distance d (log scale, 0.5 to 120 m). y: approx/exact (log scale, 0.05 to 20). Black/orange/blue = curves. Dashed line 20 m.</text></svg>`;
fs.writeFileSync(OUT, svg); console.log('wrote', OUT);
