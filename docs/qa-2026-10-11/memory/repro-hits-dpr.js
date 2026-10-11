// Peak memory during a trace with the Result view on Hits, devicePixelRatio 1 vs 2 (Retina). No forced GC while sampling.
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const { execSync } = require('child_process');
function rendRss() { const ps = execSync('ps -axo pid=,ppid=,rss=,command=').toString().trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }; }).filter(Boolean);
  const kids = new Set([process.pid]); let g = true; while (g) { g = false; for (const p of ps) if (kids.has(p.ppid) && !kids.has(p.pid)) { kids.add(p.pid); g = true; } }
  let r = 0; for (const p of ps) if (kids.has(p.pid) && /type=renderer/.test(p.cmd)) r += p.rss; return r / 1024; }
(async () => {
  for (const disp of ['grid', 'hits']) for (const dpr of [1, 2]) {
    const browser = await pw.chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: dpr }), page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page); await cdp.send('HeapProfiler.enable');
    await page.goto('http://localhost:8806/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 120000 });
    await page.evaluate((d) => { RF.UI.setDisplay(d); }, disp);
    // count hitsCanvas rebuilds indirectly: wrap gridCanvas and record sizes
    await page.evaluate(() => { const R2 = RF.Render2D, f = R2.gridCanvas; window.__gc = []; R2.gridCanvas = function (v, res) { window.__gc.push(res); return f.apply(this, arguments); }; });
    await cdp.send('HeapProfiler.collectGarbage');
    const base = await cdp.send('Runtime.getHeapUsage'), rss0 = rendRss();
    await page.evaluate(() => { RF.UI.store.scene.sim.rays = 2000000; RF.UI.requestRun(false); });
    let peakB = 0, peakU = 0, peakR = 0; const t0 = Date.now();
    await page.waitForFunction(() => RF.UI.run && !RF.UI.run.ctx.done, null, { timeout: 10000 }).catch(() => {});
    while (Date.now() - t0 < 120000) {
      const h = await cdp.send('Runtime.getHeapUsage'); peakB = Math.max(peakB, h.backingStorageSize || 0); peakU = Math.max(peakU, h.usedSize); peakR = Math.max(peakR, rendRss());
      if (await page.evaluate(() => RF.UI.run.ctx.done)) break;
      await page.waitForTimeout(100);
    }
    const gc = await page.evaluate(() => { const c = {}; for (const r of window.__gc) c[r] = (c[r] || 0) + 1; return c; });
    console.log(JSON.stringify({ disp, dpr, devicePixelRatio: await page.evaluate(() => devicePixelRatio), traceS: ((Date.now() - t0) / 1000).toFixed(1), baseBackingMB: +(base.backingStorageSize / 1048576).toFixed(1), peakBackingMB: +(peakB / 1048576).toFixed(1), peakHeapMB: +(peakU / 1048576).toFixed(1), rss0: rss0.toFixed(0), peakRendererRssMB: peakR.toFixed(0), gridCanvasCallsByRes: gc }));
    await browser.close();
  }
})();
