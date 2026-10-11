const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({ viewport: { width: 1500, height: 950 } });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__m = []; const s = document.getElementById('progress-strip'); new MutationObserver(() => window.__m.push([Math.round(performance.now()), s.className])).observe(s, { attributes: true }); window.__st = []; const o = RF.UI.setStatus; RF.UI.setStatus = function (t) { window.__st.push([Math.round(performance.now()), t]); return o.apply(this, arguments); }; });
  await page.click('button.collapse[data-collapse="editor"]');
  const seq = []; for (let i = 0; i < 12; i++) { seq.push(await page.evaluate(() => document.getElementById('progress-strip').className)); await page.waitForTimeout(100); }
  console.log(seq.join(' | '));
  console.log(JSON.stringify(await page.evaluate(() => [window.__m, window.__st.slice(0, 5)])));
  await browser.close();
})();
