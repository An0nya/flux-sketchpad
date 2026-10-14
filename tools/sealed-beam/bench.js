#!/usr/bin/env node
/* bench.js — plain paraboloid vs plain cover glass vs fluted lens (default flutes, then tuned), judged against FMVSS 108.
 *   node tools/sealed-beam/bench.js [--lamps 7,5.75] [--beams low,high] [--rays 2000000] [--evals 300] [--tuneRays 150000]
 *                                   [--tunePreset fmvss-lb2m] [--filament transverse|axial] [--out tools/sealed-beam/results-<filament>.jsonl]
 * One JSON line is APPENDED to --out per row as soon as it is judged (nothing accumulates in memory).  Judging: pilot + guided rounds
 * up to --rays on the CPU engine (Node), the same far field RF.Spec.evaluate reads.  Low beam is judged against LB2V and LB2M, high
 * beam against UB2.  The tuner optimises --tunePreset (default LB2M: mechanical aim = the period-correct aiming-pad lamp; LB2V's
 * visual-aim cut-off gradient needs a sharp cut-off no flute pattern provides).                                                       */
const fs = require('fs'), path = require('path');
const L = require('./lab.js');
const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const lamps = String(args.lamps || '7,5.75').split(','), beams = String(args.beams || 'low,high').split(',');
const rays = +(args.rays || 2e6), evals = +(args.evals || 300), tuneRays = +(args.tuneRays || 150000);
const filament = args.filament || 'transverse', out = path.resolve(args.out || path.join(__dirname, 'results-' + filament + '.jsonl'));
const JUDGE = { low: ['fmvss-lb2m', 'fmvss-lb2v'], high: ['fmvss-ub2'] };
const variants = [
  { name: 'paraboloid (no lens)', over: { lens: 'none', tune: false } },
  { name: 'plain cover glass', over: { lens: 'plain', tune: false } },
  { name: 'fluted, default flutes', over: { lens: 'fluted', tune: false } },
  { name: 'fluted, tuned', over: { lens: 'fluted', tune: true, tuneEvals: evals, tuneRays, tuneSeconds: 0 } },
];
(async () => {
  for (const lamp of lamps) for (const beam of beams) for (const v of variants) {
    const sc = L.makeScene(lamp, beam, { filament, preset: beam === 'low' ? (args.tunePreset || 'fmvss-lb2m') : 'fmvss-ub2' });
    const r = await L.solve(sc, v.over);
    const j = L.judge(sc, r.out.surfaces, rays, JUDGE[beam]);
    const row = { when: new Date().toISOString(), filament, lamp, beam, variant: v.name, rays, solveMs: r.ms, surfaces: r.out.surfaces.length, errors: r.facts.errors, violations: r.facts.violations,
      emitted_lm: Math.round(j.E.emitted), lmWindow: j.lmWindow, peakCd: j.peakCd, notes: r.out.notes, judged: {} };
    for (const k of JUDGE[beam]) { const e = j.evals[k]; row.judged[k] = { verdict: e.verdict, n: e.n, score: e.score, aim: e.aim, failing: e.rows.filter((x) => x.verdict === 'fail').map((x) => `${x.name} ${x.value}${x.isMin ? '<' : '>'}${x.bound}`), unsure: e.rows.filter((x) => x.verdict === 'unsure').map((x) => x.name) }; }
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(lamp, beam, v.name.padEnd(24), 'lmWin', j.lmWindow, 'peak', j.peakCd, JSON.stringify(Object.fromEntries(JUDGE[beam].map((k) => [k, j.evals[k].n]))));
  }
})();
