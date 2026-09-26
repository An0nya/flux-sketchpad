#!/usr/bin/env node
// Headless solver runner: load a solver file, solve the built-in scenes through the SAME host path as the
// app (isolated solve → verify → apply → trace → score), print the numbers.  For developing solvers.
//   node tools/run-solver.js examples/solver-example.js [--rays 1000000] [--scenes default,test]
//        [--budget 100] [--settings '{"minDistance":10}'] [--scaling] [--json] [--static]
// The solver runs in a worker thread that loads exactly js/solver-env.js's list (the same RF the app's
// browser worker gives it); verification and scoring run here, in a separate heap.
// --budget sets the user's facet cap (input.limits.maxFacets, default 100 on every scene).
// --scaling times solve() at facet budgets 50/100/200/400 and fits
// the log-log slope: < 2 ⇒ sub-quadratic.
'use strict';
const fs = require('fs'), path = require('path');
const { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const { load } = require('../tests/load.js'); const RF = load(); const E = RF.Engine, S = RF.Solvers;
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const VALUED = ['--rays', '--scenes', '--settings', '--ms', '--budget'];
const file = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!file) { console.error('usage: node tools/run-solver.js <solver.js> [--rays N] [--scenes default,test] [--settings JSON] [--ms N] [--scaling] [--json]'); process.exit(2); }
const BUDGET = +opt('budget', 100), N = +opt('rays', 1000000), names = opt('scenes', 'default,test').split(','), extra = JSON.parse(opt('settings', '{}')), MS = +opt('ms', 60000), asJson = args.includes('--json');
const SCENES = { default: () => RF.State.defaultScene(), test: () => RF.State.testScene() };
const pct = (x) => (x === null || x === undefined ? '—' : (100 * x).toFixed(1) + '%');

// ---- the isolated solver
const WORKER = `
const { parentPort, workerData } = require('worker_threads'), fs = require('fs'), path = require('path'), vm = require('vm');
const js = (f) => { const p = path.join(workerData.root, 'js', f + '.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); };
js('solver-env'); for (const f of globalThis.RF_SOLVER_ENV) js(f);
const RF = globalThis.RF, before = new Set(RF.Solvers.list().map((d) => d.id));
// --static: a static algorithm may not trace inside solve().  Wrap every tracing entry point BEFORE the solver loads
// (a reference it saves at load time is the wrapper); a solver id ending in -auto (a tuner) is exempt.
let inStatic = false;
if (workerData.static) for (const [obj, names] of [[RF.Engine, ['runSync', 'step', 'traceRange', 'probeRay', 'retrace', 'occlusion', 'facetLosses']], [RF.Solvers, ['trace', 'runSync', 'runAsync']]])
  for (const k of names) { const f = obj[k]; if (typeof f === 'function') obj[k] = function () { if (inStatic) throw new Error('tracing is not allowed inside solve() in this task: write a static algorithm. Trace from the runner while you develop; only a solver whose id ends in -auto may trace.'); return f.apply(this, arguments); }; }
parentPort.on('message', async (m) => {
  try {
    if (m.type === 'load') { const ids = [], reg = RF.Solvers.register; RF.Solvers.register = (def) => { const id = reg(def); ids.push(id); return id; };   // what THIS file registers, even an id already loaded (e.g. a copy of spoke)
      try { vm.runInThisContext(m.src, { filename: m.name }); } finally { RF.Solvers.register = reg; } const d = [...new Set(ids)].map((id) => RF.Solvers.get(id)); parentPort.postMessage({ type: 'loaded', defs: d.map((x) => ({ id: x.id, name: x.name, version: x.version, modes: x.modes, settings: x.settings, declaresLimits: x.declaresLimits })) }); return; }
    const def = RF.Solvers.get(m.id); let rays = 0;
    const tools = { progress() {}, budget: m.budget, scene: m.problem, trace: (s, o) => { rays += Math.max(1, (o && o.rays) | 0 || 20000); if (rays > m.budget.rays) throw new Error('ray budget exhausted (' + m.budget.rays + ')'); return RF.Solvers.trace(m.problem, s, o); } };
    inStatic = !!workerData.static && !/-auto$/.test(m.id);
    let out; const t0 = process.hrtime.bigint();
    try { out = await def.solve(m.input, m.settings, tools); } finally { inStatic = false; }
    parentPort.postMessage({ type: 'done', output: out, ms: Number(process.hrtime.bigint() - t0) / 1e6, rays });
  } catch (e) { parentPort.postMessage({ type: 'error', message: String(e && e.stack || e) }); }
});`;
const STATIC_DEFAULT = false;   // benchmark workspaces set this to true
const STATIC = args.includes('--static') || (STATIC_DEFAULT && !args.includes('--no-static'));
const w = new Worker(WORKER, { eval: true, workerData: { root: ROOT, static: STATIC } });
const ask = (msg, ms) => new Promise((res) => {
  const t = setTimeout(() => { w.terminate(); res({ type: 'error', message: 'solver ran over ' + ms + ' ms and was stopped' }); }, ms);
  w.once('message', (d) => { clearTimeout(t); res(d); }); w.postMessage(msg);
});
const problemOf = (sc) => ({ source: sc.source, target: sc.target, envelope: sc.envelope, sim: sc.sim, modeA: { paint: sc.modeA.paint } });

