// W3b: wall time of one solve in Node, split into time inside tools.trace / the ray loop / everything else.
//   node tests/bench/solver-par.js <scene.json> <solver-id> [--set k=v ...] [--tag x] [--verify 1e6] [--out results.jsonl] [--profile]
// Runs on the main thread (same V8 as a worker thread), tools.trace = the host's own RF.Solvers.trace, wrapped in a timer.
// Appends one JSON line per run.  Digest = hash of the output surfaces (same input + seed ⇒ same digest).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { load, ROOT } = require('../load.js');
const RF = load();
const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flags = (k) => argv.flatMap((a, i) => (a === '--' + k ? [argv[i + 1]] : []));
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['profile'].includes(argv[i - 1].slice(2))));
const [sceneFile, id] = pos;
const fileOf = {};   // solver id → its source file (a pool worker loads the same text)
for (const m of JSON.parse(fs.readFileSync(path.join(ROOT, 'solvers/index.json'), 'utf8'))) { const p = path.join(ROOT, 'solvers', m.file), before = new Set(RF.Solvers.list().map((d) => d.id)); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); for (const d of RF.Solvers.list()) if (!before.has(d.id)) fileOf[d.id] = p; }
const sc = RF.State.deserialize(fs.readFileSync(path.resolve(sceneFile), 'utf8')), def = RF.Solvers.get(id);
if (!def) { console.error('no solver ' + id); process.exit(1); }
const sets = Object.fromEntries(flags('set').map((kv) => { const i = kv.indexOf('='), v = kv.slice(i + 1); return [kv.slice(0, i), v !== '' && !isNaN(+v) ? +v : v === 'true' ? true : v === 'false' ? false : v]; }));
const input = RF.Solvers.inputOf(sc);
const problem = Object.assign(RF.U.deepCopy({ source: sc.source, emitters: sc.emitters || [], envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: sc.mode }), { target: input.target, modeA: { paint: input.paint && input.paint.cells } });
const settings = RF.Solvers.sanitize(def, Object.assign(RF.Solvers.settingsOf(sc, id), sets));
// timers: tools.trace wall (setup + rays + judge), and the ray loop alone (Engine.traceRange)
let traceMs = 0, nTrace = 0, rays = 0, loopMs = 0, depth = 0;
const E = RF.Engine, trR = E.traceRange; E.traceRange = function () { const t = performance.now(); try { return trR.apply(this, arguments); } finally { loopMs += performance.now() - t; } };
const runSync = E.runSync; E.runSync = function () { const t = performance.now(); try { return runSync.apply(this, arguments); } finally { loopMs += performance.now() - t; } };
const timed = async (f, o) => { if (depth++ === 0) { nTrace++; rays += Math.max(1, (o && o.rays) | 0 || 20000); } const t = performance.now(); try { return await f(); } finally { if (--depth === 0) traceMs += performance.now() - t; } };
const tools = { progress() {}, preview() {}, budget: { rays: 5e7, ms: +flag('ms', 1800000) }   /* = the page's BUDGET.rays and the bench page's time limit */, scene: problem,
  trace: (s, o) => { const t = performance.now(); nTrace++; rays += Math.max(1, (o && o.rays) | 0 || 20000); try { return RF.Solvers.trace(problem, s, o); } finally { traceMs += performance.now() - t; } },
  traceAsync: (s, o) => timed(() => RF.Solvers.traceAsync(problem, s, o), o) };
// --pool N: tools.pool with N worker threads (0 = the pool API with no workers: tasks run here); absent = no tools.pool at all (what a host without a pool gives)
const poolN = +flag('pool', -1); let pool = null;
if (poolN >= 0) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/solver-pool.js'), 'utf8'), { filename: 'solver-pool.js' });
  pool = RF.SolverPool.create({ size: poolN, spawn: require('../../tools/pool-worker-node.js').spawner(), id, srcs: [fs.readFileSync(fileOf[id], 'utf8')], scene: problem, input,
    run: (name, a) => def.tasks[name](input, a, { trace: tools.trace }), onRays: (n) => { rays += n; nTrace++; } });
  tools.pool = pool;
}
(async () => {
  if (argv.includes('--profile')) { try { require('inspector').Session; } catch (e) { /* */ } }
  const t0 = performance.now(), res = await def.solve(input, settings, tools), ms = performance.now() - t0;
  if (pool) pool.close();
  const facts = RF.Solvers.verify(sc, res || {});
  const row = { tag: flag('tag', ''), where: 'node', pool: poolN >= 0 ? poolN : null, solver: id, scene: path.basename(sceneFile), sets, wallMs: Math.round(ms), traceMs: Math.round(traceMs), loopMs: Math.round(loopMs), traces: nTrace, rays, otherMs: Math.round(ms - traceMs),
    placed: facts.placed, errors: facts.errors, digest: crypto.createHash('sha1').update(JSON.stringify(res.surfaces)).digest('hex').slice(0, 12), hash: (() => { const t = JSON.stringify(res.surfaces); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(16); })(), notes: (res.notes || []).slice(0, 3).map((s) => String(s).slice(0, 200)) };
  const V = +flag('verify', 0);
  if (V > 0 && !facts.errors.length) {   // judge the output the way the app would: same seed, fixed rays
    const t = RF.Solvers.trace(problem, res.surfaces, { rays: V, seed: input.seed, spec: sc.mode === 'D', guided: true, bounces: res.needs && res.needs.bounces });
    row.verify = sc.mode === 'D' && t.spec ? { rays: V, verdict: t.spec.verdict, n: t.spec.n, expFails: t.spec.expFails, lm: Math.round(t.spec.lmWindow * 10) / 10, score: +t.spec.score.toFixed(4) } : { rays: V, fid: t.fidelity && +t.fidelity.fidelity.toFixed(4), onPaint: t.fidelity && +t.fidelity.onPaint.toFixed(4), lm: t.lmOnTarget && Math.round(t.lmOnTarget * 10) / 10 };
  }
  console.log(JSON.stringify(row));
  const o = flag('out'); if (o) fs.appendFileSync(o, JSON.stringify(row) + '\n');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
