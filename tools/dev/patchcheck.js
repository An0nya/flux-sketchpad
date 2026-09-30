// per-patch check: trace ONE patch alone and compare its traced blob (centre, spread, energy) with the solver's prediction.
// node tools/dev/patchcheck.js scene ['{"settings"}'] [nPatches]
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const RF = require(path.join(ROOT, 'tests/load.js')).load();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers/lab-sqm.js'), 'utf8'));
const scenes = require(path.join(ROOT, 'tools/bench-scenes.js')).all(RF);
const nm = process.argv[2] || 'anya-shot-245', over = JSON.parse(process.argv[3] || '{}'), NP = +(process.argv[4] || 8);
const S = RF.Solvers, def = S.get('sqm');
const sc = scenes[nm](); sc.mode = 'A'; sc.solve = { id: 'sqm' };
const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, over)); settings.debug = true;
const out = def.solve(S.inputOf(sc), settings, {});
const R = sc.target.res, bl = out.debug.blobs;
const ids = out.surfaces.map((s) => s.id);
const pick = []; for (let i = 0; i < NP; i++) pick.push(ids[Math.floor((i + 0.5) * ids.length / NP)]);
for (const id of pick) {
  const j = +id.slice(1), b = bl[j];
  sc.groups.A.surfaces = out.surfaces.filter((s) => s.id === id); sc.sim.seed = 4242;
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); const c = RF.Engine.runSync(P, 400000);
  const tg = new Float64Array(c.gridD.length); for (let i = 0; i < tg.length; i++) tg[i] = c.gridD[i] + c.gridR[i]; const g = RF.Engine.toPaintGrid(tg, P.res, R); let w = 0, mx = 0, my = 0, sxx = 0, syy = 0;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { const v = g[y * R + x]; w += v; mx += v * (x + 0.5); my += v * (y + 0.5); }
  mx /= w; my /= w;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { const v = g[y * R + x]; sxx += v * (x + 0.5 - mx) ** 2; syy += v * (y + 0.5 - my) ** 2; }
  console.log(id.padEnd(5), 'pred centre', (b.cx + 0.5).toFixed(1), (b.cy + 0.5).toFixed(1), 'sd', b.sx.toFixed(2), b.sy.toFixed(2), ' | traced centre', mx.toFixed(1), my.toFixed(1), 'sd', Math.sqrt(sxx / w).toFixed(2), Math.sqrt(syy / w).toFixed(2), ' m', (b.m || 0).toFixed(2));
}
// full assembly with attribution: landed energy per facet vs the prediction (blobEnergy: predicted on-grid energy)
{
  sc.groups.A.surfaces = out.surfaces; sc.sim.seed = 4242;
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const c = RF.Engine.runSync(P, 1000000);
  const per = {}; for (let h = 0; h < c.nHits; h++) { const k = c.hitK[h]; if (!k) continue; const id = P.G.metas[k - 1].id; per[id] = (per[id] || 0) + c.hits[3 * h + 2]; }
  const rows = out.debug.blobs.map((b, j) => ({ id: 'Q' + j, pred: out.debug.blobEnergy[j], got: per['Q' + j] || 0, share: b.share })).filter((r) => out.surfaces.some((s) => s.id === r.id));
  let sp = 0, sg = 0; for (const r of rows) { sp += r.pred; sg += r.got; }
  const rat = rows.map((r) => ({ id: r.id, q: (r.got / sg) / (r.pred / sp), share: r.share })).sort((a, b) => a.q - b.q);
  const ql = (p) => rat[Math.floor(p * (rat.length - 1))].q.toFixed(2);
  console.log('per-facet landed / predicted (each normalised to its total): min', ql(0), 'p10', ql(0.1), 'p50', ql(0.5), 'p90', ql(0.9), 'max', ql(1), ' total predicted', sp.toFixed(1), 'traced', sg.toFixed(1));
  console.log(' worst low', rat.slice(0, 5).map((r) => r.id + ':' + r.q.toFixed(2)).join(' '), ' worst high', rat.slice(-5).map((r) => r.id + ':' + r.q.toFixed(2)).join(' '));
}
