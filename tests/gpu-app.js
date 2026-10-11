// The GPU trace in the real page (Playwright, Chromium WebGPU): node tests/gpu-app.js [--swiftshader] [--shot file.png]
// Not in tests/all.js (needs a browser with WebGPU; --swiftshader on machines without a GPU).
// 1. with Simulation → GPU trace on, the page's own trace runs on the GPU (footer says GPU) and matches a CPU trace of the same
//    rays   2. a worker solver's tools.traceAsync runs on the GPU too (res.gpu)   3. turning it off traces on the CPU again
//    4. no console errors
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.join(__dirname, '..'), args = process.argv.slice(2), shot = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]), p = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
// a solver that asks for its trace asynchronously: the default solver's design, then one tools.traceAsync of it
const PROBE = `RF.Solvers.register({ id: 'gpu-probe', name: 'GPU probe', version: '1', modes: ['paint'],
  settings: [{ key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 }],
  async solve(input, settings, tools) {
    const out = RF.Solvers.get('spoke').solve(input, settings, tools), r = await tools.traceAsync(out.surfaces, { rays: 200000 }), c = tools.trace(out.surfaces, { rays: 200000 });
    out.notes = (out.notes || []).concat(['traceAsync gpu=' + r.gpu + ' lm=' + r.lmOnTarget + ' cpu lm=' + c.lmOnTarget]); return out;
  } });`;
(async () => {
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const flags = ['--enable-unsafe-webgpu'].concat(args.includes('--swiftshader') ? ['--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] : []);
  const browser = await pw.chromium.launch({ args: flags }), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('flux/gpu', '1'); } catch (e) { /* ignore */ } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => RF.GpuTrace.ready() && !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000 });
  // the boot trace may have started before the device was up: trace again so this run is the GPU's
  await page.evaluate(() => RF.UI.requestRun(false));
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done && RF.UI.run.ctx.next === RF.UI.run.ctx.N, null, { timeout: 240000 });
  const a = await page.evaluate(() => {
    const run = RF.UI.run, c = run.ctx, P = RF.Engine.prepare(RF.UI.store.scene, RF.State.allSurfaces(RF.UI.store.scene));
    P.recordHits = true; if (run.P.ffStreams) { P.ffStreams = run.P.ffStreams; P.guideLearn = true; }
    const t0 = performance.now(), cc = RF.Engine.runSync(P, c.N, 0), cpuMs = performance.now() - t0;
    const g1 = RF.Engine.gridTotal(c), g2 = RF.Engine.gridTotal(cc); let d = 0, s = 0; for (let i = 0; i < g1.length; i++) { d += Math.abs(g1[i] - g2[i]); s += g2[i]; }
    let rk = 0; for (let i = 0; i < c.N; i++) if (c.rayK[i] !== cc.rayK[i]) rk++;
    const tile = document.querySelector('.tile.rays');
    return { N: c.N, gpuMs: c.gpuMs || 0, elapsed: c.elapsed, cpuMs, grid: d / s, rayK: rk / c.N, hits: [c.nHits, cc.nHits], footer: tile ? tile.textContent : '', paths: c.paths.length, mode: RF.UI.store.scene.mode };
  });
  ok('the page trace ran on the GPU', a.gpuMs > 0 && /GPU/.test(a.footer), 'footer "' + a.footer + '", ' + a.N.toLocaleString() + ' rays, GPU ' + a.elapsed.toFixed(0) + ' ms vs CPU ' + a.cpuMs.toFixed(0) + ' ms (Mode ' + a.mode + ')');
  ok('… and matches a CPU trace of the same rays', a.grid < 1e-3 && a.rayK < 1e-3 && Math.abs(a.hits[0] - a.hits[1]) <= 1e-3 * a.hits[1], 'grid L1 ' + a.grid.toExponential(2) + ', first surface differs on ' + (100 * a.rayK).toFixed(4) + '% of rays, hits ' + a.hits.join(' vs ') + ', paths drawn ' + a.paths);
  if (shot) await page.screenshot({ path: shot });

  // 2. a worker solver's traceAsync
  await page.evaluate((src) => RF.SolverHost.load(src), PROBE);
  await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.mode = 'A'; sc.solve = { id: 'gpu-probe' }; sc.solverSettings = Object.assign({}, sc.solverSettings, { 'gpu-probe': {} }); ui.generateA(); });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id === 'gpu-probe', null, { timeout: 240000 });
  const w = await page.evaluate(() => (RF.UI.store.reports.A.warnings || []).find((x) => /traceAsync/.test(x)) || JSON.stringify(RF.UI.store.reports.A.error || RF.UI.store.reports.A.warnings));
  const m = /gpu=(\w+) lm=([\d.e+-]+) cpu lm=([\d.e+-]+)/.exec(w || '');
  ok('a worker solver\'s tools.traceAsync ran on the GPU and agrees with tools.trace', !!m && m[1] === 'true' && Math.abs(+m[2] / +m[3] - 1) < 1e-3, w);

  // 3. off again: the next trace is the CPU's
  await page.evaluate(() => { RF.GpuTrace.setPref(false); RF.UI.requestRun(false); });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 240000 });
  const off = await page.evaluate(() => ({ gpuMs: RF.UI.run.ctx.gpuMs || 0, footer: (document.querySelector('.tile.rays') || {}).textContent || '' }));
  ok('GPU trace off: the page traces on the CPU', off.gpuMs === 0 && !/GPU/.test(off.footer), off.footer);
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });
