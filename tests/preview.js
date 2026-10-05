// Watching a solve (tools.preview, SOLVER_API.md): node tests/preview.js — exits 1 on failure.
// Runs js/solve-worker.js itself in this process (self / importScripts / postMessage stubbed), so the throttle, the
// copies and the message order are the worker's own.  1. previews arrive, ≤ 1 per 250 ms, the latest one before 'done'
// 2. a solver's output is identical with previews on, off, and without the call (a real solver: tir-array-v2)
// 3. a preview never throws into the solver  4. headless hosts (runSync, run-solver's tools) treat it as a no-op
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const msgs = [];
globalThis.self = globalThis;
globalThis.postMessage = (m) => msgs.push(Object.assign({ at: performance.now() }, m));
globalThis.importScripts = (...files) => { for (const f of files) { const p = path.join(ROOT, 'js', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); } };
importScripts('solve-worker.js');
const RF = globalThis.RF;
for (const f of ['state', 'tir-array-v2']) { const p = f === 'state' ? path.join(ROOT, 'js', 'state.js') : path.join(ROOT, 'solvers', f + '.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a solver computing */ } };
// a synthetic iterating solver: 24 rounds of ~40 ms, a preview each (some with a trace), output = the spoke design
RF.Solvers.register({ id: 'pv-test', name: 'preview test', modes: ['paint'], settings: [{ key: 'minDistance', type: 'number', default: 0 }, { key: 'flood', type: 'checkbox', default: false }],
  async solve(input, s, tools) {
    const out = RF.Solvers.get('spoke').solve(input, s, tools);
    if (s.flood) { for (let i = 0; i < 2000; i++) tools.preview(out.surfaces, { label: 'flood ' + (i + 1) }); return out; }
    const tr = tools.trace(out.surfaces, { rays: 5000 });
    for (let r = 0; r < 24; r++) {
      busy(40);
      if (tools.preview) tools.preview(out.surfaces, r % 3 ? { label: 'round ' + (r + 1) + '/24', needs: { bounces: 2 } } : { label: 'round ' + (r + 1) + '/24', trace: tr });
      out.surfaces[0].P = out.surfaces[0].P.slice();                // mutating after the call must not change what was sent
    }
    tools.preview(null, { label: { toString() { throw new Error('bad label'); } } });   // a broken preview: swallowed
    return out;
  } });
const sc = RF.State.testScene(), prob = (id) => { const s = RF.U.deepCopy(sc); s.solve = { id }; return s; };
async function solve(id, preview, settings) {
  msgs.length = 0; const s = prob(id);
  await self.onmessage({ data: { type: 'solve', id, input: RF.Solvers.inputOf(s), settings: Object.assign(RF.Solvers.settingsOf(s, id), settings || {}), scene: { source: s.source, emitters: [], target: s.target, envelope: s.envelope, sim: s.sim, modeA: { paint: s.modeA.paint } }, budget: { rays: 5e7, ms: 120000 }, preview } });
  return msgs.slice();
}
(async () => {
  let m = await solve('pv-test', true);
  const pv = m.filter((x) => x.type === 'preview'), done = m.find((x) => x.type === 'done'), err = m.find((x) => x.type === 'error');
  ok('previews arrive (throttled) and the solve still finishes', !err && done && pv.length >= 3 && pv.length <= 6, pv.length + ' previews of 24 calls in ' + Math.round(done.at - m[0].at) + ' ms');
  const gaps = pv.slice(1).map((x, i) => x.at - pv[i].at);
  ok('≤ 1 preview per 250 ms (the final flush excepted)', gaps.slice(0, -1).every((g) => g >= 249), 'gaps ' + gaps.map(Math.round).join(', ') + ' ms');
  ok('the latest preview arrives before done', pv.length && pv[pv.length - 1].label === 'round 24/24' && m.indexOf(pv[pv.length - 1]) < m.indexOf(done), pv.map((x) => x.label).join(' · '));
  const g = pv.find((x) => x.grid);
  ok('a trace passed as info gives the grid (Float32) + res; needs carried', !g || (g.grid instanceof Float32Array && g.grid.length === g.res * g.res) , g ? 'res ' + g.res : 'no grid preview among the delivered (allowed)');
  ok('needs.bounces carried', pv.some((x) => x.needs && x.needs.bounces === 2) || pv.every((x) => (+x.label.split(' ')[1]) % 3 === 1));
  ok('each preview carries a full copy of the surfaces', pv.every((x) => Array.isArray(x.surfaces) && x.surfaces.length === done.output.surfaces.length));
  const m0 = await solve('pv-test', false), d0 = m0.find((x) => x.type === 'done');
  ok('preview off: no preview messages, identical output', !m0.some((x) => x.type === 'preview') && d0 && JSON.stringify(d0.output) === JSON.stringify(done.output));
  m = await solve('pv-test', true, { flood: true });
  const fl = m.filter((x) => x.type === 'preview');
  ok('2000 calls in a tight loop → first + last only', fl.length === 2 && fl[1].label === 'flood 2000', fl.map((x) => x.label).join(' · ') + (m.find((x) => x.type === 'error') ? ' error ' + m.find((x) => x.type === 'error').message : ''));
  // a real solver: tir-array-v2 (structure comparison + calibration rounds), small traces
  const set = { calib: 2, calibRays: 50000 };
  const a = await solve('tir-array-v2', true, set), b = await solve('tir-array-v2', false, set);
  const da = a.find((x) => x.type === 'done'), db = b.find((x) => x.type === 'done'), pa = a.filter((x) => x.type === 'preview');
  ok('tir-array-v2 through the worker: identical output with previews on / off', da && db && JSON.stringify(da.output.surfaces) === JSON.stringify(db.output.surfaces) && JSON.stringify(da.output.needs) === JSON.stringify(db.output.needs), pa.length + ' previews: ' + pa.map((x) => x.label + (x.grid ? ' +grid' : '') + (x.fidelity ? ' ' + Math.round(100 * x.fidelity.fidelity) + '%' : '')).join(' · '));
  ok('tir-array-v2 previews carry needs.bounces and a grid', pa.length >= 1 && pa.every((x) => x.needs && x.needs.bounces >= 4) && pa.some((x) => x.grid));
  // headless: the sync path's tools.preview is a no-op; run-solver's tools carry one
  const s = prob('pv-test'), r = RF.Solvers.runAsync ? await RF.Solvers.runAsync(s, 'pv-test') : null;
  ok('headless runAsync (no page callback): preview is a no-op, output identical', r && JSON.stringify(r.output) === JSON.stringify(done.output) && RF.Solvers.NO_PREVIEW.none);
  ok('tools/run-solver.js and tests/bench-spec.js hand solvers a no-op preview', /preview\(\) \{\}/.test(fs.readFileSync(path.join(ROOT, 'tools/run-solver.js'), 'utf8')) && /preview\(\) \{\}/.test(fs.readFileSync(path.join(ROOT, 'tests/bench-spec.js'), 'utf8')));
  console.log(fails ? fails + ' FAILED' : 'all preview checks passed');
  process.exit(fails ? 1 : 0);
})();
