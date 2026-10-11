const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  for (let i = 0; i < 12; i++) {
    const s = await page.evaluate(() => ({ t: Math.round(performance.now()), open: document.getElementById('progress-strip').classList.contains('open'), txt: document.getElementById('progress-text').textContent, h: getComputedStyle(document.getElementById('progress-strip')).height, solving: !!RF.UI.solving, run: RF.UI.run && RF.UI.run.ctx ? !!RF.UI.run.ctx.done : null, status: document.getElementById('run-state').textContent }));
    console.log(JSON.stringify(s)); await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: L.SH + 'strip-12s.png', clip: { x: 0, y: 0, width: 1500, height: 140 } });
  console.log(errors); await browser.close();
})();
