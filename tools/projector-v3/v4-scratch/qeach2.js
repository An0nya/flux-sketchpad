// qeach.js <scene.json>: each quadrant alone (+ lens): where its light peaks vs where it was aimed
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const { renderFF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/ffpng.js');
const base = fs.readFileSync(process.argv[2], 'utf8'); const aims = process.argv[3] ? JSON.parse(process.argv[3]) : { UL: [-3, -0.5], UR: [3, 0], LR: [1, 0], LL: [-1, -0.5] };
for (const q of (process.argv[4] ? process.argv[4].split(',') : ['UL', 'UR', 'LR', 'LL'])) {
  const sc = RF.State.deserialize(base); sc.groups.A.surfaces = sc.groups.A.surfaces.filter((s) => !/p3_ellipsoid_/.test(s.id) || s.id === 'p3_ellipsoid_' + q);
  const { G, ev } = judge(sc, 2e5); const K = 0.5; let pk = 0, ph = 0, pv = 0; const cells = [];
  for (let h = -12; h <= 12; h += 0.1) for (let v = -8; v <= 6; v += 0.1) { const c = RF.FarField.intensityAt(G, h, v, K).cd; if (c > pk) { pk = c; ph = h; pv = v; } cells.push([h, v, c]); }
  let sw = 0, sh = 0, sv = 0, hmin = 99, hmax = -99; for (const [h, v, c] of cells) if (c >= 0.5 * pk) { sw += c; sh += c * h; sv += c * v; hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
  fs.writeFileSync('out/Q-' + q + '.png', renderFF(RF, G, sc.modeD, { ev, label: q }).png);
  console.log(q, 'aimed', JSON.stringify(aims[q]), '| peak', Math.round(pk), 'cd at', ph.toFixed(1), pv.toFixed(1), '| half-max centroid', (sh / sw).toFixed(1), (sv / sw).toFixed(1), '| half-max width h', hmin.toFixed(1), '..', hmax.toFixed(1), '| lm', G.lmWindow.toFixed(0));
}
