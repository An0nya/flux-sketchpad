/* lib.js — shared harness: RF loaded the way the tests do, a guided far-field judge, scene I/O. */
const fs = require('fs'), path = require('path');
const os = require('os'), ROOT = path.resolve(__dirname, '..', '..');
const { load } = require(ROOT + '/tests/load.js');
const RF = load();
const SCENE = process.env.FLUX_SCENE || path.join(os.homedir(), 'Downloads', 'reflector-scene-2.json');   // Anya's filament scene (not in the repo)
const loadScene = (p) => RF.State.deserialize(fs.readFileSync(p || SCENE, 'utf8'));
function judge(sc, N, N0) {
  N = N || 4e6; N0 = Math.min(N, N0 || 1e6);
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc), RF.Spec.wideOpts(sc)]; P.guideLearn = true;
  let c = RF.Engine.newCtx(P, N0, 0); RF.Engine.traceRange(c, 0, N0); c.next = N0; c.done = true;
  while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
  const G = RF.FarField.build(c, P.ffStreams[0]), ev = RF.Spec.evaluate(G, sc.modeD), Gw = RF.FarField.build(c, P.ffStreams[1]);
  // the secondary goal: IIHS 5 lx reach along the right and left road edges (m), read at the judge's aim, from the wide far field
  let reach = null; try { const sh = ev.shift || [0, 0], road = Object.assign(RF.Road.defaults(), sc.modeD.road || {}), m = RF.Road.model({ road, conv: sc.modeD.conv || 'A', I: (h, v) => { const r = RF.FarField.intensityAt(Gw, h + sh[0], v + sh[1], 0.25); return r.cd > 0 ? r.cd : 0; } }), ii = m.iihs(); reach = { right: ii.right, left: ii.left, glare: ii.glareMax }; } catch (e) { reach = null; }
  return { G, ev, ctx: c, P, reach };
}
// Anya's looser bar: a row is fine when value ∓ 1σ is inside the limit (and nowhere near a decade off); 'near' = within the noise; 'off' = outside by more than the noise
const loose = (r) => { if (!isFinite(r.value)) return 'off'; const sd = r.sd || 0; if (r.unit === 'log' || r.unit === 'deg') return r.verdict === 'fail' ? 'off' : 'pass'; const ok = r.isMin ? r.value - sd >= r.bound : r.value + sd <= r.bound; const far = r.isMin ? r.value < r.bound / 10 : r.value > r.bound * 10; return far ? 'off' : ok ? 'pass' : (r.isMin ? r.value >= r.bound : r.value <= r.bound) ? 'near' : (r.isMin ? r.value + 2 * sd >= r.bound : r.value - 2 * sd <= r.bound) ? 'near' : 'off'; };
const looseCounts = (ev) => { const c = { pass: 0, near: 0, off: 0 }; for (const r of ev.rows) c[loose(r)]++; return c; };
function report(ev, G, extra, reach) {
  const lines = [];
  const lc = looseCounts(ev); lines.push(`loose ${lc.pass} pass / ${lc.near} near / ${lc.off} off`); if (reach) lines.push(`reach ${reach.right.toFixed(0)}/${reach.left.toFixed(0)} m`);
  lines.push(`verdict ${ev.verdict} n ${JSON.stringify(ev.n)} score ${ev.score.toFixed(3)} lm-in-window ${G.lmWindow.toFixed(0)} aim: ${ev.aim && ev.aim.note} reaim ${JSON.stringify(ev.reaim)}`);
  for (const r of ev.rows) lines.push(`${(r.verdict || '').padEnd(7)} ${r.name.padEnd(20)} ${(typeof r.value === 'number' ? r.value.toPrecision(4) : r.value).toString().padStart(10)} ± ${(r.sd !== undefined ? (+r.sd).toPrecision(2) : '').padEnd(8)} ${r.isMin ? '>=' : '<='} ${typeof r.bound === 'number' ? r.bound.toPrecision(4) : r.bound}  margin ${r.margin !== undefined ? (+r.margin).toFixed(2) : ''}`);
  return lines.join('\n');
}
module.exports = { RF, ROOT, SCENE, loadScene, judge, report, loose, looseCounts };
