// After the tgt.dist hang: was the bad value autosaved? Reload the same context and see if it freezes again.
const { boot } = require('./h.js');
(async () => {
  const { browser, ctx, page } = await boot();
  page.evaluate(() => RF.UI.setControl('tgt.dist', 1e10)).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  await page.close().catch(() => {});
  const p2 = await ctx.newPage();
  await p2.goto('http://localhost:8802/index.html', { timeout: 30000 }).catch((e) => console.log('goto', String(e).slice(0, 80)));
  const saved = await Promise.race([p2.evaluate(() => { const s = localStorage.getItem('faceted-reflector-demo/scene/v1'); return s ? JSON.parse(s).target.distance : null; }), new Promise((r) => setTimeout(() => r('EVAL-TIMEOUT'), 5000))]);
  console.log('saved target.distance after hang =', saved);
  const t0 = Date.now();
  const alive = await Promise.race([p2.waitForFunction(() => RF.UI && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 40000 }).then(() => 'responsive'), new Promise((r) => setTimeout(() => r('FROZEN (no response in 45 s)'), 45000))]).catch((e) => 'err ' + String(e).slice(0, 100));
  console.log('second load:', alive, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await browser.close();
})();
