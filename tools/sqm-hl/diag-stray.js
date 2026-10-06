// Run the pipeline, then attribute traced light above the cut-off to facets (first hit).
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js'); const V = RF.V;
for (const f of ['target', 'plan', 'sqm', 'emit', 'fwd', 'pipeline']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', f + '.js'), 'utf8'), { filename: f + '.js' });
const args = {}; for (let i = 2; i < process.argv.length; i++) { const s = process.argv[i]; if (s.startsWith('--')) args[s.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const sc = makeScene(args.scene || 'box', { preset: args.preset || 'ece-r112-b', budget: +(args.n || 100) }); const input = RF.Solvers.inputOf(sc);
const S = { verbose: false, iters: +(args.iters || 0) }; const out = RF.SqmPipe.solve(input, S, { progress() {}, budget: { ms: 1e9 } }); const P = out.P, facets = out.surfaces;
sc.groups.A.surfaces = facets; const N = 4e6, Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); Pp.recordExit = true; Pp.exitCap = N; Pp.recordHits = true; Pp.hitCap = 1;
const c = RF.Engine.runSync(Pp, N, 0), ex = c.ex, rayK = c.rayK, G = Pp.G, v0 = +(args.v0 || 0.3), per = new Map(); let tot = 0, direct = 0;
for (let r = 0; r < ex.n; r++) { const hv = RF.FarField.hvOf([ex.d[3 * r], ex.d[3 * r + 1], ex.d[3 * r + 2]], P.conv), e = ex.e[r]; if (!(hv[1] > v0 && hv[1] < 12 && Math.abs(hv[0]) < 12)) continue; tot += e; if (ex.b[r] < 1) { direct += e; continue; } const id = G.metas[rayK[ex.i[r]] - 1].id; const o = per.get(id) || { e: 0, b2: 0 }; o.e += e; if (ex.b[r] > 1) o.b2 += e; per.set(id, o); }
console.log(`light in |h|<12, v ${v0}…12: ${tot.toFixed(1)} lm; direct ${direct.toFixed(1)}; the rest by facet:`);
[...per.entries()].sort((a, b) => b[1].e - a[1].e).slice(0, 6).forEach(([id, o]) => { const f = facets.find((x) => x.id === id), a = P.A[f.aimIndex]; const fp = RF.SqmFwd.footprint(f, P.S_, P.grid, { na: 40 }); console.log(`  ${id}: ${o.e.toFixed(1)} lm above (${o.b2.toFixed(1)} multi-bounce); aim (${a.h.toFixed(1)}, ${a.v.toFixed(1)}) ${a.tier}${a.seeded ? '/seed' : ''} share ${a.g.toFixed(1)} lm, model flux ${(fp.flux / P.refl).toFixed(1)}, ${f.clip.pts3.length} pts, vg ${f.vg ? f.vg.map((x) => x.toFixed(4)) : '-'}`); });
const C = RF.SqmCore; const as = C.assign(out.Df, out.on, P.A, out.best.x);
for (const id of ['Q94', 'Q96']) { const f = facets.find((x) => x.id === id), j = f.aimIndex; let n = 0, fl = 0; const cells = []; for (let i = 0; i < out.Df.n; i++) if (as.asg[i] === j) { n++; fl += out.Df.m[i]; cells.push(i); }
  const pts = f.clip.pts3; let dmax = 0; for (const a of pts) for (const b of pts) dmax = Math.max(dmax, V.dist(a, b));
  // polygon area vs the cells' footprint
  console.log(`${id}: aim idx ${j}, OT cells ${n} (${fl.toFixed(2)} lm), polygon diameter ${dmax.toFixed(1)} mm, centre distance from LED ${V.dist(f.P, P.Lp).toFixed(1)} mm, beta ${Math.exp(out.best.x[j]).toFixed(2)}; the OTHER facets' beta median ${(() => { const b = Array.from(out.best.x).map(Math.exp).sort((x, y) => x - y); return b[b.length >> 1].toFixed(2); })()}`);
  // where do its cells lie (angles from the beam axis)?
  const angs = cells.map((i) => out.Df.ang[i]).sort((a, b) => a - b); console.log('   cell angle from axis min/med/max', angs[0]?.toFixed(0), angs[angs.length >> 1]?.toFixed(0), angs[angs.length - 1]?.toFixed(0)); }
