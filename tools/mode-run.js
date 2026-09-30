#!/usr/bin/env node
// Run a plan of designs (solver × scene × settings) and keep what the mode metrics and the heatmaps need.
//   node tools/mode-run.js plan.json [--jobs 4] [--rays 1000000] [--seed 90210] [--out bench-out/modes]
// A plan is a JSON array of { label, solver, scene, settings?, budget?, keep?, keepSeed?, debug? }.
//   keep: 0..1 → after solving, keep a seeded random share of the facets (a deliberately bad design).
//   debug: pass S.debug to the solver (Fill & fix then also returns its own predicted field, saved as Fpred).
// Per job it writes <out>/runs/<label>.json (paint, the delivered light per paint cell as a share of the LED's emission, the
// numbers the metrics need) and appends one line to <out>/runs.jsonl.  Jobs whose dump exists are skipped, so a killed run resumes.
// Same tracing as tools/bench.js (trace seed the solver never sees, default 90210); --jobs is capped at 4 on this machine.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');

if (!isMainThread) {
  const RF = require(path.join(ROOT, 'tests/load.js')).load(), S = RF.Solvers, E = RF.Engine, V = RF.V, W = workerData;
  const scenes = require('./bench-scenes.js').all(RF), byId = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'solvers')).filter((x) => x.endsWith('.js'))) { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers', f), 'utf8'), { filename: f }); } catch (e) { /* reported when a job needs it */ } }
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  parentPort.on('message', async (job) => {
    const r = { label: job.label, solver: job.solver, scene: job.scene, settings: job.settings || null, budgetAsked: job.budget || null, keep: job.keep || null };
    try {
      const def = S.get(job.solver); if (!def) throw new Error('no solver ' + job.solver);
      const make = scenes[job.scene]; if (!make) throw new Error('no scene ' + job.scene);
      const sc = make(); if (job.budget) sc.modeA.budget = +job.budget; sc.mode = 'A'; sc.solve = { id: job.solver }; r.budget = sc.modeA.budget;
      const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, job.settings || {})); if (job.debug) settings.debug = true;
      const input = S.inputOf(sc), problem = { source: sc.source, target: sc.target, envelope: sc.envelope, sim: sc.sim, modeA: { paint: sc.modeA.paint } };
      let traced = 0; const tools = { progress() {}, budget: { ms: 120000, rays: 5e7 }, scene: problem, trace: (s, o) => { traced += (o && o.rays) || 20000; return S.trace(problem, s, o); } };
      const t0 = process.hrtime.bigint(); let out = await def.solve(input, settings, tools); r.solveMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e6); r.solverRays = traced;
      if (job.keep) { const q = rng(job.keepSeed || 1); out = Object.assign({}, out, { surfaces: out.surfaces.filter(() => q() < job.keep), pred: undefined, debug: undefined }); }
      const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;   // timing split (2026-09-30): solve · verify · trace · score, in ms
      let t1 = process.hrtime.bigint(); const f = S.verify(sc, out); r.verifyMs = ms(t1); r.placed = f.placed; r.outside = f.violations.envelope.length; r.inClear = f.violations.keepOut.length; r.errors = f.errors;
      if (f.errors.length || !out.surfaces.length) { r.error = f.errors.join('; ') || 'no facets'; parentPort.postMessage({ r }); return; }
      sc.groups.A.surfaces = out.surfaces; sc.sim.seed = W.seed;
      t1 = process.hrtime.bigint(); const P = E.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; r.prepareMs = ms(t1);
      t1 = process.hrtime.bigint(); const c = E.runSync(P, W.rays); r.traceMs = ms(t1);
      t1 = process.hrtime.bigint(); const fd = RF.Photometry.fidelity(sc, P, c), ph = RF.Photometry.fixture(sc, P, c), R = sc.target.res, em = c.E.emitted, paint = sc.modeA.paint; r.scoreMs = ms(t1);
      const G = fd.G, D = Array.from(G, (x) => x / em);
      const cellM2 = (2 * P.T.half / P.res) ** 2 * 1e-6 * (P.res / R) ** 2, dm = V.dist(P.T.C, sc.source.pos) / 1000, refl = sc.modeA.reflectivity;
      // capturable share of the LED's light (as bench.js: 40k samples of the real source through the envelope)
      const smp = RF.Source.makeSampler(sc.source), o = [0, 0, 0], d = [0, 0, 0]; let seedv = 12345, inBox = 0; const rn = () => ((seedv = (seedv * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let n = 0; n < 40000; n++) { RF.Source.sampleRay(smp, rn(), rn(), rn(), rn(), rn(), o, d); const iv = RF.Geo.envInterval(sc.envelope, o, d); if (iv && iv[1] > Math.max(0, iv[0]) + 1e-6) inBox++; }
      const capt = inBox / 40000;
      Object.assign(r, { R, rays: W.rays, seed: W.seed, power: sc.source.power, cdPerD: sc.source.power * dm * dm / cellM2, capturable: capt, reflectivity: refl, envelopeCeiling: ph.envelopeCeiling,
        achievableKernelCells: fd.kernel.cells, fidelity: fd.fidelity, within: fd.within, gapsDark: fd.gapsDark, onPaint: fd.onPaint, spill: fd.spill, peakCd: ph.peakCd, notes: (out.notes || []).slice(0, 3),
        pred: out.pred || null, outside: r.outside, inClear: r.inClear });
      const dump = { label: job.label, R, paint, D, row: r };
      if (out.debug && out.debug.F) dump.Fpred = Array.from(out.debug.F, (x) => x / sc.source.power);
      fs.writeFileSync(path.join(W.out, 'runs', job.label + '.json'), JSON.stringify(dump));
      fs.appendFileSync(path.join(W.out, 'runs.jsonl'), JSON.stringify(r) + '\n');
    } catch (e) { r.error = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); }
    parentPort.postMessage({ r });
  });
  parentPort.postMessage({ ready: true });
} else (async () => {
  const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : a[i + 1]; };
  const plan = JSON.parse(fs.readFileSync(a[0], 'utf8')), jobsN = Math.min(8, +opt('jobs', 4)), rays = +opt('rays', 1000000), seed = +opt('seed', 90210), out = path.resolve(opt('out', path.join(ROOT, 'bench-out/modes')));
  fs.mkdirSync(path.join(out, 'runs'), { recursive: true });
  const todo = plan.filter((j) => !fs.existsSync(path.join(out, 'runs', j.label + '.json')) || j.force);
  console.error(plan.length + ' jobs, ' + (plan.length - todo.length) + ' already done, ' + todo.length + ' to run on ' + jobsN + ' workers');
  let next = 0, done = 0, fails = 0;
  await Promise.all(Array.from({ length: Math.min(jobsN, todo.length) }, () => new Promise((resolve) => {
    const w = new Worker(__filename, { workerData: { rays, seed, out } });
    const feed = () => { if (next >= todo.length) { w.terminate(); resolve(); return; } const j = todo[next++]; w.once('message', (m) => { done++; if (m.r.error) { fails++; console.error('FAIL ' + m.r.label + ': ' + m.r.error); fs.appendFileSync(path.join(out, 'fails.jsonl'), JSON.stringify(m.r) + '\n'); } else console.error(done + '/' + todo.length + ' ' + m.r.label + '  fid ' + (100 * m.r.fidelity).toFixed(1) + '  onPaint ' + (100 * m.r.onPaint).toFixed(0) + '  ' + m.r.placed + ' facets  ' + m.r.solveMs + ' ms'); feed(); }); w.postMessage(j); };
    w.once('message', () => feed()); w.on('error', (e) => { console.error('worker died: ' + e.message); resolve(); });
  })));
  console.error('done: ' + (done - fails) + ' ok, ' + fails + ' failed');
})();
