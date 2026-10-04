#!/usr/bin/env node
/* bench-spec.js — the Spec-mode bench: solvers × settings × fixtures × emitters, judged the way the report judges them.
 * Not part of tests/all.js (minutes per row).  Each row: build the fixture (RF.Spec.FIXTURES), seed the low-beam painting,
 * solve (the solver gets Spec mode's own input: the working paint on the md.solveAt plane, input.spec), trace a pilot then
 * guided Refine rounds up to --rays, and judge with RF.Spec.evaluate.
 *
 *   node tests/bench-spec.js [--fixtures box,slim,module,sealed7] [--solvers spoke,dish-fit,...] [--preset ece-r112-b]
 *                            [--led generic] [--amps 6] [--rays 8e6] [--pilot 2e6] [--md '{"seedGlow":150}'] [--json out.json]
 *   A solver may carry settings: --solvers 'fill-fix:{"priority":"light"}'.  --load path/to/solver.js[,…] registers extra solver files.
 * Prints one line per row and a table; --json writes the rows (with every constraint's value).                       */
const { load } = require('./load.js');
const fs = require('fs'), vm = require('vm'), path = require('path');
const RF = load();
for (const f of ['lab-fill-fix', 'lab-sqm', 'sonnet55-2026-09-28-dish-fit', 'opus55-2026-09-27-mosaic', 'lab-auto']) {
  const p = path.join(__dirname, '..', 'solvers', f + '.js'); if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const list = (x, d) => (x ? String(x).split(/,(?![^{]*})/) : d);
for (const f of list(args.load, [])) vm.runInThisContext(fs.readFileSync(path.resolve(f), 'utf8'), { filename: path.resolve(f) });   // --load my-solver.js[,…]
const fixtures = list(args.fixtures, ['box', 'sealed7']), solvers = list(args.solvers, ['spoke', 'dish-fit', 'opus-mosaic-auto', 'fill-fix']);
const N = +(args.rays || 8e6), N0 = Math.min(N, +(args.pilot || 2e6)), preset = args.preset || 'ece-r112-b';

function scene(fix) {
  const sc = RF.State.defaultScene(); sc.mode = 'D';
  RF.Spec.applyPreset(sc.modeD, preset);
  if (args.md) Object.assign(sc.modeD, JSON.parse(args.md));
  RF.Spec.applyFixture(sc, fix);
  for (const g of ['A', 'B', 'C']) sc.groups[g].enabled = g === 'A';
  RF.SourcePresets.apply(sc.source, args.led || 'generic', args.amps ? { amps: +args.amps } : undefined);
  sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc));
  sc.modeA.paint = RF.Spec.seedPaint(sc);
  return sc;
}
function judge(sc) {
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc)]; P.guideLearn = true;
  let c = RF.Engine.newCtx(P, N0, 0); RF.Engine.traceRange(c, 0, N0); c.next = N0; c.done = true;
  while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
  const G = RF.FarField.build(c, P.ffStreams[0]), ev = RF.Spec.evaluate(G, sc.modeD), M = RF.FarField.map(G, 0.25);
  let pk = 0; for (const x of M.cd) if (x > pk) pk = x;
  return { ev, peak: pk, lmWindow: G.lmWindow };
}
const k = (x) => (!(x > 0) ? '0' : x >= 1e4 ? Math.round(x / 1000) + 'k' : (x / 1000).toFixed(1) + 'k');
(async () => {
  const rows = [];
  for (const fix of fixtures) for (const sv of solvers) {
    const m = sv.match(/^([^:]+)(?::(.*))?$/), id = m[1], over = m[2] ? JSON.parse(m[2]) : {};
    const sc = scene(fix); sc.solve = { id }; sc.solverSettings = { [id]: over };
    const def = RF.Solvers.get(id); if (!def) { console.log('no solver', id); continue; }
    const input = RF.Solvers.inputOf(sc), problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
    const tools = { progress() {}, budget: { rays: Infinity, ms: Infinity }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
    const t0 = Date.now(); let out, err = null;
    try { out = await def.solve(input, RF.Solvers.settingsOf(sc, id), tools); } catch (e) { err = String(e.message || e); }
    const row = { fixture: fix, solver: sv, preset, led: args.led || 'generic', solveMs: Date.now() - t0 };
    if (err || !out) { row.error = err || 'no output'; rows.push(row); console.log(fix, sv, 'ERROR', row.error); continue; }
    const facts = RF.Solvers.verify(sc, out); sc.groups.A.surfaces = facts.errors.length ? [] : out.surfaces; row.facets = facts.placed;
    if (!facts.errors.length && facts.needsBounces > sc.sim.bounces) sc.sim.bounces = facts.needsBounces;   // as the app does (controller.js ensureBounces)
    const { ev, peak, lmWindow } = judge(sc), v = (n) => { const r = ev.rows.find((x) => x.name === n); return r ? r.value : null; };
    Object.assign(row, { verdict: ev.verdict, n: ev.n, score: +ev.score.toFixed(3), peak: Math.round(peak), lmWindow: Math.round(lmWindow), aim: ev.aim.note,
      fails: ev.rows.filter((r) => r.verdict === 'fail').map((r) => r.name), unsure: ev.rows.filter((r) => r.verdict === 'unsure').map((r) => r.name),
      rows: ev.rows.map((r) => ({ name: r.name, value: r.value, sd: r.sd, bound: r.bound, isMin: r.isMin, verdict: r.verdict })), r75: v('75R') });
    rows.push(row);
    console.log(`${fix.padEnd(8)} ${sv.slice(0, 40).padEnd(40)} ${ev.verdict.padEnd(6)} fail ${ev.n.fail} unsure ${ev.n.unsure} · peak ${k(peak)} · ${row.facets} facets · ${(row.solveMs / 1000).toFixed(1)} s solve | ${row.fails.join(', ')}`);
  }
  console.log('\n| solver | ' + fixtures.join(' | ') + ' |\n|---|' + fixtures.map(() => '---').join('|') + '|');
  for (const sv of solvers) console.log('| ' + sv + ' | ' + fixtures.map((f) => { const r = rows.find((x) => x.fixture === f && x.solver === sv); return !r ? '—' : r.error ? 'error' : `**${r.n.fail}**/${r.n.unsure} · peak ${k(r.peak)}`; }).join(' | ') + ' |');
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 1));
})();
