const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({ viewport: { width: 375, height: 812 }, mobile: true, touch: true });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__p = []; const o = RF.UI.progress; RF.UI.progress = function (ph, f) { window.__p.push([Math.round(performance.now()), ph, f == null ? null : +(+f).toFixed(2)]); return o.apply(this, arguments); }; const rr = RF.UI.requestRun; RF.UI.requestRun = function (a) { window.__p.push([Math.round(performance.now()), 'requestRun', a, new Error().stack.split('\n').slice(2,4).join(' ').trim()]); return rr.apply(this, arguments); }; });
  const poll = async () => { const s = []; for (let i = 0; i < 14; i++) { s.push(await page.evaluate(() => (document.getElementById('progress-strip').classList.contains('open') ? 'O' : '-') + Math.round(document.getElementById('pane-tabs').getBoundingClientRect().top))); await page.waitForTimeout(100); } return s.join(' '); };
  await page.tap('button[data-tab="result"]'); console.log('tap result:', await poll());
  await page.tap('button[data-tab="editor"]'); console.log('tap editor:', await poll());
  console.log(JSON.stringify((await page.evaluate(() => window.__p)).filter(r => r[1] !== 'done').slice(0, 8)));
  await browser.close();
})();
