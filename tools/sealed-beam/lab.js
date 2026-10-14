/* lab.js — scene builder + judge for the sealed-beam solver (solvers/sealed-beam-v1.js), shared by the bench and the example generator.
 * Not a test: a library.  makeScene(lamp, beam) → a Spec-mode scene (FMVSS 108) with the filament at the origin and an envelope
 * that holds the lamp; judge(scene, surfaces, rays, presets) → far-field verdicts at that ray count.                                */
const path = require('path'), fs = require('fs'), vm = require('vm');
const { load, ROOT } = require('../../tests/load.js');
const RF = load();
const SOLVER = path.join(ROOT, 'solvers', 'sealed-beam-v1.js');
if (!RF.SealedBeam) vm.runInThisContext(fs.readFileSync(SOLVER, 'utf8'), { filename: SOLVER });

const PRESET_OF = { low: 'fmvss-lb2v', high: 'fmvss-ub2' };
function makeScene(lamp, beam, opts) {
  opts = opts || {};
  const sc = RF.State.defaultScene(); sc.mode = 'D';
  RF.Spec.applyPreset(sc.modeD, opts.preset || PRESET_OF[beam]);
  for (const g of ['A', 'B', 'C']) sc.groups[g].enabled = g === 'A';
  sc.groups.A.surfaces = [];
  RF.SourcePresets.apply(sc.source, beam === 'low' ? 'h4-low' : 'h4-high');
  // filament orientation (ASSUMED, no source found): 'transverse' = across the lamp axis, left-right (the classic sealed-beam coil: its length smears the beam sideways, where it is wanted);
  // 'axial' = along the lamp axis (as in an H4 reflector headlamp: its length smears the beam vertically by up to ±8° at the rim)
  Object.assign(sc.source, { pos: [0, 0, 0], axis: opts.filament === 'axial' ? [1, 0, 0] : [0, 1, 0], roll: 0 });
  // envelope: the lamp's bucket + lens (x forward), centred on the focus axis; sized from the solver's own layout at default settings
  const input = { source: sc.source };
  const s = { lamp: lamp, beam: beam, focal: 0, lowUp: 2.5, lowLeft: 1.5, lowFwd: 0 };
  const L = RF.SealedBeam.layout(input, s), cw = 10, R = L.a + 1.7 * cw;
  const x0 = L.vx - 2, x1 = L.xin + 22;
  Object.assign(sc.envelope, { shape: 'cylinder', axis: 0, center: [(x0 + x1) / 2, 0, 0], half: [(x1 - x0) / 2, R, R], keepOut: 5 });
  sc.modeA.budget = 100;
  sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc));
  sc.modeA.paint = RF.Spec.seedPaint(sc);
  sc.solve = { id: 'sealed-beam-v1' }; sc.solverSettings = { 'sealed-beam-v1': Object.assign({ lamp, beam }, opts.settings || {}) };
  return sc;
}
function problemOf(sc) {
  const input = RF.Solvers.inputOf(sc);
  const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
  return { input, problem };
}
async function solve(sc, over) {
  const def = RF.Solvers.get('sealed-beam-v1');
  const { input, problem } = problemOf(sc);
  const settings = Object.assign(RF.Solvers.settingsOf(sc, 'sealed-beam-v1'), over || {});
  for (const k of ['lamp', 'beam', 'lens']) { const want = (over && over[k] !== undefined) ? over[k] : sc.solverSettings['sealed-beam-v1'][k]; if (want !== undefined && settings[k] !== want) throw new Error('setting ' + k + ' = ' + want + ' was silently replaced by ' + settings[k] + ' (select options must be {value,label})'); }
  const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: Infinity }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
  const t0 = Date.now(), out = await def.solve(input, settings, tools);
  return { out, ms: Date.now() - t0, facts: RF.Solvers.verify(sc, out) };
}
// judge at N rays: pilot then guided rounds (as the bench).  presets: names of Spec presets to judge the SAME far field against.
function judge(sc, surfaces, N, presets) {
  const s2 = JSON.parse(JSON.stringify(sc)); s2.groups.A.surfaces = surfaces; if (s2.sim.bounces < 3) s2.sim.bounces = 3;
  const P = RF.Engine.prepare(s2, RF.State.allSurfaces(s2)); P.ffStreams = [RF.Spec.gridOpts(s2)]; P.guideLearn = true;
  const N0 = Math.min(N, Math.max(100000, N / 4));
  let c = RF.Engine.newCtx(P, N0, 0); RF.Engine.traceRange(c, 0, N0); c.next = N0; c.done = true;
  while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
  const G = RF.FarField.build(c, P.ffStreams[0]), M = RF.FarField.map(G, 0.25);
  let pk = 0, pi = 0; for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > pk) { pk = M.cd[q]; pi = q; }
  const peakAt = [+(G.h0 + ((pi % G.nh) + 0.5) * G.step).toFixed(3), +(G.v0 + (Math.floor(pi / G.nh) + 0.5) * G.step).toFixed(3)];
  const res = { rays: N, peakCd: Math.round(pk), peakAt, lmWindow: Math.round(G.lmWindow), lmTotal: Math.round(c.E && c.E.landed !== undefined ? c.E.landed : 0), E: Object.assign({}, c.E), evals: {} };
  for (const name of presets || []) {
    const md = JSON.parse(JSON.stringify(sc.modeD)); RF.Spec.applyPreset(md, name);
    const ev = RF.Spec.evaluate(G, md);
    res.evals[name] = { verdict: ev.verdict, n: ev.n, score: +ev.score.toFixed(3), aim: ev.aim.note, rows: ev.rows.map((r) => ({ name: r.name, value: Math.round(r.value), sd: Math.round(r.sd), bound: r.bound, isMin: r.isMin, verdict: r.verdict })) };
  }
  return res;
}
module.exports = { RF, makeScene, solve, judge, problemOf };
