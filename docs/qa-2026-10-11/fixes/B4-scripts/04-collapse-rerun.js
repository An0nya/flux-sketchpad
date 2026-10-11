const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.__log = []; const s = document.getElementById('progress-strip'); new MutationObserver(() => window.__log.push([Math.round(performance.now()), s.classList.contains('open'), document.getElementById('progress-text').textContent])).observe(s, { attributes: true }); new MutationObserver(() => window.__log.push([Math.round(performance.now()), 'txt', document.getElementById('progress-text').textContent])).observe(document.getElementById('progress-text'), { childList: true, characterData: true, subtree: true });
    const orig = RF.UI.requestRun; window.__rr = 0; RF.UI.requestRun = function () { window.__rr++; window.__log.push([Math.round(performance.now()), 'requestRun', JSON.stringify([...arguments])]); return orig.apply(this, arguments); }; });
  const t0 = await page.evaluate(() => performance.now());
  await page.click('button.collapse[data-collapse="editor"]'); await page.waitForTimeout(2500);
  console.log('after collapse editor', JSON.stringify(await page.evaluate(() => window.__log)));
  await page.evaluate(() => window.__log = []);
  await page.click('.pane[data-pane="editor"] h2'); await page.waitForTimeout(2500);
  console.log('after reopen', JSON.stringify(await page.evaluate(() => window.__log)));
  await page.evaluate(() => window.__log = []);
  await page.click('button.expand[data-expand="optics"]'); await page.waitForTimeout(2500);
  console.log('after expand', JSON.stringify(await page.evaluate(() => window.__log)));
  console.log(errors); await browser.close();
})();
