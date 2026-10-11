// the report while a run is still tracing (first live judgement is made without the re-aim box)
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 4000000; RF.UI.spec = null; RF.UI.requestRun(false); });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.N === 4000000, null, { timeout: 20000 });
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate(() => { const ui = RF.UI, n = [...document.querySelectorAll('#spec-report .note')].map((x) => x.innerText).find((t) => /^Measured/.test(t)); return { done: ui.run.ctx.done, pct: Math.round(100 * ui.run.ctx.next / ui.run.ctx.N), note: n ? n.replace(/[\d,]+ rays/, 'N rays') : null, footer: (document.querySelector('.tile.spec-v') || {}).innerText }; });
    const key = r.note + ' || ' + (r.footer || '').replace(/\n/g, ' ');
    if (!seen.has(key)) { seen.add(key); console.log(r.pct + '%', r.done ? 'DONE' : 'live', key); }
    if (r.done) break; await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1500);
  console.log('final', await page.evaluate(() => [...document.querySelectorAll('#spec-report .note')].map((x) => x.innerText).find((t) => /^Measured/.test(t))));
  console.log('errors', errors);
  await browser.close();
})();
