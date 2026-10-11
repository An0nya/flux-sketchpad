// as repro-geocache.js, but counts external (typed array) memory via a heap snapshot statistics call
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.enable'); await cdp.send('Runtime.enable');
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.Modes && RF.UI && RF.UI.store && !RF.UI.solving, null, { timeout: 120000 });
  const ext = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const r = await cdp.send('Runtime.getHeapUsage'); return { usedMB: +(r.usedSize / 1048576).toFixed(2), embedderMB: r.embedderHeapUsedSize !== undefined ? +(r.embedderHeapUsedSize / 1048576).toFixed(2) : null, backingMB: r.backingStorageSize !== undefined ? +(r.backingStorageSize / 1048576).toFixed(2) : null }; };
  const out = [['n', JSON.stringify(await ext())]];
  for (const n of [500, 500, 1000]) {
    await page.evaluate((n) => { const R = 100; for (let q = 0; q < n; q++) { const p = new Array(R * R).fill(0); let s = q * 2654435761 + 7; for (let k = 0; k < p.length; k++) { s = (s * 1664525 + 1013904223) >>> 0; if (s / 4294967296 < 0.3) p[k] = 1; } RF.Modes.geometry(p, R, 3); } }, n);
    out.push(['+' + n, JSON.stringify(await ext())]);
  }
  console.log(out.map((r) => r.join(' ')).join('\n'));
  await browser.close();
})();
