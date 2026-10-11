// Default scene, untouched: where does "NaN%" appear in the stats panel?
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const st = document.getElementById('stats');
    const rows = [...st.querySelectorAll('*')].filter((e) => e.children.length === 0 && /NaN/.test(e.textContent)).map((e) => ({ tag: e.tagName, cls: e.className, text: e.textContent, parent: e.parentElement.textContent.slice(0, 200) }));
    return { title: document.title, mode: RF.UI.store.scene.mode, rays: RF.UI.run.ctx.N, solver: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, placed: RF.UI.store.reports.A && RF.UI.store.reports.A.placed, rows, footer: document.getElementById('footer').innerText.slice(0, 600) };
  });
  console.log(JSON.stringify(r, null, 1));
  await page.click('#btn-details').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'nan-baseline.png' });
  console.log('errors', errors);
  await browser.close();
})();
