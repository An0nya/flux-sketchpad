// Run the built solver inside a worker that loads ONLY the files the app's solver worker loads (js/solver-env.js), like tools/run-solver.js does.
const { Worker } = require('worker_threads'), fs = require('fs'), path = require('path');
const { RF, ROOT } = require('../sqm-hl/lib.js'); const { makeScene } = require('../sqm-hl/scenes.js');
const file = process.argv[2] || '../../solvers/projector-v3.js', name = process.argv[3] || 'box';
const WORKER = `
const { parentPort, workerData } = require('worker_threads'), fs = require('fs'), path = require('path'), vm = require('vm');
const js = (f) => { const p = path.join(workerData.root, 'js', f + '.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); };
js('solver-env'); for (const f of globalThis.RF_SOLVER_ENV) js(f);
const RF = globalThis.RF; vm.runInThisContext(fs.readFileSync(workerData.file, 'utf8'), { filename: workerData.file });
parentPort.on('message', async (m) => { try { const def = RF.Solvers.get('projector-v3'); let rays = 0, nt = 0;
  const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: workerData.ms }, scene: m.problem, trace: (s, o) => { nt++; rays += (o && o.rays) || 0; return RF.Solvers.trace(m.problem, s, o); } };
  const t0 = Date.now(); const out = await def.solve(m.input, RF.Solvers.sanitize(def, m.settings || {}), tools); parentPort.postMessage({ type: 'done', out, ms: Date.now() - t0, nt, rays }); } catch (e) { parentPort.postMessage({ type: 'error', message: String(e && e.stack || e) }); } });`;
const w = new Worker(WORKER, { eval: true, workerData: { root: ROOT, file: path.resolve(file), ms: +(process.argv[4] || 120000) } });
const sc = (/\.json$/.test(name) ? makeScene('file:' + name, { budget: 150 }) : makeScene(name, { preset: 'ece-r112-b', budget: 100 })); const input = RF.Solvers.inputOf(sc);
const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
w.on('message', (m) => { if (m.type === 'error') console.log('ERROR', m.message); else { console.log(`worker solve ${(m.ms / 1000).toFixed(1)} s, ${m.out.surfaces.length} surfaces, ${m.nt} traces (${(m.rays / 1e6).toFixed(1)} M rays)`); for (const n of m.out.notes) console.log('  ', n.slice(0, 230)); } w.terminate(); });
w.postMessage({ input, problem, settings: {} });
