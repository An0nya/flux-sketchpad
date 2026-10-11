const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__p = []; const o = RF.UI.progress; RF.UI.progress = function (ph, f) { window.__p.push([Math.round(performance.now()), ph, f, new Error().stack.split('\n').slice(2, 5).map(s => s.trim()).join(' < ')]); return o.apply(this, arguments); }; });
  const samp = async () => page.evaluate(() => document.getElementById('progress-strip').classList.contains('open'));
  console.log('before', await samp());
  await page.click('button.collapse[data-collapse="editor"]');
  const seq = []; for (let i = 0; i < 15; i++) { seq.push(await samp()); await page.waitForTimeout(100); }
  console.log('open over 1.5s:', seq.join(','));
  console.log(JSON.stringify((await page.evaluate(() => window.__p)).slice(0, 6), null, 1));
  console.log(errors); await browser.close();
})();
