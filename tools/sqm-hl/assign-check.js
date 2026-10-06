// For a scene's facets: where on the reflector (azimuth about the optical axis, measured from the LED) vs where in the beam (aim h,v)?
const { RF, loadScene } = require('./lib.js');
const sc = loadScene(process.argv[2]); const V = RF.V;
const S = sc.source.pos, fac = RF.State.allSurfaces(sc).filter((s) => s.type === 'facet');
const rows = fac.map((f) => {
  const d = V.sub(f.P, S), az = Math.atan2(d[2], -d[1]) * 180 / Math.PI;     // 0° = reflector's RIGHT (as seen looking down the beam), 90° = top
  const hv = RF.FarField.hvOf(V.sub(f.Z, S), 'A');
  const rho = Math.hypot(d[1], d[2]);
  return { id: f.id, az, rho, x: d[0], h: hv[0], v: hv[1], r: V.len(d) };
});
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const top = rows.map((r) => Math.sin(r.az * Math.PI / 180)), right = rows.map((r) => Math.cos(r.az * Math.PI / 180));
const aimV = rows.map((r) => Math.max(-6, Math.min(4, r.v))), aimH = rows.map((r) => Math.max(-20, Math.min(20, r.h)));
console.log('facets', rows.length, ' patch radius from LED: min/med/max', Math.min(...rows.map((r) => r.r)).toFixed(0), rows.map((r) => r.r).sort((a, b) => a - b)[rows.length >> 1].toFixed(0), Math.max(...rows.map((r) => r.r)).toFixed(0), 'mm');
console.log('corr(patch topness, aim elevation) =', corr(top, aimV).toFixed(2), '  corr(patch rightness, aim H) =', corr(right, aimH).toFixed(2));
// aim elevation by reflector sector (8 sectors of 45°, centred on 0°=right, 90°=top...)
const names = ['right', 'upper-right', 'top', 'upper-left', 'left', 'lower-left', 'bottom', 'lower-right'];
for (let k = 0; k < 8; k++) { const sel = rows.filter((r) => { let a = ((r.az % 360) + 360) % 360; const c = k * 45; let d = Math.abs(a - c); if (d > 180) d = 360 - d; return d <= 22.5; }); if (!sel.length) continue; const vs = sel.map((r) => r.v).sort((a, b) => a - b); console.log(names[k].padEnd(12), 'n', String(sel.length).padStart(3), ' aim elevation (deg) min/median/max', vs[0].toFixed(1), vs[vs.length >> 1].toFixed(1), vs[vs.length - 1].toFixed(1), ' aim H median', sel.map((r) => r.h).sort((a, b) => a - b)[sel.length >> 1].toFixed(1)); }
