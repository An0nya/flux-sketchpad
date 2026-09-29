#!/usr/bin/env node
// Solver development bench: solvers × scenes → a table (and one JSON row per cell in bench-out/).
//   node tools/bench.js --solvers dish-fit,opus-mosaic --scenes core [--rays 1000000] [--budget N] [--jobs 6]
//        [--settings '{"dish-fit":{"focus":40}}'] [--seed 90210] [--tag note] [--quiet]
// --solvers: ids registered by js/solver-env.js or by any file in solvers/ (the bundled model solvers), or a path
//   to a solver file (every paint solver it registers is added; pick one with path.js#id).
// --scenes: names and groups from tools/bench-scenes.js (core, orient, die, paint, anya, held, all).
// Scoring uses the app's own definitions (RF.Photometry.fidelity/fixture) on a trace seed the solver never sees
// (the solver gets the scene's seed; the trace uses --seed).  Budget: the scene's own unless --budget; the
// solver's minDistance is 0 unless --settings says otherwise, as in the benchmark.
// "possible peak" (Anya's definition, 2026-09-29): the LED light that passes through the envelope (capturable) ×
// reflectivity, spread exactly like the paint, gives the paint's brightest cell an intensity; the envelope's
// brightness ceiling caps it.  ofPossible = simulated peak ÷ that (≥ 0.5 = "closer to the max than to 0");
// meanOfIdeal = the average painted cell's delivered ÷ ideal.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const RAYS = +opt('rays', 1000000), JOBS = +opt('jobs', Math.max(1, Math.min(8, os.cpus().length - 2))), SEED = +opt('seed', 90210);
const BUDGET = opt('budget', null), SETTINGS = JSON.parse(opt('settings', '{}')), TAG = opt('tag', ''), QUIET = args.includes('--quiet');
const SCENES = require('./bench-scenes.js');

// solver sources: the bundled folder, plus any paths given
const bundled = fs.existsSync(path.join(ROOT, 'solvers')) ? fs.readdirSync(path.join(ROOT, 'solvers')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'solvers', f)) : [];
const want = opt('solvers', 'spoke').split(',').filter(Boolean), files = new Set(bundled), ids = [];
for (const w of want) { const [p, id] = w.split('#'); if (p.endsWith('.js')) { files.add(path.resolve(p)); ids.push(id || '@' + path.resolve(p)); } else ids.push(w); }

