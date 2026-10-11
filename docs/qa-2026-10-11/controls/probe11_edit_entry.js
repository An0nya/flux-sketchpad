// (a) What is the "Edit" undo entry present right after load? (b) ArrowUp on a clean field vs after an invalid entry.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => {
    const h = RF.UI.hist, e = h.past[h.past.length - 1]; if (!e) return 'no entry';
    const cur = RF.History.intent(RF.UI.store.scene);
    const diff = (x, y, p = '') => { if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) return JSON.stringify(x) === JSON.stringify(y) ? [] : [p + ': ' + String(JSON.stringify(x)).slice(0, 90) + ' → ' + String(JSON.stringify(y)).slice(0, 90)]; return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => diff(x[k], y[k], p + '.' + k)); };
    return { label: e.label, n: h.past.length, changes: diff(e.it, cur).slice(0, 15) };
  });
  console.log('entry at load:', JSON.stringify(a, null, 1));
  await page.click('#btn-undo'); await page.waitForTimeout(1500);
  console.log('after undoing it:', JSON.stringify(await page.evaluate(() => ({ solve: RF.UI.store.scene.solve, past: RF.UI.hist.past.length, placed: RF.UI.store.reports.A && RF.UI.store.reports.A.placed, solving: !!RF.UI.solving, status: document.getElementById('status') && document.getElementById('status').textContent }))));
  const fld = '#side input.scrub[data-control="A.budget"]';
  await page.click(fld); await page.press(fld, 'ArrowUp'); await page.press(fld, 'Escape'); await page.waitForTimeout(200);
  console.log('clean ArrowUp:', await page.evaluate(() => RF.UI.store.scene.modeA.budget));
  await page.click(fld); await page.fill(fld, 'abc'); await page.press(fld, 'Enter'); await page.waitForTimeout(200);
  console.log('after abc: store', await page.evaluate(() => RF.UI.store.scene.modeA.budget), 'field', await page.inputValue(fld));
  await page.click(fld); await page.press(fld, 'ArrowUp'); await page.waitForTimeout(200);
  console.log('ArrowUp after abc: store', await page.evaluate(() => RF.UI.store.scene.modeA.budget), 'field', await page.inputValue(fld));
  console.log('errors', [...new Set(errors)]);
  await browser.close();
})();
