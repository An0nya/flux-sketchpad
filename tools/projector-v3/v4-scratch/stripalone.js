// stripalone.js <scene.json> <name>: the paraboloid strip alone (+ lens + shield): where its streak sits, how wide and thick, how bright
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const { renderFF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/ffpng.js');
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); sc.groups.A.surfaces = sc.groups.A.surfaces.filter((s) => !/p3_ellipsoid_/.test(s.id));
const { G, ev } = judge(sc, 2e6); const K = 0.5; let pk = 0, ph = 0, pv = 0; const cells = [];
for (let h = -30; h <= 30; h += 0.25) for (let v = -10; v <= 8; v += 0.25) { const c = RF.FarField.intensityAt(G, h, v, K).cd; cells.push([h, v, c]); if (c > pk) { pk = c; ph = h; pv = v; } }
const ext = (thr) => { let a = 99, b = -99, c = 99, d = -99; for (const [h, v, x] of cells) if (x >= thr) { a = Math.min(a, h); b = Math.max(b, h); c = Math.min(c, v); d = Math.max(d, v); } return `h ${a.toFixed(1)}..${b.toFixed(1)}, v ${c.toFixed(1)}..${d.toFixed(1)}`; };
fs.writeFileSync('out/' + process.argv[3] + '.png', renderFF(RF, G, sc.modeD, { ev, label: process.argv[3] }).png);
console.log(process.argv[3], '| peak', Math.round(pk), 'cd at', ph.toFixed(1), pv.toFixed(1), '| >=50% of peak:', ext(0.5 * pk), '| >=1000 cd:', ext(1000), '| >=300 cd:', ext(300), '| lm in window', G.lmWindow.toFixed(0));