const WORKER = `
const { parentPort, workerData: W } = require('worker_threads'), fs = require('fs'), path = require('path'), vm = require('vm');
const RF = require(path.join(W.root, 'tests/load.js')).load(), S = RF.Solvers, E = RF.Engine, V = RF.V;
let SC = null; try { SC = require(path.join(require('os').homedir(), 'Projects/agent-qa/tools/flux-scoring.js')); } catch (e) {}
const byFile = {};
for (const f of W.files) { const got = [], reg = S.register; S.register = (d) => { const id = reg(d); got.push(id); return id; };
  try { vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); } catch (e) { byFile[f] = { error: String(e.message) }; } finally { S.register = reg; }
  if (!byFile[f]) byFile[f] = { ids: [...new Set(got)] }; }
const scenes = require(path.join(W.root, 'tools/bench-scenes.js')).all(RF);
function resolveId(id) { if (id[0] !== '@') return id; const b = byFile[id.slice(1)]; if (!b || !b.ids) throw new Error('could not load ' + id.slice(1) + (b ? ': ' + b.error : '')); return b.ids.find((x) => S.get(x).modes.includes('paint') && !/-auto$/.test(x)) || b.ids[0]; }
parentPort.postMessage({ type: 'ready', files: byFile });
parentPort.on('message', async (job) => {
  const r = { solver: job.solver, scene: job.scene };
  try {
    const id = resolveId(job.solver), def = S.get(id); if (!def) throw new Error('no solver ' + id);
    r.solver = id; r.version = def.version;
    const sc = scenes[job.scene](); if (job.budget) sc.modeA.budget = +job.budget; sc.mode = 'A'; sc.solve = { id };
    r.budget = sc.modeA.budget;
    const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, job.settings || {}));
    const input = S.inputOf(sc), problem = { source: sc.source, target: sc.target, envelope: sc.envelope, sim: sc.sim, modeA: { paint: sc.modeA.paint } };
    let traced = 0; const tools = { progress() {}, budget: { ms: 120000, rays: 5e7 }, scene: problem, trace: (s, o) => { traced += (o && o.rays) || 20000; return S.trace(problem, s, o); } };
    const t0 = process.hrtime.bigint(), out = await def.solve(input, settings, tools); r.solveMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e6); r.solverRays = traced;
    const f = S.verify(sc, out);
    r.placed = f.placed; r.outside = f.violations.envelope.length; r.inClear = f.violations.keepOut.length; r.errors = f.errors;
    if (f.errors.length) { parentPort.postMessage(r); return; }
    sc.groups.A.surfaces = out.surfaces; sc.sim.seed = W.seed;
    const P = E.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const c = E.runSync(P, W.rays);
    const st = E.stats(c, { paint: sc.modeA.paint, paintRes: sc.target.res }), ph = RF.Photometry.fixture(sc, P, c), fd = RF.Photometry.fidelity(sc, P, c);
    // possible peak (see header): flux limit at the paint's brightest cell vs the envelope ceiling
    const p = sc.modeA.paint, pmax = Math.max(...p), psum = p.reduce((a, b) => a + b, 0), cellM2 = (2 * P.T.half / P.res) ** 2 * 1e-6 * (P.res / sc.target.res) ** 2;
    // capturable = the share of the LED's emission whose ray passes through the envelope (a mirror there could catch it;
    // 1 for an LED inside the box), from 40k deterministic samples of the real source
    const smp = RF.Source.makeSampler(sc.source), o = [0, 0, 0], d = [0, 0, 0]; let seedv = 12345, inBox = 0; const rnd = () => ((seedv = (seedv * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 40000; n++) { RF.Source.sampleRay(smp, rnd(), rnd(), rnd(), rnd(), rnd(), o, d); const iv = RF.Geo.envInterval(sc.envelope, o, d); if (iv && iv[1] > Math.max(0, iv[0]) + 1e-6) inBox++; }
    const capt = inBox / 40000;
    const dm = V.dist(P.T.C, sc.source.pos) / 1000, R = sc.modeA.reflectivity, fluxPk = sc.source.power * capt * R * (pmax / psum) / cellM2 * dm * dm;
    const possible = capt > 0 ? Math.min(fluxPk, ph.envelopeCeiling || Infinity) : 0;   // an LED outside the envelope facing away: nothing is capturable
    // mean over painted cells of delivered ÷ ideal (ideal = the capturable flux spread exactly like the paint)
    const Gp = RF.Engine.toPaintGrid(RF.Engine.gridTotal(c), P.res, sc.target.res), eTot = c.E.emitted;
    let mr = 0, mc = 0; for (let k = 0; k < p.length; k++) if (p[k] > 0) { mr += (Gp[k] / eTot) / (capt * R * p[k] / psum); mc++; }
    r.capturable = capt; r.meanOfIdeal = mc && capt > 0 ? mr / mc : null;
    Object.assign(r, { fidelity: fd.fidelity, within: fd.within, gapsDark: fd.gapsDark, onPaint: fd.onPaint, spill: fd.spill, peakCd: ph.peakCd, possiblePeak: possible,
      ofPossible: possible > 0 ? ph.peakCd / possible : null, ofEnvelope: ph.ofEnvelope, blocked: st.occlusion.blocked, shadowed: st.occlusion.shadowed, U0: st.uniformity,
      U: SC ? SC.uniformity(fd, p, sc.target.res).U : null, notes: (out.notes || []).slice(0, 4) });
  } catch (e) { r.error = String(e && e.stack || e).split('\\n').slice(0, 3).join(' | '); }
  parentPort.postMessage(r);
});`;

