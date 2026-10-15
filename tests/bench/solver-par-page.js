// W3b: wall time of one solve in the real page (the solver runs in the page's solve worker, as users run it).
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/bench/solver-par-page.js <port> <scene.json> <solver-id>
//        [--set k=v ...] [--tag x] [--gpu] [--threads N] [--swiftshader] [--headless-shell] [--preview] [--out results.jsonl] [--verify 1e6]
// Needs `python3 tests/serve.py <port>` running on this worktree.  Default browser = channel 'chromium' (full Chromium, real Apple GPU for WebGPU).
// --gpu: tick Simulation → GPU trace (the worker then gets the GPU; only solvers that call tools.traceAsync use it).  --preview: pass a preview callback (Watch solve on).
'use strict';
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flags = (k) => argv.flatMap((a, i) => (a === '--' + k ? [argv[i + 1]] : []));
const VAL = new Set(['set', 'tag', 'out', 'verify', 'threads']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && VAL.has(argv[i - 1].slice(2))));
const [port, sceneFile, id] = pos;
const sets = Object.fromEntries(flags('set').map((kv) => { const i = kv.indexOf('='), v = kv.slice(i + 1); return [kv.slice(0, i), v !== '' && !isNaN(+v) ? +v : v === 'true' ? true : v === 'false' ? false : v]; }));
(async () => {
  const gpu = argv.includes('--gpu'), args = ['--enable-unsafe-webgpu'].concat(argv.includes('--swiftshader') ? ['--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] : []);
  const browser = await pw.chromium.launch(argv.includes('--headless-shell') ? { args } : { channel: 'chromium', args });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([g, th]) => { try { localStorage.setItem('flux/gpu', g ? '1' : '0'); localStorage.setItem('flux/solveLimitMs', '1800000'); localStorage.setItem('flux/solverThreads', String(th)); } catch (e) { /* ignore */ } }, [gpu, +flag('threads', 0)]);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 300000 });
  if (String(await page.evaluate(() => location.port)) !== String(port) || !(await page.evaluate(() => !!RF.UI))) throw new Error('wrong page');
  if (gpu) await page.waitForFunction(() => RF.GpuTrace && RF.GpuTrace.ready(), null, { timeout: 120000 });
  const gpuInfo = await page.evaluate(() => (RF.GpuTrace && RF.GpuTrace.info ? RF.GpuTrace.info() : null));
  const res = await page.evaluate(async ([txt, id, sets, preview, V]) => {
    const sc = RF.State.deserialize(txt), def = RF.Solvers.get(id); if (!def) return { error: 'no solver ' + id };
    sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: Object.assign({}, (sc.solverSettings || {})[id], sets) });
    const t0 = performance.now(), r = await RF.Solvers.runAsync(sc, id, () => {}, preview ? () => {} : undefined), wall = performance.now() - t0, st = RF.SolverHost.lastStats() || {};
    const out = { wallMs: Math.round(wall), traceMs: st.traceMs, traces: st.traces, rays: st.raysUsed, placed: r.facts.placed, errors: r.facts.errors, notes: (r.output.notes || []).slice(0, 3).map((s) => String(s).slice(0, 200)), surfaces: r.output.surfaces.length,
      digest: (() => { const s = JSON.stringify(r.output.surfaces); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); })() };
    if (V > 0) { const input = RF.Solvers.inputOf(sc), problem = { source: sc.source, emitters: sc.emitters || [], envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: sc.mode, target: input.target, modeA: { paint: input.paint.cells } };
      const t = RF.Solvers.trace(problem, r.output.surfaces, { rays: V, seed: input.seed, spec: sc.mode === 'D', guided: true, bounces: r.output.needs && r.output.needs.bounces });
      out.verify = sc.mode === 'D' && t.spec ? { rays: V, verdict: t.spec.verdict, n: t.spec.n, expFails: t.spec.expFails, lm: Math.round(t.spec.lmWindow * 10) / 10 } : { rays: V, fid: t.fidelity && t.fidelity.fidelity, lm: t.lmOnTarget }; }
    return out;
  }, [fs.readFileSync(path.resolve(sceneFile), 'utf8'), id, sets, argv.includes('--preview'), +flag('verify', 0)]);
  const row = Object.assign({ tag: flag('tag', ''), where: 'page', browser: argv.includes('--headless-shell') ? 'headless_shell' : 'chromium', gpuTicked: gpu, threads: +flag('threads', 0), adapter: gpuInfo, preview: argv.includes('--preview'), solver: id, scene: path.basename(sceneFile), sets, pageErrors: errors.slice(0, 3) }, res);
  console.log(JSON.stringify(row)); const o = flag('out'); if (o) fs.appendFileSync(o, JSON.stringify(row) + '\n');
  await browser.close();
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
