// W3c: the solver rollout (frozen-aim tuners, GPU-by-default settings, threads, sqm-hl speed-ups that must change nothing).  No DOM.
//   used by tests/regress-node.js; standalone: node tests/solver-rollout.js
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

async function run(RF, ok) {
  const loadSolver = (f, id) => { if (!RF.Solvers.get(id)) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers', f), 'utf8'), { filename: f }); };
  loadSolver('sealed-beam-v1.js', 'sealed-beam-v1'); loadSolver('sealed-beam-v2.js', 'sealed-beam-v2'); loadSolver('sonnet55-2026-09-28-dish-fit.js', 'dish-fit-auto'); loadSolver('opus55-2026-09-27-mosaic.js', 'opus-mosaic-auto');
  if (!RF.SolverPool) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'solver-pool.js'), 'utf8'), { filename: 'solver-pool.js' });
  const D = (id) => RF.Solvers.defaults(RF.Solvers.get(id));
  const hashOf = (o) => crypto.createHash('sha1').update(JSON.stringify(o.surfaces)).digest('hex').slice(0, 12);
  const problemOf = (sc, input) => Object.assign(RF.U.deepCopy({ source: sc.source, emitters: sc.emitters || [], envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: sc.mode }), { target: input.target, modeA: { paint: input.paint.cells } });
  const solveWith = async (sc, id, set, poolN, srcFile) => {
    const def = RF.Solvers.get(id), input = RF.Solvers.inputOf(sc), problem = problemOf(sc, input), settings = RF.Solvers.sanitize(def, Object.assign(RF.Solvers.settingsOf(sc, id), set));
    const tools = { progress() {}, preview() {}, budget: { rays: 5e7, ms: 1e9 }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o), traceAsync: (s, o) => RF.Solvers.traceAsync(problem, s, o) };
    if (poolN !== null) tools.pool = RF.SolverPool.create({ size: poolN, spawn: require('../tools/pool-worker-node.js').spawner(), id, srcs: [fs.readFileSync(path.join(ROOT, 'solvers', srcFile), 'utf8')], scene: problem, input, run: (n, a) => def.tasks[n](input, a, { trace: tools.trace }) });
    try { return await def.solve(input, settings, tools); } finally { if (tools.pool) tools.pool.close(); }
  };

  // 1. the defaults the rollout set: frozen aim in the spec tuners, GPU traces where W3b measured a clear win (and the CPU path is the same code without a GPU)
  const v1 = D('sealed-beam-v1'), v2 = D('sealed-beam-v2'), df = D('dish-fit-auto'), mo = D('opus-mosaic-auto');
  ok('W3c defaults: sealed-beam v1 and v2 tune at a frozen aim, through traceAsync (GPU when the host has it)', v1.tuneAim === 'frozen' && v2.tuneAim === 'frozen' && v1.tuneGpu === true && v2.tuneGpu === true, JSON.stringify([v1.tuneAim, v2.tuneAim, v1.tuneGpu, v2.tuneGpu]));
  ok('W3c defaults: dish-fit-auto traces on the GPU, mosaic stays on the CPU (W3b: 2.3x vs 1.17x)', df.traceGpu === true && mo.traceGpu === false, JSON.stringify([df.traceGpu, mo.traceGpu]));

  // 2. sealed-beam v1 with its new defaults = the explicit frozen CPU tuner; a full-aim verdict closes the run; 'scan' (the old default) is still reachable and different
  const sb = RF.State.deserialize(fs.readFileSync(path.join(ROOT, 'examples', 'sealed-beam-7in-low.json'), 'utf8')), tune = { tune: true, tuneEvals: 8, tuneRays: 20000, tuneSeconds: 0 };
  const a = await solveWith(sb, 'sealed-beam-v1', tune, null), b = await solveWith(sb, 'sealed-beam-v1', Object.assign({ tuneAim: 'frozen', tuneGpu: false }, tune), null), c = await solveWith(sb, 'sealed-beam-v1', Object.assign({ tuneAim: 'scan', tuneGpu: false }, tune), null);
  ok('W3c sealed-beam v1: default tuner = explicit frozen/CPU tuner (same surfaces), and it ends with a full-aim verdict', hashOf(a) === hashOf(b) && a.notes.some((n) => /^final full-aim verdict: \{/.test(n)), hashOf(a) + ' vs ' + hashOf(b));
  ok('W3c sealed-beam v1: tuneAim scan still runs (no verdict line: every trace was a full-aim one)', c.surfaces.length > 0 && !c.notes.some((n) => /^final full-aim verdict/.test(n)), c.notes[0].slice(0, 80));
  const a2 = await solveWith(sb, 'sealed-beam-v2', tune, null);
  ok('W3c sealed-beam v2: frozen by default, full-aim verdict at the end', a2.notes.some((n) => /^final full-aim verdict: \{/.test(n)), a2.notes[0].slice(0, 80));

  // 3. determinism across thread counts: opus-mosaic-auto (small), same design for no pool / 0 / 2 / 3 workers
  const scm = RF.State.defaultScene(); scm.modeA.budget = 30; const small = { screenRays: 60000, finalRays: 100000 };
  const m0 = hashOf(await solveWith(scm, 'opus-mosaic-auto', small, null, 'opus55-2026-09-27-mosaic.js')), m1 = hashOf(await solveWith(scm, 'opus-mosaic-auto', small, 0, 'opus55-2026-09-27-mosaic.js')),
    m2 = hashOf(await solveWith(scm, 'opus-mosaic-auto', small, 2, 'opus55-2026-09-27-mosaic.js')), m3 = hashOf(await solveWith(scm, 'opus-mosaic-auto', small, 3, 'opus55-2026-09-27-mosaic.js'));
  ok('W3c opus-mosaic-auto: no pool = pool of 0 = 2 workers = 3 workers (same design)', m0 === m1 && m1 === m2 && m2 === m3, [m0, m1, m2, m3].join(' '));

  // 3b. spec-hl-v3: its candidates run side by side with a pool (2 candidates at effort 'quick', 30 facets): the same design as one after the other (~25 s)
  loadSolver('spec-hl-v3.js', 'spec-hl-v3');
  {
    const { makeScene } = require('../tools/sqm-hl/scenes.js'), sc3 = makeScene('box', { preset: 'ece-r112-b', budget: 30 }); sc3.sim.seed = 1;
    const v0 = await solveWith(sc3, 'spec-hl-v3', { effort: 'quick' }, 0, 'spec-hl-v3.js'), v2p = await solveWith(sc3, 'spec-hl-v3', { effort: 'quick' }, 2, 'spec-hl-v3.js');
    ok('W3c spec-hl-v3: pool of 0 = pool of 2 workers (same design, candidates compared in menu order)', hashOf(v0) === hashOf(v2p) && v0.surfaces.length > 10, hashOf(v0) + ' vs ' + hashOf(v2p));
  }

  // 4. sqm-hl: footprint / logBlur / polish were rewritten for speed (typed scratch instead of a Map, hoisted weights, cached per-pixel costs): the OLD code (tests/sqm-reference.js)
  //    must give the same numbers bit for bit on a real problem
  {
    const lib = require('../tools/sqm-hl/lib.js'), { makeScene } = require('../tools/sqm-hl/scenes.js'), ref = require('./sqm-reference.js');
    for (const f of ['target', 'plan', 'sqm', 'emit', 'fwd', 'pipeline']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'tools', 'sqm-hl', 'dev', f + '.js'), 'utf8'), { filename: f + '.js' });
    const sc = makeScene('box', { preset: 'ece-r112-b', budget: 24 }), input = lib.RF.Solvers.inputOf(sc);
    const S = { NA: 90, NAcoarse: 40, iters: 2, sweeps: 3, search: 1, naEval: 40, shellRank: 1, traces: 0, traceRays: 0 };
    const out = lib.RF.SqmPipe.solve(input, S, { progress() {}, budget: { ms: 1e9 } }), P = out.best ? out.P : null;
    ok('W3c sqm-hl: a small solve ran to compare against the reference', !!P && out.surfaces.length > 8, out.surfaces.length + ' facets');
    if (P) {
      const same = (x, y) => { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (!(x[i] === y[i])) return false; return true; };
      const F = RF.SqmFwd || lib.RF.SqmFwd; let nFp = 0, fpOk = true;
      for (const f of out.surfaces.slice(0, 8)) {
        const o = { na: 40, occlude: false }, p1 = F.footprint(f, P.S_, P.grid, o), p0 = ref.footprint(F, f, P.S_, P.grid, o); nFp++;
        if (!(same(p1.idx, p0.idx) && same(p1.val, p0.val) && p1.flux === p0.flux && p1.hc === p0.hc && p1.vc === p0.vc && same(p1.cov, p0.cov))) fpOk = false;
      }
      ok('W3c sqm-hl footprint: identical idx / val / flux / moments to the old Map version (' + nFp + ' facets)', fpOk);
      const T = (RF.SqmTarget || lib.RF.SqmTarget); let lbOk = true;
      for (const [sv, sh] of [[0.3, 0.1], [0.8, 0], [0, 0.2], [1.7, 0.45]]) if (!same(T.logBlur(P.g, P.des.T, sv, sh), ref.logBlur(P.g, P.des.T, sv, sh))) lbOk = false;
      ok('W3c sqm-hl logBlur: identical to the old loop for four (sv, sh) pairs, edges included', lbOk);
      const opt = { wBand: P.S.wBand, wTrack: P.S.wTrack, wEdge: P.S.wEdge, f0: P.S.f0, maxShift: P.S.maxShift, steps: [0.05, 0.1, 0.2], scales: [0.9, 1.1], sweeps: 3 }, m = out.best.m;
      const q1 = lib.RF.SqmPipe.polish(P, out.best.facets, m, opt), q0 = ref.polish(P, out.best.facets, m, opt);
      const unitsSame = q1.units.every((u, i) => u.di === q0.units[i].di && u.dj === q0.units[i].dj && u.k === q0.units[i].k);
      ok('W3c sqm-hl polish: same moves, same costs, same E as the old trial loop (' + q1.units.filter((u) => u.di || u.dj || u.k !== 1).length + ' units moved)', unitsSame && q1.cost0 === q0.cost0 && q1.cost1 === q0.cost1 && same(q1.E, q0.E) && q1.units.some((u) => u.di || u.dj), q1.cost0.toFixed(3) + ' → ' + q1.cost1.toFixed(3));
    }
  }
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; }).then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e.stack || e); process.exit(1); }); }