(async () => {
  const d0 = await ask({ type: 'load', src: fs.readFileSync(path.resolve(file), 'utf8'), name: file }, 20000);
  if (d0.type !== 'loaded' || !d0.defs.length) { console.error(file + ': ' + (d0.message || 'did not call RF.Solvers.register(...)')); w.terminate(); process.exit(2); }
  const def = d0.defs.find((x) => x.modes.includes('paint')) || d0.defs[0];
  if (def.declaresLimits && def.declaresLimits.length && !asJson) console.log('⚠️  ' + def.id + " declares " + def.declaresLimits.map((k) => "'" + k + "'").join(' and ') + ' as settings. Those are the USER\'s limits: they are ignored as settings and filled from input.limits — read input.limits.maxFacets / input.limits.reflectivity instead.');
  const missing = S.REQUIRED.filter((k) => !def.settings.some((f) => f.key === k));
  if (missing.length && !asJson) console.log('⚠️  missing required setting(s): ' + missing.join(', '));
  const sceneFor = (mk, budget) => { const sc = mk(); sc.modeA.budget = budget; sc.solve = { id: def.id }; return sc; };
  // the solver's own defaults + --settings; a limit an older solver declares as a setting is forced to the cap
  const settingsFor = (sc) => { const o = Object.assign(S.defaults(def), extra); if (def.settings.some((f) => f.key === 'budget')) o.budget = sc.modeA.budget; if (def.settings.some((f) => f.key === 'reflectivity')) o.reflectivity = sc.modeA.reflectivity; return S.sanitize(def, o); };
  const rows = [];
  for (const name of names) {
    if (!SCENES[name]) { console.error('unknown scene ' + name + ' (have ' + Object.keys(SCENES).join(', ') + ')'); process.exit(2); }
    const sc = sceneFor(SCENES[name], BUDGET);
    const settings = settingsFor(sc), d = await ask({ type: 'solve', id: def.id, input: S.inputOf(sc), settings, problem: problemOf(sc), budget: { ms: MS, rays: 2e7 } }, MS);
    const row = { scene: name, solver: def.id + ' v' + def.version, settings };
    if (d.type !== 'done') { row.error = d.message; rows.push(row); if (!asJson) console.log('\n' + name + ' · ' + row.solver + '\n  ERROR ' + d.message); continue; }
    const out = d.output || {}, f = S.verify(sc, out);
    Object.assign(row, { solveMs: Math.round(d.ms), traceRays: d.rays, facts: { errors: f.errors, placed: f.placed, dropped: f.dropped, outsideEnvelope: f.violations.envelope.length, insideClearance: f.violations.keepOut.length, intentErrors: f.intentErrors.length }, notes: out.notes || [] });
    if (!f.errors.length) {
      sc.groups.A.surfaces = out.surfaces;
      const P = E.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const c = E.runSync(P, N);
      const s = E.stats(c, { paint: sc.modeA.paint, paintRes: sc.target.res }), ph = RF.Photometry.fixture(sc, P, c), em = c.E.emitted, fd = RF.Photometry.fidelity(sc, P, c);
      row.score = { rays: N, fidelity: fd.fidelity, paintedWithin: fd.within, gapsDark: fd.gapsDark, fidelityRaw: fd.withinRaw, under: fd.under, over: fd.over, fidelityNoiseCeiling: fd.fidelityNoiseCeiling, fidRatio: fd.ratio, onPaint: fd.onPaint, spill: fd.spill, spillNear: fd.spillNear, delivered: (c.E.direct + c.E.reflected) / em, beamCoverage: s.coverage, uniformityU0: s.uniformity, noiseCeiling: s.noiseCeiling,
        deliveredOverIntended: ph.ratio, peakCd: ph.peakCd, peakNoise: ph.peakNoise, ofDesignCeiling: ph.ofDesign, ofEnvelopeCeiling: ph.ofEnvelope, throwM: ph.throwM,
        blocked: s.occlusion.blocked, shadowed: s.occlusion.shadowed };
    }
    rows.push(row);
    if (!asJson) {
      if (STATIC && !/-auto$/.test(def.id) && row.solveMs > 1000 * Math.max(1, BUDGET / 100)) console.log('\n⚠️  ' + name + ': solve took ' + row.solveMs + ' ms. A static algorithm is normally milliseconds; the scorer flags solves over ~1 s per 100 facets for review.');
      console.log('\n' + name + ' · ' + row.solver + ' · solve ' + row.solveMs + ' ms' + (row.traceRays ? ' (' + row.traceRays.toLocaleString() + ' rays of tracing)' : '') + ' · ' + JSON.stringify(settings));
      console.log('  verified: ' + (f.errors.length ? 'UNUSABLE — ' + f.errors[0] : f.placed + ' placed' + (f.dropped !== null ? ', ' + f.dropped + ' unplaced intents' : '') + ', outside envelope ' + row.facts.outsideEnvelope + ', inside LED clearance ' + row.facts.insideClearance + (row.facts.intentErrors ? ', intent errors ' + row.facts.intentErrors : '')));
      if (row.score) { const q = row.score;
        console.log('  FIDELITY ' + pct(q.fidelity) + ' = F1 of painted cells within ×/÷1.25 (' + pct(q.paintedWithin) + '; too dim ' + pct(q.under) + ', too bright ' + pct(q.over) + ') and gaps dark (' + pct(q.gapsDark) + '); a perfect design would show ' + pct(q.fidelityNoiseCeiling) + ' at ' + N.toLocaleString() + ' rays · on paint ' + pct(q.onPaint) + ' · spill ' + pct(q.spill) + ' (' + pct(q.spillNear) + ' just outside the edge)');
        console.log('  delivered ' + pct(q.delivered) + ' · beam ' + pct(q.beamCoverage) + ' · U₀ ' + q.uniformityU0.toFixed(3) + ' (noise ceiling ' + q.noiseCeiling.toFixed(2) + ')' + (q.deliveredOverIntended ? ' · delivered÷intended p5/p50/p95 ' + [q.deliveredOverIntended.p5, q.deliveredOverIntended.p50, q.deliveredOverIntended.p95].map((x) => x.toFixed(2)).join('/') : ''));
        console.log('  peak ' + Math.round(q.peakCd).toLocaleString() + ' cd ±' + Math.round(100 * q.peakNoise) + '% · ' + pct(q.ofDesignCeiling) + ' of its ceiling, ' + pct(q.ofEnvelopeCeiling) + ' of the envelope\'s · throw ' + Math.round(q.throwM) + ' m · blocked ' + pct(q.blocked) + ', shadowed ' + pct(q.shadowed)); }
      for (const n of row.notes.slice(0, 3)) console.log('  note: ' + n);
    }
  }
  if (args.includes('--scaling')) {
    const pts = [];
    for (const b of [50, 100, 200, 400]) { const sc = sceneFor(SCENES.default, b), d = await ask({ type: 'solve', id: def.id, input: S.inputOf(sc), settings: settingsFor(sc), problem: problemOf(sc), budget: { ms: MS, rays: 2e7 } }, MS); if (d.type === 'done') pts.push([b, Math.max(0.5, d.ms)]); }
    if (pts.length === 4) {
      const lx = pts.map((p) => Math.log(p[0])), ly = pts.map((p) => Math.log(p[1])), mx = lx.reduce((a, b) => a + b) / 4, my = ly.reduce((a, b) => a + b) / 4;
      const slope = lx.reduce((a, x, i) => a + (x - mx) * (ly[i] - my), 0) / lx.reduce((a, x) => a + (x - mx) ** 2, 0);
      rows.push({ scaling: pts, slope });
      if (!asJson) console.log('\nscaling (default scene): ' + pts.map((p) => p[0] + ' facets ' + p[1].toFixed(0) + ' ms').join(' · ') + ' → time ∝ budget^' + slope.toFixed(2) + (slope < 2 ? ' (sub-quadratic)' : ''));
    }
  }
  if (asJson) console.log(JSON.stringify(rows));
  w.terminate();
})().catch((e) => { console.error(e.stack || e); w.terminate(); process.exit(1); });
