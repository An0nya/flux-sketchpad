// Part A: idle churn (60 s, no input) — frames/s, task time, heap sawtooth, renderer RSS.
// Part B: worker targets + their heaps across 8 replace-aborts of a worker solve.
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), { execSync } = require('child_process');
const out = 'workers-idle.csv'; fs.writeFileSync(out, 'part,step,t_s,pageHeapMB,taskDurS,frames,workers,workerHeapsMB,rendererRssMB,gpuRssMB,note\n');
function rss() {
  const ps = execSync('ps -axo pid=,ppid=,rss=,command=').toString().trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }; }).filter(Boolean);
  const kids = new Set([process.pid]); let g = true; while (g) { g = false; for (const p of ps) if (kids.has(p.ppid) && !kids.has(p.pid)) { kids.add(p.pid); g = true; } }
  let r = 0, gp = 0; for (const p of ps) if (kids.has(p.pid)) { if (/type=renderer/.test(p.cmd)) r += p.rss; if (/type=gpu-process/.test(p.cmd)) gp += p.rss; }
  return [(r / 1024).toFixed(1), (gp / 1024).toFixed(1)];
}
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  const workers = new Map();
  cdp.on('Target.attachedToTarget', (e) => { if (e.targetInfo.type === 'worker') workers.set(e.sessionId, e.targetInfo.url); });
  cdp.on('Target.detachedFromTarget', (e) => workers.delete(e.sessionId));
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await cdp.send('Performance.enable');
  await page.addInitScript(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 120000 });
  const T0 = Date.now();
  const workerHeaps = async () => {
    const hs = [];
    for (const [sid, url] of workers) {
      try { const r = await cdp.send('Runtime.getHeapUsage', undefined, sid).catch(() => null); if (r) hs.push(url.split('/').pop() + ':' + (r.usedSize / 1048576).toFixed(1)); } catch (e) { hs.push(url + ':?'); }
    }
    return hs;
  };
  // flat-session CDP: send to a child session via cdp.connection? Playwright's CDPSession doesn't route by sessionId; use page.context().newCDPSession on worker objects instead
  const wHeaps = async () => {
    const hs = [];
    for (const w of page.workers()) {
      try { const s = await page.context().newCDPSession(w); const r = await s.send('Runtime.getHeapUsage'); hs.push(w.url().split('/').pop() + ':' + (r.usedSize / 1048576).toFixed(1)); await s.detach(); } catch (e) { hs.push(w.url().split('/').pop() + ':err'); }
    }
    return hs;
  };
  const sample = async (part, step, note, gc) => {
    if (gc) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); }
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const fr = await page.evaluate(() => window.__frames);
    const hs = await wHeaps(); const [r, g] = rss();
    const row = [part, step, ((Date.now() - T0) / 1000).toFixed(1), (m.JSHeapUsedSize / 1048576).toFixed(2), m.TaskDuration.toFixed(2), fr, page.workers().length, hs.join(' '), r, g, note || ''];
    fs.appendFileSync(out, row.join(',') + '\n'); console.log(row.join(','));
  };
  const orbit = await page.evaluate(() => ({ orbitFirst: RF.UI.orbitFirst, idle: RF.UI.orbitIdle }));
  for (let i = 0; i <= 12; i++) { await sample('idle', i, i === 0 ? 'orbitFirst=' + orbit.orbitFirst + ' idle=' + orbit.idle : '', false); await page.waitForTimeout(5000); }
  await sample('idle', 13, 'after GC', true);
  // stop the first-load orbit by a drag on the optics canvas, then idle again 30 s
  const b = await page.locator('#surface-canvas').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2); await page.mouse.up();
  const orbit2 = await page.evaluate(() => RF.UI.orbitFirst);
  for (let i = 0; i <= 6; i++) { await sample('idle-touched', i, i === 0 ? 'orbitFirst=' + orbit2 : '', false); await page.waitForTimeout(5000); }
  // Part B: worker churn
  for (let i = 1; i <= 8; i++) {
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id: 'tir-array-v2' }; sc.solverSettings = Object.assign({}, sc.solverSettings, { 'tir-array-v2': { calib: 1, calibRays: 100000 } }); ui.generateA(); });
    await page.waitForFunction(() => RF.UI.solving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id: 'spoke' }; ui.generateA(); });   // a page solver replaces it
    await page.waitForFunction(() => !RF.UI.solving && !RF.SolverHost.busy(), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);   // let the worker rebuild (reload of all bundled sources)
    await sample('worker', i, '', true);
  }
  fs.writeFileSync('workers-idle.errors.txt', errs.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
