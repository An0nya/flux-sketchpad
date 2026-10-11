// Long-session memory probe. node longsession.js <csv> [plan]
// plan: comma list of phase:count, phase in mix|presets|views|solves|worker|idle|refine
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), { execSync } = require('child_process');
const csv = process.argv[2] || 'samples.csv';
const plan = (process.argv[3] || 'mix:2').split(',').map((s) => { const [p, n] = s.split(':'); return [p, +n]; });
const PRESETS = ['headlamp', 'spec-box', 'spec-slim', 'spec-module', 'spec-sealed7', 'deepbox', 'stamps', 'parabola', 'cpc', 'lenscup', 'tir', 'fresnel'];
const SPECS = ['ece-r112-b', 'ece-r112-a', 'ece-r112-b-drive', 'ece-r112-a-drive', 'fmvss-lb2v', 'fmvss-lb2m', 'fmvss-ub2', 'hotspot'];
const DISPS = ['hits', 'grid', 'smooth', 'fid', 'road', 'drive', 'ff'];
const HEAD = 'cycle,phase,t_s,jsHeapUsedMB,jsHeapTotalMB,nodes,listeners,documents,frames,domCanvases,detachedCanvases,canvasPxMB,typedMB,typedCount,histPast,histMB,chromeRssMB,gpuRssMB,rendererRssMB,errors,note\n';
if (!fs.existsSync(csv)) fs.writeFileSync(csv, HEAD);
const errors = [];
function chromeRss(pid) {
  // all descendants of the browser pid; split out gpu and renderer by command line
  const out = execSync('ps -axo pid=,ppid=,rss=,command=').toString().trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }; }).filter(Boolean);
  const kids = new Set([pid]); let grew = true; while (grew) { grew = false; for (const p of out) if (kids.has(p.ppid) && !kids.has(p.pid)) { kids.add(p.pid); grew = true; } }
  let all = 0, gpu = 0, rend = 0; for (const p of out) if (kids.has(p.pid) && p.pid !== pid && /[Cc]hrom/.test(p.cmd)) { all += p.rss; if (/type=gpu-process/.test(p.cmd)) gpu += p.rss; if (/type=renderer/.test(p.cmd)) rend += p.rss; }
  return [all / 1024, gpu / 1024, rend / 1024].map((x) => x.toFixed(1));
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--js-flags=--expose-gc'] });
  const bpid = process.pid;
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  if (!/Flux/.test(await page.title())) throw new Error('wrong page');
  const T0 = Date.now();
  const settle = async (ms = 60000) => {
    await page.waitForFunction(() => !RF.UI.solving && !RF.UI.solveArmed && !RF.UI.needCompile && (!RF.UI.run || RF.UI.run.ctx.done), null, { timeout: ms }).catch(() => errors.push('settle timeout'));
  };
  const loadPreset = async (name) => {
    await page.selectOption('#preset-select', name);
    await page.click('#preset-confirm button.primary');
    await page.waitForTimeout(200);
  };
  const setRays = (n) => page.evaluate((n) => { RF.UI.store.scene.sim.rays = n; }, n);
  const solve = async (id) => {
    await page.evaluate((id) => { const ui = RF.UI, sc = ui.store.scene; if (!(sc.mode === 'A' || sc.mode === 'D')) ui.setMode('A', true); sc.solve = { id }; ui.generateA(); }, id);
    await page.waitForTimeout(300); await settle(150000);
  };
  const mode = async (m) => { await page.evaluate((m) => RF.UI.setMode(m), m); await settle(); };
  const spec = async (id) => { await page.evaluate((id) => { const ui = RF.UI; if (ui.store.scene.mode !== 'D') ui.setMode('D'); RF.Spec.applyPreset(ui.store.scene.modeD, id); ui.store.invalidate(['A']); ui.afterChange(); }, id); await settle(); };
  const views = async () => {
    for (const d of DISPS) { await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(250); }
    for (const v of ['solid', 'shaded', 'pairs', 'shaded']) { await page.selectOption('[data-control-view="surfaceView"]', v); await page.waitForTimeout(120); }
    // orbit the scene a bit (drag)
    const b = await page.locator('#scene-canvas').boundingBox();
    if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); for (let i = 0; i < 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + b.height / 2 + i * 5); await page.mouse.up(); }
    for (const p of ['result', 'optics']) { await page.evaluate((p) => { RF.UI.setPane(p, 'collapse'); }, p); await page.waitForTimeout(150); await page.evaluate((p) => { RF.UI.setPane(p, 'expand'); }, p); await page.waitForTimeout(150); }
  };
  const workerSolveReplace = async () => {
    // start a worker solve, replace it with another (aborts + rebuilds the worker), let the second finish
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; if (!(sc.mode === 'A' || sc.mode === 'D')) ui.setMode('A', true); sc.solve = { id: 'tir-array-v2' }; sc.solverSettings = Object.assign({}, sc.solverSettings, { 'tir-array-v2': { calib: 1, calibRays: 100000 } }); ui.generateA(); });
    await page.waitForFunction(() => RF.UI.solving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id: 'auto' }; ui.generateA(); });
    await page.waitForTimeout(300); await settle(150000);
  };
  const sample = async (cycle, phase, note) => {
    await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(300);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const w = await page.evaluate(() => {
      // walk RF for typed arrays and canvases (unique buffers / canvases), bounded
      const seen = new Set(), bufs = new Set(), cvs = new Set(); let typed = 0, nT = 0, steps = 0;
      const stack = [RF];
      while (stack.length && steps < 3e6) {
        const o = stack.pop(); steps++;
        if (!o || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) continue; seen.add(o);
        if (ArrayBuffer.isView(o)) { if (!bufs.has(o.buffer)) { bufs.add(o.buffer); typed += o.buffer.byteLength; nT++; } continue; }
        if (o instanceof ArrayBuffer) { if (!bufs.has(o)) { bufs.add(o); typed += o.byteLength; nT++; } continue; }
        if (typeof HTMLCanvasElement !== 'undefined' && o instanceof HTMLCanvasElement) { cvs.add(o); continue; }
        if (o instanceof Node || o === window || o instanceof CanvasRenderingContext2D || o instanceof ImageData) continue;
        if (o instanceof Map || o instanceof Set) { for (const v of o) stack.push(v); continue; }
        let keys; try { keys = Object.keys(o); } catch (e) { continue; }
        for (const k of keys) { let v; try { v = o[k]; } catch (e) { continue; } if (v && (typeof v === 'object' || typeof v === 'function')) stack.push(v); }
      }
      const dom = document.querySelectorAll('canvas');
      let px = 0, det = 0; const all = new Set([...dom, ...cvs]); for (const c of all) { px += c.width * c.height * 4; if (!c.isConnected) det++; }
      const h = RF.UI.hist, histJson = h ? JSON.stringify(h.past).length : 0;
      return { dom: dom.length, det, px: px / 1048576, typed: typed / 1048576, nT, histPast: h ? h.past.length : 0, histMB: histJson / 1048576, mode: RF.UI.store.scene.mode, steps };
    });
    const [rss, gpu, rend] = bpid ? chromeRss(bpid) : ['', '', ''];
    const row = [cycle, phase, ((Date.now() - T0) / 1000).toFixed(0), (m.JSHeapUsedSize / 1048576).toFixed(2), (m.JSHeapTotalSize / 1048576).toFixed(2), m.Nodes, m.JSEventListeners, m.Documents, m.Frames, w.dom, w.det, w.px.toFixed(2), w.typed.toFixed(2), w.nT, w.histPast, w.histMB.toFixed(2), rss, gpu, rend, errors.length, (note || '') + ' mode=' + w.mode + (w.steps >= 3e6 ? ' WALK-TRUNC' : '')];
    fs.appendFileSync(csv, row.join(',') + '\n');
    console.log(row.join(','));
  };
  let cycle = 0;
  await setRays(100000);
  await sample(cycle, 'boot', 'after boot solve');
  for (const [phase, n] of plan) {
    for (let i = 0; i < n; i++) {
      cycle++;
      try {
        if (phase === 'mix' || phase === 'presets') { await loadPreset(PRESETS[cycle % PRESETS.length]); await setRays(100000); await settle(150000); }
        if (phase === 'mix') { for (const m of ['A', 'B', 'C', 'D']) await mode(m); await spec(SPECS[cycle % SPECS.length]); }
        if (phase === 'mix' || phase === 'solves') { await setRays(100000); await solve(cycle % 2 ? 'spoke' : 'constellation'); }
        if (phase === 'mix' && cycle % 3 === 0) await workerSolveReplace();
        if (phase === 'worker') await workerSolveReplace();
        if (phase === 'mix' || phase === 'views') await views();
        if (phase === 'spec') { await spec(SPECS[cycle % SPECS.length]); await page.evaluate(() => RF.UI.setDisplay('ff')); await page.waitForTimeout(300); await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(800); await page.evaluate(() => RF.UI.setDisplay('road')); await page.waitForTimeout(500); }
        if (phase === 'idle') await page.waitForTimeout(20000);
      } catch (e) { errors.push('cycle ' + cycle + ': ' + e.message.split('\n')[0]); }
      await sample(cycle, phase);
    }
  }
  fs.writeFileSync(csv.replace(/\.csv$/, '') + '.errors.txt', errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
