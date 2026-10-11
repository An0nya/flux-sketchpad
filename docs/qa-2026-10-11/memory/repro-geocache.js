// RF.Modes.geometry caches every distinct paint forever (js/modes.js:31). Measure retained heap after GC.
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable');
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.Modes && RF.UI && RF.UI.store && !RF.UI.solving, null, { timeout: 120000 });
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const m = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize').value; return +(m / 1048576).toFixed(2); };
  const h0 = await heap();
  const rows = [['n', 'heapMB']]; rows.push([0, h0]);
  for (const n of [100, 200, 400]) {
    await page.evaluate((n) => { const R = 100; for (let q = 0; q < n; q++) { const p = new Array(R * R).fill(0); for (let k = 0; k < p.length; k++) if (Math.random() < 0.3) p[k] = 1; RF.Modes.geometry(p, R); } }, n - (rows.length > 2 ? rows[rows.length - 1][0] : 0));
    rows.push([n, await heap()]);
  }
  // control: same work with a fresh K each time is the same cache; control instead = allocate+drop arrays of the same size
  console.log(rows.map((r) => r.join(',')).join('\n'));
  await browser.close();
})();
