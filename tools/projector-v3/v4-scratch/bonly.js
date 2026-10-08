// bonly.js <scene.json> <name>: bottom half only (+ lens), far field PNG + the 10 kcd width
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const { renderFF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/ffpng.js');
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); sc.groups.A.surfaces = sc.groups.A.surfaces.filter((s) => s.id !== 'p3_ellipsoid_top');
const { G, ev } = judge(sc, 4e6); const r = renderFF(RF, G, sc.modeD, { ev, label: process.argv[3] }); fs.writeFileSync('out/' + process.argv[3] + '.png', r.png);
const K = 0.4; let pk = 0, a = 99, b = -99; for (let h = -10; h <= 10; h += 0.1) for (let v = -6; v <= 4; v += 0.1) { const c = RF.FarField.intensityAt(G, h, v, K).cd; if (c > pk) pk = c; if (c >= 10000) { a = Math.min(a, h); b = Math.max(b, h); } }
console.log(process.argv[3], 'png peak', Math.round(r.peak), '| smoothed peak', Math.round(pk), '| >=10k h', a.toFixed(1), '..', b.toFixed(1), '| lm', G.lmWindow.toFixed(0));
