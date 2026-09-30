// in-process SQM debugging: node tools/dev/sqm-dev.js scene[,scene] ['{"settings":1}'] [rays]
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const RF = require(path.join(ROOT, 'tests/load.js')).load();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers/lab-sqm.js'), 'utf8'));
const scenes = require(path.join(ROOT, 'tools/bench-scenes.js')).all(RF);
const names = (process.argv[2] || 'default').split(','), over = JSON.parse(process.argv[3] || '{}'), RAYS = +(process.argv[4] || 300000);
if (process.env.SQMDBG) globalThis.SQMDBG = +process.env.SQMDBG;
const S = RF.Solvers, def = S.get('sqm');
for (const nm of names) {
  const sc = scenes[nm](); sc.mode = 'A'; sc.solve = { id: 'sqm' };
  const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, over));
  if (over.debug) settings.debug = true;
  const t0 = Date.now(); const out = def.solve(S.inputOf(sc), settings, {}); const ms = Date.now() - t0;
  sc.groups.A.surfaces = out.surfaces; sc.sim.seed = 90210;
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); const c = RF.Engine.runSync(P, RAYS);
  const fd = RF.Photometry.fidelity(sc, P, c);
  console.log(nm.padEnd(16), 'fid', (100 * fd.fidelity).toFixed(1), 'within', (100 * fd.within).toFixed(1), 'gaps', (100 * fd.gapsDark).toFixed(1), 'onPaint', (100 * fd.onPaint).toFixed(1), 'pred', (100 * out.pred.fid).toFixed(1), '/', (100 * out.pred.onPaint).toFixed(1), 'patches', out.surfaces.length, ms + 'ms', 'noiseCeil', fd.fidelityNoiseCeiling == null ? '-' : (100 * fd.fidelityNoiseCeiling).toFixed(1));
  if (out.debug && out.debug.truth) console.log('   continuum flux error vs targets (fine lattice):', JSON.stringify(out.debug.truth, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  if (process.env.SHOW) {                                   // delivered/wanted ratio per painted cell: . <0.5, - <0.8, = within, + <1.25.. , # <2, @ >2 ; ' ' unpainted
    const R = sc.target.res, ra = fd.ratioAt, step = +process.env.SHOW;
    for (let j = R - 1; j >= 0; j -= step) { let s = ''; for (let i = 0; i < R; i += step) { const k = j * R + i, v = ra[k]; s += sc.modeA.paint[k] <= 0 ? (fd.verdict[k] === 3 ? '!' : ' ') : v < 0.5 ? '.' : v < 0.8 ? '-' : v <= 1.25 ? '=' : v < 1.6 ? '+' : v < 2 ? '#' : '@'; } console.log(s); }
  }
  if (process.env.SHOWPRED && out.debug) {                  // the solver's own predicted field, same legend
    const R = sc.target.res, F = out.debug.F, p = sc.modeA.paint, step = +process.env.SHOWPRED; let a = 0, b = 0; for (let k = 0; k < R * R; k++) { a += F[k] * p[k]; b += p[k] * p[k]; } const scl = a / b;
    console.log('predicted:');
    for (let j = R - 1; j >= 0; j -= step) { let s = ''; for (let i = 0; i < R; i += step) { const k = j * R + i, v = F[k] / Math.max(1e-30, p[k] * scl); s += p[k] <= 0 ? ' ' : v < 0.5 ? '.' : v < 0.8 ? '-' : v <= 1.25 ? '=' : v < 1.6 ? '+' : v < 2 ? '#' : '@'; } console.log(s); }
  }
  if (process.env.BLOBS && out.debug) { const bl = out.debug.blobs.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx); for (const b of bl.slice(0, +process.env.BLOBS)) console.log('  blob', b.j, 'centre', b.cx.toFixed(1), b.cy.toFixed(1), 'sd x,y (cells)', b.sx.toFixed(2), b.sy.toFixed(2), 'rho', b.rho.toFixed(2), 'share', b.share.toFixed(4), 'm', (b.m || 0).toFixed(2)); }
  if (process.env.ENERGY) console.log('   energy tallies', JSON.stringify(c.E, (k, v) => typeof v === 'number' ? +v.toPrecision(4) : v));
  if (process.env.CMP && out.debug) {                      // traced / predicted per painted cell
    const R = sc.target.res, F = out.debug.F, tg = new Float64Array(c.gridD.length); for (let i = 0; i < tg.length; i++) tg[i] = c.gridD[i] + c.gridR[i];
    const G = RF.Engine.toPaintGrid(tg, P.res, R); let a = 0, b = 0; for (let k = 0; k < R * R; k++) { a += G[k]; b += F[k]; }
    console.log('   traced total', a.toFixed(2), 'predicted total', b.toFixed(2));
    const step = +process.env.CMP; console.log('traced/predicted:');
    for (let j = R - 1; j >= 0; j -= step) { let s = ''; for (let i = 0; i < R; i += step) { const k = j * R + i; const v = (G[k] / a) / Math.max(1e-30, F[k] / b); s += sc.modeA.paint[k] <= 0 ? ' ' : F[k] < 1e-9 ? '0' : v < 0.5 ? '.' : v < 0.8 ? '-' : v <= 1.25 ? '=' : v < 1.6 ? '+' : v < 2 ? '#' : '@'; } console.log(s); }
  }
  if (process.env.BINS) {                                   // verdict by paint brightness bin
    const pv = sc.modeA.paint, idx = []; for (let k = 0; k < pv.length; k++) if (pv[k] > 0) idx.push(k); idx.sort((a, b) => pv[a] - pv[b]);
    const nb = +process.env.BINS; for (let b = 0; b < nb; b++) { const sl = idx.slice(Math.floor(b * idx.length / nb), Math.floor((b + 1) * idx.length / nb)); let w = 0, u = 0, o = 0; for (const k of sl) { const v = fd.verdict[k]; if (v === 0) w++; else if (v === 1) u++; else if (v === 2) o++; }
      console.log('   paint', pv[sl[0]].toFixed(3), '-', pv[sl[sl.length - 1]].toFixed(3), 'cells', sl.length, 'within', (100 * w / sl.length).toFixed(0) + '%', 'under', (100 * u / sl.length).toFixed(0) + '%', 'over', (100 * o / sl.length).toFixed(0) + '%'); }
  }
  if (process.env.COVER && out.debug) {                     // blob area (12 sx sy: top-hat equivalent) vs painted area, by paint bin at the blob centre
    const R = sc.target.res, pv = sc.modeA.paint, idx = []; for (let k = 0; k < pv.length; k++) if (pv[k] > 0) idx.push(k); idx.sort((a, b) => pv[a] - pv[b]);
    const nb = +process.env.COVER, edges = []; for (let b = 0; b <= nb; b++) edges.push(pv[idx[Math.min(idx.length - 1, Math.floor(b * idx.length / nb))]]);
    for (let b = 0; b < nb; b++) { let n = 0, area = 0, sxx = 0, syy = 0; for (const bl of out.debug.blobs) { const k = Math.min(R - 1, Math.max(0, Math.floor(bl.cy))) * R + Math.min(R - 1, Math.max(0, Math.floor(bl.cx))); const v = pv[k]; if (v >= edges[b] && (v < edges[b + 1] || b === nb - 1)) { n++; area += 12 * bl.sx * bl.sy; sxx += bl.sx; syy += bl.sy; } }
      const cells = idx.length / nb; console.log('   paint bin', edges[b].toFixed(3), '-', edges[b + 1].toFixed(3), 'aims', n, 'cells/aim', (cells / Math.max(1, n)).toFixed(1), 'blob area/aim', (area / Math.max(1, n)).toFixed(1), 'coverage', (area / cells).toFixed(2), 'mean sd x,y', (sxx / Math.max(1, n)).toFixed(1), (syy / Math.max(1, n)).toFixed(1)); }
  }
  if (process.env.NOTES) console.log(out.notes.join('\n'));
}
