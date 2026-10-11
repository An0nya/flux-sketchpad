// page-side worker accounting (wraps Worker): created / terminated / live, across replace + stop cycles
const H = require('./h.js');
const init = () => { const W = window.Worker; window.__w = { made: 0, term: 0, live: new Set() }; window.Worker = function (u, o) { const w = new W(u, o); window.__w.made++; window.__w.live.add(w); w.__url = String(u); const t = w.terminate.bind(w); w.terminate = () => { if (window.__w.live.delete(w)) window.__w.term++; t(); }; return w; }; window.Worker.prototype = W.prototype; };
(async () => {
  const { browser, page, errors, workers, st, start } = await H.boot({ init });
  const acct = () => page.evaluate(() => ({ made: __w.made, term: __w.term, live: [...__w.live].map((w) => w.__url.split('/').pop()).join(',') }));
  console.log('boot', JSON.stringify(await acct()), 'pw', workers.size);
  for (let i = 0; i < 4; i++) {
    await start('fill-fix'); await page.waitForTimeout(700);
    await start('sqm'); await page.waitForTimeout(2500);
    const mid = await st(); console.log(' cycle', i, 'sqm running?', mid.solving && mid.solving.name, 'busy', mid.busy, mid.status);
    await page.evaluate(() => RF.UI.stopSolve()); await page.waitForTimeout(2500);
    console.log('cycle', i, JSON.stringify(await acct()), 'pw', workers.size, [...workers].map((w) => w.url().split('/').pop()).join(','));
  }
  console.log('errors', errors); await browser.close();
})();
