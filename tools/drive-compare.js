// Solve one scene with several solvers / presets and look at each design in the Drive scenes.
//   node tools/drive-compare.js scene.json outdir --cases spec-hl-v2@fmvss-lb2v,fill-fix@fmvss-lb2v,spec-hl-v2@fmvss-ub2 [--rays 8e6] [--pilot 2e6]
// A case is solver@preset (optionally solver:{"setting":1}@preset). Per case: solve, judge (pilot + guided refine, like tests/bench-spec.js),
// write <outdir>/<case>.json (the solved scene, openable in the app), a row to <outdir>/results.jsonl as soon as it is known, and the pictures.
// Persisted per case on purpose: a solve is minutes of compute that cannot be re-won.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load } = require('../tests/load.js'); const RF = load(); const lib = require('./drive-lib.js');
for (const f of fs.readdirSync(path.join(__dirname, '..', 'solvers'))) if (f.endsWith('.js')) { try { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'solvers', f), 'utf8'), { filename: f }); } catch (e) { console.log('could not load solvers/' + f + ': ' + e.message); } }
const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const file = process.argv[2], out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const N = +(args.rays || 8e6), N0 = Math.min(N, +(args.pilot || 2e6));
const cases = String(args.cases).split(/,(?![^{]*})/).map((c) => { const m = c.match(/^([^:@]+)(?::(\{.*\}))?@(.+)$/); return { id: m[1], over: m[2] ? JSON.parse(m[2]) : {}, preset: m[3] }; });
function judge(sc) {
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc)]; P.guideLearn = true;
  let c = RF.Engine.newCtx(P, N0, 0); RF.Engine.traceRange(c, 0, N0); c.next = N0; c.done = true;
  while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
  const G = RF.FarField.build(c, P.ffStreams[0]), ev = RF.Spec.evaluate(G, sc.modeD), M = RF.FarField.map(G, 0.25); let pk = 0; for (const x of M.cd) if (x > pk) pk = x;
  return { ev, peak: pk, lmWindow: G.lmWindow };
}
(async () => {
  console.log('registered solvers: ' + RF.Solvers.list().map((s) => s.id).join(', '));
  for (const cs of cases) {
    const name = cs.id + '__' + cs.preset, t0 = Date.now();
    const sc = RF.State.deserialize(fs.readFileSync(file, 'utf8')); sc.mode = 'D';
    RF.Spec.applyPreset(sc.modeD, cs.preset); sc.modeD.usePaint = false; sc.groups.A.surfaces = []; sc.solve = { id: cs.id }; sc.solverSettings = { [cs.id]: cs.over };
    const def = RF.Solvers.get(cs.id); if (!def) { console.log('no solver ' + cs.id); continue; }
    const input = RF.Solvers.inputOf(sc), problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
    const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: Infinity }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
    let res, err = null; try { res = await def.solve(input, RF.Solvers.settingsOf(sc, cs.id), tools); } catch (e) { err = String(e.stack || e); }
    const row = { case: name, solver: cs.id, preset: cs.preset, solveMs: Date.now() - t0 };
    if (err || !res) { row.error = err || 'no output'; fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n'); console.log(name + ' ERROR ' + String(row.error).split('\n')[0]); continue; }
    const facts = RF.Solvers.verify(sc, res); sc.groups.A.surfaces = facts.errors.length ? [] : res.surfaces; row.facets = facts.placed;
    if (!facts.errors.length && facts.needsBounces > sc.sim.bounces) sc.sim.bounces = facts.needsBounces;
    const j = judge(sc), v = (n) => { const r = j.ev.rows.find((x) => x.name === n); return r ? r.value : null; };
    Object.assign(row, { verdict: j.ev.verdict, n: j.ev.n, peak: Math.round(j.peak), lmWindow: Math.round(j.lmWindow), aim: j.ev.aim.note, fails: j.ev.rows.filter((r) => r.verdict === 'fail').map((r) => r.name), unsure: j.ev.rows.filter((r) => r.verdict === 'unsure').map((r) => r.name), r75: v('75R') });
    fs.writeFileSync(path.join(out, name + '.json'), RF.State.serialize(sc));
    fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n');
    console.log(name + ': ' + j.ev.verdict + ' ' + JSON.stringify(j.ev.n) + ' peak ' + Math.round(j.peak) + ' cd, ' + row.facets + ' facets, solve ' + (row.solveMs / 1000).toFixed(0) + ' s, fails [' + row.fails.join(', ') + '] unsure [' + row.unsure.join(', ') + ']');
    const tr = lib.traceScene(RF, sc, +(args.picrays || 4e6)); const files = lib.renderSet(RF, sc, tr, path.join(out, name), { list: [['road', 'straight'], ['forest', 'straight'], ['city', 'straight']], exposures: [['ev1', { mode: 'fixed', ev: 1 }], ['ev3', { mode: 'fixed', ev: 3 }]] });
    console.log('  pictures: ' + files.length);
  }
})();
