// none.js <scene.json>: emission direction of the rays that touch no surface at all (angle from +x, and azimuth in the y-z plane)
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js');
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const { P } = judge(sc, 2e5); const N = 40000, pw = sc.source.power;
const phi = new Array(18).fill(0), az = new Array(12).fill(0), all = new Array(18).fill(0); let n = 0;
for (let i = 0; i < N; i++) {
  const p = RF.Engine.retrace(P, i); const flat = !Array.isArray(p[0]); const a = flat ? [p[0], p[1], p[2]] : p[0], b = flat ? [p[3], p[4], p[5]] : p[1]; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); const ph = Math.acos(d[0] / L) * 180 / Math.PI; all[Math.min(17, Math.floor(ph / 10))]++;
  if (p.ks.length === 0) { n++; phi[Math.min(17, Math.floor(ph / 10))]++; const ag = (Math.atan2(d[2], d[1]) * 180 / Math.PI + 360) % 360; az[Math.floor(ag / 30)]++; }
}
const f = (x) => Math.round(x / N * pw);
console.log('rays touching nothing:', n, '=', f(n), 'lm');
console.log('by angle from +x (10° bins) lm touching nothing / total emitted lm:'); console.log(phi.map((x, k) => `${k * 10}-${k * 10 + 10}°: ${f(x)}/${f(all[k])}`).join('  '));
console.log('by azimuth in the y-z plane (30° bins; 0 = +y left, 90 = up) lm:', az.map((x, k) => `${k * 30}°:${f(x)}`).join('  '));
