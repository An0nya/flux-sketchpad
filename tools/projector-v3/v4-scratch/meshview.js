// meshview.js <scene.json> <out.svg> <az> <el> [oldOutline]: orthographic painter's-algorithm render of the reflector halves via RF.Geo.mesh (or outline)
const fs = require('fs'); const { RF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const az = +process.argv[4] * Math.PI / 180, el = +process.argv[5] * Math.PI / 180, old = process.argv[6] === 'old';
const surf = RF.State.allSurfaces(sc), G = RF.Geo.compile(surf), L = sc.source.pos;
const cam = (p) => { const x = p[0] - L[0], y = p[1] - L[1], z = p[2] - L[2]; const xr = x * Math.cos(az) + y * Math.sin(az), yr = -x * Math.sin(az) + y * Math.cos(az); return [yr, z * Math.cos(el) - xr * Math.sin(el), xr * Math.cos(el) + z * Math.sin(el)]; };   // screen x = lateral, y = up, depth = toward camera
const light = V.norm([0.3, 0.5, 0.8]); const items = [];
surf.forEach((s, k) => { const isR = /ellipsoid/.test(s.id), isLens = /lens/.test(s.id); if (!isR && !isLens) return; const col = s.id.includes('top') ? [255, 170, 90] : s.id.includes('bottom') ? [110, 200, 255] : isR ? [200, 200, 220] : [150, 150, 150];
  for (const poly of (old ? RF.Geo.outline(G, k) : RF.Geo.mesh(G, k))) { const pr = poly.map(cam); const a = V.sub(pr[1], pr[0]), b = V.sub(pr[pr.length - 1], pr[0]); let n = V.cross(a, b); n = V.len(n) > 1e-9 ? V.norm(n) : [0, 0, 1]; items.push({ pr, z: pr.reduce((t, q) => t + q[2], 0) / pr.length, lam: 0.35 + 0.65 * Math.abs(V.dot(n, light)), col, lens: isLens }); } });
items.sort((a, b) => a.z - b.z);
let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const it of items) for (const q of it.pr) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
const W = 800, H = 500, m = 20, s = Math.min((W - 2 * m) / (x1 - x0), (H - 2 * m) / (y1 - y0)), X = (q) => (m + (q[0] - x0) * s).toFixed(1), Y = (q) => (H - m - (q[1] - y0) * s).toFixed(1);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#10151c"/>`;
for (const it of items) { const c = it.col.map((x) => Math.round(x * it.lam)); svg += `<polygon points="${it.pr.map((q) => X(q) + ',' + Y(q)).join(' ')}" fill="rgb(${c})" fill-opacity="${it.lens ? 0.25 : 0.55}" stroke="rgba(220,230,255,0.55)" stroke-width="0.5"/>`; }
const lp = cam(L); svg += `<circle cx="${X(lp)}" cy="${Y(lp)}" r="5" fill="#f5b85a"/><text x="10" y="18" fill="#9aa" font-family="sans-serif" font-size="12">${process.argv[2].split('/').pop()}  az ${process.argv[4]} el ${process.argv[5]} ${old ? '(old outline)' : '(mesh)'}  polys ${items.length}</text></svg>`;
fs.writeFileSync(process.argv[3], svg); console.log('wrote', process.argv[3], items.length, 'polys');