(async () => {
  const RF = require(path.join(ROOT, 'tests/load.js')).load();
  const sceneNames = SCENES.resolve(RF, opt('scenes', 'core'));
  const jobs = []; for (const s of ids) for (const n of sceneNames) jobs.push({ solver: s, scene: n, budget: BUDGET, settings: SETTINGS[s.replace(/^@.*\//, '')] || SETTINGS[s] || null });
  const results = new Array(jobs.length); let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, () => new Promise((resolve) => {
    const w = new Worker(WORKER, { eval: true, workerData: { root: ROOT, files: [...files], rays: RAYS, seed: SEED } });
    const feed = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } const i = next++; w.once('message', (r) => { results[i] = r; done++; if (!QUIET) process.stderr.write('\r' + done + '/' + jobs.length + ' '); feed(); }); w.postMessage(jobs[i]); };
    w.once('message', (m) => { if (m.type === 'ready') { for (const [f, b] of Object.entries(m.files)) if (b.error && ids.some((x) => x === '@' + f)) console.error('load error ' + f + ': ' + b.error); feed(); } });
    w.on('error', (e) => { console.error('worker died: ' + e.message); resolve(); });
  })));
  if (!QUIET) process.stderr.write('\n');
  // table: one block per solver, one line per scene
  const pc = (x) => (x === null || x === undefined || !isFinite(x) ? '    —' : (100 * x).toFixed(1).padStart(5));
  const lines = [], sum = {};
  lines.push('rays ' + RAYS.toLocaleString() + ' · trace seed ' + SEED + (BUDGET ? ' · budget ' + BUDGET : '') + (TAG ? ' · ' + TAG : '') + ' · ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  lines.push('scene                 fid  within  gaps  onPaint ofPoss ofIdeal U    placed   ms  notes');
  let cur = null;
  for (const r of results) {
    if (!r) continue;
    const key = r.solver + (r.version ? ' v' + r.version : '');
    if (key !== cur) { cur = key; lines.push('── ' + key); }
    const s = (sum[key] = sum[key] || { n: 0, fid: 0, op: 0, pk: 0, u: 0, fails: 0, ms: 0 });
    if (r.error || (r.errors && r.errors.length) || r.outside || r.inClear) {
      s.n++; s.fails++;
      lines.push(r.scene.padEnd(20) + '  FAIL ' + (r.error || (r.errors || []).join('; ') || ('outside envelope ' + r.outside + ', in clearance ' + r.inClear + (r.fidelity !== undefined ? ' (fid ' + pc(r.fidelity) + ')' : ''))).slice(0, 110));
      continue;
    }
    s.n++; s.fid += r.fidelity; s.op += r.onPaint; s.pk += Math.min(1, r.ofPossible || 0); s.u += r.U || 0; s.ms += r.solveMs;
    lines.push(r.scene.padEnd(20) + pc(r.fidelity) + '  ' + pc(r.within) + ' ' + pc(r.gapsDark) + '   ' + pc(r.onPaint) + '  ' + pc(r.ofPossible) + '  ' + pc(r.meanOfIdeal) + '  ' + (r.U === null ? '  — ' : r.U.toFixed(2)) + ' ' + (r.placed + '/' + r.budget).padStart(8) + String(r.solveMs).padStart(6) + (r.solverRays ? '  traced ' + (r.solverRays / 1e6).toFixed(1) + 'M' : ''));
  }
  lines.push('', 'solver                               mean fid  onPaint  ofPoss   U    fails  mean ms   (failures count as 0)');
  for (const [k, s] of Object.entries(sum)) lines.push(k.padEnd(36) + pc(s.fid / s.n).padStart(9) + pc(s.op / s.n).padStart(9) + pc(s.pk / s.n).padStart(8) + (s.u / s.n).toFixed(2).padStart(6) + String(s.fails).padStart(7) + String(Math.round(s.ms / Math.max(1, s.n - s.fails))).padStart(9));
  console.log(lines.join('\n'));
  const outDir = path.join(ROOT, 'bench-out'); fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString();
  fs.appendFileSync(path.join(outDir, 'bench.jsonl'), results.filter(Boolean).map((r) => JSON.stringify(Object.assign({ t: stamp, rays: RAYS, seed: SEED, tag: TAG }, r))).join('\n') + '\n');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
