#!/usr/bin/env node
// Headless solver runner: load a solver file, solve the built-in scenes through the SAME host path as the
// app (verify → apply → trace → score), print the numbers.  For developing / smoke-testing solvers.
//   node tools/run-solver.js examples/solver-example.js [--rays 200000] [--scenes default,test]
//        [--settings '{"budget":80}'] [--scaling] [--json]
// --scaling times solve() at facet budgets 50/100/200/400 (if the solver has a 'budget' setting) and fits
// the log-log slope: < 2 ⇒ sub-quadratic.
// NOTE: this runs the solver in-process (no isolation) — fine for your own development; a scored benchmark
// run must isolate it (the app uses a Web Worker).
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('../tests/load.js'); const RF = load(); const E = RF.Engine, C = RF.Controller, S = RF.Solvers;
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const file = args.find((a) => !a.startsWith('--') && !['rays', 'scenes', 'settings'].some((k) => args[args.indexOf(a) - 1] === '--' + k));
if (!file) { console.error('usage: node tools/run-solver.js <solver.js> [--rays N] [--scenes default,test] [--settings JSON] [--scaling] [--json]'); process.exit(2); }
const before = new Set(S.list().map((d) => d.id));
vm.runInThisContext(fs.readFileSync(path.resolve(file), 'utf8'), { filename: file });
const def = S.list().find((d) => !before.has(d.id));
if (!def) { console.error(file + ' did not call RF.Solvers.register(...)'); process.exit(2); }
const N = +opt('rays', 200000), names = opt('scenes', 'default,test').split(','), extra = JSON.parse(opt('settings', '{}')), asJson = args.includes('--json');
const SCENES = { default: () => RF.State.defaultScene(), test: () => RF.State.testScene() };
const pct = (x) => (x === null || x === undefined ? '—' : (100 * x).toFixed(1) + '%');

(async () => {
  const rows = [];
  for (const name of names) {
    if (!SCENES[name]) { console.error('unknown scene ' + name + ' (have ' + Object.keys(SCENES).join(', ') + ')'); process.exit(2); }
    const st = C.createStore(SCENES[name]()), sc = st.scene;
    sc.solve = { id: def.id }; sc.solverSettings = { [def.id]: Object.assign(S.defaults(def), extra) };
    let rays = 0; const t0 = Date.now();
    const r = await S.runAsync(sc, def.id);
    const f = r.facts, out = r.output || {};
    const row = { scene: name, solver: def.id + ' v' + def.version, settings: r.meta.settings, solveMs: Date.now() - t0, facts: { errors: f.errors, placed: f.placed, dropped: f.dropped, outsideEnvelope: f.violations.envelope.length, insideClearance: f.violations.keepOut.length, intentErrors: f.intentErrors.length }, notes: out.notes || [] };
    if (!f.errors.length) {
      sc.groups.A.surfaces = out.surfaces;
      const P = E.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const c = E.runSync(P, N);
      const s = E.stats(c, { paint: sc.modeA.paint, paintRes: sc.target.res }), ph = RF.Photometry.fixture(sc, P, c), em = c.E.emitted;
      row.score = { rays: N, delivered: (c.E.direct + c.E.reflected) / em, beamCoverage: s.coverage, uniformityU0: s.uniformity, noiseCeiling: s.noiseCeiling,
        deliveredOverIntended: ph.ratio, peakCd: ph.peakCd, peakNoise: ph.peakNoise, ofDesignCeiling: ph.ofDesign, ofEnvelopeCeiling: ph.ofEnvelope, throwM: ph.throwM,
        blocked: s.occlusion.blocked, shadowed: s.occlusion.shadowed };
    }
    rows.push(row);
    if (!asJson) {
      console.log('\n' + name + ' · ' + row.solver + ' · solve ' + row.solveMs + ' ms · ' + JSON.stringify(row.settings));
      console.log('  verified: ' + (f.errors.length ? 'UNUSABLE — ' + f.errors[0] : f.placed + ' placed' + (f.dropped !== null ? ', ' + f.dropped + ' unplaced intents' : '') + ', outside envelope ' + row.facts.outsideEnvelope + ', inside LED clearance ' + row.facts.insideClearance + (row.facts.intentErrors ? ', intent errors ' + row.facts.intentErrors : '')));
      if (row.score) { const q = row.score;
        console.log('  delivered ' + pct(q.delivered) + ' · beam ' + pct(q.beamCoverage) + ' · U₀ ' + q.uniformityU0.toFixed(3) + ' (noise ceiling ' + q.noiseCeiling.toFixed(2) + ')' + (q.deliveredOverIntended ? ' · delivered÷intended p5/p50/p95 ' + [q.deliveredOverIntended.p5, q.deliveredOverIntended.p50, q.deliveredOverIntended.p95].map((x) => x.toFixed(2)).join('/') : ''));
        console.log('  peak ' + Math.round(q.peakCd).toLocaleString() + ' cd ±' + Math.round(100 * q.peakNoise) + '% · ' + pct(q.ofDesignCeiling) + ' of its ceiling, ' + pct(q.ofEnvelopeCeiling) + ' of the envelope\'s · throw ' + Math.round(q.throwM) + ' m · blocked ' + pct(q.blocked) + ', shadowed ' + pct(q.shadowed)); }
      for (const n of row.notes.slice(0, 3)) console.log('  note: ' + n);
    }
  }
  if (args.includes('--scaling') && def.settings.some((f) => f.key === 'budget')) {
    const pts = [];
    for (const b of [50, 100, 200, 400]) {
      const sc = RF.State.defaultScene(); sc.solve = { id: def.id }; sc.solverSettings = { [def.id]: Object.assign(S.defaults(def), extra, { budget: b }) };
      const t0 = process.hrtime.bigint(); await S.runAsync(sc, def.id); pts.push([b, Number(process.hrtime.bigint() - t0) / 1e6]);
    }
    const lx = pts.map((p) => Math.log(p[0])), ly = pts.map((p) => Math.log(p[1])), mx = lx.reduce((a, b) => a + b) / 4, my = ly.reduce((a, b) => a + b) / 4;
    const slope = lx.reduce((a, x, i) => a + (x - mx) * (ly[i] - my), 0) / lx.reduce((a, x) => a + (x - mx) ** 2, 0);
    rows.push({ scaling: pts, slope });
    if (!asJson) console.log('\nscaling (default scene): ' + pts.map((p) => p[0] + ' facets ' + p[1].toFixed(0) + ' ms').join(' · ') + ' → time ∝ budget^' + slope.toFixed(2) + (slope < 2 ? ' (sub-quadratic)' : ''));
  }
  if (asJson) console.log(JSON.stringify(rows));
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
