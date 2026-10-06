// Experiment for the "arbitrary dish" solver: take the finished SQM geometry and push every facet out along its ray (homothety about the LED: the aim and the flux are
// unchanged, the die image shrinks as 1/r).  How much do facets then block each other (model flux with occlusion), and what does the judge say?
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'build', 'sqm-hl.debug.js'), 'utf8'), { filename: 'sqm-hl.js' }); const X = globalThis.__sqm, V = RF.V;
const name = process.argv[2] || 'box', frac = process.argv[3] ? +process.argv[3] : 1;
const sc = name.startsWith('file:') ? makeScene(name, { budget: 100 }) : makeScene(name, { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const S = Object.assign({}, X.SqmPipe.DEFAULTS, { verbose: false }), P = X.SqmPipe.problem(input, S, {}), Dc = X.SqmPipe.directions(P, S.NAcoarse), Df = X.SqmPipe.directions(P, S.NA); let Mtot = 0; for (let i = 0; i < Df.n; i++) Mtot += Df.m[i];
X.SqmPipe.design(P, 0.7 * Mtot); let onC = new Uint8Array(Dc.n).fill(1), x = new Float64Array(P.A.length).fill(Math.log(40)); X.SqmPipe.balance(P, Dc, onC, x, true); let cov = X.SqmPipe.fitSurface(P, Dc, onC, x, X.SqmPipe.mainNeed(P));
X.SqmPipe.design(P, cov); onC = new Uint8Array(Dc.n).fill(1); x = new Float64Array(P.A.length).fill(Math.log(40)); X.SqmPipe.balance(P, Dc, onC, x, true); X.SqmPipe.fitSurface(P, Dc, onC, x, X.SqmPipe.mainNeed(P));
const on = new Uint8Array(Df.n).fill(1); cov = X.SqmPipe.fitSurface(P, Df, on, x, X.SqmPipe.mainNeed(P));
const as = X.SqmCore.assign(Df, on, P.A, x), rm = X.SqmEmit.rhoMax(Df, on, P.A, x, as);
const mx = Array.from(rm.max).filter(isFinite).sort((a, b) => a - b); console.log(`${name}: rhoMax over ${mx.length} facets: min ${mx[0].toFixed(2)} p25 ${mx[mx.length >> 2].toFixed(2)} median ${mx[mx.length >> 1].toFixed(2)} p75 ${mx[(mx.length * 3) >> 2].toFixed(2)} max ${mx[mx.length - 1].toFixed(2)}`);
function variant(label, rho) {
  const R = Array.from(rm.max).map((r, j) => rho(isFinite(r) ? r : 1, j));
  const em = X.SqmEmit.emitAll(Df, on, P.A, x, { refl: P.refl, rho: R }); let facets = em.facets; facets.forEach((f) => { f.aimRef = P.A[f.aimIndex]; });
  if (P.Ad.length) { const dec = X.SqmEmit.placeDecals(Df, on, P.A, x, as, P.Ad, { rho: R }); for (const dc of dec.decals) { const f = X.SqmEmit.decalFacet(Df, on, x, P.A, as, dc, { rho: R }); if (f) { f.aimRef = dc.aim; facets.push(f); } } }
  X.SqmEmit.clipEnvelope(facets, P.env, P.Lp, P.rmin); facets = facets.filter((f) => !f._dead);
  const nat = X.SqmPipe.naturalOf(P, facets), base = facets, params = base.map(() => ({ dh: 0, dv: 0 }));
  const t0 = Date.now(); const fl = X.SqmPipe.realize(P, base, nat, params), m = X.SqmPipe.evaluate(P, fl, Df, on);
  const sig = nat.filter((q) => q.flux > 0.3).map((q) => Math.sqrt(Math.max(0, q.cov[0] + q.cov[2]) / 2)).sort((a, b) => a - b);
  // blocked share of the facets' own flux: the model with and without occlusion
  const noOcc = X.SqmFwd.field(fl, P.S_, P.grid, { na: 40 }), withOcc = X.SqmFwd.field(fl, P.S_, P.grid, { na: 40, occlude: true }); const f0 = noOcc.fps.reduce((s, q) => s + q.flux, 0), f1 = withOcc.fps.reduce((s, q) => s + q.flux, 0);
  console.log(`${label.padEnd(14)} ${facets.length} facets | image σ median ${sig[sig.length >> 1].toFixed(2)}° | blocked ${(100 * (1 - f1 / f0)).toFixed(0)}% of facet flux | model ${m.ev.verdict} ${JSON.stringify(m.ev.n)} worst ${m.worst.toFixed(2)} | ${m.ev.rows.filter((r) => r.verdict === 'fail').map((r) => r.name).join(',')}`);
}
variant('natural', () => 1);
for (const f of [0.5, 0.75, 0.9, 1.0]) variant(`push ${f}`, (r) => 1 + f * (r * 0.97 - 1));
