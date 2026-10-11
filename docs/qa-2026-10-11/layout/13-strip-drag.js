const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({});
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__p = []; const o = RF.UI.progress; RF.UI.progress = function (ph, f) { window.__p.push([Math.round(performance.now()), ph, f == null ? null : +(+f).toFixed(2)]); return o.apply(this, arguments); }; const rr = RF.UI.requestRun; RF.UI.requestRun = function (a) { window.__p.push([Math.round(performance.now()), 'requestRun', a, new Error().stack.split('\n')[2].trim()]); return rr.apply(this, arguments); }; });
  const b = await page.locator('.divider.v').boundingBox(); const x = b.x + 5, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 200, y, { steps: 10 }); await page.mouse.up();
  const seq = []; for (let i = 0; i < 10; i++) { seq.push(await page.evaluate(() => document.getElementById('progress-strip').classList.contains('open') ? 'O' : '-')); await page.waitForTimeout(150); }
  console.log(seq.join(''));
  const p = await page.evaluate(() => window.__p); console.log(JSON.stringify(p.filter(r => r[1] !== 'done').slice(0, 10)), 'n=', p.length);
  await browser.close();
})();
