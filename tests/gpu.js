// GPU trace vs CPU trace (Playwright + Chromium WebGPU): node tests/gpu.js [--cases a,b] [--swiftshader] [--json out.json]
// Not in tests/all.js: it needs a browser with WebGPU.  On a machine without a GPU (CI, cloud containers) pass --swiftshader:
// Chromium's software Vulkan runs the same WGSL on the CPU cores (correctness only; its timings say nothing about a real GPU).
// The same rays both ways (tests/gpu-page.js): ledger, grid, per-surface sums, far-field streams within a small tolerance
// (f32 vs f64 moves a few rays near facet edges), first surface per ray almost always identical, Spec rows within noise.
const http = require('http'), fs = require('fs'), path = require('path');
const { FILES } = require('./load.js');
const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const cases = (opt('--cases') || 'emission,deterministic,modeA,domeLed,gaussianDisc,filamentHB3,multiEmitter,lensShieldDish,specBox,speed').split(',');
const SOLVERS = ['lab-fill-fix', 'lab-sqm', 'sonnet55-2026-09-28-dish-fit', 'opus55-2026-09-27-mosaic', 'lab-auto'];
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const pct = (x) => (100 * x).toFixed(x < 1e-3 ? 5 : 3) + '%';

const page = '<!doctype html><meta charset="utf-8"><title>gpu</title>' + FILES.concat(['gpu-trace']).map((f) => '<script src="js/' + f + '.js"></script>').join('') +
  SOLVERS.map((f) => '<script src="solvers/' + f + '.js"></script>').join('') + '<script src="tests/gpu-page.js"></script>';
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/' || u === '/gpu.html') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page); }
  const p = path.join(ROOT, u); if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
(async () => {
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const flags = ['--enable-unsafe-webgpu'].concat(args.includes('--swiftshader') ? ['--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] : []);
  const browser = await pw.chromium.launch({ args: flags }), pg = await browser.newPage(), errors = [];
  pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await pg.goto('http://127.0.0.1:' + server.address().port + '/gpu.html');
  await pg.waitForFunction(() => window.GpuCompare, null, { timeout: 30000 });
  const up = await pg.evaluate(async () => { await GpuCompare.init(); return GpuCompare.info(); });
  ok('WebGPU device + pipeline', up.ready, JSON.stringify(up.info || up.error));
  if (!up.ready) { await browser.close(); server.close(); process.exitCode = 1; return; }
  const out = {};
  for (const name of cases) {
    let r; try { r = await pg.evaluate((n) => GpuCompare.run(n), name); } catch (e) { ok(name + ' ran', false, String(e.message || e).slice(0, 300)); continue; }
    out[name] = r;
    if (name === 'emission') { for (const [k, v] of Object.entries(r)) ok('emission ' + k + ': GPU rays = CPU rays (f32)', v.p999 < 2e-6 && v.over < 2e-4, 'direction error p50 ' + v.p50.toExponential(1) + ', p99.9 ' + v.p999.toExponential(1) + ', worst ' + v.worst.toExponential(1) + ' rad; > 1e-4 rad: ' + pct(v.over) + (k === 'dome' ? ' (a dome ray whose Fresnel draw sits on the threshold takes the other branch)' : '')); continue; }
    if (name === 'deterministic') { ok('GPU deterministic: one dispatch ≡ two chunks (integer sums)', r.oneShotVsChunked && r.rayK && r.emitted[0] === r.emitted[1]); continue; }
    if (name === 'speed') { for (const x of r.out) console.log('       speed ' + (x.N / 1e6).toFixed(2) + ' M rays: CPU ' + x.cpuMs.toFixed(0) + ' ms (' + x.cpuMraysPerS.toFixed(2) + ' M/s)  GPU ' + x.gpuMs.toFixed(0) + ' ms (' + x.gpuMraysPerS.toFixed(2) + ' M/s)  ×' + (x.cpuMs / x.gpuMs).toFixed(1)); continue; }
    if (name === 'specBox') {
      ok('specBox ran on the GPU', r.usedGpu === true);
      ok('specBox (guided, 2 M): rows agree as two estimates (|Δ| / σ√2)', r.zMax < 3, 'max ' + r.zMax.toFixed(2) + 'σ, mean ' + r.zMean.toFixed(3) + 'σ over ' + r.rows.length + ' rows; verdict ' + r.verdict.join(' / ') + '; aim ' + r.aim.join(' / '));
      ok('specBox (unguided, 1 M, the CPU\'s aim): same rays → rows far inside noise', r.zFrozenMax < 0.1, 'max ' + r.zFrozenMax.toFixed(3) + 'σ, mean ' + r.zFrozenMean.toFixed(4) + 'σ; verdict flips at a frozen aim: ' + (r.frozenFlips.length ? r.frozenFlips.join(', ') : 'none'));
      ok('specBox: lumens in window agree', Math.abs(r.lmWindow[1] / r.lmWindow[0] - 1) < 2e-3, r.lmWindow.map((x) => x.toFixed(2)).join(' vs '));
      console.log('       verdict flips: ' + (r.verdictFlips.length ? r.verdictFlips.join(', ') : 'none') + ' · road ' + JSON.stringify(r.road) + ' · CPU ' + r.cpuMs.toFixed(0) + ' ms, GPU ' + r.gpuMs.toFixed(0) + ' ms');
      continue;
    }
    const tol = 2e-3;
    ok(name + ': energy ledger', r.ledgerWorst < tol, 'worst ' + r.ledgerWorstKey + ' ' + pct(r.ledgerWorst) + ' of emitted; conservation CPU ' + r.conservationCpu.toExponential(1) + ' GPU ' + r.conservationGpu.toExponential(1));
    ok(name + ': grid (L1)', r.grid < tol, pct(r.grid) + ' · surfIn ' + pct(r.surfIn) + ' · out1K ' + pct(r.out1K) + ' · blockedK ' + pct(r.blockedK));
    if (r.rayKDiff !== undefined) ok(name + ': same first surface per ray', r.rayKDiff < 1e-3, pct(r.rayKDiff) + ' of rays differ; hits ' + r.hits.join(' vs ') + (r.hitShift ? '; landing shift p50 ' + r.hitShift.p50.toExponential(1) + ' / p99 ' + r.hitShift.p99.toExponential(1) + ' mm (cell ' + r.hitShift.cellMm.toFixed(1) + ' mm at ' + (r.hitShift.distanceMm / 1000).toFixed(1) + ' m), > 1 cell: ' + pct(r.hitShift.overCell) : ''));
    console.log('       CPU ' + r.cpuMs.toFixed(0) + ' ms, GPU ' + r.gpuMs.toFixed(0) + ' ms for ' + (r.rays / 1e3).toFixed(0) + 'k rays' + (r.paths ? ' · paths ' + r.paths.join('/') : '') + (r.source ? ' · ' + r.source : ''));
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 1));
  await browser.close(); server.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });
