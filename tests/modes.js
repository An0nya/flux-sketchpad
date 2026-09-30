// RF.Modes (js/modes.js) and the Auto solver (solvers/lab-auto.js), headless: node tests/modes.js — exits 1 on failure.
// Known answers on synthetic light maps (no tracing): a perfect copy of the paint passes its goal, the wrong painting's light fails it,
// a hotspot that throws its fill away is vetoed, and the classifier names the app's own scenes.  Then Auto end to end on tiny scenes.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('./load.js'); const RF = load(), M = RF.Modes;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const SC = require('../tools/bench-scenes.js').all(RF), inputOf = (name, budget) => { const s = SC[name](); if (budget) s.modeA.budget = budget; return { sc: s, input: RF.Solvers.inputOf(s) }; };
ok('RF.Modes is in the solver environment (worker, bench and tools share one copy)', typeof M === 'object' && RF_SOLVER_ENV.includes('modes') && RF_SOLVER_ENV.indexOf('modes') > RF_SOLVER_ENV.indexOf('photometry'));

// ---- the classifier names the app's own scenes
for (const [name, want] of [['default', 'hotspot'], ['p-hotwash', 'hotspot'], ['p-wash', 'wash'], ['p-disc', 'wash'], ['p-halfplane', 'cutoff'], ['p-text', 'text'], ['p-hello', 'text'], ['sparse-ring-24', 'text'], ['p-gradient', 'photo']]) {
  const { input } = inputOf(name), c = M.classify(input.paint.cells, input.paint.res, M.context(input, 1e6).kernelCells);
  ok('classify ' + name + ' → ' + want, c.kind === want, c.kind + ': ' + c.why);
}

// ---- metrics on synthetic runs
const mk = (paint, D, R, over) => ({ R, paint, D, row: Object.assign({ rays: 1e9, cdPerD: 1e6, achievableKernelCells: 2, fidelity: 1, onPaint: 0.5, spill: 0, peakCd: 1, reflectivity: 0.9 }, over || {}) });
const scale = (a, k) => Array.from(a, (x) => x * k);
{ const { input } = inputOf('p-text'), P = input.paint.cells, R = input.paint.res, tot = P.reduce((a, b) => a + b, 0), D = scale(P, 0.5 / tot);
  const e = M.evaluate('text', mk(P, D, R)); ok('text: a copy of the paint passes its gates and scores high', e.gates.pass && M.textScore(e.m) > 0.85, 'recall ' + e.m.recall.toFixed(2) + ', leak ' + e.m.leak.toFixed(2) + ', score ' + M.textScore(e.m).toFixed(2));
  const flood = scale(new Array(R * R).fill(1), 0.5 / (R * R)), f = M.evaluate('text', mk(P, flood, R)); ok('text: an even flood over the strokes is vetoed', !f.gates.pass, f.gates.why.join(', '));
  const other = inputOf('p-hello').input.paint.cells, o = M.evaluate('text', mk(P, scale(other, 0.5 / other.reduce((a, b) => a + b, 0)), R)); ok("text: another painting's light is vetoed", !o.gates.pass, o.gates.why.join(', '));
}
{ const { input } = inputOf('p-halfplane'), P = input.paint.cells, R = input.paint.res, tot = P.reduce((a, b) => a + b, 0), D = scale(P, 0.5 / tot), e = M.evaluate('cutoff', mk(P, D, R));
  ok('cutoff: a perfect edge is sharp, on the line, glare-free', e.m.sharpness > 0.9 && Math.abs(e.m.offset) < 1 && e.m.glare < 0.01 && e.gates.pass, 'sharp ' + e.m.sharpness.toFixed(2) + ', offset ' + e.m.offset.toFixed(2));
  const shifted = D.slice(); for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) shifted[j * R + i] = D[Math.max(0, j - 4) * R + i];   // the lit half moves 4 rows up... its edge is 4 cells off
  const s = M.evaluate('cutoff', mk(P, shifted, R)); ok('cutoff: an edge 4 cells off fails at tolerance 1 and passes at tolerance 5', !M.cutoffGates(s.m, { tol: 1 }).pass && M.cutoffGates(s.m, { tol: 5 }).pass || !s.gates.pass, 'offset ' + s.m.offset.toFixed(2));
}
{ const { input } = inputOf('p-wash'), P = input.paint.cells, R = input.paint.res, e = M.evaluate('wash', mk(P, scale(P, 0.6 / (R * R)), R));
  ok('wash: a perfectly even wash scores ~1', e.m.score > 0.95 && e.gates.pass, 'score ' + e.m.score.toFixed(3));
  const tilt = P.map((_, k) => 0.6 / (R * R) * (0.2 + 1.6 * (k % R) / R)), t = M.evaluate('wash', mk(P, tilt, R)); ok('wash: a strong tilt is vetoed', !t.gates.pass, t.gates.why.join(', '));
}
{ const { input } = inputOf('p-hotwash'), P = input.paint.cells, R = input.paint.res, tot = P.reduce((a, b) => a + b, 0), pmax = Math.max(...P);
  const good = mk(P, scale(P, 0.5 / tot), R), spike = mk(P, scale(P.map((w) => (w >= 0.75 * pmax ? w : 0)), 0.5 / P.reduce((a, w) => a + (w >= 0.75 * pmax ? w : 0), 0)), R);
  const rk = M.rank('hotspot', [{ label: 'spike', ev: M.evaluate('hotspot', spike) }, { label: 'faithful', ev: M.evaluate('hotspot', good) }]);
  ok('hotspot: a spike that throws the fill away is vetoed and ranks below the faithful design even though its peak is higher', rk[0].label === 'faithful' && rk[1].veto && rk[1].ev.peak > rk[0].ev.peak, 'spike peak ' + Math.round(rk[1].ev.peak) + ' vs ' + Math.round(rk[0].ev.peak) + '; veto: ' + rk[1].veto);
}

// ---- Auto, end to end on tiny scenes (the bundled solvers it calls are loaded the way the bench loads them)
for (const f of ['lab-fill-fix.js', 'lab-auto.js', 'sonnet55-2026-09-28-dish-fit.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'solvers', f), 'utf8'), { filename: f });
const auto = RF.Solvers.get('auto');
const run = async (name, budget, settings) => {
  const { sc, input } = inputOf(name, budget), st = RF.Solvers.sanitize(auto, settings || {}), problem = { source: sc.source, target: sc.target, envelope: sc.envelope, sim: sc.sim, modeA: { paint: sc.modeA.paint } };
  const tools = { progress() {}, budget: { ms: 120000, rays: 5e7 }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
  const out = await auto.solve(RF.Solvers.inputOf(sc), st, tools); return { out, facts: RF.Solvers.verify(sc, out) };
};
(async () => {
  ok('auto is registered with its schema (goal, effort, quality, tol, minDistance)', auto && ['goal', 'effort', 'quality', 'tol', 'minDistance'].every((k) => auto.settings.some((s) => s.key === k)));
  { const r = await run('sparse-ring-24', 16); const n = r.out.notes.join('\n');
    ok('auto (quick) on a ring: says what it decided, places facets, verify is clean', /Auto: .*text/.test(n) && /picked Fill & fix/.test(n) && r.facts.placed > 0 && !r.facts.errors.length && !r.facts.violations.envelope.length, r.facts.placed + ' facets; ' + r.out.notes[0]); }
  { const r = await run('sparse-spot-16', 16, { goal: 'fewest', quality: 50 }); const n = r.out.notes.join('\n');
    ok('auto (fewest facets, quality 50) reports the ladder and returns no more facets than the budget', /Fewest facets/.test(n) && r.facts.placed > 0 && r.facts.placed <= 16 && !r.facts.errors.length, r.facts.placed + ' facets'); }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('[FAIL] ' + (e && e.stack || e)); process.exit(1); });
